import { pathToFileURL } from 'node:url'
import { classifySequence, generateSequences } from './sequence-candidates.mjs'
const profile = {
  slug: 'stat-stage-clears',
  singleAction: true,
  optionalCondition: true,
  actionTypes: ['clearStatStage', 'reverseStatStage'],
  triggers: ['BeforeHit', 'OnMiss'],
  triggerLists: [['BeforeHit', 'OnMiss']],
  exportName: 'generatedStatStageClears',
  factory: 'createGeneratedStatStageClears',
  comment: 'Candidates only; production admission requires lifecycle and full-game evidence.',
}
export const classifyStatStageClears = original => classifySequence(original, profile)
export const generateStatStageClears = options => generateSequences(profile, options)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).some(a => a !== '--check')) throw new Error('Only --check supported')
  console.log(JSON.stringify(await generateStatStageClears({ check: process.argv.includes('--check') })))
}
