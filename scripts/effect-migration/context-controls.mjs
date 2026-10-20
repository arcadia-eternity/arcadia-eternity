import { pathToFileURL } from 'node:url'
import { classifySequence, generateSequences } from './sequence-candidates.mjs'
const profile = {
  slug: 'context-controls',
  singleAction: true,
  optionalCondition: true,
  actionTypes: ['preventDamage', 'setActualTarget', 'setIgnoreStageStrategy'],
  triggers: ['OnBeforeCalculateDamage', 'OnDamage', 'AfterUseSkillCheck', 'BeforeHit'],
  damageTriggers: ['OnBeforeCalculateDamage', 'OnDamage'],
  parameters: true,
  exportName: 'generatedContextControls',
  factory: 'createGeneratedContextControls',
  comment: 'Candidates only; production admission requires lifecycle and full-game evidence.',
}
export const classifyContextControls = original => classifySequence(original, profile)
export const generateContextControls = options => generateSequences(profile, options)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).some(a => a !== '--check')) throw new Error('Only --check supported')
  console.log(JSON.stringify(await generateContextControls({ check: process.argv.includes('--check') })))
}
