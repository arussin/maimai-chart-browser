"""Compatibility imports for owner research tools; implementation is installed with the library."""

from maimai_intelligence import transcription_html as _implementation


def __getattr__(name):
    return getattr(_implementation, name)
