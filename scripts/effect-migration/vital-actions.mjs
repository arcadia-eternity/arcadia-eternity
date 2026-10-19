import { pathToFileURL } from 'node:url'
import { classifySequence, generateSequences } from './sequence-candidates.mjs'
const profile = {
  slug: 'vital-actions',
  singleAction: true,
  actionTypes: ['heal', 'dealDamage', 'addRage'],
  triggers: ['OnHit', 'OnMiss', 'BeforeHit', 'TurnEnd', 'OnDamage', 'PostDamage', 'OnDefeat'],
  retainedLedgers: [
    'instant-literals-candidates',
    'official-healing-candidates',
    'official-rage-candidate',
    'consecutive-healing-candidates',
    'damage-benefits-candidates',
  ].map(name => `docs/v4/validation/${name}.json`),
  exportName: 'generatedVitalActions',
  factory: 'createGeneratedVitalActions',
  parameters: true,
  comment: 'Candidates only; prior handwritten and literal candidates retain ownership.',
}
export const classifyVitalAction = original => classifySequence(original, profile)
export const generateVitalActions = options => generateSequences(profile, options)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).some(a => a !== '--check')) throw new Error('Only --check supported')
  console.log(JSON.stringify(await generateVitalActions({ check: process.argv.includes('--check') })))
}
