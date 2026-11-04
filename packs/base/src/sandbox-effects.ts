import { createOfficialEffectCandidates } from './effects/candidate-catalog'
import { createOfficialTemplateRegistrations } from './templates'
import type { CodeEffectModuleContext } from '@arcadia-eternity/battle/v4/authoring'

export const createCatalog = createOfficialEffectCandidates
export function createEffects({ marks }: CodeEffectModuleContext) {
  return createOfficialTemplateRegistrations({ marks }).nativeExports
}
