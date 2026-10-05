<template lang="pug">
material-modal(:show="modelValue" bg-close teleport="#view" @close="$emit('update:modelValue', false)")
  main(:class="$style.main")
    h2 {{ $t('setting__sync_music_file_scope_title') }}
    p(:class="$style.tip") {{ $t('setting__sync_music_file_scope_tip') }}
    div(:class="$style.filter")
      base-input(
        :model-value="filterText"
        :class="$style.filterInput"
        :placeholder="$t('setting__sync_music_file_scope_filter_placeholder')"
        @update:model-value="filterText = $event"
      )
      base-btn(v-if="filterText" min @click="handleClearFilter") {{ $t('setting__sync_music_file_scope_filter_clear') }}
    div.scroll(v-if="flatFolders.length" :class="$style.content")
      div(
        v-for="folder in flatFolders" :key="folder.path"
        :class="$style.item"
        :style="{ paddingLeft: (10 + folder.depth * 18) + 'px' }"
      )
        base-checkbox(
          :id="'mf_scope_' + folder.path"
          :model-value="isChecked(folder.path)"
          :disabled="isImplied(folder.path)"
          :label="folderLabel(folder)"
          @update:model-value="handleToggle(folder, $event)"
        )
    div(v-else-if="isFiltering" :class="$style.empty") {{ $t('setting__sync_music_file_scope_filter_empty', { text: filterText }) }}
    div(v-else :class="$style.empty") {{ $t('setting__sync_music_file_scope_empty') }}
    div(:class="$style.footer")
      base-btn.btn(min @click="handleClear") {{ $t('setting__sync_music_file_scope_clear') }}
      base-btn.btn(min @click="$emit('update:modelValue', false)") {{ $t('setting__sync_music_file_scope_done') }}
</template>

<script>
import { computed, ref } from '@common/utils/vueTools'

export default {
  name: 'MusicFileScopeModal',
  props: {
    modelValue: {
      type: Boolean,
      default: false,
    },
    folders: {
      type: Array,
      default: () => [],
    },
    scope: {
      type: Array,
      default: () => [],
    },
  },
  emits: ['update:modelValue', 'update:scope'],
  setup(props, { emit }) {
    const filterText = ref('')

    // 展开成扁平列表，保留层级缩进
    const allFolders = computed(() => {
      const list = []
      const walk = (nodes, depth) => {
        for (const node of nodes) {
          list.push({ ...node, depth })
          walk(node.children ?? [], depth + 1)
        }
      }
      walk(props.folders, 0)
      return list
    })

    const isFiltering = computed(() => filterText.value.trim().length > 0)

    // 按文件夹名筛选：命中的条目保留原有缩进（路径就是完整相对路径，层级信息不丢）
    const flatFolders = computed(() => {
      const keyword = filterText.value.trim().toLowerCase()
      if (!keyword) return allFolders.value
      return allFolders.value.filter(folder => folder.name.toLowerCase().includes(keyword))
    })

    /** 列表已按关键字过滤，这里只需拼上音频数量 */
    const folderLabel = (folder) => `${folder.name} (${folder.totalCount})`

    // 已被祖先文件夹覆盖的条目由祖先代表，界面上显示为选中且不可单独取消
    const isImplied = (path) => props.scope.some(parent => parent !== path && (path === parent || path.startsWith(parent + '/')))
    const isChecked = (path) => isImplied(path) || props.scope.includes(path)

    const handleToggle = (folder, checked) => {
      if (isImplied(folder.path)) return
      const scope = [...props.scope]
      const index = scope.indexOf(folder.path)
      if (checked && index === -1) scope.push(folder.path)
      else if (!checked && index > -1) scope.splice(index, 1)
      emit('update:scope', scope)
    }

    const handleClear = () => {
      emit('update:scope', [])
    }

    const handleClearFilter = () => {
      filterText.value = ''
    }

    return {
      filterText,
      isFiltering,
      flatFolders,
      folderLabel,
      isImplied,
      isChecked,
      handleToggle,
      handleClear,
      handleClearFilter,
    }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.main {
  min-width: 460px;
  max-width: 620px;
  display: flex;
  flex-flow: column nowrap;
  max-height: 70vh;
  h2 {
    margin: 15px;
    font-size: 16px;
    color: var(--color-font);
    line-height: 1.3;
    text-align: center;
  }
}

.tip {
  margin: 0 15px 10px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--color-font-label);
}

.filter {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 15px 10px;
}

.filterInput {
  flex: auto;
  min-width: 0;
}

.content {
  flex: auto;
  min-height: 120px;
  overflow: auto;
}

.item {
  padding-top: 6px;
  padding-bottom: 6px;
  font-size: 13px;
}

.empty {
  padding: 20px;
  text-align: center;
  color: var(--color-font-label);
  font-size: 13px;
}

.footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 15px;
}
</style>
