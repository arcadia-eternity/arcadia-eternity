import { readSharedTeam } from '@arcadia-eternity/local-profile'
import { parse } from 'yaml'

/** Read a portable team independently of personal storage or an active room. */
export async function chooseTeamFile() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json,.yaml,.yml'
  const file = await new Promise<File | undefined>(resolve => {
    input.onchange = () => resolve(input.files?.[0])
    input.oncancel = () => resolve(undefined)
    input.click()
  })
  if (!file) return
  const data = parse(await file.text(), { strict: true, maxAliasCount: 100 })
  return readSharedTeam(data, file.name)
}
