// Hackathon #48 — Response cache (consensus from all models)
// LRU cache with per-tier TTL. Normalized keys for near-duplicate hits.

import { createLogger } from "../observability/logger.js";

const log = createLogger("response-cache");

interface CacheEntry {
  response: string;
  expires: number;
}

const TIER_TTL: Record<string, number> = {
  fast: 30 * 60_000,     // 30 min
  standard: 10 * 60_000, // 10 min
  premium: 5 * 60_000,   //  5 min
};

const MAX_ENTRIES = 200;

const _cache = new Map<string, CacheEntry>();

function normalizeKey(message: string): string {
  return message.trim().toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}

export function getCachedResponse(message: string): string | undefined {
  const key = normalizeKey(message);
  const entry = _cache.get(key);
  if (!entry) return undefined;
  if (entry.expires < Date.now()) {
    _cache.delete(key);
    return undefined;
  }
  // Move to end for LRU behavior
  _cache.delete(key);
  _cache.set(key, entry);
  log.info("Cache hit", { keyLength: key.length });
  return entry.response;
}

export function setCachedResponse(message: string, response: string, tier: string = "standard"): void {
  if (!shouldCache(message, response)) return;
  const key = normalizeKey(message);
  // Evict oldest if at capacity
  if (_cache.size >= MAX_ENTRIES) {
    const oldest = _cache.keys().next().value;
    if (oldest !== undefined) _cache.delete(oldest);
  }
  const ttl = TIER_TTL[tier] ?? TIER_TTL.standard;
  _cache.set(key, { response, expires: Date.now() + ttl });
}

function shouldCache(message: string, response: string): boolean {
  // Don't cache very long prompts (likely unique context)
  if (message.length > 400) return false;
  // Don't cache very long responses (likely complex/unique)
  if (response.length > 6000) return false;
  // Don't cache tool-use or error responses
  if (response.includes("Error:") || response.includes("```bash")) return false;
  return true;
}

export function clearResponseCache(): void {
  _cache.clear();
}

export function getResponseCacheStats(): { size: number; maxSize: number } {
  return { size: _cache.size, maxSize: MAX_ENTRIES };
}
