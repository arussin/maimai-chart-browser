# ruff: noqa: E501 -- Long lines retain readable review statements.
"""Write a pages-capacity-review-1 folder from automated checks.

    python -B write_capacity_review.py HOSTING_CHECK.json LIVE_RELEASE_FOLDER OUTPUT_FOLDER

Adam decided on November 22, 2026 to replace the hand-gathered capacity paperwork
with checks that can be run: the Cloudflare API confirms the plan and the Pages
upload setting, and the release that is live today already holds more than
20,000 files. The library still requires a review with three evidence files and
a price, so this writes them from those checks and says plainly what each one
is. The monthly price is not readable through the API; it is carried from the
last owner-reviewed evidence and labelled as such. A release uploads files and
changes no plan.
"""

import hashlib
import json
import os
import sys
from datetime import UTC, datetime

hosting_path, live_release, output = sys.argv[1], sys.argv[2], sys.argv[3]
if os.path.exists(output):
    raise SystemExit("Refusing to overwrite " + output)
with open(hosting_path, encoding="utf-8") as stream:
    hosting = json.load(stream)
observed = datetime.fromisoformat(hosting["observed_at"].replace("Z", "+00:00"))
now = datetime.now(UTC)
if not 0 <= (now - observed).total_seconds() <= 3600:
    raise SystemExit("Refresh the hosting check; maximum age is one hour")
if hosting.get("schema") != "maimai-hosting-check-1" or hosting.get("project") != "maimai-party":
    raise SystemExit("Unexpected hosting check")
if hosting.get("zone_plan") != "Pro Website" or hosting.get("pages_wrangler_major_version") != "4":
    raise SystemExit("The plan or the Pages upload setting no longer permits a large release")
with open(os.path.join(live_release, "deployment.json"), encoding="utf-8") as stream:
    deployment = json.load(stream)
if deployment["site"]["production_deployment"] != hosting["production_deployment"]:
    raise SystemExit("Production is not the release recorded in the live release folder")
files = deployment["site"]["files"]
if files <= 20_000:
    raise SystemExit("The live release does not demonstrate capacity above the default")

os.makedirs(output)


def write(name, value):
    raw = (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    with open(os.path.join(output, name), "xb") as stream:
        stream.write(raw)
    return {"path": name, "sha256": hashlib.sha256(raw).hexdigest()}


entitlement = write(
    "entitlement.json",
    {
        "schema": "maimai-capacity-entitlement-automated-1",
        "basis": "Read from the Cloudflare API, plus the release that is in production now.",
        "hosting_check": hosting,
        "demonstrated": {
            "production_deployment": hosting["production_deployment"],
            "files_in_production": files,
            "meaning": "Cloudflare accepted and serves this deployment, so the account's limit is above 20,000 files.",
        },
        "requested_profile": "pages-paid-100000",
    },
)
cost = write(
    "cost.json",
    {
        "schema": "maimai-capacity-cost-automated-1",
        "plan_confirmed_by_api": hosting["zone_plan"],
        "price": {"amount": 25, "currency": "USD", "interval": "month"},
        "price_basis": "Not readable through the API with the available access. Carried from the owner-reviewed "
        "evidence of October 20, 2026 (invoice-backed, Cloudflare Pro Plan for maimai.party). "
        "Not re-read today.",
        "effect_of_this_release_on_cost": "None. A release uploads files to an existing Pages project; it does not "
        "change the plan, add a product or exceed a metered allowance.",
    },
)
upload = write(
    "upload.json",
    {
        "schema": "maimai-capacity-upload-automated-1",
        "method": "wrangler-direct-upload-v4",
        "uploader": deployment["site"]["uploader"],
        "last_production_upload": {
            "deployment": deployment["site"]["production_deployment"],
            "released_at": deployment["released_at"],
            "files": files,
        },
    },
)
review_raw = (
    json.dumps(
        {
            "schema_version": "pages-capacity-review-1",
            "profile": "pages-paid-100000",
            "account_id": hosting["account_id"],
            "project": hosting["project"],
            "plan": "pro",
            "verified_at": hosting["observed_at"].replace("Z", "+00:00"),
            "billing": {"amount": 25, "currency": "USD", "interval": "month"},
            "upload_method": "wrangler-direct-upload-v4",
            "evidence": {"entitlement": entitlement, "cost": cost, "upload_method": upload},
        },
        indent=2,
    )
    + "\n"
).encode("utf-8")
with open(os.path.join(output, "review.json"), "xb") as stream:
    stream.write(review_raw)
print(
    json.dumps(
        {
            "review": os.path.join(output, "review.json"),
            "sha256": hashlib.sha256(review_raw).hexdigest(),
        }
    )
)
