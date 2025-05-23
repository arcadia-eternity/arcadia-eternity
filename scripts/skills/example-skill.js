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
import { BaseSkill } from '@arcadia-eternity/battle';
import { Category, Element, AttackTargetOpinion, IgnoreStageStrategy } from '@arcadia-eternity/const';
import { RegisterSkill } from '@arcadia-eternity/data-repository';
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
export { ExampleSkill };
