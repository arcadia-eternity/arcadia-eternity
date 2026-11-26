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
export function resolveSkillVfxUrl(skill: SkillSchemaType | undefined): string {
  return typeof skill?.presentation?.vfx === 'string' ? officialAssetUrl(skill.presentation.vfx) : ''
}
export function resolveSpeciesSpriteAsset(
  species: SpeciesSchemaType | undefined,
  _getPetSwf?: (id: string) => string | null,
): {
  customSwfUrl?: string
  customImageUrl?: string
  fallbackImageUrl?: string
} {
  const battle = species?.presentation?.battle
  if (battle && typeof battle.source === 'string')
    return battle.renderer === 'seer2-swf'
      ? {
          customSwfUrl: officialAssetUrl(battle.source),
          fallbackImageUrl:
            typeof battle.fallback === 'string'
              ? officialAssetUrl(battle.fallback)
              : typeof species?.presentation?.portrait === 'string'
                ? officialAssetUrl(species.presentation.portrait)
                : undefined,
        }
      : { customImageUrl: officialAssetUrl(battle.source) }
  return { customImageUrl: resolveSpeciesPortraitUrl(species) }
}
export function resolveSpeciesPortraitUrl(species: SpeciesSchemaType | undefined): string {
  return typeof species?.presentation?.portrait === 'string'
    ? officialAssetUrl(species.presentation.portrait)
    : unknownPet
}
