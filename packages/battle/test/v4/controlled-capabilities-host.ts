import {
  AttackTargetOpinion,
  BattleMessageType,
  Category,
  EffectContext,
  EffectTrigger,
  Element,
  Nature,
  StackStrategy,
  SwitchPetContext,
  TurnContext,
  UseSkillContext,
  setGlobalLogger,
  parameterAddress,
  type BaseMark,
  type Battle,
  type BattleSnapshot,
  type MarkInstance,
} from '../../v4'
import { createContentCatalog, type ContentCatalog } from '../../src/v4/content/definition-catalog'
import { behaviorEffectId, defineNativeBehavior } from '../../src/v4/content/behaviors'
import { CapabilityRegistry } from '../../src/v4/content/capabilities'
import { coreCapabilities } from '../../src/v4/content/core-capabilities'
import { defineAddMarkAction } from '../../src/v4/content/mark-actions'
import {
  actions,
  bindings,
  conditions,
  defineEffect,
  numberParam,
  ops,
  targets,
  values,
} from '../../src/v4/content/authoring'

type Mode = 'rule' | 'native'
type Scenario = 'damage' | 'stacks' | 'capture'
const skillId = 'controlled/skill'
const sourceIds = ['controlled/source-0', 'controlled/source-1'] as const
const damageParameters = {
  ratio: { kind: 'number', default: 0.25, minimum: 0, maximum: 1 },
  heal: { kind: 'number', default: 3, minimum: 0, maximum: 10 },
} as const
const stackParameters = { amount: { kind: 'number', default: -3, minimum: -10, maximum: 0 } } as const
const captureParameters = { amount: { kind: 'number', default: 1, minimum: 0, maximum: 3 } } as const
const addParameters = { stack: { kind: 'number', default: 1, minimum: 1, maximum: 5, integer: true } } as const
const node = (id: string) => ({ node: id })
const parameter = (id: string) => ({ parameter: id })

function require(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}
function same(actual: unknown, expected: unknown, message: string) {
  require(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)}`)
}
function declaredParameters(
  parameters: typeof damageParameters | typeof stackParameters | typeof captureParameters | typeof addParameters,
) {
  return Object.fromEntries(
    Object.entries(parameters).map(([name, value]) => [
      name,
      { nodeId: `${name}-node`, kind: value.kind, value: value.default },
    ]),
  )
}
function damageRule() {
  return {
    formatVersion: 1,
    id: 'controlled/damage-rule',
    parameters: declaredParameters(damageParameters),
    trigger: { nodeId: 'trigger', id: 'core.selfSkillHitTarget' },
    roll: { nodeId: 'chance', percent: 100 },
    values: [
      { nodeId: 'opponent', id: 'core.opponentActive' },
      { nodeId: 'selected', id: 'core.firstPet', inputs: { target: node('opponent') } },
      {
        nodeId: 'defense',
        id: 'core.petAttribute',
        params: { attribute: 'def' },
        inputs: { target: node('selected') },
      },
      { nodeId: 'damage', id: 'core.multiply', inputs: { left: node('defense'), right: parameter('ratio') } },
    ],
    actions: [
      { stepId: 'damage-step', id: 'core.dealDamage', inputs: { target: node('opponent'), amount: node('damage') } },
      { stepId: 'heal-step', id: 'core.healOwner', params: { amount: parameter('heal') } },
    ],
  }
}
function bindingRule(scenario: 'stacks' | 'capture') {
  const selected = scenario === 'stacks' ? 'core.sourceMark' : 'core.opponentActive'
  const first = scenario === 'stacks' ? 'core.firstMark' : 'core.firstPet'
  const follow = scenario === 'stacks' ? 'core.followMark' : 'core.followPet'
  return {
    formatVersion: 1,
    id: `controlled/${scenario}-rule`,
    parameters: declaredParameters(scenario === 'stacks' ? stackParameters : captureParameters),
    trigger: { nodeId: 'trigger', id: 'core.markCreated' },
    values: [
      { nodeId: 'owner', id: 'core.ownerPet' },
      { nodeId: 'selection', id: selected },
      { nodeId: 'first', id: first, inputs: { target: node('selection') } },
      { nodeId: 'membership', id: follow, inputs: { target: node('first') } },
      {
        nodeId: 'property',
        id: scenario === 'stacks' ? 'core.boundMarkStack' : 'core.boundPetAttribute',
        params: scenario === 'stacks' ? { mode: 'follow' } : { attribute: 'def', mode: 'capture', scope: 'input' },
        inputs: { target: node('membership') },
      },
      { nodeId: 'factor', id: 'core.followNumber', inputs: { value: parameter('amount') } },
      { nodeId: 'contribution', id: 'core.multiplyBinding', inputs: { left: node('property'), right: node('factor') } },
    ],
    actions: [
      {
        stepId: 'speed',
        id: 'core.bindAttribute',
        params: { attribute: 'spe', operation: 'delta', lifetime: 'sourceMark', missing: 'detach' },
        inputs: { target: node('owner'), value: node('contribution') },
      },
    ],
  }
}
function metadata(mode: Mode, scenario: Scenario) {
  const sharedParameters = scenario === 'stacks' ? stackParameters : captureParameters
  const behaviors =
    scenario === 'damage'
      ? [
          {
            formatVersion: 1,
            id: 'controlled/damage',
            sourceKind: 'skill',
            parameters: damageParameters,
            implementation:
              mode === 'rule' ? { kind: 'rule', rule: damageRule() } : { kind: 'native', exportId: 'trusted/damage' },
          },
        ]
      : [
          {
            formatVersion: 1,
            id: 'controlled/binding',
            sourceKind: 'petMark',
            parameters: sharedParameters,
            implementation:
              mode === 'rule'
                ? { kind: 'rule', rule: bindingRule(scenario) }
                : { kind: 'native', exportId: 'trusted/binding' },
          },
          ...sourceIds.map((_id, index) => ({
            formatVersion: 1,
            id: `controlled/add-${index}`,
            sourceKind: 'skill',
            parameters: addParameters,
            implementation:
              mode === 'rule'
                ? {
                    kind: 'rule',
                    rule: {
                      formatVersion: 1,
                      id: `controlled/add-rule-${index}`,
                      parameters: declaredParameters(addParameters),
                      trigger: { nodeId: 'trigger', id: 'core.selfSkillHitTarget' },
                      actions: [
                        {
                          stepId: 'create',
                          id: `trusted/add-${index}`,
                          params: { stack: parameter('stack'), duration: 20 },
                        },
                      ],
                    },
                  }
                : { kind: 'native', exportId: `trusted/add-${index}` },
          })),
        ]
  return {
    behaviors,
    marks:
      scenario === 'damage'
        ? []
        : sourceIds.map((id, index) => ({
            id,
            effect: [],
            config: {
              stackable: true,
              maxStacks: 5,
              stackStrategy: StackStrategy.stack,
              persistent: true,
              duration: 20,
              keepOnSwitchOut: true,
            },
            behaviors: [
              {
                useId: 'shared',
                definitionId: 'controlled/binding',
                params: { amount: scenario === 'stacks' ? [-3, -7][index] : index + 1 },
              },
            ],
          })),
    skills: [
      {
        id: skillId,
        element: Element.Normal,
        category: Category.Status,
        power: 0,
        rage: 0,
        accuracy: 100,
        effect: [],
        behaviors:
          scenario === 'damage'
            ? [0.25, 0.5].map((ratio, index) => ({
                useId: `use-${index}`,
                definitionId: 'controlled/damage',
                params: { ratio },
              }))
            : sourceIds.map((_id, index) => ({
                useId: `use-${index}`,
                definitionId: `controlled/add-${index}`,
                params: { stack: scenario === 'stacks' && index === 0 ? 2 : 1 },
              })),
      },
    ],
    species: [
      {
        id: 'controlled/species',
        num: 1,
        element: Element.Normal,
        baseStats: { hp: 100, atk: 100, spa: 100, def: 100, spd: 100, spe: 100 },
        genderRatio: null,
        heightRange: [1, 2],
        weightRange: [1, 2],
        learnable_skills: [{ skill_id: skillId, level: 1, hidden: false }],
        ability: [],
        emblem: [],
      },
    ],
  }
}
function nativeExports(scenario: Scenario, marks: ReadonlyMap<string, BaseMark>) {
  if (scenario === 'damage')
    return [
      defineNativeBehavior({
        id: 'trusted/damage',
        sourceKind: 'skill',
        parameters: damageParameters,
        build({ effectId, params }) {
          const ratio = numberParam({ default: params.ratio as number })
          const heal = numberParam({ default: params.heal as number })
          const amount = values.combine(
            targets.opponentActive.first().attribute('def'),
            ratio,
            (defense, factor) => defense * factor,
          )
          return defineEffect({
            id: effectId,
            on: 'OnHit',
            parameters: { ratio, heal },
            when: conditions.all(conditions.selfUsesSkill, conditions.chance(100)),
            execute: actions.sequence(
              targets.opponentActive.apply(ops.dealDamage(amount)),
              targets.ownerPet.apply(ops.heal(heal)),
            ),
          })
        },
      }),
    ]
  return [
    defineNativeBehavior({
      id: 'trusted/binding',
      sourceKind: 'petMark',
      parameters: scenario === 'stacks' ? stackParameters : captureParameters,
      build({ effectId, params }) {
        const amount = numberParam({ default: params.amount as number })
        const property =
          scenario === 'stacks'
            ? targets.sourceMark.first().follow({ key: 'membership' }).attribute('stack').follow({ key: 'property' })
            : targets.opponentActive
                .first()
                .follow({ key: 'membership' })
                .attribute('def')
                .capture({ key: 'property', scope: 'input' })
        const contribution = bindings.combine(
          property,
          amount.follow({ key: 'factor' }),
          (value, factor) => value * factor,
        )
        return defineEffect({
          id: effectId,
          on: 'OnMarkCreated',
          parameters: { amount },
          execute: targets.ownerPet.apply(
            ops.bindAttribute({
              key: 'speed',
              attribute: 'spe',
              operation: 'delta',
              value: contribution,
              lifetime: 'sourceMark',
              missing: 'detach',
            }),
          ),
        })
      },
    }),
    ...sourceIds.map((id, index) =>
      defineNativeBehavior({
        id: `trusted/add-${index}`,
        sourceKind: 'skill',
        parameters: addParameters,
        build({ effectId, params }) {
          const stack = numberParam({ default: params.stack as number })
          const mark = marks.get(id)
          require(mark, 'Native add-mark export requires canonical content')
          return defineEffect({
            id: effectId,
            on: 'OnHit',
            parameters: { stack },
            when: conditions.selfUsesSkill,
            execute: targets.ownerPet.apply(ops.addMark(mark, { stack, duration: 20 })),
          })
        },
      }),
    ),
  ]
}
export function controlledCapabilityCatalog(mode: Mode, scenario: Scenario) {
  return createContentCatalog(
    JSON.parse(JSON.stringify(metadata(mode, scenario))),
    `controlled-capabilities/v1/${mode}/${scenario}`,
    undefined,
    [],
    ({ marks }) => ({
      registry: new CapabilityRegistry(
        [
          ...coreCapabilities.actions,
          ...[...marks].map(([id, mark]) =>
            defineAddMarkAction({
              id: `trusted/add-${sourceIds.indexOf(id as (typeof sourceIds)[number])}`,
              mark,
              target: 'ownerPet',
            }),
          ),
        ],
        coreCapabilities,
      ),
      nativeExports: nativeExports(scenario, marks),
    }),
  )
}
function createBattle(directory: ContentCatalog) {
  const players = directory.parsePlayers(
    [0, 1].map(player => ({
      name: `Player ${player}`,
      id: String(player).repeat(21),
      team: [0, 1].map(index => ({
        name: `Pet ${player}/${index}`,
        id: String(2 + player * 2 + index).repeat(21),
        species: 'controlled/species',
        level: 100,
        evs: { hp: 0, atk: 0, spa: 0, def: 0, spd: 0, spe: 0 },
        ivs: { hp: 31, atk: 31, spa: 31, def: 31, spd: 31, spe: 31 },
        nature: Nature.Hardy,
        skills: [skillId],
      })),
    })),
  )
  const battle = directory.createBattle(players[0], players[1], {
    rngSeed: 'controlled-capabilities-242',
    timerConfig: { enabled: false },
  })
  battle.playerA.activePet.attributeSystem.updateBaseValue('spe', 300)
  battle.playerB.team[0].attributeSystem.updateBaseValue('def', 40)
  battle.playerB.team[1].attributeSystem.updateBaseValue('def', 80)
  return battle
}
function useSkill(battle: Battle) {
  const player = battle.playerA,
    pet = player.activePet,
    skill = pet.skills[0]
  const context = new UseSkillContext(new TurnContext(battle), player, pet, AttackTargetOpinion.opponent, skill)
  context.updateActualTarget()
  battle.applyEffects(context, EffectTrigger.OnHit, skill)
}
function setParameter(
  directory: ContentCatalog,
  battle: Battle,
  mode: Mode,
  kind: 'skill' | 'petMark',
  index: number,
  name: string,
  amount: number,
) {
  const effectId = behaviorEffectId(
    { kind, id: kind === 'skill' ? skillId : sourceIds[index] },
    kind === 'skill' ? `use-${index}` : 'shared',
  )
  const parameters = directory.parametersFor(effectId)
  require(parameters, 'Behavior parameters must be installed in the formal catalog')
  parameters.set(
    battle.configSystem,
    parameterAddress(effectId, mode === 'rule' ? `${name}-node` : 'parameters', name),
    amount,
  )
}
function source(battle: Battle, index: number): MarkInstance {
  const result = battle.playerA.team[0].marks.find(mark => mark.baseId === sourceIds[index])
  require(result, `Missing source mark ${index}`)
  return result
}
function removeSource(battle: Battle, index: number) {
  const mark = source(battle, index)
  mark.consumeStack(
    new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, battle.playerA.activePet.skills[0]),
    mark.stack,
  )
}
function switchOpponent(battle: Battle, index: number) {
  battle.playerB.performSwitchPet(
    new SwitchPetContext(new TurnContext(battle), battle.playerB, battle.playerB.team[index]),
  )
}
function continueProbe(directory: ContentCatalog, battle: Battle, mode: Mode, scenario: Scenario) {
  const events: { type: 'damage' | 'heal'; amount: number }[] = [],
    errors: string[] = [],
    states: number[] = []
  battle.registerListener(message => {
    if (message.type === BattleMessageType.Damage) events.push({ type: 'damage', amount: message.data.damage })
    if (message.type === BattleMessageType.Heal) events.push({ type: 'heal', amount: message.data.amount })
    if (([BattleMessageType.EffectApplyFail, BattleMessageType.Error] as BattleMessageType[]).includes(message.type))
      errors.push(message.type)
  })
  const pet = battle.playerA.team[0]
  const speed = (expected: number, message: string) => {
    same(pet.stat.spe, expected, message)
    states.push(pet.stat.spe)
  }
  if (scenario === 'damage') {
    pet.currentHp = 10
    battle.playerB.activePet.currentHp = 200
    useSkill(battle)
    same(battle.playerB.activePet.currentHp, 168, 'Both reloaded damage uses settle through the damage path')
    same(pet.currentHp, 16, 'Ordered healing action follows each damage')
    setParameter(directory, battle, mode, 'skill', 0, 'ratio', 0.35)
    useSkill(battle)
    same(battle.playerB.activePet.currentHp, 134, 'Changing first damage parameter leaves second use unchanged')
    same(
      events,
      [12, 3, 20, 3, 14, 3, 20, 3].map((amount, index) => ({ type: index % 2 ? 'heal' : 'damage', amount })),
      'Ordered damage and healing domain events',
    )
  } else if (scenario === 'stacks') {
    speed(293, 'Saved source suppression excludes only that contribution')
    source(battle, 0).isSuppressed = false
    speed(277, 'Resuming restores one contribution with saved independent parameter')
    source(battle, 0).stack = 2
    speed(285, 'Stack change updates only its source contribution')
    same(source(battle, 1).stack, 1, 'Other source stack stays independent')
    removeSource(battle, 0)
    speed(293, 'Destroying first source removes its bound contribution')
    source(battle, 1).stack = 2
    speed(286, 'Remaining source continues following after fresh restoration')
    removeSource(battle, 1)
    speed(300, 'Destroying all sources leaves no leaked contribution')
  } else {
    speed(420, 'Snapshot preserves captured 40 even though live defense is 50')
    battle.playerB.team[0].attributeSystem.updateBaseValue('def', 55)
    speed(420, 'Capturing an attribute freezes that step within its input generation')
    switchOpponent(battle, 1)
    speed(540, 'Following the active slot captures the incoming pet defense')
    battle.playerB.team[1].attributeSystem.updateBaseValue('def', 90)
    speed(540, 'Property changes on the same selected identity do not recapture')
    switchOpponent(battle, 0)
    speed(465, 'Reentry of a previous identity starts a new capture generation')
    Reflect.set(battle.playerB, 'activePet', undefined)
    speed(300, 'Missing followed target detaches contributions without inventing zero inputs')
    battle.playerB.team[0].attributeSystem.updateBaseValue('def', 60)
    battle.playerB.activePet = battle.playerB.team[0]
    speed(480, 'Returning after absence captures the new property value')
    source(battle, 0).isSuppressed = true
    speed(420, 'Pausing one source leaves the other source active')
    setParameter(directory, battle, mode, 'petMark', 0, 'amount', 3)
    speed(420, 'Changing a paused source parameter does not reactivate it')
    source(battle, 0).isSuppressed = false
    speed(600, 'Resuming uses the independent updated parameter')
    removeSource(battle, 0)
    speed(420, 'Removing one capture leaves the other capture live')
    removeSource(battle, 1)
    speed(300, 'Capture contributions clean up with their last source')
  }
  same(errors, [], 'No swallowed execution errors')
  return {
    scenario,
    states,
    events,
    ownerHp: pet.currentHp,
    opponentHp: battle.playerB.activePet.currentHp,
    sourceCount: pet.marks.length,
    effectIds: directory.effects.map(effect => effect.id),
    rng: [battle.random(), battle.random()],
  }
}
interface ControlledProbe {
  mode: Mode
  scenario: Scenario
  snapshot: BattleSnapshot
  expected: ReturnType<typeof continueProbe>
}
export async function createControlledCapabilityProbes(): Promise<ControlledProbe[]> {
  setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} })
  const probes: ControlledProbe[] = []
  for (const scenario of ['damage', 'stacks', 'capture'] as const) {
    for (const mode of ['rule', 'native'] as const) {
      const directory = controlledCapabilityCatalog(mode, scenario)
      const battle = createBattle(directory),
        other = createBattle(directory)
      let run: Promise<unknown> | undefined
      try {
        if (scenario === 'damage') {
          other.playerA.activePet.currentHp = 10
          other.playerB.activePet.currentHp = 200
          setParameter(directory, battle, mode, 'skill', 0, 'ratio', 0.3)
          useSkill(other)
          same(other.playerB.activePet.currentHp, 170, 'Another battle retains both original damage parameters')
        } else {
          const ready = new Promise<void>(resolve =>
            battle.registerListener(message => {
              if (message.type === BattleMessageType.TurnAction) resolve()
            }),
          )
          run = battle.startBattle().catch(error => {
            if (!(error instanceof Error) || error.message !== 'Battle cancelled') throw error
          })
          await ready
          useSkill(battle)
          same(battle.playerA.activePet.marks.length, 2, 'Saved skill rules create both parameterized mark sources')
          same(other.playerA.activePet.marks.length, 0, 'Marks and bound contributions stay local to their battle')
          same(other.playerA.activePet.stat.spe, 300, 'Another battle has no leaked contribution')
          if (scenario === 'stacks') {
            same(battle.playerA.activePet.stat.spe, 287, 'Independent mark parameters multiply their own stacks')
            source(battle, 0).stack = 4
            same(battle.playerA.activePet.stat.spe, 281, 'Stack updates flow through the native binding lifetime')
            setParameter(directory, battle, mode, 'petMark', 0, 'amount', -4)
            same(
              battle.playerA.activePet.stat.spe,
              277,
              'Changing one mark behavior parameter does not affect the other',
            )
            source(battle, 0).isSuppressed = true
            same(battle.playerA.activePet.stat.spe, 293, 'Suppression pauses contribution before snapshot')
          } else {
            same(battle.playerA.activePet.stat.spe, 420, 'Two independent sources capture the incoming defense')
            battle.playerB.activePet.attributeSystem.updateBaseValue('def', 50)
            same(battle.playerA.activePet.stat.spe, 420, 'Attribute capture differs from following the property')
          }
        }
        const snapshot = JSON.parse(JSON.stringify(directory.snapshot(battle))) as BattleSnapshot
        const expected = continueProbe(directory, battle, mode, scenario)
        const previous = probes.find(probe => probe.scenario === scenario)
        if (previous)
          same(
            expected,
            previous.expected,
            `Saved ${scenario} rules match equivalent native state, RNG and action order`,
          )
        probes.push({ mode, scenario, snapshot, expected })
      } finally {
        await battle.cleanup()
        await other.cleanup()
        await run
      }
    }
  }
  return probes
}
export async function resumeControlledCapabilityProbes(probes: readonly ControlledProbe[]) {
  setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} })
  const results: ControlledProbe['expected'][] = []
  for (const probe of probes) {
    const directory = controlledCapabilityCatalog(probe.mode, probe.scenario)
    const battle = directory.restore(probe.snapshot)
    try {
      const result = continueProbe(directory, battle, probe.mode, probe.scenario)
      same(
        result,
        probe.expected,
        'Fresh factories restore captures, parameters, order and RNG without reinstalling contributions',
      )
      results.push(result)
    } finally {
      await battle.cleanup()
    }
  }
  return results
}
