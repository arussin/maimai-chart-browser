"""Shared public route model consumed by Python generation and browser composition."""

import json
from importlib.resources import files

from .route_model import PublicRoute, PublicRouteModel

MODEL = json.loads(
    files("maimai_intelligence.assets").joinpath("public-routes.json").read_text("utf-8")
)
LOCALES = MODEL["locales"]
ROUTE_MODEL = PublicRouteModel(tuple(LOCALES), tuple(MODEL["kinds"]))


def route(locale: str, kind: str, slug: str) -> str:
    return ROUTE_MODEL.path(locale, kind, slug)


def parse_route(path: object) -> PublicRoute | None:
    return ROUTE_MODEL.parse_path(path)
