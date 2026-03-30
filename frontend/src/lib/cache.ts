/**
 * Simple in-memory cache for API responses.
 * Entries expire after `ttl` ms (default 60s).
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const store = new Map<string, CacheEntry<unknown>>();
const DEFAULT_TTL = 60_000; // 60s

export function cacheGet<T>(key: string, ttl = DEFAULT_TTL): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > ttl) {
    store.delete(key);
    return null;
  }
  return entry.data as T;
}

export function cacheSet<T>(key: string, data: T): void {
  store.set(key, { data, timestamp: Date.now() });
}

export function cacheDelete(key: string): void {
  store.delete(key);
}

export function cacheInvalidatePrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}
