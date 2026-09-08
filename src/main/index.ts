import { app } from 'electron'
import './core/appData/configureAppDataRoot'

if (process.platform === 'win32') app.setAppUserModelId('top.z-tools')

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.exit(0)
} else {
  void import('./appMain').catch((error) => {
    console.error('[Bootstrap] 加载主程序失败:', error)
    app.exit(1)
  })
}
