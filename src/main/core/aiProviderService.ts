import { randomUUID } from 'node:crypto'
import OpenAI from 'openai'
import databaseAPI from '../api/shared/database.js'
import { HOST_STORAGE_KEYS } from '../../shared/storageKeys.js'
import aiCredentialStore, { type AiCredentialStore } from './aiCredentialStore.js'
import {
  AI_PROVIDER_STORE_VERSION,
  isAiProviderStore,
  normalizeAiApiUrl,
  type AiModelChoice,
  type AiProvider,
  type AiProviderInput,
  type AiProviderModel,
  type AiProviderMutationResult,
  type AiProviderStore,
  type AiRemoteModel
} from '../../shared/aiProviderShared.js'

/** 主进程完成调用时使用的 Provider 连接信息。 */
export interface ResolvedAiProvider {
  id: string
  name: string
  apiUrl: string
  apiKey: string
}

/** 已解析的供应商和模型调用配置。 */
export interface ResolvedAiModel {
  provider: ResolvedAiProvider
  model: AiProviderModel
}

/**
 * 生成兼容插件直接展示和回传的可读模型选择 ID。
 * @param providerName 供应商展示名称
 * @param modelId 供应商接口接收的真实模型 ID
 * @returns 格式为“供应商 - 模型 ID”的公开选择 ID
 */
export function buildAiModelPublicId(providerName: string, modelId: string): string {
  return `${providerName} - ${modelId}`
}

/**
 * 统一管理不含密钥的 AI Provider 配置、独立凭据和远端模型发现。
 */
export class AiProviderService {
  /**
   * 创建 Provider 管理服务。
   * @param credentialStore 独立的本地密钥存储服务
   */
  public constructor(private readonly credentialStore: AiCredentialStore = aiCredentialStore) {}

  /**
   * 读取当前版本的 Provider 文档并刷新密钥状态。
   * @returns 不含任何明文密钥的 Provider 文档
   */
  public getStore(): AiProviderStore {
    const raw = databaseAPI.dbGet(HOST_STORAGE_KEYS.aiModels)
    if (!isAiProviderStore(raw)) {
      // 本轮不导入旧账号或旧版明文 Provider 数据。
      return { version: AI_PROVIDER_STORE_VERSION, providers: [] }
    }

    let changed = this.normalizeProviderStore(raw)
    for (const provider of raw.providers) {
      const storage = this.credentialStore.getStorage(provider.id)
      const hasApiKey = storage !== null
      if (provider.hasApiKey !== hasApiKey || provider.credentialStorage !== storage) {
        provider.hasApiKey = hasApiKey
        provider.credentialStorage = storage
        changed = true
      }
    }
    if (changed) this.saveStore(raw)
    return raw
  }

  /**
   * 新建 Provider 并将密钥保存到独立凭据区。
   * @param input Provider 连接信息和已选模型
   * @returns 操作结果及最新公开 Provider 文档
   */
  public addProvider(input: AiProviderInput): AiProviderMutationResult {
    const validationError = this.validateInput(input, true)
    if (validationError) return { success: false, error: validationError }

    const store = this.getStore()
    const duplicateNameError = this.validateProviderName(store, input.name)
    if (duplicateNameError) return { success: false, error: duplicateNameError }

    const providerId = randomUUID()
    try {
      // 凭据先落盘；配置写入失败时回滚，避免留下孤立密钥。
      const storage = this.credentialStore.set(providerId, input.apiKey!)
      const provider: AiProvider = {
        id: providerId,
        name: input.name.trim(),
        apiUrl: normalizeAiApiUrl(input.apiUrl),
        hasApiKey: true,
        credentialStorage: storage,
        enabled: true,
        selectedModels: this.buildSelectedModels(input, [])
      }
      store.providers.push(provider)
      this.saveStore(store)
      return { success: true, data: store }
    } catch (error) {
      // 回滚失败不得覆盖原始保存错误，但需要留下可诊断日志。
      try {
        this.credentialStore.delete(providerId)
      } catch (rollbackError) {
        console.error('[AI Provider] 清理孤立密钥失败:', rollbackError)
      }
      return { success: false, error: this.getErrorMessage(error, '保存 Provider 失败') }
    }
  }

  /**
   * 更新 Provider；空密钥保留原凭据，非空密钥替换原凭据。
   * @param input 带 Provider ID 的更新数据
   * @returns 操作结果及最新公开 Provider 文档
   */
  public updateProvider(input: AiProviderInput): AiProviderMutationResult {
    const validationError = this.validateInput(input, false)
    if (validationError) return { success: false, error: validationError }
    if (!input.id) return { success: false, error: 'Provider ID 不能为空' }

    const store = this.getStore()
    const index = store.providers.findIndex((provider) => provider.id === input.id)
    if (index === -1) return { success: false, error: '未找到该 Provider' }

    const duplicateNameError = this.validateProviderName(store, input.name, input.id)
    if (duplicateNameError) return { success: false, error: duplicateNameError }

    const previous = store.providers[index]
    let previousCredential
    try {
      previousCredential = this.credentialStore.get(previous.id)
    } catch (error) {
      return { success: false, error: this.getErrorMessage(error, '读取已保存密钥失败') }
    }
    const replacementKey = input.apiKey?.trim() || ''
    if (!replacementKey && !previousCredential) {
      return { success: false, error: '当前 Provider 没有可保留的密钥，请输入 API 密钥' }
    }

    const nextModels = this.buildSelectedModels(input, previous.selectedModels)
    const nextName = input.name.trim()
    if (previous.name !== nextName) {
      // 改名时保留历史公开 ID，避免已保存的模型选择立即失效。
      for (const model of nextModels) {
        const previousModel = previous.selectedModels.find(
          (candidate) => candidate.modelId === model.modelId
        )
        if (!previousModel) continue
        model.aliases = Array.from(
          new Set([
            ...(previousModel.aliases || []),
            buildAiModelPublicId(previous.name, model.modelId)
          ])
        )
      }
    }

    try {
      const storage = replacementKey
        ? this.credentialStore.set(previous.id, replacementKey)
        : previousCredential!.storage
      store.providers[index] = {
        id: previous.id,
        name: nextName,
        apiUrl: normalizeAiApiUrl(input.apiUrl),
        hasApiKey: true,
        credentialStorage: storage,
        enabled: previous.enabled,
        selectedModels: nextModels
      }
      this.saveStore(store)
      return { success: true, data: store }
    } catch (error) {
      // 替换失败时恢复旧凭据，保证配置与密钥不会分叉。
      if (replacementKey && previousCredential) {
        try {
          this.credentialStore.set(previous.id, previousCredential.apiKey)
        } catch (rollbackError) {
          console.error('[AI Provider] 恢复旧密钥失败:', rollbackError)
        }
      }
      return { success: false, error: this.getErrorMessage(error, '更新 Provider 失败') }
    }
  }

  /**
   * 删除 Provider 配置及其独立密钥记录。
   * @param providerId 要删除的 Provider 内部 ID
   * @returns 操作结果及最新公开 Provider 文档
   */
  public deleteProvider(providerId: string): AiProviderMutationResult {
    const store = this.getStore()
    const index = store.providers.findIndex((provider) => provider.id === providerId)
    if (index === -1) return { success: false, error: '未找到该 Provider' }

    let credential
    try {
      credential = this.credentialStore.get(providerId)
    } catch (error) {
      return { success: false, error: this.getErrorMessage(error, '读取 Provider 密钥失败') }
    }

    try {
      // 先删除密钥再提交公开配置，成功返回时不留下孤立凭据。
      this.credentialStore.delete(providerId)
      store.providers.splice(index, 1)
      this.saveStore(store)
      return { success: true, data: store }
    } catch (error) {
      // 配置提交失败时尽力恢复原密钥，避免仍存在的 Provider 无法调用。
      if (credential) {
        try {
          this.credentialStore.set(providerId, credential.apiKey)
        } catch (rollbackError) {
          console.error('[AI Provider] 删除回滚时恢复密钥失败:', rollbackError)
        }
      }
      return { success: false, error: this.getErrorMessage(error, '删除 Provider 失败') }
    }
  }

  /**
   * 开启或关闭指定 AI Provider。
   * @param providerId Provider 内部 ID
   * @param enabled 是否允许插件发现和调用该 Provider
   * @returns 操作结果及最新公开 Provider 文档
   */
  public setProviderEnabled(providerId: string, enabled: boolean): AiProviderMutationResult {
    const store = this.getStore()
    const provider = store.providers.find((candidate) => candidate.id === providerId)
    if (!provider) return { success: false, error: '未找到该 Provider' }
    if (typeof enabled !== 'boolean') return { success: false, error: '开启状态无效' }

    provider.enabled = enabled
    this.saveStore(store)
    return { success: true, data: store }
  }

  /**
   * 通过 OpenAI 兼容 models 接口拉取 Provider 模型。
   * @param apiUrl Provider 接口基础地址
   * @param apiKey 本次输入的密钥；编辑时可留空
   * @param providerId 编辑中的 Provider ID，用于读取已保存密钥
   * @returns 去重并排序后的远端模型列表
   * @throws 没有可用密钥、Provider 拒绝请求或返回异常时抛出错误
   */
  public async fetchRemoteModels(
    apiUrl: string,
    apiKey?: string,
    providerId?: string
  ): Promise<AiRemoteModel[]> {
    const normalizedUrl = normalizeAiApiUrl(apiUrl)
    const resolvedKey =
      apiKey?.trim() || (providerId ? this.credentialStore.get(providerId)?.apiKey : '')
    if (!normalizedUrl || !resolvedKey) {
      throw new Error('API 地址和密钥不能为空')
    }

    const client = new OpenAI({
      apiKey: resolvedKey,
      baseURL: normalizedUrl,
      timeout: 15_000,
      maxRetries: 0
    })
    const page = await client.models.list()
    const uniqueIds = new Set<string>()

    // 限制数量，防止异常兼容接口返回过大列表占用主进程内存。
    for (const model of page.data.slice(0, 2_000)) {
      if (typeof model.id === 'string' && model.id.trim()) uniqueIds.add(model.id.trim())
    }
    return Array.from(uniqueIds)
      .sort((left, right) => left.localeCompare(right))
      .map((id) => ({ id }))
  }

  /**
   * 生成供第三方插件选择使用的扁平模型列表。
   * @returns 同时包含兼容 ID 与稳定 value 的模型条目
   */
  public getModelChoices(): AiModelChoice[] {
    return this.getStore()
      .providers.filter((provider) => provider.enabled && provider.hasApiKey)
      .flatMap((provider) =>
        provider.selectedModels.map((model) => ({
          id: buildAiModelPublicId(provider.name, model.modelId),
          value: model.ref,
          label: buildAiModelPublicId(provider.name, model.modelId),
          providerId: provider.id,
          providerLabel: provider.name,
          modelId: model.modelId,
          description: model.description || '',
          icon: model.icon || '',
          cost: model.cost || 0
        }))
      )
  }

  /**
   * 将插件传入的选择值解析为仅供主进程调用的连接信息。
   * @param modelRef 插件回传的 id、value 或历史兼容 ID
   * @returns 含解密密钥的调用配置；没有可用模型时返回 null
   * @throws 模型选择有歧义或已保存密钥不可读取时抛出错误
   */
  public resolveModel(modelRef?: string): ResolvedAiModel | null {
    const enabledProviders = this.getStore().providers.filter(
      (provider) => provider.enabled && provider.hasApiKey
    )
    const requestedRef = modelRef || undefined
    let match: { provider: AiProvider; model: AiProviderModel } | null = null

    if (requestedRef) {
      for (const provider of enabledProviders) {
        const model = provider.selectedModels.find((candidate) => candidate.ref === requestedRef)
        if (model) {
          match = { provider, model }
          break
        }
      }

      if (!match) {
        const publicMatches = enabledProviders.flatMap((provider) =>
          provider.selectedModels
            .filter(
              (model) =>
                buildAiModelPublicId(provider.name, model.modelId) === requestedRef ||
                model.aliases?.includes(requestedRef)
            )
            .map((model) => ({ provider, model }))
        )
        if (publicMatches.length > 1) {
          throw new Error(`模型选择“${requestedRef}”匹配多个 Provider，请重新选择`)
        }
        match = publicMatches[0] || null
      }

      if (!match) {
        const modelMatches = enabledProviders.flatMap((provider) =>
          provider.selectedModels
            .filter((model) => model.modelId === requestedRef)
            .map((model) => ({ provider, model }))
        )
        if (modelMatches.length > 1) {
          throw new Error(`模型“${requestedRef}”存在多个 Provider，请重新选择`)
        }
        match = modelMatches[0] || null
      }
      if (!match) return null
    } else {
      for (const provider of enabledProviders) {
        if (provider.selectedModels[0]) {
          match = { provider, model: provider.selectedModels[0] }
          break
        }
      }
      if (!match) return null
    }

    // 明文密钥只在主进程准备实际请求时短暂解密，不进入公开 Store。
    const credential = this.credentialStore.get(match.provider.id)
    if (!credential) throw new Error(`Provider“${match.provider.name}”没有可用密钥`)
    return {
      provider: {
        id: match.provider.id,
        name: match.provider.name,
        apiUrl: match.provider.apiUrl,
        apiKey: credential.apiKey
      },
      model: match.model
    }
  }

  /**
   * 校验 Provider 保存请求的必填字段和模型列表。
   * @param input 待校验的 Provider 数据
   * @param requireApiKey 是否要求本次请求提供新密钥
   * @returns 校验错误；通过时返回 null
   */
  private validateInput(input: AiProviderInput, requireApiKey: boolean): string | null {
    if (!input?.name?.trim() || !input?.apiUrl?.trim()) {
      return 'Provider 名称和 API 地址不能为空'
    }
    if (requireApiKey && !input.apiKey?.trim()) return 'API 密钥不能为空'
    if (!Array.isArray(input.selectedModels) || input.selectedModels.length === 0) {
      return '请至少选择一个模型'
    }
    if (input.selectedModels.some((model) => !model?.modelId?.trim())) {
      return '模型 ID 不能为空'
    }
    return null
  }

  /**
   * 构建已选模型并复用原模型的稳定选择 ID。
   * @param input Provider 保存请求
   * @param previousModels 更新前的已选模型
   * @returns 去重后的已选模型列表
   */
  private buildSelectedModels(
    input: AiProviderInput,
    previousModels: AiProviderModel[]
  ): AiProviderModel[] {
    const previousByModelId = new Map(previousModels.map((model) => [model.modelId, model]))
    const seen = new Set<string>()
    const selectedModels: AiProviderModel[] = []
    for (const candidate of input.selectedModels) {
      const modelId = candidate.modelId.trim()
      if (seen.has(modelId)) continue
      seen.add(modelId)
      const previous = previousByModelId.get(modelId)
      selectedModels.push({
        ref: previous?.ref || randomUUID(),
        aliases: previous?.aliases ? [...previous.aliases] : undefined,
        modelId,
        description: candidate.description ?? previous?.description,
        icon: candidate.icon ?? previous?.icon,
        cost: candidate.cost ?? previous?.cost
      })
    }
    return selectedModels
  }

  /**
   * 校验 Provider 名称在当前文档中是否唯一。
   * @param store 当前 Provider 文档
   * @param providerName 待保存的 Provider 名称
   * @param currentProviderId 更新时排除的当前 Provider ID
   * @returns 名称冲突错误；名称可用时返回 null
   */
  private validateProviderName(
    store: AiProviderStore,
    providerName: string,
    currentProviderId?: string
  ): string | null {
    const normalizedName = providerName.trim().toLowerCase()
    return store.providers.some(
      (provider) =>
        provider.id !== currentProviderId && provider.name.trim().toLowerCase() === normalizedName
    )
      ? 'Provider 名称已存在，请使用不同名称'
      : null
  }

  /**
   * 规范 Provider 名称、开关与模型遗留展示字段。
   * @param store 当前 Provider 文档
   * @returns 是否修改了公开文档
   */
  private normalizeProviderStore(store: AiProviderStore): boolean {
    const usedNames = new Set<string>()
    let changed = false
    for (const provider of store.providers) {
      if (typeof provider.enabled !== 'boolean') {
        provider.enabled = true
        changed = true
      }
      const originalName = provider.name?.trim() || 'AI Provider'
      let nextName = originalName
      let sequence = 2
      while (usedNames.has(nextName.toLowerCase())) {
        nextName = `${originalName} (${sequence++})`
      }
      usedNames.add(nextName.toLowerCase())
      if (provider.name !== nextName) {
        provider.name = nextName
        changed = true
      }
    }
    return changed
  }

  /**
   * 将公开 Provider 文档写回本地数据库。
   * @param store 待保存的 Provider 文档
   * @returns 无返回值
   */
  private saveStore(store: AiProviderStore): void {
    databaseAPI.dbPut(HOST_STORAGE_KEYS.aiModels, store)
  }

  /**
   * 将未知异常转换为适合界面展示的消息。
   * @param error 捕获到的异常
   * @param fallback 非 Error 异常使用的兜底文本
   * @returns 可展示的错误消息
   */
  private getErrorMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback
  }
}

export default new AiProviderService()
