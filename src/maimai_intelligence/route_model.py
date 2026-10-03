"""Pure public route rules; the application adapter supplies the loaded model."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from urllib.parse import quote, unquote


def valid_permalink_slug(value: object) -> bool:
    """Published ledger slugs are stricter than a general encoded route segment."""
    return (
        isinstance(value, str)
        and 0 < len(value) <= 100
        and all(unicodedata.category(char)[0] in "LN" or char == "-" for char in value)
    )


@dataclass(frozen=True)
class PublicRoute:
    locale: str
    kind: str
    slug: str

    @property
    def path(self) -> str:
        return f"/{self.locale}/{self.kind}/{quote(self.slug, safe='-')}/"

    @property
    def filename(self) -> str:
        return f"{self.locale}/{self.kind}/{self.slug}/index.html"


@dataclass(frozen=True)
class PublicRouteModel:
    """Immutable locale/kind authority shared by rendering and release policy."""

    locales: tuple[str, ...]
    kinds: tuple[str, ...]

    def __post_init__(self) -> None:
        for tokens in (self.locales, self.kinds):
            if (
                not isinstance(tokens, tuple)
                or not tokens
                or not all(
                    isinstance(token, str) and re.fullmatch(r"[a-z][a-z0-9-]*", token)
                    for token in tokens
                )
                or len(set(tokens)) != len(tokens)
            ):
                raise ValueError("Invalid public route model")

    def path(self, locale: str, kind: str, slug: str) -> str:
        # Keep the public encoder's established punctuation compatibility. The
        # ledger and emitted-document readers require valid_permalink_slug too.
        if (
            locale not in self.locales
            or kind not in self.kinds
            or not isinstance(slug, str)
            or not slug
            or any(char in slug for char in "/\\?#")
        ):
            raise ValueError("Invalid canonical public route")
        return PublicRoute(locale, kind, slug).path

    def parse_path(self, path: object) -> PublicRoute | None:
        if not isinstance(path, str):
            return None
        parts = path.split("/")
        if len(parts) != 5 or parts[0] or parts[-1]:
            return None
        try:
            slug = unquote(parts[3], errors="strict")
        except UnicodeDecodeError:
            return None
        parsed = self._published(parts[1], parts[2], slug)
        return parsed if parsed is not None and parsed.path == path else None

    def parse_filename(self, filename: object) -> PublicRoute | None:
        if not isinstance(filename, str):
            return None
        parts = filename.split("/")
        if len(parts) != 4 or parts[-1] != "index.html":
            return None
        return self._published(parts[0], parts[1], parts[2])

    def _published(self, locale: str, kind: str, slug: str) -> PublicRoute | None:
        if locale not in self.locales or kind not in self.kinds or not valid_permalink_slug(slug):
            return None
        return PublicRoute(locale, kind, slug)
