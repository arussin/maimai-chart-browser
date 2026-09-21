import hashlib
import json
import shutil
import subprocess
import tempfile
import unittest
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from importlib.resources import files
from pathlib import Path
from unittest.mock import patch

from maimai_intelligence.public_release import PUBLIC_FILES, build_public_release
from maimai_intelligence.registry import empty
from maimai_intelligence.registry_catalog import project_registry
from maimai_intelligence.snapshots import atomic_json, canonical, read_json
from tests.registry_fixture import admit, official_row


class PublicReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source, self.output = self.root / "accepted", self.root / "public"
        self.source.mkdir()
        for name in PUBLIC_FILES:
            (self.source / name).write_text("catalog-parts/ maimaiCatalogDetails", encoding="utf-8")
        (self.source / "index.html").write_text(
            "<!doctype html><html><head><title>maimai.party</title></head>"
            '<body><h1>Find a chart</h1><div id="songs"></div></body></html>',
            encoding="utf-8",
        )
        self.raw = canonical({"package": {"status": "research_preview"}, "catalog": ["日本語"]})
        self.sha = hashlib.sha256(self.raw).hexdigest()
        self.path = f"catalogs/{self.sha}.json"
        (self.source / "catalogs").mkdir()
        (self.source / self.path).write_bytes(self.raw)
        self.manifest = {
            "schema_version": "1.0.0",
            "default": "accepted-v1",
            "releases": [{"version": "accepted-v1", "path": self.path, "sha256": self.sha}],
        }
        atomic_json(self.source / "manifest.json", self.manifest)

    def test_exact_catalog_bytes_and_only_allowlisted_assets_survive(self):
        (self.source / "personal.json").write_text("PRIVATE", encoding="utf-8")
        (self.source / "raw-response.json").write_text("PRIVATE", encoding="utf-8")
        with patch("maimai_intelligence.public_release.PART_BYTES", 31):
            result = build_public_release(self.source, self.output)
        manifest = read_json(self.output / "manifest.json")
        entry = manifest["releases"][0]
        self.assertEqual(manifest["schema_version"], "1.2.0")
        self.assertEqual(entry["sha256"], self.sha)
        self.assertGreater(len(entry["parts"]), 1)
        self.assertEqual(
            b"".join((self.output / p["path"]).read_bytes() for p in entry["parts"]), self.raw
        )
        self.assertEqual(result["catalogs"], 1)
        self.assertFalse((self.output / "personal.json").exists())
        self.assertFalse((self.output / "raw-response.json").exists())
        self.assertFalse((self.output / "catalogs").exists())
        self.assertIn(
            "Permissions-Policy: payment=(self "
            '"https://checkout.stripe.com" "https://js.stripe.com" "https://hooks.stripe.com")',
            (self.output / "_headers").read_text("utf-8"),
        )
        self.assertIn(
            "location.search+location.hash", (self.output / "lab-redirect.js").read_text("utf-8")
        )

    def test_old_versions_and_default_are_preserved(self):
        self.manifest["releases"].append({**self.manifest["releases"][0], "version": "older"})
        atomic_json(self.source / "manifest.json", self.manifest)
        build_public_release(self.source, self.output)
        manifest = read_json(self.output / "manifest.json")
        self.assertEqual(manifest["default"], "accepted-v1")
        self.assertEqual([r["version"] for r in manifest["releases"]], ["accepted-v1", "older"])

    def test_search_metadata_and_crawler_files_leave_visible_content_unchanged(self):
        original = (self.source / "index.html").read_text("utf-8")
        build_public_release(self.source, self.output)
        published = (self.output / "index.html").read_text("utf-8")
        self.assertEqual(original.split("</head>", 1)[1], published.split("</head>", 1)[1])

        class HeadParser(HTMLParser):
            def __init__(self):
                super().__init__()
                self.tags = []

            def handle_starttag(self, tag, attrs):
                self.tags.append((tag, dict(attrs)))

        head = HeadParser()
        head.feed(published.split("</head>", 1)[0])
        descriptions = [a["content"] for t, a in head.tags if a.get("name") == "description"]
        self.assertEqual(len(descriptions), 1)
        self.assertIn("chart constants", descriptions[0])
        self.assertEqual(
            [a["href"] for t, a in head.tags if a.get("rel") == "canonical"],
            ["https://maimai.party/"],
        )
        self.assertIn("maimai Chart Database &amp; Patterns", published)
        # Parse only the fixed sitemap generated locally by the release builder.
        sitemap = ET.parse(self.output / "sitemap.xml")  # noqa: S314
        self.assertEqual(
            [node.text for node in sitemap.findall(".//{*}loc")], ["https://maimai.party/"]
        )
        robots = (self.output / "robots.txt").read_text("utf-8")
        self.assertIn("User-agent: *\nAllow: /", robots)
        self.assertIn("Sitemap: https://maimai.party/sitemap.xml", robots)
        self.assertNotIn("Disallow:", robots)

    def test_integrity_failure_does_not_write_any_output(self):
        (self.source / self.path).write_bytes(self.raw + b" ")
        with self.assertRaisesRegex(ValueError, "integrity"):
            build_public_release(self.source, self.output)
        self.assertFalse(self.output.exists())

    def test_unreviewed_genres_block_all_release_versions_before_any_output(self):
        value, _ = admit(empty(), [official_row("Genre fixture", "Artist")])
        original = project_registry(value, {})
        original["package"] = {"status": "research_preview"}
        for schema in ("maimai-browser-catalog-2", None):
            with self.subTest(schema=schema):
                data = json.loads(json.dumps(original))
                if schema is None:
                    del data["schema_version"]
                # Also reject an unused declared category, not just chart references.
                data["navigation"]["genres"].append(
                    {"id": "sega:Future category", "label": "Future"}
                )
                raw = canonical(data)
                sha = hashlib.sha256(raw).hexdigest()
                path = f"catalogs/{sha}.json"
                (self.source / path).write_bytes(raw)
                self.manifest["releases"] = [
                    {"version": "accepted-v1", "path": self.path, "sha256": self.sha},
                    {"version": "older-unreviewed", "path": path, "sha256": sha},
                ]
                atomic_json(self.source / "manifest.json", self.manifest)
                with self.assertRaisesRegex(ValueError, "Future category.*requires genre review"):
                    build_public_release(self.source, self.output)
                self.assertFalse(self.output.exists())

    def test_hosting_file_size_limit_is_checked_before_any_write(self):
        (self.source / "challenge-review.js").write_bytes(b" " * 4096)
        with patch("maimai_intelligence.public_release.MAX_PUBLIC_FILE_BYTES", 4095):
            with self.assertRaisesRegex(ValueError, "file size limit: challenge-review.js"):
                build_public_release(self.source, self.output)
        self.assertFalse(self.output.exists())
        with patch("maimai_intelligence.public_release.MAX_PUBLIC_FILE_BYTES", 4096):
            result = build_public_release(self.source, self.output)
        self.assertEqual(result["largest_file_bytes"], 4096)

    def test_hosting_file_count_includes_manifest_and_prevents_partial_output(self):
        result = build_public_release(self.source, self.root / "baseline")
        with patch("maimai_intelligence.public_release.MAX_PUBLIC_FILES", result["files"] - 1):
            with self.assertRaisesRegex(ValueError, "file count limit"):
                build_public_release(self.source, self.output)
        self.assertFalse(self.output.exists())

    def test_completed_and_partial_outputs_cannot_be_overwritten(self):
        build_public_release(self.source, self.output)
        with self.assertRaisesRegex(ValueError, "fresh release"):
            build_public_release(self.source, self.output)
        with self.assertRaisesRegex(ValueError, "separate"):
            build_public_release(self.source, self.source / "public")

    def test_interrupted_write_never_publishes_manifest(self):
        with patch("maimai_intelligence.public_release.atomic_json", side_effect=OSError("disk")):
            with self.assertRaises(OSError):
                build_public_release(self.source, self.output)
        self.assertFalse((self.output / "manifest.json").exists())
        with self.assertRaisesRegex(ValueError, "fresh release"):
            build_public_release(self.source, self.output)

    def test_traversal_cannot_select_unlisted_files(self):
        self.manifest["releases"][0]["path"] = "../personal.json"
        atomic_json(self.source / "manifest.json", self.manifest)
        with self.assertRaisesRegex(ValueError, "identity"):
            build_public_release(self.source, self.output)
        self.assertFalse(self.output.exists())

    @unittest.skipUnless(shutil.which("node"), "Node.js is optional outside browser CI")
    def test_loader_reconstructs_bytes_and_rejects_unsafe_or_damaged_parts(self):
        # DOM-free unit harness: no browser is launched and no network is contacted.
        script = r"""
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {webcrypto,createHash}=require('node:crypto');
const loader=fs.readFileSync(process.argv[1],'utf8');
const hash=b=>createHash('sha256').update(b).digest('hex');
const bytes=Buffer.from(JSON.stringify({catalog:['日本語'],package:{status:'research_preview'}}));
const cut=bytes.indexOf(Buffer.from('日'))+1; // deliberately split a UTF-8 character
const fragments=[bytes.subarray(0,cut),bytes.subarray(cut)];
const parts=fragments.map(b=>(
  {path:`catalog-parts/${hash(b)}.json`,sha256:hash(b),bytes:b.length}));
const entry={version:'v1',sha256:hash(bytes),path:`catalogs/${hash(bytes)}.json`,parts};
async function run(change=()=>{},alter=()=>{}){
  const manifest=JSON.parse(JSON.stringify({schema_version:'1.1.0',default:'v1',releases:[entry]}));
  change(manifest);
  const requests=[],appended=[],status={textContent:''};
  const assets=Object.fromEntries(parts.map((p,i)=>[p.path,fragments[i]]));
  assets[entry.path]=bytes;alter(assets);
  const scope={window:{},crypto:webcrypto,Uint8Array,TextDecoder,URL,URLSearchParams,
    location:{href:'http://localhost/?left=chart-id',search:'?left=chart-id'},
    history:{replaceState(...args){scope.pinned=args[2].href;}},
    document:{getElementById(){return status;},createElement(){return {};},
      body:{append(e){appended.push(e);}}},
    fetch:async(path,options)=>{
      assert.deepEqual(JSON.parse(JSON.stringify(options)),{credentials:'omit',redirect:'error'});
      requests.push(path);
      const body=path==='manifest.json'?Buffer.from(JSON.stringify(manifest)):assets[path];
      return new Response(body||'missing',{status:body?200:404});
    }};
  await vm.runInNewContext(loader,scope);
  return {status:status.textContent,requests,appended,pinned:scope.pinned,
    catalog:scope.window.maimaiResearchCatalog};
}
(async()=>{
  let r=await run();assert.equal(r.appended.length,2);
  assert.equal(r.appended[0].textContent,bytes.toString('utf8'));
  assert.equal(JSON.stringify(r.catalog),bytes.toString('utf8'));
  assert.equal(r.pinned,undefined); // Clean/latest URLs must not acquire a version pin.
  assert(!r.requests.some(p=>p.includes('chart-id')));
  r=await run(m=>{m.schema_version='1.0.0';delete m.releases[0].parts;});
  assert.equal(r.appended.length,2);assert(r.requests.includes(entry.path));
  for(const change of [m=>m.schema_version='9.0.0',m=>m.releases[0].parts=[],
    m=>m.releases[0].parts[0].path='https://example.org/private',
    m=>m.releases[0].parts[0].bytes=8*1024*1024+1,
    m=>m.releases[0].sha256='0'.repeat(64),
    m=>m.releases[0].parts[0].bytes+=1]){
    r=await run(change);assert.equal(r.appended.length,0);assert(r.status);
  }
  for(const alter of [a=>delete a[parts[0].path],
    a=>a[parts[0].path]=Buffer.alloc(fragments[0].length)]){
    r=await run(()=>{},alter);assert.equal(r.appended.length,0);assert(r.status);
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
"""
        loader = self.root / "loader.js"
        loader.write_text(
            files("maimai_intelligence.assets").joinpath("lab-loader.js").read_text("utf-8"),
            encoding="utf-8",
        )
        result = subprocess.run(  # noqa: S603
            [shutil.which("node"), "-e", script, str(loader)],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
