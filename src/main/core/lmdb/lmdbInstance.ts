import { app } from 'electron'
import { ensureLocalLayout } from '../appData/appDataPaths'
import LmdbDatabase from './index'

// 启动时只打开一个固定的本地 LMDB 环境，不再解析账号或旧数据布局。
const layout = ensureLocalLayout()
const lmdbInstance = new LmdbDatabase({
  path: layout.localLmdbPath,
  maxDbs: 3
})

console.log('[LMDB] local storage initialized', { path: layout.localLmdbPath })

export default lmdbInstance

/**
 * 关闭单一本地 LMDB 环境。
 * @returns 无返回值。
 */
export function closeLmdb(): void {
  try {
    lmdbInstance.close()
    console.log('[LMDB] local storage closed successfully')
  } catch (error) {
    console.error('[LMDB] error closing local storage:', error)
  }
}

app.on('will-quit', closeLmdb)
