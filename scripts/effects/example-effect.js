var __decorate =
  (this && this.__decorate) ||
  function (decorators, target, key, desc) {
    var c = arguments.length,
      r = c < 3 ? target : desc === null ? (desc = Object.getOwnPropertyDescriptor(target, key)) : desc,
      d
    if (typeof Reflect === 'object' && typeof Reflect.decorate === 'function')
      r = Reflect.decorate(decorators, target, key, desc)
    else
      for (var i = decorators.length - 1; i >= 0; i--)
        if ((d = decorators[i])) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r
    return c > 3 && r && Object.defineProperty(target, key, r), r
  }
var __metadata =
  (this && this.__metadata) ||
  function (k, v) {
    if (typeof Reflect === 'object' && typeof Reflect.metadata === 'function') return Reflect.metadata(k, v)
  }
// 示例效果脚本 - 使用装饰器模式 - 测试精细化热重载
import { Effect } from '@arcadia-eternity/battle'
import { EffectTrigger } from '@arcadia-eternity/const'
import { RegisterEffect } from '@arcadia-eternity/data-repository'
let ExampleEffect = class ExampleEffect extends Effect {
  constructor() {
    super(
      'example_effect',
      EffectTrigger.OnDamage,
      context => {
        console.log('示例效果被触发:', context)
      },
      0, // priority
      undefined, // condition
      undefined, // consumesStacks
      ['script', 'example'],
    )
  }
}
ExampleEffect = __decorate([RegisterEffect(), __metadata('design:paramtypes', [])], ExampleEffect)
export { ExampleEffect }
