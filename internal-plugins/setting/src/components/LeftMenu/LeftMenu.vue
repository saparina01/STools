<script setup lang="ts">
import type { MenuRouterItemType } from '@/router'
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const router = useRouter()
const route = useRoute()
const menuRoutes = ref<MenuRouterItemType[]>([])

/**
 * 切换右侧设置页面。
 * @param item 要切换到的菜单路由项。
 * @returns 无返回值。
 */
function setActiveMenu(item: MenuRouterItemType): void {
  void router.replace({ name: item.name })
}

/**
 * 从本地路由表加载一级设置菜单。
 * @returns 无返回值。
 */
function loadMenuRoutes(): void {
  menuRoutes.value = router
    .getRoutes()
    .filter((item) => item.meta?.menu && item.path.split('/').length <= 2) as MenuRouterItemType[]
}

onMounted(loadMenuRoutes)
</script>

<template>
  <aside class="settings-sidebar">
    <div class="menu-list">
      <button
        v-for="menuRoute in menuRoutes"
        :key="String(menuRoute.name)"
        class="menu-item"
        :class="{ active: route.name === menuRoute.name }"
        type="button"
        @click="setActiveMenu(menuRoute)"
      >
        <div :class="menuRoute.meta?.menu?.icon ?? ''" class="menu-icon" />
        <span class="menu-label">{{ menuRoute.meta?.menu?.label ?? '' }}</span>
      </button>
    </div>
  </aside>
</template>

<style scoped>
.settings-sidebar {
  width: 200px;
  height: 100%;
  min-height: 0;
  border-right: 1px solid var(--divider-color);
}

.menu-list {
  height: 100%;
  box-sizing: border-box;
  overflow-y: auto;
  padding: 8px;
}

.menu-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
  padding: 10px 12px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-color);
  cursor: pointer;
  text-align: left;
}

.menu-item:hover {
  background: var(--hover-bg);
}

.menu-item.active {
  background: var(--active-bg);
  color: var(--primary-color);
  font-weight: 500;
}

.menu-icon {
  font-size: 18px;
}
</style>
