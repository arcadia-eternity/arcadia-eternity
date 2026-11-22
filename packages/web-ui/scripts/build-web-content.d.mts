export type BaseBattleUi = Record<string, { id: string; source: string; sha256: string }>
export function readBaseBattleUi(root?: string): Promise<BaseBattleUi>
export function buildWebContent(
  root?: string,
  projectDirectory?: string,
): Promise<{
  battleUi: BaseBattleUi
  files: Map<string, string>
  mediaTargets: { src: string; dest: string }[]
  dispose(): Promise<void> | undefined
}>
