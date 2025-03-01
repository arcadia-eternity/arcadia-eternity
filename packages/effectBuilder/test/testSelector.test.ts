import { ChainableSelector, BaseSelector } from '../selector'
import {
  EffectContext,
  UseSkillContext,
  type Species,
  Pet,
  MarkInstance,
  BaseMark,
  Battle,
  DamageContext,
  Player,
  SkillInstance,
  TurnContext,
  BaseSkill,
} from '@test-battle/battle'
import {
  type speciesId,
  type baseMarkId,
  type petId,
  Nature,
  Gender,
  EffectTrigger,
  Element,
  DamageType,
  AttackTargetOpinion,
  type playerId,
  type baseSkillId,
  Category,
} from '@test-battle/const'

describe('ChainableSelector 类型安全测试', () => {
  const mockBaseSkill = new BaseSkill.Builder()
    .withID('fire_blast' as baseSkillId)
    .withName('火焰冲击')
    .withType(Element.Fire)
    .withSkillType(Category.Physical)
    .withPower(100)
    .withAccuracy(1.0)
    .withRageCost(30)
    .withTarget(AttackTargetOpinion.opponent)
    .build()

  // 创建技能实例（可覆盖基础属性）
  const mockSkill = new SkillInstance(mockBaseSkill, {
    // 可选的覆盖参数示例：
    power: 110, // 覆盖基础威力
    rage: 35, // 覆盖怒气消耗
    multihit: [2, 5], // 设置为2-5次多段攻击
    sureHit: true, // 设置为必定命中
  })
  // 模拟测试上下文
  const mockSpecies: Species = {
    id: 'test_species' as speciesId,
    num: 1,
    name: 'Test Species',
    element: Element.Fire,
    baseStats: {
      hp: 100,
      atk: 50,
      def: 50,
      spa: 50,
      spd: 50,
      spe: 50,
    },
    genderRatio: [50, 50],
    heightRange: [1.0, 1.5],
    weightRange: [10, 20],
  }

  // 创建测试用 BaseMark
  const mockBaseMark = new BaseMark(
    'test_mark' as baseMarkId,
    'Test Mark',
    [], // 空效果数组
    {
      duration: 3,
      maxStacks: 5,
      stackable: true,
    },
  )

  // 创建 mockMark
  const mockMark = new MarkInstance(mockBaseMark, {
    duration: 5,
    stack: 3,
    config: {
      isShield: true,
    },
  })

  // 创建 mockPet
  const mockPet = new Pet(
    'Test Pet', // name
    'pet_001' as petId, // id
    mockSpecies, // species
    50, // level
    {
      // evs
      hp: 0,
      atk: 0,
      def: 0,
      spa: 0,
      spd: 0,
      spe: 0,
    },
    {
      // ivs
      hp: 31,
      atk: 31,
      def: 31,
      spa: 31,
      spd: 31,
      spe: 31,
    },
    Nature.Hardy, // nature
    [], // skills
    undefined, // ability
    undefined, // emblem
    15, // weight
    1.2, // height
    Gender.Male, // gender
  )

  const mockPlayer = new Player(
    'Test Player', // name
    'test_player' as playerId,
    [mockPet], // team (需要至少一个精灵)
  )

  const playerA = new Player(
    'Player 1',
    'p1' as playerId,
    [mockPet], // 玩家A的队伍
  )
  const playerB = new Player(
    'Player 2',
    'p2' as playerId,
    [mockPet], // 玩家B的队伍
  )

  // 创建模拟对战实例
  const mockBattle = new Battle(playerA, playerB, {
    allowFaintSwitch: true, // 允许濒死换宠
    rngSeed: 42, // 固定随机种子保证测试可重复
  })

  // 创建嵌套上下文链
  const turnContext = new TurnContext(mockBattle)
  const useSkillContext = new UseSkillContext(turnContext, mockPlayer, mockPet, AttackTargetOpinion.opponent, mockSkill)

  // 核心的 EffectContext 模拟
  const mockEffectContext = new EffectContext<EffectTrigger.OnDamage>(
    new DamageContext(
      useSkillContext,
      mockPet, // 伤害来源
      100, // 伤害值
      DamageType.physical,
      false, // 是否暴击
      1.0, // 效果系数
      false, // 是否忽略护盾
    ),
    EffectTrigger.OnDamage,
    mockMark,
  )

  // 完整配置的 mockContext
  const mockContext: EffectContext<EffectTrigger.OnDamage> = {
    type: 'effect',
    available: true,
    trigger: EffectTrigger.OnDamage,
    battle: mockBattle,
    parent: {
      type: 'damage',
      available: true,
      battle: mockBattle,
      parent: useSkillContext,
      source: mockPet,
      value: 100,
      damageType: DamageType.physical,
      crit: false,
      effectiveness: 1.0,
      ignoreShield: false,
    },
    source: mockMark,
  }

  // 测试用例 1: 基础路径验证
  test('应正确验证有效路径', () => {
    const selector = BaseSelector.selfMarks.selectPath('duration') // MarkInstance[].duration → number[]

    expect(() => selector.build()(mockContext)).not.toThrow()
    expect(selector['typePath']).toBe('number[]')
  })

  // 测试用例 2: 无效路径检测
  test('应拒绝无效路径并抛出错误', () => {
    expect(() => {
      BaseSelector.target.selectPath('invalidProp') // Pet.invalidProp
    }).toThrowError(/Invalid path 'invalidProp' for type Pet/)
  })

  // 测试用例 3: 数组展开验证
  test('应正确处理数组展开路径', () => {
    const selector = BaseSelector.selfMarks // MarkInstance[]
      .selectPath('duration') // → number[]

    const results = selector.build()(mockContext)
    expect(results.every(v => typeof v === 'number')).toBeTruthy()
  })

  // 测试用例 4: 联合类型处理
  test('应验证联合类型的所有可能路径', () => {
    const damageSelector = BaseSelector.damageContext.selectPath('source.owner') // DamageContext.source → Pet | MarkInstance

    expect(damageSelector['typePath']).toMatch(/Player|Pet|Battle/)
  })

  // 测试用例 5: 生产环境优化
  test('生产环境应跳过类型检查', () => {
    const originalEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'

    expect(() => {
      BaseSelector.target.selectPath('invalidProp') // 生产环境不验证
    }).not.toThrow()

    process.env.NODE_ENV = originalEnv
  })

  // 测试用例 6: 属性链式访问
  test('应支持多级属性访问', () => {
    const selector = BaseSelector.target.selectPath('marks[].duration') // Pet.marks → MarkInstance[].duration → number[]

    expect(selector['typePath']).toBe('number[]')
    expect(() => selector.build()(mockContext)).not.toThrow()
  })

  // 测试用例 7: 错误信息准确性
  test('应提供精确的错误诊断信息', () => {
    try {
      BaseSelector.selfMarks.selectPath('invalid')
    } catch (e) {
      expect(e.message).toContain('MarkInstance.invalid')
      expect(e.message).toMatch(/Expected type:/)
    }
  })
})
