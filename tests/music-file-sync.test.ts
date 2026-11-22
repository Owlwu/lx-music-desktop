/**
 * 本地音乐文件同步：纯逻辑回归测试
 *
 * 直接使用 node 运行（Node 24 原生支持 TypeScript 类型擦除）：
 *   node tests/music-file-sync.test.ts   （在 lx-music-desktop 目录下执行）
 */
import fs from 'node:fs'
import {
  buildIndex,
  buildPlan,
  buildActions,
  buildBaseline,
  buildSignature,
  getSignatureRanges,
  isSafeRelPath,
  isPathInScope,
  normalizeScope,
  getLyricRelPath,
  getCoverRelPath,
  isCoverFileName,
  getCoverFormat,
  getActionTargets,
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

/** 同名封面条目（只认小写 jpg/png） */
const cover = (path: string, format: 'jpg' | 'png', size: number): ScanEntry[] => [
  { path: getCoverRelPath(path, format), size, mtime: 3000 },
]

const indexOf = (...entries: ScanEntry[][]): FileIndex => buildIndex(entries.flat())

/** 新版本扫描器：buildIndex + coverSupport（封面能力标记） */
const indexWithSupport = (...entries: ScanEntry[][]): FileIndex => ({ ...buildIndex(entries.flat()), coverSupport: true })

const planItemCount = (plan: PlanGroups) => Object.values(plan).reduce((sum, items) => sum + items.length, 0)

/** 带内容签名的音频条目（size 相同、签名不同 = 内容不同） */
const signed = (path: string, size: number, sig: string): ScanEntry[] => [{ path, size, mtime: 1000, sig }]

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

console.log('\n== 歌词/封面伴生路径与索引 ==')
check('lyric path for flac', getLyricRelPath('a/b/c.flac'), 'a/b/c.lrc')
check('lyric path without ext', getLyricRelPath('a/b/c'), 'a/b/c.lrc')
check('cover path jpg', getCoverRelPath('a/b/c.flac', 'jpg'), 'a/b/c.jpg')
check('cover path png', getCoverRelPath('a/b/c.flac', 'png'), 'a/b/c.png')
check('cover file name lower-case only: jpg', isCoverFileName('a/b/c.jpg'), true)
check('cover file name lower-case only: png', isCoverFileName('a/b/c.png'), true)
check('.JPG 不参与', isCoverFileName('a/b/c.JPG'), false)
check('.PNG 不参与', isCoverFileName('a/b/c.PNG'), false)
check('getCoverFormat 只返回小写', [getCoverFormat('x.jpg'), getCoverFormat('x.PNG'), getCoverFormat('x.lrc')], ['jpg', null, null])

const basic = indexOf(
  file('a/song.flac', 100, 10),
  cover('a/song.flac', 'jpg', 5000),
  file('root.mp3', 50),
  [{ path: 'notaudio.txt', size: 1, mtime: 0 }],
)
check('only audio files indexed', basic.files.map(f => f.path), ['a/song.flac', 'root.mp3'])
check('lyric attached to audio', basic.files[0].lyric, { size: 10, mtime: 2000 })
check('lyric absent -> null', basic.files[1].lyric, null)
check('cover attached to audio', basic.files[0].cover, { format: 'jpg', size: 5000, mtime: 3000 })
check('cover absent -> null', basic.files[1].cover, null)
check('buildIndex 保持纯函数（不带 coverSupport）', basic.coverSupport, undefined)
check('folders collected', basic.folders, ['a'])
check('orphan lyric ignored', indexOf([{ path: 'a/only.lrc', size: 10, mtime: 0 }]).files, [])
check('orphan cover ignored', indexOf([{ path: 'a/only.jpg', size: 10, mtime: 0 }]).files, [])
check('nested folders collected', indexOf(file('a/b/c/d.mp3', 1)).folders, ['a', 'a/b', 'a/b/c'])

// 同 stem 同时存在 jpg/png：与播放优先级一致取 jpg，且与目录枚举顺序无关
const bothCovers = indexOf(file('a/song.flac', 100), cover('a/song.flac', 'png', 6000), cover('a/song.flac', 'jpg', 5000))
check('jpg 优先于 png', bothCovers.files[0].cover, { format: 'jpg', size: 5000, mtime: 3000 })
const pngOnly = indexOf(file('a/song.flac', 100), cover('a/song.flac', 'png', 6000))
check('无 jpg 时回退 png', pngOnly.files[0].cover, { format: 'png', size: 6000, mtime: 3000 })
const upperCover = indexOf(file('a/song.flac', 100), [{ path: 'a/song.JPG', size: 7000, mtime: 3000 }])
check('.JPG 不挂到音频上', upperCover.files[0].cover, null)
check('scanIndex 声明 coverSupport', fs.readFileSync(new URL('../src/main/modules/sync/musicFile/localFs.ts', import.meta.url), 'utf8').includes('coverSupport: true'), true)
check('扫描器纳入小写封面', fs.readFileSync(new URL('../src/main/modules/sync/musicFile/localFs.ts', import.meta.url), 'utf8').includes('isCoverFileName'), true)

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

console.log('\n== 传输动作（伴生歌词/封面用 sidecars 表达） ==')
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
check('download 携带歌词 sidecar', actions.find(a => a.path === 'd.flac'), {
  kind: 'download', path: 'd.flac', size: 400, sidecars: [{ path: 'd.lrc', size: 40, kind: 'lyric' }],
})
check('upload 携带歌词 sidecar', actions.find(a => a.path === 'c.flac'), {
  kind: 'upload', path: 'c.flac', size: 300, sidecars: [{ path: 'c.lrc', size: 30, kind: 'lyric' }],
})
check('delete_local 无伴生文件', actions.find(a => a.path === 'b.flac'), { kind: 'delete_local', path: 'b.flac', sidecars: [] })
check('conflict 默认 pull', actions.find(a => a.path === 'e.flac'), { kind: 'download', path: 'e.flac', size: 501, sidecars: [] })
check('未勾选不产生动作', actions.some(a => a.path === 'f.flac'), false)
check('动作数量', actions.length, 4)

const pushActions = buildActions(plan2, sel, { [planSelectionKey('conflict', 'e.flac')]: 'push' })
check('conflict 可改为 push', pushActions.find(a => a.path === 'e.flac'), { kind: 'upload', path: 'e.flac', size: 500, sidecars: [] })

console.log('\n== 删除也带上伴生歌词+封面 ==')
const delPlan = buildPlan(
  indexOf(file('a.flac', 100, 10), cover('a.flac', 'jpg', 1000), file('b.flac', 200, 20), cover('b.flac', 'png', 2000)),
  indexOf(file('a.flac', 100, 10), cover('a.flac', 'jpg', 1000)),
  ['a.flac', 'b.flac'],
)
const delActions = buildActions(delPlan, { [planSelectionKey('remoteDeleted', 'b.flac')]: true }, {})
check('删除本地时带上歌词+封面', delActions, [{
  kind: 'delete_local',
  path: 'b.flac',
  sidecars: [
    { path: 'b.lrc', size: 20, kind: 'lyric' },
    { path: 'b.png', size: 2000, kind: 'cover' },
  ],
}])
check('动作目标路径 = 音频 + sidecars', getActionTargets(delActions[0]), ['b.flac', 'b.lrc', 'b.png'])

console.log('\n== 只改伴生文件不产生同步项 ==')
const stableAudio = indexOf(file('keep.flac', 1000))
const changedSidecars = indexOf(
  file('keep.flac', 1000),
  { path: 'keep.lrc', size: 888, mtime: 999999 },
  cover('keep.flac', 'jpg', 4096),
)
check('仅 .lrc/.jpg 变化 → 清单为空', planItemCount(buildPlan(stableAudio, changedSidecars, ['keep.flac'])), 0)
check('仅删除 .lrc 不产生项', planItemCount(buildPlan(changedSidecars, stableAudio, ['keep.flac'])), 0)

console.log('\n== 新增歌曲：本地歌词/封面搭车上传 ==')
const localNewIndex = indexWithSupport(file('new.flac', 300, 30), cover('new.flac', 'jpg', 3000))
const emptySupported = indexWithSupport()
const uploadPlan = buildPlan(localNewIndex, emptySupported, [])
const uploadItem = uploadPlan.localAdded[0]
check('本地新增项 cover 标记', [uploadItem.localHasLyric, uploadItem.localHasCover, uploadItem.remoteHasCover], [true, true, false])
check('uploadSidecars 歌词+封面', uploadItem.uploadSidecars, [
  { path: 'new.lrc', size: 30, kind: 'lyric' },
  { path: 'new.jpg', size: 3000, kind: 'cover' },
])
const uploadAction = buildActions(uploadPlan, { [planSelectionKey('localAdded', 'new.flac')]: true }, {})
check('上传动作携带 sidecars', uploadAction, [{
  kind: 'upload',
  path: 'new.flac',
  size: 300,
  sidecars: [
    { path: 'new.lrc', size: 30, kind: 'lyric' },
    { path: 'new.jpg', size: 3000, kind: 'cover' },
  ],
}])

console.log('\n== 远端新增：对端歌词/封面搭车下载 ==')
const remoteNewIndex = indexWithSupport(file('remote.flac', 400, 40), cover('remote.flac', 'png', 4000))
const downloadPlan = buildPlan(emptySupported, remoteNewIndex, [])
const downloadItem = downloadPlan.remoteAdded[0]
check('远端新增项 cover 标记', [downloadItem.localHasCover, downloadItem.remoteHasLyric, downloadItem.remoteHasCover], [false, true, true])
check('downloadSidecars 歌词+封面', downloadItem.downloadSidecars, [
  { path: 'remote.lrc', size: 40, kind: 'lyric' },
  { path: 'remote.png', size: 4000, kind: 'cover' },
])
const downloadAction = buildActions(downloadPlan, { [planSelectionKey('remoteAdded', 'remote.flac')]: true }, {})
check('下载动作携带 sidecars', downloadAction, [{
  kind: 'download',
  path: 'remote.flac',
  size: 400,
  sidecars: [
    { path: 'remote.lrc', size: 40, kind: 'lyric' },
    { path: 'remote.png', size: 4000, kind: 'cover' },
  ],
}])

console.log('\n== target 已有伴生文件：不传、不覆盖 ==')
// 冲突 push：两端都有歌词，本地 jpg、对端 png（任意格式均为「已有封面」）
const conflictLocal = indexWithSupport(file('both.flac', 500, 50), cover('both.flac', 'jpg', 5000))
const conflictRemote = indexWithSupport(file('both.flac', 501, 51), cover('both.flac', 'png', 5100))
const conflictPlan = buildPlan(conflictLocal, conflictRemote, [])
const conflictItem = conflictPlan.conflict[0]
check('两端都有歌词/封面（格式可不同）', [
  conflictItem.localHasLyric,
  conflictItem.remoteHasLyric,
  conflictItem.localHasCover,
  conflictItem.remoteHasCover,
], [true, true, true, true])
check('target 已有 → push 不传伴生', conflictItem.uploadSidecars, [])
check('target 已有 → pull 不传伴生', conflictItem.downloadSidecars, [])
const conflictPush = buildActions(conflictPlan, { [planSelectionKey('conflict', 'both.flac')]: true }, { [planSelectionKey('conflict', 'both.flac')]: 'push' })
const conflictPull = buildActions(conflictPlan, { [planSelectionKey('conflict', 'both.flac')]: true }, { [planSelectionKey('conflict', 'both.flac')]: 'pull' })
check('冲突 push 动作 sidecars 为空', conflictPush[0].sidecars, [])
check('冲突 pull 动作 sidecars 为空', conflictPull[0].sidecars, [])

console.log('\n== 旧对端（无 coverSupport）：跳过封面 ==')
// 旧对端索引由 buildIndex 构造、无 coverSupport
const oldRemoteNoLyric = indexOf(file('old.flac', 401))
const localWithSidecars = indexWithSupport(file('old.flac', 400, 40), cover('old.flac', 'jpg', 4000))
const uploadToOld = buildPlan(localWithSidecars, oldRemoteNoLyric, [])
check('旧对端无 coverSupport → 不传封面、歌词照常', uploadToOld.conflict[0].uploadSidecars, [
  { path: 'old.lrc', size: 40, kind: 'lyric' },
])
const oldRemoteWithCover = indexOf(file('old.flac', 400, 40), cover('old.flac', 'jpg', 4000))
const downloadFromOld = buildPlan(indexWithSupport(file('old.flac', 500)), oldRemoteWithCover, [])
check('旧对端无 coverSupport → 不下载封面、歌词照常', downloadFromOld.conflict[0].downloadSidecars, [
  { path: 'old.lrc', size: 40, kind: 'lyric' },
])
const deleteOnOld = buildPlan(indexWithSupport(), oldRemoteWithCover, ['old.flac'])
check('旧对端无 coverSupport → 不删对端封面', deleteOnOld.localDeleted[0].remoteSidecars, [
  { path: 'old.lrc', size: 40, kind: 'lyric' },
])
const deleteOnNew = buildPlan(indexWithSupport(), indexWithSupport(file('old.flac', 400, 40), cover('old.flac', 'jpg', 4000)), ['old.flac'])
check('新对端支持 coverSupport → 删除对端封面', deleteOnNew.localDeleted[0].remoteSidecars, [
  { path: 'old.lrc', size: 40, kind: 'lyric' },
  { path: 'old.jpg', size: 4000, kind: 'cover' },
])
check('target 已有歌词 → 不重复传歌词', buildPlan(
  localWithSidecars,
  indexWithSupport(file('old.flac', 401, 41)),
  [],
).conflict[0].uploadSidecars, [{ path: 'old.jpg', size: 4000, kind: 'cover' }])

console.log('\n== 删除歌曲时逐个删除该侧 sidecar ==')
const deleteLocalPlan = buildPlan(
  indexWithSupport(file('gone.flac', 500, 50), cover('gone.flac', 'png', 5000)),
  indexWithSupport(),
  ['gone.flac'],
)
check('远端已删除 → 本地删除项带歌词+封面', deleteLocalPlan.remoteDeleted[0].localSidecars, [
  { path: 'gone.lrc', size: 50, kind: 'lyric' },
  { path: 'gone.png', size: 5000, kind: 'cover' },
])
const delLocalActions = buildActions(deleteLocalPlan, { [planSelectionKey('remoteDeleted', 'gone.flac')]: true }, {})
check('delete_local 动作携带 sidecars', delLocalActions, [{
  kind: 'delete_local',
  path: 'gone.flac',
  sidecars: [
    { path: 'gone.lrc', size: 50, kind: 'lyric' },
    { path: 'gone.png', size: 5000, kind: 'cover' },
  ],
}])
const deleteRemotePlan = buildPlan(indexWithSupport(), indexWithSupport(file('gone.flac', 500, 50), cover('gone.flac', 'png', 5000)), ['gone.flac'])
const delRemoteActions = buildActions(deleteRemotePlan, { [planSelectionKey('localDeleted', 'gone.flac')]: true }, {})
check('delete_remote 动作携带 sidecars', delRemoteActions, [{
  kind: 'delete_remote',
  path: 'gone.flac',
  sidecars: [
    { path: 'gone.lrc', size: 50, kind: 'lyric' },
    { path: 'gone.png', size: 5000, kind: 'cover' },
  ],
}])

console.log('\n== 内容签名：发现「字节数相同但内容不同」 ==')
check('取样范围: 大文件首尾各 4096', getSignatureRanges(100000), { headLength: 4096, tailOffset: 95904, tailLength: 4096 })
check('取样范围: 刚好 2 倍取样', getSignatureRanges(8192), { headLength: 4096, tailOffset: 4096, tailLength: 4096 })
check('取样范围: 中间档不重叠', getSignatureRanges(5000), { headLength: 4096, tailOffset: 4096, tailLength: 904 })
check('取样范围: 小文件取整文件', getSignatureRanges(100), { headLength: 100, tailOffset: 100, tailLength: 0 })
check('取样范围: 空文件', getSignatureRanges(0), { headLength: 0, tailOffset: 0, tailLength: 0 })

const sigA = buildSignature(5, new Uint8Array([1, 2, 3]), new Uint8Array([4, 5]))
check('签名稳定（同输入同输出）', buildSignature(5, new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])), sigA)
check('签名长度 16', sigA.length, 16)
check('尾部不同 -> 签名不同', buildSignature(5, new Uint8Array([1, 2, 3]), new Uint8Array([4, 6])) === sigA, false)
check('头部不同 -> 签名不同', buildSignature(5, new Uint8Array([9, 2, 3]), new Uint8Array([4, 5])) === sigA, false)
check('大小不同 -> 签名不同', buildSignature(6, new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])) === sigA, false)

check('索引携带签名', buildIndex(signed('a.flac', 10, sigA)).files[0].sig, sigA)
check('size 相同 + 签名相同 -> 已同步', buildPlan(indexOf(signed('a.flac', 10, sigA)), indexOf(signed('a.flac', 10, sigA)), []).conflict.length, 0)
const contentDiff = buildPlan(indexOf(signed('a.flac', 10, sigA)), indexOf(signed('a.flac', 10, 'ffffffffffffffff')), [])
check('size 相同 + 签名不同 -> conflict', contentDiff.conflict.map(i => i.path), ['a.flac'])
check('该 conflict 标记 sameSize', contentDiff.conflict[0].sameSize, true)
check('size 不同的 conflict sameSize=false', buildPlan(indexOf(signed('a.flac', 10, sigA)), indexOf(signed('a.flac', 11, sigA)), []).conflict[0].sameSize, false)
check('对端无签名 -> 退回只比 size', buildPlan(indexOf(signed('a.flac', 10, sigA)), indexOf(file('a.flac', 10)), []).conflict.length, 0)
check('本端无签名 -> 退回只比 size', buildPlan(indexOf(file('a.flac', 10)), indexOf(signed('a.flac', 10, sigA)), []).conflict.length, 0)
check('同大小不同内容的原文件不会因基线被跳过', buildPlan(indexOf(signed('a.flac', 10, sigA)), indexOf(signed('a.flac', 10, 'ffffffffffffffff')), ['a.flac']).conflict.map(i => i.path), ['a.flac'])

console.log('\n== 基线更新 ==')
const afterLocal = indexOf(file('a.flac', 100), file('c.flac', 300), file('d.flac', 400))
const afterRemote = indexOf(file('a.flac', 100), file('c.flac', 300), file('d.flac', 400), file('z.flac', 900))
check('两端交集', buildBaseline(afterLocal, afterRemote), ['a.flac', 'c.flac', 'd.flac'])
check('跳过的新增下次仍提示', buildPlan(afterLocal, afterRemote, buildBaseline(afterLocal, afterRemote)).remoteAdded.map(i => i.path), ['z.flac'])

console.log(`\n${failed ? 'FAILED' : 'PASSED'}: ${passed} passed, ${failed} failed\n`)
process.exit(failed ? 1 : 0)
