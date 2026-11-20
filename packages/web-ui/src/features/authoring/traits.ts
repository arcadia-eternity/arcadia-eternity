import { Category, Element } from '@arcadia-eternity/const'
import { environmentName } from '@/i18n/environment'

export const skillCategories: Record<Category, string> = {
  [Category.Physical]: '物理',
  [Category.Special]: '特攻',
  [Category.Status]: '属性',
  [Category.Climax]: '必杀',
}
const elements = new Set<string>(Object.values(Element))
export function isElement(value: unknown): value is Element {
  return typeof value === 'string' && elements.has(value)
}
export const elementName = (element: Element) => environmentName('elements', element)
