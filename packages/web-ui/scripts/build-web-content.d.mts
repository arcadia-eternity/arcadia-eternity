export function buildWebContent(root?: string): Promise<{
  files: Map<string, string>
  mediaTargets: { src: string; dest: string }[]
}>
