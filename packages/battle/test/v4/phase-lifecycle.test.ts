import { afterEach, beforeAll, expect, it } from 'vitest'
import {
  ConfigSystem,
  BaseMark,
  Effect,
  EffectTrigger,
  MarkUpdatePhase,
  type baseMarkId,
  type effectId,
  ConfigModifierType,
  DurationType,
  Modifier,
  SynchronousPhase,
  TurnContext,
  PhaseType,
  PhaseScope,
  ConfigDurationType,
  ConfigModifier,
  EffectHandlingStrategy,
  setGlobalLogger,
  type Battle,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
const battles: Battle[] = []
function fixture() {
  const f = makeScenario()
  battles.push(f.battle)
  return f
}
class TurnPhase extends SynchronousPhase<TurnContext> {
  constructor(
    battle: Battle,
    private readonly action: (phase: TurnPhase) => void,
  ) {
    super(battle)
  }
  protected createContext() {
    return new TurnContext(this.battle)
  }
  protected executeOperation() {
    this.action(this)
  }
}
function run(battle: Battle, action: (phase: TurnPhase) => void) {
  const phase = new TurnPhase(battle, action)
  battle.phaseManager.registerPhase(phase)
  const result = battle.phaseManager.executePhase(phase.id)
  if (!result.success) throw result.error
}
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
})
it('uses this Battle config and removes concrete-phase config modifiers immediately', () => {
  const { battle } = fixture()
  battle.configSystem.registerConfig('phase-local', 10)
  run(battle, phase => {
    phase.addConfigModifier('phase-local', ConfigModifierType.delta, 5)
    expect(battle.configSystem.get('phase-local', battle)).toBe(15)
  })
  expect(battle.configSystem.get('phase-local', battle)).toBe(10)
})
it('activates an attribute phase modifier synchronously and isolates two simultaneous Battles', () => {
  const first = fixture(),
    second = fixture()
  first.a.activePet.attributeSystem.addModifier(
    'atk',
    new Modifier(DurationType.phaseType, 'phase-atk', 10, 'delta', 0, undefined, undefined, undefined, {
      phaseType: PhaseType.Turn,
      scope: PhaseScope.Current,
    }),
  )
  run(first.battle, () => {
    expect(first.a.activePet.stat.atk).toBe(65)
    run(second.battle, () => {
      expect(first.a.activePet.stat.atk).toBe(65)
      expect(second.a.activePet.stat.atk).toBe(55)
    })
    expect(first.a.activePet.stat.atk).toBe(65)
  })
  expect(first.a.activePet.stat.atk).toBe(55)
})
it('binds Next to the next turn, excluding the turn active at registration, and cleans scoped storage', () => {
  const { battle, a } = fixture()
  battle.configSystem.registerConfig('next-value', 10)
  run(battle, () => {
    battle.configSystem.addScopedPhaseTypeConfigModifier(
      'next-value',
      new ConfigModifier(ConfigDurationType.phaseType, 'next', 5, ConfigModifierType.delta, 0),
      { phaseType: PhaseType.Turn, scope: PhaseScope.Next },
      a,
    )
    expect(battle.configSystem.get('next-value', a.activePet)).toBe(10)
  })
  run(battle, () => expect(battle.configSystem.get('next-value', a.activePet)).toBe(15))
  run(battle, () => expect(battle.configSystem.get('next-value', a.activePet)).toBe(10))
})
it('preserves the CURRENT HP ratio when reverting a form after taking damage', () => {
  const { battle, a } = fixture(),
    pet = a.activePet
  const transformed = { ...pet.base, baseStats: { ...pet.base.baseStats, hp: 400 } }
  battle.transformationSystem.applyTransformation(
    pet,
    transformed,
    'temporary',
    0,
    undefined,
    undefined,
    EffectHandlingStrategy.Preserve,
  )
  pet.currentHp = 180
  const ratio = pet.currentHp / pet.stat.maxHp
  battle.transformationSystem.removeTransformation(pet)
  expect(pet.currentHp).toBe(Math.floor(260 * ratio))
})
it('propagates failed synchronous phases instead of silently continuing Battle', () => {
  const { battle } = fixture()
  const phase = new TurnPhase(battle, () => {
    throw new Error('phase failure')
  })
  battle.phaseManager.registerPhase(phase)
  expect(() => battle.phaseManager.executePhase(phase.id)).toThrow('phase failure')
})

it('suppresses native mark effects and modifiers during Override without losing a form-causing source', () => {
  let fired = 0
  const ability = new BaseMark(
    'native' as baseMarkId,
    [
      new Effect<EffectTrigger>(
        'native-effect' as effectId,
        [EffectTrigger.TurnStart],
        () => {
          fired++
        },
        0,
      ),
    ],
    { ...new BaseMark('default' as baseMarkId, []).config, persistent: false, duration: 1 },
  )
  const { a, battle } = makeScenario(201, undefined, false, ability)
  battles.push(battle)
  const pet = a.activePet,
    source = pet.marks[0]
  pet.attributeSystem.addModifier('atk', new Modifier(DurationType.binding, 'native-modifier', 10, 'delta', 0, source))
  expect(pet.stat.atk).toBe(65)
  battle.configSystem.registerConfig('native-config', 10)
  battle.configSystem.addScopedConfigModifier(
    'native-config',
    new ConfigModifier(ConfigDurationType.binding, 'native-config', 5, ConfigModifierType.delta, 0, source),
    pet,
  )
  expect(battle.configSystem.get('native-config', pet)).toBe(15)
  const changed = { ...pet.base, ability: [], emblem: [] }
  battle.transformationSystem.applyTransformation(
    pet,
    changed,
    'temporary',
    0,
    source,
    undefined,
    EffectHandlingStrategy.Override,
  )
  battle.applyEffects(new TurnContext(battle), EffectTrigger.TurnStart)
  expect(fired).toBe(0)
  expect(source.owner).toBe(pet)
  expect(source.isSuppressed).toBe(true)
  expect(pet.stat.atk).toBe(55)
  expect(battle.configSystem.get('native-config', pet)).toBe(10)
  const update = new MarkUpdatePhase(battle, new TurnContext(battle), source)
  battle.phaseManager.registerPhase(update)
  battle.phaseManager.executePhase(update.id)
  expect(source.isActive).toBe(false)
  expect(battle.transformationSystem.getTransformationState(pet).isTransformed).toBe(false)
  expect(pet.stat.atk).toBe(55)
  battle.applyEffects(new TurnContext(battle), EffectTrigger.TurnStart)
  expect(fired).toBe(1)
})

it('rejects unsupported automatic retry before mutating state', () => {
  const { battle } = fixture()
  let writes = 0
  const phase = new TurnPhase(battle, () => {
    writes++
    throw new Error('partially mutated')
  })
  battle.phaseManager.registerPhase(phase)
  expect(() => battle.phaseManager.executePhase(phase.id, { retryCount: 1 })).toThrow('rollback')
  expect(writes).toBe(0)
})

it('publishes a phase modifier immediately when it is registered inside the bound phase', () => {
  const { a, battle } = fixture()
  const values: unknown[] = []
  const sub = a.activePet.attributeSystem.getAttribute$('atk').subscribe(value => values.push(value))
  run(battle, () => {
    a.activePet.attributeSystem.addModifier(
      'atk',
      new Modifier(DurationType.phaseType, 'current', 10, 'delta', 0, undefined, undefined, undefined, {
        phaseType: PhaseType.Turn,
        scope: PhaseScope.Current,
      }),
    )
    expect(values.at(-1)).toBe(65)
  })
  expect(values.at(-1)).toBe(55)
  sub.unsubscribe()
})

it('honors the actual caller-supplied ConfigSystem for phase attributes', () => {
  const config = ConfigSystem.createInstance()
  const { battle, a } = makeScenario(201, undefined, false, undefined, config)
  battles.push(battle)
  a.activePet.attributeSystem.addModifier(
    'atk',
    new Modifier(DurationType.phaseType, 'custom-config', 10, 'delta', 0, undefined, undefined, undefined, {
      phaseType: PhaseType.Turn,
      scope: PhaseScope.Current,
    }),
  )
  try {
    run(battle, () => expect(a.activePet.stat.atk).toBe(65))
  } finally {
    config.destroy()
  }
})
