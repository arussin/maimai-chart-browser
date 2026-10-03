"""Pure, exact-source recovery derivation; never mutates its baseline.

The supported legacy loaders have one bundle target and an error-only failure
handler. Pinning their complete bytes excludes alternate targets or fallback
execution of the original unbounded renderer.
"""

from __future__ import annotations

import hashlib
from collections.abc import Mapping
from dataclasses import asdict, dataclass
from types import MappingProxyType

from .release_composition import (
    ArtifactInventory,
    artifact_inventory_sha256,
    inventory_from_records,
)
from .serialization import canonical

POLICY = "cc5-bounded-chart-recovery-1"
SOURCE_BUNDLE_SHA256 = "2afd707adbd9f7413823d871e7674899f7aa6abeb26862c5419ad344f7cd9886"
SOURCE_LOADER_SHA256 = frozenset(
    {
        "199b00f5fc6cf8a39edbee8c5f7186f0aa88d2f75163c2fcff0621fd94f3bae9",
        "31e12257f32f705848abf7b7ccff3498db3f9ac03d64b8bafde99a81907c4795",
    }
)
SOURCE_CATALOG = "function catalog(focusKey=null){"
DERIVED_CATALOG = (
    "function catalog(focusKey=null){\n"
    "  const route=new URLSearchParams(location.search);\n"
    "  const focusedKey=focusKey??(route.get('view')==='catalog'?"
    "window.maimaiRegistryBrowser.resolve(data,route.get('chart')):null);"
)
SOURCE_FOCUS = (
    "if(focusKey){selectedCharts.delete(focusKey);"
    "visible=Math.max(visible,rows.findIndex(row=>row.key===focusKey)+1);}"
)
DERIVED_FOCUS = (
    "if(focusKey)selectedCharts.delete(focusKey);"
    "const selectedRows=recoveryRows(rows,visible,focusedKey);"
)
SOURCE_LOOP = "for(const [index,{key,chart}]of rows.slice(0,visible).entries()){"
DERIVED_LOOP = "for(const {index,row:{key,chart}}of selectedRows){"
SOURCE_MORE = "el('more').hidden=rows.length<=visible;"
DERIVED_MORE = "el('more').hidden=rows.length<=selectedRows.length;"


def _sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _once(raw: bytes, before: str, after: str) -> bytes:
    old, new = before.encode(), after.encode()
    if raw.count(old) != 1:
        raise ValueError("Reviewed legacy transformation anchor changed")
    return raw.replace(old, new, 1)


def derive_bundle(raw: bytes, *, selector: bytes, selector_sha256: str) -> bytes:
    """Preserve every byte outside four reviewed pagination substitutions."""
    if type(raw) is not bytes or _sha(raw) != SOURCE_BUNDLE_SHA256:
        raise ValueError("Unsupported legacy recovery runtime")
    if (
        type(selector) is not bytes
        or not 0 < len(selector) <= 8192
        or _sha(selector) != selector_sha256
    ):
        raise ValueError("Shared recovery pagination asset differs from its reviewed build")
    try:
        expression = selector.decode("utf-8", errors="strict").strip()
    except UnicodeError as error:
        raise ValueError("Shared recovery pagination asset is not UTF-8") from error
    replacement = "const recoveryRows=" + expression + ";\n" + DERIVED_CATALOG
    for old, new in (
        (SOURCE_CATALOG, replacement),
        (SOURCE_FOCUS, DERIVED_FOCUS),
        (SOURCE_LOOP, DERIVED_LOOP),
        (SOURCE_MORE, DERIVED_MORE),
    ):
        raw = _once(raw, old, new)
    return raw


@dataclass(frozen=True)
class RecoveryAsset:
    path: str
    content: bytes


@dataclass(frozen=True)
class DerivedRecoveryBaseline:
    """A detached delta and its complete inventory, not a complete on-disk copy."""

    original_inventory_sha256: str
    inventory: ArtifactInventory
    assets: tuple[RecoveryAsset, ...]
    evidence: bytes

    @property
    def evidence_sha256(self) -> str:
        return _sha(self.evidence)

    @property
    def asset_map(self) -> Mapping[str, bytes]:
        return MappingProxyType({item.path: item.content for item in self.assets})


def derive_recovery_baseline(
    original: ArtifactInventory,
    *,
    index: bytes,
    loader: bytes,
    bundle: bytes,
    selector: bytes,
    selector_sha256: str,
) -> DerivedRecoveryBaseline:
    """Bind reviewed original bytes, derive hash URLs and retain every old file.

    Composition still owns conflicts. The derived index may activate only as the
    recovery document; candidate composition retains the new immutable scripts
    so a tab opened during recovery can finish after switching forward again.
    """
    original_id = artifact_inventory_sha256(original)
    records = {item.path: asdict(item.fingerprint) for item in original.files}
    sources = {"index.html": index, "lab-loader.js": loader, "challenge-review.js": bundle}
    for name, raw in sources.items():
        if type(raw) is not bytes or records.get(name) != {"bytes": len(raw), "sha256": _sha(raw)}:
            raise ValueError("Legacy input bytes do not match the complete source inventory")
    if _sha(loader) not in SOURCE_LOADER_SHA256:
        raise ValueError("Unsupported legacy recovery loader")
    patched = derive_bundle(bundle, selector=selector, selector_sha256=selector_sha256)
    bundle_path = "browser-resources/" + _sha(patched) + ".js"
    original_bundle_url = "challenge-review.js?v=" + _sha(bundle)[:16]
    new_loader = _once(
        loader, "script.src='" + original_bundle_url + "'", "script.src='/" + bundle_path + "'"
    )
    loader_path = "browser-resources/" + _sha(new_loader) + ".js"
    new_index = _once(index, 'href="' + original_bundle_url + '"', 'href="/' + bundle_path + '"')
    new_index = _once(
        new_index, 'src="lab-loader.js?v=' + _sha(loader)[:16] + '"', 'src="/' + loader_path + '"'
    )
    marker = '<meta name="maimai-recovery-runtime" content="' + POLICY + '">'
    if b"maimai-recovery-runtime" in new_index:
        raise ValueError("Recovery source is already derived")
    new_index = _once(new_index, "<head>", "<head>" + marker)
    assets = (
        RecoveryAsset("index.html", new_index),
        RecoveryAsset(bundle_path, patched),
        RecoveryAsset(loader_path, new_loader),
    )
    for item in assets:
        fingerprint = {"bytes": len(item.content), "sha256": _sha(item.content)}
        if item.path != "index.html" and item.path in records and records[item.path] != fingerprint:
            raise ValueError("Derived immutable runtime collides with the source inventory")
        records[item.path] = fingerprint
    derived = inventory_from_records(records)
    evidence = canonical(
        {
            "schema_version": "maimai-derived-recovery-baseline-1",
            "policy": POLICY,
            "scope": "derived recovery runtime; not byte-identical rollback",
            "original_inventory_sha256": original_id,
            "derived_inventory_sha256": artifact_inventory_sha256(derived),
            "original_runtime": {
                name: {"bytes": len(raw), "sha256": _sha(raw)} for name, raw in sources.items()
            },
            "derived_assets": {
                item.path: {"bytes": len(item.content), "sha256": _sha(item.content)}
                for item in assets
            },
            "substitutions": 4,
            "shared_pagination_sha256": selector_sha256,
            "semantics": (
                "sorted paginated prefix plus exact route chart; full indexes retained; "
                "route focus persists across rerenders; filters may hide it"
            ),
        }
    )
    return DerivedRecoveryBaseline(original_id, derived, assets, evidence)


def verify_recovery_derivation(
    value: DerivedRecoveryBaseline,
    original: ArtifactInventory,
    *,
    index: bytes,
    loader: bytes,
    bundle: bytes,
    selector: bytes,
    selector_sha256: str,
) -> None:
    """Assembly must rederive from freshly verified physical inputs before writes."""
    if not isinstance(value, DerivedRecoveryBaseline) or value != derive_recovery_baseline(
        original,
        index=index,
        loader=loader,
        bundle=bundle,
        selector=selector,
        selector_sha256=selector_sha256,
    ):
        raise ValueError("Derived recovery differs from its verified source and exact policy")
