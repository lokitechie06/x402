"""Tests for NEAR SettlementCache."""

import time

from x402.mechanisms.near.settlement_cache import SettlementCache


class TestSettlementCache:
    """Tests for SettlementCache."""

    def test_new_hash_returns_false(self):
        cache = SettlementCache()
        assert cache.is_duplicate("tx-abc") is False

    def test_seen_hash_returns_true(self):
        cache = SettlementCache()
        cache.is_duplicate("tx-abc")
        assert cache.is_duplicate("tx-abc") is True

    def test_different_hashes_are_independent(self):
        cache = SettlementCache()
        assert cache.is_duplicate("tx-1") is False
        assert cache.is_duplicate("tx-2") is False
        assert cache.is_duplicate("tx-1") is True
        assert cache.is_duplicate("tx-2") is True

    def test_entries_evicted_after_ttl(self):
        cache = SettlementCache(ttl_seconds=0.1)
        cache.is_duplicate("tx-short")
        time.sleep(0.15)
        assert cache.is_duplicate("tx-short") is False  # evicted, treated as new

    def test_entries_kept_before_ttl(self):
        cache = SettlementCache(ttl_seconds=60)
        cache.is_duplicate("tx-long")
        assert cache.is_duplicate("tx-long") is True

    def test_prune_removes_only_expired_entries(self):
        cache = SettlementCache(ttl_seconds=0.1)
        cache.is_duplicate("tx-a")  # will expire
        time.sleep(0.12)
        cache.is_duplicate("tx-b")  # fresh
        # trigger prune by calling is_duplicate
        cache.is_duplicate("tx-c")
        assert cache.is_duplicate("tx-a") is False  # expired, re-inserted as new
        assert cache.is_duplicate("tx-b") is True   # still fresh
