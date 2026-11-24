import type { EffectTrigger } from '@arcadia-eternity/const'
import type { domainFields } from '../../../sandbox/projection'
import type * as Events from '../../context'
import type { Battle as EngineBattle } from '../../battle'
import type { Pet as EnginePet } from '../../pet'
import type { Player as EnginePlayer } from '../../player'
import type * as Marks from '../../mark'
import type * as Skills from '../../skill'
import type { Effect as EngineEffect } from '../../effect'
import type { ParameterCatalog as EngineParameters } from '../parameters'

type Domain =
  | Events.Context
  | EnginePet
  | EnginePlayer
  | Marks.MarkInstance
  | Marks.BaseMark
  | Skills.SkillInstance
  | Skills.BaseSkill
  | EngineEffect<EffectTrigger>
type Field = (typeof domainFields)[number]
declare const hostType: unique symbol

export interface EngineReference<T> {
  readonly [hostType]?: T
}

/** Read-only domain identities seen by an effect. The VM projects the same set of fields. */
type DomainFields<T> = {
  readonly [
    K in keyof T as K extends Field ? (T[K] extends (...args: never[]) => unknown ? never : K) : never
  ]: EffectView<T[K]>
} & EngineReference<T>

export type EffectView<T> = T extends string | number | boolean | null | undefined
  ? T
  : T extends EnginePet
    ? Pet
    : T extends Marks.MarkInstance
      ? MarkInstance
      : T extends Marks.BaseStatLevelMark
        ? BaseStatLevelMark
        : T extends Marks.BaseMark
          ? BaseMark
          : T extends Domain
            ? DomainFields<T>
            : T extends EngineParameters
              ? Pick<T, 'addressOf'> & EngineReference<T>
              : T extends readonly unknown[]
                ? { readonly [K in keyof T]: EffectView<T[K]> }
                : T extends object
                  ? { readonly [K in keyof T]: EffectView<T[K]> }
                  : T

/** Recover the canonical host type at the operator implementation boundary. */
export type EngineValue<T> = T extends unknown
  ? typeof hostType extends keyof T
    ? NonNullable<T[typeof hostType]>
    : T
  : never
export type Battle = EffectView<EngineBattle>
export interface Pet extends DomainFields<EnginePet> {}
export type Player = EffectView<EnginePlayer>
export interface BaseMark extends DomainFields<Marks.BaseMark> {}
export interface BaseStatLevelMark extends DomainFields<Marks.BaseStatLevelMark> {}
export interface MarkInstance extends DomainFields<Marks.MarkInstance> {}
export type BaseSkill = EffectView<Skills.BaseSkill>
export type SkillInstance = EffectView<Skills.SkillInstance>
export type Effect<T extends EffectTrigger> = EffectView<EngineEffect<T>>
export type ParameterCatalog = EffectView<EngineParameters>
export type Context = EffectView<Events.Context>
export type AllContext = EffectView<Events.AllContext>
export type TurnContext = EffectView<Events.TurnContext>
export type DefeatContext = EffectView<Events.DefeatContext>
export type TransformContext = EffectView<Events.TransformContext>
export type EffectContext<T extends EffectTrigger> = EffectView<Events.EffectContext<T>>
export type UseSkillContext = EffectView<Events.UseSkillContext>
export type DamageContext = EffectView<Events.DamageContext>
export type HealContext = EffectView<Events.HealContext>
export type RageContext = EffectView<Events.RageContext>
export type AddMarkContext = EffectView<Events.AddMarkContext>
export type RemoveMarkContext = EffectView<Events.RemoveMarkContext>
export type ConsumeStackContext = EffectView<Events.ConsumeStackContext>
export type StackContext = EffectView<Events.StackContext>
export type SwitchPetContext = EffectView<Events.SwitchPetContext>
