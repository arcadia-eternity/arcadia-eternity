// plugin-damage/src/index.ts
// Generic damage calculation framework.
// DamageSystem class operates on DamageContext plain data.

import type { World } from '@arcadia-eternity/engine'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DamageContext {
  type: 'damage'
  sourceId: string
  targetId: string
  baseDamage: number
  damageType: string
  modified: [number, number]
  damageResult: number
  available: boolean
  crit: boolean
  effectiveness: number
  randomFactor: number
  minThreshold: number
  maxThreshold: number
  extra: Record<string, unknown>
}

export interface DamageFormula {
  calculate(world: World, ctx: DamageContext): number
}

// ---------------------------------------------------------------------------
// DamageSystem
// ---------------------------------------------------------------------------

export class DamageSystem {
  constructor(private formula?: DamageFormula) {}

  setFormula(formula: DamageFormula): void {
    this.formula = formula
  }

  createContext(
    sourceId: string,
    targetId: string,
    baseDamage: number,
    damageType: string,
    options?: Partial<Pick<DamageContext,
      'crit' | 'effectiveness' | 'randomFactor' |
      'minThreshold' | 'maxThreshold' | 'extra'
    >>,
  ): DamageContext {
    return {
      type: 'damage',
      sourceId,
      targetId,
      baseDamage,
      damageType,
      modified: [0, 0],
      damageResult: 0,
      available: true,
      crit: options?.crit ?? false,
      effectiveness: options?.effectiveness ?? 1,
      randomFactor: options?.randomFactor ?? 1,
      minThreshold: options?.minThreshold ?? 0,
      maxThreshold: options?.maxThreshold ?? Number.MAX_SAFE_INTEGER,
      extra: options?.extra ?? {},
    }
  }

  /** Recalculate damageResult from baseDamage + modifiers + thresholds. */
  updateResult(ctx: DamageContext): void {
    const percentModifier = 1 + ctx.modified[0] / 100
    const deltaModifier = ctx.modified[1]
    let intermediate = ctx.baseDamage * ctx.randomFactor * percentModifier + deltaModifier
    intermediate = Math.max(intermediate, ctx.minThreshold)
    intermediate = Math.min(intermediate, ctx.maxThreshold)
    ctx.damageResult = Math.floor(Math.max(0, intermediate))
  }

  /** Add percent and delta modifiers (additive stacking). */
  addModified(ctx: DamageContext, percent: number, delta: number): void {
    ctx.modified[0] += percent
    ctx.modified[1] += delta
  }

  /** Set damage thresholds. */
  addThreshold(ctx: DamageContext, min?: number, max?: number): void {
    if (min !== undefined) ctx.minThreshold = min
    if (max !== undefined) ctx.maxThreshold = max
  }

  /** Calculate using the registered formula, then update result. */
  calculateWithFormula(world: World, ctx: DamageContext): void {
    if (!this.formula) throw new Error('No DamageFormula registered')
    ctx.baseDamage = this.formula.calculate(world, ctx)
    this.updateResult(ctx)
  }
}

// Keep standalone helpers for convenience
export function updateDamageResult(ctx: DamageContext): void {
  const percentModifier = 1 + ctx.modified[0] / 100
  const deltaModifier = ctx.modified[1]
  let intermediate = ctx.baseDamage * ctx.randomFactor * percentModifier + deltaModifier
  intermediate = Math.max(intermediate, ctx.minThreshold)
  intermediate = Math.min(intermediate, ctx.maxThreshold)
  ctx.damageResult = Math.floor(Math.max(0, intermediate))
}

export function addModified(ctx: DamageContext, percent: number, delta: number): void {
  ctx.modified[0] += percent
  ctx.modified[1] += delta
}

export function addThreshold(ctx: DamageContext, min?: number, max?: number): void {
  if (min !== undefined) ctx.minThreshold = min
  if (max !== undefined) ctx.maxThreshold = max
}
