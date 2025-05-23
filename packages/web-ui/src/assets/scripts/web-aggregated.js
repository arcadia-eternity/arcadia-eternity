// 聚合的Web端脚本文件 - 自动生成，请勿手动编辑
// 生成时间: 2025-05-23T19:23:14.467Z

// 重新导出所有需要的模块
export { Effect, BaseSkill } from '@arcadia-eternity/battle'
export { EffectTrigger, Category, Element, AttackTargetOpinion, IgnoreStageStrategy } from '@arcadia-eternity/const'
export { declareEffect, declareSpecies, declareSkill, declareMark, RegisterEffect, RegisterSkill, RegisterSpecies, RegisterMark } from '@arcadia-eternity/data-repository'

// 自动加载所有脚本声明
(function() {
  console.log('🔄 开始加载聚合脚本...')


// === effects/example-effect-functional.js ===
(function() {
// 示例效果脚本 - 使用函数式API
// 创建效果实例
const exampleFunctionalEffect = new Effect(
  'example_functional_effect',
  EffectTrigger.OnDamage,
  context => {
    console.log('函数式示例效果被触发:', context)
  },
  0, // priority
  undefined, // condition
  undefined, // consumesStacks
  ['script', 'functional', 'example'], // tags
)

// 使用函数式API声明
declareEffect(exampleFunctionalEffect)

})();


// === effects/example-effect.js ===
(function() {
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
// 示例效果脚本 - 使用装饰器模式
let ExampleEffect = class ExampleEffect extends Effect {
    constructor() {
        super('example_effect', EffectTrigger.OnDamage, context => {
            console.log('示例效果被触发:', context);
        }, 0, // priority
        undefined, // condition
        undefined, // consumesStacks
        ['script', 'example']);
    }
};
ExampleEffect = __decorate([
    RegisterEffect(),
    __metadata("design:paramtypes", [])
], ExampleEffect);

})();


// === skills/example-skill.js ===
(function() {
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
// 示例技能脚本 - 使用装饰器模式
let ExampleSkill = class ExampleSkill extends BaseSkill {
    constructor() {
        super('example_skill', Category.Physical, Element.Fire, 80, // power
        90, // accuracy
        20, // rage
        0, // priority
        AttackTargetOpinion.opponent, 1, // multihit
        false, // sureHit
        false, // sureCrit
        false, // ignoreShield
        IgnoreStageStrategy.none, ['script', 'example'], // tags
        [] // effects
        );
    }
};
ExampleSkill = __decorate([
    RegisterSkill(),
    __metadata("design:paramtypes", [])
], ExampleSkill);

})();


// === species/example-species.js ===
(function() {
// 示例种族脚本 - 使用函数式API
// 创建一个简单的Species对象
const ExampleSpecies = {
    id: 'example_species',
    num: 999,
    element: Element.Normal,
    baseStats: {
        hp: 100,
        atk: 80,
        def: 70,
        spa: 60,
        spd: 60,
        spe: 90,
    },
    genderRatio: [50, 50],
    heightRange: [1.0, 1.5],
    weightRange: [10, 20],
};
// 使用函数式API声明
declareSpecies(ExampleSpecies);

})();


  console.log('✅ 聚合脚本加载完成')
})()
