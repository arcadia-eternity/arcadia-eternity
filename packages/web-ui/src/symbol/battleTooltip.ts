import type { InjectionKey, Ref } from 'vue'

export const battleTooltipsDisabledKey: InjectionKey<Readonly<Ref<boolean>>> = Symbol('battleTooltipsDisabled')
