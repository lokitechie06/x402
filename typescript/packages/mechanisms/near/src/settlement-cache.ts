import { SETTLEMENT_TTL_MS } from "./constants";

/**
 * In-memory cache to prevent duplicate settlements of the same NEAR transaction.
 *
 * Since NEAR payments are pre-settled by the client, a malicious actor could
 * attempt to reuse the same transaction hash across multiple resource requests.
 * This cache tracks recently seen transaction hashes and rejects duplicates.
 *
 * Entries are evicted after SETTLEMENT_TTL_MS to bound memory usage.
 */
export class SettlementCache {
  private readonly cache = new Map<string, number>();
  private readonly ttlMs: number;

  constructor(ttlMs = SETTLEMENT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  /**
   * Check if a transaction hash has already been seen, and mark it as seen.
   *
   * @param txHash - The NEAR transaction hash to check
   * @returns true if this hash was already in the cache (duplicate), false if it's new
   */
  isDuplicate(txHash: string): boolean {
    this.evict();
    if (this.cache.has(txHash)) {
      return true;
    }
    this.cache.set(txHash, Date.now());
    return false;
  }

  /**
   * Evict entries that have exceeded the TTL.
   */
  private evict(): void {
    const now = Date.now();
    for (const [key, timestamp] of this.cache) {
      if (now - timestamp > this.ttlMs) {
        this.cache.delete(key);
      }
    }
  }
}
