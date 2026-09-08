import { EventEmitter } from 'events'
import fs from 'fs'
import { open } from 'lmdb'
import { LocalDocumentApi } from './localDocumentApi'
import { PromiseApi } from './promiseApi'
import type { DbDoc, DbResult, LmdbConfig } from './types'

/**
 * 单机 LMDB 文档库，提供兼容 uTools 的同步与 Promise API。
 */
export default class LmdbDatabase extends EventEmitter {
  private env: any
  private mainDb: any
  private metaDb: any
  private attachmentDb: any
  private localApi: LocalDocumentApi
  private promiseApi: PromiseApi

  public promises: {
    put: (doc: DbDoc) => Promise<DbResult>
    get: (id: string) => Promise<DbDoc | null>
    remove: (docOrId: DbDoc | string) => Promise<DbResult>
    bulkDocs: (docs: DbDoc[]) => Promise<DbResult[]>
    allDocs: (key?: string | string[]) => Promise<DbDoc[]>
    postAttachment: (id: string, attachment: Buffer | Uint8Array, type: string) => Promise<DbResult>
    getAttachment: (id: string) => Promise<Uint8Array | null>
    getAttachmentType: (id: string) => Promise<any | null>
  }

  /**
   * 打开单一本地 LMDB 环境及其文档、元数据和附件逻辑库。
   * @param config LMDB 路径和容量配置。
   */
  constructor(config: LmdbConfig) {
    super()
    fs.mkdirSync(config.path, { recursive: true })
    this.env = open({
      path: config.path,
      mapSize: config.mapSize || 2 * 1024 * 1024 * 1024,
      maxDbs: config.maxDbs || 3,
      compression: false,
      encoding: 'binary'
    })
    this.mainDb = this.env.openDB({ name: 'main', encoding: 'string' })
    this.metaDb = this.env.openDB({ name: 'meta', encoding: 'string' })
    this.attachmentDb = this.env.openDB({ name: 'attachment', encoding: 'binary' })
    this.localApi = new LocalDocumentApi(
      this.env,
      this.mainDb,
      this.metaDb,
      this.attachmentDb,
      this
    )
    this.promiseApi = new PromiseApi(this.localApi)
    this.promises = {
      put: (doc) => this.promiseApi.put(doc),
      get: (id) => this.promiseApi.get(id),
      remove: (docOrId) => this.promiseApi.remove(docOrId),
      bulkDocs: (docs) => this.promiseApi.bulkDocs(docs),
      allDocs: (key) => this.promiseApi.allDocs(key),
      postAttachment: (id, attachment, type) =>
        this.promiseApi.postAttachment(id, attachment, type),
      getAttachment: (id) => this.promiseApi.getAttachment(id),
      getAttachmentType: (id) => this.promiseApi.getAttachmentType(id)
    }
  }

  /**
   * 创建或更新文档。
   * @param doc 待保存文档。
   * @returns 写入结果。
   */
  public put(doc: DbDoc): DbResult {
    return this.localApi.put(doc)
  }

  /**
   * 读取文档。
   * @param id 文档 ID。
   * @returns 文档或 null。
   */
  public get(id: string): DbDoc | null {
    return this.localApi.get(id)
  }

  /**
   * 删除文档。
   * @param docOrId 文档或 ID。
   * @returns 删除结果。
   */
  public remove(docOrId: DbDoc | string): DbResult {
    return this.localApi.remove(docOrId)
  }

  /**
   * 批量写入文档。
   * @param docs 文档数组。
   * @returns 批量写入结果。
   */
  public bulkDocs(docs: DbDoc[]): DbResult[] {
    return this.localApi.bulkDocs(docs)
  }

  /**
   * 按前缀或 ID 数组读取文档。
   * @param key ID 数组或前缀。
   * @returns 匹配文档。
   */
  public allDocs(key?: string | string[]): DbDoc[] {
    return this.localApi.allDocs(key)
  }

  /**
   * 保存附件。
   * @param id 关联文档 ID。
   * @param attachment 附件字节。
   * @param type MIME 类型。
   * @returns 写入结果。
   */
  public postAttachment(id: string, attachment: Buffer | Uint8Array, type: string): DbResult {
    return this.localApi.postAttachment(id, attachment, type)
  }

  /**
   * 删除附件并更新关联文档。
   * @param id 关联文档 ID。
   * @returns 无返回值。
   */
  public removeAttachment(id: string): void {
    this.localApi.removeAttachment(id)
  }

  /**
   * 仅删除附件记录。
   * @param id 关联文档 ID。
   * @returns 无返回值。
   */
  public removeAttachmentSilent(id: string): void {
    this.localApi.removeAttachmentSilent(id)
  }

  /**
   * 读取附件。
   * @param id 关联文档 ID。
   * @returns 附件字节或 null。
   */
  public getAttachment(id: string): Uint8Array | null {
    return this.localApi.getAttachment(id)
  }

  /**
   * 读取附件元数据。
   * @param id 关联文档 ID。
   * @returns 附件元数据或 null。
   */
  public getAttachmentType(id: string): any | null {
    return this.localApi.getAttachmentType(id)
  }

  /**
   * 返回附件逻辑库供本地数据维护使用。
   * @returns 附件逻辑库。
   */
  public getAttachmentDb(): any {
    return this.attachmentDb
  }

  /**
   * 返回元数据逻辑库供本地数据维护使用。
   * @returns 元数据逻辑库。
   */
  public getMetaDb(): any {
    return this.metaDb
  }

  /**
   * 关闭 LMDB 环境。
   * @returns 无返回值。
   */
  public close(): void {
    try {
      this.env.close()
    } catch (error) {
      console.error('[LMDB] Error closing LMDB:', error)
    }
  }

  /**
   * 获取三个本地逻辑库的统计信息。
   * @returns 逻辑库统计信息。
   */
  public getStats(): any {
    try {
      return {
        main: this.mainDb.getStats?.() || {},
        meta: this.metaDb.getStats?.() || {},
        attachment: this.attachmentDb.getStats?.() || {}
      }
    } catch (error) {
      console.error('[LMDB] Error getting stats:', error)
      return {}
    }
  }

  /**
   * 将待处理数据刷新到磁盘。
   * @returns 无返回值。
   */
  public sync(): void {
    try {
      this.env.sync()
    } catch (error) {
      console.error('[LMDB] Error syncing LMDB:', error)
    }
  }
}
