"""Bounded, exact fractions with JSON-safe integer or decimal-string components.

Small reduced pairs retain their historical integer representation. If either
component exceeds JavaScript's safe integer range, both components are decimal
strings. Decimal strings encode integers only: never floats, exponent notation,
or a rounded approximation. The bound applies before fraction reduction too.
"""

from __future__ import annotations

import re
from fractions import Fraction

MAX_RATIONAL_INTEGER = 2**53 - 1
MAX_RATIONAL_BITS = 4096
MAX_RATIONAL_DIGITS = 1234  # ceil(4096 * log10(2)); checked again by bit length.
RationalPair = list[int] | list[str]


class RationalEncodingError(ValueError):
    """The pair cannot be represented exactly within the explicit storage bound."""


def decode_rational(value: object, *, allow_strings: bool = True) -> Fraction:
    """Read a bounded pair; aliases reduce exactly without accepting unsafe numbers."""
    message = "Beats must be bounded rational [numerator, denominator] pairs"
    if not isinstance(value, list) or len(value) != 2:
        raise RationalEncodingError(message)
    if all(type(item) is int for item in value):
        if abs(value[0]) > MAX_RATIONAL_INTEGER or not 1 <= value[1] <= MAX_RATIONAL_INTEGER:
            raise RationalEncodingError(message)
        numerator, denominator = value
    elif allow_strings and all(type(item) is str for item in value):
        numerator_text, denominator_text = value
        if (
            len(numerator_text) > MAX_RATIONAL_DIGITS + 1
            or len(denominator_text) > MAX_RATIONAL_DIGITS
            or re.fullmatch(r"(?:0|-?[1-9][0-9]*)", numerator_text) is None
            or re.fullmatch(r"[1-9][0-9]*", denominator_text) is None
        ):
            raise RationalEncodingError(message)
        numerator, denominator = int(numerator_text), int(denominator_text)
        if max(abs(numerator).bit_length(), denominator.bit_length()) > MAX_RATIONAL_BITS:
            raise RationalEncodingError(message)
    else:
        raise RationalEncodingError(message)
    return Fraction(numerator, denominator)


def encode_rational(value: Fraction) -> RationalPair:
    """Encode an exact, reduced fraction; never coerce a float into exact evidence."""
    if (
        not isinstance(value, Fraction)
        or max(abs(value.numerator).bit_length(), value.denominator.bit_length())
        > MAX_RATIONAL_BITS
    ):
        raise RationalEncodingError("Exact rational exceeds the 4096-bit storage limit")
    numerator, denominator = value.numerator, value.denominator
    if abs(numerator) <= MAX_RATIONAL_INTEGER and denominator <= MAX_RATIONAL_INTEGER:
        return [numerator, denominator]
    return [str(numerator), str(denominator)]
