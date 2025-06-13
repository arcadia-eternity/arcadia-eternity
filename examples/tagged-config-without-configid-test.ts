import { ConfigSystem, ConfigModifierType, ConfigDurationType } from '@arcadia-eternity/battle'
import { parseEffect, preRegisterAllConfigs } from '@arcadia-eternity/parser'
import type { EffectDSL } from '@arcadia-eternity/schema'

// 测试没有configId但有tags的情况
function testTaggedConfigWithoutConfigId() {
  console.log('=== 测试没有configId但有tags的配置 ===\n')

  // 创建一个测试效果DSL，使用没有configId但有tags的rawValue
  const testEffectDSL: EffectDSL = {
    id: 'test_effect_without_configid',
    trigger: 'OnDamage',
    priority: 100,
    apply: {
      type: 'dealDamage',
      target: { base: 'target' },
      value: {
        type: 'raw:number',
        value: 50,
        // 注意：没有configId，但有tags
        tags: ['ice', 'damage'],
      },
    },
  }

  console.log('1. 解析带标签但无configId的效果')
  console.log('DSL配置：')
  console.log('  value: { type: "raw:number", value: 50, tags: ["ice", "damage"] }')
  console.log('  注意：没有configId字段\n')

  // 解析效果
  const effect = parseEffect(testEffectDSL)
  console.log('✅ 效果解析成功\n')

  // 手动触发预注册来模拟系统行为
  console.log('2. 触发预注册并检查自动注册的配置')
  preRegisterAllConfigs()
  console.log('✅ 预注册完成\n')

  // 使用单例ConfigSystem来测试
  const configSystem = ConfigSystem.getInstance()

  // 获取所有注册的配置键
  const registeredKeys = configSystem.getRegisteredKeys()
  console.log('已注册的配置键：', registeredKeys)

  // 查找带有ice标签的配置
  const iceConfigs = configSystem.getConfigKeysByTag('ice')
  console.log('带有"ice"标签的配置：', iceConfigs)

  // 查找带有damage标签的配置
  const damageConfigs = configSystem.getConfigKeysByTag('damage')
  console.log('带有"damage"标签的配置：', damageConfigs)

  if (iceConfigs.length > 0) {
    const configKey = iceConfigs[0]
    console.log(`\n配置"${configKey}"的详细信息：`)
    console.log('  当前值：', configSystem.get(configKey))
    console.log('  标签：', configSystem.getConfigTags(configKey))

    console.log('\n3. 测试标签化修改器')

    // 添加冰系增强
    const iceBoost = configSystem.addTaggedConfigModifierSingle(
      'ice',
      ConfigModifierType.delta,
      10,
      100,
      ConfigDurationType.instant,
    )

    console.log('添加冰系增强后：')
    console.log('  配置值：', configSystem.get(configKey), '(+10)')

    // 添加伤害增强
    const damageBoost = configSystem.addTaggedConfigModifierSingle(
      'damage',
      ConfigModifierType.delta,
      5,
      150,
      ConfigDurationType.instant,
    )

    console.log('添加伤害增强后：')
    console.log('  配置值：', configSystem.get(configKey), '(+10+5)')

    console.log('\n4. 清理修改器')
    iceBoost()
    damageBoost()

    console.log('清理后：')
    console.log('  配置值：', configSystem.get(configKey), '(恢复原值)')
  } else {
    console.log('❌ 没有找到带有ice标签的配置，可能自动注册失败')
  }

  // 清理单例
  configSystem.destroy()
  console.log('\n测试完成！')
}

// 运行测试
if (import.meta.url === `file://${process.argv[1]}`) {
  testTaggedConfigWithoutConfigId()
}

export { testTaggedConfigWithoutConfigId }
