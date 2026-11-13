/**
 * Phase 4：网易云歌词翻译/罗马音 + `[awlrc:]` 扩展段 + 预览插行 + 默认迁移测试
 *
 * 运行：node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/lyrics-translation.test.ts
 *
 * 与 tests/media-match.test.ts 同一套路：把 TS 源码复制到临时目录，补齐导入扩展名，
 * 并把 `@common/utils/request`、`@common/utils` 换成可注入的 stub；netease provider
 * 通过 stub request 驱动，无需真实网络。
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
const moduleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-lyrics-translation-'))

const baseTransforms = [
  (code: string) => code.replace(/from '@common\/utils\/request'/g, "from './request.ts'"),
  (code: string) => code.replace(/from '@common\/utils'/g, "from './log.ts'"),
  (code: string) => code.replace(/from '@common\/utils\/mediaMatch\/([A-Za-z0-9_]+)'/g, "from './$1.ts'"),
  (code: string) => code.replace(/from '\.\/([A-Za-z0-9_]+)'/g, "from './$1.ts'"),
]
const copyModule = (relPath: string, transforms: Array<(code: string) => string> = []) => {
  const code = fs.readFileSync(path.join(sourceRoot, relPath), 'utf8')
  const outName = path.basename(relPath)
  fs.writeFileSync(path.join(moduleDir, outName), transforms.reduce((value, fn) => fn(value), code), 'utf8')
}

// 测试桩：request / log 在模块加载时注入，测试里改 requestState.state.handler
fs.writeFileSync(path.join(moduleDir, 'request.ts'), `
export const state = { requests: [], handler: null }
export const request = async (url, options) => {
  state.requests.push({ url, options })
  if (!state.handler) throw new Error('request handler not set')
  return await state.handler(url, options)
}
`, 'utf8')
fs.writeFileSync(path.join(moduleDir, 'log.ts'), `
export const state = { logs: [] }
export const log = {
  debug: (...args) => { state.logs.push(args) },
}
`, 'utf8')

for (const relPath of [
  'common/utils/mediaMatch/lrcText.ts',
  'common/utils/mediaMatch/qrcLyric.ts',
  'common/utils/mediaMatch/normalize.ts',
  'common/utils/mediaMatch/qqParse.ts',
]) copyModule(relPath, baseTransforms)
copyModule('main/modules/mediaMatch/providers/netease.ts', baseTransforms)
copyModule('common/defaultSetting.ts', baseTransforms)
// migrateSetting 只用到 compareVer：从 common/utils/index.ts 抽出真实实现，避免依赖 electron
const utilsIndexSource = fs.readFileSync(path.join(sourceRoot, 'common/utils/index.ts'), 'utf8')
const compareVerStart = utilsIndexSource.indexOf('export function compareVer')
const compareVerTail = utilsIndexSource.slice(compareVerStart)
const compareVerEnd = compareVerTail.search(/\r?\n\r?\nexport\s*\{/)
fs.writeFileSync(
  path.join(moduleDir, 'utilsIndex.ts'),
  (compareVerEnd === -1 ? compareVerTail : compareVerTail.slice(0, compareVerEnd)) + '\n',
  'utf8',
)
copyModule('common/utils/migrateSetting.ts', [
  (code: string) => code.replace(/from '\.\/index'/g, "from './utilsIndex.ts'"),
  ...baseTransforms,
])

// 真实 parseLyric：从 renderer/worker/main/music.ts 抽函数文本（不修改解析行为）
const musicTsSource = fs.readFileSync(path.join(sourceRoot, 'renderer/worker/main/music.ts'), 'utf8')
const parseLyricStart = musicTsSource.indexOf('export const parseLyric')
const parseLyricEnd = musicTsSource.indexOf('export const getMusicFileLyric')
fs.writeFileSync(
  path.join(moduleDir, 'parseLyric.ts'),
  musicTsSource.slice(parseLyricStart, parseLyricEnd).trim() + '\n',
  'utf8',
)

const load = async(name: string) => {
  return import(pathToFileURL(path.join(moduleDir, name + '.ts')).href)
}

const lrcText = await load('lrcText')
const qrcLyric = await load('qrcLyric')
const netease = (await load('netease')).default
const defaultSetting = (await load('defaultSetting')).default
const migrateSetting = (await load('migrateSetting')).default
const parseLyric = (await load('parseLyric')).parseLyric
const requestState = await load('request')
const logState = await load('log')

const makeBody = (lyric: string) => lrcText.buildLrcText({
  name: '打上花火',
  singer: 'Daoko / 米津玄師',
  albumName: 'THANK YOU BLUE',
  lyric,
  isSynced: true,
})

const b64 = (value: string) => Buffer.from(value, 'utf8').toString('base64')
const parseExtendedTag = (text: string) => {
  const line = text.split('\n').find(line => line.startsWith('[awlrc:'))
  if (!line) return null
  return line.slice('[awlrc:'.length, -1).split(',')
}

console.log('\n== buildLrcText 回归 ==')
const sourceLrc = '\r\n[00:01.00]line one here\r\n\r\n\r\n[00:02.00]line two here  \r\n'
check(
  '头部 + 合并空行 + 结尾换行',
  makeBody(sourceLrc),
  '[ti:打上花火]\n[ar:Daoko / 米津玄師]\n[al:THANK YOU BLUE]\n[00:01.00]line one here\n\n[00:02.00]line two here\n',
)
check(
  '空元数据不写头部',
  lrcText.buildLrcText({ name: 'Song', singer: '', albumName: '', lyric: '[00:01]line a', isSynced: true }),
  '[ti:Song]\n[00:01]line a\n',
)
check(
  '剔除源 [ti]/[ar]/[al]/[by] 行',
  lrcText.buildLrcText({
    name: 'Song',
    singer: 'Artist',
    albumName: '',
    lyric: '[ti:x]\n[ar:y]\n[al:z]\n[by:]\n[offset:0]\n[00:01.00]line one here',
    isSynced: true,
  }),
  '[ti:Song]\n[ar:Artist]\n[offset:0]\n[00:01.00]line one here\n',
)
const plainBody = makeBody('[00:01.00]line one here\n[00:02.00]line two here')
check('无扩展数据时 buildExtendedLrcText 输出逐字节不变', lrcText.buildExtendedLrcText(plainBody, {}), plainBody)
check('undefined 扩展数据同样不变', lrcText.buildExtendedLrcText(plainBody), plainBody)
check('buildAwlrcLrcText 之外不产生 [awlrc:] 标签', plainBody.includes('[awlrc:'), false)

console.log('\n== sanitizeExtendedLyric ==')
check(
  'CRLF/trim + 只留时间行 + 丢弃 //',
  lrcText.sanitizeExtendedLyric(
    '\r\n[ti:title]\r\n[ar:artist]\r\n[offset:0]\r\n[kana:abc]\r\n[language:ja]\r\n[00:01.00]译文一\r\n[00:02.000]译文二\r\n[00:03.00]//\r\n[00:04.00]   \r\nplain text\r\n',
  ),
  '[00:01.00]译文一\n[00:02.000]译文二',
)
check('空输入返回空串', lrcText.sanitizeExtendedLyric(''), '')
check('只有元信息/占位返回空串', lrcText.sanitizeExtendedLyric('[ti:x]\n[00:01.00]//\nnot timed'), '')
check('无时间轴纯文本丢弃', lrcText.sanitizeExtendedLyric('line one here'), '')

console.log('\n== buildExtendedLrcText 扩展段 ==')
const body = makeBody('[00:01.00]line one here\n[00:02.00]line two here')
const tlyric = '[ti:x]\n[00:01.00]译文一\n[00:02.00]//\n[00:03.00]译文三'
const rlyric = '[00:01.000]romaji one\n[00:02.00]romaji two'
const extended = lrcText.buildExtendedLrcText(body, { tlyric, rlyric })
const segments = parseExtendedTag(extended)
check('扩展段存在且标签独占一行', extended.includes('\n\n[awlrc:lrc:'), true)
check('扩展段段数与顺序（lrc → tlrc → rlrc）', segments?.map(segment => segment.split(':')[0]), ['lrc', 'tlrc', 'rlrc'])
check('lrc 段与正文完全一致', Buffer.from(segments![0].slice('lrc:'.length), 'base64').toString('utf8'), body.trim())
check(
  'tlrc 段经清洗后的翻译',
  Buffer.from(segments![1].slice('tlrc:'.length), 'base64').toString('utf8'),
  '[00:01.00]译文一\n[00:03.00]译文三',
)
check(
  'rlrc 段为罗马音',
  Buffer.from(segments![2].slice('rlrc:'.length), 'base64').toString('utf8'),
  rlyric,
)
check('文件以换行结尾', extended.endsWith(']\n'), true)
const translationOnly = parseExtendedTag(lrcText.buildExtendedLrcText(body, { tlyric }))
check('只有翻译时只写 lrc + tlrc', translationOnly?.map(segment => segment.split(':')[0]), ['lrc', 'tlrc'])
check('空翻译不写 tlrc 且输出不变', lrcText.buildExtendedLrcText(body, { tlyric: '[ti:x]\n[00:01.00]//' }), body)
check('空罗马音不写 rlrc 且输出不变', lrcText.buildExtendedLrcText(body, { rlyric: '[00:01.00]   ' }), body)

console.log('\n== buildAwlrcLrcText 兼容 ==')
const wordBody = makeBody('[00:01.00]line one here')
const lxlyric = '[offset:0]\n[00:01.000]<0,300>line<300,200> one'
const awlrcText = qrcLyric.buildAwlrcLrcText(wordBody, lxlyric)
const awlrcSegments = parseExtendedTag(awlrcText)
check('逐字段恰好 lrc + awlrc 两段', awlrcSegments?.length, 2)
check('lrc 段与正文一致', Buffer.from(awlrcSegments![0].slice('lrc:'.length), 'base64').toString('utf8'), wordBody.trim())
check('awlrc 段与 lxlyric 一致', Buffer.from(awlrcSegments![1].slice('awlrc:'.length), 'base64').toString('utf8'), lxlyric)
check(
  '与旧版拼装公式逐字节一致',
  awlrcText,
  `${wordBody.trim()}\n\n[awlrc:lrc:${b64(wordBody.trim())},awlrc:${b64(lxlyric)}]\n`,
)
check('buildAwlrcLrcText = buildExtendedLrcText(lxlyric)', awlrcText, lrcText.buildExtendedLrcText(wordBody, { lxlyric }))
check('空 lxlyric 仍保留旧输出（空 awlrc 段）', qrcLyric.buildAwlrcLrcText(wordBody, ''), `${wordBody.trim()}\n\n[awlrc:lrc:${b64(wordBody.trim())},awlrc:]\n`)
const fullExtended = parseExtendedTag(lrcText.buildExtendedLrcText(wordBody, { tlyric, rlyric, lxlyric }))
check(
  '翻译/罗马音/逐字共存顺序 lrc → tlrc → rlrc → awlrc',
  fullExtended?.map(segment => segment.split(':')[0]),
  ['lrc', 'tlrc', 'rlrc', 'awlrc'],
)

console.log('\n== getLyricPreviewEntries ==')
const previewMain = '[ti:x]\n[00:01.00]line one here\n[00:02.50]line two here\n[00:03.00]line three here'
const previewT = '[00:01.00]译文一\n[00:02.500]译文二'
const previewR = '[00:01.00]romaji one\n[00:03.00]romaji three'
check(
  '翻译插主行后、再插罗马音',
  lrcText.getLyricPreviewEntries(previewMain, previewT, previewR),
  [
    { text: '[00:01.00]line one here', type: 'main' },
    { text: '译文一', type: 'translation' },
    { text: 'romaji one', type: 'roma' },
    { text: '[00:02.50]line two here', type: 'main' },
    { text: '译文二', type: 'translation' },
    { text: '[00:03.00]line three here', type: 'main' },
    { text: 'romaji three', type: 'roma' },
  ],
)
check(
  '时间标签 .xx 与 .xxx 按毫秒归一',
  lrcText.getLyricPreviewEntries('[00:01.20]main line', '[00:01.200]translated', ''),
  [
    { text: '[00:01.20]main line', type: 'main' },
    { text: 'translated', type: 'translation' },
  ],
)
check(
  '无对应翻译不插行',
  lrcText.getLyricPreviewEntries('[00:01.00]line one here', '[00:09.00]other', '[00:08.00]other roma'),
  [{ text: '[00:01.00]line one here', type: 'main' }],
)
check(
  '翻译的元信息行/占位行被忽略',
  lrcText.getLyricPreviewEntries('[00:01.00]line one here', '[ti:x]\n[00:01.00]//\n[00:01.00]real', ''),
  [
    { text: '[00:01.00]line one here', type: 'main' },
    { text: 'real', type: 'translation' },
  ],
)
const manyMain = Array.from({ length: 40 }, (_, i) => `[00:${String(i).padStart(2, '0')}.00]line ${i}`).join('\n')
const manyTranslation = Array.from({ length: 40 }, (_, i) => `[00:${String(i).padStart(2, '0')}.00]trans ${i}`).join('\n')
const capped = lrcText.getLyricPreviewEntries(manyMain, manyTranslation, '', 30)
check('预览最多 30 行（含扩展行）', capped.length, 30)
check('上限截断在扩展行', capped[29], { text: 'trans 14', type: 'translation' })
check(
  '无时间轴主歌词不插翻译',
  lrcText.getLyricPreviewEntries('plain line one here', '[00:01.00]translated', ''),
  [{ text: 'plain line one here', type: 'main' }],
)

console.log('\n== netease provider（stub request） ==')
const SEARCH_URL = 'https://music.163.com/api/search/get/web'
const LYRIC_URL = 'https://music.163.com/api/song/lyric'
const responseOf = (body: unknown, statusCode = 200) => ({
  statusCode,
  raw: Buffer.from(JSON.stringify(body)),
  headers: {},
})
const setHandler = (handler: (url: string, options: any) => Promise<any>) => {
  requestState.state.requests = []
  requestState.state.handler = handler
}
const searchQuery = { variants: ['打上花火 DAOKO', '打上花火', '打上花火 米津玄師', 'third extra'] }
const candidate = (overrides: Record<string, unknown> = {}) => ({
  source: 'netease',
  id: '1',
  name: '打上花火',
  singer: 'DAOKO',
  albumName: '',
  durationSec: null,
  hasSynced: null,
  instrumental: false,
  score: 0,
  ...overrides,
})
const validLyric = '[00:01.00]line one here\n[00:02.50]line two here'

setHandler(async() => responseOf({
  code: 200,
  result: {
    songs: [
      {
        id: 186016,
        name: '打上花火 &amp; test',
        artists: [{ name: 'DAOKO' }, { name: '米津玄師' }],
        album: { name: 'THANK YOU BLUE' },
        duration: 289000,
      },
      {
        id: '186016',
        name: 'duplicate id',
        artists: [{ name: 'Dup' }],
        album: { name: 'Dup' },
        duration: 1,
      },
      { id: 2, name: '', artists: [], album: {}, duration: 1 },
      { id: 3, name: 'Song (Off Vocal)', artists: [], album: {}, duration: null },
    ],
  },
}))
const searched = await netease.search(searchQuery)
check('搜索映射已去重、丢弃空歌名', searched.length, 2)
check('网易云字段映射', searched[0], {
  source: 'netease',
  id: '186016',
  name: '打上花火 & test',
  singer: 'DAOKO / 米津玄師',
  albumName: 'THANK YOU BLUE',
  durationSec: 289,
  hasSynced: null,
  instrumental: false,
  score: 0,
})
check('无效时长返回 null + 纯音乐标记', {
  durationSec: searched[1].durationSec,
  instrumental: searched[1].instrumental,
  singer: searched[1].singer,
  albumName: searched[1].albumName,
}, { durationSec: null, instrumental: true, singer: '', albumName: '' })
const searchRequest = requestState.state.requests[0]
check('搜索 URL', searchRequest.url, SEARCH_URL)
check('搜索参数 limit/type/offset', {
  limit: searchRequest.options.query.limit,
  type: searchRequest.options.query.type,
  offset: searchRequest.options.query.offset,
  csrf_token: searchRequest.options.query.csrf_token,
  s: searchRequest.options.query.s,
}, { limit: '10', type: '1', offset: '0', csrf_token: '', s: '打上花火 DAOKO' })
check('请求头带 UA/Referer 且无 Cookie', {
  ua: typeof searchRequest.options.headers['User-Agent'],
  referer: searchRequest.options.headers.Referer,
  cookie: Object.keys(searchRequest.options.headers).some(key => /cookie/i.test(key)),
}, { ua: 'string', referer: 'https://music.163.com/', cookie: false })
check('关键词上限 2、命中首个即停止', requestState.state.requests.length, 1)

setHandler(async(_url, options) => {
  return options.query.s === searchQuery.variants[0]
    ? responseOf({ code: 200, result: { songs: [] } })
    : responseOf({ code: 200, result: { songs: [{ id: 9, name: '打上花火', artists: [], album: {}, duration: 1000 }] } })
})
const fallbackSearched = await netease.search(searchQuery)
check('首个关键词 0 条继续下一个', fallbackSearched.length, 1)
check('最多请求 2 个关键词', requestState.state.requests.length, 2)
check('第二个关键词内容', requestState.state.requests[1].options.query.s, searchQuery.variants[1])

setHandler(async() => responseOf({ code: 404 }))
await checkThrows('全部 code!=200 抛错（交给 allSettled 降级）', async() => await netease.search(searchQuery))
setHandler(async() => { throw new Error('network down') })
await checkThrows('全部请求异常抛错', async() => await netease.search(searchQuery))
setHandler(async(_url, options) => {
  if (options.query.s === searchQuery.variants[0]) throw new Error('network down')
  return responseOf({ code: 200, result: { songs: [] } })
})
check('部分失败但 0 条不抛错', await netease.search(searchQuery), [])

setHandler(async(_url, options) => {
  const lyrics: Record<string, unknown> = {
    1: {
      code: 200,
      lrc: { lyric: validLyric },
      tlyric: { lyric: '[ti:x]\n[00:01.00]译文一\n[00:02.50]//' },
      romalrc: { lyric: '[00:01.00]romaji one' },
    },
    2: {
      code: 200,
      lrc: { lyric: validLyric },
      tlyric: { lyric: '' },
      yromalrc: { lyric: '[00:01.00]yromaji' },
    },
    3: { code: 200, nolyric: true, lrc: { lyric: validLyric } },
    4: { code: 404 },
    5: { code: 200, lrc: { lyric: '' }, tlyric: { lyric: '[00:01.00]译文' } },
    6: { code: 200, lrc: { lyric: '未经许可,不得翻唱或使用' } },
    7: { code: 200, uncollected: true, lrc: { lyric: validLyric } },
  }
  return responseOf(lyrics[options.query.id] ?? { code: 404 })
})
const lyricResult = await netease.getLyric(candidate())
check('取词映射主歌词/翻译/罗马音', lyricResult, {
  lyric: validLyric,
  isSynced: true,
  tlyric: '[00:01.00]译文一',
  rlyric: '[00:01.00]romaji one',
})
const lyricRequest = requestState.state.requests[0]
check('取词 URL', lyricRequest.url, LYRIC_URL)
check('取词参数 lv/kv/tv/rv', {
  id: lyricRequest.options.query.id,
  lv: lyricRequest.options.query.lv,
  kv: lyricRequest.options.query.kv,
  tv: lyricRequest.options.query.tv,
  rv: lyricRequest.options.query.rv,
}, { id: '1', lv: '-1', kv: '-1', tv: '-1', rv: '-1' })
check('取词请求无 Cookie', Object.keys(lyricRequest.options.headers).some(key => /cookie/i.test(key)), false)
check('重复取词命中缓存不再请求', {
  lyric: (await netease.getLyric(candidate()))?.lyric,
  requests: requestState.state.requests.length,
}, { lyric: validLyric, requests: 1 })

const fallbackRoma = await netease.getLyric(candidate({ id: '2' }))
check('romalrc 为空回退 yromalrc', fallbackRoma?.rlyric, '[00:01.00]yromaji')
check('无翻译返回空串', fallbackRoma?.tlyric, '')
check('nolyric 返回 null', await netease.getLyric(candidate({ id: '3' })), null)
check('code!=200 返回 null', await netease.getLyric(candidate({ id: '4' })), null)
check('只有翻译无主歌词返回 null', await netease.getLyric(candidate({ id: '5' })), null)
check('占位主歌词返回 null', await netease.getLyric(candidate({ id: '6' })), null)
check('uncollected 返回 null', await netease.getLyric(candidate({ id: '7' })), null)
check('非 netease 候选返回 null', await netease.getLyric(candidate({ source: 'qq' })), null)
const logText = JSON.stringify(logState.state.logs)
check('日志不含歌词正文', logText.includes('line one here'), false)
check('日志不含请求 URL', logText.includes('music.163.com'), false)
check('日志含 source/cost/count/code 字段', logState.state.logs.some((args: unknown[]) => {
  const detail = args[1] as Record<string, unknown> | undefined
  return !!detail && detail.source === 'netease' && 'cost' in detail && 'count' in detail && 'code' in detail
}), true)

console.log('\n== 真实 parseLyric 回读 ==')
const readbackBody = makeBody(validLyric)
const readbackText = lrcText.buildExtendedLrcText(readbackBody, { tlyric, rlyric })
const readback = parseLyric(readbackText)
check('回读正文（扩展标签被剥离）', readback.lyric, readbackBody.trim())
check('回读 tlyric', readback.tlyric, '[00:01.00]译文一\n[00:03.00]译文三')
check('回读 rlyric', readback.rlyric, rlyric)
check('回读正文不含扩展标签', readback.lyric.includes('[awlrc:'), false)
const plainReadback = parseLyric(readbackBody)
check('无扩展段时回读只有正文', plainReadback, { lyric: readbackBody.trim() })
check('无扩展段不产生翻译/罗马音', {
  tlyric: plainReadback.tlyric,
  rlyric: plainReadback.rlyric,
  lxlyric: plainReadback.lxlyric,
}, { tlyric: undefined, rlyric: undefined, lxlyric: undefined })

console.log('\n== 默认值 / 迁移 ==')
check('默认 version', defaultSetting.version, '2.1.1')
check('默认打开翻译', defaultSetting['player.isShowLyricTranslation'], true)
check('罗马音保持关闭', defaultSetting['player.isShowLyricRoma'], false)
const migrated210 = migrateSetting({ version: '2.1.0', 'player.isShowLyricTranslation': false })
check('2.1.0 迁移后强制翻译 true', migrated210['player.isShowLyricTranslation'], true)
check('2.1.0 迁移后 version', migrated210.version, '2.1.1')
check('2.1.0 迁移不碰罗马音', migrated210['player.isShowLyricRoma'], undefined)
const migrated200 = migrateSetting({ version: '2.0.0', 'player.isShowLyricTranslation': false })
check('2.0.0 连续迁移后翻译 true', migrated200['player.isShowLyricTranslation'], true)
check('2.0.0 连续迁移后 version', migrated200.version, '2.1.1')
const migratedOld = migrateSetting({ version: '1.8.0', player: { isShowLyricTranslation: false, isShowLyricRoma: true } })
check('旧配置迁移后翻译 true', migratedOld['player.isShowLyricTranslation'], true)
check('旧配置迁移后 version', migratedOld.version, '2.1.1')
check('已迁移版本不覆盖用户 false', migrateSetting({ version: '2.1.1', 'player.isShowLyricTranslation': false })['player.isShowLyricTranslation'], false)

console.log(`\nresult: ${passed} passed, ${failed} failed`)
if (failed) process.exitCode = 1
