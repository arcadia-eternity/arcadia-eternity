import { pathToFileURL } from 'node:url'
import { classifySequence, generateSequences } from './sequence-candidates.mjs'
const profile = {
  slug: 'mark-stack-gains',
  singleAction: true,
  optionalCondition: true,
  actionTypes: ['addStacks'],
  triggers: ['TurnEnd', 'OnDamage'],
  exportName: 'generatedMarkStackGains',
  factory: 'createGeneratedMarkStackGains',
  comment: 'Candidates only; production admission requires lifecycle and full-game evidence.',
}
export const classifyMarkStackGains = original => classifySequence(original, profile)
export const generateMarkStackGains = options => generateSequences(profile, options)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).some(a => a !== '--check')) throw new Error('Only --check supported')
  console.log(JSON.stringify(await generateMarkStackGains({ check: process.argv.includes('--check') })))
}
