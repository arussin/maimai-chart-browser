"""Build a local-only filter preview with the synthetic import fixture."""

import base64
import gzip
from pathlib import Path


def build_preview(root: Path, player_fixture: Path) -> None:
    encoded = base64.b64encode(gzip.compress(player_fixture.read_bytes())).decode()
    script = r"""
<script>
// Preview-only: import fictional records through the normal file-import flow.
const previewStatus=document.createElement('p');
previewStatus.textContent='Local preview — loading fictional player data…';
previewStatus.style.cssText='margin:12px auto;max-width:1104px;padding:8px 16px;'+
  'background:#eaf5f5;color:#183b43';
document.body.prepend(previewStatus);
let importing=false;
const previewObserver=new MutationObserver(async()=>{
  const input=document.querySelector('input[type=file]');
  if(!window.maimaiPersonal||!input||importing)return;
  importing=true;
  await maimaiPersonal.ready;
  const consent=new MutationObserver(()=>{
    const dialog=document.querySelector('.player-dialog[open]');
    const remember=dialog?.querySelector('.player-remember input');
    const accept=dialog?.querySelector('.player-actions button');
    if(!remember||!accept)return;
    consent.disconnect();remember.checked=false;accept.click();
  });
  consent.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open']});
  const bytes=Uint8Array.from(atob('PLAYER_BYTES'),c=>c.charCodeAt(0));
  const file=new File([bytes],'fictional-player.gz',{type:'application/gzip'});
  const transfer=new DataTransfer();transfer.items.add(file);input.files=transfer.files;
  input.dispatchEvent(new Event('change',{bubbles:true}));
});
previewObserver.observe(document.body,{subtree:true,childList:true});
window.addEventListener('maimai-personal-change',()=>{
  if(!maimaiPersonal.enabled())return;
  previewStatus.textContent='Local preview — fictional player data loaded. '+
    'Try Filters and Your results; selected filters and Clear stay visible when closed.';
  previewObserver.disconnect();
});
</script>
""".replace("PLAYER_BYTES", encoded)
    index = root / "registry" / "index.html"
    index.with_name("filter-preview.js").write_text(
        script.replace("<script>", "").replace("</script>", ""), "utf-8"
    )
    preview = index.read_text("utf-8").replace(
        "</body>", '<script src="filter-preview.js"></script></body>'
    )
    index.with_name("filter-preview.html").write_text(preview, "utf-8")
