/**
 * 在线歌词匹配：纯逻辑 + LRC 文件规则测试
 *
 * 运行：node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/media-match.test.ts
 *
 * 纯逻辑模块是 TS，直接把源码复制到临时目录并把无扩展名的相对导入补成 `.ts`，
 * 以便 node 原生类型擦除直接运行（与 tests/music-file-fs.test.ts 同一套路）。
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

const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url))
const moduleNames = [
  'common/utils/mediaMatch/normalize.ts',
  'common/utils/mediaMatch/score.ts',
  'common/utils/mediaMatch/query.ts',
  'common/utils/mediaMatch/lrcText.ts',
  'common/utils/mediaMatch/source.ts',
  'common/utils/mediaMatch/qqParse.ts',
  'main/modules/mediaMatch/lrcFile.ts',
  'main/modules/mediaMatch/retry.ts',
]
const moduleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-media-match-'))
for (const relPath of moduleNames) {
  const code = fs.readFileSync(path.join(sourceRoot, relPath), 'utf8')
    .replace(/from '\.\/([A-Za-z0-9_]+)'/g, "from './$1.ts'")
  fs.writeFileSync(path.join(moduleDir, path.basename(relPath)), code, 'utf8')
}

const load = async(name: string) => {
  return import(pathToFileURL(path.join(moduleDir, name + '.ts')).href)
}

const normalize = await load('normalize')
const score = await load('score')
const query = await load('query')
const lrcText = await load('lrcText')
const source = await load('source')
const qqParse = await load('qqParse')
const lrcFile = await load('lrcFile')
const retry = await load('retry')

const fsPromisesModule = await import('node:fs/promises')
const fsPromises = fsPromisesModule.default

const createWorkDir = (name: string) => fs.mkdtempSync(path.join(os.tmpdir(), `lx-media-match-${name}-`))

const makeMusicInfo = (overrides: Record<string, unknown> = {}) => ({
  id: 'D:\\music\\Artist - Song (TV ver.).flac',
  name: 'Song',
  singer: 'Artist',
  source: 'local',
  interval: '03:55',
  meta: {
    songId: 'D:\\music\\Artist - Song (TV ver.).flac',
    albumName: 'Album',
    filePath: 'D:\\music\\Artist - Song (TV ver.).flac',
    ext: 'flac',
  },
  ...overrides,
})

console.log('\n== normalize ==')
check('全角转半角 + 全角空格', normalize.toHalfWidth('ＡＢＣ　１２３'), 'ABC 123')
check('打分归一化去空白标点并小写', normalize.normalizeKey(' 晴天 (Live)! '), '晴天live')
check('清洗去括号内容与 feat.', normalize.cleanQueryName('Song (TV Size) feat. X'), 'Song')
check('清洗去 Off Vocal', normalize.cleanQueryName('Song (Off Vocal)'), 'Song')
check('清洗去尖括号版本标记', normalize.cleanQueryName('なかよし!〇!なかよし!<TVサイズ>'), 'なかよし!〇!なかよし!')
check('纯音乐标记识别（Off Vocal）', normalize.hasInstrumentalMark('Song (Off Vocal)'), true)
check('纯音乐标记识别（Inst_）', normalize.hasInstrumentalMark('Song (Inst_)'), true)
check('普通歌名不误判', normalize.hasInstrumentalMark('Song'), false)

console.log('\n== query ==')
const matchQuery = query.createMatchQuery(makeMusicInfo())
check('时长解析', matchQuery.durationSec, 235)
check('文件名去扩展名', matchQuery.fileStem, 'Artist - Song (TV ver.)')
check('查询变体顺序', matchQuery.variants, [
  'Song Artist',
  'Song',
  'Artist Song (TV ver.)',
  'Song (TV ver.) Artist',
])
check('无效时长返回 null', query.parseDurationSec('--/--'), null)
const keywordQuery = query.createKeywordQuery('Song Artist', makeMusicInfo())
check('关键词查询变体', keywordQuery.variants, ['Song Artist'])

const reproQuery = {
  name: '夜に駆ける',
  singer: 'YOASOBI',
  albumName: '',
  durationSec: null,
  fileStem: '夜に駆ける',
  variants: ['夜に駆ける YOASOBI', '夜に駆ける'],
}
check('LRCLIB q 回退首项固定为 name singer', query.buildLrclibKeywordFallbacks(reproQuery), [
  '夜に駆ける YOASOBI',
  '夜に駆ける',
])
check('LRCLIB q 回退无歌手时退化为 name', query.buildLrclibKeywordFallbacks({ ...reproQuery, singer: '' }), ['夜に駆ける'])
check(
  'LRCLIB q 回退追加清洗后的歌名',
  query.buildLrclibKeywordFallbacks({ ...reproQuery, name: 'Song (TV Size)', singer: 'Artist' }),
  ['Song (TV Size) Artist', 'Song (TV Size)', 'Song'],
)

console.log('\n== retry ==')
check('Retry-After 秒解析', retry.parseRetryAfterMs('2'), 2000)
check('Retry-After HTTP-date 解析', retry.parseRetryAfterMs(new Date(10000).toUTCString(), 0), 10000)
check('Retry-After 非法值', retry.parseRetryAfterMs('not-a-date'), null)
check('Retry-After >30s 放弃重试', retry.resolveRetryDelayMs(31000, 0), null)
check('Retry-After 30s 按服务端值等待', retry.resolveRetryDelayMs(30000, 0), 30000)
check('无 Retry-After 指数退避', retry.resolveRetryDelayMs(null, 1), 1000)

console.log('\n== score ==')
const baseQuery = {
  name: 'Song',
  singer: 'Artist',
  albumName: 'Album',
  durationSec: 235,
  fileStem: 'Artist - Song',
  variants: ['Song Artist', 'Song'],
}
const candidate = (overrides: Record<string, unknown> = {}) => ({
  source: 'lrclib',
  id: '1',
  name: 'Song',
  singer: 'Artist',
  albumName: 'Album',
  durationSec: 235,
  hasSynced: true,
  instrumental: false,
  score: 0,
  ...overrides,
})
check('完全一致 = 1', score.scoreCandidate(baseQuery, candidate()), 1)
check(
  '标题包含 + 歌手不匹配 + 时长差 5s',
  score.scoreCandidate(baseQuery, candidate({ name: 'Song (Live)', singer: 'Other', durationSec: 240 })),
  0.585,
)
check(
  '缺时长给中性 0.5',
  score.scoreCandidate(baseQuery, candidate({ durationSec: null })),
  0.9,
)
const normalScore = score.scoreCandidate(baseQuery, candidate({ name: 'Song Live' }))
const penaltyScore = score.scoreCandidate(baseQuery, candidate({ name: 'Song (Off Vocal)' }))
check('候选标题带 Off Vocal 且查询不带 → 减半', penaltyScore * 2, normalScore)
const queryInstrumental = score.scoreCandidate({ ...baseQuery, name: 'Song (Off Vocal)' }, candidate({ name: 'Song (Off Vocal)' }))
check('查询本身带标记时不扣分', queryInstrumental, score.scoreCandidate({ ...baseQuery, name: 'Song' }, candidate({ name: 'Song' })))
check('isInstrumentalQuery 识别文件名标记', score.isInstrumentalQuery({ ...baseQuery, name: 'Song', fileStem: 'Song (Inst_)' }), true)

const merged = score.rankCandidates(baseQuery, [
  candidate({ source: 'lrclib', name: 'song', singer: 'artist', durationSec: 235.4 }),
  candidate({ source: 'qq', name: 'Song', singer: 'Artist', durationSec: 235 }),
  candidate({ source: 'lrclib', name: 'Other', singer: 'Nobody', durationSec: 100 }),
])
check('按 id/名/歌手/时长去重', merged.length, 2)
check('去重保留分数高者', merged[0].score >= merged[1].score, true)
const many = Array.from({ length: 35 }, (_, i) => candidate({ id: String(i), name: `Song ${i}` }))
check('最多返回 30 条', score.rankCandidates(baseQuery, many).length, 30)

console.log('\n== lrcText ==')
check(
  'LRC 头部 + 正文合并空行 + 结尾换行',
  lrcText.buildLrcText({
    name: 'Song',
    singer: 'Artist',
    albumName: 'Album',
    lyric: '\r\n[00:01.00]line a\r\n\r\n\r\n[00:02.00]line b  \r\n',
    isSynced: true,
  }),
  '[ti:Song]\n[ar:Artist]\n[al:Album]\n[00:01.00]line a\n\n[00:02.00]line b\n',
)
check(
  '空元数据不写头部',
  lrcText.buildLrcText({ name: 'Song', singer: '', albumName: '', lyric: '[00:01]line a', isSynced: true }),
  '[ti:Song]\n[00:01]line a\n',
)
check(
  'LRC 剔除词级时间标签',
  lrcText.buildLrcText({ name: 'Song', singer: '', albumName: '', lyric: '[00:01.00]<0,300>あ<300,200>い', isSynced: true }),
  '[ti:Song]\n[00:01.00]あい\n',
)
check(
  '纯文本去掉时间标签',
  lrcText.buildLrcText({ name: 'Song', singer: '', albumName: '', lyric: '[00:01]line a', isSynced: false }),
  '[ti:Song]\nline a\n',
)

const qqStyleLrc = [
  '[ti:打上花火 (《烟花》动画电影主题曲)]',
  '[ar:DAOKO (ダヲコ)/米津玄師 (よねづ けんし)]',
  '[al:THANK YOU BLUE]',
  '[by:]',
  '[offset:0]',
  '[00:01.00]line one here',
  '[00:05.50]line two here',
  '',
].join('\n')
const dedupedLrc = lrcText.buildLrcText({
  name: '打上花火',
  singer: 'Daoko / 米津玄師',
  albumName: '打上花火 (通常盤)',
  lyric: qqStyleLrc,
  isSynced: true,
})
check(
  'QQ 风格歌词剔除自带头部并保留 offset/时间标签',
  dedupedLrc,
  '[ti:打上花火]\n[ar:Daoko / 米津玄師]\n[al:打上花火 (通常盤)]\n[offset:0]\n[00:01.00]line one here\n[00:05.50]line two here\n',
)
check('输出恰好一组 [ti:]', (dedupedLrc.match(/^\[ti:/gm) ?? []).length, 1)
check('输出恰好一组 [ar:]', (dedupedLrc.match(/^\[ar:/gm) ?? []).length, 1)
check('输出不保留源 [by:]', dedupedLrc.includes('[by:'), false)
check('保留 [offset:0]', dedupedLrc.includes('[offset:0]'), true)
check('保留正文时间标签', (dedupedLrc.match(/^\[\d{1,2}:\d{2}/gm) ?? []).length, 2)

const syncedValidation = lrcText.validateLyric('[00:01.00]line one here\n[00:05.50]line two here')
check('有效同步歌词', syncedValidation, { isSynced: true, usable: true, placeholder: false })
check('过短歌词无效', lrcText.validateLyric('[00:01]short'), { isSynced: true, usable: false, placeholder: false })
check('占位文本无效', lrcText.validateLyric('未经许可,不得翻唱或使用'), { isSynced: false, usable: false, placeholder: true })
check(
  '无时间轴但长度足够可用',
  lrcText.validateLyric('作词 : ZAQ / 作曲 : ZAQ / 编曲 : ZAQ'),
  { isSynced: false, usable: true, placeholder: false },
)

console.log('\n== qqParse ==')
const qqSearchText = {
  code: 0,
  data: {
    song: {
      list: [
        {
          songmid: '001p3V4c0PQdmd',
          songname: '打上花火',
          singer: [{ name: 'Daoko' }, { name: '米津玄師' }],
          albumname: '打上花火 (通常盤)',
          interval: '289',
        },
        {
          songmid: '',
          songname: 'invalid',
        },
      ],
    },
  },
}
const qqItems = qqParse.parseQqSearchResponse(qqSearchText)
check('QQ 搜索结果条数', qqItems.length, 1)
check('QQ 结果字段映射', qqItems[0], {
  id: '001p3V4c0PQdmd',
  name: '打上花火',
  singer: 'Daoko / 米津玄師',
  albumName: '打上花火 (通常盤)',
  durationSec: 289,
  instrumental: false,
})
check('QQ 搜索错误码返回空', qqParse.parseQqSearchResponse({ code: -1310 }), [])
check('HTML 实体解码', qqParse.htmlUnescape('&amp;&lt;&#39;&#x27;'), "&<''")
const qqSynced = qqParse.parseQqLyricResponse({
  code: 0,
  retcode: 0,
  lyric: '[ti:打上花火]\n[ar:DAOKO/米津玄師]\n[00:01.00]line one here\n[00:05.50]line two here\n',
})
check('QQ 歌词解析（同步）', { code: qqSynced.code, isSynced: qqSynced.isSynced, usable: qqSynced.lyric != null }, { code: 0, isSynced: true, usable: true })
check('QQ 歌词解析（无歌词 -1901）', qqParse.parseQqLyricResponse({ code: -1901 }).lyric, null)
const qqPlaceholder = qqParse.parseQqLyricResponse({ code: 0, lyric: '未经许可,不得翻唱或使用' })
check('QQ 占位文本', { lyric: qqPlaceholder.lyric, placeholder: qqPlaceholder.placeholder }, { lyric: null, placeholder: true })
const qqPlain = qqParse.parseQqLyricResponse({
  code: 0,
  lyric: '作词 : ZAQ / 作曲 : ZAQ / 编曲 : ZAQ / 演唱 : ZAQ',
})
check('QQ 无时间轴纯文本可用', { isSynced: qqPlain.isSynced, usable: qqPlain.lyric != null }, { isSynced: false, usable: true })
const qqBase64Placeholder = qqParse.parseQqLyricResponse({
  code: 0,
  lyric: '5pyq57uP6K645Y+vLOS4jeW+l+e/u+WUseaIluS9v+eUqA==',
})
check(
  'QQ base64 占位文本不当作歌词',
  { lyric: qqBase64Placeholder.lyric, placeholder: qqBase64Placeholder.placeholder },
  { lyric: null, placeholder: true },
)
const qqBase64Synced = qqParse.parseQqLyricResponse({
  code: 0,
  lyric: Buffer.from('[ti:x]\n[ar:y]\n[00:01.00]line one here\n[00:05.50]line two here\n').toString('base64'),
})
check(
  'QQ base64 歌词兜底解码',
  { isSynced: qqBase64Synced.isSynced, usable: qqBase64Synced.lyric != null },
  { isSynced: true, usable: true },
)

console.log('\n== source ==')
check('默认内嵌', source.getPreferredLyricSource(undefined, undefined), 'embedded')
check('单曲覆盖优先', source.getPreferredLyricSource('lrc', 'embedded'), 'lrc')
check('全局默认兜底', source.getPreferredLyricSource(undefined, 'lrc'), 'lrc')
check('内嵌存在用内嵌', source.resolveLyricSource(true, true, 'embedded'), 'embedded')
check('内嵌缺失回退 LRC', source.resolveLyricSource(false, true, 'embedded'), 'lrc')
check('LRC 缺失回退内嵌', source.resolveLyricSource(true, false, 'lrc'), 'embedded')
check('都不存在为空', source.resolveLyricSource(false, false, 'embedded'), null)

console.log('\n== lrcFile（临时目录） ==')
const workDir = createWorkDir('files')
const audioPath = path.join(workDir, 'Artist - Song.mp3')
const audioContent = Buffer.from('fake-audio-content')
fs.writeFileSync(audioPath, audioContent)
const audioHashBefore = fs.readFileSync(audioPath).toString('base64')

const firstApply = await lrcFile.applyLrc(audioPath, '[ti:Song]\n[00:01]hello\n')
check('首次写入生成同名 lrc', fs.existsSync(path.join(workDir, 'Artist - Song.lrc')), true)
check('首次写入不产生备份', firstApply.backupCreated, false)
check('首次写入内容正确', fs.readFileSync(path.join(workDir, 'Artist - Song.lrc'), 'utf8'), '[ti:Song]\n[00:01]hello\n')

fs.writeFileSync(path.join(workDir, 'Artist - Song.lrc'), 'original-lrc')
const secondApply = await lrcFile.applyLrc(audioPath, 'matched-lrc')
check('已存在 lrc 先备份', secondApply.backupCreated, true)
check('备份保留原始内容', fs.readFileSync(path.join(workDir, 'Artist - Song.lrc.bak'), 'utf8'), 'original-lrc')
check('新 lrc 写入成功', fs.readFileSync(path.join(workDir, 'Artist - Song.lrc'), 'utf8'), 'matched-lrc')

const thirdApply = await lrcFile.applyLrc(audioPath, 'matched-lrc-2')
check('已有备份时不再覆盖备份', thirdApply.backupCreated, false)
check('备份内容保持不变', fs.readFileSync(path.join(workDir, 'Artist - Song.lrc.bak'), 'utf8'), 'original-lrc')
check('lrc 被覆盖', fs.readFileSync(path.join(workDir, 'Artist - Song.lrc'), 'utf8'), 'matched-lrc-2')

const stateAfterApply = await lrcFile.getLrcState(audioPath)
check('状态查询', { lrcExists: stateAfterApply.lrcExists, backupExists: stateAfterApply.backupExists }, { lrcExists: true, backupExists: true })

// 回退失败安全：写回 lrc 的 rename 失败时，当前 lrc 与备份都必须保留，可重试
const originalRename = fsPromises.rename
fsPromises.rename = async () => {
  const err = new Error('operation not permitted')
  err.code = 'EPERM'
  throw err
}
try {
  await checkThrows('回退 rename 失败抛错', async() => await lrcFile.rollbackLrc(audioPath))
} finally {
  fsPromises.rename = originalRename
}
check('回退失败时当前 lrc 未丢', fs.readFileSync(path.join(workDir, 'Artist - Song.lrc'), 'utf8'), 'matched-lrc-2')
check('回退失败时备份保留', fs.readFileSync(path.join(workDir, 'Artist - Song.lrc.bak'), 'utf8'), 'original-lrc')
check('回退失败不残留临时文件', fs.existsSync(path.join(workDir, 'Artist - Song.lrc.rollback.tmp')), false)
check('回退可重试并成功', await lrcFile.rollbackLrc(audioPath), true)
check('回退恢复原始备份', fs.readFileSync(path.join(workDir, 'Artist - Song.lrc'), 'utf8'), 'original-lrc')
check('回退后备份消失', fs.existsSync(path.join(workDir, 'Artist - Song.lrc.bak')), false)
check('无备份时回退返回 false', await lrcFile.rollbackLrc(audioPath), false)
check('音频文件内容未变化', fs.readFileSync(audioPath).toString('base64'), audioHashBefore)

// 失败恢复：备份改名后写临时文件失败（模拟磁盘满），应把备份改回 lrc
const audioPath2 = path.join(workDir, 'Failure.mp3')
fs.writeFileSync(audioPath2, 'audio-2')
fs.writeFileSync(path.join(workDir, 'Failure.lrc'), 'keep-me')
const originalWriteFile = fsPromises.writeFile
fsPromises.writeFile = async () => {
  const err = new Error('no space left on device')
  err.code = 'ENOSPC'
  throw err
}
try {
  await checkThrows('写入失败抛错', async() => await lrcFile.applyLrc(audioPath2, 'new-lrc'))
} finally {
  fsPromises.writeFile = originalWriteFile
}
check('失败后原 lrc 恢复', fs.readFileSync(path.join(workDir, 'Failure.lrc'), 'utf8'), 'keep-me')
check('失败后不残留备份', fs.existsSync(path.join(workDir, 'Failure.lrc.bak')), false)
check('失败后不残留临时文件', fs.existsSync(path.join(workDir, 'Failure.lrc.tmp')), false)

await checkThrows('不存在的音频路径拒绝写入', async() => await lrcFile.applyLrc(path.join(workDir, 'missing.mp3'), 'x'))
check('lrc 扩展名路径拒绝写入', await lrcFile.isAudioFilePath(path.join(workDir, 'Artist - Song.lrc')), false)

console.log(`\nresult: ${passed} passed, ${failed} failed`)
if (failed) process.exitCode = 1
