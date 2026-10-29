import { isRemoteContentActive } from '@/i18n/serverContent'
import { officialAssetUrl } from '@/utils/officialAssetUrl'
import unknownPet from '@/assets/images/unknown-pet.svg'
import type { MarkSchemaType, SkillSchemaType, SpeciesSchemaType } from '@arcadia-eternity/schema'

const MARK_ICON_FALLBACK = officialAssetUrl('https://seer2-resource.yuuinih.com/png/traitMark/inc.png')
const SKILL_SFX_FALLBACK = officialAssetUrl('https://seer2-resource.yuuinih.com/sound/skill/01_1_003.mp3')
const PET_IMAGE_FALLBACK = unknownPet

function isHttpUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://')
}

function isProtocolUrl(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)
}

function resolveRuntimeAssetUrl(value: string): string {
  const normalizedPath = value.replace(/^\.?\//, '')
  const runtimeBase = (globalThis as typeof globalThis & { __ARCADIA_ASSET_BASE__?: string }).__ARCADIA_ASSET_BASE__
  const base = (runtimeBase ?? import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '')
  if (!base) return `/${normalizedPath}`
  return `${base}/${normalizedPath}`
}

export function resolveMarkIconUrl(
  mark: Partial<MarkSchemaType> | undefined,
  getMarkImage: (id: string) => string | null,
): string {
  if (isRemoteContentActive())
    return typeof mark?.presentation?.icon === 'string'
      ? mark.presentation.icon
      : mark?.iconRef && isHttpUrl(mark.iconRef)
        ? mark.iconRef
        : PET_IMAGE_FALLBACK
  if (!mark) return MARK_ICON_FALLBACK
  if (typeof mark.presentation?.icon === 'string') return mark.presentation.icon
  if (mark.iconRef) {
    if (isHttpUrl(mark.iconRef) || isProtocolUrl(mark.iconRef)) return officialAssetUrl(mark.iconRef)
    const mapped = getMarkImage(mark.iconRef)
    if (mapped) return mapped
    return resolveRuntimeAssetUrl(mark.iconRef)
  }
  const markId = typeof mark.id === 'string' ? mark.id.trim() : ''
  if (markId) {
    const byId = getMarkImage(markId)
    if (byId) return byId
  }
  if (mark.tags?.includes('ability')) {
    return officialAssetUrl('https://seer2-resource.yuuinih.com/png/markImage/ability.png')
  }
  if (mark.tags?.includes('emblem')) {
    return officialAssetUrl('https://seer2-resource.yuuinih.com/png/markImage/emblem.png')
  }
  return MARK_ICON_FALLBACK
}

export function resolveSkillSfxUrl(
  skill: SkillSchemaType | undefined,
  getSkillSound: (id: string) => string | null,
): string {
  if (isRemoteContentActive())
    return typeof skill?.presentation?.sfx === 'string'
      ? skill.presentation.sfx
      : skill?.sfxRef && isHttpUrl(skill.sfxRef)
        ? skill.sfxRef
        : ''
  if (!skill) return SKILL_SFX_FALLBACK
  if (typeof skill.presentation?.sfx === 'string') return skill.presentation.sfx
  if (skill.sfxRef) {
    if (isHttpUrl(skill.sfxRef) || isProtocolUrl(skill.sfxRef)) return officialAssetUrl(skill.sfxRef)
    const mapped = getSkillSound(skill.sfxRef)
    if (mapped) return mapped
    return resolveRuntimeAssetUrl(skill.sfxRef)
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
  fallbackImageUrl?: string
} {
  if (!species) return { swfNum: 0 }
  const battle = species.presentation?.battle
  if (battle && typeof battle.source === 'string') {
    return battle.renderer === 'seer2-swf'
      ? {
          swfNum: 0,
          customSwfUrl: battle.source,
          fallbackImageUrl: typeof battle.fallback === 'string' ? battle.fallback : undefined,
        }
      : { swfNum: 0, customImageUrl: battle.source }
  }
  if (isRemoteContentActive()) {
    if (species.assetRef && isHttpUrl(species.assetRef))
      return species.assetRef.toLowerCase().endsWith('.swf')
        ? { swfNum: 0, customSwfUrl: species.assetRef }
        : { swfNum: 0, customImageUrl: species.assetRef }
    return typeof species.presentation?.portrait === 'string'
      ? { swfNum: 0, customImageUrl: species.presentation.portrait }
      : { swfNum: 0 }
  }
  if (species.assetRef) {
    if (isProtocolUrl(species.assetRef)) {
      const lower = species.assetRef.toLowerCase()
      if (lower.endsWith('.swf')) {
        return { swfNum: species.num ?? 0, customSwfUrl: officialAssetUrl(species.assetRef) }
      }
      return { swfNum: species.num ?? 0, customImageUrl: officialAssetUrl(species.assetRef) }
    }
    if (getPetSwf) {
      const mapped = getPetSwf(species.assetRef)
      if (mapped) {
        return { swfNum: species.num ?? 0, customSwfUrl: mapped }
      }
    }
    const lower = species.assetRef.toLowerCase()
    if (lower.endsWith('.swf')) {
      return { swfNum: species.num ?? 0, customSwfUrl: resolveRuntimeAssetUrl(species.assetRef) }
    }
    return { swfNum: species.num ?? 0, customImageUrl: resolveRuntimeAssetUrl(species.assetRef) }
  }
  return { swfNum: species.num ?? 0 }
}

export function resolveSpeciesPortraitUrl(species: SpeciesSchemaType | undefined): string {
  if (!species) return PET_IMAGE_FALLBACK
  if (typeof species.presentation?.portrait === 'string') return species.presentation.portrait
  if (isRemoteContentActive())
    return species.assetRef && isHttpUrl(species.assetRef) ? species.assetRef : PET_IMAGE_FALLBACK
  if (species.assetRef && isHttpUrl(species.assetRef)) return officialAssetUrl(species.assetRef)
  if (species.assetRef && !isProtocolUrl(species.assetRef)) return resolveRuntimeAssetUrl(species.assetRef)
  if (typeof species.num === 'number' && species.num > 0) {
    return officialAssetUrl(`https://seer2-resource.yuuinih.com/png/pet/${species.num}.png`)
  }
  return PET_IMAGE_FALLBACK
}

export function resolveSpeciesIconUrl(species: Partial<SpeciesSchemaType> | undefined): string | undefined {
  if (typeof species?.presentation?.icon === 'string') return species.presentation.icon
  return isRemoteContentActive() ? PET_IMAGE_FALLBACK : undefined
}
