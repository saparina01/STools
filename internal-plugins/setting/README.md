# Setting 内置插件（`internal-plugins/setting`）

ZTools 的设置中心子项目，负责承载“通用设置、快捷键、插件管理、插件市场、同步、数据、调试、关于”等系统级配置页面。

这是一个可独立开发和构建的前端插件工程，通过 `plugin.json` 接入宿主，并通过 `window.ztools` / `window.ztools.internal` 与桌面端能力通信。

## 技术栈

- `Vue 3`
- `TypeScript`
- `Vue Router`（Hash 路由）
- `Vite`
- `UnoCSS`

## 功能范围（当前路由）

菜单页（含左侧导航）：

- `GeneralSetting`：通用设置
- `Shortcuts`：快捷键
- `Plugins`：已安装插件
- `Market`：插件市场
- `AiModels`：AI 模型
- `Data`：我的数据
- `AllCommands`：所有指令
- `LocalLaunch`：本地启动
- `Debug`：调试日志
- `HttpService`：HTTP 服务
- `About`：关于

特殊页面（非菜单项）：

- `PluginInstaller`：插件安装流程页

## 宿主事件与路由分发

入口在 `src/main.ts`：

1. 统一监听 `ztools.onPluginEnter`
2. 将事件转为 `ZtoolsCodeEvent` 并派发到 `window`
3. 基础事件处理器监听 `ui.router`，按参数跳转到对应页面
4. 业务事件在 `src/events/allCodeEvent.ts` 注册（如安装插件、添加开发中插件、插件市场搜索等）

这套机制的目标是把“入口事件解析”和“页面业务逻辑”解耦，新增 code 事件时只需在事件模块中扩展。

## 主题初始化

`SettingHone.vue` 在挂载时会读取 `settings-general`，并统一应用：

- `theme`：`system | light | dark`
- `primaryColor`：`blue | purple | green | orange | red | pink | custom`
- `customColor`

主题工具集中在 `src/utils/themeUtils.ts`，用于避免各页面重复实现主题逻辑。

## 项目结构

```text
internal-plugins/setting
├─ public/
│  ├─ plugin.json            # 插件声明（features/code/development main）
│  └─ preload/package.json
├─ src/
│  ├─ components/            # 布局与通用组件（含 SettingHone、Toast、Dialog 等）
│  ├─ views/                 # 各设置页面
│  ├─ router/                # 路由与菜单定义
│  ├─ events/                # code 事件模型与分发
│  ├─ composables/           # 复用逻辑
│  ├─ utils/                 # 工具函数（含主题工具、搜索工具等）
│  ├─ assets/                # 图标与样式资源
│  └─ main.ts                # 应用入口
├─ vite.config.ts
└─ package.json
```

## 本地开发

在仓库根目录执行：

```bash
pnpm -C "internal-plugins/setting" dev
```

默认端口是 `5177`（`vite.config.ts` 已设置 `strictPort: true`）。

`public/plugin.json` 的开发入口已指向：

```text
http://127.0.0.1:5177
```

如果你从主工程整体启动，也可直接运行根目录的开发命令。

## 构建

```bash
pnpm -C "internal-plugins/setting" build
```

构建流程：

- `vue-tsc` 类型检查
- `vite build` 产物构建

输出目录：`internal-plugins/setting/dist`

## 扩展约定（新增设置页）

1. 在 `src/views` 新建页面组件
2. 在 `src/router/router.ts` 注册路由（如需出现在左侧菜单，补充 `meta.menu`）
3. 如需命令入口，从 `public/plugin.json` 增加 `features.code`
4. 如需处理自定义 code 事件，在 `src/events/allCodeEvent.ts` 通过 `addZtoolsCodeEventListener` 注册

## 开发原则

- KISS：页面只处理展示和交互，复杂逻辑下沉到 `composables` / `utils`
- DRY：跨页面能力优先抽到公共组件与工具模块
- YAGNI：只实现当前设置项需求，不预埋未使用的配置链路
- SOLID：事件分发、路由、视图、工具函数按职责分离，避免耦合膨胀
