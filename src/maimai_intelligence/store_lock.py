"""Exclusive local writer lease; interrupted leases require owner inspection."""

from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path


class LockCleanupError(OSError):
    """The protected operation finished; its lease still needs owner inspection."""


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
    except BaseException as primary:
        try:
            lock.unlink()
        except BaseException:
            BaseException.add_note(primary, "corpus.writer_lock_cleanup_failed")
        raise
    else:
        try:
            lock.unlink()
        except OSError as error:
            raise LockCleanupError(
                "The operation completed, but writer.lock cleanup failed; "
                "verify its output and inspect the lock before retrying"
            ) from error
