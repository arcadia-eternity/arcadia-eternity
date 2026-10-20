import { pathToFileURL } from 'node:url'
import { classifySequence, generateSequences } from './sequence-candidates.mjs'
const profile = {
  slug: 'ignore-shield',
  singleAction: true,
  selectorNamesCompatible: true,
  domain: 'skill',
  actionTypes: ['setIgnoreShield'],
  triggers: ['AfterUseSkillCheck'],
  exportName: 'generatedIgnoreShield',
  factory: 'createGeneratedIgnoreShield',
  comment: 'Historical shield-bypass candidate; production admission remains separate.',
}
export const classifyIgnoreShield = d => classifySequence(d, profile)
export const generateIgnoreShield = options => generateSequences(profile, options)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).some(a => a !== '--check')) throw new Error('Only --check supported')
  console.log(JSON.stringify(await generateIgnoreShield({ check: process.argv.includes('--check') })))
}
