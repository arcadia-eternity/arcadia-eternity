import { beforeAll, expect, it } from 'vitest'
import {
  createBattle,
  restoreBattle,
  EffectRegistry,
  defineEffect,
  EffectTrigger,
  AttackTargetOpinion,
  Context,
  EffectContext,
  TurnContext,
  UseSkillContext,
  DamageContext,
  HealContext,
  RageContext,
  RemoveMarkContext,
  AddMarkContext,
  DamagePhase,
  SkillPhase,
  TurnPhase,
  MarkStackPhase,
  BattleStartPhase,
  SelectionPhase,
  SelectionContext,
  PhaseState,
  type BattleContent,
  type TrustedEffect,
} from '@arcadia-eternity/battle/core'
import { officialContent, basicOptions, skillAction, runOfficial } from './official.js'
import { registry as originalRegistry } from './trusted201.js'

let original: BattleContent
beforeAll(async () => {
  original = await officialContent()
})
function contentWith(effects: readonly TrustedEffect[]) {
  const content = structuredClone(original)
  content.skills.forEach(skill => {
    skill.effects = []
    skill.sureHit = true
  })
  content.marks.forEach(mark => {
    mark.effects = []
  })
  content.marks[0].config.persistent = true
  content.marks[0].config.duration = -1
  content.marks[0].effects = effects.map(effect => ({ id: effect.id, version: effect.version, params: {} }))
  const options = basicOptions()
  options.players[0].team[0].ability = content.marks[0].id
  return { content, options, registry: new EffectRegistry(effects) }
}
it('executes actual typed domain phases with a nested phase tree and causal Context parents', () => {
  let callbacks = 0
  const effect = defineEffect({
    id: 'inspect-damage-parent',
    version: '1',
    triggers: [EffectTrigger.OnBeforeCalculateDamage],
    execute(context) {
      expect(context).toBeInstanceOf(EffectContext)
      const damage = context.parent
      expect(damage).toBeInstanceOf(DamageContext)
      expect(damage.parent).toBeInstanceOf(UseSkillContext)
      if (!(damage.parent instanceof UseSkillContext)) throw new Error('Expected skill damage')
      expect(damage.parent.parent).toBeInstanceOf(TurnContext)
      expect(damage.parent.parent.parent).toBe(context.battle)
      damage.addModified(0, 0)
      callbacks++
    },
  })
  const { content, options, registry } = contentWith([effect]),
    battle = createBattle(options, content, registry)
  const classes = new Set<unknown>()
  const stop = battle.phaseManager.onExecutionEvent(phase => {
    classes.add(phase.constructor)
    if (phase instanceof SkillPhase) expect(phase.context.parent).toBe(battle.activeTurn)
    if (phase instanceof DamagePhase) expect(phase.context.parent).toBeInstanceOf(UseSkillContext)
  })
  expect(battle).toBeInstanceOf(Context)
  battle.start()
  battle.submitAction(skillAction(battle, 'A'))
  battle.submitAction(skillAction(battle, 'B'))
  stop()
  expect(callbacks).toBe(2)
  for (const phase of [BattleStartPhase, TurnPhase, SkillPhase, DamagePhase]) expect(classes.has(phase)).toBe(true)
  const trace = battle.snapshot().phases.history
  const damage = trace.find(row => row.kind === 'damage')!,
    skill = trace.find(row => row.kind === 'skill')!
  expect(damage.parentId).toBe(skill.id)
  expect(trace.find(row => row.id === skill.parentId)?.kind).toBe('turn-action')
})
it('rehydrates TurnContext data and rebuilds the parent chain between the two skill phases', () => {
  const parents: TurnContext[] = []
  const effect = defineEffect({
    id: 'turn-data',
    version: '1',
    triggers: [EffectTrigger.BeforeHit],
    execute(context) {
      const turn = context.parent.parent
      expect(turn).toBe(context.battle.activeTurn)
      const data = turn.getPetData(context.battle.playerA.activePet)
      data.hits = typeof data.hits === 'number' ? data.hits + 1 : 1
      parents.push(turn)
    },
  })
  const { content, options, registry } = contentWith([effect])
  let battle = createBattle(options, content, registry)
  battle.start()
  battle.submitAction(skillAction(battle, 'A'), false)
  battle.submitAction(skillAction(battle, 'B'), false)
  expect(battle.advance()).toBe(true)
  expect(battle.advance()).toBe(true)
  expect(battle.advance()).toBe(true)
  expect(battle.activeTurn?.data.petData['A/lead'].hits).toBe(1)
  const saved = battle.snapshot()
  expect(saved.state.turnContext?.plannedPetIds).toHaveLength(2)
  expect(saved.state.turnContext?.executedPetIds).toHaveLength(1)
  battle = restoreBattle(JSON.parse(JSON.stringify(saved)), content, registry)
  expect(battle.activeTurn?.parent).toBe(battle)
  expect(battle.advance()).toBe(true)
  expect(battle.activeTurn?.data.petData['A/lead'].hits).toBe(2)
  expect(parents[1]).not.toBe(parents[0])
  expect(parents[1].parent).toBe(battle)
})
it('preserves explicit interactive Waiting and cancellation lifecycle without a host Promise', () => {
  const { content, options, registry } = contentWith([]),
    battle = createBattle(options, content, registry)
  const phase = new SelectionPhase(new SelectionContext(battle))
  phase.initialize()
  expect(phase.execute()).toEqual({ state: PhaseState.Waiting })
  phase.cancel()
  expect(phase.state).toBe(PhaseState.Cancelled)
  expect(() => phase.execute()).toThrow('not ready')
})
it('restores the phase manager counter and stack when a nested phase fails', () => {
  const { content, options, registry } = contentWith([]),
    battle = createBattle(options, content, registry),
    before = battle.snapshot()
  const stop = battle.phaseManager.onExecutionEvent(phase => {
    if (phase instanceof BattleStartPhase) throw new Error('phase audit failure')
  })
  expect(() => battle.start()).toThrow('phase audit failure')
  stop()
  expect(battle.snapshot()).toEqual(before)
  expect(battle.phaseManager.currentContext).toBe(battle)
  battle.start()
  expect(battle.snapshot().phases.history.find(row => row.kind === 'battle-start')?.parentId).toBeNull()
})
it('uses the typed AddMark/Stack phases and exposes the original entity ownership contracts', () => {
  const effect = defineEffect({
    id: 'stack',
    version: '1',
    triggers: [EffectTrigger.OnBattleStart],
    execute(context) {
      const pet = context.battle.playerA.activePet,
        base = context.battle.content.mark('mark_hunzhuoshuiyu')
      pet.addMark(new AddMarkContext(context, pet, base))
      pet.addMark(new AddMarkContext(context, pet, base))
    },
  })
  const { content, options, registry } = contentWith([effect])
  // The trigger ability is separate from the stack target, preventing self-recursive startup effects.
  content.marks.push({ ...structuredClone(content.marks[0]), id: 'ability' })
  content.marks[0].effects = []
  options.players[0].team[0].ability = 'ability'
  const battle = createBattle(options, content, registry),
    seen = new Set<unknown>()
  battle.phaseManager.onExecutionEvent(phase => {
    seen.add(phase.constructor)
  })
  battle.start()
  expect(seen.has(MarkStackPhase)).toBe(true)
  const pet = battle.playerA.activePet,
    skill = pet.skills[0],
    mark = pet.marks[0]
  expect(pet.base).toBe(pet.species)
  expect(skill.base.id).toBe('skill_paida')
  expect(mark.base.id).toBe('ability')
  expect(pet.owner).toBe(battle.playerA)
  expect(battle.playerA.owner).toBe(battle)
  expect(mark.owner).toBe(pet)
  expect(() => pet.setOwner(battle.playerB)).toThrow('fixed')
  expect(() => skill.setOwner(battle.playerB.activePet)).toThrow('fixed')
})
it('records genuine skill, rage, switch, effect and mark phases during the original official battle', () => {
  const battle = runOfficial(original)
  const kinds = new Set(battle.snapshot().phases.history.map(row => row.kind))
  for (const kind of [
    'battle-start',
    'battle-loop',
    'selection',
    'turn',
    'turn-start',
    'turn-action',
    'turn-end',
    'skill',
    'switch-pet',
    'rage',
    'damage',
    'add-mark',
    'mark-switch-out',
    'mark-update',
    'mark-cleanup',
    'battle-switch',
    'effect',
    'effect-execution',
  ])
    expect(kinds.has(kind), kind).toBe(true)
})

it.each([
  [1, 10, 5, 5],
  [10, 2, 5, 2],
])('clamps initial stacks against overridden config (%i -> %i)', (baseMax, overrideMax, requested, expected) => {
  const hook = defineEffect({
    id: 'config-override',
    version: '1',
    triggers: [EffectTrigger.OnBattleStart],
    execute(context) {
      const pet = context.battle.playerA.activePet,
        base = context.battle.content.mark('target')
      const add = new AddMarkContext(context, pet, base, requested)
      add.overrideConfig({ maxStacks: overrideMax })
      const mark = pet.addMark(add)!
      expect(mark.stack).toBe(expected)
      expect(mark.config.maxStacks).toBe(overrideMax)
    },
  })
  const { content, options, registry } = contentWith([hook])
  content.marks.push({ ...structuredClone(content.marks[0]), id: 'target', effects: [] })
  content.marks[1].config.maxStacks = baseMax
  const battle = createBattle(options, content, registry)
  battle.start()
  expect(restoreBattle(battle.snapshot(), content, registry).snapshot()).toEqual(battle.snapshot())
})
it('preserves BeforeSort skill and target changes across a serialized turn boundary', () => {
  const hook = defineEffect({
    id: 'retarget',
    version: '1',
    triggers: [EffectTrigger.BeforeSort],
    execute(context) {
      const skill = context.parent
      if (skill.player.id !== 'A') return
      skill.setSkill(skill.pet.skills[1])
      skill.selectTarget = AttackTargetOpinion.self
    },
  })
  const { content, options, registry } = contentWith([hook])
  options.players[0].team[0].skills = ['skill_paida', 'skill_qili']
  const run = (restore: boolean) => {
    let battle = createBattle(options, content, registry)
    battle.start()
    battle.submitAction(skillAction(battle, 'A'), false)
    battle.submitAction(skillAction(battle, 'B'), false)
    battle.advance()
    battle.advance()
    const queued = battle.snapshot().state.phase.queue.find(item => item.action.player === 'A')!
    expect(queued.skillPlan?.selectTarget).toBe(AttackTargetOpinion.self)
    expect(queued.skillPlan?.skillId).toBe(battle.playerA.activePet.skills[1].id)
    if (restore) battle = restoreBattle(battle.snapshot(), content, registry)
    while (battle.advance()) {
      /* finish this turn */
    }
    return battle
  }
  const fresh = run(false),
    restored = run(true)
  expect(restored.snapshot()).toEqual(fresh.snapshot())
  const used = fresh.getEvents().find(event => event.type === 'skillUse' && event.data.petId === 'A/lead')!
  expect(used.data.baseSkillId).toBe('skill_qili')
  expect(used.data.targetId).toBe('A/lead')
})
it('rejects foreign participants before mutation and leaves the other battle intact on rollback', () => {
  const foreign = createBattle(basicOptions(), structuredClone(original), originalRegistry),
    foreignBefore = foreign.snapshot()
  const hook = defineEffect({
    id: 'foreign-damage',
    version: '1',
    triggers: [EffectTrigger.OnBattleStart],
    execute(context) {
      context.battle.damage(new DamageContext(context, context.battle.playerA.activePet, foreign.playerA.activePet, 10))
    },
  })
  const { content, options, registry } = contentWith([hook]),
    battle = createBattle(options, content, registry),
    before = battle.snapshot()
  expect(() => battle.start()).toThrow('another battle')
  expect(battle.snapshot()).toEqual(before)
  expect(foreign.snapshot()).toEqual(foreignBefore)
})
it('runs typed BeforeEffect and AfterEffect phases around a callback without recursing on meta hooks', () => {
  const order: string[] = []
  const before = defineEffect({
    id: 'before',
    version: '1',
    triggers: [EffectTrigger.BeforeEffect],
    execute(context) {
      expect(context.parent).toBeInstanceOf(EffectContext)
      order.push('before')
    },
  })
  const main = defineEffect({
    id: 'main',
    version: '1',
    triggers: [EffectTrigger.OnBattleStart],
    execute(context) {
      expect(context.parent).toBe(context.battle)
      order.push('main')
    },
  })
  const after = defineEffect({
    id: 'after',
    version: '1',
    triggers: [EffectTrigger.AfterEffect],
    execute(context) {
      expect(context.parent.success).toBe(true)
      order.push('after')
    },
  })
  const { content, options, registry } = contentWith([before, main, after]),
    battle = createBattle(options, content, registry)
  battle.start()
  expect(order).toEqual(['before', 'main', 'after'])
})

it.each(['damage-source', 'heal-target', 'rage-player', 'remove-mark'] as const)(
  'isolates foreign %s participants',
  kind => {
    const foreignOptions = basicOptions()
    foreignOptions.players[0].team[0].ability = original.marks[0].id
    const foreign = createBattle(foreignOptions, structuredClone(original), originalRegistry)
    foreign.start()
    const foreignBefore = foreign.snapshot()
    const hook = defineEffect({
      id: 'foreign-operation',
      version: '1',
      triggers: [EffectTrigger.OnBattleStart],
      execute(context) {
        const local = context.battle.playerA.activePet
        switch (kind) {
          case 'damage-source':
            context.battle.damage(new DamageContext(context, foreign.playerA.activePet, local, 10))
            break
          case 'heal-target':
            context.battle.heal(new HealContext(context, local, foreign.playerA.activePet, 10))
            break
          case 'rage-player':
            context.battle.changeRage(new RageContext(context, foreign.playerA, 10, 'add', 'effect'))
            break
          case 'remove-mark':
            context.battle.removeMark(new RemoveMarkContext(context, foreign.playerA.activePet.marks[0], true))
            break
        }
      },
    })
    const { content, options, registry } = contentWith([hook]),
      battle = createBattle(options, content, registry),
      before = battle.snapshot()
    expect(() => battle.start()).toThrow('another battle')
    expect(battle.snapshot()).toEqual(before)
    expect(foreign.snapshot()).toEqual(foreignBefore)
  },
)

it('updates the default target when a skill replacement changes target category', () => {
  const { content, options, registry } = contentWith([])
  options.players[0].team[0].skills = ['skill_paida', 'skill_qili']
  const battle = createBattle(options, content, registry),
    pet = battle.playerA.activePet
  const context = new UseSkillContext(new TurnContext(battle), battle.playerA, pet, pet.skills[0].target, pet.skills[0])
  context.setSkill(pet.skills[1])
  context.updateActualTarget()
  expect(context.selectTarget).toBe(AttackTargetOpinion.self)
  expect(context.target).toBe(pet)
  context.setSkill(pet.skills[0])
  context.updateActualTarget()
  expect(context.target).toBe(battle.playerB.activePet)
  context.selectTarget = AttackTargetOpinion.self
  context.updateActualTarget()
  expect(context.target).toBe(pet)
})
