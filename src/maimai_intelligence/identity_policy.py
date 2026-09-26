"""Pure normalization for candidate evidence; these values never authorize identity."""

import unicodedata


def normalized(value):
    return " ".join(unicodedata.normalize("NFKC", value or "").casefold().split())


def label(value):
    # Spaces and typographic quote styles do not identify editions or artists.
    # Keep all words, numbers, brackets and edition suffixes.
    return "".join(normalized(value).split()).translate(
        str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"'})
    )


def variant(difficulty):
    value = normalized(difficulty).upper()
    format_ = "DX" if value.startswith("DX ") else "STD"
    value = (
        value.removeprefix("DX ")
        .replace("REMASTER", "RE:MASTER")
        .replace("RE: MASTER", "RE:MASTER")
    )
    return format_, value
