import type { ArcadiaDesktopApi } from '@/types/desktop'

/** Explicit local transport: remote management never acquires a desktop bridge. */
export function createLocalContentLibraryClient(api: ArcadiaDesktopApi | undefined) {
  if (!api?.listContentPackages || !api.contentPackageAction) return undefined
  return {
    list: () => api.listContentPackages!(),
    action: api.contentPackageAction.bind(api),
    installFile: (options: { offline?: boolean }) => api.installContentPackageFile?.(options) ?? Promise.resolve(null),
    installNpm: (options: { spec: string; offline?: boolean }) => {
      if (!api.installNpmContentPackage) throw new Error('此客户端不支持 npm 内容获取')
      return api.installNpmContentPackage(options)
    },
  }
}
