import log from 'electron-log'

/**
 * 日志级别类型
 */
export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'verbose'

/**
 * 日志条目数据结构
 */
export interface LogEntry {
  id: number
  timestamp: number
  level: LogLevel
  source: string
  message: string
}

/**
 * 主进程日志收集器
 * 利用 electron-log hooks 拦截所有日志，缓冲后批量推送给订阅者（设置插件前端）
 */
class LogCollector {
  /** 日志收集全局开关（与前端 WebContents 生命周期解耦） */
  private enabled = false
  private buffer: LogEntry[] = []
  private maxBufferSize = 2000
  private idCounter = 0
  /** 当前接收推送的 WebContents 集合（仅用于 IPC 推送，不影响收集开关） */
  private subscribers: Set<Electron.WebContents> = new Set()
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private pendingEntries: LogEntry[] = []
  private flushIntervalMs = 100

  /**
   * 安装 electron-log hook，应用启动时调用一次
   * hook 不影响原有 transport 管道，仅在启用时收集日志
   */
  install(): void {
    log.hooks.push((message, _transport, transportName) => {
      // 仅拦截 file transport 的日志（避免重复，因为每个 transport 都会触发 hook）
      if (transportName !== 'file') return message

      if (this.enabled) {
        this.collectEntry(message)
      }
      return message
    })
  }

  /**
   * 查询日志收集是否已启用
   */
  isEnabled(): boolean {
    return this.enabled
  }

  /**
   * 启用日志收集（全局开关），并将指定 webContents 加入推送订阅
   */
  enable(webContents: Electron.WebContents): void {
    this.enabled = true
    this.addSubscriber(webContents)
  }

  /**
   * 禁用日志收集（全局开关），并移除指定 webContents 的订阅
   */
  disable(webContents: Electron.WebContents): void {
    this.enabled = false
    this.subscribers.delete(webContents)

    // 清空缓冲区和待推送队列
    this.buffer = []
    this.pendingEntries = []
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
  }

  /**
   * 注册 webContents 为推送订阅者（不影响收集开关）
   * 用于前端重新进入页面时恢复推送
   */
  addSubscriber(webContents: Electron.WebContents): void {
    this.subscribers.add(webContents)
    webContents.once('destroyed', () => {
      this.subscribers.delete(webContents)
    })
  }

  /**
   * 获取缓冲区历史日志
   */
  getBufferedLogs(): LogEntry[] {
    return [...this.buffer]
  }

  /**
   * 收集一条日志
   */
  private collectEntry(message: any): void {
    const level = this.mapLevel(message.level)
    if (!level) return // silly 级别忽略

    const { source, cleanMessage } = this.extractSource(message.data)
    const fullMessage = this.serializeArgs(message.data, cleanMessage)

    const entry: LogEntry = {
      id: ++this.idCounter,
      timestamp: message.date ? message.date.getTime() : Date.now(),
      level,
      source,
      message: fullMessage
    }

    // 环形缓冲
    this.buffer.push(entry)
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer.shift()
    }

    // 加入待推送队列
    this.pendingEntries.push(entry)

    // 启动批量推送定时器
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), this.flushIntervalMs)
    }
  }

  /**
   * 批量推送给所有订阅者
   */
  private flush(): void {
    this.flushTimer = null
    if (this.pendingEntries.length === 0) return

    const maxPerFlush = 200
    const batch = this.pendingEntries.splice(0, maxPerFlush)

    // 如果还有剩余，安排下一次 flush
    if (this.pendingEntries.length > 0) {
      this.flushTimer = setTimeout(() => this.flush(), 16)
    }

    for (const wc of this.subscribers) {
      if (!wc.isDestroyed()) {
        wc.send('log-entries', batch)
      } else {
        this.subscribers.delete(wc)
      }
    }
  }

  /**
   * 映射 electron-log 级别到前端级别
   */
  private mapLevel(level: string): LogLevel | null {
    switch (level) {
      case 'error':
        return 'error'
      case 'warn':
        return 'warn'
      case 'info':
        return 'info'
      case 'verbose':
        return 'verbose'
      case 'debug':
        return 'debug'
      default:
        return null // silly 等忽略
    }
  }

  /**
   * 从日志数据中提取 source 前缀
   * 匹配形如 [Main]、[Plugin] 的已有前缀
   */
  private extractSource(data: any[]): { source: string; cleanMessage: string } {
    const firstArg = data[0]
    if (typeof firstArg === 'string') {
      const match = firstArg.match(/^\[([^\]]+)\]\s*(.*)/)
      if (match) {
        return { source: match[1], cleanMessage: match[2] }
      }
    }
    return { source: 'Main', cleanMessage: '' }
  }

  /**
   * 序列化日志参数为字符串
   */
  private serializeArgs(data: any[], cleanMessage: string): string {
    // 如果提取了 source 前缀，使用 cleanMessage + 剩余参数
    if (cleanMessage) {
      const rest = data.slice(1)
      if (rest.length === 0) return cleanMessage
      return cleanMessage + ' ' + rest.map((arg) => this.stringify(arg)).join(' ')
    }

    // 无前缀，直接序列化全部参数
    return data.map((arg) => this.stringify(arg)).join(' ')
  }

  /**
   * 安全序列化单个参数
   */
  private stringify(arg: any): string {
    if (typeof arg === 'string') return arg
    if (arg instanceof Error) return `${arg.name}: ${arg.message}`
    try {
      const str = JSON.stringify(arg)
      return str && str.length > 500 ? str.substring(0, 500) + '...' : (str ?? String(arg))
    } catch {
      return String(arg)
    }
  }
}

export default new LogCollector()
