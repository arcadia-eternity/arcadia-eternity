import { pathToFileURL } from 'node:url'
import { classifySequence, generateSequences } from './sequence-candidates.mjs'
const profile = {
  slug: 'vital-sequences',
  actionTypes: ['heal', 'dealDamage', 'addRage'],
  triggers: ['OnHit', 'TurnEnd', 'OnDamage', 'PostDamage', 'OnBeforeCalculateDamage', 'OnStack'],
  exportName: 'generatedVitalSequences',
  factory: 'createGeneratedVitalSequences',
  parameters: true,
  comment: 'Candidates only.',
}
export const classifyVitalSequence = original => classifySequence(original, profile)
export const generateVitalSequences = options => generateSequences(profile, options)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).some(a => a !== '--check')) throw new Error('Only --check supported')
  console.log(JSON.stringify(await generateVitalSequences({ check: process.argv.includes('--check') })))
}
