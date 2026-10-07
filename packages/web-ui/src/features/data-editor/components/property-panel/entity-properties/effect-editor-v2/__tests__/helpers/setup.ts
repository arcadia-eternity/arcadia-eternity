import { mount, shallowMount, type ComponentMountingOptions } from '@vue/test-utils'
import type { DefineComponent } from 'vue'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyComponent = DefineComponent<any, any, any>

export function mountWithDefaults<C extends AnyComponent>(component: C, options: ComponentMountingOptions<C> = {}) {
  return mount(component, {
    ...options,
  })
}

export { mount, shallowMount }
