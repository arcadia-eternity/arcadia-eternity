import { ConfigSystem, ConfigModifierType, ConfigDurationType } from '@arcadia-eternity/battle'

// 测试标签化配置系统
function testTaggedConfigSystem() {
  console.log('=== 标签化配置系统测试 ===')

  // 创建ConfigSystem实例
  const configSystem = new ConfigSystem()

  // 测试1：注册带标签的配置
  console.log('\n1. 注册带标签的配置')
  configSystem.registerTaggedConfig('freeze.probability', 0.3, ['freeze', 'probability'])
  configSystem.registerTaggedConfig('freeze.duration', 2, ['freeze', 'duration'])
  configSystem.registerTaggedConfig('ice.damage', 50, ['ice', 'damage'])
  configSystem.registerTaggedConfig('burn.probability', 0.2, ['burn', 'probability'])

  console.log('已注册的配置：')
  console.log('- freeze.probability:', configSystem.get('freeze.probability'))
  console.log('- freeze.duration:', configSystem.get('freeze.duration'))
  console.log('- ice.damage:', configSystem.get('ice.damage'))
  console.log('- burn.probability:', configSystem.get('burn.probability'))

  // 测试2：查询标签
  console.log('\n2. 查询标签')
  console.log('带有"probability"标签的配置:', configSystem.getConfigKeysByTag('probability'))
  console.log('带有"freeze"标签的配置:', configSystem.getConfigKeysByTag('freeze'))
  console.log('带有"ice"标签的配置:', configSystem.getConfigKeysByTag('ice'))

  console.log('freeze.probability的标签:', configSystem.getConfigTags('freeze.probability'))
  console.log('ice.damage的标签:', configSystem.getConfigTags('ice.damage'))

  // 测试3：添加标签化修改器
  console.log('\n3. 添加标签化修改器')

  // 增加所有概率类效果10%
  const probabilityCleanup = configSystem.addTaggedConfigModifierSingle(
    'probability',
    ConfigModifierType.delta,
    0.1,
    100,
    ConfigDurationType.instant,
  )

  console.log('添加概率增强后：')
  console.log('- freeze.probability:', configSystem.get('freeze.probability'))
  console.log('- burn.probability:', configSystem.get('burn.probability'))

  // 增加所有冰系效果20%
  const iceCleanup = configSystem.addTaggedConfigModifierSingle(
    'ice',
    ConfigModifierType.delta,
    0.2,
    150,
    ConfigDurationType.instant,
  )

  console.log('添加冰系增强后：')
  console.log('- ice.damage:', configSystem.get('ice.damage'))

  // 测试4：多重修改器效果
  console.log('\n4. 多重修改器效果')

  // freeze.probability同时受到probability和freeze标签的影响
  const freezeCleanup = configSystem.addTaggedConfigModifierSingle(
    'freeze',
    ConfigModifierType.delta,
    0.05,
    200,
    ConfigDurationType.instant,
  )

  console.log('添加冰冻增强后：')
  console.log('- freeze.probability (受到probability+freeze双重增强):', configSystem.get('freeze.probability'))
  console.log('- freeze.duration (只受到freeze增强):', configSystem.get('freeze.duration'))

  // 测试5：清理修改器
  console.log('\n5. 清理修改器')
  probabilityCleanup()
  console.log('清理概率增强后：')
  console.log('- freeze.probability:', configSystem.get('freeze.probability'))
  console.log('- burn.probability:', configSystem.get('burn.probability'))

  iceCleanup()
  console.log('清理冰系增强后：')
  console.log('- ice.damage:', configSystem.get('ice.damage'))

  freezeCleanup()
  console.log('清理冰冻增强后：')
  console.log('- freeze.probability:', configSystem.get('freeze.probability'))
  console.log('- freeze.duration:', configSystem.get('freeze.duration'))

  // 清理
  configSystem.destroy()
  console.log('\n测试完成！')
}

// 运行测试
// 在ES模块中检测是否为主模块
if (import.meta.url === `file://${process.argv[1]}`) {
  testTaggedConfigSystem()
}

export { testTaggedConfigSystem }
