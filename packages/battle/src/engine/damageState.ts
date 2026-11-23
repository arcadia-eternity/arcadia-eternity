import { BattleMessageType, EffectTrigger } from '@arcadia-eternity/const'
import type { Battle } from './battle'
import {
  DefeatContext,
  RageContext,
  UseSkillContext,
  type AllContext,
  type DamageContext,
  type EffectContext,
} from './context'
import { Pet } from './pet'
import { SkillInstance } from './skill'

/** Publish each transition once, after the cause and its damage reactions have settled. */
function confirmDefeat(event: DefeatContext): void {
  const { battle, target, killer, skill } = event
  if (!target.isAlive || target.currentHp > 0) return
  target.isAlive = false
  if (target.isActive()) {
    battle.lastKiller = killer && killer.owner !== target.owner ? (killer.owner ?? undefined) : undefined
  }
  for (let parent: AllContext | null = event.parent; parent; parent = parent.parent) {
    if (parent instanceof UseSkillContext) {
      if (parent.pet === killer && parent.skill === skill) parent.defeated = true
      break
    }
  }
  battle.emitMessage(BattleMessageType.PetDefeated, { pet: target.id, killer: killer?.id })
  battle.applyEffects(event, EffectTrigger.OnDefeat)
}

/** Direct authored HP assignments and executions share the same confirmed-defeat boundary. */
export function setEffectHp(source: EffectContext<EffectTrigger>, target: Pet, hp: number): void {
  if (!target.isAlive) return
  const wasPositive = target.currentHp > 0
  target.attributeSystem.setCurrentHp(hp)
  if (wasPositive && target.currentHp <= 0) {
    const killer = source.source.owner instanceof Pet ? source.source.owner : undefined
    const skill = source.source instanceof SkillInstance ? source.source : undefined
    confirmDefeat(new DefeatContext(source, target, killer, skill))
  }
}

export function settleDamageState(context: DamageContext, battle: Battle): void {
  const result = context.result
  if (!result || result.hpLoss <= 0) return
  const target = battle.petMap.get(result.targetId)
  if (!target) throw new Error('Committed damage target is missing from battle')
  if (result.intent.policy.skillReactions && target.owner) {
    const amount = Math.floor((result.hpLoss * 49) / target.stat.maxHp)
    target.owner.addRage(new RageContext(context, target.owner, 'damage', 'add', amount))
  }
  if (result.hpAfter > 0 || target.currentHp > 0 || !target.isAlive) return
  const { petId, skillInstanceId } = result.origin
  const killer = petId ? battle.petMap.get(petId) : undefined
  let skill = skillInstanceId ? battle.skillMap.get(skillInstanceId) : undefined
  if (context.source instanceof SkillInstance && context.source.id === skillInstanceId) skill = context.source
  confirmDefeat(new DefeatContext(context, target, killer, skill))
}
