<script setup lang="ts">
import { onMounted, ref } from 'vue'

const appVersion = ref('')

/**
 * 读取当前安装包版本并用于本地展示。
 * @returns 读取完成后结束的 Promise。
 */
async function loadAppVersion(): Promise<void> {
  try {
    appVersion.value = await window.ztools.internal.getAppVersion()
  } catch (error) {
    console.error('获取版本失败:', error)
    appVersion.value = '未知'
  }
}

onMounted(loadAppVersion)
</script>

<template>
  <div class="content-panel">
    <div class="about-container">
      <img class="about-logo" src="/logo.png" alt="ZTools" draggable="false" />
      <h1 class="about-title">ZTools</h1>
      <div class="about-version">v{{ appVersion }}</div>
    </div>
  </div>
</template>

<style scoped>
.content-panel,
.about-container {
  width: 100%;
  height: 100%;
}

.about-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  color: var(--text-color);
}

.about-logo {
  width: 84px;
  height: 84px;
  margin-bottom: 18px;
  border-radius: 20px;
}

.about-title {
  margin: 0 0 8px;
  font-size: 28px;
}

.about-version {
  color: var(--text-secondary);
  font-size: 14px;
}
</style>
