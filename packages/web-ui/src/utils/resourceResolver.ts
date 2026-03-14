import type { MarkSchemaType, SkillSchemaType, SpeciesSchemaType } from '@arcadia-eternity/schema'

const MARK_ICON_FALLBACK = 'https://seer2-resource.yuuinih.com/png/traitMark/inc.png'
const SKILL_SFX_FALLBACK = 'https://seer2-resource.yuuinih.com/sound/skill/01_1_003.mp3'
const PET_IMAGE_FALLBACK = 'https://seer2-resource.yuuinih.com/png/pet/unknown.png'

function isHttpUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://')
}

function isProtocolUrl(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)
}

export function resolveMarkIconUrl(
  mark: MarkSchemaType | undefined,
  getMarkImage: (id: string) => string | null,
): string {
  if (!mark) return MARK_ICON_FALLBACK
  if (mark.iconRef) {
    if (isHttpUrl(mark.iconRef) || isProtocolUrl(mark.iconRef)) return mark.iconRef
    const mapped = getMarkImage(mark.iconRef)
    if (mapped) return mapped
  }
  const byId = getMarkImage(mark.id)
  if (byId) return byId
  if (mark.tags?.includes('ability')) {
    return 'https://seer2-resource.yuuinih.com/png/markImage/ability.png'
  }
  if (mark.tags?.includes('emblem')) {
    return 'https://seer2-resource.yuuinih.com/png/markImage/emblem.png'
  }
  return MARK_ICON_FALLBACK
}

export function resolveSkillSfxUrl(
  skill: SkillSchemaType | undefined,
  getSkillSound: (id: string) => string | null,
): string {
  if (!skill) return SKILL_SFX_FALLBACK
  if (skill.sfxRef) {
    if (isHttpUrl(skill.sfxRef) || isProtocolUrl(skill.sfxRef)) return skill.sfxRef
    const mapped = getSkillSound(skill.sfxRef)
    if (mapped) return mapped
  }
  return getSkillSound(skill.id) ?? SKILL_SFX_FALLBACK
}

export function resolveSpeciesSpriteAsset(
  species: SpeciesSchemaType | undefined,
  getPetSwf?: (id: string) => string | null,
): {
  swfNum: number
  customSwfUrl?: string
  customImageUrl?: string
} {
  if (!species) return { swfNum: 0 }
  if (species.assetRef) {
    if (isProtocolUrl(species.assetRef)) {
      const lower = species.assetRef.toLowerCase()
      if (lower.endsWith('.swf')) {
        return { swfNum: species.num ?? 0, customSwfUrl: species.assetRef }
      }
      return { swfNum: species.num ?? 0, customImageUrl: species.assetRef }
    }
    if (getPetSwf) {
      const mapped = getPetSwf(species.assetRef)
      if (mapped) {
        return { swfNum: species.num ?? 0, customSwfUrl: mapped }
      }
    }
  }
  return { swfNum: species.num ?? 0 }
}

export function resolveSpeciesPortraitUrl(species: SpeciesSchemaType | undefined): string {
  if (!species) return PET_IMAGE_FALLBACK
  if (species.assetRef && isHttpUrl(species.assetRef)) return species.assetRef
  if (typeof species.num === 'number' && species.num > 0) {
    return `https://seer2-resource.yuuinih.com/png/pet/${species.num}.png`
  }
  return PET_IMAGE_FALLBACK
}
