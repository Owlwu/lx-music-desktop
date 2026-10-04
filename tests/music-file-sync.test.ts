/**
 * 本地音乐文件同步：纯逻辑回归测试
 *
 * 直接使用 node 运行（Node 24 原生支持 TypeScript 类型擦除）：
 *   node tests/music-file-sync.test.ts   （在 lx-music-desktop 目录下执行）
 */
import {
  buildIndex,
  buildPlan,
  buildActions,
  buildBaseline,
  isSafeRelPath,
  isPathInScope,
  normalizeScope,
  getLyricRelPath,
  assertSafeRelPath,
  planSelectionKey,
  type FileIndex,
  type PlanGroups,
  type ScanEntry,
} from '../src/main/modules/sync/musicFile/diff.ts'

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

const checkThrows = (name: string, fn: () => unknown) => {
  try {
    fn()
    failed++
    console.log(`  FAIL ${name} (no throw)`)
  } catch {
    passed++
    console.log(`  ok   ${name}`)
  }
}

const file = (path: string, size: number, lyricSize: number | null = null): ScanEntry[] => {
  const list: ScanEntry[] = [{ path, size, mtime: 1000 }]
  if (lyricSize != null) list.push({ path: getLyricRelPath(path), size: lyricSize, mtime: 2000 })
  return list
}

const indexOf = (...entries: ScanEntry[][]): FileIndex => buildIndex(entries.flat())

const selected = (plan: PlanGroups, groups: Array<[keyof PlanGroups, string]>) => {
  const map: Record<string, boolean> = {}
  for (const group of Object.keys(plan) as Array<keyof PlanGroups>) {
    for (const item of plan[group]) map[planSelectionKey(group, item.path)] = false
  }
  for (const [group, path] of groups) map[planSelectionKey(group, path)] = true
  return map
}

console.log('\n== 相对路径安全校验 ==')
check('normal nested path ok', isSafeRelPath('Yunomi/xxx.flac'), true)
check('single file ok', isSafeRelPath('a.mp3'), true)
check('empty rejected', isSafeRelPath(''), false)
check('absolute rejected', isSafeRelPath('/etc/passwd'), false)
check('drive letter rejected', isSafeRelPath('C:/Windows/x.mp3'), false)
check('parent escape rejected', isSafeRelPath('../secret.mp3'), false)
check('inner parent escape rejected', isSafeRelPath('a/../../secret.mp3'), false)
check('dot segment rejected', isSafeRelPath('a/./b.mp3'), false)
check('backslash rejected', isSafeRelPath('a\\b.mp3'), false)
check('trailing slash rejected', isSafeRelPath('a/b/'), false)
check('empty segment rejected', isSafeRelPath('a//b.mp3'), false)
checkThrows('assertSafeRelPath throws on escape', () => assertSafeRelPath('../../x'))

console.log('\n== 歌词伴生路径与索引 ==')
check('lyric path for flac', getLyricRelPath('a/b/c.flac'), 'a/b/c.lrc')
check('lyric path without ext', getLyricRelPath('a/b/c'), 'a/b/c.lrc')

const basic = indexOf(file('a/song.flac', 100, 10), file('root.mp3', 50), [{ path: 'notaudio.txt', size: 1, mtime: 0 }])
check('only audio files indexed', basic.files.map(f => f.path), ['a/song.flac', 'root.mp3'])
check('lyric attached to audio', basic.files[0].lyric, { size: 10, mtime: 2000 })
check('lyric absent -> null', basic.files[1].lyric, null)
check('folders collected', basic.folders, ['a'])
check('orphan lyric ignored', indexOf([{ path: 'a/only.lrc', size: 10, mtime: 0 }]).files, [])
check('nested folders collected', indexOf(file('a/b/c/d.mp3', 1)).folders, ['a', 'a/b', 'a/b/c'])

console.log('\n== scope 过滤 ==')
check('empty scope = all', isPathInScope('a/b/c.mp3', []), true)
check('exact folder', isPathInScope('a/c.mp3', ['a']), true)
check('nested folder', isPathInScope('a/b/c.mp3', ['a/b']), true)
check('descendant of selected', isPathInScope('a/b/c.mp3', ['a']), true)
check('outside scope', isPathInScope('x/c.mp3', ['a']), false)
check('sibling prefix not matched', isPathInScope('ab/c.mp3', ['a']), false)
check('root file outside scope', isPathInScope('c.mp3', ['a']), false)
check('normalizeScope dedupes children', normalizeScope(['a', 'a/b', 'c']), ['a', 'c'])

console.log('\n== 变更分类 ==')
const baseline = ['a.flac', 'b.flac']
const local = indexOf(
  file('a.flac', 100),   // 两端一致 -> 无动作
  file('b.flac', 200),   // 本地有、远端没有、基线有 -> remoteDeleted
  file('c.flac', 300),   // 本地新增
  file('e.flac', 500),   // 两端都有但大小不同 -> conflict
)
const remote = indexOf(
  file('a.flac', 100),
  file('d.flac', 400),   // 远端新增
  file('e.flac', 501),
  file('f.flac', 600),   // 远端有、本地没有、基线没有 -> remoteAdded
)
const plan = buildPlan(local, remote, baseline)
const paths = (group: keyof PlanGroups) => plan[group].map(i => i.path)
check('remoteAdded', paths('remoteAdded'), ['d.flac', 'f.flac'])
check('localAdded', paths('localAdded'), ['c.flac'])
check('remoteDeleted', paths('remoteDeleted'), ['b.flac'])
check('localDeleted', paths('localDeleted'), [])
check('conflict', paths('conflict'), ['e.flac'])
check('已同步文件不出现', paths('remoteAdded').includes('a.flac') || paths('conflict').includes('a.flac'), false)

const planDeleted = buildPlan(
  indexOf(file('a.flac', 100)),
  indexOf(file('a.flac', 100), file('g.flac', 700)),
  ['a.flac', 'g.flac'],
)
check('localDeleted', planDeleted.localDeleted.map(i => i.path), ['g.flac'])

console.log('\n== 默认勾选与方向 ==')
check('remoteAdded 默认勾选', plan.remoteAdded.every(i => i.defaultChecked), true)
check('localAdded 默认勾选', plan.localAdded.every(i => i.defaultChecked), true)
check('remoteDeleted 默认不勾选', plan.remoteDeleted.every(i => !i.defaultChecked), true)
check('localDeleted 默认不勾选', planDeleted.localDeleted.every(i => !i.defaultChecked), true)
check('conflict 默认不勾选', plan.conflict.every(i => !i.defaultChecked), true)
check('conflict 默认以远端为准', plan.conflict.every(i => i.defaultDirection === 'pull'), true)
check('localAdded 方向为 push', plan.localAdded.every(i => i.defaultDirection === 'push'), true)

console.log('\n== 传输动作（含歌词伴生） ==')
const plan2 = buildPlan(
  indexOf(file('a.flac', 100), file('b.flac', 200), file('c.flac', 300, 30), file('e.flac', 500)),
  indexOf(file('a.flac', 100), file('d.flac', 400, 40), file('e.flac', 501), file('f.flac', 600)),
  baseline,
)
const sel = selected(plan2, [
  ['remoteAdded', 'd.flac'],
  ['localAdded', 'c.flac'],
  ['remoteDeleted', 'b.flac'],
  ['conflict', 'e.flac'],
])
const actions = buildActions(plan2, sel, {})
check('download 携带歌词', actions.find(a => a.path === 'd.flac'), { kind: 'download', path: 'd.flac', size: 400, hasLyric: true })
check('upload 携带歌词', actions.find(a => a.path === 'c.flac'), { kind: 'upload', path: 'c.flac', size: 300, hasLyric: true })
check('delete_local 携带歌词', actions.find(a => a.path === 'b.flac'), { kind: 'delete_local', path: 'b.flac', hasLyric: false })
check('conflict 默认 pull', actions.find(a => a.path === 'e.flac'), { kind: 'download', path: 'e.flac', size: 501, hasLyric: false })
check('未勾选不产生动作', actions.some(a => a.path === 'f.flac'), false)
check('动作数量', actions.length, 4)

const pushActions = buildActions(plan2, sel, { [planSelectionKey('conflict', 'e.flac')]: 'push' })
check('conflict 可改为 push', pushActions.find(a => a.path === 'e.flac'), { kind: 'upload', path: 'e.flac', size: 500, hasLyric: false })

console.log('\n== 删除也带上伴生歌词 ==')
const delPlan = buildPlan(
  indexOf(file('a.flac', 100, 10), file('b.flac', 200, 20)),
  indexOf(file('a.flac', 100, 10)),
  ['a.flac', 'b.flac'],
)
const delActions = buildActions(delPlan, { [planSelectionKey('remoteDeleted', 'b.flac')]: true }, {})
check('删除本地时带上歌词', delActions, [{ kind: 'delete_local', path: 'b.flac', hasLyric: true }])

console.log('\n== 基线更新 ==')
const afterLocal = indexOf(file('a.flac', 100), file('c.flac', 300), file('d.flac', 400))
const afterRemote = indexOf(file('a.flac', 100), file('c.flac', 300), file('d.flac', 400), file('z.flac', 900))
check('两端交集', buildBaseline(afterLocal, afterRemote), ['a.flac', 'c.flac', 'd.flac'])
check('跳过的新增下次仍提示', buildPlan(afterLocal, afterRemote, buildBaseline(afterLocal, afterRemote)).remoteAdded.map(i => i.path), ['z.flac'])

console.log(`\n${failed ? 'FAILED' : 'PASSED'}: ${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
