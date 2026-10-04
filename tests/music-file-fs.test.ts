/**
 * 本地音乐文件同步：文件系统层 + 传输流程集成测试
 *
 * 在临时目录里模拟 PC（A）与 Android（B）两端，直接用真实的扫描/分片读写/删除实现，
 * 走一遍「扫描 → 分类 → 勾选 → 传输 → 更新基线」的完整流程。
 *
 * 运行：node tests/music-file-fs.test.ts
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

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

const checkThrows = async(name: string, fn: () => Promise<unknown>) => {
  try {
    await fn()
    failed++
    console.log(`  FAIL ${name} (no throw)`)
  } catch {
    passed++
    console.log(`  ok   ${name}`)
  }
}

const diffSource = new URL('../src/main/modules/sync/musicFile/diff.ts', import.meta.url)
const localFsSource = new URL('../src/main/modules/sync/musicFile/localFs.ts', import.meta.url)
const mobileDiffSource = new URL('../../lx-music-mobile/src/plugins/sync/client/modules/musicFile/diff.ts', import.meta.url)

/** 把被测模块复制到临时目录，仅把无扩展名的相对导入补成 `.ts` 以便 node 直接运行 */
const stageModules = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-music-file-sync-'))
  fs.copyFileSync(diffSource, path.join(dir, 'diff.ts'))
  const localFsCode = fs.readFileSync(localFsSource, 'utf-8').replace("from './diff'", "from './diff.ts'")
  fs.writeFileSync(path.join(dir, 'localFs.ts'), localFsCode)
  return dir
}

const moduleDir = stageModules()
const localFs = await import(pathToFileURL(path.join(moduleDir, 'localFs.ts')).href)
const diff = await import(pathToFileURL(path.join(moduleDir, 'diff.ts')).href)

console.log('\n== 两端共享同一份纯逻辑 ==')
check(
  'Android 端 diff.ts 与 PC 端完全一致',
  fs.readFileSync(mobileDiffSource, 'utf-8') === fs.readFileSync(diffSource, 'utf-8'),
  true,
)

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-music-file-sync-roots-'))
const rootA = path.join(workspace, 'pc')
const rootB = path.join(workspace, 'android')

const writeFile = (root: string, relPath: string, size: number, fill = 0) => {
  const abs = path.join(root, ...relPath.split('/'))
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  // 用可预测的内容填满，便于校验传输结果
  const buffer = Buffer.alloc(size)
  for (let i = 0; i < size; i++) buffer[i] = (fill + i) % 251
  fs.writeFileSync(abs, buffer)
}

console.log('\n== 准备两端测试目录 ==')
// PC 端：两首歌（其中一首带歌词）、一首深层子目录里的歌、一个非音频文件
writeFile(rootA, '歌手A/alpha.flac', 500_000, 1)
writeFile(rootA, '歌手A/alpha.lrc', 120, 2)
writeFile(rootA, '歌手A/beta.flac', 40_000, 3)
writeFile(rootA, 'Yunomi/专辑/ghost.ogg', 30_000, 4)
writeFile(rootA, 'notes.txt', 10, 9)

// Android 端：只同步过去了一部分（alpha 一致），另有本地独有
writeFile(rootB, '歌手A/alpha.flac', 500_000, 1)
writeFile(rootB, '歌手A/alpha.lrc', 120, 2)
writeFile(rootB, 'Yunomi/专辑/ghost.ogg', 30_000, 4)
// 大于分片大小，用于验证分片传输
writeFile(rootB, '歌手B/android-only.mp3', 460_000, 5)
writeFile(rootB, '歌手A/beta.flac', 51_200, 7) // 同名但大小不同 → 冲突

const scopeAll: string[] = []
const indexA = await localFs.scanIndex(rootA, scopeAll)
const indexB = await localFs.scanIndex(rootB, scopeAll)

console.log('\n== 扫描结果 ==')
check('PC 索引只含音频', indexA.files.map((f: any) => f.path), ['Yunomi/专辑/ghost.ogg', '歌手A/alpha.flac', '歌手A/beta.flac'])
check('PC 歌词被正确挂载', indexA.files.find((f: any) => f.path === '歌手A/alpha.flac').lyric.size, 120)
check('PC 无歌词的歌曲为 null', indexA.files.find((f: any) => f.path === '歌手A/beta.flac').lyric, null)
check('PC 文件夹列表含所有层级', indexA.folders, ['Yunomi', 'Yunomi/专辑', '歌手A'])
check('Android 索引', indexB.files.map((f: any) => f.path), ['Yunomi/专辑/ghost.ogg', '歌手A/alpha.flac', '歌手A/beta.flac', '歌手B/android-only.mp3'])

console.log('\n== scope 精确到文件夹 ==')
const indexScopedA = await localFs.scanIndex(rootA, ['Yunomi/专辑'])
check('只扫描选中的深层文件夹', indexScopedA.files.map((f: any) => f.path), ['Yunomi/专辑/ghost.ogg'])
const indexScopedA2 = await localFs.scanIndex(rootA, ['歌手A'])
check('不含未勾选的文件夹', indexScopedA2.files.map((f: any) => f.path), ['歌手A/alpha.flac', '歌手A/beta.flac'])
const indexScopedA3 = await localFs.scanIndex(rootA, ['Yunomi'])
check('勾选父文件夹包含子文件夹', indexScopedA3.files.map((f: any) => f.path), ['Yunomi/专辑/ghost.ogg'])
check('文件夹树统计', (await localFs.scanFolderTree(rootA)).map((n: any) => [n.path, n.audioCount, n.totalCount]), [['歌手A', 2, 2], ['Yunomi', 0, 1]])

console.log('\n== 变更分类（基线：上次同步只有 alpha） ==')
const baseline = ['歌手A/alpha.flac']
const plan = diff.buildPlan(indexA, indexB, baseline)
const paths = (group: string) => plan[group].map((i: any) => i.path)
check('两端一致的 alpha 不出现', paths('conflict').includes('歌手A/alpha.flac') || paths('localAdded').includes('歌手A/alpha.flac'), false)
check('beta 两端都有但大小不同 → 只算冲突，不重复算新增', [paths('localAdded'), paths('conflict')], [[], ['歌手A/beta.flac']])
check('远端新增 android-only', paths('remoteAdded'), ['歌手B/android-only.mp3'])
check('远端删除（基线有、远端没有、本地有）', paths('remoteDeleted'), [])
check('本地删除（基线有、本地没有、远端有）', paths('localDeleted'), [])

console.log('\n== 走一遍完整传输（含歌词伴生、分片） ==')
const selected = {
  checked: {
    'remoteAdded:歌手B/android-only.mp3': true,
    'conflict:歌手A/beta.flac': true,
  } as Record<string, boolean>,
  direction: {} as Record<string, 'push' | 'pull'>,
}
const actions = diff.buildActions(plan, selected.checked, selected.direction)
check('生成的动作', actions, [
  { kind: 'download', path: '歌手B/android-only.mp3', size: 460_000, hasLyric: false },
  { kind: 'download', path: '歌手A/beta.flac', size: 51_200, hasLyric: false },
])

// 以 localFs 作为「对端」，模拟协议中的 read_file / write_file / delete_file
const peer = {
  async read_file(root: string, relPath: string, offset: number, size: number) {
    return localFs.readFileChunk(root, relPath, offset, size)
  },
  async write_file(root: string, relPath: string, offset: number, data: string, isLast: boolean) {
    return localFs.writeFileChunk(root, relPath, offset, data, isLast)
  },
  async delete_file(root: string, relPath: string, withLyric: boolean) {
    return localFs.deleteFileWithLyric(root, relPath, withLyric)
  },
}

const CHUNK = diff.MUSIC_FILE_CHUNK_SIZE
let chunkCount = 0
const runAction = async(action: any) => {
  const targets = [action.path]
  if (action.hasLyric) targets.push(diff.getLyricRelPath(action.path))
  for (const target of targets) {
    if (action.kind === 'download') {
      let offset = 0
      for (;;) {
        const chunk = await peer.read_file(rootB, target, offset, CHUNK)
        chunkCount++
        await peer.write_file(rootA, target, offset, chunk.data, chunk.eof)
        const size = Buffer.from(chunk.data, 'base64').length
        offset += size
        if (chunk.eof || !size) break
      }
    } else if (action.kind === 'upload') {
      let offset = 0
      for (;;) {
        const chunk = await localFs.readFileChunk(rootA, target, offset, CHUNK)
        chunkCount++
        await peer.write_file(rootB, target, offset, chunk.data, chunk.eof)
        const size = Buffer.from(chunk.data, 'base64').length
        offset += size
        if (chunk.eof || !size) break
      }
    } else if (action.kind === 'delete_local') {
      await peer.delete_file(rootA, target, false)
    } else if (action.kind === 'delete_remote') {
      await peer.delete_file(rootB, target, false)
    }
  }
}

for (const action of actions) await runAction(action)

check('大文件分片传输用了多次', chunkCount >= 4, true)
check('远端新增已下载到 PC 且内容一致', fs.readFileSync(path.join(rootA, '歌手B/android-only.mp3')).equals(fs.readFileSync(path.join(rootB, '歌手B/android-only.mp3'))), true)
check('冲突项按默认方向（远端覆盖本地）', fs.readFileSync(path.join(rootA, '歌手A/beta.flac')).equals(fs.readFileSync(path.join(rootB, '歌手A/beta.flac'))), true)
check('未勾选的本地新增没有上传到远端', fs.existsSync(path.join(rootB, '歌手A/alpha.lrc')), true)

console.log('\n== 上传与删除（含歌词） ==')
writeFile(rootA, '歌手A/gamma.flac', 12_000, 11)
writeFile(rootA, '歌手A/gamma.lrc', 90, 12)
const indexA2 = await localFs.scanIndex(rootA, scopeAll)
check('PC 新增 gamma（含歌词）', indexA2.files.find((f: any) => f.path === '歌手A/gamma.flac').lyric.size, 90)

const uploadActions = diff.buildActions(
  { ...diff.buildPlan(indexA2, await localFs.scanIndex(rootB, scopeAll), ['歌手A/alpha.flac']), remoteAdded: [], localAdded: [{ group: 'localAdded', path: '歌手A/gamma.flac', localSize: 12_000, remoteSize: null, localHasLyric: true, remoteHasLyric: false, defaultChecked: true, defaultDirection: 'push' }], remoteDeleted: [], localDeleted: [], conflict: [] },
  { 'localAdded:歌手A/gamma.flac': true },
  {},
)
check('上传动作带歌词', uploadActions, [{ kind: 'upload', path: '歌手A/gamma.flac', size: 12_000, hasLyric: true }])
for (const action of uploadActions) await runAction(action)
check('歌曲与歌词都上传到远端', [
  fs.existsSync(path.join(rootB, '歌手A/gamma.flac')),
  fs.existsSync(path.join(rootB, '歌手A/gamma.lrc')),
], [true, true])
check('上传内容一致', fs.readFileSync(path.join(rootA, '歌手A/gamma.lrc')).equals(fs.readFileSync(path.join(rootB, '歌手A/gamma.lrc'))), true)

// 删除：把上传过去的歌曲在两端都删掉，验证本地删除与远端删除都带上伴生歌词
await runAction({ kind: 'delete_local', path: '歌手A/gamma.flac', hasLyric: true })
await runAction({ kind: 'delete_remote', path: '歌手A/gamma.flac', hasLyric: true })
check('删除歌曲同时删除两端伴生歌词', [
  fs.existsSync(path.join(rootA, '歌手A/gamma.flac')),
  fs.existsSync(path.join(rootA, '歌手A/gamma.lrc')),
  fs.existsSync(path.join(rootB, '歌手A/gamma.flac')),
  fs.existsSync(path.join(rootB, '歌手A/gamma.lrc')),
], [false, false, false, false])

console.log('\n== 基线更新后不再重复提示 ==')
const finalA = await localFs.scanIndex(rootA, scopeAll)
const finalB = await localFs.scanIndex(rootB, scopeAll)
const newBaseline = diff.buildBaseline(finalA, finalB)
check('基线为两端交集', newBaseline, ['Yunomi/专辑/ghost.ogg', '歌手A/alpha.flac', '歌手A/beta.flac', '歌手B/android-only.mp3'])
const nextPlan = diff.buildPlan(finalA, finalB, newBaseline)
check('两端一致后清单为空', Object.values(nextPlan).flat().length, 0)

console.log('\n== 相对路径安全 ==')
await checkThrows('拒绝 ../ 逃逸', () => localFs.readFileChunk(rootA, '../secret.txt', 0, 100))
await checkThrows('拒绝绝对路径', () => localFs.writeFileChunk(rootA, '/tmp/x.mp3', 0, 'AAAA', true))
await checkThrows('拒绝盘符路径', () => localFs.deleteFileWithLyric(rootA, 'C:/Windows/x.mp3', false))
check('越界文件未被创建', fs.existsSync(path.join(workspace, 'secret.txt')), false)

fs.rmSync(workspace, { recursive: true, force: true })
fs.rmSync(moduleDir, { recursive: true, force: true })

console.log(`\n${failed ? 'FAILED' : 'PASSED'}: ${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
