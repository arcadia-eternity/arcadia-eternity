import {
  AddMarkContext,
  BaseMark,
  BaseStatLevelMark,
  Battle,
  ConfigSystem,
  type ConfigValue,
  DamageContext,
  EffectContext,
  HealContext,
  type MarkInstance,
  MarkInstanceImpl,
  type MarkOwner,
  Pet,
  Player,
  RageContext,
  RemoveMarkContext,
  type ScopeObject,
  SkillInstance,
  UseSkillContext,
  Modifier,
  DurationType,
  StatLevelMarkInstanceImpl,
} from '@arcadia-eternity/battle'
import { Observable } from 'rxjs'
import {
  CleanStageStrategy,
  EffectTrigger,
  IgnoreStageStrategy,
  StackStrategy,
  type StatTypeOnBattle,
  StatTypeWithoutHp,
} from '@arcadia-eternity/const'
import type { Condition, ConditionalValueSource, ConfigValueSource, Operator } from './effectBuilder'
import { ChainableSelector, type PrimitiveOpinion, type PropertyRef, type SelectorOpinion } from './selector'
import { type ValueSource } from './effectBuilder'

export const Operators = {
  conditional: <T>(condition: Condition, trueOperator: Operator<T>, falseOperator?: Operator<T>): Operator<T> => {
    return (context, targets) => {
      if (condition(context)) {
        trueOperator(context, targets)
      } else if (falseOperator) {
        falseOperator(context, targets)
      }
    }
  },

  dealDamage:
    (value: ValueSource<number>): Operator<Pet> =>
    (context: EffectContext<EffectTrigger>, targets: Pet[]) => {
      const _value = GetValueFromSource(context, value)
      if (_value.length === 0) return
      targets.forEach(p => p.damage(new DamageContext(context, context.source, p, _value[0])))
    },

  heal:
    (value: ValueSource<number>): Operator<Pet> =>
    (context: EffectContext<EffectTrigger>, targets: Pet[]) => {
      const _value = GetValueFromSource(context, value)
      if (_value.length === 0) return
      targets.forEach(p => p.heal(new HealContext(context, context.source, p, _value[0])))
    },

  addMark:
    <T extends MarkOwner>(
      mark: ValueSource<BaseMark>,
      stack?: ValueSource<number>,
      duration?: ValueSource<number>,
      config?: Partial<MarkInstance['config']>,
    ): Operator<T> =>
    (context: EffectContext<EffectTrigger>, targets: T[]) => {
      const marks = GetValueFromSource(context, mark)
      if (marks.length === 0) return

      const stackValue = stack ? GetValueFromSource(context, stack)[0] : undefined
      const durationValue = duration ? GetValueFromSource(context, duration)[0] : undefined
      targets.forEach(target => {
        target.addMark(new AddMarkContext(context, target, marks[0], stackValue, durationValue, config))
      })
    },

  transferMark:
    <T extends Battle | Pet, U extends MarkInstance>(mark: ValueSource<U>): Operator<T> =>
    (context: EffectContext<EffectTrigger>, targets: T[]) => {
      if (targets.length === 0) return
      const _mark = GetValueFromSource(context, mark)
      _mark.forEach(m => {
        m.transfer(context, targets[0])
      })
    },

  destroyMark:
    <T extends MarkInstance>(): Operator<T> =>
    (context: EffectContext<EffectTrigger>, targets: T[]) => {
      targets.forEach(m => {
        m.destroy(context)
      })
    },

  addStack:
    <T extends MarkInstance>(value: ValueSource<number>): Operator<T> =>
    (context: EffectContext<EffectTrigger>, targets: T[]) => {
      const _value = GetValueFromSource(context, value)
      if (_value.length === 0) return
      targets.forEach(mark => mark.addStack(_value[0]))
    },

  consumeStacks:
    <T extends MarkInstance>(value: ValueSource<number>): Operator<T> =>
    (context: EffectContext<EffectTrigger>, targets: T[]) => {
      const _value = GetValueFromSource(context, value)
      if (_value.length === 0) return
      targets.forEach(mark => mark.consumeStack(context, _value[0]))
    },

  addRage:
    (value: ValueSource<number>): Operator<Pet | Player> =>
    (context: EffectContext<EffectTrigger>, targets: (Player | Pet)[]) => {
      const _value = GetValueFromSource(context, value)
      if (_value.length === 0) return
      targets.forEach(player =>
        player.addRage(
          new RageContext(context, player instanceof Player ? player : player.owner!, 'effect', 'add', _value[0]),
        ),
      )
    },

  modifyStat:
    (stat: ValueSource<StatTypeOnBattle>, percent: ValueSource<number>, delta: ValueSource<number>): Operator<Pet> =>
    (context: EffectContext<EffectTrigger>, targets: Pet[]) => {
      targets.forEach(pet => {
        const _stat = GetValueFromSource(context, stat)[0]
        const _percent = GetValueFromSource(context, percent)[0] ?? 0
        const _value = GetValueFromSource(context, delta)[0] ?? 0

        // Get current base value from attribute system
        const currentValue = pet.attributeSystem.getStat(_stat)

        // Apply modifications
        let newValue = currentValue + _value
        newValue *= (100 + _percent) / 100
        newValue = Math.floor(newValue)

        // Update the attribute system
        pet.attributeSystem.updateBaseValue(_stat, newValue)
      })
    },

  // New operator: Add attribute modifier bound to mark lifecycle
  addAttributeModifier:
    (
      stat: ValueSource<StatTypeOnBattle>,
      modifierType: ValueSource<'percent' | 'delta' | 'override'>,
      value: ValueSource<number>,
      priority: ValueSource<number> = 0,
    ): Operator<Pet> =>
    (context: EffectContext<EffectTrigger>, targets: Pet[]) => {
      targets.forEach((pet, targetIndex) => {
        const _stat = GetValueFromSource(context, stat)[0]
        const _modifierType = GetValueFromSource(context, modifierType)[0]
        const _value = GetValueFromSource(context, value)[0]
        const _priority = GetValueFromSource(context, priority)[0] ?? 0

        // Create a unique modifier ID with better uniqueness guarantees
        const timestamp = Date.now()
        const random = Math.random().toString(36).substring(2, 11)
        const modifierId = `${context.source.id}_${_stat}_${_modifierType}_${timestamp}_${targetIndex}_${random}`

        // Create the modifier
        const modifier = new Modifier(
          DurationType.binding,
          modifierId,
          _value,
          _modifierType,
          _priority,
          context.source instanceof MarkInstanceImpl ? context.source : undefined,
        )

        // Add the modifier to the pet's attribute system
        const cleanup = pet.attributeSystem.addModifier(_stat, modifier)

        // If the effect source is a mark, bind the modifier lifecycle to the mark
        if (context.source instanceof MarkInstanceImpl) {
          context.source.addAttributeModifierCleanup(cleanup)
        }
      })
    },

  // New operator: Add dynamic attribute modifier using Observable value source
  addDynamicAttributeModifier:
    (
      stat: ValueSource<StatTypeOnBattle>,
      modifierType: ValueSource<'percent' | 'delta' | 'override'>,
      observableValue: ValueSource<Observable<number>>,
      priority: ValueSource<number> = 0,
    ): Operator<Pet> =>
    (context: EffectContext<EffectTrigger>, targets: Pet[]) => {
      targets.forEach((pet, targetIndex) => {
        const _stat = GetValueFromSource(context, stat)[0]
        const _modifierType = GetValueFromSource(context, modifierType)[0]
        const _observableValue = GetValueFromSource(context, observableValue)[0]
        const _priority = GetValueFromSource(context, priority)[0] ?? 0

        // Create a unique modifier ID
        const timestamp = Date.now()
        const random = Math.random().toString(36).substring(2, 11)
        const modifierId = `${context.source.id}_${_stat}_${_modifierType}_dynamic_${timestamp}_${targetIndex}_${random}`

        // Create the modifier with Observable value
        const modifier = new Modifier(
          DurationType.binding,
          modifierId,
          _observableValue,
          _modifierType,
          _priority,
          context.source instanceof MarkInstanceImpl ? context.source : undefined,
        )

        // Add the modifier to the pet's attribute system
        const cleanup = pet.attributeSystem.addModifier(_stat, modifier)

        // If the effect source is a mark, bind the modifier lifecycle to the mark
        if (context.source instanceof MarkInstanceImpl) {
          context.source.addAttributeModifierCleanup(cleanup)
        }
      })
    },

  // New operator: Add clampMax modifier to limit maximum attribute value
  addClampMaxModifier:
    (
      stat: ValueSource<StatTypeOnBattle>,
      maxValue: ValueSource<number>,
      priority: ValueSource<number> = 0,
    ): Operator<Pet> =>
    (context: EffectContext<EffectTrigger>, targets: Pet[]) => {
      targets.forEach((pet, targetIndex) => {
        const _stat = GetValueFromSource(context, stat)[0]
        const _maxValue = GetValueFromSource(context, maxValue)[0]
        const _priority = GetValueFromSource(context, priority)[0] ?? 0

        // Create a unique modifier ID
        const timestamp = Date.now()
        const random = Math.random().toString(36).substring(2, 11)
        const modifierId = `${context.source.id}_${_stat}_clampMax_${timestamp}_${targetIndex}_${random}`

        // Create the clampMax modifier
        const modifier = new Modifier(
          DurationType.binding,
          modifierId,
          _maxValue,
          'clampMax',
          _priority,
          context.source instanceof MarkInstanceImpl ? context.source : undefined,
        )

        // Add the modifier to the pet's attribute system
        const cleanup = pet.attributeSystem.addModifier(_stat, modifier)

        // If the effect source is a mark, bind the modifier lifecycle to the mark
        if (context.source instanceof MarkInstanceImpl) {
          context.source.addAttributeModifierCleanup(cleanup)
        }
      })
    },

  // New operator: Add clampMin modifier to limit minimum attribute value
  addClampMinModifier:
    (
      stat: ValueSource<StatTypeOnBattle>,
      minValue: ValueSource<number>,
      priority: ValueSource<number> = 0,
    ): Operator<Pet> =>
    (context: EffectContext<EffectTrigger>, targets: Pet[]) => {
      targets.forEach((pet, targetIndex) => {
        const _stat = GetValueFromSource(context, stat)[0]
        const _minValue = GetValueFromSource(context, minValue)[0]
        const _priority = GetValueFromSource(context, priority)[0] ?? 0

        // Create a unique modifier ID
        const timestamp = Date.now()
        const random = Math.random().toString(36).substring(2, 11)
        const modifierId = `${context.source.id}_${_stat}_clampMin_${timestamp}_${targetIndex}_${random}`

        // Create the clampMin modifier
        const modifier = new Modifier(
          DurationType.binding,
          modifierId,
          _minValue,
          'clampMin',
          _priority,
          context.source instanceof MarkInstanceImpl ? context.source : undefined,
        )

        // Add the modifier to the pet's attribute system
        const cleanup = pet.attributeSystem.addModifier(_stat, modifier)

        // If the effect source is a mark, bind the modifier lifecycle to the mark
        if (context.source instanceof MarkInstanceImpl) {
          context.source.addAttributeModifierCleanup(cleanup)
        }
      })
    },

  // New operator: Add clamp modifier to limit both minimum and maximum attribute values
  addClampModifier:
    (
      stat: ValueSource<StatTypeOnBattle>,
      minValue: ValueSource<number>,
      maxValue: ValueSource<number>,
      priority: ValueSource<number> = 0,
    ): Operator<Pet> =>
    (context: EffectContext<EffectTrigger>, targets: Pet[]) => {
      targets.forEach((pet, targetIndex) => {
        const _stat = GetValueFromSource(context, stat)[0]
        const _minValue = GetValueFromSource(context, minValue)[0]
        const _maxValue = GetValueFromSource(context, maxValue)[0]
        const _priority = GetValueFromSource(context, priority)[0] ?? 0

        // Create a unique modifier ID
        const timestamp = Date.now()
        const random = Math.random().toString(36).substring(2, 11)
        const modifierId = `${context.source.id}_${_stat}_clamp_${timestamp}_${targetIndex}_${random}`

        // Create the clamp modifier
        const modifier = new Modifier(
          DurationType.binding,
          modifierId,
          0, // Not used for clamp type
          'clamp',
          _priority,
          context.source instanceof MarkInstanceImpl ? context.source : undefined,
          _minValue, // minValue
          _maxValue, // maxValue
        )

        // Add the modifier to the pet's attribute system
        const cleanup = pet.attributeSystem.addModifier(_stat, modifier)

        // If the effect source is a mark, bind the modifier lifecycle to the mark
        if (context.source instanceof MarkInstanceImpl) {
          context.source.addAttributeModifierCleanup(cleanup)
        }
      })
    },

  amplifyPower:
    (multiplier: ValueSource<number>): Operator<UseSkillContext> =>
    (context: EffectContext<EffectTrigger>, contexts: UseSkillContext[]) => {
      contexts.forEach(skillCtx => {
        const finalMultiplier = GetValueFromSource(context, multiplier)
        finalMultiplier.forEach(v => skillCtx.amplifyPower(v))
      })
    },

  addPower:
    (value: ValueSource<number>): Operator<UseSkillContext> =>
    (context: EffectContext<EffectTrigger>, contexts: UseSkillContext[]) => {
      contexts.forEach(skillCtx => {
        const _value = GetValueFromSource(context, value)
        _value.forEach(v => skillCtx.addPower(v))
      })
    },

  addCritRate:
    (value: ValueSource<number>): Operator<UseSkillContext> =>
    (context: EffectContext<EffectTrigger>, contexts: UseSkillContext[]) => {
      contexts.forEach(skillCtx => {
        const _value = GetValueFromSource(context, value)
        _value.forEach(v => skillCtx.addCritRate(v))
      })
    },

  addMultihitResult:
    (value: ValueSource<number>): Operator<UseSkillContext> =>
    (context: EffectContext<EffectTrigger>, contexts: UseSkillContext[]) => {
      contexts.forEach(skillCtx => {
        const _value = GetValueFromSource(context, value)
        _value.forEach(v => skillCtx.addMultihitResult(v))
      })
    },

  setMultihit:
    (value: ValueSource<number | [number, number]>): Operator<UseSkillContext> =>
    (context: EffectContext<EffectTrigger>, contexts: UseSkillContext[]) => {
      contexts.forEach(skillCtx => {
        const finalValue = GetValueFromSource(context, value)
        if (finalValue.length > 0) {
          skillCtx.multihit = finalValue[0]
        }
      })
    },

  statStageBuff:
    (statType: ValueSource<StatTypeWithoutHp>, value: ValueSource<number>): Operator<Pet> =>
    (context: EffectContext<EffectTrigger>, target: Pet[]) => {
      const _value = GetValueFromSource(context, value)[0] ?? 0
      const _statType = GetValueFromSource(context, statType)[0] ?? null
      target.forEach(v => v.addStatStage(context, _statType, _value))
    },

  clearStatStage:
    (
      statType?: ValueSource<StatTypeWithoutHp>,
      cleanStageStrategy: CleanStageStrategy = CleanStageStrategy.positive,
    ): Operator<Pet> =>
    (context: EffectContext<EffectTrigger>, target: Pet[]) => {
      const _statTypes = statType ? GetValueFromSource(context, statType) : undefined
      if (!_statTypes) target.forEach(v => v.clearStatStage(context))
      else target.forEach(v => v.clearStatStage(context, cleanStageStrategy, ..._statTypes))
    },

  transferStatStage:
    (
      source: ValueSource<Pet>,
      target: ValueSource<Pet>,
      cleanStageStrategy: CleanStageStrategy = CleanStageStrategy.negative,
      statType?: ValueSource<StatTypeWithoutHp>,
    ): Operator<Pet> =>
    (context: EffectContext<EffectTrigger>, _: Pet[]) => {
      const _sources = GetValueFromSource(context, source)
      const _targets = GetValueFromSource(context, target)
      const _statTypes = statType ? GetValueFromSource(context, statType) : undefined

      if (_sources.length === 0 || _targets.length === 0) return

      const sourcePet = _sources[0]
      const targetPet = _targets[0]

      // Determine which stat types to transfer
      const statTypesToTransfer = _statTypes || [
        StatTypeWithoutHp.atk,
        StatTypeWithoutHp.def,
        StatTypeWithoutHp.spa,
        StatTypeWithoutHp.spd,
        StatTypeWithoutHp.spe,
      ]

      statTypesToTransfer.forEach(statType => {
        // Find all stat stage marks for this stat type on source pet
        const statStageMarks = sourcePet.marks.filter(
          mark => mark instanceof StatLevelMarkInstanceImpl && mark.statType === statType,
        ) as StatLevelMarkInstanceImpl[]

        statStageMarks.forEach(mark => {
          const stage = mark.level
          const shouldTransfer =
            cleanStageStrategy === CleanStageStrategy.all ||
            (cleanStageStrategy === CleanStageStrategy.positive && stage > 0) ||
            (cleanStageStrategy === CleanStageStrategy.negative && stage < 0)

          if (shouldTransfer) {
            // Add the same stage to target pet
            targetPet.addStatStage(context, statType, stage)

            // Remove the mark from source pet
            mark.destroy(new RemoveMarkContext(context, mark))
          }
        })
      })
    },

  setValue: <U extends SelectorOpinion, V extends PrimitiveOpinion>(
    value: ValueSource<V>,
  ): Operator<PropertyRef<U, V>> => {
    return (context, refs) => {
      const _value = GetValueFromSource(context, value)
      if (_value.length == 0) return
      refs.forEach(ref => ref.set(_value[0]))
    }
  },

  /** 数值累加操作 */
  addValue: (valueSource: ValueSource<number>): Operator<PropertyRef<any, number>> => {
    return (context, refs) => {
      const values = GetValueFromSource(context, valueSource)
      refs.forEach((ref, index) => {
        const delta = values[index % values.length]
        ref.set(ref.get() + delta)
      })
    }
  },

  /** 布尔值翻转 */
  toggle: (): Operator<PropertyRef<any, boolean>> => {
    return (context, refs) => {
      refs.forEach(ref => ref.set(!ref.get()))
    }
  },

  stun: (): Operator<UseSkillContext> => {
    return (context, contexts) => {
      contexts.forEach(ctx => {
        ctx.available = false
      })
    }
  },

  setSureHit: (priority?: number): Operator<UseSkillContext> => {
    return (context, contexts) => {
      contexts.forEach(ctx => {
        ctx.setSureHit(priority)
      })
    }
  },

  setSureCrit: (priority?: number): Operator<UseSkillContext> => {
    return (context, contexts) => {
      contexts.forEach(ctx => {
        ctx.setSureCrit(priority)
      })
    }
  },

  setSureMiss: (priority?: number): Operator<UseSkillContext> => {
    return (context, contexts) => {
      contexts.forEach(ctx => {
        ctx.setSureMiss(priority)
      })
    }
  },

  setSureNoCrit: (priority?: number): Operator<UseSkillContext> => {
    return (context, contexts) => {
      contexts.forEach(ctx => {
        ctx.setSureNoCrit(priority)
      })
    }
  },

  setSkill: (skill: ValueSource<SkillInstance>): Operator<UseSkillContext> => {
    return (context, contexts) => {
      const _skill = GetValueFromSource(context, skill)
      if (_skill.length === 0) return
      contexts.forEach(ctx => {
        ctx.setSkill(_skill[0])
      })
    }
  },

  preventDamage: (): Operator<DamageContext> => {
    return (context, contexts) => {
      contexts.forEach(ctx => {
        ctx.available = false
      })
    }
  },

  setActualTarget: (newTarget: ValueSource<Pet>): Operator<UseSkillContext> => {
    return (context, contexts) => {
      const _target = GetValueFromSource(context, newTarget)
      if (_target.length === 0) return
      contexts.forEach(ctx => {
        ctx.setActualTarget(_target[0])
      })
    }
  },

  addModified: (
    percent: ValueSource<number>,
    delta: ValueSource<number>,
  ): Operator<DamageContext | HealContext | RageContext> => {
    return (context, contexts) => {
      const _percent = GetValueFromSource(context, percent)
      const _delta = GetValueFromSource(context, delta)
      if (_percent.length === 0 || _delta.length === 0) return
      contexts.forEach(ctx => {
        ctx.addModified(_percent[0], _delta[0])
      })
    }
  },

  addThreshold: (min?: ValueSource<number>, max?: ValueSource<number>): Operator<DamageContext> => {
    return (context: EffectContext<EffectTrigger>, contexts: DamageContext[]) => {
      const _min = min ? GetValueFromSource(context, min)[0] : undefined
      const _max = max ? GetValueFromSource(context, max)[0] : undefined
      if (!(typeof _min === 'number') && !(typeof _max === 'number')) return
      contexts.forEach(ctx => {
        ctx.addThreshold(_min, _max)
      })
    }
  },

  /** 覆盖标记配置 */
  overrideMarkConfig: (config: Partial<MarkInstance['config']>): Operator<AddMarkContext> => {
    return (context, targets) => {
      targets.forEach((target, index) => {
        target.overrideConfig(config)
      })
    }
  },

  /** 设置标记持续时间 */
  setMarkDuration: (duration: ValueSource<number>): Operator<AddMarkContext> => {
    return (context, targets) => {
      const durations = GetValueFromSource(context, duration)
      targets.forEach((target, index) => {
        const dur = durations[index % durations.length]
        if (dur !== undefined) target.setDuration(dur)
      })
    }
  },

  /** 设置初始堆叠数 */
  setMarkStack: (stack: ValueSource<number>): Operator<AddMarkContext> => {
    return (context, targets) => {
      const stacks = GetValueFromSource(context, stack)
      targets.forEach((target, index) => {
        const stk = stacks[index % stacks.length]
        if (stk !== undefined) target.setStack(stk)
      })
    }
  },

  /** 设置最大堆叠数 */
  setMarkMaxStack: (maxStack: ValueSource<number>): Operator<AddMarkContext> => {
    return (context, targets) => {
      const maxStacks = GetValueFromSource(context, maxStack)
      targets.forEach((target, index) => {
        const max = maxStacks[index % maxStacks.length]
        if (max !== undefined) target.setMaxStack(max)
      })
    }
  },

  /** 设置是否持久化 */
  setMarkPersistent: (persistent: ValueSource<boolean>): Operator<AddMarkContext> => {
    return (context, targets) => {
      const persistValues = GetValueFromSource(context, persistent)
      targets.forEach((target, index) => {
        const value = persistValues[index % persistValues.length]
        if (typeof value === 'boolean') target.setPersistent(value)
      })
    }
  },

  setMarkStackable: (stackable: ValueSource<boolean>): Operator<AddMarkContext> => {
    return (context, targets) => {
      const values = GetValueFromSource(context, stackable)
      targets.forEach((target, index) => {
        const value = values[index % values.length]
        if (typeof value === 'boolean') {
          target.setStackable(value)
        }
      })
    }
  },

  /** 设置堆叠策略 */
  setMarkStackStrategy: (strategy: ValueSource<StackStrategy>): Operator<AddMarkContext> => {
    return (context, targets) => {
      const strategies = GetValueFromSource(context, strategy)
      targets.forEach((target, index) => {
        const strat = strategies[index % strategies.length]
        if (strat) target.setStackStrategy(strat)
      })
    }
  },

  /** 设置StatLevelMark的等级 */
  setStatLevelMarkLevel: (level: ValueSource<number>): Operator<AddMarkContext> => {
    return (context, targets) => {
      const levels = GetValueFromSource(context, level)
      targets.forEach((target, index) => {
        const lvl = levels[index % levels.length]
        if (lvl !== undefined && target.baseMark instanceof BaseStatLevelMark) {
          // 创建一个新的BaseStatLevelMark实例，使用修改后的level
          const newBaseMark = new BaseStatLevelMark(target.baseMark.statType, lvl, target.baseMark.id)
          target.baseMark = newBaseMark
          // 同时更新stack值以保持一致性
          target.stack = Math.abs(lvl)
        }
      })
    }
  },

  setMarkDestroyable: (destroyable: ValueSource<boolean>): Operator<AddMarkContext> => {
    return (context, targets) => {
      const values = GetValueFromSource(context, destroyable)
      targets.forEach((target, index) => {
        const value = values[index % values.length]
        if (typeof value === 'boolean') {
          target.setDestroyable(value)
        }
      })
    }
  },

  /** 设置是否为护盾 */
  setMarkIsShield: (isShield: ValueSource<boolean>): Operator<AddMarkContext> => {
    return (context, targets) => {
      const shieldValues = GetValueFromSource(context, isShield)
      targets.forEach((target, index) => {
        const value = shieldValues[index % shieldValues.length]
        if (typeof value === 'boolean') target.setIsShield(value)
      })
    }
  },

  setMarkKeepOnSwitchOut: (keep: ValueSource<boolean>): Operator<AddMarkContext> => {
    return (context, targets) => {
      const values = GetValueFromSource(context, keep)
      targets.forEach((target, index) => {
        const value = values[index % values.length]
        if (typeof value === 'boolean') {
          target.setKeepOnSwitchOut(value)
        }
      })
    }
  },

  setMarkTransferOnSwitch: (transfer: ValueSource<boolean>): Operator<AddMarkContext> => {
    return (context, targets) => {
      const values = GetValueFromSource(context, transfer)
      targets.forEach((target, index) => {
        const value = values[index % values.length]
        if (typeof value === 'boolean') {
          target.setTransferOnSwitch(value)
        }
      })
    }
  },

  setMarkInheritOnFaint: (inherit: ValueSource<boolean>): Operator<AddMarkContext> => {
    return (context, targets) => {
      const values = GetValueFromSource(context, inherit)
      targets.forEach((target, index) => {
        const value = values[index % values.length]
        if (typeof value === 'boolean') {
          target.setInheritOnFaint(value)
        }
      })
    }
  },

  setConfig: (key: ValueSource<string>, value: ValueSource<ConfigValue>): Operator<ScopeObject> => {
    return (context, targets) => {
      const _value = GetValueFromSource(context, value)
      const _key = GetValueFromSource(context, key)
      if (_value.length === 0 || _key.length === 0) return
      targets.forEach(t => context.battle.configSystem.set(_key[0], _value[0], t))
    }
  },

  setIgnoreStageStrategy: (strategy: ValueSource<IgnoreStageStrategy>): Operator<UseSkillContext> => {
    return (context, contexts) => {
      const strategies = GetValueFromSource(context, strategy)
      contexts.forEach((ctx, index) => {
        const strat = strategies[index % strategies.length]
        if (strat) ctx.setIgnoreStageStrategy(strat)
      })
    }
  },

  addAccuracy: (value: ValueSource<number>): Operator<UseSkillContext> => {
    return (context, contexts) => {
      const _value = GetValueFromSource(context, value)
      if (_value.length === 0) return
      contexts.forEach(ctx => {
        ctx.addAccuracy(_value[0])
      })
    }
  },

  setAccuracy: (value: ValueSource<number>): Operator<UseSkillContext> => {
    return (context, contexts) => {
      const _value = GetValueFromSource(context, value)
      if (_value.length === 0) return
      contexts.forEach(ctx => {
        ctx.setAccuracy(_value[0])
      })
    }
  },

  disableContext: <T extends { available: boolean }>(): Operator<T> => {
    return (context, contexts) => {
      contexts.forEach(ctx => {
        ctx.available = false
      })
    }
  },

  // New operator: Add attribute modifier to skills
  addSkillAttributeModifier:
    (
      attribute: ValueSource<'power' | 'accuracy' | 'rage' | 'priority'>,
      modifierType: ValueSource<'percent' | 'delta' | 'override'>,
      value: ValueSource<number>,
      priority: ValueSource<number> = 0,
    ): Operator<SkillInstance> =>
    (context: EffectContext<EffectTrigger>, targets: SkillInstance[]) => {
      targets.forEach((skill, targetIndex) => {
        const _attribute = GetValueFromSource(context, attribute)[0]
        const _modifierType = GetValueFromSource(context, modifierType)[0]
        const _value = GetValueFromSource(context, value)[0]
        const _priority = GetValueFromSource(context, priority)[0] ?? 0

        // Create a unique modifier ID with better uniqueness guarantees
        const timestamp = Date.now()
        const random = Math.random().toString(36).substring(2, 11)
        const modifierId = `${context.source.id}_skill_${_attribute}_${_modifierType}_${timestamp}_${targetIndex}_${random}`

        // Create the modifier
        const modifier = new Modifier(
          DurationType.binding,
          modifierId,
          _value,
          _modifierType,
          _priority,
          context.source instanceof MarkInstanceImpl ? context.source : skill,
        )

        // Add the modifier to the skill's attribute system
        const cleanup = skill.attributeSystem.addModifier(_attribute, modifier)

        // If the effect source is a mark, bind the modifier lifecycle to the mark
        if (context.source instanceof MarkInstanceImpl) {
          context.source.addAttributeModifierCleanup(cleanup)
        }
      })
    },

  // New operator: Add dynamic attribute modifier to skills using Observable value source
  addDynamicSkillAttributeModifier:
    (
      attribute: ValueSource<'power' | 'accuracy' | 'rage' | 'priority'>,
      modifierType: ValueSource<'percent' | 'delta' | 'override'>,
      observableValue: ValueSource<Observable<number>>,
      priority: ValueSource<number> = 0,
    ): Operator<SkillInstance> =>
    (context: EffectContext<EffectTrigger>, targets: SkillInstance[]) => {
      targets.forEach((skill, targetIndex) => {
        const _attribute = GetValueFromSource(context, attribute)[0]
        const _modifierType = GetValueFromSource(context, modifierType)[0]
        const _observableValue = GetValueFromSource(context, observableValue)[0]
        const _priority = GetValueFromSource(context, priority)[0] ?? 0

        // Create a unique modifier ID
        const timestamp = Date.now()
        const random = Math.random().toString(36).substring(2, 11)
        const modifierId = `${context.source.id}_skill_${_attribute}_${_modifierType}_dynamic_${timestamp}_${targetIndex}_${random}`

        // Create the modifier with Observable value
        const modifier = new Modifier(
          DurationType.binding,
          modifierId,
          _observableValue,
          _modifierType,
          _priority,
          context.source instanceof MarkInstanceImpl ? context.source : skill,
        )

        // Add the modifier to the skill's attribute system
        const cleanup = skill.attributeSystem.addModifier(_attribute, modifier)

        // If the effect source is a mark, bind the modifier lifecycle to the mark
        if (context.source instanceof MarkInstanceImpl) {
          context.source.addAttributeModifierCleanup(cleanup)
        }
      })
    },

  // New operator: Add clampMax modifier to limit maximum skill attribute value
  addSkillClampMaxModifier:
    (
      attribute: ValueSource<'power' | 'accuracy' | 'rage' | 'priority'>,
      maxValue: ValueSource<number>,
      priority: ValueSource<number> = 0,
    ): Operator<SkillInstance> =>
    (context: EffectContext<EffectTrigger>, targets: SkillInstance[]) => {
      targets.forEach((skill, targetIndex) => {
        const _attribute = GetValueFromSource(context, attribute)[0]
        const _maxValue = GetValueFromSource(context, maxValue)[0]
        const _priority = GetValueFromSource(context, priority)[0] ?? 0

        // Create a unique modifier ID
        const timestamp = Date.now()
        const random = Math.random().toString(36).substring(2, 11)
        const modifierId = `${context.source.id}_skill_${_attribute}_clampMax_${timestamp}_${targetIndex}_${random}`

        // Create the clampMax modifier
        const modifier = new Modifier(
          DurationType.binding,
          modifierId,
          _maxValue,
          'clampMax',
          _priority,
          context.source instanceof MarkInstanceImpl ? context.source : skill,
        )

        // Add the modifier to the skill's attribute system
        const cleanup = skill.attributeSystem.addModifier(_attribute, modifier)

        // If the effect source is a mark, bind the modifier lifecycle to the mark
        if (context.source instanceof MarkInstanceImpl) {
          context.source.addAttributeModifierCleanup(cleanup)
        }
      })
    },

  // New operator: Add clampMin modifier to limit minimum skill attribute value
  addSkillClampMinModifier:
    (
      attribute: ValueSource<'power' | 'accuracy' | 'rage' | 'priority'>,
      minValue: ValueSource<number>,
      priority: ValueSource<number> = 0,
    ): Operator<SkillInstance> =>
    (context: EffectContext<EffectTrigger>, targets: SkillInstance[]) => {
      targets.forEach((skill, targetIndex) => {
        const _attribute = GetValueFromSource(context, attribute)[0]
        const _minValue = GetValueFromSource(context, minValue)[0]
        const _priority = GetValueFromSource(context, priority)[0] ?? 0

        // Create a unique modifier ID
        const timestamp = Date.now()
        const random = Math.random().toString(36).substring(2, 11)
        const modifierId = `${context.source.id}_skill_${_attribute}_clampMin_${timestamp}_${targetIndex}_${random}`

        // Create the clampMin modifier
        const modifier = new Modifier(
          DurationType.binding,
          modifierId,
          _minValue,
          'clampMin',
          _priority,
          context.source instanceof MarkInstanceImpl ? context.source : skill,
        )

        // Add the modifier to the skill's attribute system
        const cleanup = skill.attributeSystem.addModifier(_attribute, modifier)

        // If the effect source is a mark, bind the modifier lifecycle to the mark
        if (context.source instanceof MarkInstanceImpl) {
          context.source.addAttributeModifierCleanup(cleanup)
        }
      })
    },

  // New operator: Add clamp modifier to limit both minimum and maximum skill attribute values
  addSkillClampModifier:
    (
      attribute: ValueSource<'power' | 'accuracy' | 'rage' | 'priority'>,
      minValue: ValueSource<number>,
      maxValue: ValueSource<number>,
      priority: ValueSource<number> = 0,
    ): Operator<SkillInstance> =>
    (context: EffectContext<EffectTrigger>, targets: SkillInstance[]) => {
      targets.forEach((skill, targetIndex) => {
        const _attribute = GetValueFromSource(context, attribute)[0]
        const _minValue = GetValueFromSource(context, minValue)[0]
        const _maxValue = GetValueFromSource(context, maxValue)[0]
        const _priority = GetValueFromSource(context, priority)[0] ?? 0

        // Create a unique modifier ID
        const timestamp = Date.now()
        const random = Math.random().toString(36).substring(2, 11)
        const modifierId = `${context.source.id}_skill_${_attribute}_clamp_${timestamp}_${targetIndex}_${random}`

        // Create the clamp modifier
        const modifier = new Modifier(
          DurationType.binding,
          modifierId,
          0, // Not used for clamp type
          'clamp',
          _priority,
          context.source instanceof MarkInstanceImpl ? context.source : skill,
          _minValue, // minValue
          _maxValue, // maxValue
        )

        // Add the modifier to the skill's attribute system
        const cleanup = skill.attributeSystem.addModifier(_attribute, modifier)

        // If the effect source is a mark, bind the modifier lifecycle to the mark
        if (context.source instanceof MarkInstanceImpl) {
          context.source.addAttributeModifierCleanup(cleanup)
        }
      })
    },
}

export function GetValueFromSource<T extends SelectorOpinion>(
  context: EffectContext<EffectTrigger>,
  source: ValueSource<T>,
): T[] {
  if (source instanceof ChainableSelector) {
    const result = source.build()(context)
    return result
  }
  if (source && typeof source === 'object' && 'condition' in source) {
    const condSource = source as ConditionalValueSource<T>
    return condSource.condition(context)
      ? GetValueFromSource(context, condSource.trueValue)
      : condSource.falseValue
        ? GetValueFromSource(context, condSource.falseValue)
        : []
  }
  if (typeof source == 'function') return source(context) //TargetSelector
  if (Array.isArray(source)) return source.map(v => GetValueFromSource(context, v)[0]) as T[]
  if (source && typeof source === 'object' && 'configId' in source) {
    const _source = source as ConfigValueSource<T>
    return [ConfigSystem.getInstance().get(_source.configId, context.source) ?? _source.defaultValue] as T[]
  }
  return [source]
}
