import { pathToFileURL } from 'node:url'
import { classifySequence, generateSequences } from './sequence-candidates.mjs'
const profile = {
  slug: 'damage-thresholds',
  singleAction: true,
  optionalCondition: true,
  actionTypes: ['addThreshold'],
  triggers: ['OnBeforeCalculateDamage', 'OnDamage'],
  damageTriggers: ['OnBeforeCalculateDamage', 'OnDamage'],
  parameters: true,
  exportName: 'generatedDamageThresholds',
  factory: 'createGeneratedDamageThresholds',
  comment: 'Candidates only; production admission requires lifecycle and full-game evidence.',
}
export const classifyDamageThresholds = original => classifySequence(original, profile)
export const generateDamageThresholds = options => generateSequences(profile, options)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).some(a => a !== '--check')) throw new Error('Only --check supported')
  console.log(JSON.stringify(await generateDamageThresholds({ check: process.argv.includes('--check') })))
}
