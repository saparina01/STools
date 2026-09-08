import * as crypto from 'crypto'
import { EventEmitter } from 'events'
import type { DbDoc, DbResult, LmdbDatabase as LmdbDb, LmdbEnv } from './types'
import {
  createErrorResult,
  createSuccessResult,
  generateNewRev,
  isDocSizeExceeded,
  isValidDocId,
  safeJsonParse,
  safeJsonStringify
} from './utils'

interface LocalDocumentMeta {
  _rev: string
  updatedAt: number
}

interface AttachmentMetadata {
  type: string
  length: number
  md5: string
  digest: string
  name: string
  revpos: number
}

interface CouchAttachmentStub {
  stub: true
  digest: string
  content_type: string
  length: number
  revpos: number
}

/**
 * 提供只面向本机的文档和附件操作，并维持 uTools 风格的 revision 冲突语义。
 */
export class LocalDocumentApi {
  /**
   * 创建本地文档 API。
   * @param env LMDB 环境。
   * @param mainDb 文档逻辑库。
   * @param metaDb revision 元数据逻辑库。
   * @param attachmentDb 附件逻辑库。
   * @param emitter 向宿主转发本地变更事件的事件发射器。
   */
  constructor(
    private env: LmdbEnv,
    private mainDb: LmdbDb,
    private metaDb: LmdbDb,
    private attachmentDb: LmdbDb,
    private emitter: EventEmitter
  ) {}

  /**
   * 创建或更新本地文档。
   * @param doc 必须包含 `_id` 的文档。
   * @returns 写入结果；revision 不匹配时返回 conflict。
   */
  public put(doc: DbDoc): DbResult {
    try {
      // 在进入事务前拒绝无效或过大的文档，避免产生部分状态。
      const validation = this.validateDocument(doc)
      if (validation) return validation

      return this.env.transactionSync(() => this.putInTransaction(doc))
    } catch (error: any) {
      console.error('[LMDB] put error:', error)
      return createErrorResult(error.name || 'exception', error.message, doc?._id)
    }
  }

  /**
   * 按 ID 读取本地文档。
   * @param id 文档 ID。
   * @returns 文档副本；不存在或解析失败时返回 null。
   */
  public get(id: string): DbDoc | null {
    try {
      const serialized = this.mainDb.get(id)
      return serialized ? (safeJsonParse(serialized) as DbDoc | null) : null
    } catch (error) {
      console.error('[LMDB] get error:', error)
      return null
    }
  }

  /**
   * 删除本地文档。
   * @param docOrId 文档 ID，或携带当前 `_rev` 的文档。
   * @returns 删除结果；文档不存在或 revision 不匹配时返回错误。
   */
  public remove(docOrId: DbDoc | string): DbResult {
    const id = typeof docOrId === 'string' ? docOrId : docOrId?._id
    try {
      if (!isValidDocId(id)) return createErrorResult('exception', '_id is required', id)

      const existing = this.get(id)
      if (!existing) return createErrorResult('not_found', 'Document not found', id)

      // 文档对象形式的删除必须针对当前 revision，防止覆盖并发写入。
      if (typeof docOrId !== 'string' && docOrId._rev && docOrId._rev !== existing._rev) {
        return createErrorResult('conflict', 'Document update conflict', id)
      }

      this.env.transactionSync(() => {
        this.mainDb.removeSync(id)
        this.metaDb.removeSync(id)
      })
      setImmediate(() => this.emitter.emit('change', { docId: id }))
      return createSuccessResult(id, existing._rev)
    } catch (error: any) {
      console.error('[LMDB] remove error:', error)
      return createErrorResult(error.name || 'exception', error.message, id)
    }
  }

  /**
   * 在单个事务中批量写入文档。
   * @param docs 待写入且 ID 不重复的文档数组。
   * @returns 与输入顺序一致的写入结果。
   * @throws 输入不是数组、存在无效 ID 或重复 ID 时抛出错误。
   */
  public bulkDocs(docs: DbDoc[]): DbResult[] {
    if (!Array.isArray(docs)) throw new Error('docs must be an array')
    if (docs.some((doc) => !isValidDocId(doc?._id))) {
      throw new Error('All documents must have a valid _id')
    }
    if (new Set(docs.map((doc) => doc._id)).size !== docs.length) {
      throw new Error('Duplicate _id found in docs array')
    }

    const results: DbResult[] = []
    this.env.transactionSync(() => {
      for (const doc of docs) results.push(this.putInTransaction(doc))
    })
    return results
  }

  /**
   * 按 ID 列表或前缀读取本地文档。
   * @param key 文档 ID 数组、ID 前缀或空值。
   * @returns 匹配的文档数组。
   */
  public allDocs(key?: string | string[]): DbDoc[] {
    try {
      if (Array.isArray(key)) {
        return key.map((id) => this.get(id)).filter((doc): doc is DbDoc => Boolean(doc))
      }

      const prefix = key || ''
      const results: DbDoc[] = []
      for (const { key: currentKey, value } of this.mainDb.getRange({ start: prefix })) {
        if (!(currentKey as string).startsWith(prefix)) break
        const doc = safeJsonParse(value as string) as DbDoc | null
        if (doc) results.push(doc)
      }
      return results
    } catch (error) {
      console.error('[LMDB] allDocs error:', error)
      return []
    }
  }

  /**
   * 为文档添加默认附件并推进文档 revision。
   * @param id 关联文档 ID。
   * @param attachment 附件字节。
   * @param type MIME 类型。
   * @returns 附件写入结果。
   */
  public postAttachment(id: string, attachment: Buffer | Uint8Array, type: string): DbResult {
    try {
      const buffer = Buffer.from(attachment)
      if (buffer.byteLength > 10 * 1024 * 1024) {
        return createErrorResult('exception', 'Attachment exceeds 10M', id)
      }
      if (this.attachmentDb.get(this.attachmentKey(id))) {
        return createErrorResult('conflict', 'Attachment already exists', id)
      }

      const result = this.env.transactionSync(() => {
        const existing = this.get(id) || ({ _id: id } as DbDoc)
        const previousRev = this.getMeta(id)?._rev || existing._rev
        const nextRev = generateNewRev(previousRev)
        const revpos = Number.parseInt(nextRev.split('-', 1)[0], 10) || 1
        const digest = this.attachmentDigest(buffer)
        const metadata: AttachmentMetadata = {
          type,
          length: buffer.byteLength,
          md5: digest.replace(/^md5-/, ''),
          digest,
          name: 'default',
          revpos
        }

        // 附件二进制与元数据必须在同一事务中发布。
        this.attachmentDb.putSync(this.attachmentKey(id), buffer)
        this.attachmentDb.putSync(this.attachmentMetaKey(id), safeJsonStringify(metadata))
        const attachments = { ...this.getAttachmentStubs(existing) }
        attachments.default = this.toAttachmentStub(metadata)
        const nextDoc = { ...existing, _rev: nextRev, _attachments: attachments }
        this.saveDocument(nextDoc)
        return { result: createSuccessResult(id, nextRev), metadata }
      })

      setImmediate(() => {
        this.emitter.emit('change', { docId: id })
        this.emitter.emit('attachment-added', {
          docId: id,
          md5: result.metadata.md5,
          digest: result.metadata.digest,
          contentType: type
        })
      })
      return result.result
    } catch (error: any) {
      console.error('[LMDB] postAttachment error:', error)
      return createErrorResult(error.name || 'exception', error.message, id)
    }
  }

  /**
   * 删除默认附件，并在有关联文档时推进其 revision。
   * @param id 关联文档 ID。
   * @returns 无返回值。
   */
  public removeAttachment(id: string): void {
    try {
      this.env.transactionSync(() => {
        this.attachmentDb.removeSync(this.attachmentKey(id))
        this.attachmentDb.removeSync(this.attachmentMetaKey(id))

        const existing = this.get(id)
        if (!existing) return
        const attachments = { ...this.getAttachmentStubs(existing) }
        delete attachments.default
        const nextRev = generateNewRev(this.getMeta(id)?._rev || existing._rev)
        const nextDoc: DbDoc = { ...existing, _rev: nextRev }
        if (Object.keys(attachments).length > 0) nextDoc._attachments = attachments
        else delete nextDoc._attachments
        this.saveDocument(nextDoc)
      })
      setImmediate(() => this.emitter.emit('change', { docId: id }))
    } catch (error) {
      console.error('[LMDB] removeAttachment error:', error)
    }
  }

  /**
   * 仅清除附件记录，不修改关联文档。
   * @param id 关联文档 ID。
   * @returns 无返回值。
   */
  public removeAttachmentSilent(id: string): void {
    try {
      this.env.transactionSync(() => {
        this.attachmentDb.removeSync(this.attachmentKey(id))
        this.attachmentDb.removeSync(this.attachmentMetaKey(id))
      })
    } catch (error) {
      console.error('[LMDB] removeAttachmentSilent error:', error)
    }
  }

  /**
   * 读取附件字节。
   * @param id 关联文档 ID。
   * @returns 附件字节；不存在时返回 null。
   */
  public getAttachment(id: string): Uint8Array | null {
    try {
      const value = this.attachmentDb.get(this.attachmentKey(id))
      return value ? new Uint8Array(value) : null
    } catch (error) {
      console.error('[LMDB] getAttachment error:', error)
      return null
    }
  }

  /**
   * 读取附件元数据。
   * @param id 关联文档 ID。
   * @returns 附件元数据；不存在时返回 null。
   */
  public getAttachmentType(id: string): AttachmentMetadata | null {
    try {
      const value = this.attachmentDb.get(this.attachmentMetaKey(id))
      return value ? (safeJsonParse(value as string) as AttachmentMetadata | null) : null
    } catch (error) {
      console.error('[LMDB] getAttachmentType error:', error)
      return null
    }
  }

  /**
   * 校验并在现有事务内保存文档。
   * @param doc 待保存文档。
   * @returns 写入结果。
   */
  private putInTransaction(doc: DbDoc): DbResult {
    const validation = this.validateDocument(doc)
    if (validation) return validation

    const existingRev = this.getMeta(doc._id)?._rev
    if (existingRev && doc._rev !== existingRev) {
      return createErrorResult('conflict', 'Document update conflict', doc._id)
    }

    const nextRev = generateNewRev(existingRev)
    const nextDoc = { ...doc, _rev: nextRev }
    this.saveDocument(nextDoc)
    doc._rev = nextRev
    setImmediate(() => this.emitter.emit('change', { docId: doc._id }))
    return createSuccessResult(doc._id, nextRev)
  }

  /**
   * 保存文档正文和 revision 元数据。
   * @param doc 已生成新 revision 的文档。
   * @returns 无返回值。
   */
  private saveDocument(doc: DbDoc): void {
    const timestamp = Date.now()
    this.mainDb.putSync(doc._id, safeJsonStringify(doc))
    this.metaDb.putSync(
      doc._id,
      safeJsonStringify({ _rev: doc._rev || '', updatedAt: timestamp } satisfies LocalDocumentMeta)
    )
  }

  /**
   * 读取本地 revision 元数据。
   * @param id 文档 ID。
   * @returns 元数据；不存在时返回 null。
   */
  private getMeta(id: string): LocalDocumentMeta | null {
    const value = this.metaDb.get(id)
    return value ? (safeJsonParse(value as string) as LocalDocumentMeta | null) : null
  }

  /**
   * 校验本地文档的 ID 和大小限制。
   * @param doc 待校验文档。
   * @returns 校验错误；通过时返回 null。
   */
  private validateDocument(doc: DbDoc): DbResult | null {
    if (!doc || !isValidDocId(doc._id)) {
      return createErrorResult('exception', '_id is required and must be a string', doc?._id)
    }
    if (isDocSizeExceeded(doc, 1024 * 1024)) {
      return createErrorResult('exception', 'Document size exceeds 1M', doc._id)
    }
    return null
  }

  /**
   * 读取文档内的附件占位信息。
   * @param doc 关联文档。
   * @returns 以附件名称为键的占位信息。
   */
  private getAttachmentStubs(doc: DbDoc): Record<string, CouchAttachmentStub> {
    const value = doc._attachments
    return value && typeof value === 'object' ? value : {}
  }

  /**
   * 将内部附件元数据转换为文档占位信息。
   * @param metadata 内部附件元数据。
   * @returns 文档可保存的附件占位信息。
   */
  private toAttachmentStub(metadata: AttachmentMetadata): CouchAttachmentStub {
    return {
      stub: true,
      digest: metadata.digest,
      content_type: metadata.type,
      length: metadata.length,
      revpos: metadata.revpos
    }
  }

  /**
   * 计算附件内容摘要。
   * @param buffer 附件字节。
   * @returns 带 `md5-` 前缀的摘要。
   */
  private attachmentDigest(buffer: Buffer): string {
    return `md5-${crypto.createHash('md5').update(buffer).digest('hex')}`
  }

  /**
   * 生成附件二进制键。
   * @param id 关联文档 ID。
   * @returns 附件二进制键。
   */
  private attachmentKey(id: string): string {
    return `attachment:${id}`
  }

  /**
   * 生成附件元数据键。
   * @param id 关联文档 ID。
   * @returns 附件元数据键。
   */
  private attachmentMetaKey(id: string): string {
    return `attachment-ext:${id}`
  }
}
