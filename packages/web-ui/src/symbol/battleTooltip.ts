import type { InjectionKey, Ref } from 'vue'

export const battleTooltipsDisabledKey: InjectionKey<Readonly<Ref<boolean>>> = Symbol('battleTooltipsDisabled')

export const battleTooltipPortalKey: InjectionKey<{
  container: Readonly<Ref<HTMLElement | null>>
  scale: Readonly<Ref<number>>
}> = Symbol('battleTooltipPortal')
