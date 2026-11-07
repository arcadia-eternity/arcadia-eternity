export function buildWebContent(
  root?: string,
  projectDirectory?: string,
): Promise<{
  files: Map<string, string>
  mediaTargets: { src: string; dest: string }[]
  dispose(): Promise<void> | undefined
}>
