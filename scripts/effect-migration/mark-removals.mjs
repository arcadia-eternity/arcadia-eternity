import { pathToFileURL } from 'node:url'
import { classifySequence, generateSequences } from './sequence-candidates.mjs'
const profile = {
  slug: 'mark-removals',
  singleAction: true,
  optionalCondition: true,
  actionTypes: ['destroyMark'],
  triggers: ['TurnEnd', 'PostDamage', 'OnCritPostDamage', 'OnHit', 'OnMiss'],
  damageTriggers: ['PostDamage', 'OnCritPostDamage'],
  triggerLists: [['OnHit', 'OnMiss']],
  exportName: 'generatedMarkRemovals',
  factory: 'createGeneratedMarkRemovals',
  comment: 'Candidates only; production admission requires lifecycle and full-game evidence.',
}
export const classifyMarkRemoval = original => classifySequence(original, profile)
export const generateMarkRemovals = options => generateSequences(profile, options)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).some(a => a !== '--check')) throw new Error('Only --check supported')
  console.log(JSON.stringify(await generateMarkRemovals({ check: process.argv.includes('--check') })))
}
