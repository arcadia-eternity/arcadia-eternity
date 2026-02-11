import { Element, ELEMENT_MAP, ELEMENT_CHART } from '@arcadia-eternity/const'
import { StringEnum } from './utils'

export { Element, ELEMENT_MAP, ELEMENT_CHART }

export const ElementSchema = StringEnum(Object.values(Element))
