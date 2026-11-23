/**
 * 本地音乐文件同步：基线增量更新 + 动作编排（取消/失败）纯逻辑测试
 *
 * 直接使用 node 运行（Node 24 原生支持 TypeScript 类型擦除）：
 *   node tests/music-file-baseline.test.ts   （在 lx-music-desktop 目录下执行）
 */
import {
  applyExecutedToBaseline,
  buildIndex,
  buildPlan,
  computeNextBaseline,
  getActionTargets,
  mergeBaselineEntries,
  parseBaseline,
  parseBaselineEntries,
  parseBaselineState,
  seedBaselineFromLegacy,
  type FileIndex,
  type ScanEntry,
  type SidecarItem,
  type TransferAction,
} from '../src/main/modules/sync/musicFile/diff.ts'
import { runActions } from '../src/main/modules/sync/musicFile/executor.ts'

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

const audio = (path: string, size = 100): ScanEntry[] => [{ path, size, mtime: 1000 }]
const indexOf = (...entries: ScanEntry[][]): FileIndex => buildIndex(entries.flat())
const sidecar = (path: string): SidecarItem => ({ path, size: 1, kind: 'lyric' })

const transferAct = (kind: 'upload' | 'download', path: string, sidecarCount = 0): TransferAction => {
  const sidecars = Array.from({ length: sidecarCount }, (_, index) => sidecar(`${path}#${index}.lrc`))
  return kind === 'upload'
    ? { kind, path, size: 10, sidecars }
    : { kind, path, size: 10, sidecars }
}
const deleteAct = (kind: 'delete_local' | 'delete_remote', path: string, sidecarCount = 0): TransferAction => {
  const sidecars = Array.from({ length: sidecarCount }, (_, index) => sidecar(`${path}#${index}.lrc`))
  return kind === 'delete_local'
    ? { kind, path, sidecars }
    : { kind, path, sidecars }
}

const baselineKey = { pairId: 'client:phone-1', localRoot: 'D:/Music', remoteRoot: '/storage/emulated/0/Music' }

console.log('\n== 基线增量更新 ==')
const localAfterSync = indexOf(audio('a.flac'), audio('b.flac'), audio('c.flac'))
const remoteAfterSync = indexOf(audio('a.flac'), audio('c.flac'))
const prev = ['a.flac', 'b.flac']

const next = computeNextBaseline(prev, [{ kind: 'upload', path: 'c.flac', ok: true }], localAfterSync, remoteAfterSync)
check('跳过的删除保留在基线', next.includes('b.flac'), true)
check('同步成功的新增进入基线', next.includes('c.flac'), true)
check('未勾选的删除下一轮仍是删除', buildPlan(localAfterSync, remoteAfterSync, next).remoteDeleted.map(item => item.path), ['b.flac'])
check('不会把 b.flac 误判成新增', buildPlan(localAfterSync, remoteAfterSync, next).localAdded.length, 0)

check(
  '执行成功的删除移出基线',
  computeNextBaseline(next, [{ kind: 'delete_local', path: 'b.flac', ok: true }], indexOf(audio('a.flac'), audio('c.flac')), remoteAfterSync),
  ['a.flac', 'c.flac'],
)

check(
  '失败的上传不进入基线',
  computeNextBaseline([], [{ kind: 'upload', path: 'd.flac', ok: false }], indexOf(audio('a.flac'), audio('d.flac')), indexOf(audio('a.flac'))),
  ['a.flac'],
)

check(
  '两端都有的新文件补进基线',
  computeNextBaseline([], [], indexOf(audio('e.flac')), indexOf(audio('e.flac'))),
  ['e.flac'],
)

check(
  'scope 内缺失的条目剪掉、scope 外的保留',
  computeNextBaseline(['keep/x.flac', 'gone/y.flac'], [], indexOf(), indexOf(), ['gone']),
  ['keep/x.flac'],
)

check(
  '取消时只写回已完成动作',
  applyExecutedToBaseline(['a.flac'], [
    { kind: 'upload', path: 'b.flac', ok: true },
    { kind: 'delete_remote', path: 'a.flac', ok: false },
  ]),
  ['a.flac', 'b.flac'],
)

console.log('\n== 基线文件键控与旧数据迁移 ==')
const v3 = (entries: unknown[]) => JSON.stringify({ version: 3, entries })
const entryFor = (key: typeof baselineKey, paths: string[], updatedAt = 1) => ({ ...key, updatedAt, paths })
check('同配对同根目录可读', parseBaseline(v3([entryFor(baselineKey, ['a.flac'])]), baselineKey), ['a.flac'])
check('换配对按首次同步', parseBaseline(v3([entryFor({ ...baselineKey, pairId: 'client:other' }, ['a.flac'])]), baselineKey), [])
check('换本地根目录按首次同步', parseBaseline(v3([entryFor({ ...baselineKey, localRoot: 'E:/Music' }, ['a.flac'])]), baselineKey), [])
check('换对端根目录按首次同步', parseBaseline(v3([entryFor({ ...baselineKey, remoteRoot: '/other' }, ['a.flac'])]), baselineKey), [])

check('裸数组标记为 legacy 并保留路径', parseBaselineState(JSON.stringify(['a.flac']), baselineKey), { status: 'legacy', paths: ['a.flac'] })
check('v2 单条基线标记为 legacy', parseBaselineState(JSON.stringify({ version: 2, ...baselineKey, paths: ['a.flac'] }), baselineKey), { status: 'legacy', paths: ['a.flac'] })
check('v3 命中为 ok', parseBaselineState(v3([entryFor(baselineKey, ['a.flac'])]), baselineKey), { status: 'ok', paths: ['a.flac'] })
check('v3 其他组合存在但当前组合缺失为 ok 空', parseBaselineState(v3([entryFor({ ...baselineKey, pairId: 'client:other' }, ['x.flac'])]), baselineKey), { status: 'ok', paths: [] })
check('坏 JSON 为 corrupt', parseBaselineState('{', baselineKey), { status: 'corrupt', paths: [] })
check('零字节文件为 corrupt', parseBaselineState('', baselineKey), { status: 'corrupt', paths: [] })
check('v3 缺 entries 为 corrupt', parseBaselineState(JSON.stringify({ version: 3 }), baselineKey), { status: 'corrupt', paths: [] })
check('当前条目 paths 损坏为 corrupt', parseBaselineState(v3([{ ...baselineKey, updatedAt: 1, paths: 'bad' }]), baselineKey), { status: 'corrupt', paths: [] })
check('当前条目损坏时保留其他有效组合', parseBaselineEntries(v3([{ ...baselineKey, updatedAt: 1, paths: 'bad' }, entryFor({ ...baselineKey, localRoot: 'E:/MusicB' }, ['b.flac'])])).map(item => item.paths), [['b.flac']])

const keyA = { ...baselineKey }
const keyB = { ...baselineKey, localRoot: 'E:/MusicB' }

// 旧基线迁移：只保留当前两端都存在的路径，避免旧目录记忆把对端文件判成删除
const bothSides = indexOf(audio('keep.flac'))
const legacySeeded = seedBaselineFromLegacy(['keep.flac', 'song.flac'], bothSides, bothSides)
check('迁移保留两端都存在的路径', legacySeeded, ['keep.flac'])
const emptySeeded = seedBaselineFromLegacy(['song.flac'], indexOf(), indexOf(audio('song.flac')))
check('换到空目录后迁移结果为空', emptySeeded, [])
check('迁移后对端歌曲按新增下载', buildPlan(indexOf(), indexOf(audio('song.flac')), emptySeeded).remoteAdded.map(item => item.path), ['song.flac'])
check('迁移后两端都有的歌仍算已同步', buildPlan(bothSides, bothSides, legacySeeded).localAdded.length + buildPlan(bothSides, bothSides, legacySeeded).remoteDeleted.length, 0)

// 待确认迁移：第二次比较仍要提示，直到执行同步后才清除
let pendingEntries = mergeBaselineEntries([], keyA, ['a.flac'], 1000, true)
check('迁移后写入待确认标记', parseBaselineState(v3(pendingEntries), keyA).pendingMigration, true)
check('未确认前再次比较仍提示', parseBaselineState(v3(pendingEntries), keyA), { status: 'ok', paths: ['a.flac'], pendingMigration: true })
pendingEntries = mergeBaselineEntries(pendingEntries, keyA, ['a.flac'], 2000, false)
check('执行同步后清除待确认标记', parseBaselineState(v3(pendingEntries), keyA), { status: 'ok', paths: ['a.flac'] })

// A → B → A：每个组合单独保存，切回 A 不会丢掉 A 的基线
let mergedEntries = mergeBaselineEntries([], keyA, ['a.flac'], 1000)
mergedEntries = mergeBaselineEntries(mergedEntries, keyB, ['b.flac'], 2000)
const mergedRaw = v3(mergedEntries)
check('B 同步后 A 的基线仍在', parseBaseline(mergedRaw, keyA), ['a.flac'])
check('B 组合单独保存', parseBaseline(mergedRaw, keyB), ['b.flac'])
check('切回 A 仍能识别已同步歌曲被删除', buildPlan(indexOf(audio('a.flac')), indexOf(), parseBaseline(mergedRaw, keyA)).remoteDeleted.map(item => item.path), ['a.flac'])

void (async() => {
  console.log('\n== 动作编排 ==')
  const calls: string[] = []
  const ops = (overrides: Partial<Parameters<typeof runActions>[1]> = {}) => ({
    targetsOf: getActionTargets,
    download: async(relPath: string) => { calls.push(`download:${relPath}`) },
    upload: async(relPath: string) => { calls.push(`upload:${relPath}`) },
    deleteLocal: async(relPath: string) => { calls.push(`delete_local:${relPath}`) },
    deleteRemote: async(relPath: string) => { calls.push(`delete_remote:${relPath}`) },
    isCancelled: () => false,
    ...overrides,
  })

  {
    calls.length = 0
    let done = 0
    const run = await runActions([transferAct('upload', 'a.flac', 1), deleteAct('delete_local', 'b.flac')], ops({ onActionDone: () => { done++ } }))
    check('顺序执行：音频再伴生、动作按清单顺序', calls, ['upload:a.flac', 'upload:a.flac#0.lrc', 'delete_local:b.flac'])
    check('成功动作记录', run.executed, [
      { kind: 'upload', path: 'a.flac', ok: true },
      { kind: 'delete_local', path: 'b.flac', ok: true },
    ])
    check('完成回调次数', done, 2)
    check('未取消标记', run.cancelled, false)
  }

  {
    calls.length = 0
    let cancelNow = false
    const run = await runActions(
      [transferAct('upload', 'a.flac'), deleteAct('delete_local', 'b.flac'), deleteAct('delete_remote', 'c.flac')],
      ops({
        isCancelled: () => cancelNow,
        upload: async() => { calls.push('upload:a.flac'); cancelNow = true },
      }),
    )
    check('取消后不再开始新动作', calls, ['upload:a.flac'])
    check('取消前完成的动作保留', run.executed.map(item => item.path), ['a.flac'])
    check('取消标记为真', run.cancelled, true)
  }

  {
    calls.length = 0
    let cancelNow = false
    const run = await runActions(
      [deleteAct('delete_local', 'a.flac', 2)],
      ops({
        isCancelled: () => cancelNow,
        deleteLocal: async() => { calls.push('delete_local:a.flac'); cancelNow = true },
      }),
    )
    check('删除中途取消后不再删下一个目标', calls, ['delete_local:a.flac'])
    check('中途取消的动作不记为完成', run.executed, [])
    check('中途取消标记为真', run.cancelled, true)
  }

  {
    calls.length = 0
    const errors: string[] = []
    const run = await runActions(
      [transferAct('upload', 'a.flac'), deleteAct('delete_local', 'b.flac')],
      ops({
        upload: async() => { throw new Error('boom') },
        onActionError: (_action, err) => { errors.push(err instanceof Error ? err.message : String(err)) },
      }),
    )
    check('失败动作记为 ok=false', run.executed[0], { kind: 'upload', path: 'a.flac', ok: false })
    check('失败后继续下一个动作', calls, ['delete_local:b.flac'])
    check('失败错误收集', run.errors, ['a.flac: boom'])
    check('失败回调', errors, ['boom'])
  }

  {
    calls.length = 0
    let cancelNow = false
    const run = await runActions(
      [transferAct('upload', 'a.flac')],
      ops({
        isCancelled: () => cancelNow,
        upload: async() => { cancelNow = true },
      }),
    )
    check('最后一个目标期间取消也按取消收尾', run.cancelled, true)
    check('已完成动作仍保留', run.executed, [{ kind: 'upload', path: 'a.flac', ok: true }])
    check('不产生错误', run.errors, [])
  }

  {
    calls.length = 0
    let cancelNow = false
    const run = await runActions(
      [transferAct('upload', 'a.flac')],
      ops({
        isCancelled: () => cancelNow,
        upload: async() => { cancelNow = true; throw new Error('已取消') },
      }),
    )
    check('传输中被取消不记为失败', run.executed, [])
    check('传输中取消标记为真', run.cancelled, true)
    check('传输中取消不产生错误', run.errors, [])
  }

  console.log(`\n${failed ? 'FAILED' : 'PASSED'}: ${passed} passed, ${failed} failed\n`)
  process.exit(failed ? 1 : 0)
})()
