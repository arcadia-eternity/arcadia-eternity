// Example: Demonstrating clamp modifiers integration
import { Modifier, DurationType, ModifierHelpers, AttributeSystem } from '../src/attributeSystem'

// Mock classes for testing
class MockBattle extends Battle {
  constructor() {
    super()
  }
}

class MockPlayer extends Player {
  constructor(id: string) {
    super(id, new MockBattle())
  }
}

class MockPet extends Pet {
  constructor(id: string, owner: Player) {
    super(id, owner)
    // Initialize with some base stats
    this.attributeSystem.initializePetAttributes(
      {
        atk: 100,
        def: 80,
        spa: 90,
        spd: 70,
        spe: 85,
        hp: 200,
      },
      200,
    )
  }
}

class MockMark extends MarkInstanceImpl {
  constructor(id: string, owner: Pet) {
    super(id, owner, {
      id: 'test_mark',
      name: 'Test Mark',
      description: 'Test mark for clamp operations',
    })
  }
}

// Example 1: Using clampMax operator
function testClampMaxOperator() {
  console.log('=== Testing ClampMax Operator ===')

  const battle = new MockBattle()
  const player = new MockPlayer('player1')
  const pet = new MockPet('pet1', player)
  const mark = new MockMark('mark1', pet)

  console.log('Initial attack:', pet.attributeSystem.getStat('atk')) // Should be 100

  // Create a context for the effect
  const context = {
    source: mark,
    battle: battle,
    trigger: 'OnTurnStart' as any,
  }

  // Apply clampMax operator to limit attack to 120
  const clampMaxOp = Operators.addClampMaxModifier('atk', 120, 100)
  clampMaxOp(context, [pet])

  console.log('After clampMax(120):', pet.attributeSystem.getStat('atk')) // Should still be 100

  // Add a delta modifier to increase attack
  const deltaOp = Operators.addAttributeModifier('atk', 'delta', 50, 200)
  deltaOp(context, [pet])

  console.log('After delta +50:', pet.attributeSystem.getStat('atk')) // Should be 120 (clamped from 150)
}

// Example 2: Using clampMin operator
function testClampMinOperator() {
  console.log('\n=== Testing ClampMin Operator ===')

  const battle = new MockBattle()
  const player = new MockPlayer('player2')
  const pet = new MockPet('pet2', player)
  const mark = new MockMark('mark2', pet)

  console.log('Initial defense:', pet.attributeSystem.getStat('def')) // Should be 80

  const context = {
    source: mark,
    battle: battle,
    trigger: 'OnTurnStart' as any,
  }

  // Apply clampMin operator to ensure defense is at least 60
  const clampMinOp = Operators.addClampMinModifier('def', 60, 100)
  clampMinOp(context, [pet])

  console.log('After clampMin(60):', pet.attributeSystem.getStat('def')) // Should still be 80

  // Add a negative delta modifier to decrease defense
  const deltaOp = Operators.addAttributeModifier('def', 'delta', -30, 200)
  deltaOp(context, [pet])

  console.log('After delta -30:', pet.attributeSystem.getStat('def')) // Should be 60 (clamped from 50)
}

// Example 3: Using combined clamp operator
function testClampOperator() {
  console.log('\n=== Testing Combined Clamp Operator ===')

  const battle = new MockBattle()
  const player = new MockPlayer('player3')
  const pet = new MockPet('pet3', player)
  const mark = new MockMark('mark3', pet)

  console.log('Initial speed:', pet.attributeSystem.getStat('spe')) // Should be 85

  const context = {
    source: mark,
    battle: battle,
    trigger: 'OnTurnStart' as any,
  }

  // Apply clamp operator to limit speed between 70 and 110
  const clampOp = Operators.addClampModifier('spe', 70, 110, 100)
  clampOp(context, [pet])

  console.log('After clamp(70, 110):', pet.attributeSystem.getStat('spe')) // Should still be 85

  // Test with a large positive modifier
  const percentOp = Operators.addAttributeModifier('spe', 'percent', 1.5, 200) // *1.5
  percentOp(context, [pet])

  console.log('After percent *1.5:', pet.attributeSystem.getStat('spe')) // Should be 110 (clamped from 127.5)

  // Test with a large negative modifier
  const deltaOp = Operators.addAttributeModifier('spe', 'delta', -50, 300)
  deltaOp(context, [pet])

  console.log('After delta -50:', pet.attributeSystem.getStat('spe')) // Should be 70 (clamped from 60)
}

// Example 4: Priority testing with clamp operators
function testClampPriority() {
  console.log('\n=== Testing Clamp Priority ===')

  const battle = new MockBattle()
  const player = new MockPlayer('player4')
  const pet = new MockPet('pet4', player)
  const mark = new MockMark('mark4', pet)

  console.log('Initial HP:', pet.attributeSystem.getStat('hp')) // Should be 200

  const context = {
    source: mark,
    battle: battle,
    trigger: 'OnTurnStart' as any,
  }

  // Apply modifiers in different priority order
  const deltaOp = Operators.addAttributeModifier('hp', 'delta', 100, 200) // +100, priority 200
  const percentOp = Operators.addAttributeModifier('hp', 'percent', 1.5, 300) // *1.5, priority 300
  const clampMaxOp = Operators.addClampMaxModifier('hp', 400, 400) // max 400, priority 400

  // Apply in reverse priority order to test sorting
  deltaOp(context, [pet])
  percentOp(context, [pet])
  clampMaxOp(context, [pet])

  console.log('Application order (by priority):')
  console.log('1. ClampMax(400) - priority 400')
  console.log('2. Percent(*1.5) - priority 300')
  console.log('3. Delta(+100) - priority 200')
  console.log('Final HP:', pet.attributeSystem.getStat('hp')) // Should be 400 (clamped from 450)
}

// Run all tests
function runClampOperatorTests() {
  testClampMaxOperator()
  testClampMinOperator()
  testClampOperator()
  testClampPriority()
}

// Run tests
runClampOperatorTests()
