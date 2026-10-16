// Custom mechanism fixture, not a substitute for the official Effect catalog.
import {
  Battle, Player, Pet, BaseSkill, BaseMark, Effect, AddMarkContext, RageContext,
  DurationType, Modifier, BattleMessageType, BattleStatus, EffectTrigger, Element,
  Category, AttackTargetOpinion, Nature, StackStrategy, StatTypeWithoutHp, PhaseState,
  UseSkillContext, type Species, type BattleMessage, type PlayerSelection, type playerId, type petId,
  type baseSkillId, type baseMarkId, type effectId, type speciesId,
} from '@arcadia-eternity/battle/v4'

export function makeScenario(seed = 201) {
  const counters = { created: 0, expired: 0, destroyed: 0, ticked: 0, hits: 0 }
  const debuff = new BaseMark('fixture/debuff' as baseMarkId, [
    new Effect<EffectTrigger>('fixture/create' as effectId, [EffectTrigger.OnMarkCreated], ctx => {
      counters.created++
      const owner = ctx.source.owner
      if (!(owner instanceof Pet)) throw new Error('Expected mark owner')
      owner.attributeSystem.addModifier('accuracy', new Modifier(DurationType.binding, 'fixture/accuracy', -10, 'delta', 0, ctx.source))
    }, 0),
    new Effect<EffectTrigger>('fixture/tick' as effectId, [EffectTrigger.TurnEnd], () => { counters.ticked++ }, 0),
    new Effect<EffectTrigger>('fixture/expire' as effectId, [EffectTrigger.OnMarkDurationEnd], () => { counters.expired++ }, 0),
    new Effect<EffectTrigger>('fixture/destroy' as effectId, [EffectTrigger.OnMarkDestroy], () => { counters.destroyed++ }, 0),
  ], {
    duration: 2, persistent: false, maxStacks: 1, stackable: false,
    stackStrategy: StackStrategy.refresh, destroyable: true, isShield: false,
    keepOnSwitchOut: false, transferOnSwitch: false, inheritOnFaint: false,
  })
  const setup = new BaseSkill('fixture/setup' as baseSkillId, Category.Status, Element.Normal, 0, 100, 5,
    0, AttackTargetOpinion.opponent, 1, true, false, false, undefined, [], [
      new Effect<EffectTrigger>('fixture/setup-hit' as effectId, [EffectTrigger.OnHit], ctx => {
        if (!(ctx.parent instanceof UseSkillContext) || ctx.source.owner !== ctx.parent.pet) return
        counters.hits++
        ctx.battle.addMark(new AddMarkContext(ctx, ctx.parent.actualTarget!, debuff))
        ctx.parent.pet.addStatStage(ctx, StatTypeWithoutHp.atk, 1)
        ctx.parent.origin.addRage(new RageContext(ctx, ctx.parent.origin, 'effect', 'add', 3))
      }, 0),
    ])
  const strike = new BaseSkill('fixture/strike' as baseSkillId, Category.Physical, Element.Normal, 1000, 100, 0, 0,
    AttackTargetOpinion.opponent, 1, true)
  const tap = new BaseSkill('fixture/tap' as baseSkillId, Category.Physical, Element.Normal, 30, 100, 2, 0,
    AttackTargetOpinion.opponent, 1, true)
  function species(id: string, hp: number, speed: number): Species {
    return { id: id as speciesId, num: 0, element: Element.Normal,
      baseStats: { hp, atk: 50, def: 80, spa: 50, spd: 80, spe: speed },
      genderRatio: null, heightRange: [1, 1], weightRange: [1, 1] }
  }
  const good = species('fixture/good', 200, 100)
  const weak = species('fixture/weak', 20, 10)
  const evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }
  function pet(id: string, base: Species, skills: BaseSkill[]) {
    return new Pet(id, id as petId, base, 50, evs, evs, Nature.Hardy, skills)
  }
  const a = new Player('A', 'A' as playerId, [pet('A/lead', good, [setup]), pet('A/reserve', good, [strike])])
  const b = new Player('B', 'B' as playerId, [pet('B/lead', weak, [tap]), pet('B/reserve', weak, [tap])])
  const battle = new Battle(a, b, { rngSeed: seed, timerConfig: { enabled: false }, showHidden: true })
  return { battle, a, b, counters, debuff }
}

export async function runScenario(seed = 201) {
  const fixture = makeScenario(seed)
  const { battle, a, b, counters } = fixture
  const messages: BattleMessage[] = []
  const actions: { turn: number; selection: PlayerSelection }[] = []
  const checkpoints: { turn: number; rage: number[]; hp: number[]; accuracy: number; atk: number }[] = []
  const submit = (selection: PlayerSelection | undefined) => {
    if (!selection || !battle.setSelection(selection)) throw new Error('Scenario action rejected')
    actions.push({ turn: battle.currentTurn, selection: { ...selection } })
  }
  battle.registerListener(message => {
    messages.push(message)
    if (message.type === BattleMessageType.TurnAction) {
      if (battle.currentTurn > 4) throw new Error('Scenario exceeded turn bound')
      submit(battle.getAvailableSelection(a.id).find(s => battle.currentTurn === 1
        ? s.type === 'switch-pet' : s.type === 'use-skill'))
      submit(battle.getAvailableSelection(b.id).find(s => s.type === 'use-skill'))
    } else if (message.type === BattleMessageType.ForcedSwitch) {
      for (const player of message.data.player)
        submit(battle.getAvailableSelection(player).find(s => s.type === 'switch-pet'))
    } else if (message.type === BattleMessageType.FaintSwitch) {
      submit(battle.getAvailableSelection(message.data.player).find(s => s.type === 'do-nothing'))
    } else if (message.type === BattleMessageType.TurnEnd) {
      checkpoints.push({ turn: battle.currentTurn, rage: [a.currentRage, b.currentRage],
        hp: [a.team[0].currentHp, a.team[1].currentHp, b.team[0].currentHp, b.team[1].currentHp],
        accuracy: b.team[0].stat.accuracy, atk: a.team[0].stat.atk })
    }
  })
  try {
    await battle.startBattle()
    const failedPhases = battle.phaseManager.getPhasesByState(PhaseState.Failed)
    if (failedPhases.length) throw new Error(failedPhases.map(p => `${p.constructor.name}: ${p.result?.error}`).join('\n'))
    if (messages.some(m => ([BattleMessageType.EffectApplyFail, BattleMessageType.Error] as BattleMessageType[]).includes(m.type)))
      throw new Error('Scenario emitted an execution error')
    if (battle.status !== BattleStatus.Ended || battle.victor !== a) throw new Error('Scenario did not finish')
    return { turn: battle.currentTurn, winner: battle.victor.id, counters, checkpoints,
      events: messages.map(m => m.type), actions: actions.map(a => ({ turn: a.turn, type: a.selection.type, player: a.selection.player })),
      end: messages.filter(m => m.type === BattleMessageType.BattleEnd).map(m => m.data),
      switches: messages.filter(m => m.type === BattleMessageType.PetSwitch).map(m => m.data),
      damage: messages.filter(m => m.type === BattleMessageType.Damage).map(m => m.data),
    }
  } finally { await battle.cleanup() }
}
