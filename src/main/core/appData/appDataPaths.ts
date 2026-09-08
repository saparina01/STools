import fs from 'fs'
import os from 'os'
import path from 'path'

export interface AppDataPathOptions {
  dataRoot?: string
  homeDir?: string
}

export interface ZToolsDataLayout {
  root: string
  lmdbRoot: string
  localLmdbPath: string
  pluginsPath: string
  assetsPath: string
  clipboardPath: string
  extendsPath: string
  tempPath: string
  logsPath: string
}

/**
 * 解析 ZTools 本地数据根目录。
 * @param options 测试或特殊运行环境使用的路径覆盖项。
 * @returns 数据根目录绝对路径。
 */
export function getZToolsRoot(options: AppDataPathOptions = {}): string {
  return (
    options.dataRoot ||
    process.env.ZTOOLS_DATA_ROOT ||
    path.join(options.homeDir || os.homedir(), '.ztools')
  )
}

/**
 * 解析单一 LMDB 环境路径。
 * @param options 路径覆盖项。
 * @returns `.ztools/lmdb/local` 绝对路径。
 */
export function getLocalLmdbPath(options: AppDataPathOptions = {}): string {
  return path.join(getZToolsRoot(options), 'lmdb', 'local')
}

/**
 * 解析插件安装目录。
 * @param options 路径覆盖项。
 * @returns 插件目录。
 */
export function getPluginsPath(options: AppDataPathOptions = {}): string {
  return path.join(getZToolsRoot(options), 'plugins')
}

/**
 * 解析本地托管资源目录。
 * @param options 路径覆盖项。
 * @returns 托管资源目录。
 */
export function getAssetsPath(options: AppDataPathOptions = {}): string {
  return path.join(getZToolsRoot(options), 'assets')
}

/**
 * 解析剪贴板资源目录。
 * @param options 路径覆盖项。
 * @returns 剪贴板资源目录。
 */
export function getClipboardPath(options: AppDataPathOptions = {}): string {
  return path.join(getZToolsRoot(options), 'clipboard')
}

/**
 * 解析扩展资源目录。
 * @param options 路径覆盖项。
 * @returns 扩展资源目录。
 */
export function getExtendsPath(options: AppDataPathOptions = {}): string {
  return path.join(getZToolsRoot(options), 'extends')
}

/**
 * 解析临时目录。
 * @param options 路径覆盖项。
 * @returns 临时目录。
 */
export function getTempPath(options: AppDataPathOptions = {}): string {
  return path.join(getZToolsRoot(options), 'temp')
}

/**
 * 解析日志目录。
 * @param options 路径覆盖项。
 * @returns 日志目录。
 */
export function getLogsPath(options: AppDataPathOptions = {}): string {
  return path.join(getZToolsRoot(options), 'logs')
}

/**
 * 构造单机数据布局。
 * @param options 路径覆盖项。
 * @returns 所有本地数据目录。
 */
export function getZToolsDataLayout(options: AppDataPathOptions = {}): ZToolsDataLayout {
  const root = getZToolsRoot(options)
  return {
    root,
    lmdbRoot: path.join(root, 'lmdb'),
    localLmdbPath: getLocalLmdbPath(options),
    pluginsPath: getPluginsPath(options),
    assetsPath: getAssetsPath(options),
    clipboardPath: getClipboardPath(options),
    extendsPath: getExtendsPath(options),
    tempPath: getTempPath(options),
    logsPath: getLogsPath(options)
  }
}

/**
 * 创建单机运行所需的目录。
 * @param options 路径覆盖项。
 * @returns 已创建的数据布局。
 */
export function ensureLocalLayout(options: AppDataPathOptions = {}): ZToolsDataLayout {
  const layout = getZToolsDataLayout(options)
  for (const directory of [
    layout.localLmdbPath,
    layout.pluginsPath,
    layout.assetsPath,
    layout.clipboardPath,
    layout.extendsPath,
    layout.tempPath,
    layout.logsPath
  ]) {
    fs.mkdirSync(directory, { recursive: true })
  }
  return layout
}
