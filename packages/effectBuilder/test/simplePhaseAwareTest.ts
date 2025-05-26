/**
 * Simplified test for phase-aware operators in effectBuilder
 */

import { Operators } from '../dist/index.js'
import {
  ConfigSystem,
  PhaseType,
  PhaseScope,
  MarkInstanceImpl,
  SkillInstance,
  AttributeSystem,
} from '@arcadia-eternity/battle'
import { EffectTrigger, type StatTypeOnBattle } from '@arcadia-eternity/const'

class MockMark extends MarkInstanceImpl {
  constructor(id: string) {
    super(
      {
        id,
        name: id,
        description: '',
        triggers: [],
        tags: [],
        effects: [],
        config: {
          duration: 5,
          persistent: false,
          maxStacks: 1,
          stackable: false,
          stackStrategy: 'stack',
          destroyable: true,
          isShield: false,
          keepOnSwitchOut: false,
          transferOnSwitch: false,
          inheritOnFaint: false,
        },
      } as any,
      null as any,
    )
  }
}

class MockSkill extends SkillInstance {
  constructor(id: string) {
    super(
      {
        id,
        name: id,
        description: '',
        power: 100,
        accuracy: 100,
        rage: 50,
        priority: 0,
        tags: [],
        effects: [],
      } as any,
      null as any,
    )
  }
}

// Mock Pet class for testing
class MockPet {
  public attributeSystem: any = new AttributeSystem()
  public id: string
  public name: string

  constructor(id: string, name: string) {
    this.id = id
    this.name = name
    // Initialize basic attributes
    this.attributeSystem.registerBaseAttribute('attack', 100)
    this.attributeSystem.registerBaseAttribute('defense', 80)
    this.attributeSystem.registerBaseAttribute('speed', 90)
    this.attributeSystem.registerBaseAttribute('power', 100)
  }
}

function createMockPhase(id: string, className: string): any {
  return { id, constructor: { name: className } }
}

function createMockContext(source: any): any {
  return {
    source,
    battle: null as any, // We don't need battle for this test
    trigger: EffectTrigger.TurnStart,
  }
}

async function testPhaseAwareAttributeOperator() {
  console.log('=== Testing Phase-Aware Attribute Operator ===')

  // Initialize ConfigSystem first
  const configSystem = ConfigSystem.getInstance()
  await new Promise(resolve => setTimeout(resolve, 100))

  // Create test pet
  const pet = new MockPet('test_pet', 'Test Pet')

  // Create mock mark as effect source
  const mark = new MockMark('test_mark')
  const context = createMockContext(mark)

  console.log('1. Initial attack:', pet.attributeSystem.getCurrentValue('attack'))

  // Test regular attribute modifier (should always work)
  const regularOperator = Operators.addAttributeModifier('attack' as StatTypeOnBattle, 'delta', 50, 100)

  regularOperator(context, [pet as any])
  console.log('2. After regular modifier:', pet.attributeSystem.getCurrentValue('attack'))

  // Test phase-aware attribute modifier (should only work during skill phase)
  const phaseOperator = Operators.addAttributeModifier(
    'attack' as StatTypeOnBattle,
    'delta',
    30,
    100,
    'skill', // phaseType
    'current', // scope
    undefined, // phaseId
  )

  phaseOperator(context, [pet as any])
  console.log('3. After phase modifier (no skill phase):', pet.attributeSystem.getCurrentValue('attack'))

  // Start skill phase
  const skillPhase = createMockPhase('test_skill', 'SkillPhase')
  configSystem.pushPhase(skillPhase)

  console.log('4. During skill phase:', pet.attributeSystem.getCurrentValue('attack'))

  // End skill phase
  configSystem.popPhase(skillPhase)
  console.log('5. After skill phase ends:', pet.attributeSystem.getCurrentValue('attack'))

  console.log('✅ Phase-aware attribute operator test completed\n')
}

async function testPhaseAwareSkillOperator() {
  console.log('=== Testing Phase-Aware Skill Operator ===')

  // Initialize ConfigSystem first
  const configSystem = ConfigSystem.getInstance()
  await new Promise(resolve => setTimeout(resolve, 100))

  // Create test skill
  const skill = new MockSkill('test_skill')

  // Create mock mark as effect source
  const mark = new MockMark('test_mark')
  const context = createMockContext(mark)

  console.log('1. Initial skill power:', skill.attributeSystem.getCurrentValue('power'))

  // Test regular skill modifier (should always work)
  const regularOperator = Operators.addSkillAttributeModifier('power', 'delta', 25, 100)

  regularOperator(context, [skill])
  console.log('2. After regular modifier:', skill.attributeSystem.getCurrentValue('power'))

  // Test phase-aware skill modifier (should only work during damage phase)
  const phaseOperator = Operators.addSkillAttributeModifier(
    'power',
    'delta',
    50,
    100,
    'damage', // phaseType
    'current', // scope
    undefined, // phaseId
  )

  phaseOperator(context, [skill])
  console.log('3. After phase modifier (no damage phase):', skill.attributeSystem.getCurrentValue('power'))

  // Start damage phase
  const damagePhase = createMockPhase('test_damage', 'DamagePhase')
  configSystem.pushPhase(damagePhase)

  console.log('4. During damage phase:', skill.attributeSystem.getCurrentValue('power'))

  // End damage phase
  configSystem.popPhase(damagePhase)
  console.log('5. After damage phase ends:', skill.attributeSystem.getCurrentValue('power'))

  console.log('✅ Phase-aware skill operator test completed\n')
}

async function testSpecificPhaseIdOperator() {
  console.log('=== Testing Specific Phase ID Operator ===')

  // Initialize ConfigSystem first
  const configSystem = ConfigSystem.getInstance()
  await new Promise(resolve => setTimeout(resolve, 100))

  // Create test pet
  const pet = new MockPet('test_pet', 'Test Pet')

  // Create mock mark as effect source
  const mark = new MockMark('test_mark')
  const context = createMockContext(mark)

  console.log('1. Initial defense:', pet.attributeSystem.getCurrentValue('defense'))

  // Test specific phase ID modifier (should only work for specific skill)
  const specificOperator = Operators.addAttributeModifier(
    'defense' as StatTypeOnBattle,
    'delta',
    40,
    100,
    'skill', // phaseType
    'current', // scope
    'fire_blast', // specific phaseId
  )

  specificOperator(context, [pet as any])
  console.log('2. After specific phase modifier:', pet.attributeSystem.getCurrentValue('defense'))

  // Start skill phase with different ID
  const iceSkillPhase = createMockPhase('ice_shard', 'SkillPhase')
  configSystem.pushPhase(iceSkillPhase)
  console.log('3. During ice_shard skill:', pet.attributeSystem.getCurrentValue('defense'))
  configSystem.popPhase(iceSkillPhase)

  // Start skill phase with matching ID
  const fireSkillPhase = createMockPhase('fire_blast', 'SkillPhase')
  configSystem.pushPhase(fireSkillPhase)
  console.log('4. During fire_blast skill:', pet.attributeSystem.getCurrentValue('defense'))
  configSystem.popPhase(fireSkillPhase)

  console.log('5. After fire_blast skill ends:', pet.attributeSystem.getCurrentValue('defense'))

  console.log('✅ Specific phase ID operator test completed\n')
}

async function runAllTests() {
  console.log('🚀 Starting Phase-Aware Operator Tests\n')

  await testPhaseAwareAttributeOperator()
  await testPhaseAwareSkillOperator()
  await testSpecificPhaseIdOperator()

  console.log('🎉 All phase-aware operator tests completed!')
}

export { runAllTests }

if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests()
}
