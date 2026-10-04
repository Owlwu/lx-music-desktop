<template lang="pug">
dd#sync_music_file
  h3 {{ $t('setting__sync_music_file') }}
  div
    p.small {{ $t('setting__sync_music_file_root_label') }}
    p(:class="$style.path") {{ root || $t('setting__sync_music_file_root_empty') }}
    div
      base-btn.btn(min @click="handleSelectRoot") {{ $t('setting__sync_music_file_root_btn') }}
      base-btn.btn(min :disabled="!root" @click="handleOpenScope") {{ $t('setting__sync_music_file_scope_btn') }}
    p.small(:class="$style.scopeSummary") {{ scopeSummary }}
    p.small(v-if="remoteRoot" :class="$style.remoteRoot") {{ $t('setting__sync_music_file_remote_root', { path: remoteRoot }) }}
    p.small {{ $t('setting__sync_music_file_connect_tip') }}
    div(:class="$style.actions")
      base-btn.btn(min :disabled="!canOperate || busy || progress.running" @click="handleCompare") {{ $t('setting__sync_music_file_compare') }}
      base-btn.btn(min :disabled="!plan || progress.running" @click="handleApply") {{ $t('setting__sync_music_file_apply') }}
      base-btn.btn(v-if="progress.running" min @click="handleCancel") {{ $t('setting__sync_music_file_cancel') }}
    p.small(v-if="errorText" :class="$style.error") {{ errorText }}
    div(v-if="progress.running || progress.message" :class="$style.progress")
      p.small {{ progressText }}
      div(:class="$style.progressTrack")
        div(:class="$style.progressValue" :style="{ width: (progressPercent * 100).toFixed(1) + '%' }")
    template(v-if="plan")
      p.small(:class="$style.planSummary") {{ planSummary }}
      div(v-for="group in groupList" :key="group.key" :class="$style.group")
        div(:class="$style.groupHeader")
          base-checkbox(
            :id="'mf_group_' + group.key"
            :model-value="groupAllChecked(group.key)"
            :label="group.title + ' (' + group.items.length + ')'"
            @update:model-value="setGroupChecked(group.key, $event)"
          )
        ul.scroll(:class="$style.list")
          li(v-for="item in group.items" :key="item.path" :class="$style.item")
            base-checkbox(
              :id="'mf_' + group.key + '_' + item.path"
              :model-value="!!selection.checked[selectionKey(item)]"
              @update:model-value="setChecked(item, $event)"
            )
              span(:class="$style.itemText")
                span(:class="$style.itemPath") {{ item.path }}
                span(:class="$style.itemMeta") {{ itemMeta(item) }}
            template(v-if="group.key === 'conflict'")
              div(:class="$style.direction")
                button(
                  :class="[$style.dirBtn, { [$style.dirActive]: directionOf(item) === 'pull' }]"
                  @click="setDirection(item, 'pull')"
                ) {{ $t('setting__sync_music_file_use_remote') }}
                button(
                  :class="[$style.dirBtn, { [$style.dirActive]: directionOf(item) === 'push' }]"
                  @click="setDirection(item, 'push')"
                ) {{ $t('setting__sync_music_file_use_local') }}
    MusicFileScopeModal(v-model="isShowScope" :folders="folders" :scope="scope" @update:scope="handleScopeChange")
</template>

<script>
import { computed, reactive, ref, watch } from '@common/utils/vueTools'
import { appSetting, updateSetting } from '@renderer/store/setting'
import { sync } from '@renderer/store'
import {
  musicFileApply,
  musicFileCancel,
  musicFileCompare,
  musicFileGetFolders,
  showSelectDialog,
} from '@renderer/utils/ipc'
import { useI18n } from '@renderer/plugins/i18n'
import MusicFileScopeModal from './MusicFileScopeModal.vue'

const GROUP_KEYS = ['remoteAdded', 'localAdded', 'remoteDeleted', 'localDeleted', 'conflict']

const formatSize = (bytes) => {
  if (bytes == null) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export default {
  name: 'SettingSyncMusicFile',
  components: {
    MusicFileScopeModal,
  },
  setup() {
    const t = useI18n()

    const folders = ref([])
    const isShowScope = ref(false)
    const plan = ref(null)
    const remoteRoot = ref('')
    const busy = ref(false)
    const errorText = ref('')
    const selection = reactive({
      checked: {},
      direction: {},
    })

    const root = computed(() => appSetting['sync.musicFile.root'] ?? '')
    const scope = computed(() => appSetting['sync.musicFile.scope'] ?? [])
    const progress = computed(() => sync.musicFile.progress)
    const isConnected = computed(() => sync.mode === 'server' ? sync.server.status.status : sync.client.status.status)
    const canOperate = computed(() => !!root.value && isConnected.value)

    const scopeSummary = computed(() => {
      if (!root.value) return t('setting__sync_music_file_scope_summary_empty')
      return scope.value.length
        ? t('setting__sync_music_file_scope_summary_part', { count: scope.value.length })
        : t('setting__sync_music_file_scope_summary_all')
    })

    const selectionKey = (item) => `${item.group}:${item.path}`

    const groupList = computed(() => {
      if (!plan.value) return []
      return GROUP_KEYS
        .map(key => ({
          key,
          title: t(`setting__sync_music_file_group_${key}`),
          items: plan.value[key] ?? [],
        }))
        .filter(group => group.items.length)
    })

    const planSummary = computed(() => {
      if (!plan.value) return ''
      const total = GROUP_KEYS.reduce((sum, key) => sum + (plan.value[key]?.length ?? 0), 0)
      return total
        ? t('setting__sync_music_file_plan_summary', { count: total })
        : t('setting__sync_music_file_plan_empty')
    })

    const progressPercent = computed(() => {
      const { totalBytes, doneBytes } = progress.value
      if (!totalBytes) return progress.value.running ? 0 : 1
      return Math.min(1, doneBytes / totalBytes)
    })

    const progressText = computed(() => {
      const value = progress.value
      if (value.stage === 'transferring') {
        return t('setting__sync_music_file_progress_transfer', {
          current: value.actionIndex,
          total: value.actionTotal,
          path: value.path,
        })
      }
      if (value.stage === 'done') return t('setting__sync_music_file_progress_done')
      if (value.stage === 'error') return value.message || t('setting__sync_music_file_progress_error')
      return value.message
    })

    const itemMeta = (item) => {
      const parts = []
      if (item.localSize != null) parts.push(`${t('setting__sync_music_file_local')} ${formatSize(item.localSize)}`)
      if (item.remoteSize != null) parts.push(`${t('setting__sync_music_file_remote')} ${formatSize(item.remoteSize)}`)
      if (item.localHasLyric || item.remoteHasLyric) parts.push(t('setting__sync_music_file_has_lyric'))
      return parts.join(' · ')
    }

    const resetPlan = () => {
      plan.value = null
      remoteRoot.value = ''
      selection.checked = {}
      selection.direction = {}
    }

    const initSelection = (groups) => {
      const checked = {}
      const direction = {}
      for (const key of GROUP_KEYS) {
        for (const item of groups[key] ?? []) {
          const sk = selectionKey(item)
          checked[sk] = item.defaultChecked
          direction[sk] = item.defaultDirection
        }
      }
      selection.checked = checked
      selection.direction = direction
    }

    const setChecked = (item, value) => {
      selection.checked[selectionKey(item)] = value
    }
    const setDirection = (item, value) => {
      selection.direction[selectionKey(item)] = value
    }
    const directionOf = (item) => selection.direction[selectionKey(item)] ?? item.defaultDirection
    const groupAllChecked = (key) => {
      const items = plan.value?.[key] ?? []
      return items.length > 0 && items.every(item => selection.checked[selectionKey(item)])
    }
    const setGroupChecked = (key, value) => {
      for (const item of plan.value?.[key] ?? []) selection.checked[selectionKey(item)] = value
    }

    const handleSelectRoot = async() => {
      const { canceled, filePaths } = await showSelectDialog({
        title: t('setting__sync_music_file_root_btn'),
        properties: ['openDirectory'],
      })
      if (canceled || !filePaths.length) return
      resetPlan()
      folders.value = []
      // 换根目录后原来的相对范围不再适用
      updateSetting({ 'sync.musicFile.root': filePaths[0], 'sync.musicFile.scope': [] })
    }

    const loadFolders = async() => {
      busy.value = true
      errorText.value = ''
      try {
        folders.value = await musicFileGetFolders()
      } catch (err) {
        errorText.value = err?.message ?? String(err)
        folders.value = []
      } finally {
        busy.value = false
      }
    }

    const handleOpenScope = async() => {
      await loadFolders()
      isShowScope.value = true
    }

    const handleScopeChange = (value) => {
      resetPlan()
      updateSetting({ 'sync.musicFile.scope': value })
    }

    const handleCompare = async() => {
      busy.value = true
      errorText.value = ''
      resetPlan()
      try {
        const result = await musicFileCompare()
        plan.value = result.plan
        remoteRoot.value = result.remoteRoot
        initSelection(result.plan)
      } catch (err) {
        errorText.value = err?.message ?? String(err)
      } finally {
        busy.value = false
      }
    }

    const handleApply = async() => {
      errorText.value = ''
      const value = {
        checked: { ...selection.checked },
        direction: { ...selection.direction },
      }
      try {
        const result = await musicFileApply(value)
        if (result.errors.length) errorText.value = result.errors.join('\n')
        plan.value = null
      } catch (err) {
        errorText.value = err?.message ?? String(err)
      }
    }

    const handleCancel = async() => {
      await musicFileCancel()
    }

    watch(root, () => {
      resetPlan()
    })
    watch(scope, () => {
      resetPlan()
    })

    return {
      appSetting,
      root,
      scope,
      folders,
      isShowScope,
      plan,
      remoteRoot,
      busy,
      errorText,
      selection,
      progress,
      canOperate,
      scopeSummary,
      groupList,
      planSummary,
      progressPercent,
      progressText,
      selectionKey,
      itemMeta,
      directionOf,
      groupAllChecked,
      setGroupChecked,
      setChecked,
      setDirection,
      handleSelectRoot,
      handleOpenScope,
      handleScopeChange,
      handleCompare,
      handleApply,
      handleCancel,
    }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.path {
  font-size: 13px;
  color: var(--color-font);
  word-break: break-all;
  line-height: 1.3;
  margin-bottom: 6px;
}

.scopeSummary {
  margin-top: 4px;
}

.remoteRoot {
  word-break: break-all;
}

.actions {
  display: flex;
  flex-flow: row wrap;
  gap: 10px;
  margin-top: 10px;
}

.error {
  color: var(--color-error, #e74c3c);
  white-space: pre-wrap;
  word-break: break-all;
  margin-top: 8px;
}

.progress {
  margin-top: 10px;
}

.progressTrack {
  width: 100%;
  height: 5px;
  border-radius: 40px;
  overflow: hidden;
  margin-top: 5px;
  background-color: var(--color-primary-light-100-alpha-800);
}

.progressValue {
  height: 100%;
  background-color: var(--color-primary-light-100-alpha-400);
  transition: width 0.2s ease;
}

.planSummary {
  margin-top: 10px;
}

.group {
  margin-top: 10px;
}

.groupHeader {
  font-size: 13px;
}

.list {
  max-height: 220px;
  overflow: auto;
  border: 1px solid var(--color-border, rgba(128, 128, 128, 0.25));
  border-radius: @form-radius;
  margin-top: 5px;
  padding: 5px;
}

.item {
  display: flex;
  flex-flow: row nowrap;
  align-items: center;
  padding: 3px 0;
  font-size: 12px;
}

.itemText {
  display: flex;
  flex-flow: column nowrap;
}

.itemPath {
  word-break: break-all;
  line-height: 1.3;
}

.itemMeta {
  color: var(--color-font-label);
  font-size: 11px;
}

.direction {
  margin-left: auto;
  flex: none;
  display: flex;
  gap: 5px;
  padding-left: 10px;
}

.dirBtn {
  border: 1px solid var(--color-border, rgba(128, 128, 128, 0.35));
  background: transparent;
  color: var(--color-font);
  font-size: 11px;
  border-radius: @form-radius;
  padding: 2px 6px;
  cursor: pointer;
  outline: none;
  opacity: 0.6;
}

.dirActive {
  opacity: 1;
  border-color: var(--color-primary);
  color: var(--color-primary);
}
</style>
