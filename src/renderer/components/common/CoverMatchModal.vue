<template lang="pug">
material-modal(:show="show" max-width="78%" min-width="620px" @close="handleClose" @after-enter="focusInput")
  main(:class="$style.main")
    h2(:class="$style.title") {{ $t('cover_match__title') }}
    div(:class="$style.searchBar")
      base-input(ref="input" v-model="keyword" :class="$style.input" :placeholder="$t('cover_match__search_placeholder')" :disabled="loading" @submit="handleSearch")
      base-btn(:class="$style.searchBtn" :disabled="loading" @click="handleSearch") {{ $t('cover_match__search_btn') }}
    div(:class="$style.body")
      div(:class="$style.candidatePanel")
        div(v-if="loading" :class="$style.empty") {{ $t('cover_match__loading') }}
        div(v-else-if="errorText" :class="$style.empty")
          p {{ errorText }}
          base-btn(:class="$style.retryBtn" min @click="handleSearch") {{ $t('cover_match__retry') }}
        div(v-else-if="!candidates.length" :class="$style.empty") {{ $t('cover_match__empty') }}
        div(v-else :class="['scroll', $style.candidateList]")
          div(
            v-for="(item, index) in candidates" :key="item.source + '-' + item.id"
            :class="[$style.candidate, { [$style.active]: selectedIndex == index }]"
            @click="handleSelect(index)"
          )
            img(:class="$style.candidateThumb" :src="item.thumbnailUrl" loading="lazy" referrerpolicy="no-referrer")
            div(:class="$style.candidateInfo")
              div(:class="$style.candidateHead")
                span(:class="$style.candidateName") {{ item.name }}
                span(:class="$style.sourceTag") {{ $t('cover_match__source_' + item.source) }}
                span(:class="$style.candidateScore") {{ Math.round(item.score * 100) + '%' }}
              div(:class="$style.candidateMeta")
                span(:class="$style.metaText") {{ item.singer || '--' }}
                span(:class="$style.metaText") {{ item.albumName || '--' }}
                span(:class="$style.metaDuration") {{ formatDuration(item.durationSec) }}
      div(:class="$style.previewPanel")
        div(:class="$style.previewTitle") {{ $t('cover_match__preview') }}
        div(:class="[$style.previewBody, { [$style.previewBodyEmpty]: !selectedCandidate }]")
          img(
            v-if="selectedCandidate"
            :key="selectedCandidate.coverUrl"
            :class="$style.previewImage"
            :src="selectedCandidate.coverUrl"
            referrerpolicy="no-referrer"
            @error="previewBroken = true"
            @load="previewBroken = false"
          )
          div(v-if="selectedCandidate && previewBroken" :class="$style.previewError") {{ $t('cover_match__err_download_failed') }}
          div(v-else-if="!selectedCandidate" :class="$style.previewEmpty") {{ $t('cover_match__preview_empty') }}
    div(:class="$style.footer")
      div(:class="$style.tip")
      div(:class="$style.buttons")
        base-btn(v-if="coverState.backupExists" :class="$style.btn" :disabled="applying || rollingBack" @click="handleRollback") {{ rollingBack ? $t('cover_match__rolling_back') : $t('cover_match__rollback') }}
        base-btn(:class="$style.btn" @click="handleClose") {{ $t('btn_cancel') }}
        base-btn(:class="$style.btn" :disabled="!canApply || applying || rollingBack" @click="handleApply") {{ applying ? $t('cover_match__applying') : $t('cover_match__apply') }}
</template>

<script>
import { dialog } from '@renderer/plugins/Dialog'
import { coverMatchApply, coverMatchGetState, coverMatchRollback, coverMatchSearch } from '@renderer/utils/ipc'
import { getCoverMatchErrorCode, getCoverMatchErrorKey } from '@renderer/utils/coverMatch'

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
  emits: ['update:show', 'applied', 'restored'],
  data() {
    return {
      keyword: '',
      candidates: [],
      loading: false,
      errorText: '',
      selectedIndex: -1,
      previewBroken: false,
      applying: false,
      rollingBack: false,
      coverState: {
        imageExists: false,
        backupExists: false,
      },
      requestId: 0,
      stateRequestId: 0,
    }
  },
  computed: {
    selectedCandidate() {
      return this.candidates[this.selectedIndex] ?? null
    },
    canApply() {
      return !!this.selectedCandidate
    },
  },
  watch: {
    show(val) {
      if (!val) {
        this.requestId++
        this.stateRequestId++
        return
      }
      this.keyword = this.buildDefaultKeyword()
      this.candidates = []
      this.errorText = ''
      this.selectedIndex = -1
      this.previewBroken = false
      this.applying = false
      this.rollingBack = false
      this.coverState = { imageExists: false, backupExists: false }
      void this.refreshState()
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
    formatDuration(durationSec) {
      if (durationSec == null) return '--:--'
      const total = Math.round(durationSec)
      const m = Math.floor(total / 60)
      const s = total % 60
      return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
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
        coverUrl: candidate.coverUrl,
        thumbnailUrl: candidate.thumbnailUrl,
        score: candidate.score,
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
    async refreshState() {
      const filePath = this.musicInfo?.meta?.filePath
      if (!filePath) return
      const token = ++this.stateRequestId
      try {
        const state = await coverMatchGetState(filePath)
        if (token != this.stateRequestId) return
        this.coverState = state
      } catch (err) {
        if (token != this.stateRequestId) return
        console.log(err)
      }
    },
    handleClose() {
      this.requestId++
      this.$emit('update:show', false)
    },
    handleSelect(index) {
      if (index == this.selectedIndex) return
      this.selectedIndex = index
      this.previewBroken = false
    },
    async handleSearch() {
      if (!this.musicInfo?.meta?.filePath) {
        this.errorText = window.i18n.t('cover_match__err_invalid_music')
        return
      }
      const requestId = ++this.requestId
      this.loading = true
      this.errorText = ''
      this.selectedIndex = -1
      this.previewBroken = false

      const keyword = this.keyword.trim()
      const defaultKeyword = this.buildDefaultKeyword()
      try {
        const result = await coverMatchSearch({
          musicInfo: this.toPlainMusicInfo(),
          keyword: keyword && keyword != defaultKeyword ? keyword : undefined,
        })
        if (requestId != this.requestId) return
        this.candidates = result.candidates
        if (this.candidates.length) this.handleSelect(0)
      } catch (err) {
        if (requestId != this.requestId) return
        console.log(err)
        this.candidates = []
        this.errorText = window.i18n.t(getCoverMatchErrorKey(getCoverMatchErrorCode(err)))
      } finally {
        if (requestId == this.requestId) this.loading = false
      }
    },
    async handleApply() {
      const candidate = this.selectedCandidate
      if (!candidate || !this.canApply || this.applying || this.rollingBack) return
      if (this.coverState.imageExists) {
        const confirm = await dialog.confirm({
          message: window.i18n.t('cover_match__replace_confirm'),
          confirmButtonText: window.i18n.t('btn_confirm'),
          cancelButtonText: window.i18n.t('btn_cancel'),
        })
        if (!confirm) return
      }
      this.applying = true
      try {
        const result = await coverMatchApply({
          musicInfo: this.toPlainMusicInfo(),
          candidate: this.toPlainCandidate(candidate),
        })
        this.$emit('applied', result)
        this.handleClose()
      } catch (err) {
        console.log(err)
        const message = window.i18n.t(getCoverMatchErrorKey(getCoverMatchErrorCode(err)))
        this.errorText = message
        await dialog({ message })
      } finally {
        this.applying = false
      }
    },
    async handleRollback() {
      if (!this.coverState.backupExists || this.applying || this.rollingBack) return
      const confirm = await dialog.confirm({
        message: window.i18n.t('cover_match__rollback_confirm'),
        confirmButtonText: window.i18n.t('btn_confirm'),
        cancelButtonText: window.i18n.t('btn_cancel'),
      })
      if (!confirm) return
      this.rollingBack = true
      try {
        const result = await coverMatchRollback(this.musicInfo.meta.filePath)
        if (result.restored) {
          this.$emit('restored')
          this.handleClose()
        } else {
          await dialog({ message: window.i18n.t('cover_match__rollback_none') })
          await this.refreshState()
        }
      } catch (err) {
        console.log(err)
        const message = window.i18n.t(getCoverMatchErrorKey(getCoverMatchErrorCode(err)))
        await dialog({ message })
      } finally {
        this.rollingBack = false
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

.candidatePanel {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-flow: column nowrap;
  border: 1px solid var(--color-primary-light-300-alpha-700);
  border-radius: 4px;
  overflow: hidden;
}

.previewPanel {
  flex: none;
  width: 300px;
  display: flex;
  flex-flow: column nowrap;
  border: 1px solid var(--color-primary-light-300-alpha-700);
  border-radius: 4px;
  overflow: hidden;
}

.candidateList {
  flex: auto;
  min-height: 200px;
  max-height: 46vh;
  overflow-y: auto;
}

.candidate {
  display: flex;
  flex-flow: row nowrap;
  align-items: center;
  gap: 10px;
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
}

.candidateThumb {
  flex: none;
  width: 72px;
  height: 72px;
  border-radius: 4px;
  object-fit: cover;
  background-color: var(--color-primary-light-300-alpha-600);
}

.candidateInfo {
  flex: auto;
  min-width: 0;
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

.candidateScore {
  flex: none;
  margin-left: auto;
  font-size: 11px;
  color: var(--color-primary);
  opacity: 0.8;
}

.candidateMeta {
  display: flex;
  flex-flow: row nowrap;
  gap: 8px;
  margin-top: 6px;
  font-size: 12px;
  color: var(--color-font-label);
  min-width: 0;
}

.metaText {
  .mixin-ellipsis-1();
  flex: 1 1 50%;
}

.metaDuration {
  flex: none;
}

.previewTitle {
  flex: none;
  font-size: 12px;
  color: var(--color-font-label);
  padding: 8px 10px;
  border-bottom: 1px solid var(--color-primary-light-300-alpha-600);
}

.previewBody {
  flex: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  background-color: var(--color-primary-light-300-alpha-600);
}

.previewBodyEmpty {
  background-color: transparent;
  border: none;
}

.previewImage {
  width: 300px;
  height: 300px;
  object-fit: cover;
  display: block;
}

.previewError {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--color-font-label);
  text-align: center;
  padding: 15px;
  box-sizing: border-box;
}

.previewEmpty {
  font-size: 12px;
  color: var(--color-font-label);
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
