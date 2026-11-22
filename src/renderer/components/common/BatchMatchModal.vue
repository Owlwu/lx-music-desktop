<template lang="pug">
material-modal(
  :show="show" width="520px" height="320px" max-width="90%" min-width="380px"
  :bg-close="false" :close-btn="false" @close="handleClose"
)
  main(:class="$style.main")
    h2(:class="$style.title") {{ $t('batch_match__title') }}
    div(:class="$style.phase") {{ phaseText }}
    div(:class="$style.progressBar")
      div(:class="$style.progressInner" :style="{ width: progressPercent + '%' }")
    div(:class="$style.current") {{ currentText }}
    div(:class="$style.stats")
      span(:class="$style.stat") {{ $t('batch_match__count_lyric', { lyric: progress.lyric }) }}
      span(:class="$style.stat") {{ $t('batch_match__count_cover', { cover: progress.cover }) }}
      span(:class="[$style.stat, $style.statFailed]") {{ $t('batch_match__count_failed', { failed: progress.failed }) }}
      span(:class="$style.stat") {{ $t('batch_match__count_skipped', { skipped: progress.skipped }) }}
    div(v-if="isDone" :class="$style.summary") {{ summaryText }}
    div(:class="$style.footer")
      base-btn(v-if="!isDone" :class="$style.btn" :disabled="canceling" @click="handleCancel")
        | {{ canceling ? $t('batch_match__canceling') : $t('batch_match__cancel') }}
      base-btn(v-else :class="$style.btn" @click="handleClose") {{ $t('btn_confirm') }}
</template>

<script>
export default {
  props: {
    show: {
      type: Boolean,
      default: false,
    },
    progress: {
      type: Object,
      default: () => ({
        phase: 'idle',
        current: 0,
        total: 0,
        name: '',
        lyric: 0,
        cover: 0,
        failed: 0,
        skipped: 0,
        processed: 0,
        canceled: false,
        none: false,
      }),
    },
  },
  emits: ['update:show', 'cancel'],
  data() {
    return {
      canceling: false,
    }
  },
  computed: {
    isDone() {
      return this.progress.phase === 'done'
    },
    phaseText() {
      switch (this.progress.phase) {
        case 'scanning':
          return this.$t('batch_match__scanning')
        case 'matching':
          return this.$t('batch_match__matching')
        default:
          return ''
      }
    },
    currentText() {
      const data = {
        current: this.progress.current,
        total: this.progress.total,
        name: this.progress.name || '--',
      }
      if (this.progress.phase === 'scanning') return this.$t('batch_match__scan_current', data)
      if (this.progress.phase === 'matching') return this.$t('batch_match__match_current', data)
      return ''
    },
    progressPercent() {
      if (!this.progress.total) return 0
      const percent = Math.round(this.progress.current / this.progress.total * 100)
      return Math.max(0, Math.min(100, percent))
    },
    summaryText() {
      if (this.progress.canceled) return this.$t('batch_match__canceled', { done: this.progress.processed ?? 0 })
      if (this.progress.none) return this.$t('batch_match__none')
      return this.$t('batch_match__summary', {
        lyric: this.progress.lyric,
        cover: this.progress.cover,
        failed: this.progress.failed,
        skipped: this.progress.skipped,
      })
    },
  },
  watch: {
    show(val) {
      if (val) this.canceling = false
    },
    'progress.phase'(val) {
      if (val === 'done') this.canceling = false
    },
  },
  methods: {
    handleCancel() {
      if (this.canceling) return
      this.canceling = true
      this.$emit('cancel')
    },
    handleClose() {
      if (!this.isDone) return
      this.$emit('update:show', false)
    },
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.main {
  display: flex;
  flex-flow: column nowrap;
  flex: 1 1 auto;
  min-height: 0;
  padding: 0 15px 15px;
  box-sizing: border-box;
  width: 100%;
}

.title {
  flex: none;
  font-size: 15px;
  color: var(--color-font);
  padding: 12px 0 10px;
  margin: 0;
}

.phase {
  flex: none;
  font-size: 13px;
  color: var(--color-font);
  padding-bottom: 8px;
}

.progressBar {
  flex: none;
  height: 6px;
  border-radius: 3px;
  overflow: hidden;
  background-color: var(--color-primary-light-300-alpha-700);
}

.progressInner {
  height: 100%;
  border-radius: 3px;
  background-color: var(--color-primary);
  transition: width 0.2s ease;
}

.current {
  flex: none;
  font-size: 12px;
  color: var(--color-font-label);
  padding-top: 8px;
  .mixin-ellipsis-1();
}

.stats {
  flex: none;
  display: flex;
  flex-flow: row wrap;
  align-items: center;
  gap: 6px 14px;
  padding-top: 10px;
  font-size: 12px;
  color: var(--color-font-label);
}

.stat {
  flex: none;
}

.statFailed {
  color: var(--color-primary-dark-200);
}

.summary {
  flex: none;
  margin-top: 12px;
  padding: 10px;
  border-radius: 4px;
  background-color: var(--color-primary-background-hover);
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-font);
}

.footer {
  flex: auto;
  display: flex;
  flex-flow: row nowrap;
  align-items: flex-end;
  justify-content: flex-end;
}

.btn {
  min-width: 76px;
}
</style>
