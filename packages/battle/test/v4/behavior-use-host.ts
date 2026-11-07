import {
  AddMarkContext,
  AttackTargetOpinion,
  BattleMessageType,
  Category,
  EffectContext,
  EffectTrigger,
  Element,
  Nature,
  StackStrategy,
  TurnContext,
  UseSkillContext,
  setGlobalLogger,
  parameterAddress,
  type Battle,
  type BattleSnapshot,
  type baseMarkId,
} from '../../v4'
import { createContentCatalog, type ContentCatalog } from '../../src/v4/content/definition-catalog'
import { behaviorEffectId, defineNativeBehavior } from '../../src/v4/content/behaviors'
import { actions, conditions, defineEffect, numberParam, ops, targets } from '../../src/v4/content/authoring'

type Mode = 'native'
const skillOwner = { kind: 'skill', id: 'demo/heal' } as const
const healParameters = { amount: { kind: 'number', default: 10, minimum: 0, maximum: 100 } } as const
const bindingParameters = { amount: { kind: 'number', default: -3, minimum: -100, maximum: 0 } } as const

function require(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}
function same(actual: unknown, expected: unknown, message: string) {
  require(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)}`)
}
function nativeExports() {
  return [
    defineNativeBehavior({
      id: 'trusted/heal',
      sourceKind: 'skill',
      parameters: healParameters,
      build: ({ effectId, params }) => {
        const amount = numberParam({ default: params.amount as number })
        return defineEffect({
          id: effectId,
          triggers: [EffectTrigger.OnHit],
          parameters: { amount },
          when: conditions.selfUsesSkill,
          apply: targets.ownerPet.apply(ops.heal(amount)),
        })
      },
    }),
    defineNativeBehavior({
      id: 'trusted/binding',
      sourceKind: 'petMark',
      parameters: bindingParameters,
      build: ({ effectId, params }) => {
        const amount = numberParam({ default: params.amount as number })
        const stack = targets.sourceMark.first().follow({ key: 'source' }).attribute('stack').follow({ key: 'stack' })
        return defineEffect({
          id: effectId,
          triggers: [EffectTrigger.OnMarkCreated],
          parameters: { amount },
          apply: actions.sequence(
            targets.ownerPet.apply(
              ops.bindAttribute({
                key: 'amount',
                attribute: 'spe',
                operation: 'delta',
                value: amount.follow({ key: 'amount' }),
                lifetime: 'sourceMark',
                missing: 'detach',
              }),
            ),
            targets.ownerPet.apply(
              ops.bindAttribute({
                key: 'stack',
                attribute: 'spe',
                operation: 'delta',
                value: stack.map(value => value * -2),
                lifetime: 'sourceMark',
                missing: 'detach',
              }),
            ),
          ),
        })
      },
    }),
  ]
}
export function behaviorMetadata() {
  const behaviors = [
    {
      formatVersion: 1,
      id: 'demo/heal-behavior',
      sourceKind: 'skill',
      parameters: healParameters,
      implementation: { kind: 'native', exportId: 'trusted/heal' },
    },
    {
      formatVersion: 1,
      id: 'demo/mark-behavior',
      sourceKind: 'petMark',
      parameters: bindingParameters,
      implementation: { kind: 'native', exportId: 'trusted/binding' },
    },
  ]
  return {
    behaviors,
    marks: [3, 7].map((amount, index) => ({
      id: `demo/mark-${index}`,
      effect: [],
      config: { stackable: true, maxStacks: 5, stackStrategy: StackStrategy.stack, persistent: true, duration: -1 },
      behaviors: [{ useId: 'shared', definitionId: 'demo/mark-behavior', params: { amount: -amount } }],
    })),
    skills: [
      {
        id: skillOwner.id,
        element: Element.Normal,
        category: Category.Status,
        power: 0,
        rage: 0,
        accuracy: 100,
        effect: [],
        behaviors: [10, 20].map((amount, index) => ({
          useId: `heal-${index}`,
          definitionId: 'demo/heal-behavior',
          params: { amount },
        })),
      },
    ],
    species: [
      {
        id: 'demo/species',
        num: 1,
        element: Element.Normal,
        baseStats: { hp: 100, atk: 100, spa: 100, def: 100, spd: 100, spe: 100 },
        genderRatio: null,
        heightRange: [1, 2],
        weightRange: [1, 2],
        learnable_skills: [{ skill_id: skillOwner.id, level: 1, hidden: false }],
        ability: [],
        emblem: [],
      },
    ],
  }
}
export function behaviorCatalog(mode: Mode) {
  // Every load crosses the saved-data boundary and rebuilds trusted factories.
  return createContentCatalog(JSON.parse(JSON.stringify(behaviorMetadata())), `behavior-demo/v1/${mode}`, undefined, {
    nativeExports: nativeExports(),
  })
}
function createBattle(directory: ContentCatalog) {
  const players = directory.parsePlayers(
    [0, 1].map(index => ({
      name: `Player ${index}`,
      id: String(index).repeat(21),
      team: [
        {
          name: `Pet ${index}`,
          id: String(index + 2).repeat(21),
          species: 'demo/species',
          level: 100,
          evs: { hp: 0, atk: 0, spa: 0, def: 0, spd: 0, spe: 0 },
          ivs: { hp: 31, atk: 31, spa: 31, def: 31, spd: 31, spe: 31 },
          nature: Nature.Hardy,
          skills: [skillOwner.id],
        },
      ],
    })),
  )
  return directory.createBattle(players[0], players[1], {
    rngSeed: 'behavior-use-241',
    timerConfig: { enabled: false },
  })
}
function useSkill(battle: Battle) {
  const player = battle.playerA,
    pet = player.activePet,
    skill = pet.skills[0]
  battle.applyEffects(
    new UseSkillContext(new TurnContext(battle), player, pet, AttackTargetOpinion.opponent, skill),
    EffectTrigger.OnHit,
    skill,
  )
}
function setAmount(
  directory: ContentCatalog,
  battle: Battle,
  kind: 'skill' | 'petMark',
  index: number,
  amount: number,
) {
  const owner = kind === 'skill' ? skillOwner : { kind, id: `demo/mark-${index}` }
  const effectId = behaviorEffectId(owner, kind === 'skill' ? `heal-${index}` : 'shared')
  const catalog = directory.parametersFor(effectId)
  require(catalog, 'Missing behavior parameter catalog')
  catalog.set(battle.configSystem, parameterAddress(effectId, 'parameters', 'amount'), amount)
}
function setupMarks(directory: ContentCatalog, battle: Battle) {
  const pet = battle.playerA.activePet
  pet.attributeSystem.updateBaseValue('spe', 300)
  const context = new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, pet.skills[0])
  for (const index of [0, 1])
    battle.addMark(new AddMarkContext(context, pet, directory.getMark(`demo/mark-${index}` as baseMarkId), 1))
  same(pet.stat.spe, 286, 'Two native marks each install their own parameter and stack bindings')
  setAmount(directory, battle, 'petMark', 0, -5)
  same(pet.stat.spe, 284, 'Only the first native mark follows the changed parameter')
  const first = pet.marks.find(mark => mark.baseId === 'demo/mark-0')!
  first.stack = 2
  same(pet.marks.find(mark => mark.baseId === 'demo/mark-1')!.stack, 1, 'Independent mark stack')
  same(pet.stat.spe, 282, 'Only first binding follows its source stack')
}
function continueProbe(directory: ContentCatalog, battle: Battle, mode: Mode, marks: boolean) {
  const heals: number[] = [],
    errors: string[] = []
  battle.registerListener(message => {
    if (message.type === BattleMessageType.Heal) heals.push(message.data.amount)
    if (([BattleMessageType.EffectApplyFail, BattleMessageType.Error] as BattleMessageType[]).includes(message.type))
      errors.push(message.type)
  })
  const pet = battle.playerA.activePet
  if (marks) same(pet.stat.spe, 282, 'Restored bindings were installed exactly once')
  pet.currentHp = 1
  useSkill(battle)
  same(pet.currentHp, 33, 'Saved first-use parameter survives fresh compilation')
  setAmount(directory, battle, 'skill', 0, 14)
  pet.currentHp = 1
  useSkill(battle)
  same(pet.currentHp, 35, 'Restored first-use parameter remains independent')
  same(heals, [12, 20, 14, 20], 'Behavior order and independent values')
  if (marks) {
    const first = pet.marks.find(mark => mark.baseId === 'demo/mark-0')!
    first.consumeStack(new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, pet.skills[0]), first.stack)
    require(!pet.marks.some(mark => mark.baseId === 'demo/mark-0'), 'First mark removed')
    require(pet.marks.some(mark => mark.baseId === 'demo/mark-1'), 'Second mark retained')
    same(pet.stat.spe, 291, 'Removing one mark removes only its contributions')
    setAmount(directory, battle, 'petMark', 1, -9)
    same(pet.stat.spe, 289, 'Remaining restored binding stays live')
  }
  same(errors, [], 'No swallowed execution errors')
  return {
    mode,
    marks,
    hp: pet.currentHp,
    speed: pet.stat.spe,
    heals,
    effectIds: directory.effects.map(effect => effect.id),
    rng: [battle.random(), battle.random()],
  }
}
interface Probe {
  mode: Mode
  marks: boolean
  snapshot: BattleSnapshot
  expected: ReturnType<typeof continueProbe>
}
export async function createBehaviorUseProbes(): Promise<Probe[]> {
  setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} })
  const probes: Probe[] = []
  for (const mode of ['native'] as const) {
    for (const marks of [false, true]) {
      const directory = behaviorCatalog(mode)
      const battle = createBattle(directory),
        other = createBattle(directory)
      let run: Promise<unknown> | undefined
      try {
        // Initial snapshots precede all execution; exercise the separate battle instead.
        for (const current of marks ? [battle, other] : [other]) {
          current.playerA.activePet.currentHp = 1
          useSkill(current)
          same(current.playerA.activePet.currentHp, 31, 'The saved 10/20 uses both execute')
        }
        setAmount(directory, battle, 'skill', 0, 12)
        other.playerA.activePet.currentHp = 1
        useSkill(other)
        same(other.playerA.activePet.currentHp, 31, 'Second battle retains original defaults')
        if (marks) {
          const ready = new Promise<void>(resolve =>
            battle.registerListener(message => {
              if (message.type === BattleMessageType.TurnAction) resolve()
            }),
          )
          run = battle.startBattle().catch(error => {
            if (!(error instanceof Error) || error.message !== 'Battle cancelled') throw error
          })
          await ready
          setupMarks(directory, battle)
          same(other.playerA.activePet.marks.length, 0, 'Mark state does not leak between battles')
        }
        const snapshot = JSON.parse(JSON.stringify(directory.snapshot(battle))) as BattleSnapshot
        const expected = continueProbe(directory, battle, mode, marks)
        probes.push({ mode, marks, snapshot, expected })
      } finally {
        await battle.cleanup()
        await other.cleanup()
        await run
      }
    }
  }
  return probes
}
export async function resumeBehaviorUseProbes(probes: readonly Probe[]) {
  setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} })
  const results: Probe['expected'][] = []
  for (const probe of probes) {
    const directory = behaviorCatalog(probe.mode)
    const battle = directory.restore(probe.snapshot)
    try {
      const result = continueProbe(directory, battle, probe.mode, probe.marks)
      same(result, probe.expected, 'Fresh compilation preserves state, order and RNG')
      results.push(result)
    } finally {
      await battle.cleanup()
    }
  }
  return results
}
