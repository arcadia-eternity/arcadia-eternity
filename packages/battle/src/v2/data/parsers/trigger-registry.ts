import { EffectTrigger } from '@arcadia-eternity/const'

const DEFAULT_EFFECT_TRIGGERS = new Set<string>([
  ...Object.values(EffectTrigger),
  'BeforeEffect',
])

const effectTriggerRegistry = new Set<string>(DEFAULT_EFFECT_TRIGGERS)

export function registerEffectTrigger(trigger: string): void {
  if (!trigger) return
  effectTriggerRegistry.add(trigger)
}

export function registerEffectTriggers(triggers: Iterable<string>): void {
  for (const trigger of triggers) {
    registerEffectTrigger(trigger)
  }
}

export function isRegisteredEffectTrigger(trigger: string): boolean {
  if (!trigger) return false
  return effectTriggerRegistry.has(trigger)
}

export function assertRegisteredEffectTrigger(trigger: string, path: string): void {
  if (isRegisteredEffectTrigger(trigger)) return
  throw new Error(`Effect strict compile failed at ${path}: unknown trigger '${trigger}'`)
}

export function resetEffectTriggerRegistry(): void {
  effectTriggerRegistry.clear()
  for (const trigger of DEFAULT_EFFECT_TRIGGERS) {
    effectTriggerRegistry.add(trigger)
  }
}

export function listRegisteredEffectTriggers(): string[] {
  return [...effectTriggerRegistry]
}
