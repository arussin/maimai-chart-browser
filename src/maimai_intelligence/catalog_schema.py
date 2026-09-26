"""Public catalog field contracts, independent of readers, providers and rendering."""

PROFILE_FIELDS = {
    "version",
    "chart_id",
    "source_hash",
    "source_container_id",
    "song_id",
    "song_family",
    "title",
    "artist",
    "aliases",
    "difficulty",
    "format",
    "level",
    "demand",
}

CHART_FIELDS = PROFILE_FIELDS | {
    "variant_id",
    "capabilities",
    "regional",
    "metadata_region",
    "legacy_identity",
    "input_id",
    "transcription",
    "title_state",
}
