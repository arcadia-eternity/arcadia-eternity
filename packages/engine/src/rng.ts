// engine/src/rng.ts
// Seeded random number generator for deterministic battle replay.
// Uses sfc32 algorithm with direct state serialization (no replay needed).

export interface RngState {
  seed: string | number
  a: number
  b: number
  c: number
  d: number
}

/**
 * Hash a seed string/number into 4 initial state values.
 */
function hashSeed(seed: string | number): Omit<RngState, 'seed'> {
  let h = 0x9E3779B9
  const s = String(seed)
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 0x85EBCA6B)
    h ^= h >>> 13
  }
  // Generate 4 state values from hash
  const a = h >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x85EBCA6B)
  const b = h >>> 0
  h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35)
  const c = h >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x85EBCA6B)
  const d = h >>> 0
  return { a, b, c, d }
}

/**
 * GameRng — seeded random number generator using sfc32 algorithm.
 * State is directly serializable (no replay needed).
 */
export class GameRng {
  private seed: string | number
  private a: number
  private b: number
  private c: number
  private d: number

  constructor(seed?: string | number) {
    this.seed = seed ?? Date.now()
    const state = hashSeed(this.seed)
    this.a = state.a
    this.b = state.b
    this.c = state.c
    this.d = state.d
    // Warm up the generator (discard first few outputs for better distribution)
    for (let i = 0; i < 12; i++) this.next()
  }

  /**
   * Generate a random number in [0, 1).
   * sfc32 (Simple Fast Counter) algorithm.
   */
  next(): number {
    this.a |= 0
    this.b |= 0
    this.c |= 0
    this.d |= 0
    const t = (this.a + this.b | 0) + this.d | 0
    this.d = (this.d + 1) | 0
    this.a = this.b ^ (this.b >>> 9)
    this.b = (this.c + (this.c << 3)) | 0
    this.c = ((this.c << 21) | (this.c >>> 11))
    this.c = (this.c + t) | 0
    return (t >>> 0) / 4294967296
  }

  /**
   * Generate a random integer in [min, max] (inclusive).
   */
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min
  }

  /**
   * Shuffle an array (Fisher-Yates), returns a new array.
   */
  shuffle<T>(array: T[]): T[] {
    const result = [...array]
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1))
      ;[result[i], result[j]] = [result[j], result[i]]
    }
    return result
  }

  /**
   * Get current RNG state for serialization.
   * Can be stored in Redis/database as JSON.
   */
  getState(): RngState {
    return {
      seed: this.seed,
      a: this.a,
      b: this.b,
      c: this.c,
      d: this.d,
    }
  }

  /**
   * Restore RNG from a saved state.
   * Direct state restore, no replay needed.
   */
  static fromState(state: RngState): GameRng {
    const rng = new GameRng(0) // dummy seed
    rng.seed = state.seed
    rng.a = state.a
    rng.b = state.b
    rng.c = state.c
    rng.d = state.d
    return rng
  }
}
