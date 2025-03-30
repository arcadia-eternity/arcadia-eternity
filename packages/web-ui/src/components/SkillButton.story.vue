<script setup lang="ts">
import SkillButton from './SkillButton.vue'
import { Element } from '@test-battle/const'
import { Category } from '@test-battle/const'
import { logEvent } from 'histoire/client'
</script>

<template>
  <Story title="SkillButton">
    <Variant title="Normal">
      <SkillButton
        :element="Element.Fire"
        :category="Category.Physical"
        :power="120"
        :rage="20"
        :accuracy="95"
        name="火焰冲击"
        description="造成火焰伤害"
        id="skill1"
        @click="logEvent('click', $event)"
      />
    </Variant>
    <Variant title="Disabled">
      <SkillButton
        :element="Element.Water"
        :category="Category.Status"
        :power="80"
        :rage="15"
        :accuracy="100"
        name="水疗术"
        description="恢复生命值"
        id="skill2"
        :disabled="true"
        @click="logEvent('click', $event)"
      />
    </Variant>
    <Variant title="Climax">
      <SkillButton
        :element="Element.Fire"
        :category="Category.Climax"
        :power="160"
        :rage="100"
        :accuracy="100"
        name="烈火焚天烧"
        description="造成火焰伤害"
        id="skill3"
        @click="logEvent('click', $event)"
      />
    </Variant>
  </Story>
</template>
<style>
html,
body,
#app {
  width: 100vw;
  height: 100vh;
}

.__histoire-render-story,
.__histoire-render-story > div,
.__histoire-render-story > div > div {
  width: 100%;
  height: 100%;
  display: flex;
  place-content: center;
  flex-wrap: wrap;
}
</style>
