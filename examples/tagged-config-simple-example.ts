import { ConfigSystem, ConfigModifierType, ConfigDurationType } from '@arcadia-eternity/battle'

// 简单的标签化配置系统示例
function simpleTaggedConfigExample() {
  console.log('=== 标签化配置系统简单示例 ===\n')
  
  const configSystem = new ConfigSystem()
  
  // 1. 注册一些带标签的配置
  console.log('1. 注册带标签的配置')
  configSystem.registerTaggedConfig('freeze.probability', 0.3, ['freeze', 'probability'])
  configSystem.registerTaggedConfig('burn.probability', 0.2, ['burn', 'probability'])
  configSystem.registerTaggedConfig('ice.damage', 50, ['ice', 'damage'])
  
  console.log('初始配置值：')
  console.log(`  冰冻概率: ${configSystem.get('freeze.probability')}`)
  console.log(`  燃烧概率: ${configSystem.get('burn.probability')}`)
  console.log(`  冰系伤害: ${configSystem.get('ice.damage')}\n`)
  
  // 2. 增加所有概率类效果10%
  console.log('2. 增加所有概率类效果10%')
  const probabilityBoost = configSystem.addTaggedConfigModifierSingle(
    'probability',
    ConfigModifierType.delta,
    0.1,
    100,
    ConfigDurationType.instant
  )
  
  console.log('增强后的配置值：')
  console.log(`  冰冻概率: ${configSystem.get('freeze.probability')} (+0.1)`)
  console.log(`  燃烧概率: ${configSystem.get('burn.probability')} (+0.1)`)
  console.log(`  冰系伤害: ${configSystem.get('ice.damage')} (无变化)\n`)
  
  // 3. 增加所有冰系效果20%
  console.log('3. 增加所有冰系效果20%')
  const iceBoost = configSystem.addTaggedConfigModifierSingle(
    'ice',
    ConfigModifierType.delta,
    0.2,
    150,
    ConfigDurationType.instant
  )
  
  console.log('再次增强后的配置值：')
  console.log(`  冰冻概率: ${configSystem.get('freeze.probability')} (无变化)`)
  console.log(`  燃烧概率: ${configSystem.get('burn.probability')} (无变化)`)
  console.log(`  冰系伤害: ${configSystem.get('ice.damage')} (+0.2)\n`)
  
  // 4. 查看哪些配置受到了影响
  console.log('4. 查看标签分组')
  console.log(`  带有"probability"标签的配置: ${configSystem.getConfigKeysByTag('probability').join(', ')}`)
  console.log(`  带有"ice"标签的配置: ${configSystem.getConfigKeysByTag('ice').join(', ')}`)
  console.log(`  带有"freeze"标签的配置: ${configSystem.getConfigKeysByTag('freeze').join(', ')}\n`)
  
  // 5. 清理
  console.log('5. 清理修改器')
  probabilityBoost()
  iceBoost()
  
  console.log('清理后的配置值：')
  console.log(`  冰冻概率: ${configSystem.get('freeze.probability')}`)
  console.log(`  燃烧概率: ${configSystem.get('burn.probability')}`)
  console.log(`  冰系伤害: ${configSystem.get('ice.damage')}`)
  
  configSystem.destroy()
  console.log('\n示例完成！')
}

// 运行示例
if (import.meta.url === `file://${process.argv[1]}`) {
  simpleTaggedConfigExample()
}

export { simpleTaggedConfigExample }
