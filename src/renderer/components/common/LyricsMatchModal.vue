<template lang="pug">
material-modal(:show="show" max-width="78%" min-width="560px" @close="handleClose" @after-enter="focusInput")
  main(:class="$style.main")
    h2(:class="$style.title") {{ $t('lyrics_match__title') }}
    div(:class="$style.searchBar")
      base-input(ref="input" v-model="keyword" :class="$style.input" :placeholder="$t('lyrics_match__search_placeholder')" :disabled="loading" @submit="handleSearch")
      base-btn(:class="$style.searchBtn" :disabled="loading" @click="handleSearch") {{ $t('lyrics_match__search_btn') }}
    div(:class="$style.body")
      div(:class="$style.candidatePanel")
        div(v-if="loading" :class="$style.empty") {{ $t('lyrics_match__loading') }}
        div(v-else-if="errorText" :class="$style.empty")
          p {{ errorText }}
          base-btn(:class="$style.retryBtn" min @click="handleSearch") {{ $t('lyrics_match__retry') }}
        div(v-else-if="!candidates.length" :class="$style.empty") {{ $t('lyrics_match__empty') }}
        div(v-else :class="['scroll', $style.candidateList]")
          div(
            v-for="(item, index) in candidates" :key="item.source + '-' + item.id"
            :class="[$style.candidate, { [$style.active]: selectedIndex == index }, { [$style.candidateDisabled]: item.instrumental }]"
            @click="handleSelect(index)"
          )
            div(:class="$style.candidateHead")
              span(:class="$style.candidateName") {{ item.name }}
              span(:class="$style.sourceTag") {{ $t('lyrics_match__source_' + item.source) }}
              span(v-if="wordSyncTag(item)" :class="[$style.tag, $style.tagWordSync]") {{ wordSyncTag(item) }}
              span(v-if="item.instrumental" :class="[$style.tag, $style.tagWarn]") {{ $t('lyrics_match__instrumental_suspect') }}
              span(v-else-if="item.hasSynced === false" :class="$style.tag") {{ $t('lyrics_match__plain') }}
              span(v-else-if="item.hasSynced === null" :class="$style.tag") {{ $t('lyrics_match__sync_unknown') }}
            div(:class="$style.candidateMeta")
              span {{ item.singer || '--' }}
              span {{ item.albumName || '--' }}
              span {{ formatDuration(item.durationSec) }}
            div(:class="$style.candidateScore") {{ Math.round(item.score * 100) + '%' }}
      div(:class="$style.previewPanel")
        div(:class="$style.previewTitle") {{ $t('lyrics_match__preview') }}
        div(v-if="previewLoading" :class="$style.empty") {{ $t('lyrics_match__loading_lyric') }}
        div(v-else-if="previewError" :class="$style.empty") {{ previewError }}
        div(v-else-if="!previewLines.length" :class="$style.empty") {{ $t('lyrics_match__preview_empty') }}
        div(v-else :class="['scroll', $style.previewContent]")
          p(v-for="(line, index) in previewLines" :key="index" :class="$style.previewLine") {{ line || ' ' }}
    div(v-if="noticeText" :class="$style.notice") {{ noticeText }}
    div(:class="$style.footer")
      div(:class="$style.tip") {{ tipText }}
      div(:class="$style.buttons")
        base-btn(:class="$style.btn" @click="handleClose") {{ $t('btn_cancel') }}
        base-btn(:class="$style.btn" :disabled="!canApply || applying" @click="handleApply") {{ applying ? $t('lyrics_match__applying') : $t('lyrics_match__apply') }}
</template>

<script>
import { dialog } from '@renderer/plugins/Dialog'
import { mediaMatchApplyLrc, mediaMatchGetLyric, mediaMatchGetWordSync, mediaMatchSearch } from '@renderer/utils/ipc'
import { getMediaMatchErrorCode, getMediaMatchErrorKey } from '@renderer/utils/mediaMatch'
import { hasInstrumentalMark } from '@common/utils/mediaMatch/normalize'

const maxPreviewLines = 30

export default {
  props: {
    show: {
      type: Boolean,
      default: false,
    },
    musicInfo: {
      type: Object,
      default: null,
    },
  },
  emits: ['update:show', 'applied'],
  data() {
    return {
      keyword: '',
      candidates: [],
      loading: false,
      errorText: '',
      selectedIndex: -1,
      preview: {
        lyric: '',
        isSynced: false,
      },
      previewLoading: false,
      previewError: '',
      noticeText: '',
      applying: false,
      requestId: 0,
      previewRequestId: 0,
      // 当前预览候选的逐字数据（QQ QRC）；null = 无逐字/未探测
      wordSync: null,
      // 候选行状态：`source:id` -> 'checking' | 'available' | 'line_only'
      wordSyncStatus: {},
    }
  },
  computed: {
    previewLines() {
      if (!this.preview.lyric) return []
      const lines = this.preview.lyric.replace(/\r\n?/g, '\n').split('\n')
      const result = []
      for (const rawLine of lines) {
        // 预览不展示源歌词自带的元信息行/词级标签
        let line = rawLine.replace(/<[\d:.,]+>/g, '').trimEnd()
        if (/^\s*\[(?:ti|ar|al|by):[^\]]*]\s*$/i.test(line)) continue
        if (!line) {
          if (result.length && result[result.length - 1] !== '') result.push('')
          continue
        }
        result.push(line)
        if (result.length >= maxPreviewLines) break
      }
      return result
    },
    canApply() {
      return !!this.getSelectedCandidate() && !!this.preview.lyric && !this.previewLoading
    },
    queryInstrumental() {
      if (!this.musicInfo) return false
      const fileName = (this.musicInfo.meta?.filePath ?? '').replace(/^.*[\\/]/, '')
      return hasInstrumentalMark(this.musicInfo.name) || hasInstrumentalMark(fileName)
    },
    tipText() {
      const candidate = this.getSelectedCandidate()
      if (!candidate) return ''
      if (this.queryInstrumental) return window.i18n.t('lyrics_match__instrumental_query_tip')
      if (candidate.instrumental) return window.i18n.t('lyrics_match__instrumental_tip')
      if (this.wordSync) return window.i18n.t('lyrics_match__word_sync_tip')
      if (candidate.hasSynced === false || !this.preview.isSynced) return window.i18n.t('lyrics_match__plain_tip')
      return window.i18n.t('lyrics_match__synced_tip')
    },
  },
  watch: {
    show(val) {
      if (!val) {
        this.requestId++
        return
      }
      this.keyword = this.buildDefaultKeyword()
      this.candidates = []
      this.errorText = ''
      this.selectedIndex = -1
      this.preview = { lyric: '', isSynced: false }
      this.previewLoading = false
      this.previewError = ''
      this.noticeText = ''
      this.applying = false
      this.previewRequestId++
      this.wordSync = null
      this.wordSyncStatus = {}
      void this.handleSearch()
    },
  },
  methods: {
    buildDefaultKeyword() {
      if (!this.musicInfo) return ''
      return [this.musicInfo.name, this.musicInfo.singer].filter(Boolean).join(' ')
    },
    focusInput() {
      this.$refs.input?.focus()
    },
    getSelectedCandidate() {
      return this.candidates[this.selectedIndex] ?? null
    },
    /**
     * IPC 参数必须是可 structured clone 的普通对象：
     * data 里的候选是 Vue 响应式 Proxy，直接传会抛 "An object could not be cloned."。
     */
    toPlainCandidate(candidate) {
      if (!candidate) return candidate
      return {
        source: candidate.source,
        id: candidate.id,
        name: candidate.name,
        singer: candidate.singer,
        albumName: candidate.albumName,
        durationSec: candidate.durationSec,
        hasSynced: candidate.hasSynced,
        instrumental: candidate.instrumental,
        score: candidate.score,
        // QRC 逐字需要数字 songid；缺少时主进程会直接返回 null
        trackId: candidate.trackId,
        hasWordSync: candidate.hasWordSync,
      }
    },
    toPlainMusicInfo() {
      const info = this.musicInfo
      if (!info) return info
      return {
        id: info.id,
        name: info.name,
        singer: info.singer,
        source: info.source,
        interval: info.interval,
        meta: { ...info.meta },
      }
    },
    formatDuration(durationSec) {
      if (durationSec == null) return '--:--'
      const total = Math.round(durationSec)
      const m = Math.floor(total / 60)
      const s = total % 60
      return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    },
    handleClose() {
      this.requestId++
      this.$emit('update:show', false)
    },
    async handleSearch() {
      if (!this.musicInfo?.meta?.filePath) {
        this.errorText = window.i18n.t('lyrics_match__err_no_file')
        return
      }
      const requestId = ++this.requestId
      this.loading = true
      this.errorText = ''
      this.selectedIndex = -1
      this.preview = { lyric: '', isSynced: false }
      this.previewLoading = false
      this.previewError = ''
      this.noticeText = ''
      this.previewRequestId++
      this.wordSync = null
      this.wordSyncStatus = {}

      const keyword = this.keyword.trim()
      const defaultKeyword = this.buildDefaultKeyword()
      try {
        const result = await mediaMatchSearch({
          musicInfo: this.toPlainMusicInfo(),
          keyword: keyword && keyword != defaultKeyword ? keyword : undefined,
        })
        if (requestId != this.requestId) return
        this.candidates = result.candidates
        if (this.candidates.length) void this.handleSelect(0)
      } catch (err) {
        if (requestId != this.requestId) return
        console.log(err)
        this.candidates = []
        this.errorText = window.i18n.t(getMediaMatchErrorKey(getMediaMatchErrorCode(err)))
      } finally {
        if (requestId == this.requestId) this.loading = false
      }
    },
    async fetchCandidateLyric(index) {
      const candidate = this.candidates[index]
      if (!candidate) return null
      try {
        // 注意：IPC 走 structured clone，Vue 响应式 Proxy 无法被克隆，
        // 必须传普通对象，否则会抛 "An object could not be cloned." 导致预览一直为空。
        return await mediaMatchGetLyric({ candidate: this.toPlainCandidate(candidate) })
      } catch (err) {
        console.log(err)
        return null
      }
    },
    /**
     * 候选行上的逐字状态标签：LRCLIB 恒为仅行级；QQ 按探测结果展示
     */
    wordSyncTag(item) {
      if (!item) return ''
      if (item.source !== 'qq') return window.i18n.t('lyrics_match__word_sync_line_only')
      const status = this.wordSyncStatus[item.source + ':' + item.id]
      if (status === 'checking') return window.i18n.t('lyrics_match__word_sync_checking')
      if (status === 'available') return window.i18n.t('lyrics_match__word_sync_available')
      if (status === 'line_only') return window.i18n.t('lyrics_match__word_sync_line_only')
      return ''
    },
    /**
     * 选中候选后并行探测 QQ QRC；失败静默返回 null（降级行级），状态只写候选行标签
     */
    async fetchCandidateWordSync(index) {
      const candidate = this.candidates[index]
      if (!candidate || candidate.source !== 'qq') return null
      const key = candidate.source + ':' + candidate.id
      // 状态按候选 id 记录，探测结果即使已过期也只影响该行的标签，不影响当前预览
      const setStatus = status => {
        this.wordSyncStatus = { ...this.wordSyncStatus, [key]: status }
      }
      if (!candidate.trackId) {
        setStatus('line_only')
        return null
      }
      setStatus('checking')
      try {
        const result = await mediaMatchGetWordSync({ candidate: this.toPlainCandidate(candidate) })
        if (!result?.lxlyric) {
          setStatus('line_only')
          return null
        }
        setStatus('available')
        return result
      } catch (err) {
        console.log(err)
        setStatus('line_only')
        return null
      }
    },
    async handleSelect(index) {
      const candidate = this.candidates[index]
      if (!candidate) return
      this.selectedIndex = index
      this.preview = { lyric: '', isSynced: false }
      this.previewError = ''
      this.noticeText = ''
      this.wordSync = null
      this.previewLoading = true
      const token = ++this.previewRequestId
      let targetIndex = index
      // 行级与逐字并行请求；逐字结果只在预览落定时使用，保证「预览 = 应用后正文」
      let wordSyncPromise = this.fetchCandidateWordSync(index)
      try {
        let result = await this.fetchCandidateLyric(index)
        if (token != this.previewRequestId) return

        // QQ 的行级接口失败但 QRC 可能可用：先等并行中的逐字结果，避免误换候选
        if (!result) {
          const earlyWordSync = await wordSyncPromise
          if (token != this.previewRequestId) return
          if (earlyWordSync) {
            this.selectedIndex = index
            this.wordSync = earlyWordSync
            this.preview = { lyric: earlyWordSync.lyric, isSynced: true }
            return
          }
        }

        // 当前候选可能无歌词（QQ -1901 / 纯音乐 / 占位文本）：
        // 沿排序再试最多 4 个候选（跨源），避免自动选中第一条时预览一直为空。
        if (!result) {
          const maxIndex = Math.min(index + 4, this.candidates.length - 1)
          for (let nextIndex = index + 1; nextIndex <= maxIndex; nextIndex++) {
            if (token != this.previewRequestId) return
            const nextCandidate = this.candidates[nextIndex]
            // 只自动切换到可信度足够高的候选，避免把低分错配歌词当成结果展示
            if (!nextCandidate || nextCandidate.instrumental || nextCandidate.score < 0.6) continue
            result = await this.fetchCandidateLyric(nextIndex)
            if (result) {
              targetIndex = nextIndex
              wordSyncPromise = this.fetchCandidateWordSync(nextIndex)
              this.noticeText = window.i18n.t('lyrics_match__qq_next_candidate', { name: nextCandidate.name })
              break
            }
          }
        }

        if (token != this.previewRequestId) return
        const wordSync = await wordSyncPromise
        if (token != this.previewRequestId) return
        if (wordSync) {
          // 有逐字时预览用逐字结果的正文（与主进程 apply_lrc 写入的正文一致）
          this.selectedIndex = targetIndex
          this.wordSync = wordSync
          this.preview = { lyric: wordSync.lyric, isSynced: true }
        } else if (result) {
          this.selectedIndex = targetIndex
          this.preview = result
        } else {
          this.previewError = window.i18n.t('lyrics_match__not_found')
        }
      } finally {
        if (token == this.previewRequestId) this.previewLoading = false
      }
    },
    async handleApply() {
      const candidate = this.getSelectedCandidate()
      if (!candidate || !this.canApply || this.applying) return
      if (this.queryInstrumental) {
        const confirm = await dialog.confirm({
          message: window.i18n.t('lyrics_match__instrumental_query_confirm'),
          confirmButtonText: window.i18n.t('btn_confirm'),
          cancelButtonText: window.i18n.t('btn_cancel'),
        })
        if (!confirm) return
      }
      if (!this.preview.isSynced) {
        const confirm = await dialog.confirm({
          message: window.i18n.t('lyrics_match__plain_confirm'),
          confirmButtonText: window.i18n.t('btn_confirm'),
          cancelButtonText: window.i18n.t('btn_cancel'),
        })
        if (!confirm) return
      }
      this.applying = true
      try {
        const result = await mediaMatchApplyLrc({
          musicInfo: this.toPlainMusicInfo(),
          candidate: this.toPlainCandidate(candidate),
        })
        this.$emit('applied', result)
        this.handleClose()
      } catch (err) {
        console.log(err)
        const message = window.i18n.t(getMediaMatchErrorKey(getMediaMatchErrorCode(err)))
        this.errorText = message
        await dialog({ message })
      } finally {
        this.applying = false
      }
    },
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.main {
  display: flex;
  flex-flow: column nowrap;
  min-height: 0;
  max-height: 70vh;
  padding: 0 15px 15px;
  width: 100%;
  box-sizing: border-box;
}

.title {
  font-size: 15px;
  color: var(--color-font);
  padding: 12px 0 10px;
  margin: 0;
}

.searchBar {
  display: flex;
  flex-flow: row nowrap;
  align-items: center;
  flex: none;
  padding-bottom: 10px;
}

.input {
  flex: auto;
  margin-right: 10px;
}

.searchBtn {
  flex: none;
}

.body {
  flex: auto;
  display: flex;
  flex-flow: row nowrap;
  min-height: 0;
  gap: 12px;
}

.candidatePanel,
.previewPanel {
  flex: 1 1 50%;
  min-width: 0;
  display: flex;
  flex-flow: column nowrap;
  border: 1px solid var(--color-primary-light-300-alpha-700);
  border-radius: 4px;
  overflow: hidden;
}

.candidateList,
.previewContent {
  flex: auto;
  min-height: 200px;
  max-height: 46vh;
  overflow-y: auto;
}

.candidate {
  padding: 8px 10px;
  border-bottom: 1px solid var(--color-primary-light-300-alpha-600);
  cursor: pointer;
  position: relative;
  transition: background-color 0.15s ease;
  &:hover {
    background-color: var(--color-primary-background-hover);
  }
  &.active {
    background-color: var(--color-primary-background-active);
  }
  &.candidateDisabled {
    opacity: 0.7;
  }
}

.candidateHead {
  display: flex;
  flex-flow: row nowrap;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.candidateName {
  font-size: 13px;
  color: var(--color-font);
  .mixin-ellipsis-1();
  flex: 0 1 auto;
}

.sourceTag {
  flex: none;
  font-size: 11px;
  color: var(--color-primary);
  border: 1px solid var(--color-primary-alpha-500);
  border-radius: 3px;
  padding: 0 4px;
  line-height: 16px;
}

.tag {
  flex: none;
  font-size: 11px;
  color: var(--color-font-label);
  border: 1px solid var(--color-primary-light-300-alpha-700);
  border-radius: 3px;
  padding: 0 4px;
  line-height: 16px;
}

.tagWarn {
  color: var(--color-primary-dark-200);
}

.tagWordSync {
  color: var(--color-primary);
  border-color: var(--color-primary-alpha-500);
}

.candidateMeta {
  display: flex;
  flex-flow: row nowrap;
  gap: 10px;
  margin-top: 4px;
  font-size: 12px;
  color: var(--color-font-label);
  span {
    .mixin-ellipsis-1();
  }
}

.candidateScore {
  position: absolute;
  right: 10px;
  top: 8px;
  font-size: 11px;
  color: var(--color-primary);
  opacity: 0.8;
}

.previewTitle {
  flex: none;
  font-size: 12px;
  color: var(--color-font-label);
  padding: 8px 10px;
  border-bottom: 1px solid var(--color-primary-light-300-alpha-600);
}

.previewLine {
  font-size: 12px;
  color: var(--color-font);
  line-height: 1.6;
  padding: 0 10px;
  word-break: break-word;
  min-height: 1.2em;
}

.empty {
  flex: auto;
  display: flex;
  flex-flow: column nowrap;
  align-items: center;
  justify-content: center;
  min-height: 120px;
  padding: 15px;
  font-size: 12px;
  color: var(--color-font-label);
  text-align: center;
  p {
    margin-bottom: 10px;
  }
}

.retryBtn {
  margin-top: 10px;
}

.footer {
  flex: none;
  display: flex;
  flex-flow: row nowrap;
  align-items: center;
  justify-content: space-between;
  padding-top: 12px;
  gap: 10px;
}

.tip {
  flex: auto;
  font-size: 12px;
  color: var(--color-font-label);
  .mixin-ellipsis-1();
}

.notice {
  flex: none;
  font-size: 12px;
  color: var(--color-primary);
  padding-top: 8px;
  .mixin-ellipsis-1();
}

.buttons {
  flex: none;
  display: flex;
  flex-flow: row nowrap;
  gap: 10px;
}

.btn {
  min-width: 76px;
}
</style>
