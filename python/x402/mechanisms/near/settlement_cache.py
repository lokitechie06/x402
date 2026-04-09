"""Thread-safe in-memory cache for deduplicating NEAR settlement requests."""

import threading
import time

from .constants import SETTLEMENT_TTL_SECONDS


class SettlementCache:
    """In-memory cache for deduplicating settlement requests by transaction hash.

    Thread-safe: all public methods acquire an internal lock.

    Because NEAR payments are pre-settled by the client, a malicious actor could
    attempt to reuse the same transaction hash across multiple resource requests.
    This cache prevents duplicate settlements within the TTL window.
    """

    def __init__(self, ttl_seconds: float = SETTLEMENT_TTL_SECONDS) -> None:
        self._entries: dict[str, float] = {}
        self._lock = threading.Lock()
        self._ttl_seconds = ttl_seconds

    def is_duplicate(self, tx_hash: str) -> bool:
        """Return True if tx_hash was already seen (duplicate), marking it as seen if new.

        Args:
            tx_hash: The NEAR transaction hash to check.

        Returns:
            True if this hash was already in the cache, False if it is new.
        """
        with self._lock:
            self._prune()
            if tx_hash in self._entries:
                return True
            self._entries[tx_hash] = time.monotonic()
            return False

    @property
    def entries(self) -> dict[str, float]:
        """Direct access to the entries dict — for testing only."""
        return self._entries

    def _prune(self) -> None:
        """Remove entries older than the TTL. Caller must hold _lock."""
        cutoff = time.monotonic() - self._ttl_seconds
        expired = [k for k, ts in self._entries.items() if ts < cutoff]
        for k in expired:
            del self._entries[k]
