import { pathToFileURL } from 'node:url'
import { classifySequence, generateSequences } from './sequence-candidates.mjs'
const profile = {
  slug: 'rage-assignment',
  singleAction: true,
  selectorNamesCompatible: true,
  domain: 'skill',
  triggerDomains: { OnSwitchOut: 'switch' },
  actionTypes: ['setRage'],
  triggers: ['OnHit', 'TurnStart', 'OnSwitchOut'],
  triggerLists: [['OnRageGain', 'OnRageLoss', 'OnBattleStart']],
  exportName: 'generatedRageAssignment',
  factory: 'createGeneratedRageAssignment',
  comment: 'Historical rage assignment candidates; rage event lifecycle acceptance remains pending.',
}
export const classifyRageAssignment = d => classifySequence(d, profile)
export const generateRageAssignment = options => generateSequences(profile, options)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).some(a => a !== '--check')) throw new Error('Only --check supported')
  console.log(JSON.stringify(await generateRageAssignment({ check: process.argv.includes('--check') })))
}
