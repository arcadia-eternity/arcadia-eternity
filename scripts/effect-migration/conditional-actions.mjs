import { pathToFileURL } from 'node:url'
import { classifySequence, generateSequences } from './sequence-candidates.mjs'
const profile = {
  slug: 'conditional-actions',
  singleAction: true,
  optionalCondition: true,
  actionTypes: ['conditional'],
  markDependencies: true,
  conditionParameters: true,
  dependenciesExport: 'generatedConditionalActionDependencies',
  triggers: ['OnBeforeCalculateDamage', 'OnHit', 'AfterUseSkillCheck', 'BeforeHit'],
  damageTriggers: ['OnBeforeCalculateDamage', 'OnDamage'],
  parameters: true,
  exportName: 'generatedConditionalActions',
  factory: 'createGeneratedConditionalActions',
  comment: 'Candidates only; production admission requires lifecycle and full-game evidence.',
}
export const classifyConditionalActions = original => classifySequence(original, profile)
export const generateConditionalActions = options => generateSequences(profile, options)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).some(a => a !== '--check')) throw new Error('Only --check supported')
  console.log(JSON.stringify(await generateConditionalActions({ check: process.argv.includes('--check') })))
}
