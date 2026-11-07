import type { ProjectTeam, ProjectTeamDraft, ProjectTeamStorage } from '@/components/team/library'

/** A browser edits the captured library; only the desktop owns project file writes. */
export function createBrowserTeamStorage(teams: ProjectTeam[], draftKey: string): ProjectTeamStorage {
  const key = `arcadia:author-project-draft:${draftKey}`
  return {
    async list() {
      return structuredClone(teams)
    },
    async readDraft() {
      return JSON.parse(localStorage.getItem(key) ?? 'null') as ProjectTeamDraft | null
    },
    async writeDraft(draft) {
      localStorage.setItem(key, JSON.stringify(draft))
    },
  }
}
