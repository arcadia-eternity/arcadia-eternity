/** Stable task codes are shared by local IPC and authenticated server operations. */
export function contentTaskError(value: unknown): string {
  const detail = value && typeof value === 'object' ? (value as { code?: unknown; message?: unknown }) : undefined
  const code = typeof detail?.code === 'string' ? detail.code : typeof value === 'string' ? value : ''
  const messages: Record<string, string> = {
    NPM_BASE_HOST_INVALID: '此环境的内容包与当前服务器版本不兼容。请使用适配当前服务器的内容包重新准备并发布环境。',
    ENVIRONMENT_CONTENT_MISMATCH: '此环境的内容校验与保存版本不一致。请重新准备并发布环境。',
    ENVIRONMENT_UNAVAILABLE: '环境加载失败。请检查内容包和已准备版本后重新发布。',
    ENVIRONMENT_DEPENDENCY_CONFLICT: '依赖版本范围不兼容。请调整资源包组合或版本范围后重试；已有固定版本保持不变。',
    CONTENT_VERSION_CONFLICT: '同一资源包出现了多个版本。请选择兼容的组合后重试。',
    ENVIRONMENT_DEPENDENCIES_UNRESOLVED: '请先准备当前组合，确认完整依赖关系后再停用。',
    ENVIRONMENT_PACKAGE_REQUIRED: '其他资源包仍依赖它，请查看依赖关系或选择连带停用。',
    NPM_INSTALL_FAILED: '下载或安装失败。请检查来源、网络与离线缓存后重试。',
    REVISION_CONFLICT: '环境草稿已更改，请从当前草稿发起新任务。',
  }
  return (
    messages[code] ?? (typeof detail?.message === 'string' ? detail.message : typeof value === 'string' ? value : '')
  )
}
