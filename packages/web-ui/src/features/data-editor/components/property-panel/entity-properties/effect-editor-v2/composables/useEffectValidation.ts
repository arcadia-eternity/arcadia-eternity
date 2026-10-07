import { ref, type Ref } from 'vue'
import {
  validateEffect,
  seer2EffectCompileTypingEnvironment,
  type EffectValidationResult,
  type EffectValidationReferences,
} from '@arcadia-eternity/battle'

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

function buildReferences(gameData: GameDataRefs): EffectValidationReferences {
  return {
    marks: new Set(gameData.marks.allIds),
    skills: new Set(gameData.skills.allIds),
    species: new Set(gameData.species.allIds),
    effects: new Set(gameData.effects.allIds),
  }
}

function validateBasicFields(draft: Record<string, unknown>): ValidationResult[] {
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

  return results
}

function mapResults(compileResults: EffectValidationResult[]): {
  errors: ValidationResult[]
  warnings: ValidationResult[]
  referenceErrors: ValidationResult[]
} {
  const errors: ValidationResult[] = []
  const warnings: ValidationResult[] = []
  const referenceErrors: ValidationResult[] = []

  for (const r of compileResults) {
    const vr: ValidationResult = {
      level: r.category === 'reference' ? 'L3' : r.category === 'typing' ? 'L2' : 'L1',
      path: r.path,
      field: r.path.split('.').pop() ?? '',
      message: r.message,
    }
    if (r.category === 'reference') {
      referenceErrors.push(vr)
    } else if (r.category === 'typing') {
      warnings.push(vr)
    } else {
      errors.push(vr)
    }
  }

  return { errors, warnings, referenceErrors }
}

export function useEffectValidation(gameDataRef?: Ref<GameDataRefs | null>) {
  const errors = ref<ValidationResult[]>([])
  const warnings = ref<ValidationResult[]>([])
  const referenceErrors = ref<ValidationResult[]>([])

  function validate(draft: Record<string, unknown>) {
    const basicErrors = validateBasicFields(draft)

    const refs = gameDataRef?.value ? buildReferences(gameDataRef.value) : undefined
    const compileResults = validateEffect(draft, seer2EffectCompileTypingEnvironment, refs)
    const mapped = mapResults(compileResults)

    errors.value = [...basicErrors, ...mapped.errors]
    warnings.value = mapped.warnings
    referenceErrors.value = mapped.referenceErrors
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
