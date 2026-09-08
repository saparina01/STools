import type { DbDoc, DbResult } from './types'
import type { LocalDocumentApi } from './localDocumentApi'

/**
 * 将本地同步文档操作调度到下一轮事件循环，并提供 Promise 形式 API。
 */
export class PromiseApi {
  /**
   * 创建 Promise API。
   * @param localApi 本地同步文档 API。
   */
  constructor(private localApi: LocalDocumentApi) {}

  /**
   * 异步保存文档。
   * @param doc 待保存文档。
   * @returns 写入结果 Promise。
   */
  public async put(doc: DbDoc): Promise<DbResult> {
    return this.defer(() => this.localApi.put(doc))
  }

  /**
   * 异步读取文档。
   * @param id 文档 ID。
   * @returns 文档或 null 的 Promise。
   */
  public async get(id: string): Promise<DbDoc | null> {
    return this.defer(() => this.localApi.get(id))
  }

  /**
   * 异步删除文档。
   * @param docOrId 文档或 ID。
   * @returns 删除结果 Promise。
   */
  public async remove(docOrId: DbDoc | string): Promise<DbResult> {
    return this.defer(() => this.localApi.remove(docOrId))
  }

  /**
   * 异步批量写入文档。
   * @param docs 文档数组。
   * @returns 批量写入结果 Promise。
   */
  public async bulkDocs(docs: DbDoc[]): Promise<DbResult[]> {
    return this.defer(() => this.localApi.bulkDocs(docs))
  }

  /**
   * 异步读取匹配文档。
   * @param key ID 数组或前缀。
   * @returns 匹配文档 Promise。
   */
  public async allDocs(key?: string | string[]): Promise<DbDoc[]> {
    return this.defer(() => this.localApi.allDocs(key))
  }

  /**
   * 异步保存附件。
   * @param id 关联文档 ID。
   * @param attachment 附件字节。
   * @param type MIME 类型。
   * @returns 写入结果 Promise。
   */
  public async postAttachment(
    id: string,
    attachment: Buffer | Uint8Array,
    type: string
  ): Promise<DbResult> {
    return this.defer(() => this.localApi.postAttachment(id, attachment, type))
  }

  /**
   * 异步读取附件。
   * @param id 关联文档 ID。
   * @returns 附件字节或 null 的 Promise。
   */
  public async getAttachment(id: string): Promise<Uint8Array | null> {
    return this.defer(() => this.localApi.getAttachment(id))
  }

  /**
   * 异步读取附件元数据。
   * @param id 关联文档 ID。
   * @returns 附件元数据或 null 的 Promise。
   */
  public async getAttachmentType(id: string): Promise<any | null> {
    return this.defer(() => this.localApi.getAttachmentType(id))
  }

  /**
   * 将同步操作推迟到下一轮事件循环。
   * @param operation 要执行的同步操作。
   * @returns 操作结果 Promise。
   */
  private defer<T>(operation: () => T): Promise<T> {
    return new Promise((resolve, reject) => {
      setImmediate(() => {
        try {
          resolve(operation())
        } catch (error) {
          reject(error)
        }
      })
    })
  }
}
