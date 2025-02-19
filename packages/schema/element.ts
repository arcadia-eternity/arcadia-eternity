import { Element, ELEMENT_MAP, ELEMENT_CHART } from 'package/core/element'
import { z } from 'zod'

export { Element, ELEMENT_MAP, ELEMENT_CHART }

export const ElementSchema = z.nativeEnum(Element)
