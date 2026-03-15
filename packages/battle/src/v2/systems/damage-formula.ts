// battle/src/v2/systems/damage-formula.ts
// Seer2-specific damage formula implementation.

import type { World } from '@arcadia-eternity/engine'
import type { DamageFormula, DamageContext } from '@arcadia-eternity/plugin-damage'
import { Category } from '@arcadia-eternity/const'
import type { PetSystem } from './pet.system.js'

export function createSeer2DamageFormula(petSystem: PetSystem): DamageFormula {
  return {
    calculate(world: World, ctx: DamageContext): number {
      const extra = ctx.extra as {
        level?: number
        category?: string
        stabMultiplier?: number
        critMultiplier?: number
        typeMultiplier?: number
        power?: number
      }

      const level = extra.level ?? 100
      const power = extra.power ?? ctx.baseDamage
      const category = extra.category ?? Category.Physical

      let atkStat: number
      let defStat: number

      if (category === Category.Physical || category === Category.Climax) {
        atkStat = petSystem.getStatValue(world, ctx.sourceId, 'atk')
        defStat = petSystem.getStatValue(world, ctx.targetId, 'def')
      } else {
        atkStat = petSystem.getStatValue(world, ctx.sourceId, 'spa')
        defStat = petSystem.getStatValue(world, ctx.targetId, 'spd')
      }

      let baseDamage = ((2 * level / 5 + 2) * power * atkStat / defStat) / 50 + 2

      baseDamage *= extra.stabMultiplier ?? 1
      baseDamage *= extra.typeMultiplier ?? ctx.effectiveness

      if (ctx.crit) {
        baseDamage *= extra.critMultiplier ?? 2
      }

      baseDamage *= ctx.randomFactor

      return Math.floor(baseDamage)
    },
  }
}
