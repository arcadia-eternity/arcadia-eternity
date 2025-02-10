import { Effect, EffectTrigger } from '@/core/effect'
import { RegisterEffect } from '../daraRespository/dataRepository'

//约定：id为

@RegisterEffect()
export class PaidaEffect extends Effect<EffectTrigger> {
  constructor() {
    super(
      '',
      EffectTrigger.AfterAttacked,
      () => {},
      0,
      () => true,
    )
  }
}
