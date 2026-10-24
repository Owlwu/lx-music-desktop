<template>
  <div :class="[$style.toolbar, { [$style.fullscreen]: isFullscreen }, appSetting['common.controlBtnPosition'] == 'left' ? $style.controlBtnLeft : $style.controlBtnRight]">
    <div :class="$style.title">{{ title }}</div>
    <ControlBtns v-if="appSetting['common.controlBtnPosition'] != 'left'" />
  </div>
</template>

<script setup>
import { computed } from '@common/utils/vueTools'
import { useRoute } from '@common/utils/vueRouter'
import { useI18n } from '@renderer/plugins/i18n'
import { isFullscreen } from '@renderer/store'
import { appSetting } from '@renderer/store/setting'
import ControlBtns from './ControlBtns.vue'

const t = useI18n()
const route = useRoute()

const title = computed(() => {
  switch (route.meta.name) {
    case 'List': return t('my_list')
    case 'Setting': return t('setting')
    default: return ''
  }
})
</script>


<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.toolbar {
  display: flex;
  height: @height-toolbar;
  align-items: center;
  justify-content: flex-end;
  padding-left: 15px;
  -webkit-app-region: drag;
  z-index: 2;

  &.fullscreen {
    -webkit-app-region: no-drag;
    .title {
      visibility: hidden;
    }
  }
}

.title {
  flex: 1 1 auto;
  min-width: 0;
  height: @height-toolbar;
  line-height: @height-toolbar;
  padding-left: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-font);
  opacity: .72;
  font-size: 14px;
}

</style>
