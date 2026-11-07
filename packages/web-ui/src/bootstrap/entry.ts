import { loadDeploymentConfig } from './deployment'

void loadDeploymentConfig()
  .then(() => import('../main'))
  .catch(error => {
    console.error('Client bootstrap failed:', error)
    const container = document.getElementById('app')
    if (!container) return
    const message = document.createElement('main')
    message.setAttribute('role', 'alert')
    message.style.cssText = 'max-width:40rem;margin:12vh auto;padding:2rem;font:1rem/1.6 system-ui'
    message.textContent = `无法启动网页：${error instanceof Error ? error.message : String(error)}。请联系站点管理员。`
    container.replaceChildren(message)
  })
