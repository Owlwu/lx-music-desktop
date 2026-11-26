import { COVER_MATCH_EVENT_NAME } from '@common/ipcNames'
import { mainHandle } from '@common/mainIpc'
import { log } from '@common/utils'
import { checkPath } from '@common/utils/nodejs'
import { createQuery, downloadCoverImage, searchCandidates, CoverMatchError } from './matcher'
import { applyCoverImage, CoverFileError, getCoverState, deleteCover } from './coverFile'
import { buildQqCoverUrl } from './providers/qq'

const SEARCH_TIMEOUT = 15000
const coverMatchErrorPrefix = 'COVER_MATCH_ERR:'

const coverMatchError = (code: string): Error => new Error(coverMatchErrorPrefix + code)

const toIpcError = (err: unknown): Error => {
  if (err instanceof Error && err.message.startsWith(coverMatchErrorPrefix)) return err
  if (err instanceof CoverFileError) {
    switch (err.code) {
      case 'invalid_file': return coverMatchError('invalid_music')
      case 'image_invalid': return coverMatchError('image_invalid')
      case 'image_too_large': return coverMatchError('image_too_large')
      case 'no_permission': return coverMatchError('no_permission')
      case 'disk_full': return coverMatchError('disk_full')
      default: return coverMatchError('unknown')
    }
  }
  if (err instanceof CoverMatchError) return coverMatchError(err.code)
  return coverMatchError('unknown')
}

const assertMusicInfo = async(musicInfo: LX.Music.MusicInfo | null | undefined): Promise<LX.Music.MusicInfo> => {
  if (!musicInfo || musicInfo.source !== 'local' || !musicInfo.meta?.filePath) {
    throw coverMatchError('invalid_music')
  }
  if (!await checkPath(musicInfo.meta.filePath)) {
    throw coverMatchError('file_not_found')
  }
  return musicInfo
}

const assertFileExist = async(filePath: string): Promise<void> => {
  if (!filePath || !await checkPath(filePath)) throw coverMatchError('file_not_found')
}

const qqAlbummidRxp = /^[0-9A-Za-z]+$/
const qqCoverUrlRxp = /^https:\/\/y\.qq\.com\/music\/photo_new\/T002R(?:150|500)x(?:150|500)M000[0-9A-Za-z]+\.(?:jpg|png)$/i
const itunesCoverUrlRxp = /^https:\/\/(?:[a-z0-9-]+\.)+mzstatic\.com\/image\/thumb\/[^\s]+$/i

/**
 * 候选校验：只允许两源的合法 URL；QQ 直接用 albummid 重建 URL，避免渲染层传入任意地址
 */
const assertCandidate = (
  candidate: LX.CoverMatch.CoverCandidate | null | undefined,
): LX.CoverMatch.CoverCandidate => {
  if (!candidate?.id || (candidate.source !== 'qq' && candidate.source !== 'itunes')) {
    throw coverMatchError('invalid_candidate')
  }
  if (candidate.source === 'qq') {
    if (!qqAlbummidRxp.test(candidate.id) || !qqCoverUrlRxp.test(candidate.coverUrl)) {
      throw coverMatchError('invalid_candidate')
    }
    return { ...candidate, coverUrl: buildQqCoverUrl(candidate.id, 500) }
  }
  if (!itunesCoverUrlRxp.test(candidate.coverUrl)) throw coverMatchError('invalid_candidate')
  return candidate
}

export default () => {
  mainHandle<LX.CoverMatch.SearchParams, LX.CoverMatch.SearchResult>(COVER_MATCH_EVENT_NAME.search, async({ params }) => {
    const musicInfo = await assertMusicInfo(params?.musicInfo)
    const query = createQuery(musicInfo, params?.keyword)
    log.debug('[coverMatch] search start', {
      name: query.name,
      singer: query.singer,
      album: query.albumName,
      variants: query.variants.length,
    })

    const controller = new AbortController()
    const timer = setTimeout(() => {
      controller.abort()
    }, SEARCH_TIMEOUT)
    try {
      const candidates = await searchCandidates(query, controller.signal)
      return { candidates }
    } finally {
      clearTimeout(timer)
    }
  })

  mainHandle<LX.CoverMatch.ApplyParams, LX.CoverMatch.ApplyResult>(COVER_MATCH_EVENT_NAME.apply, async({ params }) => {
    const musicInfo = await assertMusicInfo(params?.musicInfo)
    const candidate = assertCandidate(params?.candidate)
    try {
      // 10s 下载超时在 downloadCoverImage 内；下载内容再做 magic/尺寸/写盘校验
      const data = await downloadCoverImage(candidate.coverUrl)
      return await applyCoverImage(musicInfo.meta.filePath, data)
    } catch (err) {
      throw toIpcError(err)
    }
  })

  mainHandle<LX.CoverMatch.FilePathParams, LX.CoverMatch.CoverState>(COVER_MATCH_EVENT_NAME.get_state, async({ params }) => {
    const filePath = params?.filePath
    if (!filePath || !await checkPath(filePath)) return { imageExists: false }
    return getCoverState(filePath)
  })

  mainHandle<LX.CoverMatch.FilePathParams, LX.CoverMatch.DeleteResult>(COVER_MATCH_EVENT_NAME.delete_cover, async({ params }) => {
    const filePath = params?.filePath
    await assertFileExist(filePath)
    try {
      return { deleted: await deleteCover(filePath) }
    } catch (err) {
      throw toIpcError(err)
    }
  })
}
