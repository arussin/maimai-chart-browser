"""Exclusive local writer lease; interrupted leases require owner inspection."""

from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path


@contextmanager
def writer_lock(store: Path | str) -> Iterator[None]:
    store = Path(store).resolve()
    store.mkdir(parents=True, exist_ok=True)
    lock = store / "writer.lock"
    try:
        stream = lock.open("x", encoding="utf-8")
    except FileExistsError as error:
        raise ValueError(
            "An update is running or was interrupted; inspect writer.lock first"
        ) from error
    try:
        with stream:
            stream.write(str(os.getpid()))
        yield
    finally:
        lock.unlink()
