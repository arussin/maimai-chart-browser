import hashlib
import shutil
import subprocess
import tempfile
import unittest
from importlib.resources import files
from pathlib import Path
from unittest.mock import patch

from maimai_intelligence.public_release import PUBLIC_FILES, build_public_release
from maimai_intelligence.snapshots import atomic_json, canonical, read_json


class PublicReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source, self.output = self.root / "accepted", self.root / "public"
        self.source.mkdir()
        for name in PUBLIC_FILES:
            (self.source / name).write_text("catalog-parts/ maimaiCatalogDetails", encoding="utf-8")
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
            "location.search+location.hash", (self.output / "lab-redirect.js").read_text("utf-8")
        )

    def test_old_versions_and_default_are_preserved(self):
        self.manifest["releases"].append({**self.manifest["releases"][0], "version": "older"})
        atomic_json(self.source / "manifest.json", self.manifest)
        build_public_release(self.source, self.output)
        manifest = read_json(self.output / "manifest.json")
        self.assertEqual(manifest["default"], "accepted-v1")
        self.assertEqual([r["version"] for r in manifest["releases"]], ["accepted-v1", "older"])

    def test_integrity_failure_does_not_write_any_output(self):
        (self.source / self.path).write_bytes(self.raw + b" ")
        with self.assertRaisesRegex(ValueError, "integrity"):
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
  assert.match(r.pinned,/left=chart-id&version=v1/);
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
