"""Compatibility command; preparation is maintained in the installed package."""

from maimai_intelligence.source_preparation.acquire_maichart_pack import (
    MAX_FILE_BYTES as MAX_FILE_BYTES,
)
from maimai_intelligence.source_preparation.acquire_maichart_pack import (
    MAX_PACK_BYTES as MAX_PACK_BYTES,
)
from maimai_intelligence.source_preparation.acquire_maichart_pack import (
    REPOSITORY as REPOSITORY,
)
from maimai_intelligence.source_preparation.acquire_maichart_pack import (
    NoRedirects as NoRedirects,
)
from maimai_intelligence.source_preparation.acquire_maichart_pack import (
    capture as capture,
)
from maimai_intelligence.source_preparation.acquire_maichart_pack import (
    fetch as fetch,
)
from maimai_intelligence.source_preparation.acquire_maichart_pack import (
    git_blob_hash as git_blob_hash,
)
from maimai_intelligence.source_preparation.acquire_maichart_pack import (
    main as main,
)
from maimai_intelligence.source_preparation.acquire_maichart_pack import (
    selected_entries as selected_entries,
)
from maimai_intelligence.source_preparation.acquire_maichart_pack import (
    sha256 as sha256,
)
from maimai_intelligence.source_preparation.acquire_maichart_pack import (
    write_json as write_json,
)

if __name__ == "__main__":
    main()
