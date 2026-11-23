// 统一效果触发阶段

export enum EffectTrigger {
  /** 对战进入进行中状态并发出开战消息后触发。父对象是本场 Battle。 */
  OnBattleStart = 'OnBattleStart',

  /** 为已选技能创建出招上下文后、排列行动顺序前触发。 */
  BeforeSort = 'BeforeSort',
  /** 开始出招时触发，此时引擎还要更新实际目标并检查存活、可用性和怒气。 */
  BeforeUseSkillCheck = 'BeforeUseSkillCheck',
  /** 通过出招检查并支付怒气后触发，随后判定命中、连击次数和暴击。 */
  AfterUseSkillCheck = 'AfterUseSkillCheck',
  /** 已完成命中和连击判定，即将进入逐段结算的循环。 */
  BeforeMultiHit = 'BeforeMultiHit',
  /** 每段通过命中判定时触发，早于该段伤害计算。 */
  BeforeHit = 'BeforeHit',
  /** 即时结算的暴击段在 PreDamage 前触发。 */
  OnCritPreDamage = 'OnCritPreDamage',
  /** 非变化技能命中且即时处理伤害时触发，随后创建该段的伤害上下文。 */
  PreDamage = 'PreDamage',
  /** 每段技能命中后触发。普通攻击在该段伤害处理后到达这里，变化技能也能触发。霜击用 source 与本次 skill 比较，确认命中来自自身。 */
  OnHit = 'OnHit',
  /** 命中判定失败时触发，技能随后退出本次连击循环。 */
  OnMiss = 'OnMiss',
  /** 保留的枚举值。当前原生效果调度器没有对应的派发阶段。 */
  AfterAttacked = 'AfterAttacked',
  /** 目标被确认击倒时触发，可读取倒下的精灵和归属的击倒者。 */
  OnDefeat = 'OnDefeat',
  /** 本次出招经过印记清理、记录技能属性后触发。 */
  SkillUseEnd = 'SkillUseEnd',

  /** 接收当前伤害提案，可在数值求值前通过 addModified 加入修正。 */
  OnBeforeCalculateDamage = 'OnBeforeCalculateDamage',
  /** 伤害数值已求得，在选择重定向、改为治疗或阻止伤害等规则前触发。 */
  OnDamageReplacement = 'OnDamageReplacement',
  /** 扣除的体力大于零时触发。可通过 result 读取已提交的伤害记录。 */
  OnDamage = 'OnDamage',
  /** 伤害允许护盾且仍有剩余量时，在本轮替代规则收集后触发。 */
  Shield = 'Shield',
  /** 已扣除体力且伤害允许技能反应时，在 OnDamage 后触发。 */
  PostDamage = 'PostDamage',
  /** 已提交的技能反应伤害为暴击时，在 PostDamage 后触发。 */
  OnCritPostDamage = 'OnCritPostDamage',

  /** 已应用临时或永久变身后触发。 */
  OnTransform = 'OnTransform',
  /** 变身结束并准备移除变身记录时触发。 */
  OnTransformEnd = 'OnTransformEnd',
  /** 应用变身前触发，引擎随后检查本次变身是否仍然可用。 */
  BeforeTransform = 'BeforeTransform',
  /** 在 OnTransform 后、发布变身消息前触发。 */
  AfterTransform = 'AfterTransform',

  /** 本回合行动排好顺序后、开始执行前触发。 */
  TurnStart = 'TurnStart',
  /** 本回合行动完成时触发，随后引擎发放回合怒气并更新印记。 */
  TurnEnd = 'TurnEnd',

  /** 处理添加印记的请求时触发，可读取目标、印记原型、层数与持续时间。 */
  OnBeforeAddMark = 'OnBeforeAddMark',
  /** 新印记创建后向相关效果广播，在该印记自己的 OnMarkCreated 之后触发。 */
  OnAnyMarkAdded = 'OnAnyMarkAdded',
  /** 印记被移除前广播，此时仍可读取原持有者。 */
  OnRemoveMark = 'OnRemoveMark',

  /** 新印记创建时针对该印记触发。霜击模板在这里绑定持续到印记离开的速度修正。 */
  OnMarkCreated = 'OnMarkCreated',
  /** 即将销毁印记时，先运行该印记自己的效果，再广播 OnRemoveMark。 */
  OnMarkDestroy = 'OnMarkDestroy',

  /** 非永久印记的剩余回合数降到零时，针对该印记触发，随后进入移除流程。 */
  OnMarkDurationEnd = 'OnMarkDurationEnd',

  /** 合并印记的层数和持续时间已算出、尚未写回时触发。 */
  OnStackBefore = 'OnStackBefore',
  /** 合并后的层数和持续时间已写回印记，此时可以读取叠层结果。 */
  OnStack = 'OnStack',
  /** 准备消耗印记层数时触发，可检查请求的消耗量。 */
  OnBeforeConsumeStack = 'OnBeforeConsumeStack',
  /** 印记层数消耗后触发，可读取实际消耗量。 */
  OnConsumeStack = 'OnConsumeStack',
  /** 计算回复量前触发，可通过当前治疗上下文调整回复量。 */
  OnBeforeHeal = 'OnBeforeHeal',
  /** 治疗已提交时触发，可读取目标与本次治疗结果。 */
  OnHeal = 'OnHeal',

  /** 处理增加怒气的请求时，在计算实际变化量前触发。 */
  BeforeRageGain = 'BeforeRageGain',
  /** 处理扣除怒气的请求时，在计算实际变化量前触发。 */
  BeforeRageLoss = 'BeforeRageLoss',
  /** 增加怒气后触发，可读取目标玩家及变化原因。 */
  OnRageGain = 'OnRageGain',
  /** 扣除怒气后触发，可读取目标玩家及变化原因。 */
  OnRageLoss = 'OnRageLoss',

  /** 精灵入场时广播，随后运行入场精灵携带印记的 OnOwnerSwitchIn。 */
  OnSwitchIn = 'OnSwitchIn',
  /** 精灵退场时广播，随后处理退场精灵的印记。 */
  OnSwitchOut = 'OnSwitchOut',
  /** 针对入场精灵携带的印记触发，父上下文记录换入与换出的精灵。 */
  OnOwnerSwitchIn = 'OnOwnerSwitchIn',
  /** 针对退场精灵携带的印记触发。 */
  OnOwnerSwitchOut = 'OnOwnerSwitchOut',

  /** 在执行一个效果前触发，可检查当前待执行的效果。 */
  BeforeEffect = 'BeforeEffect',
  /** 在一个效果完成执行后触发。 */
  AfterEffect = 'AfterEffect',
}
