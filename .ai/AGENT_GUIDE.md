# AGENT_GUIDE.md — 在这个仓库里怎么干活

> 实战手册。先看这里，再按需跳转。

## 阅读顺序
1. `PROJECT.md` — 这是什么、技术栈、入口、边界（纯本地播放器）
2. `ARCHITECTURE.md` — 进程、边界（IPC/Comlink/MessagePort）、共享状态、窗口拓扑
3. `MODULES.md` — 每个功能在哪
4. `DATA_FLOW.md` — 播放/导入/持久化/同步的端到端流程
5. `API.md` — 具体可调接口
6. `CONVENTIONS.md` + `RISKS.md` — 动手前必读
7. `DEVELOPMENT.md` — 构建/运行/验证

## 速查表
| 关注点 | 位置 |
| --- | --- |
| 主进程启动 | `src/main/index.ts` → `app.ts`（`initGlobalData`、`initAppSetting`） |
| 主进程模块注册 | `src/main/modules/index.ts`（顺序：commonRenderers→winMain→hotKey→tray→appMenu→winLyric） |
| 主进程 IPC | `src/main/modules/*/rendererEvent*.ts`（winMain 是 `rendererEvent/` 目录） |
| IPC 名与封装 | `src/common/ipcNames.ts`、`mainIpc.ts`、`rendererIpc.ts` |
| 共享类型（全局 `LX`） | `src/common/types/*.d.ts` |
| 常量/默认值 | `src/common/constants.ts`、`defaultSetting.ts`、`config.ts` |
| 渲染进程启动 | `src/renderer/main.ts`、`core/useApp/index.ts`、`core/globalData.ts` |
| 路由 | `src/renderer/router.ts`（hash；仅 `/list`、`/setting`，其余重定向 `/list`） |
| 视图 | `src/renderer/views/{List,Setting}/` |
| 状态（无 Pinia） | `src/renderer/store/`（`player/`、`list/`、`dislikeList/`、`setting.ts`、`soundEffect.ts`、`index.ts`） |
| 播放引擎 | `src/renderer/core/player/action.ts` + `src/renderer/plugins/player/` |
| 资源解析（本地） | `src/renderer/core/music/{index,local,utils}.ts` |
| 渲染进程 IPC 门面 | `src/renderer/utils/ipc.ts` |
| 事件总线 | `src/renderer/event/appEvent.ts` → `window.app_event` |
| 渲染进程 Web Worker | `src/renderer/worker/main/` → `window.lx.worker.main` |
| 主进程 DB worker | `src/main/worker/` → `global.lx.worker.dbService` |
| 桌面歌词 | `src/renderer-lyric/` + `src/main/modules/winLyric/` |
| i18n | `src/lang/*.json` + `src/lang/i18n.ts` → `window.i18n` |
| 构建 | `build-config/{main,renderer,renderer-lyric}/` + `runner-dev.js`、`pack.js`、`build-pack.js` |

## 常见任务

### 加一个本地播放相关功能（推荐方向）
- 例如「音乐库扫描/路径修复」：复用 `main/modules/sync/musicFile/localFs.ts` 的
  `scanEntries/scanIndex` 与 `diff.ts` 的纯函数逻辑；列表写入走 `store/list/action`。
- 例如「在线匹配歌词/封面」：新建独立模块（建议 `main/modules/mediaMatch/`），
  用 `common/utils/request.ts` 取数据，歌词写回现有 lyric IPC，封面写 `meta.picUrl` 并 `updateListMusics`。

### 加一个 IPC 处理器（渲染进程调用主进程）
1. `src/common/ipcNames.ts` 加事件名（放对分组）
2. 渲染侧：`src/renderer/utils/ipc.ts` 加封装（`rendererInvoke`/`rendererSend`）
3. 主侧：在对应模块的 `rendererEvent*.ts` 里注册 `mainHandle`/`mainOn`
4. `npm run dev` 验证往返

### 加一个设置项
1. `src/common/defaultSetting.ts` 加默认值，`src/common/types/app_setting.d.ts` 加类型
2. 渲染侧读写：`appSetting['<group>.<key>']` / `updateSetting({ '<group>.<key>': v })`
3. UI 放在 `src/renderer/views/Setting/components/`，并在 `views/Setting/index.vue` 的 `tocList` 里登记
4. 主进程需要该值时读 `global.lx.appSetting`（变更通过 `updated_config` 事件到达）
5. 老版本迁移逻辑放 `src/common/utils/migrateSetting.ts`

### 加一个视图/路由
1. `src/renderer/views/<Feature>/index.vue`
2. `src/renderer/router.ts` 加路由（`require('...').default`）
3. 侧栏 `components/layout/Aside/NavBar.vue` 加导航项（`id/name` 与 `route.meta.name` 对应）
4. `src/lang` 三个语言文件加文案
5. 注意：工具栏标题按 `route.meta.name` 映射（`components/layout/Toolbar/index.vue`），需要时补映射

### 加一个主进程模块
1. `src/main/modules/<name>/index.ts` 默认导出 `registerX()`（幂等）+ `rendererEvent.ts`
2. 在 `src/main/modules/index.ts` 注册（顺序固定）
3. 若需要主进程事件，在 `src/main/event/` 加事件方法

### 改数据库
- DAO 在 `src/main/worker/dbService/modules/`；表结构在 `tables.ts`，迁移在 `migrate.ts`。
- **改表结构必须同时处理 `verifyDB` 与迁移**，否则 `init()` 返回 `null`，主进程备份旧库并重建（用户数据丢失）。
- 历史表（`music_url`/`music_info_other_source`/`download_list`）已在 DB v3 迁移中删除；
  新增表或改列时要同步 `tables.ts` + `verifyDB.ts` + `migrate.ts`（漏改会触发整库重建）。

### 改跨端同步
- 协议与特性协商：`src/common/constants_sync.ts`、`src/main/modules/sync/`
- `musicFile` 的 `diff.ts` 与移动端 1:1 镜像，改动必须两边同步（`tests/` 会比对）
- 改完跑 `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/music-file-sync.test.ts` 与 `tests/music-file-fs.test.ts`

## 验证（无测试框架）
- **必须** `npm run lint` + `npm run build`（构建内置 ESLint，失败即中断）
- 行为验证：`npm run dev`（渲染 HMR 端口 9080/9081，主进程改动会重启）
- 本地音乐文件同步：跑 `tests/` 下两个 node 脚本
- 平台差异：Windows 优先；跨平台代码用 `process.platform` 守卫

## 坑（详见 RISKS.md）
- **别名只存在于 webpack**（tsconfig `paths` 注释掉了），以构建结果为准，别信 IDE 报错
- **两套 worker**（`global.lx.worker.dbService` vs `window.lx.worker.main`）、**两套事件总线**（main vs renderer）
- **没有状态库**：跟随 `store/<domain>` 的 ref/action 模式
- **本地歌曲 id = 文件路径**：移动文件会使历史记录失效
- 渲染进程有 Node 能力（`nodeIntegration: true`），但仍要走 IPC 处理主进程职责

## 风格（详见 CONVENTIONS.md）
无 `var`、2 空格、单引号、函数括号前不留空格、多行结构尾逗号、用 `@-` 别名、
共享类型进 `src/common/types`（全局 `LX`）、IPC 名必须 import 常量、三语 i18n 同步更新。
