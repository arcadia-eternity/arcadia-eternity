//@ts-nocheck
import { Pet, Player } from '@test-battle/battle'
import { createExtractor } from '../extractor'

describe('createExtractor', () => {
  // 测试数据准备
  const basePet: Pet = {
    owner: { name: 'Alice', activePet: {} as Pet },
    stat: { atk: 100, def: 50 },
    statStage: { atk: 120 },
    marks: [{ duration: 10, tags: ['fire', 'slow'] }],
    skills: [{ owner: {} as Pet }],
  }

  // 测试用例组
  describe('单值路径', () => {
    test('提取直接属性', () => {
      const extract = createExtractor<Pet, 'owner'>('owner')
      expect(extract(basePet)).toBe(basePet.owner)
    })

    test('提取深层嵌套属性', () => {
      const extract = createExtractor<Pet, 'owner.name'>('owner.name')
      expect(extract(basePet)).toBe('Alice')
    })

    test('提取复杂嵌套路径', () => {
      const complexPet: Pet = {
        ...basePet,
        owner: {
          name: 'Charlie',
          activePet: {
            owner: { name: 'Nested', activePet: {} as Pet },
            stat: { atk: 50, def: 30 },
            statStage: { atk: 60 },
            marks: [],
            skills: [],
          },
        },
      }

      const extract = createExtractor<Pet, 'owner.activePet.owner.name'>('owner.activePet.owner.name')
      expect(extract(complexPet)).toBe('Nested')
    })
  })

  describe('数组路径', () => {
    const multiMarkPet: Pet = {
      ...basePet,
      marks: [
        { duration: 10, tags: ['fire'] },
        { duration: 20, tags: ['ice'] },
      ],
    }

    test('展开单层数组', () => {
      const extract = createExtractor<Pet, 'marks[].duration'>('marks[].duration')
      expect(extract(multiMarkPet)).toEqual([10, 20])
    })

    test('处理空数组', () => {
      const emptyPet: Pet = { ...basePet, marks: [] }
      const extract = createExtractor<Pet, 'marks[].duration'>('marks[].duration')
      expect(extract(emptyPet)).toEqual([])
    })

    test('展开多层数组', () => {
      const multiSkillPet: Pet = {
        ...basePet,
        skills: [
          { owner: { ...basePet, owner: { name: 'Bob', activePet: {} as Pet } } },
          { owner: { ...basePet, owner: { name: 'Carol', activePet: {} as Pet } } },
        ],
      }

      const extract = createExtractor<Pet, 'skills[].owner.owner.name'>('skills[].owner.owner.name')
      expect(extract(multiSkillPet)).toEqual(['Bob', 'Carol'])
    })
  })

  describe('边界情况', () => {
    const invalidPet: Pet = {
      ...basePet,
      skills: [{ owner: undefined as unknown as Pet }],
    }

    test('处理 undefined 值', () => {
      const extract = createExtractor<Pet, 'skills[].owner.name'>('skills[].owner.name')
      expect(extract(invalidPet)).toEqual([])
    })

    test('处理 null 值', () => {
      const nullPet: Pet = {
        ...basePet,
        owner: null as unknown as Player,
      }

      const extract = createExtractor<Pet, 'owner.name'>('owner.name')
      expect(extract(nullPet)).toBeUndefined()
    })

    test('处理非法路径', () => {
      const extract = createExtractor<Pet, 'invalid.path'>('invalid.path')
      expect(extract(basePet)).toBeUndefined()
    })
  })
})
