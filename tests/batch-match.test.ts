/**
 * 一键补全缺失歌词/封面：纯逻辑 + i18n + IPC/UI 接线 + 真实文件集成测试
 *
 * 运行：node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/batch-match.test.ts
 *
 * 纯逻辑模块是 TS，直接把源码复制到临时目录并把相对导入补成 `.ts`，
 * 以便 node 原生类型擦除直接运行（与 tests/media-match.test.ts 同一套路）。
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
const repoRoot = path.dirname(sourceRoot)
const moduleNames = [
  'common/utils/mediaMatch/fileState.ts',
  'common/utils/mediaMatch/batch.ts',
]
const moduleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-batch-match-'))
for (const relPath of moduleNames) {
  const code = fs.readFileSync(path.join(sourceRoot, relPath), 'utf8')
    .replace(/from '\.\/([A-Za-z0-9_]+)'/g, "from './$1.ts'")
  fs.writeFileSync(path.join(moduleDir, path.basename(relPath)), code, 'utf8')
}

const load = async(name: string) => {
  return import(pathToFileURL(path.join(moduleDir, name + '.ts')).href)
}

const fileState = await load('fileState')
const batch = await load('batch')

const createWorkDir = (name: string) => fs.mkdtempSync(path.join(os.tmpdir(), `lx-batch-match-${name}-`))

const makeMusic = (id: string) => ({
  id,
  name: 'Song ' + id,
  singer: 'Artist',
  source: 'local',
  interval: '03:00',
  meta: {
    songId: id,
    albumName: 'Album',
    filePath: `D:\\music\\${id}.mp3`,
    ext: 'mp3',
  },
})

const makeState = (overrides: Record<string, unknown> = {}) => ({
  fileExists: true,
  hasEmbeddedLyric: false,
  hasSidecarLyric: false,
  hasEmbeddedCover: false,
  hasSidecarCover: false,
  ...overrides,
})

console.log('\n== fileState：缺失判定真值表 ==')
for (const hasEmbeddedLyric of [false, true]) {
  for (const hasSidecarLyric of [false, true]) {
    for (const hasEmbeddedCover of [false, true]) {
      for (const hasSidecarCover of [false, true]) {
        const flags = fileState.getMissingFlags({
          hasEmbeddedLyric,
          hasSidecarLyric,
          hasEmbeddedCover,
          hasSidecarCover,
        })
        check(
          `真值表 内嵌词=${hasEmbeddedLyric} 文件词=${hasSidecarLyric} 内嵌图=${hasEmbeddedCover} 文件图=${hasSidecarCover}`,
          flags,
          {
            missingLyric: !(hasEmbeddedLyric || hasSidecarLyric),
            missingCover: !(hasEmbeddedCover || hasSidecarCover),
            missing: !(hasEmbeddedLyric || hasSidecarLyric) || !(hasEmbeddedCover || hasSidecarCover),
          },
        )
      }
    }
  }
}
check('空状态不崩', fileState.getMissingFlags(null), { missingLyric: true, missingCover: true, missing: true })
check('同目录歌词+封面都存在时跳过解析', fileState.shouldParseAudioMetadata(true, true), false)
check('只存在同目录歌词时需要解析', fileState.shouldParseAudioMetadata(true, false), true)
check('只存在同目录封面时需要解析', fileState.shouldParseAudioMetadata(false, true), true)
check('都没有时需要解析', fileState.shouldParseAudioMetadata(false, false), true)

console.log('\n== fileState：同目录文件 / 内嵌判定 ==')
const workDir = createWorkDir('files')
const audioPath = path.join(workDir, 'Artist - Song.mp3')
fs.writeFileSync(audioPath, 'fake-audio')
check('同目录路径推导（歌词）', fileState.getSidecarLyricPaths(audioPath), [
  path.join(workDir, 'Artist - Song.lrc'),
  path.join(workDir, 'Artist - Song.LRC'),
  path.join(workDir, 'Artist - Song.krc'),
  path.join(workDir, 'Artist - Song.KRC'),
])
check('同目录路径推导（封面）', fileState.getSidecarCoverPaths(audioPath), [
  path.join(workDir, 'Artist - Song.jpg'),
  path.join(workDir, 'Artist - Song.png'),
])

const noParseState = await fileState.getFileState(audioPath)
check('无同目录文件时只返回文件状态', noParseState, {
  fileExists: true,
  hasEmbeddedLyric: false,
  hasSidecarLyric: false,
  hasEmbeddedCover: false,
  hasSidecarCover: false,
})
check('不存在音频返回 fileExists=false', (await fileState.getFileState(path.join(workDir, 'missing.mp3'))).fileExists, false)
check('空路径返回 fileExists=false', (await fileState.getFileState('')).fileExists, false)
check('相对路径返回 fileExists=false', (await fileState.getFileState('Artist - Song.mp3')).fileExists, false)

const makeMetadata = (options: {
  commonLyrics?: Array<{ text?: string, syncText?: Array<{ text?: string }> }>
  nativeLyric?: string
  nativeId?: string
  pictureCount?: number
} = {}) => ({
  common: {
    lyrics: options.commonLyrics,
    picture: Array.from({ length: options.pictureCount ?? 0 }, () => ({ data: Buffer.from('x') })),
  },
  native: options.nativeLyric == null
    ? {}
    : {
      'ID3v2.3': [{ id: options.nativeId ?? 'USLT', value: { text: options.nativeLyric } }],
    },
})
check('common.lyrics 非空算内嵌歌词（M4A ©lyr）', fileState.hasEmbeddedLyricMetadata(makeMetadata({ commonLyrics: [{ text: 'short' }] })), true)
check('common.lyrics 空白不算', fileState.hasEmbeddedLyricMetadata(makeMetadata({ commonLyrics: [{ text: '   ' }] })), false)
check('common.lyrics syncText 算内嵌歌词', fileState.hasEmbeddedLyricMetadata(makeMetadata({ commonLyrics: [{ syncText: [{ text: 'line' }] }] })), true)
check('native USLT 短标签不算（与播放链路一致）', fileState.hasEmbeddedLyricMetadata(makeMetadata({ nativeLyric: 'short' })), false)
check('native USLT 超过 10 字符算内嵌歌词', fileState.hasEmbeddedLyricMetadata(makeMetadata({ nativeLyric: '0123456789ab' })), true)
check('native LYRICS 超过 10 字符算内嵌歌词', fileState.hasEmbeddedLyricMetadata(makeMetadata({ nativeId: 'LYRICS', nativeLyric: '0123456789ab' })), true)
check('无歌词返回 false', fileState.hasEmbeddedLyricMetadata(makeMetadata()), false)
check('common.picture 非空算内嵌封面', fileState.hasEmbeddedCoverMetadata(makeMetadata({ pictureCount: 1 })), true)
check('common.picture 空不算内嵌封面', fileState.hasEmbeddedCoverMetadata(makeMetadata({ pictureCount: 0 })), false)

// 已有 `.lrc` + 已有封面：不得调用 parseFile
fs.writeFileSync(path.join(workDir, 'Artist - Song.lrc'), '[00:01]hello')
fs.writeFileSync(path.join(workDir, 'Artist - Song.jpg'), 'fake-image')
let parseCalls = 0
const parseSpy = async() => {
  parseCalls++
  return makeMetadata({ commonLyrics: [{ text: 'embedded' }], pictureCount: 1 })
}
const bothSidecarState = await fileState.getFileState(audioPath, { parseAudioMetadata: parseSpy })
check('已有 .lrc + 封面：不解析音频', parseCalls, 0)
check('已有 .lrc + 封面：两项都不缺失', fileState.getMissingFlags(bothSidecarState), { missingLyric: false, missingCover: false, missing: false })

// 只有歌词：需要解析封面
fs.rmSync(path.join(workDir, 'Artist - Song.jpg'))
parseCalls = 0
const lyricOnlyState = await fileState.getFileState(audioPath, { parseAudioMetadata: parseSpy })
check('只有 .lrc：解析一次音频', parseCalls, 1)
check('只有 .lrc：内嵌封面命中', lyricOnlyState.hasEmbeddedCover, true)
check('只有 .lrc：不缺失', fileState.getMissingFlags(lyricOnlyState).missing, false)

// 空文件（0 字节）按不存在处理
fs.writeFileSync(path.join(workDir, 'Empty.mp3'), 'audio')
fs.writeFileSync(path.join(workDir, 'Empty.lrc'), '')
fs.writeFileSync(path.join(workDir, 'Empty.png'), '')
const emptyState = await fileState.getFileState(path.join(workDir, 'Empty.mp3'))
check('0 字节 .lrc 按不存在处理', emptyState.hasSidecarLyric, false)
check('0 字节 .png 按不存在处理', emptyState.hasSidecarCover, false)

// 大写扩展名也认
fs.writeFileSync(path.join(workDir, 'Upper.mp3'), 'audio')
fs.writeFileSync(path.join(workDir, 'Upper.LRC'), 'x')
fs.writeFileSync(path.join(workDir, 'Upper.KRC'), 'x')
fs.writeFileSync(path.join(workDir, 'Upper.png'), 'x')
const upperState = await fileState.getFileState(path.join(workDir, 'Upper.mp3'))
check('大写 .LRC/.KRC 认作独立歌词', upperState.hasSidecarLyric, true)
check('.png 认作独立封面', upperState.hasSidecarCover, true)

// 解析失败：不抛错、按无内嵌处理
let parseError = null
const brokenState = await fileState.getFileState(path.join(workDir, 'Empty.mp3'), {
  parseAudioMetadata: async() => { throw new Error('broken file') },
  onParseError: err => { parseError = err },
})
check('解析坏文件不抛错', brokenState.hasEmbeddedLyric, false)
check('解析坏文件按无内嵌处理', brokenState.hasEmbeddedCover, false)
check('解析失败回调被调用', parseError instanceof Error, true)

console.log('\n== 自动选择顺序 ==')
const lyricCandidates = [
  { score: 0.95 }, // 0 必试
  { instrumental: true, score: 0.99 }, // 纯音乐跳过
  { score: 0.8 }, // 2 命中
  { score: 0.59 }, // 低分跳过
  { score: 0.6 }, // 4 边界命中
  { score: 1 }, // 5 超出「最多 4 个回退」
]
check('歌词尝试顺序：第 1 个 + 最多 4 个 score>=0.6 且非 instrumental', batch.getLyricCandidateIndexes(lyricCandidates), [0, 2, 4])
check('歌词尝试顺序可指定起点', batch.getLyricCandidateIndexes(lyricCandidates, 2), [2, 4, 5])
check('歌词空候选', batch.getLyricCandidateIndexes(null), [])
check('封面尝试顺序：第 1 个 + 后续 2 个', batch.getCoverCandidateIndexes([{}, {}, {}, {}, {}]), [0, 1, 2])
check('封面候选不足 3 个', batch.getCoverCandidateIndexes([{}, {}]), [0, 1])
check('空白歌词不可用', batch.isUsableLyricResult({ lyric: '   ' }), false)
check('null 歌词不可用', batch.isUsableLyricResult(null), false)
check('正常歌词可用', batch.isUsableLyricResult({ lyric: '[00:01]line' }), true)

console.log('\n== 批次编排 ==')
type RunHarness = {
  deps: Record<string, any>
  summary: any
  progress: any[]
  calls: string[]
  sleeps: number[]
  lyricApplied: string[]
  coverApplied: string[]
}

const runBatch = async(
  musics: any[],
  stateMap: Record<string, any>,
  options: {
    lyricCandidates?: any[]
    lyricResult?: (index: number) => any
    applyLyricFail?: (index: number) => boolean
    coverCandidates?: any[]
    applyCoverFail?: (index: number) => boolean
    failStateFor?: string[]
    failLyricSearchFor?: string[]
    onProgress?: (progress: any) => void
  } = {},
): Promise<RunHarness> => {
  const progress: any[] = []
  const calls: string[] = []
  const sleeps: number[] = []
  const lyricApplied: string[] = []
  const coverApplied: string[] = []

  let matcher: any = null
  const deps: Record<string, any> = {
    getListMusics: async() => musics,
    getFileState: async(filePath: string) => {
      const id = path.basename(filePath, path.extname(filePath))
      if (options.failStateFor?.includes(id)) throw new Error('ipc failed: ' + id)
      return stateMap[id] ?? makeState({ fileExists: false })
    },
    searchLyricCandidates: async(musicInfo: any) => {
      calls.push('searchLyric:' + musicInfo.id)
      if (options.failLyricSearchFor?.includes(musicInfo.id)) throw new Error('search failed: ' + musicInfo.id)
      return options.lyricCandidates ?? [{ source: 'qq', id: 'c0', score: 0.95 }]
    },
    getCandidateLyric: async(candidate: any) => {
      const index = (options.lyricCandidates ?? []).indexOf(candidate)
      calls.push('getLyric:' + (candidate.id ?? index))
      return options.lyricResult ? options.lyricResult(index) : { lyric: '[00:01]line' }
    },
    applyLyric: async(musicInfo: any, candidate: any) => {
      const index = (options.lyricCandidates ?? []).indexOf(candidate)
      calls.push('applyLyric:' + (candidate.id ?? index))
      if (options.applyLyricFail?.(index)) throw new Error('apply lyric failed')
      lyricApplied.push(musicInfo.id + ':' + (candidate.id ?? index))
      return {}
    },
    searchCoverCandidates: async(musicInfo: any) => {
      calls.push('searchCover:' + musicInfo.id)
      return options.coverCandidates ?? [{ source: 'qq', id: 'cover0', coverUrl: 'https://example.com/0.jpg' }]
    },
    applyCover: async(musicInfo: any, candidate: any) => {
      const index = (options.coverCandidates ?? []).indexOf(candidate)
      calls.push('applyCover:' + (candidate.id ?? index))
      if (options.applyCoverFail?.(index)) throw new Error('apply cover failed')
      coverApplied.push(musicInfo.id + ':' + (candidate.id ?? index))
      return {}
    },
    onLyricApplied: async(musicInfo: any) => {
      calls.push('lyricApplied:' + musicInfo.id)
    },
    onCoverApplied: async(musicInfo: any) => {
      calls.push('coverApplied:' + musicInfo.id)
    },
    onProgress: (item: any) => {
      progress.push({ ...item })
      options.onProgress?.(item)
    },
    sleep: async(ms: number) => {
      sleeps.push(ms)
    },
    intervalMs: 200,
    onError: () => {},
  }
  matcher = batch.createBatchMatcher(deps)
  const summary = await matcher.run('list-1')
  return { deps, summary, progress, calls, sleeps, lyricApplied, coverApplied }
}

// 扫描：只处理本地 + 按项判定缺失；文件不存在计 skipped
const scanMusics = [makeMusic('a'), makeMusic('b'), { ...makeMusic('c'), source: 'online' }, makeMusic('d')]
const scanStates = {
  a: makeState({ hasSidecarLyric: true }),
  b: makeState({ hasEmbeddedLyric: true, hasSidecarCover: true }),
  c: makeState(),
  d: makeState({ fileExists: false }),
}
const scanRun = await runBatch(scanMusics, scanStates, {
  coverCandidates: [{ source: 'qq', id: 'cover0', coverUrl: 'https://example.com/0.jpg' }],
})
check('扫描只统计本地歌曲', scanRun.summary.totalLocal, 3)
check('只把确实缺失的歌曲加入补全', scanRun.summary.pending, 1)
check('缺封面歌曲补全封面 1 首', scanRun.summary.cover, 1)
check('有内嵌歌词的歌曲不重复写歌词', scanRun.summary.lyric, 0)
check('文件不存在计 skipped', scanRun.summary.skipped, 1)
check('扫描失败数', scanRun.summary.failed, 0)
check('已处理 1 首', scanRun.summary.processed, 1)
check('补全完成后 none=false', scanRun.summary.none, false)
check('进度阶段顺序', [...new Set(scanRun.progress.map(item => item.phase))], ['scanning', 'matching', 'done'])
check('进度终态计数', (() => {
  const last = scanRun.progress[scanRun.progress.length - 1]
  return { lyric: last.lyric, cover: last.cover, failed: last.failed, skipped: last.skipped }
})(), { lyric: 0, cover: 1, failed: 0, skipped: 1 })
check('封面写入后触发刷新回调', scanRun.calls.includes('coverApplied:a'), true)

// 两首缺失歌曲：串行 + 每首 200ms
const intervalRun = await runBatch([makeMusic('a'), makeMusic('b')], {
  a: makeState(),
  b: makeState(),
})
check('两首都补歌词/封面', { lyric: intervalRun.summary.lyric, cover: intervalRun.summary.cover }, { lyric: 2, cover: 2 })
check('每首之间 200ms 间隔', intervalRun.sleeps, [200])
check('串行：先处理第一首再处理第二首', intervalRun.lyricApplied, ['a:c0', 'b:c0'])

// 歌词自动选择：第 1 个无歌词 → 沿排序回退
const lyricRetryCandidates = [
  { source: 'lrclib', id: 'c0', score: 0.95 },
  { source: 'lrclib', id: 'c1', instrumental: true, score: 0.99 },
  { source: 'qq', id: 'c2', score: 0.8 },
  { source: 'qq', id: 'c3', score: 0.5 },
  { source: 'netease', id: 'c4', score: 0.6 },
  { source: 'netease', id: 'c5', score: 1 },
]
const lyricRetryRun = await runBatch([makeMusic('a')], {
  a: makeState({ hasSidecarCover: true }),
}, {
  lyricCandidates: lyricRetryCandidates,
  lyricResult: (index: number) => index === 4 ? { lyric: '[00:01]usable' } : null,
})
check('无有效歌词时自动采用第 3 个可用候选', lyricRetryRun.lyricApplied, ['a:c4'])
check('歌词回退只在排序范围内尝试', lyricRetryRun.calls.includes('getLyric:c5'), false)

// 歌词写入失败：继续尝试下一个候选
const lyricApplyFailRun = await runBatch([makeMusic('a')], {
  a: makeState({ hasSidecarCover: true }),
}, {
  lyricCandidates: [
    { source: 'lrclib', id: 'c0', score: 0.95 },
    { source: 'qq', id: 'c2', score: 0.8 },
  ],
  applyLyricFail: index => index === 0,
})
check('歌词写入失败后回退到下一个候选', lyricApplyFailRun.lyricApplied, ['a:c2'])

// 最多 4 个回退：第 5 个之后的候选不尝试
const lyricTooFarRun = await runBatch([makeMusic('a')], {
  a: makeState({ hasSidecarCover: true }),
}, {
  lyricCandidates: [
    { source: 'lrclib', id: 'c0', score: 0.95 },
    { source: 'lrclib', id: 'c1', score: 0.9 },
    { source: 'lrclib', id: 'c2', score: 0.9 },
    { source: 'lrclib', id: 'c3', score: 0.9 },
    { source: 'lrclib', id: 'c4', score: 0.9 },
    { source: 'lrclib', id: 'c5', score: 1 },
  ],
  lyricResult: (index: number) => index === 5 ? { lyric: '[00:01]usable' } : null,
})
check('超过第 5 个候选不再尝试', lyricTooFarRun.calls.includes('getLyric:c5'), false)
check('所有尝试都无歌词计失败', { lyric: lyricTooFarRun.summary.lyric, failed: lyricTooFarRun.summary.failed }, { lyric: 0, failed: 1 })

// 封面：失败最多再试后续 2 个
const coverRetryRun = await runBatch([makeMusic('a')], {
  a: makeState({ hasSidecarLyric: true }),
}, {
  coverCandidates: [
    { source: 'qq', id: 'cover0', coverUrl: 'https://example.com/0.jpg' },
    { source: 'qq', id: 'cover1', coverUrl: 'https://example.com/1.jpg' },
    { source: 'qq', id: 'cover2', coverUrl: 'https://example.com/2.jpg' },
    { source: 'qq', id: 'cover3', coverUrl: 'https://example.com/3.jpg' },
  ],
  applyCoverFail: index => index < 2,
})
check('封面失败后最多再试 2 个', coverRetryRun.coverApplied, ['a:cover2'])
check('封面第 4 个候选不尝试', coverRetryRun.calls.includes('applyCover:cover3'), false)
const coverAllFailRun = await runBatch([makeMusic('a')], {
  a: makeState({ hasSidecarLyric: true }),
}, {
  coverCandidates: [
    { source: 'qq', id: 'cover0', coverUrl: 'https://example.com/0.jpg' },
    { source: 'qq', id: 'cover1', coverUrl: 'https://example.com/1.jpg' },
    { source: 'qq', id: 'cover2', coverUrl: 'https://example.com/2.jpg' },
  ],
  applyCoverFail: () => true,
})
check('封面全部失败计失败', { cover: coverAllFailRun.summary.cover, failed: coverAllFailRun.summary.failed }, { cover: 0, failed: 1 })

// 取消：当前歌曲做完即收尾，不再开始下一首
const cancelControl: { matcher: any } = { matcher: null }
const cancelProgress: any[] = []
const cancelCalls: string[] = []
const cancelDeps: Record<string, any> = {
  getListMusics: async() => [makeMusic('a'), makeMusic('b')],
  getFileState: async() => makeState({ hasSidecarCover: true }),
  searchLyricCandidates: async(musicInfo: any) => {
    cancelCalls.push('search:' + musicInfo.id)
    return [{ source: 'qq', id: 'c0', score: 0.95 }]
  },
  getCandidateLyric: async() => ({ lyric: '[00:01]line' }),
  applyLyric: async() => ({}),
  searchCoverCandidates: async() => [],
  applyCover: async() => ({}),
  onLyricApplied: async() => {},
  onProgress: (item: any) => {
    cancelProgress.push({ ...item })
    if (item.phase === 'matching' && item.current === 1) cancelControl.matcher.cancel()
  },
  sleep: async() => {},
}
cancelControl.matcher = batch.createBatchMatcher(cancelDeps)
const cancelSummary = await cancelControl.matcher.run('list-1')
check('取消标记', cancelSummary.canceled, true)
check('取消后当前歌曲完成、不再开始下一首', { processed: cancelSummary.processed, lyric: cancelSummary.lyric }, { processed: 1, lyric: 1 })
check('取消后第二首不再查询', cancelCalls, ['search:a'])

// 单曲异常不中断整批
const errorRun = await runBatch([makeMusic('a'), makeMusic('b')], {
  a: makeState({ hasSidecarCover: true }),
  b: makeState(),
}, {
  failLyricSearchFor: ['a'],
})
check('单曲异常计 failed 且继续下一首', { failed: errorRun.summary.failed, lyric: errorRun.summary.lyric, cover: errorRun.summary.cover }, { failed: 1, lyric: 1, cover: 1 })
check('单曲异常后仍处理完两首', errorRun.summary.processed, 2)

// get_file_state 异常：failed 但不中断
const stateErrorRun = await runBatch([makeMusic('a'), makeMusic('b')], {
  a: makeState(),
  b: makeState(),
}, {
  failStateFor: ['a'],
})
check('文件状态读取异常计 failed', { failed: stateErrorRun.summary.failed, processed: stateErrorRun.summary.processed }, { failed: 1, processed: 1 })
check('文件状态异常后继续处理下一首', stateErrorRun.summary.lyric, 1)

// 没有本地歌曲 / 没有缺失
const noLocalRun = await runBatch([{ ...makeMusic('a'), source: 'online' }], {})
check('没有本地歌曲 noLocal=true', noLocalRun.summary.noLocal, true)
check('没有本地歌曲不发请求', noLocalRun.calls.length, 0)
const noneRun = await runBatch([makeMusic('a')], {
  a: makeState({ hasEmbeddedLyric: true, hasEmbeddedCover: true }),
})
check('没有缺失 none=true', noneRun.summary.none, true)
check('没有缺失不进入补全阶段', noneRun.calls.filter(item => item.startsWith('search')).length, 0)

console.log('\n== 普通对象转换（IPC structured clone） ==')
const proxyLikeMusic = makeMusic('plain')
const plainMusic = batch.toPlainMusicInfo(proxyLikeMusic)
check('musicInfo 转普通对象（浅拷贝）', plainMusic !== proxyLikeMusic && plainMusic.meta !== proxyLikeMusic.meta, true)
check('musicInfo 字段保持一致', { id: plainMusic.id, name: plainMusic.name, filePath: plainMusic.meta.filePath }, { id: 'plain', name: 'Song plain', filePath: 'D:\\music\\plain.mp3' })
plainMusic.meta.lyricSource = 'lrc'
check('改普通对象不影响原对象', proxyLikeMusic.meta.lyricSource, undefined)
const plainLyricCandidate = batch.toPlainLyricCandidate({
  source: 'qq',
  id: 'c0',
  name: 'Song',
  singer: 'Artist',
  albumName: 'Album',
  durationSec: 180,
  hasSynced: true,
  instrumental: false,
  score: 0.9,
  lyric: 'cached-lyric',
})
check('歌词候选不携带缓存正文', plainLyricCandidate.lyric, undefined)
check('歌词候选保留主进程所需字段', { source: plainLyricCandidate.source, id: plainLyricCandidate.id, score: plainLyricCandidate.score }, { source: 'qq', id: 'c0', score: 0.9 })
const plainCoverCandidate = batch.toPlainCoverCandidate({
  source: 'qq',
  id: 'albummid',
  name: 'Song',
  singer: 'Artist',
  albumName: 'Album',
  durationSec: 180,
  coverUrl: 'https://example.com/c.jpg',
  thumbnailUrl: 'https://example.com/t.jpg',
  score: 0.8,
})
check('封面候选保留 URL', { coverUrl: plainCoverCandidate.coverUrl, thumbnailUrl: plainCoverCandidate.thumbnailUrl }, {
  coverUrl: 'https://example.com/c.jpg',
  thumbnailUrl: 'https://example.com/t.jpg',
})
check('本地歌曲计数只算 local + 有文件路径', batch.countLocalMusics([
  makeMusic('a'),
  { ...makeMusic('b'), source: 'online' },
  { ...makeMusic('c'), meta: { ...makeMusic('c').meta, filePath: '' } },
]), 1)

console.log('\n== i18n 四语 key ==')
const langNames = ['zh-cn', 'zh-tw', 'en-us', 'ko-kr']
const langData: Record<string, Record<string, string>> = {}
for (const name of langNames) {
  langData[name] = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'lang', name + '.json'), 'utf8'))
}
const requiredKeys = [
  'batch_match__btn',
  'batch_match__btn_short',
  'batch_match__title',
  'batch_match__confirm',
  'batch_match__scanning',
  'batch_match__scan_current',
  'batch_match__matching',
  'batch_match__match_current',
  'batch_match__none',
  'batch_match__no_local',
  'batch_match__cancel',
  'batch_match__canceled',
  'batch_match__summary',
]
const placeholderMap: Record<string, string[]> = {
  batch_match__confirm: ['{total}'],
  batch_match__scan_current: ['{current}', '{total}', '{name}'],
  batch_match__match_current: ['{current}', '{total}', '{name}'],
  batch_match__canceled: ['{done}'],
  batch_match__summary: ['{lyric}', '{cover}', '{failed}', '{skipped}'],
}
for (const name of langNames) {
  const data = langData[name]
  const missing = requiredKeys.filter(key => !data[key])
  check(`${name} 契约 key 齐全`, missing, [])
  for (const [key, placeholders] of Object.entries(placeholderMap)) {
    check(`${name} ${key} 占位符完整`, placeholders.filter(ph => !(data[key] ?? '').includes(ph)), [])
  }
  const batchKeys = Object.keys(data).filter(key => key.startsWith('batch_match__'))
  check(`${name} batch_match key 数量`, batchKeys.length >= requiredKeys.length, true)
}
const allBatchKeySets = langNames.map(name => Object.keys(langData[name]).filter(key => key.startsWith('batch_match__')).sort())
check('四语 batch_match key 集合一致', allBatchKeySets.every(keys => JSON.stringify(keys) === JSON.stringify(allBatchKeySets[0])), true)
check('zh-cn 按钮文案', langData['zh-cn']['batch_match__btn'], '一键补全缺失歌词/封面')
check('ko-kr 取消文案', langData['ko-kr']['batch_match__cancel'], '취소')

console.log('\n== IPC / UI 接线 ==')
const readSource = (relPath: string) => fs.readFileSync(path.join(sourceRoot, relPath), 'utf8')
const ipcNamesSource = readSource('common/ipcNames.ts')
const mediaMatchMainSource = readSource('main/modules/mediaMatch/rendererEvent.ts')
const mediaMatchFileStateSource = readSource('main/modules/mediaMatch/fileState.ts')
const rendererIpcSource = readSource('renderer/utils/ipc.ts')
const musicListSource = readSource('renderer/views/List/MusicList/index.vue')
const musicListMenuSource = readSource('renderer/views/List/MusicList/useMenu.js')
const useBatchMatchSource = readSource('renderer/views/List/MusicList/useBatchMatch.js')
const batchModalSource = readSource('renderer/components/common/BatchMatchModal.vue')
const batchCoreSource = readSource('common/utils/mediaMatch/batch.ts')
const batchFileStateSource = readSource('common/utils/mediaMatch/fileState.ts')

check('ipcNames 注册 get_file_state', ipcNamesSource.includes('get_file_state'), true)
check('主进程注册 get_file_state handler', mediaMatchMainSource.includes('MEDIA_MATCH_EVENT_NAME.get_file_state'), true)
check('主进程 handler 调用 getFileState', mediaMatchMainSource.includes('return getFileState(params?.filePath)'), true)
check('主进程 fileState 使用共享判定逻辑', mediaMatchFileStateSource.includes('@common/utils/mediaMatch/fileState'), true)
check('渲染层导出 mediaMatchGetFileState', rendererIpcSource.includes('mediaMatchGetFileState'), true)
check('渲染层使用 MEDIA_MATCH_EVENT_NAME.get_file_state', rendererIpcSource.includes('MEDIA_MATCH_EVENT_NAME.get_file_state'), true)
check('MusicList 顶部有 batch_match__btn 按钮', musicListSource.includes('batch_match__btn'), true)
check('MusicList 引入 useBatchMatch', musicListSource.includes('useBatchMatch'), true)
check('MusicList 渲染进度弹窗', musicListSource.includes('common-batch-match-modal'), true)
check('MusicList 取消按钮接线', /@cancel="cancelBatchMatch"/.test(musicListSource), true)
check('入口不在每首歌右键菜单', musicListMenuSource.includes('batch_match'), false)
check('useBatchMatch 使用纯逻辑编排', useBatchMatchSource.includes('createBatchMatcher'), true)
check('useBatchMatch 调用 get_file_state 包装', useBatchMatchSource.includes('mediaMatchGetFileState'), true)
check('useBatchMatch 歌词来源写入 lrc', useBatchMatchSource.includes("setMusicLyricSource(plainMusicInfo, 'lrc'"), true)
check('useBatchMatch 刷新播放歌词/封面', useBatchMatchSource.includes('refreshPlayLyric') && useBatchMatchSource.includes('refreshPlayCover'), true)
check('useBatchMatch 取消路径', useBatchMatchSource.includes('cancelBatchMatch') && useBatchMatchSource.includes('.cancel()'), true)
check('useBatchMatch 所有 IPC 参数转换普通对象', useBatchMatchSource.includes('toPlainMusicInfo') && useBatchMatchSource.includes('mediaMatchSearch({ musicInfo: toPlainMusicInfo'), true)
check('进度弹窗使用 material-modal', batchModalSource.includes('material-modal'), true)
check('进度弹窗显示阶段/歌曲/计数/取消', ['batch_match__scanning', 'batch_match__match_current', 'batch_match__count_lyric', 'batch_match__cancel'].every(key => batchModalSource.includes(key)), true)
check('纯逻辑回退上限 4', batchCoreSource.includes('MAX_LYRIC_FALLBACK = 4'), true)
check('纯逻辑歌词阈值 0.6', batchCoreSource.includes('MIN_LYRIC_SCORE = 0.6'), true)
check('纯逻辑封面回退上限 2', batchCoreSource.includes('MAX_COVER_FALLBACK = 2'), true)
check('纯逻辑默认 200ms 间隔', batchCoreSource.includes('DEFAULT_BATCH_INTERVAL = 200'), true)
check('文件状态判定默认跳过解析', batchFileStateSource.includes('shouldParseAudioMetadata'), true)

console.log('\n== 真实本地文件集成（localmusic） ==')
const localMusicRoot = 'E:\\WorkSpace\\LXMusic\\localmusic'
if (!fs.existsSync(localMusicRoot)) {
  console.log(`  skip 未找到 ${localMusicRoot}，跳过真实文件验证`)
} else {
  const { parseFile } = await import('music-metadata')
  const realParse = async(filePath: string) => await parseFile(filePath, { duration: false })
  const starDir = path.join(localMusicRoot, '星辰恋曲的白色永恒')
  const starAudio = fs.readdirSync(starDir).find(name => /\.(?:ogg|flac|mp3|m4a)$/i.test(name))
  check('真实目录有音频文件', !!starAudio, true)
  if (starAudio) {
    const starPath = path.join(starDir, starAudio)
    const starState = await fileState.getFileState(starPath, { parseAudioMetadata: realParse })
    check('真实文件存在', starState.fileExists, true)
    check('真实文件同目录 .lrc 判为已有歌词', starState.hasSidecarLyric, true)
    check('真实文件没有独立封面', starState.hasSidecarCover, false)
    check('真实文件判定缺封面', fileState.getMissingFlags(starState).missingCover, true)
    check('真实文件判定歌词不缺失', fileState.getMissingFlags(starState).missingLyric, false)
    console.log(`  info 星辰恋曲样本: ${starAudio}`)
    console.log(`  info state: ${JSON.stringify(starState)}`)

    // 复制一份到临时目录（去掉同目录 .lrc）再测缺失歌词
    const realWorkDir = createWorkDir('real')
    const copiedAudio = path.join(realWorkDir, 'NoSidecar.ogg')
    fs.copyFileSync(starPath, copiedAudio)
    const copiedState = await fileState.getFileState(copiedAudio, { parseAudioMetadata: realParse })
    check('复制后无 .lrc：hasSidecarLyric=false', copiedState.hasSidecarLyric, false)
    check('复制后无 .lrc：判定缺歌词', fileState.getMissingFlags(copiedState).missingLyric, true)
    check('复制后无封面：判定缺封面', fileState.getMissingFlags(copiedState).missingCover, true)
    console.log(`  info 去掉 .lrc 的样本 state: ${JSON.stringify(copiedState)}`)
  }

  // 真实 FLAC 有内嵌封面：不重复补封面
  const flacDir = path.join(localMusicRoot, '小岩井ことり _ 佐倉綾音')
  const flacName = fs.readdirSync(flacDir).find(name => /\.flac$/i.test(name))
  check('真实 FLAC 有内嵌封面样本', !!flacName, true)
  if (flacName) {
    const flacPath = path.join(flacDir, flacName)
    const flacState = await fileState.getFileState(flacPath, { parseAudioMetadata: realParse })
    check('真实 FLAC 内嵌封面判为已有', flacState.hasEmbeddedCover, true)
    check('真实 FLAC 封面不缺失', fileState.getMissingFlags(flacState).missingCover, false)
    console.log(`  info FLAC 内嵌封面样本: ${flacName} state=${JSON.stringify(flacState)}`)
  }
}

console.log(`\nresult: ${passed} passed, ${failed} failed`)
if (failed) process.exitCode = 1
