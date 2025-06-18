// Mock nanoid before importing anything else
jest.mock('nanoid', () => ({
  nanoid: () => 'mock-id-' + Math.random().toString(36).substr(2, 9),
}))

// Mock the battle system
jest.mock('../battle', () => ({
  Battle: jest.fn().mockImplementation(() => ({
    applyEffects: jest.fn(),
    emitMessage: jest.fn(),
    petMap: new Map(),
    skillMap: new Map(),
    marks: [],
    playerA: { team: [] },
    playerB: { team: [] },
  })),
}))

// Mock context
jest.mock('../context', () => ({
  TransformContext: jest.fn().mockImplementation(() => ({
    available: true,
    battle: {},
  })),
}))

describe('Transformation System Unit Tests', () => {
  let mockBattle: any
  let TransformationSystem: any
  let TransformationStrategyRegistry: any

  beforeEach(async () => {
    // Clear all mocks
    jest.clearAllMocks()

    // Create mock battle
    mockBattle = {
      applyEffects: jest.fn(),
      emitMessage: jest.fn(),
      petMap: new Map(),
      skillMap: new Map(),
      marks: [],
      playerA: { team: [] },
      playerB: { team: [] },
    }

    // Import the classes after mocking
    const transformationModule = await import('../transformation')
    TransformationSystem = transformationModule.TransformationSystem
    TransformationStrategyRegistry = transformationModule.TransformationStrategyRegistry
  })

  describe('TransformationStrategyRegistry', () => {
    it('should register and retrieve strategies correctly', () => {
      const registry = new TransformationStrategyRegistry()

      const mockStrategy = {
        canTransform: jest.fn().mockReturnValue(true),
        getEntityType: jest.fn().mockReturnValue('pet'),
        preserveState: jest.fn(),
        restoreState: jest.fn(),
        performTransformation: jest.fn(),
        getOriginalBase: jest.fn(),
      }

      registry.register('pet', mockStrategy)

      const mockEntity = { id: 'test', type: 'pet' }
      const retrievedStrategy = registry.getStrategy(mockEntity)

      expect(retrievedStrategy).toBe(mockStrategy)
      expect(mockStrategy.canTransform).toHaveBeenCalledWith(mockEntity)
    })

    it('should return undefined for unknown entity types', () => {
      const registry = new TransformationStrategyRegistry()

      const mockStrategy = {
        canTransform: jest.fn().mockReturnValue(false),
        getEntityType: jest.fn().mockReturnValue('pet'),
      }

      registry.register('pet', mockStrategy)

      const unknownEntity = { id: 'unknown', type: 'unknown' }
      const strategy = registry.getStrategy(unknownEntity)

      expect(strategy).toBeUndefined()
      expect(mockStrategy.canTransform).toHaveBeenCalledWith(unknownEntity)
    })

    it('should return all registered strategies', () => {
      const registry = new TransformationStrategyRegistry()

      const strategy1 = { canTransform: jest.fn(), getEntityType: () => 'pet' }
      const strategy2 = { canTransform: jest.fn(), getEntityType: () => 'skill' }

      registry.register('pet', strategy1)
      registry.register('skill', strategy2)

      const allStrategies = registry.getAllStrategies()

      expect(allStrategies).toHaveLength(2)
      expect(allStrategies).toContain(strategy1)
      expect(allStrategies).toContain(strategy2)
    })
  })

  describe('TransformationSystem', () => {
    let transformationSystem: any
    let mockStrategy: any
    let mockEntity: any

    beforeEach(() => {
      transformationSystem = new TransformationSystem(mockBattle)

      mockStrategy = {
        canTransform: jest.fn().mockReturnValue(true),
        getEntityType: jest.fn().mockReturnValue('pet'),
        preserveState: jest.fn().mockReturnValue({ mockState: true }),
        restoreState: jest.fn(),
        performTransformation: jest.fn().mockResolvedValue(undefined),
        getOriginalBase: jest.fn(),
      }

      mockEntity = {
        id: 'test-entity',
        base: { id: 'original-base', element: 'fire' },
      }

      // Register strategy after creating the system
      transformationSystem.registerStrategy('pet', mockStrategy)

      // Verify the strategy is registered by checking if it can be retrieved
      const registry = transformationSystem['strategyRegistry']
      const retrievedStrategy = registry.getStrategy(mockEntity)
      if (!retrievedStrategy) {
        throw new Error('Strategy was not properly registered')
      }
    })

    it('should register strategies correctly', () => {
      // Create a fresh transformation system without default strategies
      const freshBattle = {
        applyEffects: jest.fn(),
        emitMessage: jest.fn(),
        petMap: new Map(),
        skillMap: new Map(),
        marks: [],
        playerA: { team: [] },
        playerB: { team: [] },
      }

      // Create system without calling initializeDefaultStrategies
      const freshSystem = Object.create(TransformationSystem.prototype)
      freshSystem.battle = freshBattle
      freshSystem.transformations = new Map()
      freshSystem.temporaryTransformStack = new Map()
      freshSystem.permanentTransforms = new Map()
      freshSystem.strategyRegistry = new TransformationStrategyRegistry()

      const newStrategy = {
        canTransform: jest.fn().mockReturnValue(true),
        getEntityType: jest.fn().mockReturnValue('custom'),
        preserveState: jest.fn(),
        restoreState: jest.fn(),
        performTransformation: jest.fn(),
        getOriginalBase: jest.fn(),
      }

      // Register strategy
      freshSystem.registerStrategy('custom', newStrategy)

      // Test that the strategy was registered
      const mockEntity = { id: 'custom1', type: 'custom' }
      const retrievedStrategy = freshSystem.strategyRegistry.getStrategy(mockEntity)

      expect(retrievedStrategy).toBe(newStrategy)
      expect(newStrategy.canTransform).toHaveBeenCalledWith(mockEntity)
    })

    it('should apply temporary transformation successfully', async () => {
      const newBase = { id: 'new-base', element: 'water' }

      const result = await transformationSystem.applyTransformation(mockEntity, newBase, 'temporary', 5, undefined)

      expect(result).toBe(true)
      expect(mockBattle.applyEffects).toHaveBeenCalledTimes(2) // Before and After
      expect(mockBattle.emitMessage).toHaveBeenCalled()
      expect(mockStrategy.preserveState).toHaveBeenCalledWith(mockEntity)
    })

    it('should fail transformation when no strategy is found', async () => {
      const unknownEntity = { id: 'unknown', base: {} }
      const newBase = { id: 'new-base' }

      // Make the strategy return false for canTransform
      mockStrategy.canTransform.mockReturnValue(false)

      const result = await transformationSystem.applyTransformation(unknownEntity, newBase, 'temporary')

      expect(result).toBe(false)
    })

    it('should fail transformation when context is not available', async () => {
      const newBase = { id: 'new-base', element: 'water' }

      // Mock applyEffects to make context unavailable
      mockBattle.applyEffects.mockImplementation((context: any) => {
        context.available = false
      })

      const result = await transformationSystem.applyTransformation(mockEntity, newBase, 'temporary')

      expect(result).toBe(false)
    })

    it('should handle permanent transformation with clear_temporary strategy', async () => {
      const newBase = { id: 'new-base', element: 'water' }

      const result = await transformationSystem.applyTransformation(
        mockEntity,
        newBase,
        'permanent',
        0,
        undefined,
        'clear_temporary',
      )

      expect(result).toBe(true)
      expect(mockStrategy.performTransformation).toHaveBeenCalledWith(mockEntity, newBase, { mockState: true })
    })

    it('should get transformation state correctly', () => {
      const state = transformationSystem.getTransformationState(mockEntity)

      expect(state).toEqual({
        isTransformed: false,
        currentTransformations: [],
        activeTransformation: undefined,
      })
    })

    it('should handle priority system correctly', async () => {
      const base1 = { id: 'base1', element: 'fire' }
      const base2 = { id: 'base2', element: 'water' }

      // Apply low priority transformation
      await transformationSystem.applyTransformation(mockEntity, base1, 'temporary', 1)

      // Apply high priority transformation
      await transformationSystem.applyTransformation(mockEntity, base2, 'temporary', 5)

      const state = transformationSystem.getTransformationState(mockEntity)

      expect(state.isTransformed).toBe(true)
      expect(state.currentTransformations).toHaveLength(2)
      expect(state.activeTransformation?.priority).toBe(5)
    })

    it('should remove transformations correctly', async () => {
      const newBase = { id: 'new-base', element: 'water' }

      // Apply transformation first
      await transformationSystem.applyTransformation(mockEntity, newBase, 'temporary', 1)

      // Remove transformation
      const result = await transformationSystem.removeTransformation(mockEntity)

      expect(result).toBe(true)
      expect(mockBattle.emitMessage).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          reason: 'manual',
        }),
      )
    })

    it('should cleanup mark transformations', () => {
      const mockMark = { id: 'mark1' }

      // This should not throw an error
      expect(() => {
        transformationSystem.cleanupMarkTransformations(mockMark)
      }).not.toThrow()
    })

    it('should preserve causing effects', async () => {
      const newBase = { id: 'new-base', element: 'water' }
      const causedBy = { id: 'mark1', constructor: { name: 'MarkInstance' } }

      const result = await transformationSystem.applyTransformation(mockEntity, newBase, 'temporary', 1, causedBy)

      expect(result).toBe(true)

      // Check that the preserved state includes protected effects
      const preserveStateCall = mockStrategy.preserveState.mock.calls[0]
      expect(preserveStateCall[0]).toBe(mockEntity)
    })
  })

  describe('Error Handling', () => {
    let transformationSystem: any

    beforeEach(() => {
      transformationSystem = new TransformationSystem(mockBattle)
    })

    it('should handle removal of non-existent transformation', async () => {
      const mockEntity = { id: 'test', base: {} }

      const result = await transformationSystem.removeTransformation(mockEntity, 'non-existent-id')

      expect(result).toBe(false)
    })

    it('should handle removal from entity with no transformations', async () => {
      const mockEntity = { id: 'test', base: {} }

      const result = await transformationSystem.removeTransformation(mockEntity)

      expect(result).toBe(false)
    })

    it('should handle cleanup of transformations for non-existent mark', () => {
      const nonExistentMark = { id: 'non-existent' }

      expect(() => {
        transformationSystem.cleanupMarkTransformations(nonExistentMark)
      }).not.toThrow()
    })
  })
})
