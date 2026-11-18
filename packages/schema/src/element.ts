import { Element, ELEMENT_MAP, ELEMENT_CHART } from '@arcadia-eternity/const'
import { Type } from '@sinclair/typebox'

export { Element, ELEMENT_MAP, ELEMENT_CHART }

export const ElementSchema = Type.String({ minLength: 1, maxLength: 256, default: Element.Normal })
