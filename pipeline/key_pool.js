/**
 * key_pool.js — YouTube API key rotation
 *
 * Supports multiple API keys. When a key hits its daily quota (403 quotaExceeded),
 * it is marked exhausted and the pool rotates to the next available key.
 */

export class KeyPool {
  constructor(keys) {
    this.keys = keys.filter(Boolean)
    if (!this.keys.length) throw new Error('No YouTube API keys configured')
    this._idx = 0
    this.exhausted = new Set()
    console.log(`KeyPool: ${this.keys.length} key(s) available`)
  }

  /** Returns the current active key, rotating past exhausted ones. */
  get() {
    for (let i = 0; i < this.keys.length; i++) {
      const idx = (this._idx + i) % this.keys.length
      if (!this.exhausted.has(idx)) {
        this._idx = idx
        return this.keys[idx]
      }
    }
    throw new Error('All YouTube API keys exhausted for today — try again tomorrow')
  }

  /** Call this when a key returns 403 quotaExceeded. */
  markExhausted(key) {
    const idx = this.keys.indexOf(key)
    if (idx !== -1) {
      this.exhausted.add(idx)
      const remaining = this.keys.length - this.exhausted.size
      console.warn(`  ⚠ Key ${idx + 1}/${this.keys.length} exhausted. ${remaining} remaining.`)
    }
  }

  /** Returns true if at least one key is still usable. */
  hasAvailable() {
    return this.exhausted.size < this.keys.length
  }

  get remainingCount() {
    return this.keys.length - this.exhausted.size
  }
}

/** Factory: reads keys from environment variables YOUTUBE_API_KEY_1, _2, _3... */
export function makeKeyPool() {
  const keys = [
    process.env.YOUTUBE_API_KEY_1,
    process.env.YOUTUBE_API_KEY_2,
    process.env.YOUTUBE_API_KEY_3,
  ].filter(Boolean)

  if (!keys.length) {
    throw new Error('Set at least YOUTUBE_API_KEY_1 in your .env file')
  }
  return new KeyPool(keys)
}
