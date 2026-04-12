/**
 * A simple LRU (Least Recently Used) Cache implementation.
 */
export class LRUCache<K, V> {
  private capacity: number;
  private cache: Map<K, V>;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.cache = new Map<K, V>();
  }

  /**
   * Get a value from the cache.
   * Moves the accessed key to the end (most recent).
   */
  get(key: K): V | undefined {
    if (!this.cache.has(key)) return undefined;

    const value = this.cache.get(key)!;
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  /**
   * Set a value in the cache.
   * If the cache is at capacity, removes the least recently used item.
   */
  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.capacity) {
      // Least recently used is the first item in the Map
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, value);
  }

  /**
   * Check if a key exists in the cache without updating its recency.
   */
  has(key: K): boolean {
    return this.cache.has(key);
  }

  /**
   * Clear the entire cache.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get the current size of the cache.
   */
  size(): number {
    return this.cache.size;
  }
}

// Global LRU cache for images (thumbnails/icons)
// Capacity of 200 items should be plenty for most sessions
export const imageCache = new LRUCache<string, string>(200);
