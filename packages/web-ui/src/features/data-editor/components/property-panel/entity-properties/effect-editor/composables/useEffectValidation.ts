import { ref, type Ref } from 'vue'
import { Value } from '@sinclair/typebox/value'
import { effectDSLSchema, getEffectDslNodeTyping } from '@arcadia-eternity/schema'
import type { EffectDSL, OperatorDSL, ConditionDSL, Value as DSLValue, SelectorDSL } from '@arcadia-eternity/schema'
import type { EffectDslNodeTypingRule } from '@arcadia-eternity/schema'

export type ValidationLevel = 'L1' | 'L2' | 'L3'

export interface ValidationResult {
  level: ValidationLevel
  path: string
  field: string
  message: string
}

interface GameDataRefs {
  marks: { byId: Record<string, unknown>; allIds: string[] }
  skills: { byId: Record<string, unknown>; allIds: string[] }
  species: { byId: Record<string, unknown>; allIds: string[] }
  effects: { byId: Record<string, unknown>; allIds: string[] }
}

function validateStructure(draft: Record<string, unknown>): ValidationResult[] {
  const results: ValidationResult[] = []

  if (!draft.id || typeof draft.id !== 'string' || draft.id.trim() === '') {
    results.push({
      level: 'L1',
      path: 'id',
      field: 'id',
      message: '效果 ID 不能为空',
    })
  }

  if (!draft.apply) {
    results.push({
      level: 'L1',
      path: 'apply',
      field: 'apply',
      message: '必须定义至少一个操作符 (apply)',
    })
  }

  if (draft.priority !== undefined && typeof draft.priority !== 'number') {
    results.push({
      level: 'L1',
      path: 'priority',
      field: 'priority',
      message: '优先级必须为数字',
    })
  }

  try {
    const valid = Value.Check(effectDSLSchema, draft)
    if (!valid) {
      const errors = [...Value.Errors(effectDSLSchema, draft)]
      for (const err of errors.slice(0, 10)) {
        results.push({
          level: 'L1',
          path: String(err.path).replace(/^\//, '').replace(/\//g, '.'),
          field: typeof err.path === 'string' ? (err.path.split('/').pop() ?? '') : '',
          message: err.message,
        })
      }
    }
  } catch {
    void 0
  }

  return results
}

function validateTyping(draft: Record<string, unknown>): ValidationResult[] {
  const results: ValidationResult[] = []

  function validateOperatorFields(operator: Record<string, unknown> | null | undefined, basePath: string) {
    if (!operator || typeof operator !== 'object') return

    const opType = operator.type as string | undefined
    if (!opType) {
      results.push({
        level: 'L2',
        path: `${basePath}.type`,
        field: 'type',
        message: '操作符缺少 type 字段',
      })
      return
    }

    const typing = getEffectDslNodeTyping('operator', opType)
    if (!typing) return

    validateFieldsAgainstTyping(operator, typing, basePath, results)

    if (opType === 'conditional') {
      validateOperatorFields(operator.trueOperator as Record<string, unknown>, `${basePath}.trueOperator`)
      if (operator.falseOperator) {
        validateOperatorFields(operator.falseOperator as Record<string, unknown>, `${basePath}.falseOperator`)
      }
    }
  }

  function validateConditionFields(condition: Record<string, unknown> | null | undefined, basePath: string) {
    if (!condition || typeof condition !== 'object') return

    const condType = condition.type as string | undefined
    if (!condType) {
      results.push({
        level: 'L2',
        path: `${basePath}.type`,
        field: 'type',
        message: '条件缺少 type 字段',
      })
      return
    }

    const typing = getEffectDslNodeTyping('condition', condType)
    if (typing) {
      validateFieldsAgainstTyping(condition, typing, basePath, results)
    }

    const nestedKeys = ['conditions', 'condition'] as const
    for (const key of nestedKeys) {
      const nested = condition[key]
      if (Array.isArray(nested)) {
        nested.forEach((c, i) => validateConditionFields(c as Record<string, unknown>, `${basePath}.${key}[${i}]`))
      } else if (nested && typeof nested === 'object') {
        validateConditionFields(nested as Record<string, unknown>, `${basePath}.${key}`)
      }
    }
  }

  const apply = draft.apply
  if (apply) {
    if (Array.isArray(apply)) {
      apply.forEach((op, i) => validateOperatorFields(op as Record<string, unknown>, `apply[${i}]`))
    } else {
      validateOperatorFields(apply as Record<string, unknown>, 'apply')
    }
  }

  const condition = draft.condition
  if (condition) {
    validateConditionFields(condition as Record<string, unknown>, 'condition')
  }

  return results
}

function validateFieldsAgainstTyping(
  node: Record<string, unknown>,
  typing: EffectDslNodeTypingRule,
  basePath: string,
  results: ValidationResult[],
) {
  if (typing.selectorFields) {
    for (const [field, fieldRule] of Object.entries(typing.selectorFields)) {
      const value = node[field]
      if (value === null || value === undefined) continue

      if (typeof value === 'string') {
        const validSelectors = resolveValidSelectors(fieldRule)
        if (validSelectors.length > 0 && !validSelectors.includes(value)) {
          results.push({
            level: 'L2',
            path: `${basePath}.${field}`,
            field,
            message: `选择器 "${value}" 不适用于此字段。允许的类型: ${validSelectors.slice(0, 5).join(', ')}`,
          })
        }
      }
    }
  }

  if (typing.valueFields) {
    for (const [field, fieldRule] of Object.entries(typing.valueFields)) {
      const value = node[field]
      if (value === null || value === undefined) continue

      const allowedScalars = new Set<string>()
      for (const constraint of (fieldRule as { allow: readonly { kind: string; valueTypes?: readonly string[] }[] })
        .allow) {
        if (constraint.kind === 'scalar' && constraint.valueTypes) {
          for (const vt of constraint.valueTypes) {
            allowedScalars.add(vt)
          }
        }
      }

      if (allowedScalars.size > 0) {
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          const typedVal = value as Record<string, unknown>
          if (typedVal.type === 'raw:string' && !allowedScalars.has('string')) {
            results.push({
              level: 'L2',
              path: `${basePath}.${field}`,
              field,
              message: `字段 "${field}" 应为数值类型，当前为字符串`,
            })
          }
          if (typedVal.type === 'raw:boolean' && !allowedScalars.has('boolean')) {
            results.push({
              level: 'L2',
              path: `${basePath}.${field}`,
              field,
              message: `字段 "${field}" 应为数值类型，当前为布尔值`,
            })
          }
        }
      }
    }
  }
}

function resolveValidSelectors(fieldRule: unknown): string[] {
  const rule = fieldRule as {
    allow?: readonly { kind: string; targets?: readonly string[]; owners?: readonly string[] }[]
  }
  if (!rule.allow) return []

  const selectors = new Set<string>()
  const targetMap: Record<string, string[]> = {
    pet: ['self', 'opponent', 'target'],
    mark: ['selfMarks', 'opponentMarks', 'mark'],
    skill: ['selfSkills', 'opponentSkills', 'skill'],
  }

  for (const constraint of rule.allow) {
    if (constraint.kind === 'id' && constraint.targets) {
      for (const target of constraint.targets) {
        const mapped = targetMap[target]
        if (mapped) mapped.forEach(s => selectors.add(s))
      }
    }
    if (constraint.kind === 'owner' && constraint.owners) {
      constraint.owners.forEach(o => selectors.add(o))
    }
  }

  return [...selectors]
}

function validateReferences(draft: Record<string, unknown>, gameData: GameDataRefs): ValidationResult[] {
  const results: ValidationResult[] = []

  function checkEntityRefs(obj: unknown, path: string) {
    if (!obj || typeof obj !== 'object') return

    if (Array.isArray(obj)) {
      obj.forEach((item, i) => checkEntityRefs(item, `${path}[${i}]`))
      return
    }

    const record = obj as Record<string, unknown>

    if (record.type === 'entity:baseMark' && typeof record.value === 'string') {
      const markId = record.value
      if (!gameData.marks.byId[markId]) {
        results.push({
          level: 'L3',
          path,
          field: 'value',
          message: `引用的标记 "${markId}" 不存在`,
        })
      }
    }

    if (record.type === 'entity:baseSkill' && typeof record.value === 'string') {
      const skillId = record.value
      if (!gameData.skills.byId[skillId]) {
        results.push({
          level: 'L3',
          path,
          field: 'value',
          message: `引用的技能 "${skillId}" 不存在`,
        })
      }
    }

    if (record.type === 'entity:species' && typeof record.value === 'string') {
      const speciesId = record.value
      if (!gameData.species.byId[speciesId]) {
        results.push({
          level: 'L3',
          path,
          field: 'value',
          message: `引用的物种 "${speciesId}" 不存在`,
        })
      }
    }

    if (record.type === 'entity:effect' && typeof record.value === 'string') {
      const effectId = record.value
      if (!gameData.effects.byId[effectId]) {
        results.push({
          level: 'L3',
          path,
          field: 'value',
          message: `引用的效果 "${effectId}" 不存在`,
        })
      }
    }

    for (const [key, val] of Object.entries(record)) {
      if (typeof val === 'object' && val !== null) {
        checkEntityRefs(val, `${path}.${key}`)
      }
    }
  }

  checkEntityRefs(draft.apply, 'apply')
  if (draft.condition) {
    checkEntityRefs(draft.condition, 'condition')
  }

  return results
}

export function useEffectValidation(gameDataRef?: Ref<GameDataRefs | null>) {
  const errors = ref<ValidationResult[]>([])
  const warnings = ref<ValidationResult[]>([])
  const referenceErrors = ref<ValidationResult[]>([])

  function validate(draft: Record<string, unknown>) {
    const l1 = validateStructure(draft)
    const l2 = validateTyping(draft)

    errors.value = [...l1]
    warnings.value = [...l2]
    referenceErrors.value = []

    if (gameDataRef?.value) {
      referenceErrors.value = validateReferences(draft, gameDataRef.value)
    }
  }

  function hasBlockingErrors(): boolean {
    return referenceErrors.value.length > 0
  }

  function clear() {
    errors.value = []
    warnings.value = []
    referenceErrors.value = []
  }

  return {
    errors,
    warnings,
    referenceErrors,
    validate,
    hasBlockingErrors,
    clear,
  }
}
