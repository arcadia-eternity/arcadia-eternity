import type { BaseSelector } from '@test-battle/battle/effectBuilder'
import type { SelectorChain } from '@test-battle/effect-dsl'

interface SelectorNode {
  id: string
  type: 'selector'
  data: {
    label: string
    genericType: string
  }
}

type BaseSelectorNode = SelectorNode & {
  type: 'BaseSelector'
  data: {
    target: keyof typeof BaseSelector
  }
}

type SelectPropNode = SelectorNode & {
  type: 'SelectPropNode'
  data: {
    prop: string
  }
}
