import { app, ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import databaseAPI from '../shared/database'

const INSTALLATION_ID_KEY = 'installation-id'

/**
 * 向插件公开本地安装实例与应用版本信息。
 */
export class PluginDeviceAPI {
  private installationId: string | null = null

  /**
   * 注册设备信息相关的同步 IPC。
   * @returns 无返回值
   */
  public init(): void {
    this.setupIPC()
  }

  /**
   * 注册插件可调用的本地安装 ID 与应用版本 IPC。
   * @returns 无返回值
   */
  private setupIPC(): void {
    // 安装 ID 只从本地数据库读取或生成，不派生自硬件及系统账号。
    ipcMain.on('get-native-id', (event) => {
      try {
        event.returnValue = this.getInstallationId()
      } catch (error) {
        console.error('[PluginDevice] get-native-id error:', error)
        event.returnValue = null
      }
    })

    ipcMain.on('get-app-version', (event) => {
      try {
        event.returnValue = app.getVersion()
      } catch (error) {
        console.error('[PluginDevice] get-app-version error:', error)
        event.returnValue = null
      }
    })
  }

  /**
   * 获取或创建仅在当前安装数据目录内持久化的随机实例 ID。
   * @returns 稳定的 UUID 格式安装实例 ID
   * @throws 当本地数据库无法读取或写入安装 ID 时抛出错误
   */
  private getInstallationId(): string {
    if (this.installationId) return this.installationId

    // 先复用本地已有值，保证应用重启后保持稳定。
    const stored = databaseAPI.dbGet(INSTALLATION_ID_KEY)
    if (typeof stored === 'string' && stored.trim()) {
      this.installationId = stored
      return stored
    }

    // 首次使用时生成随机值，并在返回前完成持久化。
    const installationId = randomUUID()
    const result = databaseAPI.dbPut(INSTALLATION_ID_KEY, installationId)
    if (!result?.ok) {
      throw new Error('无法保存本地安装实例 ID')
    }
    this.installationId = installationId
    return installationId
  }
}

export default new PluginDeviceAPI()
