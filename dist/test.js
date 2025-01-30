'use strict';

// 宝可梦属性类型
var Type;
(function (Type) {
    Type["Normal"] = "Normal";
    Type["Fire"] = "Fire";
    Type["Water"] = "Water";
    Type["Electric"] = "Electric";
    Type["Grass"] = "Grass";
    Type["Ice"] = "Ice";
    Type["Fighting"] = "Fighting";
    Type["Poison"] = "Poison";
    Type["Ground"] = "Ground";
    Type["Flying"] = "Flying";
    Type["Psychic"] = "Psychic";
    Type["Bug"] = "Bug";
    Type["Rock"] = "Rock";
    Type["Ghost"] = "Ghost";
    Type["Dragon"] = "Dragon";
})(Type || (Type = {}));
// 属性相克表
const TYPE_CHART = {
    [Type.Normal]: {},
    [Type.Fire]: { [Type.Grass]: 2, [Type.Fire]: 0.5, [Type.Water]: 0.5 },
    [Type.Water]: { [Type.Fire]: 2, [Type.Water]: 0.5, [Type.Grass]: 0.5 },
    [Type.Electric]: { [Type.Water]: 2, [Type.Electric]: 0.5, [Type.Grass]: 0.5 },
    [Type.Grass]: { [Type.Water]: 2, [Type.Fire]: 0.5, [Type.Grass]: 0.5 },
    [Type.Ice]: {},
    [Type.Fighting]: {},
    [Type.Poison]: {},
    [Type.Ground]: {},
    [Type.Flying]: {},
    [Type.Psychic]: {},
    [Type.Bug]: {},
    [Type.Rock]: {},
    [Type.Ghost]: {},
    [Type.Dragon]: {},
};

var EffectTriggerPhase;
(function (EffectTriggerPhase) {
    EffectTriggerPhase["PRE_DAMAGE"] = "PRE_DAMAGE";
    EffectTriggerPhase["POST_DAMAGE"] = "POST_DAMAGE";
    EffectTriggerPhase["ON_HIT"] = "ON_HIT";
    EffectTriggerPhase["ON_CRIT_PRE_DAMAGE"] = "ON_CRIT_PRE_DAMAGE";
    EffectTriggerPhase["ON_CRIT_POST_DAMAGE"] = "ON_CRIT_POST_DAMAGE";
    EffectTriggerPhase["ON_MISS"] = "ON_MISS";
    EffectTriggerPhase["ON_DEFEAT"] = "ON_DEFEAT";
})(EffectTriggerPhase || (EffectTriggerPhase = {}));
var SkillType;
(function (SkillType) {
    SkillType["Physical"] = "Physical";
    SkillType["Special"] = "Special";
    SkillType["Status"] = "Status";
    SkillType["Climax"] = "Climax";
})(SkillType || (SkillType = {}));
// 技能类
class Skill {
    name;
    SkillType;
    type;
    power;
    accuracy;
    rageCost;
    effects;
    constructor(name, SkillType, type, power, accuracy, rageCost, // 新增怒气消耗
    effects) {
        this.name = name;
        this.SkillType = SkillType;
        this.type = type;
        this.power = power;
        this.accuracy = accuracy;
        this.rageCost = rageCost;
        this.effects = effects || [];
    }
    applyEffects(EffectTriggerPhase, attacker, target, damage) {
        this.effects
            .filter(effect => effect.phase === EffectTriggerPhase)
            .forEach(effect => {
            if (Math.random() < (effect.probability ?? 1)) {
                effect.apply(attacker, target, this, damage);
            }
        });
    }
    static builder() {
        return new SkillBuilder();
    }
}
class SkillBuilder {
    name = '';
    SkillType = SkillType.Physical;
    type = Type.Normal;
    power = 0;
    accuracy = 1;
    rageCost = 0;
    effects = [];
    withName(name) {
        this.name = name;
        return this;
    }
    withType(type) {
        this.type = type;
        return this;
    }
    withPower(power) {
        this.power = power;
        return this;
    }
    withAccuracy(accuracy) {
        this.accuracy = accuracy;
        return this;
    }
    withRageCost(rageCost) {
        this.rageCost = rageCost;
        return this;
    }
    withEffect(effect) {
        this.effects.push(effect);
        return this;
    }
    build() {
        return new Skill(this.name, this.SkillType, this.type, this.power, this.accuracy, this.rageCost, this.effects);
    }
}

// 新增印记系统核心类
var TriggerCondition;
(function (TriggerCondition) {
    TriggerCondition["ROUND_START"] = "round-start";
    TriggerCondition["ROUND_END"] = "round-end";
    TriggerCondition["BEFORE_ATTACK"] = "before-attack";
    TriggerCondition["AFTER_ATTACK"] = "after-attack";
    TriggerCondition["AFTER_DAMAGED"] = "when-damaged";
    TriggerCondition["ON_DEFEATED"] = "when-defeated";
    TriggerCondition["ON_BEDEFATED"] = "on-bedefated";
    TriggerCondition["ON_MARKED"] = "on-marked";
    TriggerCondition["ON_MARK_REMOVED"] = "on-mark-removed";
    TriggerCondition["ON_MARK_STACKED"] = "on-mark-stacked";
})(TriggerCondition || (TriggerCondition = {}));
class Mark {
    name;
    tags;
    description;
    effect;
    triggers;
    source;
    alive = true; // 印记是否存在
    constructor(name, // 印记名称
    tags = [], // 标签
    description = '', // 描述
    effect, triggers = [], // 触发条件
    source) {
        this.name = name;
        this.tags = tags;
        this.description = description;
        this.effect = effect;
        this.triggers = triggers;
        this.source = source;
    }
    get num() {
        return -1; //在gui中默认显示
    }
    get status() {
        return this.name;
    } //用于在gui中显示的状态信息
    destroy() {
        this.alive = false;
    }
}
class MarkDecorator extends Mark {
    mark;
    constructor(mark) {
        super(mark.name, mark.tags, mark.description, mark.effect, mark.triggers, mark.source);
        this.mark = mark;
    }
}
class DurationDecorator extends MarkDecorator {
    duration;
    maxDuration;
    constructor(mark, duration = -1) {
        super(mark);
        this.duration = duration;
        // 最大持续回合数
        this.maxDuration = duration;
        // 持续回合数, 默认-1表示永续
        this.duration = duration;
    }
    get num() {
        return this.duration;
    }
    get status() {
        return `${this.mark.status} ${this.duration}/${this.maxDuration}`;
    }
}
var StatType;
(function (StatType) {
    StatType["atk"] = "atk";
    StatType["def"] = "def";
    StatType["spa"] = "spa";
    StatType["spd"] = "spd";
    StatType["spe"] = "spe";
    StatType["hp"] = "hp";
})(StatType || (StatType = {}));
// abstract class StatEffect implements EffectStrategy {
//   abstract apply(target: Pet, stacks: number): void
//   abstract getStatModifiers(): Partial<Record<StatType, LevelModifier>>
// }
// class SingleStatEffect extends StatEffect {
//   constructor(
//     private stat: StatType,
//     private modifierPerStack: LevelModifier,
//   ) {
//     super()
//   }
//   apply(target: Pet, stacks: number) {
//     // 仅作为标记，实际数值通过访问器计算
//   }
//   getStatModifiers() {
//     return { [this.stat]: this.modifierPerStack }
//   }
// }

var Nature;
(function (Nature) {
    Nature["Hardy"] = "Hardy";
    Nature["Lonely"] = "Lonely";
    Nature["Brave"] = "Brave";
    Nature["Adamant"] = "Adamant";
    Nature["Naughty"] = "Naughty";
    Nature["Bold"] = "Bold";
    Nature["Docile"] = "Docile";
    Nature["Relaxed"] = "Relaxed";
    Nature["Impish"] = "Impish";
    Nature["Lax"] = "Lax";
    Nature["Timid"] = "Timid";
    Nature["Hasty"] = "Hasty";
    Nature["Serious"] = "Serious";
    Nature["Jolly"] = "Jolly";
    Nature["Naive"] = "Naive";
    Nature["Modest"] = "Modest";
    Nature["Mild"] = "Mild";
    Nature["Quiet"] = "Quiet";
    Nature["Bashful"] = "Bashful";
    Nature["Rash"] = "Rash";
    Nature["Calm"] = "Calm";
    Nature["Gentle"] = "Gentle";
    Nature["Sassy"] = "Sassy";
    Nature["Careful"] = "Careful";
    Nature["Quirky"] = "Quirky";
})(Nature || (Nature = {}));
const NatureMap = {
    Hardy: { hp: 1, atk: 1, def: 1, spa: 1, spd: 1, spe: 1 },
    Lonely: { hp: 1, atk: 1.1, def: 0.9, spa: 1, spd: 1, spe: 1 },
    Brave: { hp: 1, atk: 1.1, def: 1, spa: 1, spd: 1, spe: 0.9 },
    Adamant: { hp: 1, atk: 1.1, def: 1, spa: 0.9, spd: 1, spe: 1 },
    Naughty: { hp: 1, atk: 1.1, def: 1, spa: 1, spd: 0.9, spe: 1 },
    Bold: { hp: 1, atk: 0.9, def: 1.1, spa: 1, spd: 1, spe: 1 },
    Docile: { hp: 1, atk: 1, def: 1, spa: 1, spd: 1, spe: 1 },
    Relaxed: { hp: 1, atk: 1, def: 1.1, spa: 1, spd: 1, spe: 0.9 },
    Impish: { hp: 1, atk: 1, def: 1.1, spa: 0.9, spd: 1, spe: 1 },
    Lax: { hp: 1, atk: 1, def: 1.1, spa: 1, spd: 0.9, spe: 1 },
    Timid: { hp: 1, atk: 0.9, def: 1, spa: 1, spd: 1, spe: 1.1 },
    Hasty: { hp: 1, atk: 1, def: 0.9, spa: 1, spd: 1, spe: 1.1 },
    Serious: { hp: 1, atk: 1, def: 1, spa: 1, spd: 1, spe: 1 },
    Jolly: { hp: 1, atk: 1, def: 1, spa: 0.9, spd: 1, spe: 1.1 },
    Naive: { hp: 1, atk: 1, def: 1, spa: 1, spd: 0.9, spe: 1.1 },
    Modest: { hp: 1, atk: 0.9, def: 1, spa: 1.1, spd: 1, spe: 1 },
    Mild: { hp: 1, atk: 1, def: 0.9, spa: 1.1, spd: 1, spe: 1 },
    Quiet: { hp: 1, atk: 1, def: 1, spa: 1.1, spd: 1, spe: 0.9 },
    Bashful: { hp: 1, atk: 1, def: 1, spa: 1, spd: 1, spe: 1 },
    Rash: { hp: 1, atk: 1, def: 1, spa: 1.1, spd: 0.9, spe: 1 },
    Calm: { hp: 1, atk: 0.9, def: 1, spa: 1, spd: 1.1, spe: 1 },
    Gentle: { hp: 1, atk: 1, def: 0.9, spa: 1, spd: 1.1, spe: 1 },
    Sassy: { hp: 1, atk: 1, def: 1, spa: 1, spd: 1.1, spe: 0.9 },
    Careful: { hp: 1, atk: 1, def: 1, spa: 0.9, spd: 1.1, spe: 1 },
    Quirky: { hp: 1, atk: 1, def: 1, spa: 1, spd: 1, spe: 1 },
};

// 宝可梦类
class Pet {
    name;
    species;
    level;
    evs;
    ivs;
    nature;
    skills;
    maxHp;
    currentHp;
    currentRage;
    critRate = 0.1; // 暴击率默认为10%
    type;
    constructor(name, species, level, evs, ivs, nature, skills, maxHp) {
        this.name = name;
        this.species = species;
        this.level = level;
        this.evs = evs;
        this.ivs = ivs;
        this.nature = nature;
        this.skills = skills;
        this.maxHp = maxHp;
        this.maxHp = maxHp ? maxHp : this.calculateStat(StatType.hp);
        this.currentHp = this.maxHp;
        this.currentRage = 20; // 初始怒气为20
        this.type = species.type;
    }
    // 选择随机技能
    selectRandomSkill() {
        return this.skills[Math.floor(Math.random() * this.skills.length)];
    }
    // 新增印记存储
    marks = new Map();
    get markStatus() {
        const str = [];
        for (const [name, mark] of this.marks) {
            str.push(`${name}(${mark.status})`);
        }
        return str.join(', ');
    }
    // 添加印记
    addMark(mark, source) {
        const existing = this.marks.get(mark.name);
        if (!existing) {
            const newMark = Object.assign(Object.create(Object.getPrototypeOf(mark)), mark);
            newMark.source = source;
            this.marks.set(mark.name, newMark);
            console.log(`${this.name} 获得 ${mark.name} 效果`);
            return;
        }
    }
    // 移除印记
    removeMark(markName, removeAll = true) {
        const mark = this.marks.get(markName);
        if (!mark)
            return;
        if (removeAll) {
            this.marks.delete(markName);
            console.log(`${this.name} 的 ${markName} 效果消失`);
        }
    }
    // 触发特定条件的效果
    triggerMarks(condition, source, ...args) {
        for (const [, mark] of this.marks) {
            for (const trigger of mark.triggers) {
                if (trigger === condition) {
                    mark.effect.apply(this, [source, ...args]);
                }
            }
        }
    }
    // 更新回合型印记
    updateRoundMarks() {
        for (const [name, mark] of this.marks) {
            if (mark instanceof DurationDecorator) {
                mark.duration--;
                if (mark.duration <= 0) {
                    this.marks.delete(name);
                    console.log(`${this.name} 的 ${name} 效果消失`);
                }
            }
        }
    }
    calculateStat(type) {
        const baseStat = this.species.baseStats[type];
        const natureMultiplier = NatureMap[this.nature][type];
        const level = this.level;
        const iv = this.ivs[type];
        const ev = this.evs[type];
        if (type === 'hp') {
            return Math.floor(((2 * baseStat + iv + Math.floor(ev / 4)) * level) / 100) + level + 10;
        }
        else {
            return Math.floor(((2 * baseStat + iv + Math.floor(ev / 4)) * level) / 100 + 5) * natureMultiplier;
        }
    }
    get attack() {
        return this.calculateStat(StatType.atk);
    }
    get defense() {
        return this.calculateStat(StatType.def);
    }
    get specialAttack() {
        return this.calculateStat(StatType.spa);
    }
    get specialDefense() {
        return this.calculateStat(StatType.spd);
    }
    get speed() {
        return this.calculateStat(StatType.spe);
    }
}

// 新增怒气相关配置
const MAX_RAGE = 100;
const RAGE_PER_TURN = 15;
const RAGE_PER_DAMAGE = 0.5;
// 对战系统
class BattleSystem {
    petA;
    petB;
    constructor(petA, petB) {
        this.petA = petA;
        this.petB = petB;
    }
    // 判断先攻顺序
    getAttackOrder() {
        if (this.petA.speed === this.petB.speed) {
            return Math.random() > 0.5 ? [this.petA, this.petB] : [this.petB, this.petA];
        }
        return this.petA.speed > this.petB.speed ? [this.petA, this.petB] : [this.petB, this.petA];
    }
    addTurnRage() {
        [this.petA, this.petB].forEach(pet => {
            const before = pet.currentRage;
            pet.currentRage = Math.min(pet.currentRage + RAGE_PER_TURN, MAX_RAGE);
            console.log(`${pet.name} 获得${RAGE_PER_TURN}怒气 (${before}→${pet.currentRage})`);
        });
    }
    // 执行对战回合
    performTurn() {
        this.triggerGlobal(TriggerCondition.ROUND_START); // 触发回合开始效果
        const [attacker, defender] = this.getAttackOrder();
        // 第一只攻击
        this.performAttack(attacker, defender);
        if (defender.currentHp <= 0)
            return true;
        // 第二只反击
        this.performAttack(defender, attacker);
        if (attacker.currentHp <= 0)
            return true;
        this.triggerGlobal(TriggerCondition.ROUND_END) // 触发回合结束效果
        ;
        [this.petA, this.petB].forEach(p => p.updateRoundMarks()); // 更新回合型印记
        if (attacker.currentHp <= 0 || defender.currentHp <= 0)
            return true;
        this.addTurnRage(); // 每回合结束获得怒气
        return false;
    }
    performAttack(attacker, defender) {
        // 攻击前触发
        attacker.triggerMarks(TriggerCondition.BEFORE_ATTACK, attacker);
        const skill = attacker.selectRandomSkill();
        if (!skill) {
            console.log(`${attacker.name} 没有可用技能!`);
            return false;
        }
        // attacker.attackTarget(defender, skill);
        if (attacker.currentHp <= 0)
            return;
        console.log(`${attacker.name} 使用 ${skill.name}！`);
        // 怒气检查
        if (attacker.currentRage < skill.rageCost) {
            console.log(`${attacker.name} 怒气不足无法使用 ${skill.name}!`);
            return;
        }
        console.log(`${attacker.name} 使用 ${skill.name} (消耗${skill.rageCost}怒气)!`);
        attacker.currentRage -= skill.rageCost;
        // 命中判定
        if (Math.random() > skill.accuracy) {
            console.log(`${attacker.name} 的攻击没有命中！`);
            skill.applyEffects(EffectTriggerPhase.ON_MISS, attacker, defender); // 触发未命中特效
            return;
        }
        // 暴击判定
        const isCrit = Math.random() < attacker.critRate;
        if (isCrit) {
            console.log('暴击！');
            skill.applyEffects(EffectTriggerPhase.ON_CRIT_PRE_DAMAGE, attacker, defender); // 触发暴击前特效
        }
        // 攻击命中
        skill.applyEffects(EffectTriggerPhase.PRE_DAMAGE, attacker, defender); // 触发伤害前特效
        // 伤害计算
        if (skill.SkillType !== SkillType.Status) {
            const typeMultiplier = TYPE_CHART[skill.type][defender.type] || 1;
            let damage = Math.floor(((((2 * defender.level) / 5 + 2) * skill.power * (attacker.attack / defender.defense)) / 50 + 2) *
                (Math.random() * 0.15 + 0.85) * // 随机波动
                typeMultiplier *
                (isCrit ? 1.5 : 1));
            //STAB
            if (attacker.species.type === skill.type) {
                damage = Math.floor(damage * 1.5);
            }
            // 应用伤害
            defender.currentHp = Math.max(defender.currentHp - damage, 0);
            console.log(`${defender.name} 受到了 ${damage} 点伤害！`);
            if (typeMultiplier > 1)
                console.log('效果拔群！');
            if (typeMultiplier < 1)
                console.log('效果不佳...');
            // 受伤者触发效果
            defender.triggerMarks(TriggerCondition.AFTER_DAMAGED, attacker, damage);
            // 受伤者获得怒气
            const gainedRage = Math.floor(damage * RAGE_PER_DAMAGE);
            defender.currentRage = Math.min(defender.currentRage + gainedRage, MAX_RAGE);
            console.log(`${defender.name} 因受伤获得${gainedRage}怒气`);
            skill.applyEffects(EffectTriggerPhase.POST_DAMAGE, attacker, defender); // 触发伤害后特效
        }
        skill.applyEffects(EffectTriggerPhase.ON_HIT, attacker, defender); // 触发命中特效
        if (isCrit) {
            skill.applyEffects(EffectTriggerPhase.ON_CRIT_POST_DAMAGE, attacker, defender); // 触发暴击后特效
        }
        if (defender.currentHp <= 0) {
            console.log(`${defender.name} 倒下了！`);
            skill.applyEffects(EffectTriggerPhase.ON_DEFEAT, attacker, defender); // 触发击败特效
        }
    }
    triggerGlobal(condition) {
        [this.petA, this.petB].forEach(p => {
            p.triggerMarks(condition);
        });
    }
    // 开始对战
    startBattle() {
        console.log(`对战开始：${this.petA.name} vs ${this.petB.name}!`);
        this.triggerGlobal(TriggerCondition.ROUND_START); // 触发回合开始效果
        let turn = 1;
        while (this.petA.currentHp > 0 && this.petB.currentHp > 0) {
            console.log('\n====================');
            console.log(`${this.petA.name} HP: ${this.petA.currentHp} / ${this.petA.maxHp} (${this.petA.currentRage} Rage)`); // 显示当前血量和怒气
            console.log(`印记状态: ${this.petA.markStatus}`); // 显示印记状态
            console.log(`${this.petB.name} HP: ${this.petB.currentHp} / ${this.petB.maxHp} (${this.petB.currentRage} Rage)`); // 显示当前血量和怒气
            console.log(`印记状态: ${this.petB.markStatus}`); // 显示印记状态
            console.log(`\n=== 第 ${turn} 回合 ===`);
            if (this.performTurn())
                break;
            turn++;
        }
        const winner = this.petA.currentHp > 0 ? this.petA : this.petB;
        console.log(`\n${winner.name} 获得了胜利！`);
    }
}

// 使用示例
const charizardSpecies = {
    name: '休罗斯',
    type: Type.Fire,
    baseStats: {
        hp: 78,
        atk: 84,
        def: 78,
        spa: 109,
        spd: 85,
        spe: 100,
    },
    skills: [],
};
const charizard = new Pet('火狗', charizardSpecies, 50, {
    hp: 255,
    atk: 0,
    def: 0,
    spa: 255,
    spd: 0,
    spe: 0,
}, {
    hp: 31,
    atk: 31,
    def: 31,
    spa: 31,
    spd: 31,
    spe: 31,
}, Nature.Adamant, [
    new Skill('火焰拳', SkillType.Physical, Type.Fire, 75, 1, 20),
    new Skill('飞翔', SkillType.Physical, Type.Flying, 25, 1, 5),
]);
const blastoiseSpecies = {
    name: '迪兰特',
    type: Type.Water,
    baseStats: {
        hp: 79,
        atk: 83,
        def: 100,
        spa: 85,
        spd: 105,
        spe: 78,
    },
    skills: [],
};
const blastoise = new Pet('迪兰特', blastoiseSpecies, 50, {
    hp: 255,
    atk: 0,
    def: 0,
    spa: 255,
    spd: 0,
    spe: 0,
}, {
    hp: 31,
    atk: 31,
    def: 31,
    spa: 31,
    spd: 31,
    spe: 31,
}, Nature.Adamant, [new Skill('水枪', SkillType.Special, Type.Water, 160, 1, 100)]);
const battle = new BattleSystem(charizard, blastoise);
battle.startBattle();
