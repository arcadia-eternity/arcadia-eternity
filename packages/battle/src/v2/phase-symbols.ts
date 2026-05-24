// battle/src/v2/phase-symbols.ts
// Phase type symbols — canonical identifiers for all battle phases.
//
// Uses Symbol.for() so that symbols survive JSON serialization
// (via Symbol.keyFor() ↔ Symbol.for() round-trip) and remain
// identical across module reloads (snapshot restore, Redis deserialization).

/**
 * Phase type symbols used as handler.type and PhaseDef.type.
 *
 * Usage:
 *   handler.type = Phase.battleStart
 *   pm.execute(world, Phase.damage, bus, data)
 *   pm.getHandler(Phase.skill)
 */
export const Phase = {
  battleStart: Symbol.for('battleStart'),
  battleSwitch: Symbol.for('battleSwitch'),
  selection: Symbol.for('selection'),
  turn: Symbol.for('turn'),
  skill: Symbol.for('skill'),
  switch: Symbol.for('switch'),
  damage: Symbol.for('damage'),
  heal: Symbol.for('heal'),
  rage: Symbol.for('rage'),
  addMark: Symbol.for('addMark'),
  removeMark: Symbol.for('removeMark'),
  markUpdate: Symbol.for('markUpdate'),
  markCleanup: Symbol.for('markCleanup'),
  statStage: Symbol.for('statStage'),
} as const

/**
 * Convert a phase symbol back to its string key (for error messages, serialization).
 */
export function phaseSymbolToKey(sym: symbol): string {
  const key = Symbol.keyFor(sym)
  if (key === undefined) {
    throw new Error(`Phase symbol has no global key: ${String(sym)}`)
  }
  return key
}

/**
 * Convert a string phase type back to its symbol (for deserialization, lookup).
 * Returns undefined if the string doesn't correspond to a known phase symbol.
 */
export function phaseKeyToSymbol(key: string): symbol | undefined {
  const sym = Symbol.for(key)
  // Verify it's actually one of our known phase symbols
  const known = Object.values(Phase) as readonly symbol[]
  if (known.includes(sym)) return sym
  return undefined
}
