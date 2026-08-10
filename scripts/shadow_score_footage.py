#!/usr/bin/env python3
"""Read-only TKO match evidence worker.

The worker analyzes already-confirmed multi-angle footage, writes its findings to
the shadow evidence API, and never updates official results, ratings, payouts, or
Conquest. Local vision does the first pass. An optional Vertex Gemini review is
used only when local evidence is missing or contradictory.

Examples:
  py scripts/shadow_score_footage.py --max-groups 1 --cloud-review
  py scripts/shadow_score_footage.py --watch-seconds 300 --cloud-review
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from PIL import Image, ImageDraw
except ImportError as exc:  # pragma: no cover - operator setup error
    raise SystemExit("Pillow is required: py -m pip install pillow") from exc


DEFAULT_PIPELINE = Path.home() / "Desktop" / "killcam_clips"
DEFAULT_CONFIRMED = DEFAULT_PIPELINE / "confirmed_matches.json"
DEFAULT_SOURCE = DEFAULT_PIPELINE / "tko_auto"
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434/api/generate")
ANALYZER_VERSION = "shadow-evidence-v1"

RESULT_PROMPT = """You are a cautious evidence reader for Naruto to Boruto: Shinobi Striker.
This is a timestamped contact sheet from ONE player's view of ONE match. Read only
what is visibly present. Never infer a win from exciting action. A win/loss is
valid only when a result screen, explicit VICTORY/DEFEAT text, final scoreboard,
or an unambiguous match-ending score proves it.

Return one JSON object with exactly these keys:
{
  "screen_types": ["gameplay|scoreboard|result|menu|unknown"],
  "mode": "base|flag|combat|barrier|survival|unknown",
  "pov_outcome": "win|loss|draw|unknown",
  "outcome_exact_text": "the exact visible result text or empty",
  "visible_names": ["exact gamertags"],
  "allies": ["exact gamertags clearly on the POV player's side"],
  "opponents": ["exact gamertags clearly on the opposing side"],
  "kills": null,
  "deaths": null,
  "scores": {"ally": null, "enemy": null},
  "events": [{"timestamp":"label", "type":"ko|death|base_capture|flag_capture|result", "exact_text":"", "confidence":0.0}],
  "confidence": 0.0,
  "reason": "short evidence explanation"
}
Use unknown and null whenever the pixels do not prove a value. Confidence must be
0 to 1. Respond with JSON only."""

EVENT_PROMPT = """Read this timestamped Shinobi Striker contact sheet as evidence.
Return JSON only with: mode, clock_text, team_players, banners (exact visible
words), result_text, and action_level from 0 to 10. Do not guess names or results."""

CLOUD_PROMPT = """You are the second-pass reviewer for TKO.cam shadow match evidence.
The attached contact sheets are labeled with each member's POV. Determine whether
they show the same match and whether the member POVs were allies or opponents.
Only assign win/loss when an explicit result screen, scoreboard, or unambiguous
match-ending score proves it. Do not award official points.

Return JSON only:
{
  "same_match": true,
  "member_relationship": "same_side|opponents|unclear",
  "mode": "base|flag|combat|barrier|survival|unknown",
  "participants": [{"label":"exact supplied label", "outcome":"win|loss|draw|unknown", "reason":"visible evidence"}],
  "overall_result": "win|loss|draw|mixed|unknown",
  "confidence": 0.0,
  "exact_evidence": ["visible result or score text"],
  "reason": "short explanation"
}
Use unknown when uncertain. Respond with JSON only."""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def compact_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=True, separators=(",", ":"))


def parse_json_object(raw: str) -> dict[str, Any]:
    raw = (raw or "").strip()
    raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.I | re.S)
    start, end = raw.find("{"), raw.rfind("}")
    if start < 0 or end < start:
        raise ValueError("model response did not contain a JSON object")
    value = json.loads(raw[start : end + 1])
    if not isinstance(value, dict):
        raise ValueError("model response was not an object")
    return value


def clamp(value: Any) -> float:
    try:
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return 0.0


def normalized_outcome(value: Any) -> str:
    result = str(value or "unknown").strip().lower()
    return result if result in {"win", "loss", "draw", "unknown"} else "unknown"


def result_words(text: Any) -> bool:
    value = str(text or "").lower()
    return bool(
        re.search(
            r"\b(victory|defeat|winner|won|you win|you lose|match won|match lost|draw|tie game)\b",
            value,
        )
    )


def numeric_score(result: dict[str, Any]) -> tuple[float, float] | None:
    scores = result.get("scores") if isinstance(result.get("scores"), dict) else {}
    try:
        ally = float(scores.get("ally"))
        enemy = float(scores.get("enemy"))
    except (TypeError, ValueError):
        return None
    return (ally, enemy) if ally != enemy else None


def sanitize_local_result(result: dict[str, Any]) -> dict[str, Any]:
    """Reject action/objective text presented as a final match verdict."""
    cleaned = dict(result)
    exact = str(cleaned.get("outcome_exact_text") or "")
    screens = cleaned.get("screen_types") if isinstance(cleaned.get("screen_types"), list) else []
    is_result_screen = any(str(screen).lower() in {"result", "scoreboard"} for screen in screens)
    has_score = numeric_score(cleaned) is not None
    requested = normalized_outcome(cleaned.get("pov_outcome"))
    direct = result_words(exact) or (is_result_screen and has_score)
    if requested != "unknown" and not direct:
        cleaned["guardrail_rejected_outcome"] = requested
        cleaned["guardrail_reason"] = "No explicit result text or unequal result-screen score"
        cleaned["pov_outcome"] = "unknown"
        cleaned["confidence"] = min(clamp(cleaned.get("confidence")), 0.45)
    else:
        cleaned["pov_outcome"] = requested
    placeholders = {"exact gamertags", "exact username", "namea", "nameb", "unknown"}
    for field in ("visible_names", "allies", "opponents"):
        values = cleaned.get(field) if isinstance(cleaned.get(field), list) else []
        cleaned[field] = [
            str(value).strip()
            for value in values
            if str(value).strip() and str(value).strip().lower() not in placeholders
        ]
    return cleaned


def member_name(label: str) -> str:
    return re.split(r"\s*//\s*", label.strip(), maxsplit=1)[0].strip() or label.strip()


def find_ffmpeg() -> str:
    configured = os.environ.get("FFMPEG_EXE")
    if configured and Path(configured).exists():
        return configured
    found = shutil.which("ffmpeg")
    if found:
        return found
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as exc:  # pragma: no cover - operator setup error
        raise RuntimeError("ffmpeg was not found; install imageio-ffmpeg or set FFMPEG_EXE") from exc


def duration_seconds(path: Path, ffmpeg: str) -> float:
    try:
        import imageio_ffmpeg

        _, seconds = imageio_ffmpeg.count_frames_and_secs(str(path))
        if seconds and seconds > 0:
            return float(seconds)
    except Exception:
        pass
    proc = subprocess.run(
        [ffmpeg, "-hide_banner", "-i", str(path)], capture_output=True, text=True, check=False
    )
    found = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", proc.stderr)
    if not found:
        raise RuntimeError(f"could not read duration for {path}")
    return int(found.group(1)) * 3600 + int(found.group(2)) * 60 + float(found.group(3))


def sample_times(duration: float, window_start: float, window_end: float | None) -> list[float]:
    """Sample only the confirmed match segment, plus its result-screen tail."""
    start = max(0.0, min(float(window_start or 0), max(0.0, duration - 0.2)))
    end = float(window_end) if window_end is not None else duration
    end = max(start + 1.0, min(end, duration))
    span = max(1.0, end - start)
    candidates = [
        start + span * 0.05,
        start + span * 0.35,
        start + span * 0.65,
        start + span * 0.85,
        end - 4.0,
        end + 1.0,
        end + 7.0,
        end + 16.0,
    ]
    upper = max(0.1, duration - 0.15)
    return sorted({round(min(upper, max(0.0, value)), 2) for value in candidates})


def extract_frame(path: Path, at: float, ffmpeg: str, width: int = 640) -> Image.Image | None:
    proc = subprocess.run(
        [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            f"{at:.3f}",
            "-i",
            str(path),
            "-frames:v",
            "1",
            "-vf",
            f"scale={width}:-2",
            "-f",
            "image2pipe",
            "-vcodec",
            "png",
            "-",
        ],
        capture_output=True,
        check=False,
    )
    if not proc.stdout:
        return None
    import io

    with Image.open(io.BytesIO(proc.stdout)) as image:
        return image.convert("RGB")


def make_contact_sheet(
    path: Path,
    output: Path,
    ffmpeg: str,
    window_start: float = 0,
    window_end: float | None = None,
) -> tuple[Path, list[float]]:
    duration = duration_seconds(path, ffmpeg)
    times = sample_times(duration, window_start, window_end)
    frames: list[tuple[float, Image.Image]] = []
    for at in times:
        frame = extract_frame(path, at, ffmpeg)
        if frame is not None:
            frames.append((at, frame))
    if not frames:
        raise RuntimeError(f"no frames extracted from {path}")

    cell_w, cell_h, label_h = 640, 360, 28
    columns, rows = 2, (len(frames) + 1) // 2
    sheet = Image.new("RGB", (columns * cell_w, rows * (cell_h + label_h)), "black")
    draw = ImageDraw.Draw(sheet)
    for index, (at, frame) in enumerate(frames):
        x = (index % columns) * cell_w
        y = (index // columns) * (cell_h + label_h)
        fitted = frame.copy()
        fitted.thumbnail((cell_w, cell_h))
        px = x + (cell_w - fitted.width) // 2
        py = y + label_h + (cell_h - fitted.height) // 2
        sheet.paste(fitted, (px, py))
        draw.rectangle((x, y, x + cell_w, y + label_h), fill=(10, 12, 18))
        draw.text((x + 8, y + 6), f"FRAME {index + 1}  t={at:.2f}s", fill=(255, 255, 255))
    output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output, "JPEG", quality=86, optimize=True)
    return output, [at for at, _ in frames]


def image_b64(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("ascii")


def ollama_json(model: str, prompt: str, image: Path, timeout: int = 300) -> dict[str, Any]:
    body = compact_json(
        {
            "model": model,
            "prompt": prompt,
            "images": [image_b64(image)],
            "format": "json",
            "stream": False,
            "options": {"temperature": 0, "num_ctx": 8192},
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        OLLAMA_URL, data=body, headers={"content-type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        envelope = json.loads(response.read().decode("utf-8"))
    return parse_json_object(str(envelope.get("response", "")))


def gcloud_access_token() -> str:
    gcloud = shutil.which("gcloud") or shutil.which("gcloud.cmd")
    if not gcloud:
        raise RuntimeError("gcloud is not installed")
    proc = subprocess.run(
        [gcloud, "auth", "print-access-token"], capture_output=True, text=True, check=False
    )
    if proc.returncode or not proc.stdout.strip():
        raise RuntimeError(proc.stderr.strip() or "gcloud did not return an access token")
    return proc.stdout.strip()


def vertex_review(
    records: list[dict[str, Any]], project: str, location: str, model: str, timeout: int = 300
) -> dict[str, Any]:
    parts: list[dict[str, Any]] = [{"text": CLOUD_PROMPT}]
    for record in records:
        parts.append({"text": f"POV LABEL: {record['label']}"})
        parts.append(
            {
                "inlineData": {
                    "mimeType": "image/jpeg",
                    "data": image_b64(Path(record["contact_sheet"])),
                }
            }
        )
    url = (
        f"https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/"
        f"{location}/publishers/google/models/{model}:generateContent"
    )
    body = compact_json(
        {
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": {
                "temperature": 0,
                "responseMimeType": "application/json",
                "maxOutputTokens": 4096,
            },
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={
            "authorization": f"Bearer {gcloud_access_token()}",
            "content-type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        envelope = json.loads(response.read().decode("utf-8"))
    candidates = envelope.get("candidates") or []
    parts_out = ((candidates[0].get("content") or {}).get("parts") or []) if candidates else []
    text = "".join(str(part.get("text", "")) for part in parts_out)
    return parse_json_object(text)


def source_files(group: dict[str, Any], source_dir: Path) -> list[tuple[dict[str, Any], Path]]:
    result: list[tuple[dict[str, Any], Path]] = []
    slug = str(group.get("slug") or "")
    for index, angle in enumerate(group.get("angles") or []):
        youtube_id = str(angle.get("yt") or "")
        candidates = [
            source_dir / f"{slug}_{index}_{youtube_id}.mp4",
            source_dir / f"xm_{youtube_id}.mp4",
        ]
        found = next((candidate for candidate in candidates if candidate.exists()), candidates[0])
        result.append((angle, found))
    return result


def fingerprint(group: dict[str, Any], files: list[tuple[dict[str, Any], Path]]) -> str:
    digest = hashlib.sha256()
    digest.update(compact_json({"slug": group.get("slug"), "sig": group.get("sig")}).encode())
    for _, path in files:
        digest.update(str(path).encode("utf-8", errors="replace"))
        if not path.exists():
            digest.update(b"missing")
            continue
        stat = path.stat()
        digest.update(f"{stat.st_size}:{stat.st_mtime_ns}".encode())
        with path.open("rb") as handle:
            digest.update(handle.read(65536))
            if stat.st_size > 65536:
                handle.seek(max(0, stat.st_size - 65536))
                digest.update(handle.read(65536))
    return digest.hexdigest()


def majority(values: list[str], fallback: str = "unknown") -> str:
    usable = [value for value in values if value and value != "unknown"]
    return Counter(usable).most_common(1)[0][0] if usable else fallback


def aggregate_local(records: list[dict[str, Any]]) -> dict[str, Any]:
    outcomes = [normalized_outcome(record["result"].get("pov_outcome")) for record in records]
    explicit = [outcome for outcome in outcomes if outcome != "unknown"]
    confidences = [clamp(record["result"].get("confidence")) for record in records]
    explicit_confidences = [
        confidence for outcome, confidence in zip(outcomes, confidences) if outcome != "unknown"
    ]
    distinct = set(explicit)
    if not explicit:
        overall = "unknown"
        relationship = "unclear"
        confidence = 0.0
    elif len(distinct) == 1:
        overall = explicit[0]
        relationship = "same_side" if len(records) > 1 and len(explicit) == len(records) else "unclear"
        confidence = sum(explicit_confidences) / len(explicit_confidences)
        confidence *= min(1.0, 0.7 + 0.15 * len(explicit))
    else:
        overall = "mixed"
        relationship = "opponents_or_conflict"
        confidence = min(explicit_confidences or [0.0]) * 0.75
    complete = (
        overall in {"win", "loss", "draw"}
        and confidence >= 0.82
        and (len(records) == 1 or len(explicit) >= 2)
    )
    return {
        "overall_result": overall,
        "member_relationship": relationship,
        "confidence": round(confidence, 4),
        "status": "complete" if complete else "needs_review",
        "mode": majority([str(record["result"].get("mode") or "unknown") for record in records]),
        "angle_outcomes": [
            {
                "label": record["label"],
                "outcome": outcome,
                "confidence": confidence_value,
                "exact_text": str(record["result"].get("outcome_exact_text") or ""),
            }
            for record, outcome, confidence_value in zip(records, outcomes, confidences)
        ],
    }


def apply_cloud(local: dict[str, Any], review: dict[str, Any]) -> dict[str, Any]:
    confidence = clamp(review.get("confidence"))
    participants = review.get("participants") if isinstance(review.get("participants"), list) else []
    explicit = [
        normalized_outcome(participant.get("outcome"))
        for participant in participants
        if isinstance(participant, dict)
    ]
    explicit = [outcome for outcome in explicit if outcome != "unknown"]
    result = dict(local)
    result["cloud_review"] = review
    result["confidence"] = round(max(float(local.get("confidence") or 0), confidence), 4)
    result["member_relationship"] = str(review.get("member_relationship") or result["member_relationship"])
    result["mode"] = str(review.get("mode") or result["mode"])
    exact_evidence = review.get("exact_evidence") if isinstance(review.get("exact_evidence"), list) else []
    direct = any(result_words(value) for value in exact_evidence)
    result["cloud_outcomes_accepted"] = direct
    if confidence >= 0.84 and explicit and direct:
        result["overall_result"] = str(review.get("overall_result") or result["overall_result"])
        result["status"] = "complete"
    elif explicit and not direct:
        result["cloud_guardrail"] = "Cloud outcomes lacked explicit result evidence"
        result["status"] = "needs_review"
    return result


def participants_payload(records: list[dict[str, Any]], verdict: dict[str, Any]) -> list[dict[str, Any]]:
    cloud_by_label: dict[str, dict[str, Any]] = {}
    for item in ((verdict.get("cloud_review") or {}).get("participants") or []):
        if isinstance(item, dict):
            cloud_by_label[str(item.get("label") or "").lower()] = item
    result: list[dict[str, Any]] = []
    for record in records:
        local = record["result"]
        cloud = cloud_by_label.get(record["label"].lower(), {})
        cloud_outcome = cloud.get("outcome") if verdict.get("cloud_outcomes_accepted") else None
        outcome = normalized_outcome(cloud_outcome or local.get("pov_outcome"))
        result.append(
            {
                "detected_name": member_name(record["label"]),
                "team": verdict.get("member_relationship"),
                "outcome": outcome,
                "kills": local.get("kills") if isinstance(local.get("kills"), int) else None,
                "deaths": local.get("deaths") if isinstance(local.get("deaths"), int) else None,
                "assists": None,
                "confidence": max(clamp(local.get("confidence")), clamp(cloud.get("confidence"))),
                "evidence": {
                    "source_file": record["source_file"],
                    "outcome_exact_text": local.get("outcome_exact_text"),
                    "visible_names": local.get("visible_names") or [],
                    "allies": local.get("allies") or [],
                    "opponents": local.get("opponents") or [],
                    "cloud_reason": cloud.get("reason"),
                },
            }
        )
    return result


def post_shadow(api_base: str, service_key: str, payload: dict[str, Any], timeout: int = 60) -> dict[str, Any]:
    url = api_base.rstrip("/") + "/api/internal/shadow-match-evidence"
    request = urllib.request.Request(
        url,
        data=compact_json(payload).encode("utf-8"),
        headers={"content-type": "application/json", "x-tko-service": service_key},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def score_group(group: dict[str, Any], args: argparse.Namespace, ffmpeg: str) -> dict[str, Any]:
    slug = str(group.get("slug") or "unknown")
    files = source_files(group, args.source_dir)
    source_fingerprint = fingerprint(group, files)
    output_file = args.output_dir / f"{slug}.json"
    if output_file.exists() and not args.refresh:
        try:
            cached = json.loads(output_file.read_text(encoding="utf-8"))
            if cached.get("source_fingerprint") == source_fingerprint:
                print(f"SKIP {slug}: footage unchanged", flush=True)
                return cached
        except Exception:
            pass

    records: list[dict[str, Any]] = []
    errors: list[str] = []
    cache_dir = args.output_dir / "contact_sheets" / source_fingerprint[:16]
    for index, (angle, path) in enumerate(files):
        label = str(angle.get("label") or f"ANGLE {index + 1}")
        if not path.exists():
            errors.append(f"missing footage for {label}: {path}")
            continue
        print(f"  {slug}: reading {label} ({path.name})", flush=True)
        try:
            sheet, times = make_contact_sheet(
                path,
                cache_dir / f"{index:02d}.jpg",
                ffmpeg,
                float(angle.get("start") or 0),
                float(angle["end"]) if angle.get("end") is not None else None,
            )
            result = sanitize_local_result(
                ollama_json(args.model, RESULT_PROMPT, sheet, args.model_timeout)
            )
            event_result: dict[str, Any] | None = None
            if args.event_model:
                event_result = ollama_json(args.event_model, EVENT_PROMPT, sheet, args.model_timeout)
            records.append(
                {
                    "label": label,
                    "youtube_id": angle.get("yt"),
                    "source_file": str(path),
                    "contact_sheet": str(sheet),
                    "sample_times": times,
                    "result": result,
                    "event_scan": event_result,
                }
            )
        except Exception as exc:
            errors.append(f"{label}: {type(exc).__name__}: {exc}")

    local = aggregate_local(records)
    verdict = local
    cloud_error: str | None = None
    if args.cloud_review and records and local["status"] != "complete":
        print(f"  {slug}: local evidence uncertain; requesting cloud review", flush=True)
        try:
            review = vertex_review(records, args.cloud_project, args.cloud_location, args.cloud_model)
            verdict = apply_cloud(local, review)
        except Exception as exc:
            cloud_error = f"{type(exc).__name__}: {exc}"
            errors.append(f"cloud review: {cloud_error}")

    evidence_quality = min(1.0, len(records) / max(1, len(files)))
    payload: dict[str, Any] = {
        "source_fingerprint": source_fingerprint,
        "source_kind": "confirmed_multi_angle_footage",
        "source_ref": f"{args.confirmed}#{slug}",
        "status": verdict.get("status", "needs_review") if records else "failed",
        "match_signature": group.get("sig") or str(group.get("match_key") or ""),
        "game": "shinobi_striker",
        "mode": verdict.get("mode") or "unknown",
        "verdict": verdict,
        "confidence": verdict.get("confidence") or 0,
        "evidence_quality": evidence_quality,
        "analyzer": "pc-local-plus-cloud-review" if args.cloud_review else "pc-local",
        "model": "+".join(filter(None, [args.model, args.event_model, args.cloud_model if args.cloud_review else None])),
        "analyzer_version": ANALYZER_VERSION,
        "evidence": records,
        "analysis": {
            "slug": slug,
            "title": group.get("title"),
            "angle_count_expected": len(files),
            "angle_count_analyzed": len(records),
            "errors": errors,
            "cloud_error": cloud_error,
            "analyzed_at": utc_now(),
        },
        "error": "; ".join(errors) if errors and not records else None,
        "participants": participants_payload(records, verdict),
    }
    output_file.parent.mkdir(parents=True, exist_ok=True)
    output_file.write_text(json.dumps(payload, indent=2, ensure_ascii=True), encoding="utf-8")

    if not args.no_post and args.api_base and args.service_key:
        try:
            posted = post_shadow(args.api_base, args.service_key, payload)
            payload["posted_at"] = utc_now()
            payload["posted_analysis_id"] = (posted.get("analysis") or {}).get("id")
            output_file.write_text(json.dumps(payload, indent=2, ensure_ascii=True), encoding="utf-8")
            print(f"  {slug}: shadow evidence posted; official_state_changed=false", flush=True)
        except Exception as exc:
            print(f"  {slug}: post failed: {type(exc).__name__}: {exc}", file=sys.stderr, flush=True)

    print(
        f"DONE {slug}: {payload['status']} result={verdict.get('overall_result')} "
        f"confidence={float(payload['confidence']):.2f} angles={len(records)}/{len(files)}",
        flush=True,
    )
    return payload


def load_groups(path: Path, requested: set[str]) -> list[dict[str, Any]]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, list):
        raise ValueError(f"{path} must contain a JSON array")
    groups = [group for group in value if isinstance(group, dict)]
    if requested:
        groups = [group for group in groups if str(group.get("slug")) in requested]
    return sorted(groups, key=lambda group: str(group.get("t0") or ""))


def run_once(args: argparse.Namespace, ffmpeg: str) -> list[dict[str, Any]]:
    groups = load_groups(args.confirmed, set(args.slug or []))
    if args.max_groups:
        groups = groups[-args.max_groups :]
    print(f"Shadow scan: {len(groups)} confirmed group(s); official scoring is disabled", flush=True)
    return [score_group(group, args, ffmpeg) for group in groups]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--confirmed", type=Path, default=DEFAULT_CONFIRMED)
    parser.add_argument("--source-dir", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_PIPELINE / "shadow_results")
    parser.add_argument("--slug", action="append", help="Only analyze this confirmed slug (repeatable)")
    parser.add_argument("--max-groups", type=int, default=0, help="Analyze only the newest N groups")
    parser.add_argument("--model", default=os.environ.get("TKO_SHADOW_MODEL", "qwen2.5vl:7b"))
    parser.add_argument("--event-model", default=os.environ.get("TKO_EVENT_MODEL", ""))
    parser.add_argument("--model-timeout", type=int, default=600)
    parser.add_argument("--cloud-review", action="store_true")
    parser.add_argument("--cloud-project", default=os.environ.get("GOOGLE_CLOUD_PROJECT", "reelone-498406"))
    parser.add_argument("--cloud-location", default=os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1"))
    parser.add_argument("--cloud-model", default=os.environ.get("TKO_CLOUD_REVIEW_MODEL", "gemini-2.5-flash"))
    parser.add_argument("--api-base", default=os.environ.get("TKO_API_BASE", "https://tko.cam"))
    parser.add_argument("--service-key", default=os.environ.get("TKO_SERVICE_KEY", ""))
    parser.add_argument("--no-post", action="store_true", help="Keep results local even when a service key exists")
    parser.add_argument("--refresh", action="store_true", help="Ignore unchanged-footage cache")
    parser.add_argument("--watch-seconds", type=int, default=0, help="Continuously rescan at this interval")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    args.confirmed = args.confirmed.resolve()
    args.source_dir = args.source_dir.resolve()
    args.output_dir = args.output_dir.resolve()
    if not args.confirmed.exists():
        raise SystemExit(f"confirmed match file not found: {args.confirmed}")
    ffmpeg = find_ffmpeg()
    print(f"ffmpeg={ffmpeg}", flush=True)
    while True:
        run_once(args, ffmpeg)
        if args.watch_seconds <= 0:
            break
        delay = max(30, args.watch_seconds)
        print(f"Watching for new confirmed footage; next scan in {delay}s", flush=True)
        time.sleep(delay)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
