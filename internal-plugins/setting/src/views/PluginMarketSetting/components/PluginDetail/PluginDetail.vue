<script setup lang="ts">
import { PluginDetail as SharedPluginDetail } from '@/components'
import type { PluginUninstallOptions } from '@/components'
import type { PluginDownloadState } from '../types'

defineProps<{
  plugin: any
  isLoading?: boolean
  downloadState?: PluginDownloadState
  isRunning?: boolean
}>()

defineEmits<{
  (event: 'back'): void
  (event: 'open'): void
  (event: 'download'): void
  (event: 'upgrade'): void
  (event: 'uninstall', options: PluginUninstallOptions): void
  (event: 'kill'): void
  (event: 'open-folder'): void
  (event: 'package'): void
  (event: 'reload'): void
}>()
</script>

<template>
  <SharedPluginDetail
    :plugin="plugin"
    :is-loading="isLoading"
    :download-state="downloadState"
    :is-running="isRunning"
    :show-commands="false"
    :show-data="false"
    :show-size="true"
    :show-download-count="true"
    initial-tab="detail"
    @back="$emit('back')"
    @open="$emit('open')"
    @download="$emit('download')"
    @upgrade="$emit('upgrade')"
    @uninstall="$emit('uninstall', $event)"
    @kill="$emit('kill')"
    @open-folder="$emit('open-folder')"
    @package="$emit('package')"
    @reload="$emit('reload')"
  />
</template>
