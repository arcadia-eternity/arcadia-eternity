import type { TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { ref, type Ref } from 'vue'

export interface FieldError {
  path: string
  message: string
}

export interface ValidationResult {
  valid: boolean
  errors: FieldError[]
  fieldErrors: Record<string, string>
}

function buildFieldErrors(errors: FieldError[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const err of errors) {
    map[err.path] = err.message
  }
  return map
}

function collectErrors(schema: TSchema, value: unknown): FieldError[] {
  const errors: FieldError[] = []
  for (const error of Value.Errors(schema, value)) {
    errors.push({
      path: error.path.slice(1).replace(/\//g, '.'),
      message: error.message,
    })
  }
  return errors
}

export function validateField(schema: TSchema, value: unknown): ValidationResult {
  const valid = Value.Check(schema, value)
  if (valid) {
    return { valid: true, errors: [], fieldErrors: {} }
  }
  const errors = collectErrors(schema, value)
  return { valid: false, errors, fieldErrors: buildFieldErrors(errors) }
}

export function validateSingleField(schema: TSchema, path: string, value: unknown): string | null {
  const result = validateField(schema, value)
  if (result.valid) return null
  const dottedPath = path.startsWith('.') ? path.slice(1) : path
  return result.fieldErrors[dottedPath] ?? null
}

export function useEditorValidation() {
  const fieldErrors: Ref<Record<string, string>> = ref({})

  function validateRecord(schema: TSchema, record: Record<string, unknown>): ValidationResult {
    const result = validateField(schema, record)
    fieldErrors.value = { ...result.fieldErrors }
    return result
  }

  function validateFieldAt(schema: TSchema, path: string, value: unknown): string | null {
    const message = validateSingleField(schema, path, value)
    const dottedPath = path.startsWith('.') ? path.slice(1) : path
    if (message) {
      fieldErrors.value = { ...fieldErrors.value, [dottedPath]: message }
    } else {
      const next = { ...fieldErrors.value }
      delete next[dottedPath]
      fieldErrors.value = next
    }
    return message
  }

  function clearErrors() {
    fieldErrors.value = {}
  }

  return { validateRecord, validateFieldAt, fieldErrors, clearErrors }
}
