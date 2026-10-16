/** Small serializable xorshift32 generator. A zero state is remapped to a fixed non-zero state. */
export function nextRandom(state: number): { value: number; state: number } {
  let next = state >>> 0
  if (next === 0) next = 0x6d2b79f5
  next ^= next << 13
  next ^= next >>> 17
  next ^= next << 5
  next >>>= 0
  return { value: next / 0x1_0000_0000, state: next }
}

export function seedToState(seed: number): number {
  const state = seed >>> 0
  return state === 0 ? 0x6d2b79f5 : state
}
