import { runScenario, makeScenario } from './scenario'
import { EffectParser, SkillParser, DataRepository } from '@arcadia-eternity/battle/v4/legacy'
import {
  Signal,
  GameRng,
  Modifier,
  DurationType,
  SkillPhase,
  TurnContext,
  EffectHandlingStrategy,
  PhaseState,
  setGlobalLogger,
} from '@arcadia-eternity/battle/v4'
import qili from './fixtures/qili.json'

export async function verifyV1() {
  setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} })
  const fullBattle = await runScenario()
  const { battle, a } = makeScenario()
  try {
    const repo = DataRepository.getInstance()
    for (const definition of qili.effects) {
      const effect = EffectParser.parse(definition)
      repo.effects.set(effect.id, effect)
    }
    const base = SkillParser.parse(qili.skill)
    const skill = a.activePet.skills[0]
    battle.transformationSystem.applyTransformation(
      skill,
      base,
      'permanent',
      0,
      undefined,
      undefined,
      EffectHandlingStrategy.Override,
    )
    const phase = new SkillPhase(battle, a, a.activePet, skill.target, skill, new TurnContext(battle))
    const atk = a.activePet.stat.atk
    battle.phaseManager.registerPhase(phase)
    const result = battle.phaseManager.executePhase(phase.id)
    if (!result.success || battle.phaseManager.getPhasesByState(PhaseState.Failed).length)
      throw new Error('Original DSL phase failed')
    const ratio = a.activePet.stat.atk / atk
    if (ratio !== 1.5) throw new Error('Original Qili DSL did not change attack')
    const source = new Signal(3)
    const remove = a.activePet.attributeSystem.addModifier(
      'atk',
      new Modifier(DurationType.binding, 'host-dynamic', source, 'delta', 0),
    )
    const before = a.activePet.stat.atk
    source.next(9)
    const after = a.activePet.stat.atk
    remove()
    if (after - before !== 6 || source.observerCount !== 0) throw new Error('Dynamic value/cleanup differs')
    const rng = new GameRng('host-port')
    rng.next()
    const saved = rng.getState()
    const restored = GameRng.fromState(JSON.parse(JSON.stringify(saved)))
    const continuation = Array.from({ length: 8 }, () => rng.next())
    if (continuation.some(n => n !== restored.next())) throw new Error('RNG continuation differs')
    return {
      fullBattle,
      originalDsl: { skill: base.id, attackRatio: ratio },
      dynamic: { before, after },
      rng: { algorithm: saved.algorithm, continuation },
    }
  } finally {
    await battle.cleanup()
  }
}
