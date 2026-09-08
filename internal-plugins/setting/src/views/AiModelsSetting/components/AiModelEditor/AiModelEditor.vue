<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { BaseDialog, DetailPanel } from '@/components'
import type {
  AiProvider,
  AiProviderInput,
  AiProviderModelInput,
  AiRemoteModel
} from '@shared/aiProviderShared'

interface Props {
  editingProvider: AiProvider | null
}

const props = defineProps<Props>()
const emit = defineEmits<{
  back: []
  save: [provider: AiProviderInput]
}>()

const isEditing = computed(() => props.editingProvider !== null)
const showPassword = ref(false)
const fetching = ref(false)
const fetchError = ref('')
const modelQuery = ref('')
const remoteModelQuery = ref('')
const manualModelId = ref('')
const fetchedModels = ref<AiRemoteModel[]>([])
const selectedModelIds = ref<Set<string>>(new Set())
const pendingModelIds = ref<Set<string>>(new Set())
const showModelDialog = ref(false)
const formData = ref({
  name: '',
  apiUrl: '',
  apiKey: ''
})

const filteredSelectedModelIds = computed(() => {
  const query = modelQuery.value.trim().toLowerCase()
  const modelIds = Array.from(selectedModelIds.value)
  if (!query) return modelIds
  return modelIds.filter((modelId) => modelId.toLowerCase().includes(query))
})

const filteredRemoteModels = computed(() => {
  const query = remoteModelQuery.value.trim().toLowerCase()
  if (!query) return fetchedModels.value
  return fetchedModels.value.filter((model) => model.id.toLowerCase().includes(query))
})

/**
 * 用编辑目标重置表单、远端模型缓存和选择状态。
 * @param provider 当前编辑的供应商；null 表示新建
 * @returns 无返回值
 */
function resetEditor(provider: AiProvider | null): void {
  formData.value = {
    name: provider?.name || '',
    apiUrl: provider?.apiUrl || '',
    apiKey: ''
  }
  fetchedModels.value = []
  selectedModelIds.value = new Set(provider?.selectedModels.map((model) => model.modelId) || [])
  pendingModelIds.value = new Set()
  modelQuery.value = ''
  remoteModelQuery.value = ''
  manualModelId.value = ''
  fetchError.value = ''
  showModelDialog.value = false
  showPassword.value = false
}

watch(() => props.editingProvider, resetEditor, { immediate: true })

/**
 * 从当前供应商的 OpenAI 兼容接口拉取模型并打开选择弹窗。
 * @returns 操作完成后结束的 Promise
 */
async function fetchModels(): Promise<void> {
  if (!formData.value.apiUrl.trim()) {
    fetchError.value = '请先填写 API 地址'
    return
  }
  if (!formData.value.apiKey.trim() && !props.editingProvider?.hasApiKey) {
    fetchError.value = '请先填写 API 密钥'
    return
  }

  fetching.value = true
  fetchError.value = ''
  try {
    const result = await window.ztools.internal.aiProviders.fetchModels(
      formData.value.apiUrl,
      formData.value.apiKey || undefined,
      props.editingProvider?.id
    )
    if (!result.success || !result.data) {
      fetchError.value = result.error || '获取模型列表失败'
      return
    }

    // 拉取结果仅用于本次弹窗选择，不直接改变已选模型。
    fetchedModels.value = [...result.data].sort((left, right) => left.id.localeCompare(right.id))
    pendingModelIds.value = new Set()
    remoteModelQuery.value = ''
    showModelDialog.value = true
  } catch (error) {
    fetchError.value = error instanceof Error ? error.message : '获取模型列表失败'
  } finally {
    fetching.value = false
  }
}

/**
 * 切换弹窗中尚未添加的远端模型。
 * @param modelId 远端模型 ID
 * @returns 无返回值
 */
function togglePendingModel(modelId: string): void {
  if (selectedModelIds.value.has(modelId)) return

  const next = new Set(pendingModelIds.value)
  if (next.has(modelId)) next.delete(modelId)
  else next.add(modelId)
  pendingModelIds.value = next
}

/**
 * 将弹窗中勾选的远端模型批量加入已选模型。
 * @returns 无返回值
 */
function confirmFetchedModels(): void {
  selectedModelIds.value = new Set([...selectedModelIds.value, ...pendingModelIds.value])
  closeModelDialog()
}

/**
 * 关闭远端模型选择弹窗并清理临时选择。
 * @returns 无返回值
 */
function closeModelDialog(): void {
  showModelDialog.value = false
  pendingModelIds.value = new Set()
  remoteModelQuery.value = ''
}

/**
 * 从供应商的已选模型中移除指定模型。
 * @param modelId 要移除的远端模型 ID
 * @returns 无返回值
 */
function removeSelectedModel(modelId: string): void {
  const next = new Set(selectedModelIds.value)
  next.delete(modelId)
  selectedModelIds.value = next
}

/**
 * 将手动输入的模型 ID 直接加入已选模型。
 * @returns 无返回值
 */
function addManualModel(): void {
  const modelId = manualModelId.value.trim()
  if (!modelId) return

  selectedModelIds.value = new Set([...selectedModelIds.value, modelId])
  manualModelId.value = ''
}

/**
 * 将表单转换为供应商保存请求并提交给父视图。
 * @returns 无返回值
 */
function handleSave(): void {
  const selectedModels: AiProviderModelInput[] = Array.from(selectedModelIds.value).map(
    (modelId) => ({ modelId })
  )

  emit('save', {
    id: props.editingProvider?.id,
    name: formData.value.name,
    apiUrl: formData.value.apiUrl,
    apiKey: formData.value.apiKey,
    selectedModels
  })
}
</script>

<template>
  <DetailPanel :title="isEditing ? '编辑供应商' : '添加供应商'" @back="$emit('back')">
    <div class="editor-wrapper">
      <div class="editor-content">
        <div class="connection-fields">
          <div class="form-group">
            <label class="form-label">供应商名称 *</label>
            <input v-model="formData.name" type="text" class="input" placeholder="例如：中转站 1" />
          </div>

          <div class="form-group">
            <label class="form-label">API 地址 *</label>
            <input
              v-model="formData.apiUrl"
              type="url"
              class="input"
              placeholder="https://api.example.com/v1"
            />
          </div>

          <div class="form-group">
            <label class="form-label">API 密钥 {{ isEditing ? '' : '*' }}</label>
            <div class="input-wrapper">
              <input
                v-model="formData.apiKey"
                :type="showPassword ? 'text' : 'password'"
                class="input input-with-icon"
                :placeholder="isEditing ? '留空则保留已保存密钥' : '输入 API 密钥'"
              />
              <button
                type="button"
                class="toggle-password"
                :title="showPassword ? '隐藏 API 密钥' : '显示 API 密钥'"
                :aria-label="showPassword ? '隐藏 API 密钥' : '显示 API 密钥'"
                @click="showPassword = !showPassword"
              >
                <svg
                  v-if="showPassword"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden="true"
                >
                  <path
                    d="M3 3L21 21M10.584 10.587C10.2087 10.9624 9.99775 11.4708 9.99775 12C9.99775 12.5292 10.2087 13.0376 10.584 13.413C10.9594 13.7884 11.4678 13.9993 11.997 13.9993C12.5262 13.9993 13.0346 13.7884 13.41 13.413M10.584 10.587L13.41 13.413M10.584 10.587L8.636 8.636M13.41 13.413L15.364 15.364M8.636 8.636C6.736 9.636 5.264 11.364 4 12C5.272 14.272 8.182 18 12 18C13.09 18 14.09 17.727 15 17.273M8.636 8.636L5 5M15.364 15.364C17.264 14.364 18.736 12.636 20 12C18.728 9.728 15.818 6 12 6C10.91 6 9.91 6.273 9 6.727M15.364 15.364L19 19"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
                <svg
                  v-else
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden="true"
                >
                  <path
                    d="M12 5C8.24261 5 5.43602 7.4404 3.76737 9.43934C2.74421 10.6278 2.74421 13.3722 3.76737 14.5607C5.43602 16.5596 8.24261 19 12 19C15.7574 19 18.564 16.5596 20.2326 14.5607C21.2558 13.3722 21.2558 10.6278 20.2326 9.43934C18.564 7.4404 15.7574 5 12 5Z"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                  <path
                    d="M12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15Z"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div class="models-section">
          <div class="section-header">
            <div>
              <h3>模型</h3>
              <span>{{ selectedModelIds.size }} 个已选择</span>
            </div>
            <button
              class="btn fetch-models-button"
              type="button"
              title="从供应商拉取模型"
              :disabled="fetching"
              @click="fetchModels"
            >
              <div class="i-z-refresh font-size-16px" :class="{ spinning: fetching }" />
              <span>{{ fetching ? '获取中...' : '从API获取模型' }}</span>
            </button>
          </div>

          <div v-if="fetchError" class="fetch-error">{{ fetchError }}</div>

          <div class="model-tools">
            <input v-model="modelQuery" class="input" type="search" placeholder="搜索已选模型" />
            <div class="manual-row">
              <input
                v-model="manualModelId"
                class="input"
                type="text"
                placeholder="手动输入模型 ID"
                @keyup.enter="addManualModel"
              />
              <button class="btn" type="button" @click="addManualModel">添加</button>
            </div>
          </div>

          <div class="selected-model-list">
            <div
              v-for="modelId in filteredSelectedModelIds"
              :key="modelId"
              class="selected-model-row"
            >
              <span>{{ modelId }}</span>
              <button
                type="button"
                class="icon-btn selected-model-delete"
                :title="`移除 ${modelId}`"
                :aria-label="`移除 ${modelId}`"
                @click="removeSelectedModel(modelId)"
              >
                <div class="i-z-trash font-size-14px" />
              </button>
            </div>
            <div v-if="selectedModelIds.size === 0" class="model-empty">暂未添加模型</div>
            <div v-else-if="filteredSelectedModelIds.length === 0" class="model-empty">
              没有匹配模型
            </div>
          </div>
        </div>
      </div>

      <div class="editor-footer">
        <button class="btn" @click="$emit('back')">取消</button>
        <button
          class="btn btn-solid"
          :disabled="fetching || selectedModelIds.size === 0"
          @click="handleSave"
        >
          保存
        </button>
      </div>
    </div>

    <BaseDialog
      v-model:visible="showModelDialog"
      title="选择供应商模型"
      :subtitle="`共 ${fetchedModels.length} 个模型`"
      max-width="620px"
      @close="closeModelDialog"
    >
      <div class="remote-model-dialog">
        <input
          v-model="remoteModelQuery"
          class="input dialog-search"
          type="search"
          placeholder="搜索供应商模型"
        />

        <div class="model-picker">
          <label
            v-for="model in filteredRemoteModels"
            :key="model.id"
            class="model-option"
            :class="{ 'model-option-added': selectedModelIds.has(model.id) }"
          >
            <input
              type="checkbox"
              :checked="selectedModelIds.has(model.id) || pendingModelIds.has(model.id)"
              :disabled="selectedModelIds.has(model.id)"
              @change="togglePendingModel(model.id)"
            />
            <span>{{ model.id }}</span>
            <span v-if="selectedModelIds.has(model.id)" class="added-label">已添加</span>
          </label>
          <div v-if="fetchedModels.length === 0" class="model-empty">供应商未返回模型</div>
          <div v-else-if="filteredRemoteModels.length === 0" class="model-empty">没有匹配模型</div>
        </div>
      </div>

      <template #footer>
        <button class="btn" type="button" @click="closeModelDialog">取消</button>
        <button
          class="btn btn-solid"
          type="button"
          :disabled="pendingModelIds.size === 0"
          @click="confirmFetchedModels"
        >
          添加{{ pendingModelIds.size > 0 ? ` ${pendingModelIds.size} 个模型` : '' }}
        </button>
      </template>
    </BaseDialog>
  </DetailPanel>
</template>

<style scoped>
.editor-wrapper {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.editor-content {
  flex: 1;
  padding: 24px;
  overflow-y: auto;
}

.connection-fields {
  display: grid;
  grid-template-columns: minmax(180px, 0.7fr) minmax(260px, 1.3fr);
  gap: 18px;
}

.connection-fields .form-group:last-child {
  grid-column: 1 / -1;
}

.form-group {
  min-width: 0;
}

.form-label {
  display: block;
  margin-bottom: 8px;
  color: var(--text-color);
  font-size: 13px;
  font-weight: 600;
}

.input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.input-with-icon {
  padding-right: 40px;
}

.toggle-password {
  position: absolute;
  right: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border: 0;
  background: none;
  color: var(--text-secondary);
  cursor: pointer;
  transition: color 0.2s ease;
}

.toggle-password:hover {
  color: var(--text-color);
}

.toggle-password:active {
  transform: scale(0.95);
}

.models-section {
  margin-top: 28px;
  border-top: 1px solid var(--divider-color);
  padding-top: 20px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.section-header h3 {
  margin: 0 0 3px;
  font-size: 15px;
}

.section-header span {
  color: var(--text-secondary);
  font-size: 12px;
}

.fetch-models-button {
  display: inline-flex;
  min-width: 126px;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.model-tools {
  display: grid;
  grid-template-columns: minmax(180px, 0.8fr) minmax(260px, 1.2fr);
  gap: 12px;
  margin-bottom: 12px;
}

.manual-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}

.selected-model-list {
  min-height: 120px;
  max-height: 280px;
  overflow-y: auto;
  border: 1px solid var(--divider-color);
  border-radius: 6px;
}

.selected-model-row {
  display: flex;
  min-height: 42px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 8px 6px 12px;
  border-bottom: 1px solid var(--divider-color);
  color: var(--text-color);
  font-size: 13px;
}

.selected-model-row:last-child {
  border-bottom: 0;
}

.selected-model-row > span {
  min-width: 0;
  overflow-wrap: anywhere;
}

.selected-model-delete {
  flex-shrink: 0;
}

.selected-model-delete:hover:not(:disabled) {
  background: var(--danger-light-bg);
  color: var(--danger-color);
}

.remote-model-dialog {
  min-width: 0;
}

.dialog-search {
  width: 100%;
  margin-bottom: 12px;
}

.model-picker {
  min-height: 220px;
  max-height: min(360px, 50vh);
  overflow-y: auto;
  border: 1px solid var(--divider-color);
  border-radius: 6px;
}

.model-option {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-height: 38px;
  padding: 7px 12px;
  border-bottom: 1px solid var(--divider-color);
  color: var(--text-color);
  font-size: 13px;
  cursor: pointer;
}

.model-option:last-child {
  border-bottom: 0;
}

.model-option:hover {
  background: var(--hover-bg);
}

.model-option-added {
  cursor: default;
  opacity: 0.65;
}

.model-option-added:hover {
  background: transparent;
}

.model-option span {
  overflow-wrap: anywhere;
}

.added-label {
  color: var(--text-secondary);
  font-size: 11px;
  white-space: nowrap;
}

.fetch-error {
  margin-bottom: 12px;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--danger-light-bg);
  color: var(--danger-color);
  font-size: 12px;
}

.model-empty {
  display: flex;
  min-height: 218px;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  font-size: 13px;
}

.selected-model-list .model-empty {
  min-height: 118px;
}

.editor-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 24px;
  border-top: 1px solid var(--divider-color);
}

.spinning {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 700px) {
  .connection-fields,
  .model-tools {
    grid-template-columns: 1fr;
  }

  .connection-fields .form-group:last-child {
    grid-column: auto;
  }

  .model-picker {
    max-height: 46vh;
  }
}
</style>
