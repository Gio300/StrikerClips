"""Synchronize TKO.cam App Store Connect metadata, build, and screenshots."""

from __future__ import annotations

import argparse
import hashlib
import os
import time
from pathlib import Path

import requests
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

try:
    import jwt
except ImportError as exc:  # pragma: no cover - local release utility
    raise SystemExit("PyJWT is required: python -m pip install pyjwt") from exc


ROOT = Path(__file__).resolve().parents[1]
API_ROOT = "https://api.appstoreconnect.apple.com"
APP_ID = "6795941498"
VERSION_ID = "de84f629-17cf-4556-a3bc-bd884437cc20"
BUILD_ID = "abe637a9-d159-43ce-80b7-38b594bcd47a"
ISSUER_ID = "c9709465-2503-4b4d-9ec0-bbc5a7d75b23"
KEY_ID = "BSQT6HB6B7"
PRIVATE_KEY_PATH = Path(
    r"C:\Users\Flying Phoenix PCs\Documents\keys_boi\tko_app_store\AuthKey_BSQT6HB6B7.p8"
)

DESCRIPTION = """TKO.cam brings competitive gaming clips, multi-angle highlight creation, live match rooms, rankings, tournaments, clans, and predictions into one mobile home.

Build a reel from your own gameplay links, find clips by describing the moment, or combine different players' camera angles into one synchronized highlight. Explore community reels, follow competitive activity, enter self-scheduled ladder matches, and connect with other players.

Core features:

• Create highlight reels from one or more gameplay clips
• Organize multiple player perspectives into multi-angle videos
• Discover and search community-created reels
• Join competitive ladders, tournaments, and clan activity
• Follow rankings and submit match results
• Make free, cosmetic-only predictions with no cash prizes or wagering
• Control your profile, privacy, blocks, and account deletion from the app

TKO.cam is a community platform for user-submitted gaming footage. Community content is subject to moderation, reporting, blocking, and the TKO.cam Terms of Service. TKO.cam is not affiliated with or endorsed by any game publisher."""

PROMOTIONAL_TEXT = (
    "Turn separate gameplay clips into shareable multi-angle highlights, discover "
    "competitive reels, and stay connected to tournaments, rankings, and clans."
)

WHATS_NEW = (
    "Welcome to TKO.cam on mobile. Create multi-angle highlights, discover "
    "competitive reels, follow ladders and rankings, join community activity, "
    "and manage your profile from one app."
)

REVIEW_NOTES = """TKO.cam is a user-generated competitive gaming highlights platform.

The mobile store build does not sell digital tokens, subscriptions, tips, or digital marketplace items. Existing account entitlements remain usable after sign-in.

Oracle predictions are free, cosmetic-only, and never award cash or cash-equivalent value. Wagering endpoints are retired and fail closed.

Users can report or block community content and delete their account in the app. Demo videos are streamed from https://tko.cam and are not bundled in the binary."""

SCREENSHOT_GROUPS = {
    "APP_IPHONE_67": ROOT / "store-assets" / "screenshots" / "apple-iphone-6.9",
    "APP_IPAD_PRO_3GEN_129": ROOT / "store-assets" / "screenshots" / "apple-ipad-13",
}


class AppStoreConnect:
    def __init__(self) -> None:
        private_key = serialization.load_pem_private_key(
            PRIVATE_KEY_PATH.read_bytes(), password=None
        )
        if not isinstance(private_key, ec.EllipticCurvePrivateKey):
            raise TypeError("App Store Connect key is not an EC private key")
        now = int(time.time())
        token = jwt.encode(
            {"iss": ISSUER_ID, "iat": now - 10, "exp": now + 900, "aud": "appstoreconnect-v1"},
            private_key,
            algorithm="ES256",
            headers={"kid": KEY_ID, "typ": "JWT"},
        )
        self.session = requests.Session()
        self.session.headers.update(
            {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        )

    def request(self, method: str, path: str, **kwargs):
        response = self.session.request(
            method, f"{API_ROOT}{path}", timeout=120, **kwargs
        )
        if response.status_code >= 400:
            try:
                details = response.json()
            except ValueError:
                details = response.text
            raise RuntimeError(
                f"{method} {path} failed ({response.status_code}): {details}"
            )
        if response.status_code == 204 or not response.content:
            return None
        return response.json()


def resource(resource_type: str, resource_id: str, attributes: dict) -> dict:
    return {
        "data": {
            "type": resource_type,
            "id": resource_id,
            "attributes": attributes,
        }
    }


def sync_localizations(api: AppStoreConnect) -> str:
    version_localizations = api.request(
        "GET", f"/v1/appStoreVersions/{VERSION_ID}/appStoreVersionLocalizations"
    )["data"]
    localization = next(
        (item for item in version_localizations if item["attributes"]["locale"] == "en-US"),
        None,
    )
    attributes = {
        "description": DESCRIPTION,
        "keywords": "gaming,highlights,esports,tournaments,clips,streaming,clans,rankings,reels,creator",
        "marketingUrl": "https://tko.cam",
        "promotionalText": PROMOTIONAL_TEXT,
        "supportUrl": "https://tko.cam/help",
    }
    if localization:
        localization_id = localization["id"]
        api.request(
            "PATCH",
            f"/v1/appStoreVersionLocalizations/{localization_id}",
            json=resource("appStoreVersionLocalizations", localization_id, attributes),
        )
    else:
        payload = {
            "data": {
                "type": "appStoreVersionLocalizations",
                "attributes": {"locale": "en-US", **attributes},
                "relationships": {
                    "appStoreVersion": {
                        "data": {"type": "appStoreVersions", "id": VERSION_ID}
                    }
                },
            }
        }
        localization_id = api.request(
            "POST", "/v1/appStoreVersionLocalizations", json=payload
        )["data"]["id"]

    app_infos = api.request("GET", f"/v1/apps/{APP_ID}/appInfos")["data"]
    if not app_infos:
        raise RuntimeError("No App Info resource exists for TKO.cam")
    app_info_id = app_infos[0]["id"]
    app_info_localizations = api.request(
        "GET", f"/v1/appInfos/{app_info_id}/appInfoLocalizations"
    )["data"]
    app_info_localization = next(
        (
            item
            for item in app_info_localizations
            if item["attributes"]["locale"] == "en-US"
        ),
        None,
    )
    info_attributes = {
        "subtitle": "Competitive gaming highlights",
        "privacyPolicyUrl": "https://tko.cam/privacy",
    }
    if app_info_localization:
        info_id = app_info_localization["id"]
        api.request(
            "PATCH",
            f"/v1/appInfoLocalizations/{info_id}",
            json=resource("appInfoLocalizations", info_id, info_attributes),
        )
    else:
        payload = {
            "data": {
                "type": "appInfoLocalizations",
                "attributes": {"locale": "en-US", **info_attributes},
                "relationships": {
                    "appInfo": {"data": {"type": "appInfos", "id": app_info_id}}
                },
            }
        }
        api.request("POST", "/v1/appInfoLocalizations", json=payload)
    return localization_id


def sync_version_and_build(api: AppStoreConnect) -> None:
    api.request(
        "PATCH",
        f"/v1/appStoreVersions/{VERSION_ID}",
        json=resource(
            "appStoreVersions",
            VERSION_ID,
            {"copyright": "2026 NV Care Solutions Inc", "releaseType": "MANUAL"},
        ),
    )
    build = api.request(
        "GET",
        f"/v1/builds/{BUILD_ID}?fields[builds]=version,processingState,expired,usesNonExemptEncryption",
    )["data"]
    attrs = build["attributes"]
    if attrs.get("processingState") != "VALID" or attrs.get("expired"):
        raise RuntimeError(f"Build is not eligible for submission: {attrs}")
    api.request(
        "PATCH",
        f"/v1/appStoreVersions/{VERSION_ID}/relationships/build",
        json={"data": {"type": "builds", "id": BUILD_ID}},
    )


def screenshot_set(api: AppStoreConnect, localization_id: str, display_type: str) -> str:
    sets = api.request(
        "GET",
        f"/v1/appStoreVersionLocalizations/{localization_id}/appScreenshotSets",
    )["data"]
    matching_set = next(
        (
            item
            for item in sets
            if item["attributes"].get("screenshotDisplayType") == display_type
        ),
        None,
    )
    if matching_set:
        return matching_set["id"]
    payload = {
        "data": {
            "type": "appScreenshotSets",
            "attributes": {"screenshotDisplayType": display_type},
            "relationships": {
                "appStoreVersionLocalization": {
                    "data": {
                        "type": "appStoreVersionLocalizations",
                        "id": localization_id,
                    }
                }
            },
        }
    }
    return api.request("POST", "/v1/appScreenshotSets", json=payload)["data"]["id"]


def upload_screenshot(api: AppStoreConnect, screenshot_set_id: str, file_path: Path) -> str:
    raw = file_path.read_bytes()
    payload = {
        "data": {
            "type": "appScreenshots",
            "attributes": {"fileSize": len(raw), "fileName": file_path.name},
            "relationships": {
                "appScreenshotSet": {
                    "data": {"type": "appScreenshotSets", "id": screenshot_set_id}
                }
            },
        }
    }
    reservation = api.request("POST", "/v1/appScreenshots", json=payload)["data"]
    for operation in reservation["attributes"]["uploadOperations"]:
        start = operation["offset"]
        end = start + operation["length"]
        headers = {
            item["name"]: item["value"]
            for item in operation.get("requestHeaders", [])
        }
        response = requests.request(
            operation["method"],
            operation["url"],
            headers=headers,
            data=raw[start:end],
            timeout=120,
        )
        response.raise_for_status()
    api.request(
        "PATCH",
        f"/v1/appScreenshots/{reservation['id']}",
        json=resource(
            "appScreenshots",
            reservation["id"],
            {
                "uploaded": True,
                "sourceFileChecksum": hashlib.md5(raw).hexdigest(),
            },
        ),
    )
    return reservation["id"]


def sync_screenshots(api: AppStoreConnect, localization_id: str) -> None:
    for display_type, directory in SCREENSHOT_GROUPS.items():
        files = sorted(directory.glob("*.png"))
        if len(files) < 1:
            raise RuntimeError(f"No screenshots found for {display_type}")
        set_id = screenshot_set(api, localization_id, display_type)
        existing = api.request(
            "GET", f"/v1/appScreenshotSets/{set_id}/appScreenshots"
        )["data"]
        existing_names = {item["attributes"]["fileName"] for item in existing}
        for file_path in files:
            if file_path.name in existing_names:
                print(f"Screenshot already present: {display_type}/{file_path.name}")
                continue
            screenshot_id = upload_screenshot(api, set_id, file_path)
            print(f"Uploaded screenshot: {display_type}/{file_path.name} ({screenshot_id})")

    deadline = time.time() + 240
    while time.time() < deadline:
        states = []
        for display_type, _directory in SCREENSHOT_GROUPS.items():
            set_id = screenshot_set(api, localization_id, display_type)
            items = api.request(
                "GET", f"/v1/appScreenshotSets/{set_id}/appScreenshots"
            )["data"]
            states.extend(
                item["attributes"].get("assetDeliveryState", {}).get("state")
                for item in items
            )
        if states and all(state == "COMPLETE" for state in states):
            print(f"All {len(states)} Apple screenshots processed successfully.")
            return
        if any(state == "FAILED" for state in states):
            raise RuntimeError(f"Apple screenshot processing failed: {states}")
        time.sleep(5)
    raise TimeoutError("Apple screenshots did not finish processing within four minutes")


def sync_review_details(api: AppStoreConnect) -> None:
    review_email = os.environ.get("TKO_REVIEW_EMAIL")
    review_password = os.environ.get("TKO_REVIEW_PASSWORD")
    review_phone = os.environ.get("TKO_REVIEW_PHONE")
    if not all([review_email, review_password, review_phone]):
        print("Review details skipped: TKO_REVIEW_EMAIL/PASSWORD/PHONE are not all set.")
        return
    attributes = {
        "contactFirstName": "Kissa",
        "contactLastName": "Aledo",
        "contactPhone": review_phone,
        "contactEmail": review_email,
        "demoAccountRequired": True,
        "demoAccountName": review_email,
        "demoAccountPassword": review_password,
        "notes": REVIEW_NOTES,
    }
    try:
        existing = api.request(
            "GET", f"/v1/appStoreVersions/{VERSION_ID}/appStoreReviewDetail"
        )["data"]
    except RuntimeError as exc:
        if "(404)" not in str(exc):
            raise
        existing = None
    if existing:
        api.request(
            "PATCH",
            f"/v1/appStoreReviewDetails/{existing['id']}",
            json=resource("appStoreReviewDetails", existing["id"], attributes),
        )
    else:
        payload = {
            "data": {
                "type": "appStoreReviewDetails",
                "attributes": attributes,
                "relationships": {
                    "appStoreVersion": {
                        "data": {"type": "appStoreVersions", "id": VERSION_ID}
                    }
                },
            }
        }
        api.request("POST", "/v1/appStoreReviewDetails", json=payload)
    print("App Review account and notes synchronized.")


def audit(api: AppStoreConnect, localization_id: str) -> None:
    localization = api.request(
        "GET", f"/v1/appStoreVersionLocalizations/{localization_id}"
    )["data"]["attributes"]
    build = api.request(
        "GET", f"/v1/appStoreVersions/{VERSION_ID}/relationships/build"
    )["data"]
    screenshot_counts = {}
    for display_type in SCREENSHOT_GROUPS:
        set_id = screenshot_set(api, localization_id, display_type)
        screenshot_counts[display_type] = len(
            api.request("GET", f"/v1/appScreenshotSets/{set_id}/appScreenshots")[
                "data"
            ]
        )
    print(
        "Apple audit:",
        {
            "locale": localization.get("locale"),
            "description": bool(localization.get("description")),
            "supportUrl": localization.get("supportUrl"),
            "buildAttached": build["id"] if build else None,
            "screenshots": screenshot_counts,
        },
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--skip-screenshots", action="store_true", help="Only update metadata/build"
    )
    args = parser.parse_args()

    api = AppStoreConnect()
    localization_id = sync_localizations(api)
    sync_version_and_build(api)
    if not args.skip_screenshots:
        sync_screenshots(api, localization_id)
    sync_review_details(api)
    audit(api, localization_id)


if __name__ == "__main__":
    main()
