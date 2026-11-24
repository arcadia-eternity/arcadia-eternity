/** Public effect authoring API. Battle execution and host setup live in the engine entry. */
import type * as Domain from './src/engine/content/authoring/domain'
import { BaseMark as HostMark, BaseStatLevelMark as HostStatMark } from './src/engine/mark'
import { Pet as HostPet } from './src/engine/pet'
import { Effect as HostEffect } from './src/engine/effect'
import { UseSkillContext as HostSkillContext } from './src/engine/context'
import { ParameterCatalog as HostParameters } from './src/engine/content/parameters'
import type { EffectTrigger } from '@arcadia-eternity/const'
import { defineEffects as compileGroup, type DefineEffects } from './src/engine/content/authoring/define-effects'
import { compileEffect as compile, effectParameters as parameters } from './src/engine/content/authoring/runtime'
import type { Trigger, Parameter, EffectDefinition } from './src/engine/content/authoring/contracts'

export type {
  MarkConfig,
  BattleMessageData,
  DamageIntent,
  DamageOrigin,
  DamagePolicy,
  DamageResult,
  DamageTraceEntry,
  DamagePayment,
  baseMarkId,
  effectId,
  baseSkillId,
  markId,
  skillId,
  petId,
  speciesId,
  playerId,
} from '@arcadia-eternity/const'
export {
  AttackTargetOpinion,
  Category,
  CleanStageStrategy,
  DamageType,
  EffectTrigger,
  Element,
  Gender,
  IgnoreStageStrategy,
  StackStrategy,
  StatType,
  StatTypeWithoutHp,
  effectSdkApiVersion,
} from '@arcadia-eternity/const'
export { ConfigModifierType } from './src/engine/config'
export type {
  Battle,
  Player,
  MarkInstance,
  BaseSkill,
  SkillInstance,
  Context,
  AllContext,
  TurnContext,
  DefeatContext,
  TransformContext,
  EffectContext,
  DamageContext,
  HealContext,
  RageContext,
  AddMarkContext,
  RemoveMarkContext,
  ConsumeStackContext,
  StackContext,
  SwitchPetContext,
} from './src/engine/content/authoring/domain'

type Identity<T> = abstract new (...args: never[]) => T
export type Pet = Domain.Pet
export const Pet: Identity<Pet> = HostPet
export type BaseMark = Domain.BaseMark
export const BaseMark: Identity<BaseMark> = HostMark
export type BaseStatLevelMark = Domain.BaseStatLevelMark
export const BaseStatLevelMark: Identity<BaseStatLevelMark> = HostStatMark
export interface Effect<T extends EffectTrigger> {
  readonly id: HostEffect<T>['id']
  readonly trigger: T
  readonly priority: number
  readonly tags: readonly string[]
}
export const Effect: Identity<Effect<EffectTrigger>> = HostEffect
export type UseSkillContext = Domain.UseSkillContext
export const UseSkillContext: Identity<UseSkillContext> = HostSkillContext
export interface ParameterCatalog {
  readonly addressOf: HostParameters['addressOf']
}
export const ParameterCatalog: new (...args: ConstructorParameters<typeof HostParameters>) => ParameterCatalog =
  HostParameters
export { parameterAddress, defineParameter } from './src/engine/content/parameters'
export type * from './src/engine/content/authoring/contracts'
export type { EffectFrame as NativeEffectContext } from './src/engine/content/authoring/contracts'

export const defineEffects: DefineEffects<Effect<EffectTrigger>> = compileGroup
export function compileEffect<
  const T extends Trigger,
  const P extends Readonly<Record<string, Parameter<unknown>>> = Record<never, never>,
>(input: EffectDefinition<T, P>): Effect<EffectTrigger> {
  return compile(input)
}
export const effectParameters: (effect: Effect<EffectTrigger>) => ParameterCatalog = parameters
export {
  defineEffect,
  selectFrom,
  numberParam,
  booleanParam,
  stringParam,
  targets,
  contexts,
  conditions,
  checks,
  actions,
  values,
  bindings,
  ops,
  hasAuthoredParameters,
} from './src/engine/content/authoring/runtime'
export { defineCodeEffect, type CodeEffectContext } from './src/engine/content/code-effects'
export { defineNativeBehavior, type NativeBehaviorExport } from './src/engine/content/behaviors'
export type { EffectSdk, CodeEffectModuleContext, CodeEffectModule } from './src/engine/content/effect-sdk'
export { nativeEffectTriggers, type NativeEffectTrigger } from './src/engine/content/native-effect'
export { defineEffectState, type EffectStateDefinition } from './src/engine/content/effect-state'
