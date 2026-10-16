import { beforeAll, expect, it } from 'vitest'
import {
  createBattle,
  restoreBattle,
  replayBattle,
  EffectRegistry,
  defineEffect,
  EffectTrigger,
  TransformContext,
  TransformEndContext,
  TransformPhase,
  TransformEndPhase,
  RemoveMarkContext,
  type Battle,
  type BattleContent,
  type TrustedEffect,
  type TransformOptions,
} from '@arcadia-eternity/battle/core'
import { basicOptions, officialContent, skillAction } from './official.js'
let original: BattleContent
beforeAll(async () => {
  original = await officialContent()
})
function setup(run: (battle: Battle) => void, extra: readonly TrustedEffect[] = []) {
  const content = structuredClone(original),
    options = basicOptions()
  content.species.forEach(species => {
    species.abilityIds = []
    species.emblemIds = []
  })
  content.skills.forEach(skill => {
    skill.effects = []
    skill.sureHit = true
  })
  content.marks.forEach(mark => {
    mark.effects = []
    mark.config.duration = -1
    mark.config.persistent = true
  })
  const control = {
    ...structuredClone(content.marks[0]),
    id: 'control',
    effects: [{ id: 'run', version: '1', params: {} }],
  }
  const formMark = { ...structuredClone(content.marks[0]), id: 'form-mark' }
  const formSkill = { ...structuredClone(content.skills[0]), id: 'form-skill', power: 99 }
  const form = {
    ...structuredClone(content.species[0]),
    id: 'form',
    baseStats: { ...content.species[0].baseStats, hp: 200 },
    abilityIds: ['form-mark'],
  }
  content.marks.push(control, formMark)
  content.skills.push(formSkill)
  content.species.push(form)
  options.players[0].team[0].ability = 'control'
  const effect = defineEffect({
    id: 'run',
    version: '1',
    triggers: [EffectTrigger.OnBattleStart],
    execute(ctx) {
      run(ctx.battle)
    },
  })
  return { content, options, registry: new EffectRegistry([effect, ...extra]) }
}
function transform(battle: Battle, baseId = 'form', options: TransformOptions = {}) {
  const pet = battle.playerA.activePet
  return battle.transform(new TransformContext(battle, pet, pet.base, battle.content.species(baseId), options))!
}
function end(battle: Battle, id?: string) {
  return battle.endTransformation(new TransformEndContext(battle, battle.playerA.activePet, id))
}
it('executes concrete transform/end phases and typed lifecycle hooks exactly once', () => {
  const order: string[] = []
  const hook = defineEffect({
    id: 'hooks',
    version: '1',
    triggers: [
      EffectTrigger.BeforeTransform,
      EffectTrigger.OnTransform,
      EffectTrigger.AfterTransform,
      EffectTrigger.OnTransformEnd,
    ],
    execute(ctx) {
      order.push(ctx.trigger)
      if (ctx.parent instanceof TransformEndContext) expect(ctx.parent.record?.id).toBe('@transform/0')
      else expect(ctx.parent).toBeInstanceOf(TransformContext)
    },
  })
  const input = setup(
    battle => {
      const id = transform(battle)
      expect(end(battle, id)).toBe(true)
    },
    [hook],
  )
  input.content.marks.find(m => m.id === 'control')!.effects.push({ id: 'hooks', version: '1', params: {} })
  const battle = createBattle(input.options, input.content, input.registry)
  const classes: unknown[] = []
  battle.phaseManager.onExecutionEvent(phase => classes.push(phase.constructor))
  battle.start()
  expect(order).toEqual([
    EffectTrigger.BeforeTransform,
    EffectTrigger.OnTransform,
    EffectTrigger.AfterTransform,
    EffectTrigger.OnTransformEnd,
  ])
  expect(classes).toContain(TransformPhase)
  expect(classes).toContain(TransformEndPhase)
  expect(battle.playerA.activePet.base).toBe(battle.playerA.activePet.originalSpecies)
  expect(
    battle
      .getEvents()
      .filter(e => ['transform', 'transformEnd'].includes(e.type))
      .map(e => e.type),
  ).toEqual(['transform', 'transformEnd'])
})
it('supports temporary priorities, stable equal-priority ordering and explicit out-of-order removal', () => {
  const input = setup(battle => {
    const originalId = battle.playerA.activePet.base.id
    const low = transform(battle, 'form', { priority: 1 })
    const high = transform(battle, 'pet_dilan', { priority: 10 })
    const tie = transform(battle, 'form', { priority: 10 })
    expect(battle.playerA.activePet.base.id).toBe('pet_dilan')
    expect(end(battle, low)).toBe(true)
    expect(battle.playerA.activePet.base.id).toBe('pet_dilan')
    expect(end(battle, high)).toBe(true)
    expect(battle.playerA.activePet.base.id).toBe('form')
    expect(end(battle, tie)).toBe(true)
    expect(battle.playerA.activePet.base.id).toBe(originalId)
    expect(end(battle)).toBe(false)
  })
  createBattle(input.options, input.content, input.registry).start()
})
it('replaces the previous temporary layer from the same live source', () => {
  const input = setup(battle => {
    const source = battle.playerA.activePet.marks[0]
    const old = transform(battle, 'form', { priority: 10, causedBy: source })
    const current = transform(battle, 'pet_dilan', { priority: 1, causedBy: source })
    expect(battle.transformationSystem.getState(battle.playerA.activePet).records.map(r => r.id)).toEqual([current])
    expect(end(battle, old)).toBe(false)
    expect(battle.playerA.activePet.base.id).toBe('pet_dilan')
  })
  createBattle(input.options, input.content, input.registry).start()
})
it.each(['clear_temporary', 'preserve_temporary'] as const)('handles permanent forms with %s', permanentStrategy => {
  const input = setup(battle => {
    const originalId = battle.playerA.activePet.base.id
    const temporary = transform(battle, 'form')
    const permanent = transform(battle, 'pet_dilan', { transformType: 'permanent', permanentStrategy })
    expect(battle.playerA.activePet.base.id).toBe(permanentStrategy === 'preserve_temporary' ? 'form' : 'pet_dilan')
    if (permanentStrategy === 'preserve_temporary') {
      end(battle, temporary)
      expect(battle.playerA.activePet.base.id).toBe('pet_dilan')
    } else expect(end(battle, temporary)).toBe(false)
    end(battle, permanent)
    expect(battle.playerA.activePet.base.id).toBe(originalId)
    expect(battle.transformationSystem.getState(battle.playerA.activePet).records).toEqual([])
  })
  const battle = createBattle(input.options, input.content, input.registry)
  battle.start()
  expect(
    restoreBattle(JSON.parse(JSON.stringify(battle.snapshot())), input.content, input.registry).snapshot(),
  ).toEqual(battle.snapshot())
})
it('keeps temporary layers when removing the underlying permanent form', () => {
  const input = setup(battle => {
    const permanent = transform(battle, 'pet_dilan', { transformType: 'permanent' })
    const temporary = transform(battle)
    end(battle, permanent)
    expect(battle.playerA.activePet.base.id).toBe('form')
    end(battle, temporary)
    expect(battle.playerA.activePet.base).toBe(battle.playerA.activePet.originalSpecies)
  })
  createBattle(input.options, input.content, input.registry).start()
})
it('converts the current HP ratio on each transition without healing back to a recorded ratio', () => {
  const input = setup(battle => {
    const pet = battle.playerA.activePet,
      originalMax = pet.stat.maxHp
    pet.currentHp = Math.floor(originalMax / 2)
    const ratio = pet.currentHp / originalMax
    const id = transform(battle)
    expect(pet.currentHp).toBe(Math.floor(pet.stat.maxHp * ratio))
    pet.currentHp = Math.floor(pet.currentHp / 2)
    const injuredRatio = pet.currentHp / pet.stat.maxHp
    end(battle, id)
    expect(pet.currentHp).toBe(Math.floor(originalMax * injuredRatio))
    pet.currentHp = 0
    transform(battle)
    expect(pet.currentHp).toBe(0)
  })
  delete input.options.players[0].team[0].maxHp
  createBattle(input.options, input.content, input.registry).start()
})
it.each(['preserve', 'override'] as const)(
  'manages native ability/emblem marks with %s effects',
  effectHandlingStrategy => {
    const input = setup(battle => {
      const pet = battle.playerA.activePet
      const id = transform(battle, 'form', { effectHandlingStrategy })
      expect(pet.ability).toBe('form-mark')
      expect(pet.marks.some(m => m.base.id === 'form-mark')).toBe(true)
      expect(pet.marks.some(m => m.base.id === 'control')).toBe(effectHandlingStrategy === 'preserve')
      end(battle, id)
      expect(pet.ability).toBe('control')
      expect(pet.marks.map(m => m.base.id)).toEqual(['control'])
    })
    createBattle(input.options, input.content, input.registry).start()
  },
)
it('transforms skills, merges effect IDs deterministically and restores original runtime adjustments', () => {
  const old = defineEffect({ id: 'old', version: '1', triggers: [EffectTrigger.OnHit], execute() {} })
  const next = defineEffect({ id: 'next', version: '1', triggers: [EffectTrigger.OnHit], execute() {} })
  const input = setup(
    battle => {
      const skill = battle.playerA.activePet.skills[0],
        original = skill.base
      skill.power += 5
      const id = battle.transform(new TransformContext(battle, skill, skill.base, battle.content.skill('form-skill')))
      expect(skill.base.id).toBe('form-skill')
      expect(skill.power).toBe(104)
      expect(skill.effects.map(e => e.id)).toEqual(['old', 'next'])
      battle.endTransformation(new TransformEndContext(battle, skill, id))
      expect(skill.base).toBe(original)
      expect(skill.power).toBe(original.power + 5)
      expect(skill.effects.map(e => e.id)).toEqual(['old'])
    },
    [old, next],
  )
  input.content.skills.find(s => s.id === 'skill_paida')!.effects = [{ id: 'old', version: '1', params: {} }]
  input.content.skills.find(s => s.id === 'form-skill')!.effects = [{ id: 'next', version: '1', params: {} }]
  createBattle(input.options, input.content, input.registry).start()
})
it('transforms mark config with stable identity, owner, remaining duration and restoration', () => {
  const input = setup(battle => {
    const mark = battle.addMark(battle.playerA.activePet, original.marks[0].id)!,
      id = mark.id,
      owner = mark.owner
    mark.config.maxStacks = 9
    mark.stack = 5
    mark.duration = 2
    const transformation = battle.transform(
      new TransformContext(battle, mark, mark.base, battle.content.mark('form-mark')),
    )
    expect(mark.id).toBe(id)
    expect(mark.owner).toBe(owner)
    expect(mark.stack).toBe(1)
    expect(mark.duration).toBe(2)
    battle.endTransformation(new TransformEndContext(battle, mark, transformation))
    expect(mark.config.maxStacks).toBe(9)
    expect(mark.duration).toBe(2)
  })
  createBattle(input.options, input.content, input.registry).start()
})
it('cleans all forms caused by a destroyed mark, including permanent and transformed target marks', () => {
  const input = setup(battle => {
    const pet = battle.playerA.activePet,
      source = battle.addMark(pet, original.marks[0].id)!
    transform(battle, 'form', { causedBy: source })
    const skill = pet.skills[0]
    battle.transform(
      new TransformContext(battle, skill, skill.base, battle.content.skill('form-skill'), {
        causedBy: source,
        transformType: 'permanent',
      }),
    )
    const mark = battle.addMark(pet, 'form-mark')!
    battle.transform(
      new TransformContext(battle, mark, mark.base, battle.content.mark(original.marks[0].id), { causedBy: source }),
    )
    battle.removeMark(new RemoveMarkContext(battle, source, true))
    expect(pet.base).toBe(pet.originalSpecies)
    expect(skill.base.id).toBe('skill_paida')
    expect(battle.transformationSystem.getState(pet).records).toEqual([])
    expect(battle.transformationSystem.getState(skill).records).toEqual([])
    battle.removeMark(new RemoveMarkContext(battle, mark, true))
  })
  createBattle(input.options, input.content, input.registry).start()
})
it('vetoes a transformation before changing records, IDs or native marks', () => {
  const veto = defineEffect({
    id: 'veto',
    version: '1',
    triggers: [EffectTrigger.BeforeTransform],
    execute(ctx) {
      ctx.parent.available = false
    },
  })
  const input = setup(
    battle => {
      const pet = battle.playerA.activePet,
        before = pet.getState()
      expect(transform(battle)).toBeNull()
      expect(pet.getState()).toEqual(before)
      expect(battle.transformationSystem.snapshot()).toBeUndefined()
    },
    [veto],
  )
  input.content.marks.find(m => m.id === 'control')!.effects.push({ id: 'veto', version: '1', params: {} })
  createBattle(input.options, input.content, input.registry).start()
})
it('rolls back form records, native marks, counters and rules if a lifecycle callback throws', () => {
  const throwing = defineEffect({
    id: 'throw',
    version: '1',
    triggers: [EffectTrigger.AfterTransform],
    execute() {
      throw new Error('reject form')
    },
  })
  const input = setup(
    battle => {
      transform(battle)
    },
    [throwing],
  )
  input.content.marks.find(m => m.id === 'control')!.effects.push({ id: 'throw', version: '1', params: {} })
  const battle = createBattle(input.options, input.content, input.registry),
    before = battle.snapshot()
  expect(() => battle.start()).toThrow('reject form')
  expect(battle.snapshot()).toEqual(before)
})
it('preserves active forms and source cleanup through JSON restore and action replay', () => {
  const cleanup = defineEffect({
    id: 'cleanup',
    version: '1',
    triggers: [EffectTrigger.TurnEnd],
    execute(ctx) {
      const pet = ctx.battle.playerA.activePet
      ctx.battle.removeMark(pet.marks.find(mark => mark.base.id === original.marks[0].id)!, true)
    },
  })
  const input = setup(
    battle => {
      const pet = battle.playerA.activePet,
        source = battle.addMark(pet, original.marks[0].id)!
      transform(battle, 'form', { causedBy: source })
      const skill = pet.skills[0]
      battle.transform(
        new TransformContext(battle, skill, skill.base, battle.content.skill('form-skill'), { causedBy: source }),
      )
    },
    [cleanup],
  )
  input.content.marks.find(m => m.id === 'control')!.effects.push({ id: 'cleanup', version: '1', params: {} })
  const battle = createBattle(input.options, input.content, input.registry)
  battle.start()
  const restored = restoreBattle(JSON.parse(JSON.stringify(battle.snapshot())), input.content, input.registry)
  expect(restored.snapshot()).toEqual(battle.snapshot())
  for (const instance of [battle, restored]) {
    instance.submitAction(skillAction(instance, 'A'), false)
    instance.submitAction(skillAction(instance, 'B'), false)
    while (instance.advance()) {
      const checkpoint = restoreBattle(JSON.parse(JSON.stringify(instance.snapshot())), input.content, input.registry)
      expect(checkpoint.snapshot()).toEqual(instance.snapshot())
    }
  }
  expect(restored.snapshot()).toEqual(battle.snapshot())
  expect(battle.playerA.activePet.base).toBe(battle.playerA.activePet.originalSpecies)
  expect(replayBattle(battle.exportReplay(), input.content, input.registry).getState()).toEqual(battle.getState())
})
it.each(['counter', 'prototype', 'source', 'duplicate', 'active', 'ability', 'native'] as const)(
  'rejects malformed transformation snapshot: %s',
  field => {
    const input = setup(battle => {
        transform(battle)
      }),
      battle = createBattle(input.options, input.content, input.registry)
    battle.start()
    const snapshot = battle.snapshot(),
      state = snapshot.state.transformations!
    if (field === 'counter') state.nextId = 0
    if (field === 'prototype') state.targets[0].records[0].baseId = 'form-skill'
    if (field === 'source') state.targets[0].records[0].causedBy = { type: 'mark', id: '@mark/9000' }
    if (field === 'duplicate') state.targets[0].records.push(structuredClone(state.targets[0].records[0]))
    if (field === 'ability') snapshot.state.players[0].team[0].abilityId = 'control'
    if (field === 'native') state.targets[0].nativeMarkIds = ['@mark/9000']
    if (field === 'active')
      snapshot.state.players[0].team[0].speciesId = snapshot.state.players[0].team[0].build.species
    expect(() => restoreBattle(snapshot, input.content, input.registry)).toThrow()
  },
)
it('expires a source mark through the regular turn lifecycle and restores its target', () => {
  const input = setup(battle => {
    const source = battle.addMark(battle.playerA.activePet, original.marks[0].id)!
    source.config.persistent = false
    source.duration = 1
    transform(battle, 'form', { causedBy: source })
  })
  const battle = createBattle(input.options, input.content, input.registry)
  battle.start()
  battle.submitAction(skillAction(battle, 'A'))
  battle.submitAction(skillAction(battle, 'B'))
  expect(battle.playerA.activePet.base).toBe(battle.playerA.activePet.originalSpecies)
  expect(battle.getEvents().some(e => e.type === 'transformEnd' && e.data.reason === 'mark_destroyed')).toBe(true)
})
it('rolls back a failing end hook without losing active layers', () => {
  const ending = defineEffect({
    id: 'end',
    version: '1',
    triggers: [EffectTrigger.TurnStart],
    execute(ctx) {
      ctx.battle.endTransformation(ctx.battle.playerA.activePet)
    },
  })
  const throwing = defineEffect({
    id: 'throw-end',
    version: '1',
    triggers: [EffectTrigger.OnTransformEnd],
    execute() {
      throw new Error('end failed')
    },
  })
  const input = setup(
    battle => {
      transform(battle)
    },
    [ending, throwing],
  )
  input.content.marks
    .find(m => m.id === 'control')!
    .effects.push(...[ending, throwing].map(effect => ({ id: effect.id, version: effect.version, params: {} })))
  const battle = createBattle(input.options, input.content, input.registry)
  battle.start()
  battle.submitAction(skillAction(battle, 'A'))
  const before = battle.snapshot()
  expect(() => battle.submitAction(skillAction(battle, 'B'))).toThrow('end failed')
  expect(battle.snapshot()).toEqual(before)
})
it('rejects foreign participants, mismatched prototype objects and unlogged host mutation', () => {
  const input = setup(battle => {
    const pet = battle.playerA.activePet
    expect(() =>
      battle.transform(
        new TransformContext(
          battle,
          foreign.playerA.activePet,
          foreign.playerA.activePet.base,
          foreign.content.species('form'),
        ),
      ),
    ).toThrow()
    expect(() =>
      battle.transform(new TransformContext(battle, pet, pet.base, foreign.content.species('form'))),
    ).toThrow()
  })
  const foreign = createBattle(input.options, input.content, input.registry)
  const before = foreign.snapshot(),
    battle = createBattle(input.options, input.content, input.registry)
  battle.start()
  expect(foreign.snapshot()).toEqual(before)
  expect(() => transform(battle)).toThrow('operation')
})
it('preserves temporary layers from the same source when permanently changing the underlying form', () => {
  const input = setup(battle => {
    const source = battle.playerA.activePet.marks[0]
    const temporary = transform(battle, 'form', { causedBy: source })
    transform(battle, 'pet_dilan', {
      causedBy: source,
      transformType: 'permanent',
      permanentStrategy: 'preserve_temporary',
    })
    expect(battle.playerA.activePet.base.id).toBe('form')
    end(battle, temporary)
    expect(battle.playerA.activePet.base.id).toBe('pet_dilan')
  })
  createBattle(input.options, input.content, input.registry).start()
})
it('dispatches the transformed skill effect references and restores the original set', () => {
  const calls: string[] = []
  const old = defineEffect({
    id: 'old-hit',
    version: '1',
    triggers: [EffectTrigger.OnHit],
    execute() {
      calls.push('old')
    },
  })
  const next = defineEffect({
    id: 'new-hit',
    version: '1',
    triggers: [EffectTrigger.OnHit],
    execute() {
      calls.push('new')
    },
  })
  const ending = defineEffect({
    id: 'end-skill-form',
    version: '1',
    triggers: [EffectTrigger.TurnEnd],
    execute(ctx) {
      ctx.battle.endTransformation(ctx.battle.playerA.activePet.skills[0])
    },
  })
  const input = setup(
    battle => {
      const skill = battle.playerA.activePet.skills[0]
      battle.transform(
        new TransformContext(battle, skill, skill.base, battle.content.skill('form-skill'), {
          effectHandlingStrategy: 'override',
        }),
      )
    },
    [old, next, ending],
  )
  input.options.players.forEach(player =>
    player.team.forEach(pet => {
      pet.maxHp = 1000
    }),
  )
  input.content.skills.find(skill => skill.id === 'skill_paida')!.effects = [{ id: old.id, version: '1', params: {} }]
  input.content.skills.find(skill => skill.id === 'form-skill')!.effects = [{ id: next.id, version: '1', params: {} }]
  input.content.marks.find(mark => mark.id === 'control')!.effects.push({ id: ending.id, version: '1', params: {} })
  const battle = createBattle(input.options, input.content, input.registry)
  battle.start()
  for (let turn = 0; turn < 2; turn++) {
    battle.submitAction(skillAction(battle, 'A'))
    battle.submitAction(skillAction(battle, 'B'))
  }
  expect(calls.filter(call => call === 'new')).toHaveLength(1)
  expect(calls.filter(call => call === 'old')).toHaveLength(3)
})
