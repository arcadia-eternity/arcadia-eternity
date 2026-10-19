import { pathToFileURL } from 'node:url'
import { classifySequence, generateSequences } from './sequence-candidates.mjs'
const profile = {
  slug: 'damage-sequences',
  actionTypes: ['addModified', 'preventDamage'],
  // Lists containing these actions are owned by the vital-sequences catalog.
  excludeActionTypes: ['heal', 'dealDamage', 'addRage'],
  domain: 'damage',
  triggers: ['OnBeforeCalculateDamage', 'OnDamage', 'PostDamage'],
  exportName: 'generatedDamageSequences',
  factory: 'createGeneratedDamageSequences',
  parameters: true,
  comment: 'Candidates only; vital action lists are owned by vital-sequences.',
}
export const classifyDamageSequence = original => classifySequence(original, profile)
export const generateDamageSequences = options => generateSequences(profile, options)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).some(a => a !== '--check')) throw new Error('Only --check supported')
  console.log(JSON.stringify(await generateDamageSequences({ check: process.argv.includes('--check') })))
}
