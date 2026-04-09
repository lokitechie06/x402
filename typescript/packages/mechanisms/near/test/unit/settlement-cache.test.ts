import { describe, it, expect, vi } from "vitest";
import { SettlementCache } from "../../src/settlement-cache";
import { SETTLEMENT_TTL_MS } from "../../src/constants";

describe("SettlementCache", () => {
  describe("isDuplicate", () => {
    it("returns false for a new transaction hash", () => {
      const cache = new SettlementCache();
      expect(cache.isDuplicate("txHashA")).toBe(false);
    });

    it("returns true for a previously seen hash", () => {
      const cache = new SettlementCache();
      cache.isDuplicate("txHashA");
      expect(cache.isDuplicate("txHashA")).toBe(true);
    });

    it("allows different hashes independently", () => {
      const cache = new SettlementCache();
      expect(cache.isDuplicate("txHash1")).toBe(false);
      expect(cache.isDuplicate("txHash2")).toBe(false);
      expect(cache.isDuplicate("txHash1")).toBe(true);
      expect(cache.isDuplicate("txHash2")).toBe(true);
    });

    it("evicts entries after TTL", () => {
      vi.useFakeTimers();
      try {
        const cache = new SettlementCache();
        cache.isDuplicate("expiring-tx");
        vi.advanceTimersByTime(SETTLEMENT_TTL_MS + 1);
        // After TTL: entry is evicted, treated as new
        expect(cache.isDuplicate("expiring-tx")).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it("keeps entries that have not yet expired", () => {
      vi.useFakeTimers();
      try {
        const cache = new SettlementCache();
        cache.isDuplicate("fresh-tx");
        vi.advanceTimersByTime(SETTLEMENT_TTL_MS - 1000);
        expect(cache.isDuplicate("fresh-tx")).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it("accepts a custom TTL", () => {
      vi.useFakeTimers();
      try {
        const cache = new SettlementCache(5_000);
        cache.isDuplicate("short-lived-tx");
        vi.advanceTimersByTime(5_001);
        expect(cache.isDuplicate("short-lived-tx")).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
