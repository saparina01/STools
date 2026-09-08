import type { HttpResponse } from '../../utils/httpRequest'
import { httpGet } from '../../utils/httpRequest.js'

export const DEFAULT_PLUGIN_MARKET_API_BASE = 'https://z-tools.top/api/market'

/**
 * 返回匿名只读插件仓库地址。
 * @returns 官方插件仓库 API 根地址。
 */
export function getPluginMarketApiBase(): string {
  return DEFAULT_PLUGIN_MARKET_API_BASE
}

/**
 * 向官方插件仓库发起匿名 GET 请求。
 * @param requestPath 仓库根地址下的相对路径，或同一仓库内的完整 URL。
 * @returns 插件仓库响应。
 * @throws 路径越出官方仓库或请求失败时抛出错误。
 */
export async function requestPluginMarket(requestPath: string): Promise<HttpResponse> {
  const marketApiBase = getPluginMarketApiBase()
  const url =
    requestPath.startsWith('http://') || requestPath.startsWith('https://')
      ? new URL(requestPath)
      : new URL(`${marketApiBase}${requestPath.startsWith('/') ? '' : '/'}${requestPath}`)
  const allowedBase = new URL(`${marketApiBase}/`)

  // 仓库客户端只能访问固定官方根路径，不能被下载元数据改写为任意请求器。
  if (url.origin !== allowedBase.origin || !url.pathname.startsWith(allowedBase.pathname)) {
    throw new Error('插件仓库请求地址超出允许范围')
  }

  // 仓库请求只使用通用 GET 客户端，不附加调用方上下文或自定义请求头。
  return httpGet(url.toString())
}
