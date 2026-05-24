// battle/src/v2/types/phase-registry.ts
// Maps phase handler type symbols to their TData types.
// Threaded through PhaseManager as the TRegistry generic.
//
// Phase type symbols are defined in phase-symbols.ts using Symbol.for().

export type PhaseRegistry = Record<symbol, unknown>
