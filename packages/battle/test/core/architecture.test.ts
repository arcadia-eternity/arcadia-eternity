import { beforeAll, expect, it } from 'vitest'
import {
  createBattle,
  restoreBattle,
  EffectRegistry,
  defineEffect,
  EffectTrigger,
  Context,
  EffectContext,
  TurnContext,
  UseSkillContext,
  DamageContext,
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
