"""Compatibility command; preparation is maintained in the installed package."""

from maimai_analyzer.dataset import SOURCE_LOCK as SOURCE_LOCK
from maimai_intelligence.source_preparation.build_challenge_package import (
    PACKAGE_VERSION as PACKAGE_VERSION,
)
from maimai_intelligence.source_preparation.build_challenge_package import (
    PARSE_ROW_IMPLEMENTATION as PARSE_ROW_IMPLEMENTATION,
)
from maimai_intelligence.source_preparation.build_challenge_package import (
    build as build,
)
from maimai_intelligence.source_preparation.build_challenge_package import (
    main as main,
)
from maimai_intelligence.source_preparation.build_challenge_package import (
    parse_row as parse_row,
)
from maimai_intelligence.source_preparation.build_challenge_package import (
    source_bpms as source_bpms,
)
from maimai_intelligence.source_preparation.build_challenge_package import (
    verify_capture as verify_capture,
)
from maimai_intelligence.source_preparation.build_challenge_package import (
    write as write,
)

if __name__ == "__main__":
    main()
