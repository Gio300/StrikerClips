from __future__ import annotations

import argparse
import base64
import json
import re
import subprocess
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cv2
import requests


PIPELINE_ROOT = Path(r"C:\Users\Flying Phoenix PCs\Desktop\killcam_clips")
DEFAULT_OUTPUT = PIPELINE_ROOT / "shadow_results" / "hammy_member_ledger"
KO_TEMPLATE_ROOT = PIPELINE_ROOT / "shinobi_50_kills"
RIVAL_REFERENCE = (
    PIPELINE_ROOT
    / "shadow_results"
    / "hammy_review"
    / "deaths"
    / "BE_509.jpg"
)
FFMPEG = Path(
    r"C:\Users\Flying Phoenix PCs\AppData\Local\Programs\Python\Python312"
    r"\Lib\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe"
)


@dataclass(frozen=True)
class MatchWindow:
    video_id: str
    start: float
    end: float
    note: str


# These are Survival Exercise / free-for-all windows, where clanmates can be
# opponents. Team modes are intentionally excluded to avoid crediting friendly
# K.O. feed activity as player-vs-player results.
MATCH_WINDOWS = (
    MatchWindow("m0NwMfb2-dA", 1867.0, 2195.0, "FFA with Kissa, Pattern, Jerry"),
    MatchWindow("NBOWwMBwAwk", 299.0, 651.0, "FFA with Pattern"),
    MatchWindow("571xjiVCFXc", 203.0, 587.0, "FFA with Pattern"),
    MatchWindow("jYMESe7ZpIE", 2835.0, 3147.0, "FFA with Pattern"),
    MatchWindow("yskXVD5d18Q", 547.0, 931.0, "FFA with Pattern"),
    MatchWindow("hrmk1sZeLLI", 259.0, 643.0, "FFA with Pattern"),
    MatchWindow("d-TlYiMFGFo", 459.0, 747.0, "reviewed FFA with Pattern"),
    MatchWindow("BE_ZbO5vzCw", 243.0, 563.0, "reviewed FFA with Pattern"),
)


# Account names are TKO usernames; aliases are visible in-game names. Add new
# aliases only after the account owner or linked footage confirms them.
TKO_ACCOUNT_ALIASES = {
    "PatternAfterError": (
        "PatternAft3r",
        "KmH_PatternAft3r",
        "KMHPatternAft3r",
    ),
    "kissatronix": (
        "hyperboleboy",
    ),
    "MrJerry": (
        "Mr_JERRY000",
        "MrJerry000",
    ),
}


# Human-reviewed ground truth for this audit set. These entries are intentionally
# separate from the VLM output: the small local model is useful for triage, but it
# confused jutsu names with gamer tags and over-counted several K.O.s. Production
# scoring should replace this review layer with a matching counterpart camera.
#
# Evidence tiers:
#   single_camera_confirmed - local HUD/nameplate clearly identifies the event.
#   two_camera_verified     - both players' synchronized views identify each other.
#
# No counterpart view was found locally for these events, so none are eligible for
# an official two-camera score yet.
REVIEWED_EVENTS = (
    # Hammy directly K.O.'d a known TKO player.
    ("m0NwMfb2-dA", "ko", 1964.25, "kissatronix", "direct_ko"),
    ("571xjiVCFXc", "ko", 383.50, "PatternAfterError", "direct_ko"),
    ("BE_ZbO5vzCw", "ko", 286.25, "PatternAfterError", "direct_ko"),
    ("d-TlYiMFGFo", "ko", 513.25, "PatternAfterError", "direct_ko"),
    ("hrmk1sZeLLI", "ko", 312.00, "PatternAfterError", "direct_ko"),
    ("NBOWwMBwAwk", "ko", 643.00, "PatternAfterError", "direct_ko"),
    ("yskXVD5d18Q", "ko", 762.75, "PatternAfterError", "direct_ko"),
    ("yskXVD5d18Q", "ko", 804.75, "PatternAfterError", "direct_ko"),
    # Hammy assisted on a known TKO player's K.O.
    ("571xjiVCFXc", "ko", 435.50, "PatternAfterError", "assist"),
    ("BE_ZbO5vzCw", "ko", 350.50, "PatternAfterError", "assist"),
    ("NBOWwMBwAwk", "ko", 406.00, "PatternAfterError", "assist"),
    # A known TKO player directly K.O.'d Hammy.
    ("BE_ZbO5vzCw", "death", 408.50, "PatternAfterError", "death"),
    ("BE_ZbO5vzCw", "death", 509.00, "PatternAfterError", "death"),
    ("d-TlYiMFGFo", "death", 643.50, "PatternAfterError", "death"),
    ("m0NwMfb2-dA", "death", 2009.25, "PatternAfterError", "death"),
    ("m0NwMfb2-dA", "death", 2070.75, "PatternAfterError", "death"),
    ("m0NwMfb2-dA", "death", 2118.25, "PatternAfterError", "death"),
    ("yskXVD5d18Q", "death", 573.50, "PatternAfterError", "death"),
    ("yskXVD5d18Q", "death", 639.25, "PatternAfterError", "death"),
    ("yskXVD5d18Q", "death", 865.50, "PatternAfterError", "death"),
    ("m0NwMfb2-dA", "death", 2192.75, "MrJerry", "death"),
)


REVIEWED_EVENT_LOOKUP = {
    (video_id, kind, round(seconds, 3)): {
        "tko_account": account,
        "classification": classification,
        "evidence_tier": "single_camera_confirmed",
        "official_score_eligible": False,
    }
    for video_id, kind, seconds, account, classification in REVIEWED_EVENTS
}


def normalize_name(value: str | None) -> str:
    return re.sub(r"[^a-z0-9]", "", (value or "").lower())


ALIAS_LOOKUP = {
    normalize_name(alias): account
    for account, aliases in TKO_ACCOUNT_ALIASES.items()
    for alias in aliases
}


def account_for_name(value: str | None) -> str | None:
    normalized = normalize_name(value)
    if not normalized:
        return None
    if normalized in ALIAS_LOOKUP:
        return ALIAS_LOOKUP[normalized]
    for alias, account in ALIAS_LOOKUP.items():
        if len(alias) >= 7 and (alias in normalized or normalized in alias):
            return account
    return None


def resolve_video(root: Path, video_id: str) -> Path:
    exact = root / "tko_auto" / f"xm_{video_id}.mp4"
    if exact.exists():
        return exact
    matches = sorted((root / "tko_auto").glob(f"*{video_id}*.mp4"))
    if not matches:
        raise FileNotFoundError(f"No local video found for {video_id}")
    # Prefer the full source over an already assembled xm-<date> derivative.
    matches.sort(key=lambda path: (path.name.startswith("xm-"), len(path.name)))
    return matches[0]


def ko_descriptors(orb: cv2.ORB) -> list[tuple[str, Any]]:
    samples = {
        "rn": (KO_TEMPLATE_ROOT / "ko_sample_rn.jpg", (365, 45, 545, 155)),
        "uq": (KO_TEMPLATE_ROOT / "ko_sample_uq.jpg", (335, 45, 525, 175)),
        "pog": (KO_TEMPLATE_ROOT / "ko_sample_pog.jpg", (375, 40, 550, 165)),
    }
    descriptors = []
    for name, (path, (x1, y1, x2, y2)) in samples.items():
        image = cv2.imread(str(path))
        if image is None:
            raise FileNotFoundError(path)
        _, descriptor = orb.detectAndCompute(image[y1:y2, x1:x2], None)
        descriptors.append((name, descriptor))
    return descriptors


def rival_template() -> Any:
    reference = cv2.imread(str(RIVAL_REFERENCE))
    if reference is None:
        raise FileNotFoundError(RIVAL_REFERENCE)
    reference = cv2.resize(reference, (640, 360), interpolation=cv2.INTER_AREA)
    text_band = cv2.cvtColor(reference[274:290, 287:358], cv2.COLOR_BGR2GRAY)
    return cv2.Canny(text_band, 60, 160)


def frame_stream(video: Path, start: float, end: float, sample_rate: float):
    command = [
        str(FFMPEG),
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        str(start),
        "-to",
        str(end),
        "-i",
        str(video),
        "-vf",
        f"fps={sample_rate},scale=640:360",
        "-pix_fmt",
        "bgr24",
        "-f",
        "rawvideo",
        "pipe:1",
    ]
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert process.stdout is not None
    frame_size = 640 * 360 * 3
    index = 0
    try:
        while True:
            data = process.stdout.read(frame_size)
            if len(data) != frame_size:
                break
            frame = __import__("numpy").frombuffer(data, dtype="uint8").reshape((360, 640, 3))
            yield start + (index / sample_rate), frame
            index += 1
    finally:
        process.stdout.close()
        stderr = process.stderr.read().decode("utf-8", errors="replace") if process.stderr else ""
        return_code = process.wait()
        if return_code:
            raise RuntimeError(f"ffmpeg failed for {video.name}: {stderr.strip()}")


def group_peaks(hits: list[dict[str, Any]], gap: float) -> list[dict[str, Any]]:
    groups: list[list[dict[str, Any]]] = []
    for hit in hits:
        if not groups or hit["seconds"] - groups[-1][-1]["seconds"] > gap:
            groups.append([hit])
        else:
            groups[-1].append(hit)
    return [max(group, key=lambda item: item["score"]) for group in groups]


def scan_window(
    video: Path,
    window: MatchWindow,
    orb: cv2.ORB,
    references: list[tuple[str, Any]],
    rival: Any,
    sample_rate: float,
    ko_threshold: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    matcher = cv2.BFMatcher(cv2.NORM_HAMMING)
    ko_hits: list[dict[str, Any]] = []
    rival_hits: list[dict[str, Any]] = []

    for seconds, frame in frame_stream(video, window.start, window.end, sample_rate):
        _, descriptor = orb.detectAndCompute(frame, None)
        if descriptor is not None:
            scores = {}
            for name, template in references:
                pairs = matcher.knnMatch(template, descriptor, k=2)
                scores[name] = len(
                    [
                        pair[0]
                        for pair in pairs
                        if len(pair) == 2 and pair[0].distance < 0.76 * pair[1].distance
                    ]
                )
            score = max(scores.values())
            if score >= ko_threshold:
                ko_hits.append(
                    {
                        "seconds": round(seconds, 3),
                        "score": score,
                        "scores": scores,
                    }
                )

        roi = cv2.cvtColor(frame[255:310, 250:400], cv2.COLOR_BGR2GRAY)
        roi = cv2.Canny(roi, 60, 160)
        score = float(cv2.matchTemplate(roi, rival, cv2.TM_CCOEFF_NORMED).max())
        if score >= 0.40:
            rival_hits.append({"seconds": round(seconds, 3), "score": round(score, 4)})

    return group_peaks(ko_hits, 1.75), group_peaks(rival_hits, 7.0)


def extract_frame(video: Path, seconds: float, output: Path) -> Path:
    output.parent.mkdir(parents=True, exist_ok=True)
    capture = cv2.VideoCapture(str(video))
    capture.set(cv2.CAP_PROP_POS_MSEC, max(0.0, seconds) * 1000.0)
    ok, frame = capture.read()
    capture.release()
    if not ok:
        raise RuntimeError(f"Could not extract {video.name} at {seconds:.3f}s")
    cv2.imwrite(str(output), frame, [cv2.IMWRITE_JPEG_QUALITY, 94])
    return output


def parse_json_response(content: str) -> dict[str, Any]:
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", content, re.DOTALL)
    candidate = fenced.group(1) if fenced else content
    start = candidate.find("{")
    end = candidate.rfind("}")
    if start < 0 or end < start:
        return {"raw": content, "parse_error": True}
    try:
        parsed = json.loads(candidate[start : end + 1])
        parsed["raw"] = content
        return parsed
    except json.JSONDecodeError:
        return {"raw": content, "parse_error": True}


def ollama_image(model: str, image: Path, prompt: str) -> dict[str, Any]:
    body = {
        "model": model,
        "stream": False,
        "options": {"temperature": 0},
        "messages": [
            {
                "role": "user",
                "content": prompt,
                "images": [base64.b64encode(image.read_bytes()).decode("ascii")],
            }
        ],
    }
    response = requests.post("http://127.0.0.1:11434/api/chat", json=body, timeout=120)
    response.raise_for_status()
    return parse_json_response(response.json()["message"]["content"])


def analyze_event(
    model: str,
    image: Path,
    kind: str,
    cache: Path,
    use_vlm: bool,
) -> dict[str, Any]:
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    if not use_vlm:
        return {}

    if kind == "ko":
        prompt = (
            "This is a Naruto to Boruto: Shinobi Striker Survival Exercise screenshot "
            "from Hammy's local camera at the instant a K.O. graphic appeared. Read only "
            "what is visibly present. Return JSON only with keys ko_visible (boolean), "
            "assist_visible (boolean), victim_name (exact red name in the top-right kill "
            "feed, or null), points_awarded (number or null), confidence (0 to 1), and "
            "notes. A large 'Assist +10' means Hammy assisted and did not earn a direct "
            "K.O. Do not infer a name from the leaderboard. Known TKO aliases that may "
            "appear are KmH_PatternAft3r / PatternAft3r, hyperboleboy, and Mr_JERRY000."
        )
    else:
        prompt = (
            "This is a Naruto to Boruto: Shinobi Striker Rival Camera screenshot after "
            "Hammy's local character was knocked out. Return JSON only with keys "
            "rival_camera_visible (boolean), attacker_name (the exact name centered near "
            "the bottom under Rival Camera, or null), confidence (0 to 1), and notes. "
            "Do not use the leaderboard or kill feed to guess. Known TKO aliases that may "
            "appear are KmH_PatternAft3r / PatternAft3r, hyperboleboy, and Mr_JERRY000."
        )
    result = ollama_image(model, image, prompt)
    cache.write_text(json.dumps(result, indent=2), encoding="utf-8")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit Hammy head-to-head events against TKO users")
    parser.add_argument("--root", type=Path, default=PIPELINE_ROOT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--model", default="qwen2.5vl:7b")
    parser.add_argument("--sample-rate", type=float, default=4.0)
    parser.add_argument("--ko-threshold", type=int, default=15)
    parser.add_argument("--no-vlm", action="store_true")
    args = parser.parse_args()

    if not FFMPEG.exists():
        raise FileNotFoundError(FFMPEG)
    args.output.mkdir(parents=True, exist_ok=True)
    evidence_dir = args.output / "evidence"
    cache_dir = args.output / "analysis"
    cache_dir.mkdir(parents=True, exist_ok=True)

    orb = cv2.ORB_create(nfeatures=1000, scaleFactor=1.1, nlevels=12, fastThreshold=10)
    references = ko_descriptors(orb)
    rival = rival_template()
    windows_output: list[dict[str, Any]] = []

    for window in MATCH_WINDOWS:
        video = resolve_video(args.root, window.video_id)
        print(f"Scanning {window.video_id} {window.start:.0f}-{window.end:.0f}s", flush=True)
        ko_events, death_events = scan_window(
            video,
            window,
            orb,
            references,
            rival,
            args.sample_rate,
            args.ko_threshold,
        )

        for index, event in enumerate(ko_events, start=1):
            stem = f"{window.video_id}_ko_{index:02d}_{event['seconds']:.3f}".replace(".", "p")
            image = extract_frame(video, event["seconds"], evidence_dir / f"{stem}.jpg")
            analysis = analyze_event(
                args.model,
                image,
                "ko",
                cache_dir / f"{stem}.json",
                not args.no_vlm,
            )
            event["image"] = str(image)
            event["analysis"] = analysis
            event["model_tko_account"] = account_for_name(analysis.get("victim_name"))
            event["model_classification"] = (
                "assist" if analysis.get("assist_visible") else "direct_ko"
            )
            reviewed = REVIEWED_EVENT_LOOKUP.get(
                (window.video_id, "ko", round(event["seconds"], 3))
            )
            event["review_status"] = "reviewed" if reviewed else "model_candidate"
            if reviewed:
                event.update(reviewed)
            else:
                event["tko_account"] = None
                event["classification"] = "unreviewed"
                event["evidence_tier"] = "candidate_only"
                event["official_score_eligible"] = False

        for index, event in enumerate(death_events, start=1):
            stem = f"{window.video_id}_death_{index:02d}_{event['seconds']:.3f}".replace(".", "p")
            image = extract_frame(video, event["seconds"], evidence_dir / f"{stem}.jpg")
            analysis = analyze_event(
                args.model,
                image,
                "death",
                cache_dir / f"{stem}.json",
                not args.no_vlm,
            )
            event["image"] = str(image)
            event["analysis"] = analysis
            event["model_tko_account"] = account_for_name(analysis.get("attacker_name"))
            event["model_classification"] = "death"
            reviewed = REVIEWED_EVENT_LOOKUP.get(
                (window.video_id, "death", round(event["seconds"], 3))
            )
            event["review_status"] = "reviewed" if reviewed else "model_candidate"
            if reviewed:
                event.update(reviewed)
            else:
                event["tko_account"] = None
                event["classification"] = "unreviewed"
                event["evidence_tier"] = "candidate_only"
                event["official_score_eligible"] = False

        windows_output.append(
            {
                "video_id": window.video_id,
                "source": str(video),
                "start": window.start,
                "end": window.end,
                "note": window.note,
                "ko_events": ko_events,
                "death_events": death_events,
            }
        )
        print(f"  {len(ko_events)} K.O. graphics, {len(death_events)} deaths", flush=True)

    totals: dict[str, dict[str, int]] = defaultdict(
        lambda: {"direct_kos_by_hammy": 0, "assists_by_hammy": 0, "kos_against_hammy": 0}
    )
    reviewed_events = []
    for window in windows_output:
        for event in window["ko_events"]:
            account = event.get("tko_account")
            if not account or event.get("analysis", {}).get("ko_visible") is False:
                continue
            field = "assists_by_hammy" if event["classification"] == "assist" else "direct_kos_by_hammy"
            totals[account][field] += 1
            reviewed_events.append({"video_id": window["video_id"], **event})
        for event in window["death_events"]:
            account = event.get("tko_account")
            if not account or event.get("analysis", {}).get("rival_camera_visible") is False:
                continue
            totals[account]["kos_against_hammy"] += 1
            reviewed_events.append({"video_id": window["video_id"], **event})

    two_camera_totals = {
        account: {
            "direct_kos_by_hammy": 0,
            "assists_by_hammy": 0,
            "kos_against_hammy": 0,
        }
        for account in totals
    }

    ledger = {
        "subject": "Hammy",
        "method": (
            "shadow audit; reviewed single-camera HUD evidence only; no rankings or "
            "production records changed"
        ),
        "tko_aliases": TKO_ACCOUNT_ALIASES,
        "single_camera_confirmed_totals": dict(totals),
        "two_camera_verified_totals": two_camera_totals,
        "official_scoring_applied": False,
        "reviewed_events": reviewed_events,
        "windows": windows_output,
    }
    output = args.output / "hammy_tko_interactions.json"
    output.write_text(json.dumps(ledger, indent=2), encoding="utf-8")
    print(json.dumps(ledger["single_camera_confirmed_totals"], indent=2))
    print(f"Wrote {output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
