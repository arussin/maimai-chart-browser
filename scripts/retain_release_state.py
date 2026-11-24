"""Write one retained archive of a published release's state.

The next publication is built over the previous one, so its ``public`` tree,
``planner-input``, inventory and receipts must survive a cache cleanup. Run after
a release is live:

    python -B scripts/retain_release_state.py RELEASE TARGET.zip [EXTRA ...] [--root CACHE]

Both interface and data releases require ``planner-input``. Backfill older data
releases before archiving. For future catalog updates, also pass the update run's
``browser``, ``package``, ``registry`` and receipts as extras; leave out the run's
``public``, which the release folder already holds.

Paths in the archive are relative to the cache root, by default the maimai
registry cache on the owner's PC. Uploader caches are left out. It refuses to
overwrite an existing archive.
"""

import argparse
import hashlib
import json
import os
import zipfile

ROOT = r"C:\DevCache\projects\maimai-chart-browser-registry"
SKIP = {".wrangler", "cache", "node_modules"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("release")
    parser.add_argument("target")
    parser.add_argument("extras", nargs="*")
    parser.add_argument("--root", default=ROOT, help="Folder that archive paths are relative to")
    args = parser.parse_args()
    release, target, extras, root = (
        args.release,
        args.target,
        args.extras,
        os.path.abspath(args.root),
    )
    if os.path.exists(target):
        raise SystemExit("Refusing to overwrite " + target)
    for required in ("public", "inventory.json.gz", "preparation.json", "deployment.json"):
        if not os.path.exists(os.path.join(release, required)):
            raise SystemExit("Not a complete release folder; missing " + required)
    if not os.path.isdir(os.path.join(release, "planner-input")):
        raise SystemExit("Not a complete release folder; missing planner-input")
    partial = target + ".partial"
    count = total = 0
    inventory = hashlib.sha256()
    with zipfile.ZipFile(
        partial, "w", zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True
    ) as archive:
        for top in [release, *extras]:
            top = os.path.abspath(top)
            if not top.startswith(root + os.sep):
                raise SystemExit("Outside the cache root: " + top)
            walk = (
                [(os.path.dirname(top), [], [os.path.basename(top)])]
                if os.path.isfile(top)
                else os.walk(top)
            )
            for folder, folders, names in walk:
                folders[:] = sorted(name for name in folders if name not in SKIP)
                for name in sorted(names):
                    path = os.path.join(folder, name)
                    relative = os.path.relpath(path, root).replace(os.sep, "/")
                    with open(path, "rb") as stream:
                        data = stream.read()
                    archive.writestr(
                        zipfile.ZipInfo.from_file(path, relative), data, zipfile.ZIP_DEFLATED, 6
                    )
                    inventory.update(
                        (relative + "\0" + hashlib.sha256(data).hexdigest() + "\n").encode()
                    )
                    count += 1
                    total += len(data)
    with zipfile.ZipFile(partial) as archive:
        problem = archive.testzip()
    if problem:
        raise SystemExit("Archive check failed at " + problem)
    os.replace(partial, target)
    digest = hashlib.sha256()
    with open(target, "rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    print(
        json.dumps(
            {
                "archive": target,
                "files": count,
                "bytes": total,
                "archive_bytes": os.path.getsize(target),
                "archive_sha256": digest.hexdigest(),
                "inventory_sha256": inventory.hexdigest(),
            }
        )
    )


if __name__ == "__main__":
    main()
