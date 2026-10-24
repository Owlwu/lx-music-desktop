# CONVENTIONS.md — 代码风格与模式

> 照这些写，新代码才和现有代码一致。ESLint 在**每次构建**里跑，风格/规则错误会直接让构建失败。
> 配置：`.eslintrc.base.cjs` + 各目录 overrides。

## 语言与文件风格
- **ESM**（`import`/`export`），由 webpack 打包；应用源码里不用 `require`
  （唯一例外：`main/modules/sync/musicFile/peer.ts` 为规避循环初始化而延迟 `require`，已加 eslint-disable）
- TypeScript 与少量 JS 共存（`allowJs: true`）
- **禁用 `var`**；用 `const`/`let`
- 2 空格缩进、单引号、**函数名后不留空格**（`function foo()` / `const foo = () => {}`）
- 多行结构尾逗号（`comma-dangle: always-multiline`）
- camelcase 关闭，混合命名常见（`musicInfo`、`listDetailInfo`）；与邻居保持一致
- **尽量不写注释**；需要时简短，可用中文（项目语言 zh-CN）

## 导入与别名（以 webpack 为准）
- `@root` → `src/`、`@main` → `src/main/`、`@renderer` → `src/renderer/`、
  `@lyric` → `src/renderer-lyric/`、`@common` → `src/common/`、`@static` → `src/static/`
- `@static` 只在 renderer / renderer-lyric bundle 中定义

## 类型与 `LX` 命名空间
- 共享类型放 `src/common/types/*.d.ts`（**ambient**），声明全局 `LX` 命名空间，
  直接写 `LX.Music.MusicInfoLocal`、`LX.Player.LyricInfo`，**不需要 import**
- 该目录同时声明 `window.lx` / `window.app_event` / `window.i18n` 与 `NodeJS.ProcessVersions.app`
- 新增共享类型：加进 `src/common/types/` 的 `declare namespace LX`

## Vue（渲染进程）
- Vue 3 Composition API，`ref`/`reactive`/`computed`（来自 `@common/utils/vueTools`）
- `.vue` 的模板用 `<template lang="pug">`，样式用 `less`（`module`）
- 响应式尺寸用 **rem**：CSS 里写 `px`，由 `postcss-pxtorem` 转换；不要手写 rem
- SVG 图标在 `src/renderer/assets/svgs`，`svg-sprite-loader` 打包成 sprite，用 `<use href="#icon-...">`
- 窗口控制按钮位置由 `common.controlBtnPosition` 决定：`right` 时在主窗口工具栏（`components/layout/Toolbar/index.vue`，
  左侧是页面标题、右侧是最小化/关闭），`left` 时在侧栏（`components/layout/Aside/index.vue`）

## 状态（无 Pinia/Vuex）
- 渲染进程状态是普通 Vue 响应式对象，放 `src/renderer/store/`：
  `player/`、`list/`（含 `listManage/`）、`dislikeList/`，以及 `setting.ts`、`soundEffect.ts`、`utils.ts`、`index.ts`
- 模式：每域 `state.ts`（refs）+ `action.ts`（改状态的函数）；没有 mutation 概念
- 主进程共享状态是 `global.lx`（见 `ARCHITECTURE.md`），**不是响应式**

## 事件系统
- 渲染进程总线：`window.app_event`（`createAppEventHub()`，`src/renderer/event/appEvent.ts`），
  用类型化方法 emit、`.on/.off` 订阅；键盘事件在 `window.key_event`
- 主进程总线：`global.lx.event_app` 等（`src/main/event/`，`createAppEvent()` 等），
  事件如 `updated_config`、`player_status`。**两套不要混**
- 跨进程一律 IPC

## IPC（渲染 ⇄ 主）
- **不硬编码事件名**，从 `src/common/ipcNames.ts` import
  （`CMMON_EVENT_NAME`、`WIN_MAIN_RENDERER_EVENT_NAME`、`WIN_LYRIC_RENDERER_EVENT_NAME`、`HOTKEY_RENDERER_EVENT_NAME`）
- 渲染侧调用统一进 `src/renderer/utils/ipc.ts`（`rendererInvoke`/`rendererSend`/`rendererOn`）
- 主侧用 `mainHandle`/`mainOn`；推送用 `sendEvent`
- 主侧处理器按模块分组：`modules/*/rendererEvent*.ts`（winMain 是 `rendererEvent/` 目录，一文件一关注点）

## 主进程模块结构
`src/main/modules/<name>/`：
- `index.ts` — 默认导出 `registerX()`（幂等），内部接 `rendererEvent`
- `rendererEvent.ts`（或目录）— 默认导出注册 `mainHandle`/`mainOn`
- 可选 `main.ts`、`utils.ts`、`config.ts`
注册顺序固定在 `src/main/modules/index.ts`：
`commonRenderers → winMain → hotKey → tray → appMenu → winLyric`。
同步模块（`sync/`）的启停经 `winMain` 的 `sync_action` IPC 调用，其默认导出负责窗口关闭时断开连接。

## 本地音乐数据模型
- `LX.Music.MusicInfoLocal`：`{ id: filePath, source: 'local', name, singer, interval, meta: { filePath, albumName, ext, picUrl?, songId? } }`
- **`id` 就是文件绝对路径**；`meta.filePath` 与 `id` 同源（移动/改名会使记录失效）
- `LX.Source = 'local'`（`LX.OnlineSource` 类型仍在，但不再有在线实现）
- 歌词类型 `LX.Music.LyricInfo = { lyric, tlyric?, rlyric?, lxlyric? }`
- `LX.Music.MusicInfo` 即本地歌曲（`source: 'local'`），`MusicInfoLocal` 是等价别名；
  `LX.Download`、`LX.Quality`、`LX.Music.MusicInfoOnline` 均已删除

## 请求与错误
- 主进程请求：`httpFetch`（`src/main/utils/request.ts`，基于 `common/utils/request.ts` 的 undici 封装）
- 请求失败文案在 `src/renderer/utils/message.ts`（`requestMsg.*`）
- 面向用户的错误必须走 i18n；抛错用 `throw new Error(window.i18n.t('...'))`

## i18n
- 三种主语言：`src/lang/zh-cn.json`、`en-us.json`、`zh-tw.json`（另有 `ko-kr.json`）
- TS 里 `window.i18n.t('key', { val })`；模板里 `$t('key')`
- 新增文案要**三个语言都加**（缺省回退 zh-cn）；key 形如 `prefix__name`
- 动态 key 常见（如 `theme_' + id`），命名要可预测

## 命名
- 文件名 lowerCamel（工具/模块），Vue 组件 PascalCase `.vue`
- 视图/组件按功能分组：`views/List/{MyList,MusicList}`、`views/Setting/components`
