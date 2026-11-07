import {
  AttackTargetOpinion,
  BattleMessageType,
  EffectContext,
  EffectTrigger,
  RemoveMarkContext,
  TurnContext,
  UseSkillContext,
  behaviorEffectId,
  parameterAddress,
  setGlobalLogger,
  type Battle,
  type BattleSnapshot,
} from '@arcadia-eternity/battle/v4'
import { templateCatalog, templateData, templateFixture, useTemplate } from './official-template-fixture'

const data = () => {
  const result = templateData(
    [
      useTemplate('apply-mark-on-hit', { mark: 'ugc/source', target: 'opponent', stacks: 1 }, 'slow'),
      useTemplate('apply-mark-on-hit', { mark: 'ugc/state', target: 'self', stacks: 2 }, 'boost'),
      useTemplate('heal-fixed', { amount: 17 }, 'heal'),
    ],
    [
      useTemplate('mark-attribute-per-stack', { attribute: 'spe', amount: -10 }),
      useTemplate('mark-attribute', { attribute: 'def', amount: 12 }, 'fixed'),
      useTemplate('mark-skill-attribute-all', { attribute: 'power', amount: 7 }, 'skills'),
    ],
  )
  result.marks[0].behaviors = [useTemplate('mark-attribute-per-stack', { attribute: 'atk', amount: 15 })]
  return result
}
function same(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label}: ${JSON.stringify(actual)}`)
}
function hit(battle: Battle) {
  const player = battle.playerA,
    pet = player.activePet
  const event = new UseSkillContext(new TurnContext(battle), player, pet, AttackTargetOpinion.opponent, pet.skills[0])
  event.updateActualTarget()
  battle.applyEffects(event, EffectTrigger.OnHit)
}
function setHeal(catalog: ReturnType<typeof templateCatalog>, battle: Battle, amount: number) {
  const id = behaviorEffectId({ kind: 'skill', id: 'ugc/skill' }, 'heal')
  catalog.parametersFor(id)!.set(battle.configSystem, parameterAddress(id, 'parameters', 'amount'), amount)
}
function continueProbe(catalog: ReturnType<typeof templateCatalog>, battle: Battle, active: boolean) {
  const errors: string[] = [],
    heals: number[] = []
  battle.registerListener(message => {
    if (([BattleMessageType.Error, BattleMessageType.EffectApplyFail] as BattleMessageType[]).includes(message.type))
      errors.push(message.type)
    if (message.type === BattleMessageType.Heal) heals.push(message.data.amount)
  })
  const a = battle.playerA.activePet,
    b = battle.playerB.activePet
  const atk = a.stat.atk,
    spe = b.stat.spe
  a.currentHp = 1
  hit(battle)
  same(a.currentHp, 24, 'Saved parameter retained')
  same(a.stat.atk, atk + 30, 'Boost binding installed once and remains live')
  same(b.stat.spe, spe - 10, 'Slow binding installed once and remains live')
  setHeal(catalog, battle, 29)
  a.currentHp = 1
  hit(battle)
  same(a.currentHp, 30, 'Restored numeric parameter remains editable')
  const boost = a.marks.find(mark => mark.baseId === 'ugc/state')!
  const slow = b.marks.find(mark => mark.baseId === 'ugc/source')!
  same([boost.stack, slow.stack], active ? [6, 3] : [4, 2], 'Independent stacks after restore')
  boost.isSuppressed = true
  const suppressedAttack = a.stat.atk
  boost.isSuppressed = false
  same(a.stat.atk, suppressedAttack + boost.stack * 15, 'Restored source suppression')
  const speed = a.stat.spe,
    defense = a.stat.def,
    power = a.skills[0].power
  a.transferMarks(new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, a.skills[0]), slow)
  same(a.stat.spe, speed - slow.stack * 10, 'Restored live contribution follows the transferred mark')
  same(
    [a.stat.def, a.skills[0].power],
    [defense + 12, power + 7],
    'Restored static and skill contributions follow the transferred mark',
  )
  battle.removeMark(new RemoveMarkContext(new TurnContext(battle), slow))
  same(
    [a.stat.spe, a.stat.def, a.skills[0].power],
    [speed, defense, power],
    'Transferred contributions clean up after restoration',
  )
  same(b.stat.spe, active ? spe + 10 : spe, 'Removing restored slow clears only its contribution')
  same(heals, [23, 29], 'Healing event order')
  same(errors, [], 'No swallowed effect failures')
  return {
    active,
    hp: a.currentHp,
    atk: a.stat.atk,
    spe: b.stat.spe,
    stacks: boost.stack,
    effects: catalog.effects.map(effect => effect.id),
    rng: [battle.random(), battle.random()],
  }
}
interface Probe {
  active: boolean
  snapshot: BattleSnapshot
  expected: ReturnType<typeof continueProbe>
}
export async function createOfficialTemplateProbes(): Promise<Probe[]> {
  setGlobalLogger({
    debug() {},
    info() {},
    warn() {},
    error(...args) {
      throw new Error(String(args))
    },
  })
  const probes: Probe[] = []
  for (const active of [false, true]) {
    const f = templateFixture(data())
    let run: Promise<unknown> | undefined
    try {
      if (active) {
        const ready = new Promise<void>(resolve =>
          f.battle.registerListener(message => {
            if (message.type === BattleMessageType.TurnAction) resolve()
          }),
        )
        run = f.battle.startBattle().catch(error => {
          if (!(error instanceof Error) || error.message !== 'Battle cancelled') throw error
        })
        await ready
        hit(f.battle)
        // A snapshot after two transfers must retain only the current owner's subscriptions.
        const slow = f.b.activePet.marks.find(mark => mark.baseId === 'ugc/source')!
        const context = new EffectContext(f.turn(), EffectTrigger.TurnStart, f.a.activePet.skills[0])
        f.a.activePet.transferMarks(context, slow)
        f.b.activePet.transferMarks(context, slow)
      }
      setHeal(f.catalog, f.battle, 23)
      const snapshot = JSON.parse(JSON.stringify(f.catalog.snapshot(f.battle))) as BattleSnapshot
      probes.push({ active, snapshot, expected: continueProbe(f.catalog, f.battle, active) })
    } finally {
      await f.battle.cleanup()
      await run
    }
  }
  return probes
}
export async function resumeOfficialTemplateProbes(probes: readonly Probe[]) {
  setGlobalLogger({
    debug() {},
    info() {},
    warn() {},
    error(...args) {
      throw new Error(String(args))
    },
  })
  const results: Probe['expected'][] = []
  for (const probe of probes) {
    const catalog = templateCatalog(data())
    const battle = catalog.restore(probe.snapshot)
    try {
      const result = continueProbe(catalog, battle, probe.active)
      same(result, probe.expected, 'Fresh host preserves attributes, parameters, order and RNG')
      results.push(result)
    } finally {
      await battle.cleanup()
    }
  }
  return results
}
