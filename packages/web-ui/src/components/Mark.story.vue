<script setup lang="ts">
import Mark from './Mark.vue'
</script>

<template>
  <Story title="Mark">
    <Variant title="默认状态">
      <Mark
        image="https://cdn.jsdelivr.net/gh/arcadia-star/seer2-resource@main/png-4x/markImage/1.png"
        :duration="3"
        name="中毒"
        description="每回合损失10%最大生命值"
      />
    </Variant>

    <Variant title="高堆叠层数">
      <Mark
        image="https://cdn.jsdelivr.net/gh/arcadia-star/seer2-resource@main/png-4x/markImage/1.png"
        :stack="5"
        :duration="2"
        name="灼烧"
        description="每回合受到固定伤害，可叠加5层"
      />
    </Variant>

    <Variant title="剩余1回合">
      <Mark
        image="https://cdn.jsdelivr.net/gh/arcadia-star/seer2-resource@main/png-4x/markImage/1.png"
        :duration="1"
        name="冰冻"
        description="无法行动，受到攻击时解除"
      />
    </Variant>

    <Variant title="长描述换行">
      <Mark
        image="https://cdn.jsdelivr.net/gh/arcadia-star/seer2-resource@main/png-4x/markImage/1.png"
        :duration="4"
        name="护盾"
        description="吸收所有伤害，持续2回合。护盾值等于施放者最大生命值的30%，不可叠加"
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
