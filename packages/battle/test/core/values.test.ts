import { beforeAll, expect, it } from 'vitest'
import {
  createBattle,
  restoreBattle,
  replayBattle,
  EffectRegistry,
  defineEffect,
  EffectTrigger,
  Modifier,
  DurationType,
  ConfigModifier,
  ConfigModifierType,
  ConfigDurationType,
  PhaseType,
  PhaseScope,
  computed,
  type Battle,
  type BattleContent,
  type TrustedEffect,
  type TrustedValue,
} from '@arcadia-eternity/battle/core'
import { basicOptions, officialContent, skillAction } from './official.js'
let original: BattleContent
beforeAll(async () => {
  original = await officialContent()
})
function setup(
  run: (battle: Battle) => void,
  extra: readonly TrustedEffect[] = [],
  values: readonly TrustedValue[] = [],
) {
  const content = structuredClone(original),
    options = basicOptions()
  content.skills.forEach(skill => {
    skill.effects = []
    skill.sureHit = true
  })
  content.marks[0].config.persistent = true
  content.marks[0].config.duration = -1
  const effect = defineEffect({
    id: 'values',
    version: '1',
    triggers: [EffectTrigger.OnBattleStart],
    execute(ctx) {
      run(ctx.battle)
    },
  })
  content.marks[0].effects = [effect, ...extra].map(effect => ({ id: effect.id, version: effect.version, params: {} }))
  options.players[0].team[0].ability = content.marks[0].id
  options.players.forEach(player =>
    player.team.forEach(pet => {
      pet.maxHp = 1000
    }),
  )
  return { content, options, registry: new EffectRegistry([effect, ...extra], values) }
}
it('orders numeric modifiers with native stages, preserves typed boolean attributes, and cleans their source', () => {
  const input = setup(battle => {
    const pet = battle.playerA.activePet,
      source = pet.marks[0],
      base = pet.stat.atk
    pet.attributeSystem.addModifier('atk', new Modifier(DurationType.binding, 'delta', 10, 'delta', 10, source))
    pet.attributeSystem.addModifier('atk', new Modifier(DurationType.binding, 'percent', 50, 'percent', -10, source))
    battle.addStatStage(pet, 'atk', 1)
    expect(pet.stat.atk).toBe((base + 10) * 1.5 * 1.5)
    pet.skills[0].attributeSystem.addModifier(
      'appeared',
      new Modifier(DurationType.binding, 'visible', true, 'override', 0, source),
    )
    expect(pet.skills[0].appeared).toBe(true)
    battle.removeMark(source, true)
    expect(pet.stat.atk).toBe(base * 1.5)
    expect(pet.skills[0].appeared).toBe(false)
  })
  createBattle(input.options, input.content, input.registry).start()
})
it.each(['delta', 'percent', 'override', 'clampMax', 'clampMin', 'clamp'] as const)(
  'applies numeric %s with explicit priority and bounds',
  type => {
    const input = setup(battle => {
      const skill = battle.playerA.activePet.skills[0]
      skill.power = 40
      skill.attributeSystem.addModifier(
        'power',
        new Modifier(DurationType.instant, 'arithmetic', 50, type, 0, undefined, 10, 30),
      )
      expect(skill.power).toBe({ delta: 90, percent: 60, override: 50, clampMax: 40, clampMin: 50, clamp: 30 }[type])
    })
    createBattle(input.options, input.content, input.registry).start()
  },
)
it('retains inherited config bases, scoped modifiers and config tags without affecting the opposing pet', () => {
  const input = setup(battle => {
    const config = battle.configSystem,
      pet = battle.playerA.activePet,
      source = pet.marks[0]
    config.registerTaggedConfig('amount', 10, ['damage'])
    config.set('amount', 20, battle.playerA)
    config.set('amount', 30, pet)
    config.addConfigModifier(
      'amount',
      new ConfigModifier(ConfigDurationType.binding, 'boost', 5, ConfigModifierType.delta, 0, source),
    )
    expect(config.get('amount')).toBe(10)
    expect(config.get('amount', battle.playerA)).toBe(20)
    expect(config.get('amount', pet.skills[0])).toBe(35)
    expect(config.get('amount', battle.playerB.activePet)).toBe(10)
    config.addTaggedConfigModifier(
      'damage',
      new ConfigModifier(ConfigDurationType.instant, 'global', 2, ConfigModifierType.delta),
    )
    expect(config.get('amount', pet)).toBe(37)
    config.removeConfigTags('amount', ['damage'])
    expect(config.getConfigKeysByTag('damage')).toEqual([])
    battle.removeMark(source, true)
    expect(config.get('amount', pet)).toBe(32)
  })
  const battle = createBattle(input.options, input.content, input.registry)
  battle.start()
  expect(
    restoreBattle(JSON.parse(JSON.stringify(battle.snapshot())), input.content, input.registry).snapshot(),
  ).toEqual(battle.snapshot())
})
it('applies string config operations in priority order and preserves null/boolean config values', () => {
  const input = setup(battle => {
    const config = battle.configSystem
    config.registerConfig('text', 'middle')
    config.registerConfig('flag', false)
    config.registerConfig('empty', null)
    config.addConfigModifier(
      'text',
      new ConfigModifier(ConfigDurationType.instant, 'prepend', 'pre-', ConfigModifierType.prepend, 10),
    )
    config.addConfigModifier(
      'text',
      new ConfigModifier(ConfigDurationType.instant, 'append', '-post', ConfigModifierType.append),
    )
    config.addConfigModifier(
      'flag',
      new ConfigModifier(ConfigDurationType.instant, 'boolean', true, ConfigModifierType.override),
    )
    expect(config.get('text')).toBe('pre-middle-post')
    expect(config.get('flag')).toBe(true)
    expect(config.get('empty')).toBeNull()
  })
  createBattle(input.options, input.content, input.registry).start()
})
it('evaluates live source attribute references and mutable values instead of freezing an initial sample', () => {
  const input = setup(battle => {
    const pet = battle.playerA.activePet,
      source = pet.marks[0],
      skill = pet.skills[0],
      base = skill.power
    source.config.maxStacks = 10
    source.stack = 2
    const modifier = new Modifier(
      DurationType.binding,
      'live',
      source.attributeSystem.reference('stack'),
      'delta',
      0,
      source,
    )
    skill.attributeSystem.addModifier('power', modifier)
    expect(skill.power).toBe(base + 2)
    source.stack = 5
    expect(skill.power).toBe(base + 5)
    modifier.value.next(9)
    expect(skill.power).toBe(base + 9)
    battle.removeMark(source, true)
    expect(skill.power).toBe(base)
  })
  createBattle(input.options, input.content, input.registry).start()
})
it('rehydrates config references and versioned computed values, preserving action replay', () => {
  const value: TrustedValue<number> = {
    id: 'times-stack',
    version: '1',
    evaluate(battle, params) {
      const pet = battle.getPetByID(params.pet as string)
      return pet.marks[0].stack * 3
    },
  }
  const input = setup(
    battle => {
      const pet = battle.playerA.activePet,
        source = pet.marks[0],
        config = battle.configSystem
      config.registerConfig('power', 20)
      pet.skills[0].attributeSystem.addModifier(
        'power',
        new Modifier(DurationType.binding, 'config-power', config.numberReference('power', pet), 'delta', 0, source),
      )
      pet.attributeSystem.addModifier(
        'atk',
        new Modifier(
          DurationType.binding,
          'computed',
          computed<number>('times-stack', '1', { pet: pet.id }),
          'delta',
          0,
          source,
        ),
      )
    },
    [],
    [value],
  )
  const battle = createBattle(input.options, input.content, input.registry)
  battle.start()
  const restored = restoreBattle(JSON.parse(JSON.stringify(battle.snapshot())), input.content, input.registry)
  for (const instance of [battle, restored]) {
    instance.submitAction(skillAction(instance, 'A'))
    instance.submitAction(skillAction(instance, 'B'))
  }
  expect(restored.snapshot()).toEqual(battle.snapshot())
  expect(replayBattle(battle.exportReplay(), input.content, input.registry).snapshot()).toEqual(battle.snapshot())
  expect(() =>
    restoreBattle(
      battle.snapshot(),
      input.content,
      new EffectRegistry([
        defineEffect({ id: 'values', version: '1', triggers: [EffectTrigger.OnBattleStart], execute() {} }),
      ]),
    ),
  ).toThrow('Missing trusted value')
})
it('keeps a current-turn modifier across atomic save boundaries and expires it at logical turn completion', () => {
  const effect = defineEffect({
    id: 'turn-value',
    version: '1',
    triggers: [EffectTrigger.TurnStart],
    execute(ctx) {
      const skill = ctx.battle.playerA.activePet.skills[0]
      skill.attributeSystem.addPhaseTypeModifier(
        'power',
        new Modifier(DurationType.phaseType, 'turn-power', 5, 'delta'),
        { phaseType: PhaseType.Turn, scope: PhaseScope.Current },
      )
    },
  })
  const input = setup(() => {}, [effect])
  let battle = createBattle(input.options, input.content, input.registry)
  battle.start()
  const base = battle.playerA.activePet.skills[0].power
  battle.submitAction(skillAction(battle, 'A'), false)
  battle.submitAction(skillAction(battle, 'B'), false)
  while (battle.phase.kind !== 'action') battle.advance()
  battle = restoreBattle(JSON.parse(JSON.stringify(battle.snapshot())), input.content, input.registry)
  expect(battle.playerA.activePet.skills[0].power).toBe(base + 5)
  battle.advance()
  battle = restoreBattle(JSON.parse(JSON.stringify(battle.snapshot())), input.content, input.registry)
  expect(battle.playerA.activePet.skills[0].power).toBe(base + 5)
  while (battle.advance()) {
    /* turn end */
  }
  expect(battle.playerA.activePet.skills[0].power).toBe(base)
})
it('binds Next to the following matching phase, skipping the phase in which it was created', () => {
  const values: number[] = []
  const effect = defineEffect({
    id: 'next-value',
    version: '1',
    triggers: [EffectTrigger.OnBeforeCalculateDamage],
    execute(ctx) {
      const skill = ctx.battle.playerA.activePet.skills[0]
      if (values.length === 0)
        skill.attributeSystem.addPhaseTypeModifier(
          'power',
          new Modifier(DurationType.phaseType, 'next-damage', 50, 'delta'),
          { phaseType: PhaseType.Damage, scope: PhaseScope.Next },
        )
      values.push(skill.power)
    },
  })
  const input = setup(() => {}, [effect]),
    battle = createBattle(input.options, input.content, input.registry)
  battle.start()
  const base = battle.playerA.activePet.skills[0].power
  battle.submitAction(skillAction(battle, 'A'))
  battle.submitAction(skillAction(battle, 'B'))
  expect(values).toEqual([base, base + 50])
  expect(battle.playerA.activePet.skills[0].power).toBe(base)
})
it('expires phase-scoped configs and config modifiers when the concrete phase completes', () => {
  const effect = defineEffect({
    id: 'phase-config',
    version: '1',
    triggers: [EffectTrigger.OnHit],
    execute(ctx) {
      const phase = ctx.battle.phaseManager.getActivePhases().at(-1)!
      phase.addConfigModifier('amount', ConfigModifierType.delta, 5)
      ctx.battle.configSystem.set('amount', 30, phase)
      expect(ctx.battle.configSystem.get('amount', phase)).toBe(35)
    },
  })
  const input = setup(battle => battle.configSystem.registerConfig('amount', 10), [effect]),
    battle = createBattle(input.options, input.content, input.registry)
  battle.start()
  battle.submitAction(skillAction(battle, 'A'))
  battle.submitAction(skillAction(battle, 'B'))
  expect(battle.configSystem.get('amount')).toBe(10)
  expect(battle.snapshot().state.config!.scoped).toEqual([])
  expect(battle.snapshot().state.config!.modifiers).toEqual([])
})
it('rolls back registered configs and modifiers together with a failing effect', () => {
  const input = setup(battle => {
      battle.configSystem.registerConfig('value', 10)
      const pet = battle.playerA.activePet
      pet.attributeSystem.addModifier(
        'atk',
        new Modifier(DurationType.binding, 'failed', 100, 'delta', 0, pet.marks[0]),
      )
      throw new Error('rollback value system')
    }),
    battle = createBattle(input.options, input.content, input.registry),
    before = battle.snapshot()
  expect(() => battle.start()).toThrow('rollback value system')
  expect(battle.snapshot()).toEqual(before)
})
it('rejects cyclic live references rather than producing nondeterministic fallbacks', () => {
  const input = setup(battle => {
      const skill = battle.playerA.activePet.skills[0]
      skill.attributeSystem.addModifier(
        'power',
        new Modifier(DurationType.instant, 'recursive', skill.attributeSystem.reference('power'), 'delta'),
      )
      void skill.power
    }),
    battle = createBattle(input.options, input.content, input.registry),
    before = battle.snapshot()
  expect(() => battle.start()).toThrow('Cyclic value dependency')
  expect(battle.snapshot()).toEqual(before)
})
it.each(['source', 'reference', 'duration', 'attribute', 'phase'] as const)(
  'rejects malformed modifier snapshot: %s',
  field => {
    const input = setup(battle => {
        const pet = battle.playerA.activePet
        pet.skills[0].attributeSystem.addModifier(
          'power',
          new Modifier(DurationType.binding, 'saved', 10, 'delta', 0, pet.marks[0]),
        )
      }),
      battle = createBattle(input.options, input.content, input.registry)
    battle.start()
    const snapshot = battle.snapshot(),
      row = snapshot.state.players[0].team[0].skills[0].attributes!.modifiers[0]
    if (field === 'source') row.source!.id = '@mark/9000'
    if (field === 'reference') row.value = { kind: 'computed', id: 'missing', version: '1', params: {} }
    if (field === 'duration') row.durationType = 'phase'
    if (field === 'attribute') row.key = 'missing'
    if (field === 'phase') {
      row.durationType = 'phaseType'
      row.phaseTypeSpec = { phaseType: PhaseType.Damage, scope: PhaseScope.Current }
      row.boundPhaseId = '@phase/9999'
    }
    expect(() => restoreBattle(snapshot, input.content, input.registry)).toThrow()
  },
)
it('resolves trusted effect parameters through their namespaced scoped config values', () => {
  const parameters: unknown[] = []
  const skillEffect = defineEffect({
    id: 'skill-param',
    version: '1',
    triggers: [EffectTrigger.OnHit],
    execute(ctx) {
      parameters.push(ctx.getConfigValue('power'))
    },
  })
  const input = setup(battle => {
    const pet = battle.playerA.activePet
    battle.configSystem.registerConfig('skill-param.power', 10)
    battle.configSystem.addScopedConfigModifier(
      'skill-param.power',
      new ConfigModifier(ConfigDurationType.binding, 'emblem-boost', 5, ConfigModifierType.delta, 0, pet.marks[0]),
      pet,
    )
  })
  input.content.skills.forEach(skill => {
    skill.effects = [{ id: 'skill-param', version: '1', params: { power: 10 } }]
  })
  input.registry = new EffectRegistry([input.registry.resolve({ id: 'values', version: '1', params: {} }), skillEffect])
  const battle = createBattle(input.options, input.content, input.registry)
  battle.start()
  battle.submitAction(skillAction(battle, 'A'))
  battle.submitAction(skillAction(battle, 'B'))
  expect(parameters.sort()).toEqual([10, 15])
})
it('preserves independent attribute modifiers while a skill transforms and restores its base', () => {
  const input = setup(battle => {
    const pet = battle.playerA.activePet,
      skill = pet.skills[0]
    skill.attributeSystem.addModifier(
      'power',
      new Modifier(DurationType.binding, 'percent-through-form', 50, 'percent', 0, pet.marks[0]),
    )
    const id = battle.transform(skill, battle.content.skill('form-skill'))!
    expect(skill.power).toBe(90)
    battle.endTransformation(skill, id)
    expect(skill.power).toBe(60)
  })
  input.content.skills.push({ ...structuredClone(input.content.skills[0]), id: 'form-skill', power: 60 })
  createBattle(input.options, input.content, input.registry).start()
})
