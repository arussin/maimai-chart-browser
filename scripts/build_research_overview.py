"""Compatibility command; preparation is maintained in the installed package."""

from maimai_intelligence.source_preparation.build_research_overview import (
    build as build,
)
from maimai_intelligence.source_preparation.build_research_overview import (
    main as main,
)

if __name__ == "__main__":
    main()
