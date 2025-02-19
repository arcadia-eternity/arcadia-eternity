import { Element, ELEMENT_MAP, ELEMENT_CHART } from '@test-battle/const'
import { z } from 'zod'

export { Element, ELEMENT_MAP, ELEMENT_CHART }

export const ElementSchema = z.nativeEnum(Element)
