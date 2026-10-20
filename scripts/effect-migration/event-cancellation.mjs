import { pathToFileURL } from 'node:url'
import { classifySequence, generateSequences } from './sequence-candidates.mjs'
const profile = {
  slug: 'event-cancellation',
  domain: 'mark',
  singleAction: true,
  actionTypes: ['disableContext'],
  triggers: ['OnBeforeAddMark', 'BeforeEffect'],
  exportName: 'generatedEventCancellation',
  factory: 'createGeneratedEventCancellation',
  comment: 'Candidates only; production admission requires lifecycle and full-game evidence.',
}
export const classifyEventCancellation = original => classifySequence(original, profile)
export const generateEventCancellation = options => generateSequences(profile, options)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).some(a => a !== '--check')) throw new Error('Only --check supported')
  console.log(JSON.stringify(await generateEventCancellation({ check: process.argv.includes('--check') })))
}
