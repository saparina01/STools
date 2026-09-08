import { safeStorage } from 'electron'
import databaseAPI from '../api/shared/database.js'
import type { AiCredentialStorage } from '../../shared/aiProviderShared.js'

const CREDENTIAL_KEY_PREFIX = 'ai-provider-credential/'

interface SafeStorageAdapter {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}

interface CredentialDatabase {
  dbGet(key: string): unknown
  dbPut(key: string, value: unknown): unknown
  dbRemove(key: string): unknown
}

interface StoredCredential {
  version: 1
  storage: AiCredentialStorage
  value: string
}

export interface AiCredentialValue {
  apiKey: string
  storage: AiCredentialStorage
}

/**
 * 将 AI Provider 密钥与可渲染配置分开保存在本地数据库中。
 */
export class AiCredentialStore {
  /**
   * 创建密钥存储服务。
   * @param safeStorageAdapter Electron safeStorage 或测试替身
   * @param database 本地数据库适配器
   */
  public constructor(
    private readonly safeStorageAdapter: SafeStorageAdapter = safeStorage,
    private readonly database: CredentialDatabase = databaseAPI
  ) {}

  /**
   * 保存 Provider 密钥，优先使用操作系统凭据保护能力。
   * @param providerId Provider 内部 ID
   * @param apiKey 要保存的非空密钥
   * @returns 实际采用的密钥保护方式
   * @throws Provider ID 或密钥为空、加密或数据库写入失败时抛出错误
   */
  public set(providerId: string, apiKey: string): AiCredentialStorage {
    const normalizedId = providerId.trim()
    const normalizedKey = apiKey.trim()
    if (!normalizedId || !normalizedKey) {
      throw new Error('Provider ID 和 API 密钥不能为空')
    }

    // safeStorage 可用时只持久化密文；不可用时明确记录明文降级状态。
    const encryptionAvailable = this.safeStorageAdapter.isEncryptionAvailable()
    const record: StoredCredential = encryptionAvailable
      ? {
          version: 1,
          storage: 'safeStorage',
          value: this.safeStorageAdapter.encryptString(normalizedKey).toString('base64')
        }
      : { version: 1, storage: 'plaintext', value: normalizedKey }
    this.database.dbPut(this.getCredentialKey(normalizedId), record)
    return record.storage
  }

  /**
   * 读取并按保存方式解密 Provider 密钥。
   * @param providerId Provider 内部 ID
   * @returns 密钥及实际存储方式；没有有效记录时返回 null
   * @throws safeStorage 无法解密已有密文时抛出错误
   */
  public get(providerId: string): AiCredentialValue | null {
    const record = this.readRecord(providerId)
    if (!record) return null

    // 明文降级记录无需经过 safeStorage，警告状态由公开配置持续展示。
    if (record.storage === 'plaintext') {
      return { apiKey: record.value, storage: record.storage }
    }

    const encrypted = Buffer.from(record.value, 'base64')
    return {
      apiKey: this.safeStorageAdapter.decryptString(encrypted),
      storage: record.storage
    }
  }

  /**
   * 获取 Provider 密钥的存在性与保护方式，不读取明文。
   * @param providerId Provider 内部 ID
   * @returns 密钥保护方式；没有有效记录时返回 null
   */
  public getStorage(providerId: string): AiCredentialStorage | null {
    return this.readRecord(providerId)?.storage ?? null
  }

  /**
   * 删除 Provider 对应的独立密钥记录。
   * @param providerId Provider 内部 ID
   * @returns 无返回值
   */
  public delete(providerId: string): void {
    const normalizedId = providerId.trim()
    if (!normalizedId) return
    this.database.dbRemove(this.getCredentialKey(normalizedId))
  }

  /**
   * 读取并校验数据库中的密钥记录结构。
   * @param providerId Provider 内部 ID
   * @returns 有效密钥记录；无记录或结构无效时返回 null
   */
  private readRecord(providerId: string): StoredCredential | null {
    const normalizedId = providerId.trim()
    if (!normalizedId) return null
    const value = this.database.dbGet(this.getCredentialKey(normalizedId))
    if (!value || typeof value !== 'object') return null

    const record = value as Partial<StoredCredential>
    if (
      record.version !== 1 ||
      (record.storage !== 'safeStorage' && record.storage !== 'plaintext') ||
      typeof record.value !== 'string' ||
      !record.value
    ) {
      return null
    }
    return record as StoredCredential
  }

  /**
   * 生成 Provider 独立密钥使用的本地数据库键。
   * @param providerId Provider 内部 ID
   * @returns 本地密钥记录键
   */
  private getCredentialKey(providerId: string): string {
    return `${CREDENTIAL_KEY_PREFIX}${providerId}`
  }
}

export default new AiCredentialStore()
