# Local LMDB

ZTools 只打开一个本地 LMDB 环境，固定位于 `.ztools/lmdb/local`。

环境内包含三个逻辑库：

- `main`：宿主与插件文档
- `meta`：本地 `_rev` 与更新时间
- `attachment`：附件内容及 MIME 元数据

宿主文档使用 `ZTOOLS/` 前缀，插件文档使用 `PLUGIN/<runtime-name>/` 前缀。开发插件继续通过独立 runtime name 隔离。数据库保留同步 API 与 Promise API、CRUD、批量操作、附件和 `_rev` 乐观并发控制。

该实现不包含账号路由、远端 revision、变更日志、冲突树、同步任务、检查点或旧数据导入。应用不会读取旧的 `device/accounts` 布局。
