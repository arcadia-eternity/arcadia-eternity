import { officialAssetUrl } from '@/utils/officialAssetUrl'
import unknownPet from '@/assets/images/unknown-pet.svg'
import type { MarkSchemaType, SkillSchemaType, SpeciesSchemaType } from '@arcadia-eternity/schema'

export function resolveMarkIconUrl(
  mark: Partial<MarkSchemaType> | undefined,
  _getMarkImage?: (id: string) => string | null,
): string {
  return typeof mark?.presentation?.icon === 'string' ? officialAssetUrl(mark.presentation.icon) : unknownPet
}
export function resolveSkillSfxUrl(
  skill: SkillSchemaType | undefined,
  _getSkillSound?: (id: string) => string | null,
): string {
  return typeof skill?.presentation?.sfx === 'string' ? officialAssetUrl(skill.presentation.sfx) : ''
}
export function resolveSpeciesSpriteAsset(
  species: SpeciesSchemaType | undefined,
  _getPetSwf?: (id: string) => string | null,
): {
  swfNum: number
  customSwfUrl?: string
  customImageUrl?: string
  fallbackImageUrl?: string
} {
  const battle = species?.presentation?.battle
  if (battle && typeof battle.source === 'string')
    return battle.renderer === 'seer2-swf'
      ? {
          swfNum: 0,
          customSwfUrl: officialAssetUrl(battle.source),
          fallbackImageUrl: typeof battle.fallback === 'string' ? officialAssetUrl(battle.fallback) : undefined,
        }
      : { swfNum: 0, customImageUrl: officialAssetUrl(battle.source) }
  return { swfNum: 0, customImageUrl: resolveSpeciesPortraitUrl(species) }
}
export function resolveSpeciesPortraitUrl(species: SpeciesSchemaType | undefined): string {
  return typeof species?.presentation?.portrait === 'string'
    ? officialAssetUrl(species.presentation.portrait)
    : unknownPet
}
export function resolveSpeciesIconUrl(species: Partial<SpeciesSchemaType> | undefined): string {
  return typeof species?.presentation?.icon === 'string' ? officialAssetUrl(species.presentation.icon) : unknownPet
}
