/**
 * 桌面端「从列表移除本地歌曲时同时删除本地文件（含歌词/封面）」测试
 *
 * 运行：node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/local-music-remove.test.ts
 *
 * 与 tests/cover-match.test.ts 同一套路：把 TS 源码复制到临时目录、补齐相对导入，
 * 在 node 原生类型擦除下直接运行；fs 删除走桩函数，不触碰真实用户文件。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

let failed = 0
let passed = 0

const check = (name: string, actual: unknown, expected: unknown) => {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) {
    passed++
    console.log(`  ok   ${name}`)
  } else {
    failed++
    console.log(`  FAIL ${name}\n       actual   = ${a}\n       expected = ${b}`)
  }
}

const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url))
const readSource = (relPath: string) => fs.readFileSync(path.join(sourceRoot, relPath), 'utf8')
const moduleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-local-music-remove-'))

const writeModule = (fileName: string, code: string) => {
  fs.writeFileSync(path.join(moduleDir, fileName), code, 'utf8')
}

writeModule('musicSidecar.ts', readSource('common/utils/musicSidecar.ts'))
writeModule('nodejs.stub.ts', `
export const removeFile = async (filePath) => {
  globalThis.__deletedPaths.push(filePath)
  if (globalThis.__failAudio && filePath === globalThis.__audioPath) throw new Error('audio failed')
  if (globalThis.__failSidecar && filePath !== globalThis.__audioPath) throw new Error('sidecar failed')
}
`)
writeModule('log.stub.ts', `
export const log = {
  warn: (message) => { globalThis.__logs.push(message) },
}
`)
writeModule(
  'localMusicFile.ts',
  readSource('renderer/utils/localMusicFile.ts')
    .replace(/from '@common\/utils\/musicSidecar'/g, "from './musicSidecar.ts'")
    .replace(/from '@common\/utils\/nodejs'/g, "from './nodejs.stub.ts'")
    .replace(/from '@common\/utils'$/gm, "from './log.stub.ts'"),
)

const load = async(name: string) => import(pathToFileURL(path.join(moduleDir, name + '.ts')).href)

const { getLocalMusicSidecarPaths, isAbsoluteLocalMusicPath } = await load('musicSidecar')
const { deleteLocalMusicFiles } = await load('localMusicFile')

console.log('\n== 同名附属文件路径（Windows）==')
const winAudio = "E:\\Music\\Petit Rabbit's\\Daydream café.mp3"
const winPaths = getLocalMusicSidecarPaths(winAudio)
const winStem = "E:\\Music\\Petit Rabbit's\\Daydream café"
const expectedWinPaths = [
  `${winStem}.lrc`,
  `${winStem}.LRC`,
  `${winStem}.lrc.bak`,
  `${winStem}.LRC.bak`,
  `${winStem}.lrc.tmp`,
  `${winStem}.LRC.tmp`,
  `${winStem}.lrc.restore.tmp`,
  `${winStem}.LRC.restore.tmp`,
  `${winStem}.lrc.rollback.tmp`,
  `${winStem}.LRC.rollback.tmp`,
  `${winStem}.krc`,
  `${winStem}.KRC`,
  `${winStem}.jpg`,
  `${winStem}.png`,
  `${winStem}.jpg.bak`,
  `${winStem}.png.bak`,
  `${winStem}.jpg.tmp`,
  `${winStem}.png.tmp`,
  `${winStem}.jpg.rollback.tmp`,
  `${winStem}.png.rollback.tmp`,
  `${winStem}.jpg.bak.replaced.tmp`,
  `${winStem}.png.bak.replaced.tmp`,
]
check('Windows 路径生成 22 个附属文件', winPaths, expectedWinPaths)
check('全部位于歌曲同目录', winPaths.every(p => p.startsWith("E:\\Music\\Petit Rabbit's\\")), true)
check('不包含音频自身', winPaths.includes(winAudio), false)
check('包含歌词/备份/临时', [
  winPaths.includes(`${winStem}.lrc`),
  winPaths.includes(`${winStem}.lrc.bak`),
  winPaths.includes(`${winStem}.lrc.tmp`),
  winPaths.includes(`${winStem}.lrc.restore.tmp`),
  winPaths.includes(`${winStem}.lrc.rollback.tmp`),
], [true, true, true, true, true])
check('包含桌面端兼容的 .krc 歌词', [winPaths.includes(`${winStem}.krc`), winPaths.includes(`${winStem}.KRC`)], [true, true])
check('包含封面/备份/回滚临时文件', [
  winPaths.includes(`${winStem}.jpg`),
  winPaths.includes(`${winStem}.png`),
  winPaths.includes(`${winStem}.jpg.bak`),
  winPaths.includes(`${winStem}.png.bak`),
  winPaths.includes(`${winStem}.jpg.rollback.tmp`),
  winPaths.includes(`${winStem}.png.bak.replaced.tmp`),
], [true, true, true, true, true, true])
check('无重复路径', new Set(winPaths).size, winPaths.length)

console.log('\n== 路径边界 ==')
check('POSIX 绝对路径', getLocalMusicSidecarPaths('/storage/emulated/0/Music/song.flac').slice(0, 2), ['/storage/emulated/0/Music/song.lrc', '/storage/emulated/0/Music/song.LRC'])
check('多扩展名只去最后一个', getLocalMusicSidecarPaths('/m/a.b.flac')[0], '/m/a.b.lrc')
check('无扩展名音频', getLocalMusicSidecarPaths('/m/noext')[0], '/m/noext.lrc')
check('目录带点仍按文件名扩展名处理', getLocalMusicSidecarPaths('/m.d/song.mp3')[0], '/m.d/song.lrc')
check('UNC 路径', getLocalMusicSidecarPaths('\\\\server\\share\\song.mp3')[0], '\\\\server\\share\\song.lrc')
check('URI 返回空', [
  getLocalMusicSidecarPaths('file:///C:/Music/song.mp3'),
  getLocalMusicSidecarPaths('content://media/external/audio/1.mp3'),
], [[], []])
check('相对路径返回空', [
  getLocalMusicSidecarPaths('Music/song.mp3'),
  getLocalMusicSidecarPaths('C:song.mp3'),
  getLocalMusicSidecarPaths(''),
], [[], [], []])
check('音频本身是附属文件时返回空（不自我删除）', [
  getLocalMusicSidecarPaths('/m/song.lrc'),
  getLocalMusicSidecarPaths('/m/song.lrc.bak'),
  getLocalMusicSidecarPaths('/m/song.jpg'),
  getLocalMusicSidecarPaths('/m/song.png'),
], [[], [], [], []])
check('绝对路径判定', [
  isAbsoluteLocalMusicPath('/m/song.mp3'),
  isAbsoluteLocalMusicPath('E:\\Music\\song.mp3'),
  isAbsoluteLocalMusicPath('\\\\server\\share\\song.mp3'),
  isAbsoluteLocalMusicPath('file:///E:/Music/song.mp3'),
  isAbsoluteLocalMusicPath('Music/song.mp3'),
], [true, true, true, false, false])

console.log('\n== 删除接线 ==')

const reset = (audioPath = '/m/song.mp3') => {
  globalThis.__deletedPaths = []
  globalThis.__logs = []
  globalThis.__failAudio = false
  globalThis.__failSidecar = false
  globalThis.__audioPath = audioPath
}

reset()
await deleteLocalMusicFiles({ meta: { filePath: '/m/song.mp3' } })
check('删除音频 + 22 个附属文件', globalThis.__deletedPaths.length, 23)
check('先删除音频再删附属文件', globalThis.__deletedPaths[0], '/m/song.mp3')
check('包含歌词/封面及备份', [
  globalThis.__deletedPaths.includes('/m/song.lrc'),
  globalThis.__deletedPaths.includes('/m/song.lrc.bak'),
  globalThis.__deletedPaths.includes('/m/song.lrc.rollback.tmp'),
  globalThis.__deletedPaths.includes('/m/song.krc'),
  globalThis.__deletedPaths.includes('/m/song.jpg'),
  globalThis.__deletedPaths.includes('/m/song.jpg.bak'),
  globalThis.__deletedPaths.includes('/m/song.png.bak'),
], [true, true, true, true, true, true, true])

reset()
globalThis.__failSidecar = true
let sidecarOk = true
try {
  await deleteLocalMusicFiles({ meta: { filePath: '/m/song.mp3' } })
} catch {
  sidecarOk = false
}
check('附属文件删除失败静默忽略（不抛错）', sidecarOk, true)
check('附属文件删除失败时音频仍已删除', globalThis.__deletedPaths.includes('/m/song.mp3'), true)

reset()
globalThis.__failAudio = true
let audioOk = true
try {
  await deleteLocalMusicFiles({ meta: { filePath: '/m/song.mp3' } })
} catch {
  audioOk = false
}
check('音频删除失败不抛错（不阻断列表移除）', audioOk, true)
check('音频删除失败时保留附属文件（避免半删）', globalThis.__deletedPaths, ['/m/song.mp3'])
check('音频删除失败写入日志', globalThis.__logs.length, 1)

reset()
await deleteLocalMusicFiles({ meta: { filePath: 'relative/song.mp3' } })
await deleteLocalMusicFiles({ meta: { filePath: '' } })
check('相对路径/空路径不删除任何文件', globalThis.__deletedPaths, [])

console.log('\n== 设置与 UI 接线 ==')
check('默认值关闭', /'list\.isDeleteLocalFileWhenRemove': false,/.test(readSource('common/defaultSetting.ts')), true)
check('设置类型声明', /'list\.isDeleteLocalFileWhenRemove': boolean/.test(readSource('common/types/app_setting.d.ts')), true)
check('设置页开关接线', readSource('renderer/views/Setting/components/SettingList.vue').includes("appSetting['list.isDeleteLocalFileWhenRemove']"), true)
const removeActionSource = readSource('renderer/views/List/MusicList/useMusicActions.js')
check('移除流程接线', removeActionSource.includes('deleteLocalMusicFiles'), true)
check('单删文件提示接线', removeActionSource.includes('lists__remove_local_file_tip'), true)
check('多选文件提示接线', removeActionSource.includes('lists__remove_music_local_file_tip'), true)
for (const lang of ['zh-cn', 'zh-tw', 'en-us', 'ko-kr']) {
  const dict = JSON.parse(readSource(`lang/${lang}.json`)) as Record<string, unknown>
  check(`语言包 ${lang} 文案`, [
    typeof dict.setting__list_delete_local_file_when_remove,
    typeof dict.lists__remove_local_file_tip,
    typeof dict.lists__remove_music_local_file_tip,
  ], ['string', 'string', 'string'])
}

fs.rmSync(moduleDir, { recursive: true, force: true })
console.log(failed ? `\nresult: ${passed} passed, ${failed} failed` : `\nresult: ${passed} passed, 0 failed`)
process.exit(failed ? 1 : 0)
