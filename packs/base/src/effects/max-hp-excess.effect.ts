import { effect } from '@arcadia-eternity/battle/effect-loading'
import type { CodeEffectModuleContext } from '@arcadia-eternity/battle/authoring'

const baselineParameter = { kind: 'number', default: 500, minimum: 0, integer: true } as const

function hpExcess(sdk: CodeEffectModuleContext['sdk'], value: number) {
  const baseline = sdk.numberParam({ default: value })
  const hp = sdk.targets.ownerPet.first().attribute('maxHp')
  const excess = sdk.values.combine(hp, baseline, (maximum, threshold) => maximum - threshold)
  const when = sdk.conditions.all(sdk.conditions.selfUsesSkill, frame => (frame.read(excess) ?? 0) > 0)
  return { baseline, excess, when }
}

@effect({ id: 'power-from-max-hp-excess', sourceKind: 'skill' })
export class PowerFromMaxHPExcess {
  static create({ id, sdk }: CodeEffectModuleContext) {
    return sdk.defineNativeBehavior({
      id: id('power-from-max-hp-excess'),
      sourceKind: 'skill',
      parameters: { baseline: baselineParameter },
      build({ effectId, params }) {
        const { baseline, excess, when } = hpExcess(sdk, params.baseline as number)
        return sdk.defineEffect({
          id: effectId,
          triggers: [sdk.EffectTrigger.BeforeHit],
          priority: 0,
          parameters: { baseline },
          when,
          apply: sdk.contexts.skillUse.apply(sdk.ops.addPower(excess)),
        })
      },
    })
  }
}

@effect({ id: 'damage-from-max-hp-excess', sourceKind: 'skill' })
export class DamageFromMaxHPExcess {
  static create({ id, sdk }: CodeEffectModuleContext) {
    return sdk.defineNativeBehavior({
      id: id('damage-from-max-hp-excess'),
      sourceKind: 'skill',
      parameters: { baseline: baselineParameter },
      build({ effectId, params }) {
        const { baseline, excess, when } = hpExcess(sdk, params.baseline as number)
        return sdk.defineEffect({
          id: effectId,
          triggers: [sdk.EffectTrigger.OnBeforeCalculateDamage],
          priority: 0,
          parameters: { baseline },
          when,
          apply: sdk.contexts.damage.apply(sdk.ops.modifyDamage({ percent: 0, delta: excess })),
        })
      },
    })
  }
}

@effect({ id: 'mark-from-max-hp-excess', sourceKind: 'skill' })
export class MarkFromMaxHPExcess {
  static create({ id, sdk, marks }: CodeEffectModuleContext) {
    return sdk.defineNativeBehavior({
      id: id('mark-from-max-hp-excess'),
      sourceKind: 'skill',
      parameters: {
        baseline: baselineParameter,
        mark: { kind: 'string', reference: 'mark', default: 'mark_fansheguike' },
        scale: { kind: 'number', minimum: 0, default: 1, static: true },
      },
      build({ effectId, params }) {
        const { baseline, excess, when } = hpExcess(sdk, params.baseline as number)
        const mark = marks.get(params.mark as string)
        if (!mark) throw new Error('Missing HP-excess mark: ' + params.mark)
        const scale = params.scale as number
        return sdk.defineEffect({
          id: effectId,
          triggers: [sdk.EffectTrigger.OnHit],
          priority: 0,
          parameters: {
            baseline,
            mark: sdk.stringParam({ default: params.mark as string }),
            scale: sdk.numberParam({ default: scale }),
          },
          when,
          apply: sdk.targets.ownerPet.apply(sdk.ops.addMark(mark, { stack: excess.map(n => Math.floor(n * scale)) })),
        })
      },
    })
  }
}
