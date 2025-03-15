import type { baseMarkId, EffectTrigger, markId, MarkMessage } from '@test-battle/const'
import type { Battle } from 'battle'
import type {
  AddMarkContext,
  AllContext,
  DamageContext,
  EffectContext,
  RemoveMarkContext,
  SwitchPetContext,
  TurnContext,
} from 'context'
import type { EffectContainer } from 'effect'
import type { Instance, OwnedEntity, Prototype } from 'entity'
import type { Pet } from 'pet'

export interface Mark extends Prototype {
  readonly id: baseMarkId
  readonly name: string
  readonly tags: string[]
  createInstance(...arg: any[]): MarkInstance
}

export interface MarkInstance extends EffectContainer, OwnedEntity<Battle | Pet | null>, Instance {
  owner: Battle | Pet | null
  isActive: boolean

  readonly id: markId
  name: string
  readonly tags: string[]

  readonly base: Mark

  get baseId(): baseMarkId
  setOwner(owner: Battle | Pet): void
  attachTo(target: Battle | Pet): void
  collectEffects(trigger: EffectTrigger, baseContext: AllContext): void
  destroy(
    context:
      | EffectContext<EffectTrigger>
      | TurnContext
      | AddMarkContext
      | SwitchPetContext
      | RemoveMarkContext
      | DamageContext,
  ): void
  transfer(context: EffectContext<EffectTrigger> | SwitchPetContext, target: Battle | Pet): void
  toMessage(): MarkMessage
}

export abstract class BaseMarkImpl implements Mark {
  constructor(
    public readonly id: baseMarkId,
    public readonly name: string,
    public readonly tags: string[] = [],
  ) {}

  createInstance(...arg: any[]): MarkInstance {}
}

export abstract class BaseMarkInstanceImpl implements MarkInstance {}
