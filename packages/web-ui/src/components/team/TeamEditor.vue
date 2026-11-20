<template>
  <el-card v-if="!isInitialized" shadow="never" aria-busy="true" class="m-4">
    <template #header><h1 class="font-medium">队伍编辑器</h1></template>
    <el-skeleton animated :rows="3" aria-label="正在加载队伍" />
  </el-card>

  <!-- 主要内容 -->
  <div v-else ref="editorRoot" class="team-editor" :class="{ 'min-h-screen': !compact }">
    <!-- 头部信息栏 -->
    <header v-if="!compact" class="editor-header" :inert="environmentBusy">
      <div class="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3 min-w-0">
          <h1 class="text-xl font-semibold shrink-0">队伍编辑器</h1>
          <el-tag class="truncate">{{
            delegate.storageRoute ? currentTeamName : delegate.subtitle?.value || currentTeamName
          }}</el-tag>
        </div>
        <div class="flex items-center">
          <el-button v-if="delegate.clear" type="danger" plain :icon="Delete" @click="clearAllData">
            {{ delegate.clearLabel || '清空队伍' }}
          </el-button>
          <el-button
            v-if="delegate.storageRoute"
            :tag="RouterLink"
            :to="delegate.storageRoute"
            type="primary"
            :icon="Box"
            >仓库管理</el-button
          >
        </div>
      </div>
    </header>

    <div
      v-if="!compact || !teamValidationResult.isValid || teamValidationResult.warnings.length"
      class="max-w-7xl mx-auto px-2 sm:px-4 lg:px-6 pt-3"
    >
      <el-alert v-if="isValidating" type="info" title="正在验证队伍" show-icon :closable="false" />
      <el-alert
        v-else-if="teamValidationResult.isValid"
        type="success"
        title="队伍验证通过"
        show-icon
        :closable="false"
      >
        <ul v-if="teamValidationResult.warnings.length">
          <li v-for="warning in teamValidationResult.warnings" :key="warning.code">{{ warning.message }}</li>
        </ul>
      </el-alert>
      <el-alert v-else type="error" show-icon :closable="false">
        <template #title>
          队伍未通过基本检查
          <el-button
            v-if="teamValidationResult.errors.length > 1"
            size="small"
            link
            type="danger"
            :aria-expanded="showValidationDetails"
            @click="showValidationDetails = !showValidationDetails"
          >
            {{ showValidationDetails ? '收起' : '详情' }}（{{ teamValidationResult.errors.length }}）
          </el-button>
        </template>
        <ul v-if="teamValidationResult.errors.length === 1 || showValidationDetails" class="space-y-1">
          <li v-for="(error, index) in teamValidationResult.errors" :key="error.code + index">
            <el-button link type="danger" class="validation-issue" @click="handleErrorClick(error)">
              {{ error.message }}
              <span v-if="error.objectId" class="ml-2"
                >相关精灵 {{ getPetNameById(error.objectId) || error.objectId }}</span
              >
              <span v-if="error.context" class="ml-2">{{ formatErrorContext(error.context) }}</span>
            </el-button>
          </li>
        </ul>
      </el-alert>
    </div>

    <!-- 主要内容区域 -->
    <main class="max-w-7xl mx-auto px-2 sm:px-4 lg:px-6 py-3 pb-36 md:pb-24">
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <!-- 队伍列表 - 移动端全宽，桌面端占3列 -->
        <div class="lg:col-span-3">
          <el-card shadow="never">
            <template #header>
              <div class="section-header">
                <h2 class="font-medium">当前队伍</h2>
                <el-text size="small">{{ currentTeam.length }}/{{ teamCapacity }} 只精灵</el-text>
                <el-button text circle :icon="InfoFilled" aria-label="队伍操作帮助" @click="showHelp = true" />
              </div>
              <slot name="environment" />
              <el-alert
                v-if="currentTeam.length > 1 && showDragTip"
                class="mt-2"
                type="info"
                title="拖拽调整出战顺序，第一只为首发精灵"
                @close="hideDragTip"
              />
              <el-switch
                v-if="currentTeam.length > 1"
                v-model="sortLocked"
                size="small"
                active-text="锁定顺序"
                aria-label="锁定顺序"
              />
            </template>
            <div class="space-y-2" :inert="environmentBusy">
              <Sortable
                :list="currentTeam"
                item-key="id"
                :options="{
                  animation: 150,
                  handle: '.drag-handle',
                  disabled: sortLocked || currentTeam.length <= 1,
                  group: 'pets',
                  ghostClass: 'sortable-ghost',
                  chosenClass: 'sortable-chosen',
                  dragClass: 'sortable-drag',
                }"
                @start="onStart"
                @end="handleDragEnd"
                class="space-y-3"
                :class="{ 'touch-panning-y': sortLocked }"
              >
                <template #item="{ element: pet }">
                  <div
                    :key="pet.id"
                    class="team-member drag-handle"
                    tabindex="0"
                    @keydown.enter.self.prevent="selectedPetId = pet.id"
                    @keydown.space.self.prevent="selectedPetId = pet.id"
                    :class="{ 'is-selected': selectedPetId === pet.id }"
                    @click="selectedPetId = pet.id"
                  >
                    <div class="flex items-center space-x-2">
                      <div class="flex-shrink-0">
                        <PetIcon
                          :uncached="!!gameDataStore.serverFallback"
                          :id="gameDataStore.getSpecies(pet.species)?.num"
                          :species="gameDataStore.getSpecies(pet.species)"
                          :is-unknown="!gameDataStore.getSpecies(pet.species)"
                          class="w-10 h-10"
                        />
                      </div>
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center space-x-1">
                          <ElementIcon
                            v-if="gameDataStore.getSpecies(pet.species)?.element"
                            :element="gameDataStore.getSpecies(pet.species)?.element"
                            class="w-3 h-3 flex-shrink-0"
                          />
                          <p class="text-xs font-medium text-(--el-text-color-primary) truncate">{{ pet.name }}</p>
                        </div>
                        <p class="text-xs text-(--el-text-color-secondary) truncate">
                          {{
                            gameDataStore.getSpecies(pet.species)
                              ? contentName(pet.species, 'species')
                              : `缺失精灵：${pet.species}`
                          }}
                        </p>
                        <div class="flex items-center space-x-1 mt-0.5">
                          <el-tag size="small" type="info">Lv.{{ pet.level }}</el-tag>
                          <el-tag v-if="!compact" size="small" effect="plain">#{{ pet.id.slice(-4) }}</el-tag>
                        </div>
                      </div>
                      <el-button
                        text
                        circle
                        size="small"
                        :icon="Top"
                        aria-label="设置为首发"
                        title="设置为首发"
                        @click.stop="setAsStarter(pet.id)"
                      />
                      <el-button
                        text
                        circle
                        size="small"
                        type="danger"
                        :icon="Delete"
                        :aria-label="delegate.removeLabel || '移出队伍'"
                        :title="delegate.removeLabel || '移出队伍'"
                        @click.stop="handleDeletePet(pet.id)"
                      />
                    </div>
                  </div>
                </template>
              </Sortable>

              <el-button class="w-full" :icon="Plus" :disabled="currentTeam.length >= teamCapacity" @click="addNewPet"
                >添加精灵</el-button
              >
            </div>
          </el-card>
        </div>

        <!-- 配置区域 - 移动端全宽，桌面端占9列 -->
        <div class="lg:col-span-9" :inert="environmentBusy" v-if="selectedPet">
          <div class="space-y-3">
            <el-alert
              v-if="selectedMissingContent.length"
              title="当前对局缺少内容"
              type="warning"
              show-icon
              :closable="false"
              data-testid="missing-team-content"
            >
              <p>此队伍暂时无法出战，仍可保存和导出原始配置。</p>
              <ul class="text-sm mt-2 space-y-2">
                <li v-for="item in selectedMissingContent" :key="`${item.kind}-${item.skillIndex ?? item.contentId}`">
                  {{ item.message }}
                  <el-button
                    link
                    type="primary"
                    v-if="item.kind === 'skill'"
                    class="ml-2"
                    :data-team-field="'skills.' + item.skillIndex"
                    :aria-label="`移除缺失技能 ${item.contentId}`"
                    @click="removeMissingSkill(item.skillIndex!)"
                  >
                    移除此技能
                  </el-button>
                </li>
              </ul>
            </el-alert>
            <el-card shadow="never">
              <template #header>
                <div class="section-header">
                  <div class="flex items-center flex-wrap gap-2">
                    <h3 class="font-medium">基础信息</h3>
                    <el-text v-if="delegate.storageRoute" size="small" type="info" :title="selectedPet.id">
                      #{{ selectedPet.id.slice(-8) }}
                    </el-text>
                  </div>
                  <div>
                    <el-button size="small" :icon="StarFilled" @click="setAsStarter(selectedPet.id)"
                      >设置首发</el-button
                    >
                    <el-button
                      size="small"
                      type="danger"
                      plain
                      :icon="Delete"
                      @click="handleDeletePet(selectedPet.id)"
                      >{{ delegate.removeLabel || '移出队伍' }}</el-button
                    >
                  </div>
                </div>
              </template>
              <el-form label-position="top" @submit.prevent>
                <!-- 第一行：精灵名称和种族 -->
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <el-form-item label="精灵名称">
                    <el-input v-model="selectedPet.name" aria-label="精灵名称" type="text" placeholder="输入精灵名称" />
                  </el-form-item>
                  <el-form-item label="种族">
                    <el-select-v2
                      :model-value="selectedPet.species"
                      data-team-field="species"
                      :options="speciesOptions"
                      @update:model-value="previewSpeciesChange"
                      placeholder="选择种族"
                      filterable
                      class="w-full"
                      style="width: 100%"
                    >
                      <template #default="{ item }">
                        <div class="flex items-center space-x-2">
                          <PetIcon
                            :uncached="!!gameDataStore.serverFallback"
                            :id="item.num"
                            :species="item"
                            class="w-6 h-6 flex-shrink-0"
                          />
                          <div class="flex-1 min-w-0">
                            <div
                              class="flex items-center space-x-1 text-xs font-medium text-(--el-text-color-primary) truncate"
                            >
                              <ElementIcon v-if="item.element" :element="item.element" class="w-3 h-3 flex-shrink-0" />
                              <span class="truncate">{{ item.label }}</span>
                            </div>
                            <div class="flex items-center space-x-1 text-xs text-(--el-text-color-secondary) truncate">
                              <span>#{{ item.num }}</span>
                              <span>{{ item.element || '未知' }}</span>
                            </div>
                          </div>
                        </div>
                      </template>
                    </el-select-v2>
                    <el-button v-if="canUndoSpecies" link type="primary" @click="restoreSpecies"
                      >撤销更换种族</el-button
                    >
                  </el-form-item>
                </div>

                <!-- 第二行：基础属性 -->
                <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <el-form-item label="等级">
                    <el-input-number
                      controls-position="right"
                      style="width: 100%"
                      aria-label="等级"
                      :model-value="selectedPet.level"
                      @update:model-value="
                        value => {
                          if (selectedPet && value != null) selectedPet.level = value
                        }
                      "
                      :min="1"
                      :max="100"
                    />
                  </el-form-item>
                  <el-form-item label="性别">
                    <el-select-v2
                      v-model="selectedPet.gender"
                      :options="genderOptions"
                      :disabled="!currentSpecies?.genderRatio"
                      placeholder="选择性别"
                      class="w-full"
                      style="width: 100%"
                    >
                      <template #default="{ item }">
                        <div class="flex items-center space-x-1">
                          <span class="text-sm">{{ item.icon }}</span>
                          <span class="text-xs font-medium">{{ item.label }}</span>
                        </div>
                      </template>
                    </el-select-v2>
                  </el-form-item>
                  <el-form-item label="身高">
                    <el-input-number
                      controls-position="right"
                      style="width: 100%"
                      aria-label="身高"
                      :model-value="selectedPet.height"
                      @update:model-value="
                        value => {
                          if (selectedPet && value != null) selectedPet.height = value
                        }
                      "
                      :min="currentSpecies?.heightRange[0]"
                      :max="currentSpecies?.heightRange[1]"
                    />
                  </el-form-item>
                  <el-form-item label="体重">
                    <el-input-number
                      controls-position="right"
                      style="width: 100%"
                      aria-label="体重"
                      :model-value="selectedPet.weight"
                      @update:model-value="
                        value => {
                          if (selectedPet && value != null) selectedPet.weight = value
                        }
                      "
                      :min="currentSpecies?.weightRange[0]"
                      :max="currentSpecies?.weightRange[1]"
                    />
                  </el-form-item>
                </div>
              </el-form>
            </el-card>

            <el-card shadow="never">
              <template #header><h3 class="font-medium">技能配置</h3></template>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <!-- 特性选择 -->
                <div>
                  <label class="block text-xs font-medium text-(--el-text-color-regular) mb-1">特性</label>
                  <el-select-v2
                    v-model="selectedPet.ability"
                    data-team-field="ability"
                    :options="abilitySelectOptions"
                    :disabled="!currentSpecies"
                    placeholder="选择特性"
                    clearable
                    class="w-full"
                    style="width: 100%"
                    :height="300"
                    :item-height="80"
                  >
                    <template #default="{ item }">
                      <div class="flex flex-col space-y-1 p-3 min-w-0">
                        <div class="text-sm font-medium text-(--el-text-color-primary) truncate">{{ item.label }}</div>
                        <div
                          class="text-xs text-(--el-text-color-secondary) leading-relaxed break-words whitespace-normal"
                        >
                          {{ item.description }}
                        </div>
                      </div>
                    </template>
                  </el-select-v2>
                </div>

                <!-- 纹章选择 -->
                <div>
                  <label class="block text-xs font-medium text-(--el-text-color-regular) mb-1">纹章</label>
                  <el-select-v2
                    v-model="selectedPet.emblem"
                    data-team-field="emblem"
                    :options="emblemSelectOptions"
                    placeholder="选择纹章"
                    clearable
                    class="w-full"
                    style="width: 100%"
                    :height="300"
                    :item-height="80"
                  >
                    <template #default="{ item }">
                      <div class="flex flex-col space-y-1 p-3 min-w-0">
                        <div class="text-sm font-medium text-(--el-text-color-primary) truncate">{{ item.label }}</div>
                        <div
                          class="text-xs text-(--el-text-color-secondary) leading-relaxed break-words whitespace-normal"
                        >
                          {{ item.description }}
                        </div>
                      </div>
                    </template>
                  </el-select-v2>
                </div>
              </div>
              <div
                v-if="selectedPet.inheritedSkill && !selectedPet.skills.includes(selectedPet.inheritedSkill)"
                class="mb-3"
              >
                <el-tag
                  closable
                  type="info"
                  data-team-field="inheritedSkill"
                  @close="delete selectedPet.inheritedSkill"
                >
                  未装备的遗传技能 · {{ contentName(selectedPet.inheritedSkill, 'skill') }}
                </el-tag>
              </div>
              <section v-for="group in skillGroups" :key="group.name" class="mt-4">
                <h4 class="text-sm font-medium text-(--el-text-color-primary) mb-2">{{ group.name }}</h4>
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <div v-for="(slot, index) in group.slots" :key="index">
                    <div class="mb-1 flex items-center gap-2 text-xs text-(--el-text-color-regular)">
                      <span>{{ group.name }} {{ index + 1 }}</span>
                      <el-tag v-if="slot && slot === selectedPet.inheritedSkill" size="small">遗传</el-tag>
                      <el-tag v-if="index >= group.max" size="small" type="danger">超出槽位</el-tag>
                      <span v-else-if="index < group.min">必选</span>
                    </div>
                    <el-select-v2
                      :model-value="slot"
                      :aria-label="group.name + ' ' + (index + 1)"
                      :data-testid="(group.climax ? 'climax' : 'normal') + '-skill-' + index"
                      :data-team-field="slot === selectedPet.inheritedSkill ? 'inheritedSkill' : undefined"
                      :options="skillOptions(group.climax, slot)"
                      :disabled="!slot && !group.available"
                      :placeholder="'选择' + group.name"
                      filterable
                      clearable
                      class="w-full"
                      :height="320"
                      :item-height="90"
                      @update:model-value="value => changeSkill(group.climax, index, value)"
                    >
                      <template #default="{ item }">
                        <div class="flex flex-col gap-1 py-2 leading-normal">
                          <div class="flex items-center gap-2">
                            <ElementIcon :element="item.element" class="w-4 h-4" />
                            <strong>{{ item.label }}</strong>
                            <el-tag v-if="item.inherited" size="small" effect="plain">遗传</el-tag>
                            <span v-if="item.reason" class="text-xs">{{ item.reason }}</span>
                          </div>
                          <span class="text-xs"
                            >{{ item.category }} · 威力 {{ item.power }} · 怒气 {{ item.rage }} · 命中
                            {{ item.accuracy }}%</span
                          >
                          <ContentDescription
                            class="text-xs truncate"
                            namespace="skill"
                            :content-id="item.value"
                            :fallback="item.description"
                            :context="{ skill: gameDataStore.getSkill(item.value) }"
                          />
                        </div>
                      </template>
                    </el-select-v2>
                  </div>
                </div>
              </section>
            </el-card>

            <el-card shadow="never">
              <template #header>
                <div class="section-header">
                  <h3 class="font-medium">能力值配置</h3>
                  <el-tag :type="currentEVTotal > 510 ? 'danger' : 'info'">学习力 {{ currentEVTotal }}/510</el-tag>
                </div>
              </template>
              <div class="space-y-3">
                <!-- 性格选择 -->
                <div>
                  <label class="block text-xs font-medium text-(--el-text-color-regular) mb-1">性格</label>
                  <el-select-v2
                    v-model="selectedPet.nature"
                    data-team-field="nature"
                    :options="natureSelectOptions"
                    placeholder="选择性格"
                    class="w-full"
                    style="width: 100%"
                    :height="300"
                    :item-height="100"
                  >
                    <template #default="{ item }">
                      <div class="flex flex-col space-y-2 p-3 min-w-0">
                        <div class="text-sm font-medium text-(--el-text-color-primary) truncate">{{ item.label }}</div>
                        <div class="flex flex-wrap gap-1">
                          <el-tag
                            v-for="(value, stat) in item.effects"
                            :key="stat"
                            size="small"
                            :type="value > 1 ? 'success' : value < 1 ? 'danger' : 'info'"
                          >
                            {{ statChineseMap[stat as StatKey] }} {{ value }}x
                          </el-tag>
                        </div>
                      </div>
                    </template>
                  </el-select-v2>
                </div>
                <fieldset v-if="availableStages.length || selectedPet.enhancement" class="mt-3">
                  <legend class="mb-1 text-xs font-medium text-(--el-text-color-regular)">神魔化</legend>
                  <el-select
                    data-team-field="enhancement"
                    :model-value="selectedPet.enhancement"
                    aria-label="强化阶段"
                    placeholder="无"
                    clearable
                    @update:model-value="value => selectStage(value || '')"
                  >
                    <el-option
                      v-if="
                        selectedPet.enhancement && !availableStages.some(row => row.id === selectedPet?.enhancement)
                      "
                      :value="selectedPet.enhancement"
                      disabled
                      :label="
                        getEnhancementName(selectedPet.enhancement) +
                        (enhancementPolicy?.mode !== 'active' ? '（本局不生效）' : '（当前不可用）')
                      "
                    />
                    <el-option-group
                      v-for="(stages, branch) in stagesByBranch"
                      :key="branch"
                      :label="branch === 'divine' ? '神化／圣化' : branch === 'demonic' ? '魔化／冥化' : String(branch)"
                    >
                      <el-option
                        v-for="stage in stages"
                        :key="stage.id"
                        :label="gameplayName('enhancement', stage.id, stage.name)"
                        :value="stage.id"
                      />
                    </el-option-group>
                  </el-select>
                  <span v-if="activeStage" class="ml-2 text-xs">
                    {{
                      statList
                        .filter(stat => activeStage!.bonus[stat])
                        .map(stat => statChineseMap[stat] + ' +' + activeStage!.bonus[stat])
                        .join('，')
                    }}
                  </span>
                </fieldset>
                <!-- 性格效果显示 -->
                <div v-if="selectedPet.nature" class="mt-2">
                  <p class="text-sm font-medium text-(--el-text-color-regular) mb-2">性格效果</p>
                  <div class="flex flex-wrap gap-1">
                    <el-tag
                      v-for="(value, stat) in gameDataStore.getNature(selectedPet.nature)?.multipliers"
                      :key="stat"
                      size="small"
                      :type="value > 1 ? 'success' : value < 1 ? 'danger' : 'info'"
                    >
                      {{ statChineseMap[stat as StatKey] }} {{ value }}x
                    </el-tag>
                  </div>
                </div>
                <div class="stat-grid">
                  <div v-for="stat in statList" :key="stat" class="stat-card">
                    <!-- 能力值头部 -->
                    <div class="flex items-center justify-between mb-2">
                      <h4 class="text-xs font-medium text-(--el-text-color-primary)">{{ statChineseMap[stat] }}</h4>
                      <div class="text-right">
                        <output
                          :aria-label="statChineseMap[stat] + '最终值'"
                          class="text-sm font-bold text-(--el-text-color-primary)"
                        >
                          {{ displayStat(computedStats[stat]?.total) }}
                        </output>
                        <div class="text-xs text-(--el-text-color-secondary)">最终值</div>
                      </div>
                    </div>

                    <details v-if="computedStats[stat]" class="mb-2 text-xs">
                      <summary :aria-label="statChineseMap[stat] + '计算明细'">计算明细</summary>
                      <div>学习力折算 ⌊{{ selectedPet.evs[stat] }} ÷ 4⌋ = {{ computedStats[stat]!.effort }}</div>
                      <div>
                        等级折算 ⌊(2 × {{ currentSpecies?.baseStats[stat] }} + {{ displayedIVs![stat] }} +
                        {{ computedStats[stat]!.effort }}) × {{ selectedPet.level }} ÷ 100⌋ =
                        {{ computedStats[stat]!.scaled }}
                      </div>
                      <div>
                        性格 ({{ computedStats[stat]!.scaled }} + {{ computedStats[stat]!.levelBonus }}) ×
                        {{ computedStats[stat]!.natureMultiplier }} =
                        {{ displayStat(computedStats[stat]!.afterNature) }}
                      </div>
                      <div>阶段加成 +{{ computedStats[stat]!.stageBonus }}</div>
                    </details>
                    <!-- 学习力滑块 -->
                    <div class="mb-3">
                      <label class="block text-xs font-medium text-(--el-text-color-regular) mb-1">
                        学习力: {{ selectedPet.evs[stat] }}
                      </label>
                      <el-slider
                        :model-value="selectedPet.evs[stat]"
                        :aria-label="statChineseMap[stat] + '学习力'"
                        :min="0"
                        :max="Math.max(252, selectedPet.evs[stat])"
                        :step="4"
                        @update:model-value="
                          value => {
                            if (typeof value === 'number') handleEVUpdate(stat, value)
                          }
                        "
                      />
                      <div class="flex justify-between text-xs text-(--el-text-color-secondary) mt-0.5">
                        <span>0</span>
                        <span>{{ Math.max(252, selectedPet.evs[stat]) }}</span>
                      </div>
                    </div>

                    <!-- 详细数值 -->
                    <div class="space-y-1">
                      <div class="flex justify-between text-xs">
                        <span class="text-(--el-text-color-regular)">种族值</span>
                        <span class="font-medium">{{ currentSpecies?.baseStats[stat] ?? '—' }}</span>
                      </div>
                      <div class="flex justify-between text-xs">
                        <span class="text-(--el-text-color-regular)">个体值</span>
                        <el-input-number
                          :controls="false"
                          size="small"
                          style="width: 4.5rem"
                          :aria-label="statChineseMap[stat] + '个体值'"
                          :data-team-field="'ivs.' + stat"
                          :model-value="displayedIVs![stat]"
                          :value-on-clear="displayedIVs![stat]"
                          :precision="0"
                          :min="0"
                          :max="Math.max(displayedIVs![stat], individualMax)"
                          @update:model-value="
                            value => {
                              if (value != null) editIndividualValue(stat, value)
                            }
                          "
                        />
                      </div>
                      <div class="flex justify-between text-xs">
                        <span class="text-(--el-text-color-regular)">性格修正</span>
                        <span
                          class="font-medium"
                          :class="{
                            'text-(--el-color-success)': (getNatureMultiplier(selectedPet.nature, stat) ?? 1) > 1,
                            'text-(--el-color-danger)': (getNatureMultiplier(selectedPet.nature, stat) ?? 1) < 1,
                            'text-(--el-text-color-regular)': getNatureMultiplier(selectedPet.nature, stat) === 1,
                          }"
                        >
                          {{
                            gameDataStore.getNature(selectedPet.nature)
                              ? getNatureMultiplier(selectedPet.nature, stat) + 'x'
                              : '—'
                          }}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </el-card>
          </div>
        </div>

        <el-card v-else class="lg:col-span-9" :inert="environmentBusy" shadow="never">
          <el-empty :description="currentTeam.length ? '请选择精灵' : '队伍为空'">
            <template v-if="!currentTeam.length" #default>
              <el-button type="primary" :icon="Plus" @click="addNewPet">添加新精灵</el-button>
              <el-button v-if="delegate.storageRoute" :tag="RouterLink" :to="delegate.storageRoute" :icon="Box"
                >前往仓库</el-button
              >
            </template>
          </el-empty>
        </el-card>
      </div>
    </main>

    <div v-if="!compact" class="team-action-bar" :inert="environmentBusy">
      <div v-if="delegate.stale?.value" class="team-save-impact" role="alert">
        仓库成员或引用关系已变更。可先导出配法，再放弃草稿以载入当前队伍。
      </div>
      <div v-else-if="delegate.affected?.value.length" class="team-save-impact" role="status">
        修改原精灵会同步到：{{ delegate.affected.value.join('、') }}
      </div>
      <div class="team-actions">
        <el-button v-if="delegate.save" :disabled="delegate.stale?.value" type="primary" @click="saveCurrentTeam()">
          {{ delegate.affected?.value.length ? '复制一只给本队' : delegate.saveLabel || '保存' }}
        </el-button>
        <el-button
          v-if="delegate.affected?.value.length"
          :disabled="delegate.stale?.value"
          @click="saveCurrentTeam('original')"
          >修改原精灵</el-button
        >
        <el-button
          v-if="delegate.discardDraft && (delegate.affected?.value.length || delegate.stale?.value)"
          text
          @click="delegate.discardDraft()"
          >放弃草稿</el-button
        >
        <el-dropdown v-if="isMobile" trigger="click" placement="top-end" @command="handleTeamAction">
          <el-button text aria-label="更多操作">更多</el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item v-if="delegate.exportTeam" command="export">导出</el-dropdown-item>
              <el-dropdown-item v-if="delegate.importTeam" command="import">导入</el-dropdown-item>
              <el-dropdown-item command="help">使用教程</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <template v-else>
          <el-button v-if="delegate.exportTeam" text @click="handleExportTeamConfig">导出</el-button>
          <el-button v-if="delegate.importTeam" text @click="importTeamConfig">导入</el-button>
          <el-button text :icon="InfoFilled" aria-label="使用教程" title="使用教程" @click="showHelp = true" />
        </template>
      </div>
    </div>
    <el-dialog
      :model-value="!!speciesCandidate"
      title="更换种族"
      width="min(38rem, calc(100vw - 2rem))"
      append-to-body
      @update:model-value="speciesChoice = undefined"
    >
      <el-table v-if="speciesCandidate && selectedPet" :data="speciesChanges" max-height="50vh" size="small">
        <el-table-column prop="label" label="项目" width="76" />
        <el-table-column prop="before" label="当前" />
        <el-table-column prop="after" label="更换后" />
      </el-table>
      <template #footer>
        <el-button @click="speciesChoice = undefined">取消</el-button>
        <el-button type="primary" @click="applySpeciesChange">确认更换种族</el-button>
      </template>
    </el-dialog>
    <!-- 帮助对话框 -->
    <el-dialog v-model="showHelp" title="使用帮助" width="min(32rem, calc(100vw - 2rem))" append-to-body>
      <div class="space-y-4 text-sm text-(--el-text-color-regular)">
        <div>
          <h4 class="font-medium text-(--el-text-color-primary) mb-2">队伍操作</h4>
          <ul class="space-y-1 list-disc list-inside">
            <li>拖拽左侧列表中的精灵可以调整出战顺序。</li>
            <li>点击“添加精灵”按钮可以向当前队伍中添加新的精灵。</li>
            <li v-if="delegate.storageRoute">从队伍移出后，这只精灵仍保存在仓库中。</li>
          </ul>
        </div>
        <div>
          <h4 class="font-medium text-(--el-text-color-primary) mb-2">配置精灵</h4>
          <ul class="space-y-1 list-disc list-inside">
            <li>在右侧配置区域，可以修改精灵的名称、种族、等级、性别等基础信息。</li>
            <li>通过滑块和输入框精确调整精灵的能力值（学习力、个体值）。</li>
            <li>为精灵选择合适的技能，包括普通技能和必杀技能。</li>
          </ul>
        </div>
        <div>
          <h4 class="font-medium text-(--el-text-color-primary) mb-2">数据管理</h4>
          <ul class="space-y-1 list-disc list-inside">
            <li v-if="delegate.storageRoute">多个队伍共用一只时，保存可以修改原只，也可以复制一只给本队。</li>
            <li>使用“导出”和“导入”功能，可以方便地备份和分享你的队伍配置。</li>
          </ul>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<style scoped>
.team-editor {
  background: var(--el-bg-color-page);
  color: var(--el-text-color-primary);
  --el-card-padding: 16px;
}
.editor-header {
  background: var(--el-bg-color);
  border-bottom: 1px solid var(--el-border-color-light);
  position: sticky;
  top: 0;
  z-index: 40;
}
.section-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.team-member,
.stat-card {
  padding: 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--el-border-radius-base);
}
.team-member {
  padding: 8px;
}
.team-member:hover {
  background: var(--el-fill-color-light);
}
.team-member.is-selected {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}
.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 10rem), 1fr));
  gap: 12px;
}
.validation-issue {
  white-space: normal;
  height: auto;
  text-align: start;
}
.team-action-bar {
  position: fixed;
  z-index: 50;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: max-content;
  max-width: calc(100% - 1rem);
  padding: 0.5rem;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color);
  border-radius: var(--el-border-radius-base);
  box-shadow: var(--el-box-shadow-light);
}
.team-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 4px;
}
.team-actions :deep(.el-button) {
  margin: 0;
}
.team-save-impact {
  font-size: 0.8rem;
  margin-bottom: 0.4rem;
  color: var(--el-text-color-regular);
  max-height: 3.5rem;
  overflow: auto;
  overflow-wrap: anywhere;
}

.touch-panning-y .drag-handle {
  touch-action: pan-y;
}
</style>

<script setup lang="ts">
import { gameplayName } from '@/i18n/environment'
import type { TeamEditorDelegate } from './delegate'
import { ref, computed, watch, nextTick } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import { useGameDataStore } from '@/stores/gameData'
import { useValidationStore } from '@/stores/validation'

import { resolveLearnset, isEligible } from '@arcadia-eternity/content-sdk/environment-rules'
import { type PetSchemaType } from '@arcadia-eternity/schema'
import { useTranslation } from 'i18next-vue'
import {
  canUseEnhancementStage,
  Gender,
  individualValueSpread,
  scaledIndividualValues,
  resolveEnvironmentMechanics,
  maxEquippedSkills,
} from '@arcadia-eternity/const'
import { Sortable } from 'sortablejs-vue3'
import PetIcon from '@/components/PetIcon.vue'
import ElementIcon from '@/components/battle/ElementIcon.vue'
import { allowsTeamContent, startingSkills } from './createTeamPet'
import {
  buildDifferences,
  buildStatSteps,
  statNames as statChineseMap,
  statList,
  type StatKey,
} from '@/utils/teamBuildComparison'
import { Value } from '@sinclair/typebox/value'
import { RouterLink } from 'vue-router'
import ContentDescription from '@/components/ContentDescription'
import { Box, Delete, InfoFilled, Plus, StarFilled, Top } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useMobile } from '@/composition/useMobile'
import { readLocalData, writeLocalData } from '@/services/localStorage'
import { categorySkillSlots, findMissingTeamContent, replaceResolvedSkills } from '@/utils/teamContent'

const { i18next } = useTranslation()

const props = defineProps<{ delegate: TeamEditorDelegate; compact?: boolean; environmentBusy?: boolean }>()
const delegate = props.delegate
const gameDataStore = useGameDataStore()
const validationStore = useValidationStore()
const importTeamConfig = () => delegate.importTeam?.()

// 移动端检测
const { isMobile } = useMobile()

// 响应式状态
const selectedPetId = ref<string | null>(delegate.team.value[0]?.id ?? null)
const showDragTip = ref(!props.compact && readLocalData('teamBuilderDragTipHidden') !== 'true') // 控制拖拽提示显示
const showValidationDetails = ref(false) // 控制验证详情显示
const showHelp = ref(false) // 控制帮助对话框显示

// 排序锁状态 - PC端默认关闭，移动端默认开启
const sortLocked = ref(isMobile.value)

const drag = ref(false)

void validationStore.initialize()

// 关闭拖拽提示
const hideDragTip = () => {
  showDragTip.value = false
  writeLocalData('teamBuilderDragTipHidden', 'true')
}

const onStart = () => {
  drag.value = true
}

const handleDragEnd = (event: { oldIndex: number | undefined; newIndex: number | undefined }) => {
  nextTick(() => {
    drag.value = false
  })

  // sortablejs-vue3 使用 oldIndex 和 newIndex 来处理重排序
  if (event.oldIndex !== undefined && event.newIndex !== undefined && event.oldIndex !== event.newIndex) {
    try {
      const newOrder = [...currentTeam.value]
      const movedPet = newOrder.splice(event.oldIndex, 1)[0]
      newOrder.splice(event.newIndex, 0, movedPet)

      // 更新 Pinia 存储
      currentTeam.value = newOrder

      // 自动保存机制
      delegate.persist()

      // 视觉反馈
      console.log('队伍顺序已自动保存')
    } catch (error) {
      console.error('拖拽操作保存失败:', error)
      console.error('队伍顺序保存失败，请手动保存')
    }
  }
}

const isInitialized = computed(() => gameDataStore.loaded && delegate.ready.value)

// 计算属性
const currentTeam = computed<PetSchemaType[]>({
  get: () => delegate.team.value,
  set: newOrder => {
    delegate.team.value = newOrder
  },
})

const currentTeamName = computed(() => {
  return delegate.name.value
})

// 响应式的验证结果
interface ValidationError {
  type: string
  code: string
  message: string
  objectId?: string
  field?: string
  objectType?: string
  context?: Record<string, unknown>
}

type ValidationResult = {
  isValid: boolean
  errors: ValidationError[]
  warnings: ValidationError[]
}

const isValidating = computed(() => !gameDataStore.loaded || !validationStore.isInitialized)
const teamValidationResult = computed<ValidationResult>(() =>
  isValidating.value ? { isValid: false, errors: [], warnings: [] } : validationStore.validateTeam(currentTeam.value),
)

const selectedPet = computed<PetSchemaType | null>(() => {
  return currentTeam.value.find(p => p.id === selectedPetId.value) || null
})
watch(
  () => currentTeam.value.map(pet => pet.id),
  ids => {
    if (!selectedPetId.value || !ids.includes(selectedPetId.value)) selectedPetId.value = ids[0] ?? null
  },
)
function applyPetBuild(pet: PetSchemaType) {
  if (pet.id !== selectedPetId.value) return
  currentTeam.value = currentTeam.value.map(member => (member.id === pet.id ? pet : member))
}
const selectedMissingContent = computed(() =>
  selectedPet.value && gameDataStore.loaded
    ? findMissingTeamContent([selectedPet.value], gameDataStore, enhancementPolicy.value?.mode === 'active')
    : [],
)
const removeMissingSkill = (index: number) => {
  if (!selectedPet.value || gameDataStore.getSkill(selectedPet.value.skills[index])) return
  if (selectedPet.value.inheritedSkill === selectedPet.value.skills[index]) delete selectedPet.value.inheritedSkill
  selectedPet.value.skills.splice(index, 1)
  debouncedSave()
}

const currentSpecies = computed(() => {
  return gameDataStore.speciesList.find(v => v.id === selectedPet.value?.species || '')
})

const filteredAbility = computed(() => {
  if (!currentSpecies.value) return []

  return currentSpecies.value.ability
    .map(ability => gameDataStore.marksList.find(m => m.id === ability))
    .filter(Boolean)
})

const filteredElblem = computed(() => {
  if (!currentSpecies.value) return []

  return currentSpecies.value.emblem.map(elblem => gameDataStore.marksList.find(m => m.id === elblem)).filter(Boolean)
})

// 额外技能状态
const learning = computed(() =>
  currentSpecies.value && selectedPet.value
    ? resolveLearnset(gameDataStore.rules, currentSpecies.value, selectedPet.value.level)
    : undefined,
)
const filteredSkills = computed(() => {
  const sources = learning.value
  if (!sources) return []
  const ids = new Set([...sources.normal, ...sources.inherited, ...(selectedPet.value?.skills ?? [])])
  return [...ids].map(id => gameDataStore.getSkill(id)).filter(skill => skill !== undefined)
})
function requiresInheritance(id: string) {
  return !!learning.value?.inherited.has(id) && !learning.value.normal.has(id)
}

const genderChineseMap: Record<Gender, string> = {
  [Gender.Male]: '雄性',
  [Gender.Female]: '雌性',
  [Gender.NoGender]: '无性别',
}

// 获取性格中文名称
const getEnhancementName = (id: string) => gameplayName('enhancement', id, gameDataStore.getEnhancement(id)?.name)
const getNatureName = (id: string) => gameplayName('nature', id, gameDataStore.getNature(id)?.name)

const skillSlots = computed(() => gameDataStore.rules?.mechanics?.skillSlots)
function categorySlots(climax: boolean) {
  return computed(() =>
    categorySkillSlots(selectedPet.value?.skills ?? [], skillSlots.value, climax, gameDataStore.getSkill),
  )
}
const displayedNormalSkills = categorySlots(false)
const displayedClimaxSkills = categorySlots(true)

// Namespaced server content may not include a browser translation catalog.
const contentName = (id: string, ns: string | string[]) =>
  i18next.t(`${id}.name`, { ns, nsSeparator: false, defaultValue: id })

// 新的下拉框选项计算属性
const speciesOptions = computed(() => {
  const options = gameDataStore.speciesList.map(species => ({
    value: species.id,
    disabled: !allowsTeamContent(gameDataStore.rules, 'species', species.id),
    id: species.id,
    presentation: species.presentation,
    label: contentName(species.id, 'species'),
    num: species.num,
    element: species.element,
  }))
  options.sort((a, b) => a.num - b.num)
  const id = selectedPet.value?.species
  return id && !gameDataStore.getSpecies(id)
    ? [{ value: id, label: `缺失精灵：${id}`, num: undefined, element: undefined, disabled: true }, ...options]
    : options
})

// 存储当前种族允许的性别
const allowedGendersForCurrentSpecies = ref<string[]>(['Male', 'Female', 'NoGender'])

// 监听选中精灵的种族变化，更新允许的性别
watch(
  () => selectedPet.value?.species,
  async newSpecies => {
    if (!newSpecies) {
      allowedGendersForCurrentSpecies.value = ['Male', 'Female', 'NoGender']
      return
    }

    try {
      // 并行加载性别限制和额外技能
      const allowedGenders = await validationStore.getAllowedGendersForSpecies(newSpecies)

      allowedGendersForCurrentSpecies.value = allowedGenders

      // Viewing a draft or changing environments never rewrites saved attributes.
    } catch (error) {
      console.warn('获取性别限制失败:', error)
      allowedGendersForCurrentSpecies.value = ['Male', 'Female', 'NoGender']
    }
  },
  { immediate: true },
)

const genderOptions = computed(() => {
  // 只返回允许的性别选项
  return Object.values(Gender)
    .filter(gender => allowedGendersForCurrentSpecies.value.includes(gender))
    .map(gender => ({
      value: gender,
      label: genderChineseMap[gender as Gender],
      icon: gender === Gender.Male ? '♂' : gender === Gender.Female ? '♀' : '⚲',
    }))
})

const abilitySelectOptions = computed(() => {
  if (!selectedPet.value) return []
  const currentAblity = selectedPet.value.ability
  const options = filteredAbility.value
    .filter(ability => !!ability)
    .map(ability => ({
      value: ability.id,
      label: contentName(ability.id, ['mark', 'mark_ability', 'mark_emblem', 'mark_global']),
      description: i18next.t(`${ability.id}.description`, {
        ns: ['mark', 'mark_ability', 'mark_emblem', 'mark_global'],
      }),
      disabled: currentAblity === ability.id || !allowsTeamContent(gameDataStore.rules, 'marks', ability.id),
    }))
  return currentAblity && !gameDataStore.getMark(currentAblity)
    ? [
        { value: currentAblity, label: `缺失特性：${currentAblity}`, description: '原始配置已保留', disabled: true },
        ...options,
      ]
    : options
})

const emblemSelectOptions = computed(() => {
  if (!selectedPet.value) return []
  const currentElblem = selectedPet.value.emblem
  const options = filteredElblem.value
    .filter(elblem => !!elblem)
    .map(elblem => ({
      value: elblem.id,
      label: contentName(elblem.id, ['mark', 'mark_ability', 'mark_emblem', 'mark_global']),
      description: i18next.t(`${elblem.id}.description`, {
        ns: ['mark', 'mark_ability', 'mark_emblem', 'mark_global'],
      }),
      disabled: currentElblem === elblem.id || !allowsTeamContent(gameDataStore.rules, 'marks', elblem.id),
    }))
  return currentElblem && !gameDataStore.getMark(currentElblem)
    ? [
        { value: currentElblem, label: `缺失纹章：${currentElblem}`, description: '原始配置已保留', disabled: true },
        ...options,
      ]
    : options
})

const enhancementPolicy = computed(() => gameDataStore.rules?.mechanics?.enhancement)
const availableStages = computed(() => {
  const pet = selectedPet.value
  const species = currentSpecies.value
  if (!pet || !species) return []
  return gameDataStore.enhancements.filter(stage =>
    canUseEnhancementStage(enhancementPolicy.value, species, pet.level, stage),
  )
})
const stagesByBranch = computed(() => {
  const groups = Object.create(null) as Record<string, typeof availableStages.value>
  for (const stage of availableStages.value) (groups[stage.branch] ??= []).push(stage)
  return groups
})
const activeStage = computed(() => availableStages.value.find(stage => stage.id === selectedPet.value?.enhancement))
function selectStage(id: string) {
  if (!selectedPet.value) return
  if (!id) delete selectedPet.value.enhancement
  else if (availableStages.value.some(stage => stage.id === id)) selectedPet.value.enhancement = id
}

const natureSelectOptions = computed(() => {
  const choices = gameDataStore.natures
    .filter(
      nature =>
        nature.generation === 1 ||
        (currentSpecies.value &&
          isEligible(currentSpecies.value, gameDataStore.rules?.mechanics?.secondGenerationNatures)),
    )
    .map(nature => ({
      value: nature.id,
      label: (nature.generation === 2 ? '二代 · ' : '') + getNatureName(nature.id),
      effects: nature.multipliers,
      disabled: false,
    }))
  const id = selectedPet.value?.nature
  if (id && !choices.some(option => option.value === id))
    return [
      {
        value: id,
        label: getNatureName(id) + '（当前不可用）',
        effects: gameDataStore.getNature(id)?.multipliers,
        disabled: true,
      },
      ...choices,
    ]
  return choices
})

const skillGroups = computed(() => [
  {
    name: '普通技能',
    climax: false,
    slots: displayedNormalSkills.value,
    min: 0,
    max: skillSlots.value?.normalMax ?? maxEquippedSkills,
    available: filteredSkills.value.some(skill => skill.category !== 'Climax'),
  },
  {
    name: '必杀技能',
    climax: true,
    slots: displayedClimaxSkills.value,
    min: skillSlots.value?.climaxMin ?? 0,
    max: skillSlots.value?.climaxMax ?? maxEquippedSkills,
    available: filteredSkills.value.some(skill => skill.category === 'Climax'),
  },
])
function inheritedInOtherSlot(slot: string) {
  const pet = selectedPet.value
  return pet?.skills.some(
    id => id !== slot && (requiresInheritance(id) || (id === pet.inheritedSkill && !learning.value?.normal.has(id))),
  )
}
function skillOptions(climax: boolean, slot: string) {
  const equipped = selectedPet.value?.skills ?? []
  const occupied = inheritedInOtherSlot(slot)
  return filteredSkills.value
    .filter(skill => (skill.category === 'Climax') === climax)
    .map(skill => {
      const inherited = requiresInheritance(skill.id)
      let reason = ''
      if (
        !allowsTeamContent(gameDataStore.rules, 'skills', skill.id) ||
        (!inherited && !learning.value?.normal.has(skill.id))
      )
        reason = '当前不可用'
      else if (slot !== skill.id && equipped.includes(skill.id)) reason = '已装备'
      else if (inherited && occupied) reason = '已装备其他遗传技能'
      return {
        value: skill.id,
        label: contentName(skill.id, 'skill'),
        inherited,
        reason,
        disabled: !!reason,
        description: i18next.t(skill.id + '.description', { ns: 'skill', nsSeparator: false }),
        element: skill.element,
        power: skill.power,
        category: i18next.t('category.' + skill.category, { ns: 'battle', defaultValue: skill.category }),
        rage: skill.rage,
        accuracy: skill.accuracy,
      }
    })
}

const teamCapacity = computed(() => validationStore.getRuleLimitations().teamSize.max)
const addNewPet = () => {
  if (currentTeam.value.length >= teamCapacity.value) return
  const newPet = delegate.createPet()
  if (!newPet) return
  currentTeam.value = [...currentTeam.value, newPet]
  selectedPetId.value = newPet.id
  delegate.persist()
}

// 删除精灵处理函数
const handleDeletePet = (petId: string) => {
  delegate.removePet(petId, () => {
    // 如果删除的是当前选中的精灵，选择队伍中的第一个精灵
    if (selectedPetId.value === petId) {
      const remainingTeam = currentTeam.value
      selectedPetId.value = remainingTeam.length > 0 ? remainingTeam[0].id : null
    }
  })
}

// 设置精灵为首发
const setAsStarter = (petId: string) => {
  const team = [...currentTeam.value]
  const petIndex = team.findIndex(pet => pet.id === petId)

  if (petIndex === 0) {
    // 已经是首发，不需要操作
    ElMessage.info('该精灵已经是首发位置')
    return
  }

  if (petIndex === -1) {
    ElMessage.error('未找到该精灵')
    return
  }

  // 将精灵移动到队伍首位
  const [pet] = team.splice(petIndex, 1)
  team.unshift(pet)

  // 更新队伍顺序
  currentTeam.value = team
  delegate.persist()

  ElMessage.success('已设置为首发精灵')
}

const saveCurrentTeam = async (scope: 'original' | 'copy' = 'copy') => {
  try {
    const position = currentTeam.value.findIndex(pet => pet.id === selectedPetId.value)
    if ((await delegate.save?.(scope)) === false) return
    if (position >= 0) selectedPetId.value = currentTeam.value[position]?.id ?? null
    if (delegate.saveLabel) return
    ElMessage.success(selectedMissingContent.value.length ? '队伍已保存，缺失内容的原始配置已保留' : '队伍保存成功')
  } catch {
    ElMessage.error('保存失败，请检查数据')
  }
}

const clearAllData = async () => {
  if (await delegate.clear?.()) selectedPetId.value = null
}

const getPetNameById = (petId: string) => {
  return currentTeam.value.find(pet => pet.id === petId)?.name
}

const formatErrorContext = (context: Record<string, unknown>) => {
  const parts = []
  if (context.minSize !== undefined) parts.push(`最少${context.minSize}只`)
  if (context.maxSize !== undefined) parts.push(`最多${context.maxSize}只`)
  if (context.currentSize !== undefined) parts.push(`当前${context.currentSize}只`)
  if (context.minLevel !== undefined) parts.push(`最低等级${context.minLevel}`)
  if (context.maxLevel !== undefined) parts.push(`最高等级${context.maxLevel}`)
  if (context.currentLevel !== undefined) parts.push(`当前等级${context.currentLevel}`)
  if (context.maxEV !== undefined) parts.push(`学习力上限${context.maxEV}`)
  if (context.currentEV !== undefined) parts.push(`当前学习力${context.currentEV}`)
  if (context.skillId !== undefined) parts.push(`技能${context.skillId}`)
  if (context.requiredLevel !== undefined) parts.push(`需要等级${context.requiredLevel}`)
  if (context.currentLevel !== undefined && context.requiredLevel !== undefined) {
    parts.push(`当前等级${context.currentLevel}`)
  }
  return parts.join(', ')
}

const editorRoot = ref<HTMLElement>()
const handleErrorClick = async (error: ValidationError) => {
  // 如果错误关联到特定精灵，选中该精灵
  if (error.objectId) {
    const pet = currentTeam.value.find(p => p.id === error.objectId)
    if (pet) {
      selectedPetId.value = pet.id
      await nextTick()
      if (error.field) {
        const target = editorRoot.value?.querySelector<HTMLElement>(`[data-team-field="${CSS.escape(error.field)}"]`)
        const control = target?.matches('input, select, button')
          ? target
          : target?.querySelector<HTMLElement>('input, select, button')
        control?.focus()
      }
    }
  }
}

const speciesChoice = ref<string>()
const speciesUndo = ref<{ before: PetSchemaType; after: PetSchemaType }>()
watch(
  [selectedPetId, () => gameDataStore.species, () => gameDataStore.rules],
  () => {
    speciesChoice.value = undefined
    speciesUndo.value = undefined
  },
  { flush: 'sync' },
)
function previewSpeciesChange(id: string) {
  speciesChoice.value = id !== selectedPet.value?.species ? id : undefined
}
const speciesCandidate = computed(() => {
  const current = selectedPet.value
  const species = speciesChoice.value && gameDataStore.getSpecies(speciesChoice.value)
  if (!current || !species || !allowsTeamContent(gameDataStore.rules, 'species', species.id)) return
  const pet = Value.Clone(current)
  pet.species = species.id
  pet.name = contentName(species.id, 'species')
  pet.skills = startingSkills(gameDataStore, species, pet.level)
  pet.evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }
  pet.ability = species.ability.find(id => allowsTeamContent(gameDataStore.rules, 'marks', id))
  pet.emblem = species.emblem.find(id => allowsTeamContent(gameDataStore.rules, 'marks', id))
  if (!pet.ability) delete pet.ability
  if (!pet.emblem) delete pet.emblem
  pet.gender = !species.genderRatio ? Gender.NoGender : species.genderRatio[0] > 0 ? Gender.Female : Gender.Male
  pet.height = species.heightRange[1]
  pet.weight = species.weightRange[1]
  return pet
})
const speciesChanges = computed(() =>
  selectedPet.value && speciesCandidate.value
    ? buildDifferences(selectedPet.value, speciesCandidate.value, (key, id) => {
        if (key === 'species') return contentName(id, 'species')
        if (key === 'skills') return contentName(id, 'skill')
        if (key === 'ability' || key === 'emblem')
          return contentName(id, ['mark', 'mark_ability', 'mark_emblem', 'mark_global'])
        if (key === 'gender') return genderChineseMap[id as Gender] ?? id
        return id
      })
    : [],
)
const canUndoSpecies = computed(() => !!speciesUndo.value && Value.Equal(speciesUndo.value.after, selectedPet.value))
function applySpeciesChange() {
  if (!selectedPet.value || !speciesCandidate.value) return
  speciesUndo.value = { before: Value.Clone(selectedPet.value), after: Value.Clone(speciesCandidate.value) }
  applyPetBuild(speciesCandidate.value)
  speciesChoice.value = undefined
}
function restoreSpecies() {
  if (!canUndoSpecies.value || !speciesUndo.value) return
  applyPetBuild(speciesUndo.value.before)
  speciesUndo.value = undefined
}

const currentEVTotal = computed(() => {
  if (!selectedPet.value) return 0
  return Object.values(selectedPet.value.evs).reduce((a, b) => a + b, 0)
})

const handleEVUpdate = (stat: StatKey, value: number) => {
  if (!selectedPet.value) return

  const currentStatEV = selectedPet.value.evs[stat]
  const otherEVSum = currentEVTotal.value - currentStatEV
  let maxAllowed = Math.min(255, 510 - otherEVSum)

  // 确保maxAllowed是4的倍数
  maxAllowed = Math.floor(maxAllowed / 4) * 4

  const roundedValue = Math.round(value / 4) * 4
  const clampedValue = Math.min(Math.max(0, roundedValue), maxAllowed)

  selectedPet.value.evs[stat] = clampedValue
}

const statFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 6, useGrouping: false })
const displayStat = (value?: number) => (value === undefined ? '—' : statFormat.format(value))
const individualMax = computed(() => resolveEnvironmentMechanics(gameDataStore.rules).individualValues.max)
const displayedIVs = computed(() => selectedPet.value && scaledIndividualValues(selectedPet.value, individualMax.value))
function editIndividualValue(stat: StatKey, value: number) {
  const pet = selectedPet.value
  if (!pet || value === displayedIVs.value?.[stat]) return
  pet.ivMax ??= individualValueSpread(individualMax.value)
  pet.ivMax[stat] = individualMax.value
  pet.ivs[stat] = value
}

const computedStats = computed(() => buildStatSteps(selectedPet.value, gameDataStore))

// 添加性格修正映射
const getNatureMultiplier = (id: string, stat: StatKey) => gameDataStore.getNature(id)?.multipliers[stat]

const debouncedSave = useDebounceFn(() => {
  if (!selectedPet.value) return

  try {
    delegate.persist()
  } catch {
    ElMessage.error('自动保存失败')
  }
}, 100)

// 监听精灵属性变化，触发保存和验证
watch(
  () => JSON.stringify(selectedPet.value),
  () => debouncedSave(),
)

// 普通技能变更处理
function changeSkill(climax: boolean, index: number, next: string | undefined) {
  const pet = selectedPet.value
  if (!pet) return
  const selected = [...(climax ? displayedClimaxSkills.value : displayedNormalSkills.value)]
  if (next && selected[index] !== next && pet.skills.includes(next)) {
    ElMessage.warning('该技能已在其他槽位')
    return
  }
  const previous = selected[index]
  selected[index] = next ?? ''
  try {
    if (next && requiresInheritance(next) && inheritedInOtherSlot(previous)) {
      ElMessage.warning('只能装备一个遗传技能')
      return
    }
    pet.skills = replaceResolvedSkills(pet.skills, selected, climax, gameDataStore.getSkill)
    if (next && requiresInheritance(next)) pet.inheritedSkill = next
    else if (previous && previous === pet.inheritedSkill && previous !== next) delete pet.inheritedSkill
    debouncedSave()
  } catch (error) {
    ElMessage.error((error as Error).message)
  }
}

// 导出队伍配置的包装函数
const handleExportTeamConfig = () => {
  delegate.exportTeam?.(currentTeam.value)
}

function handleTeamAction(action: string) {
  if (action === 'export') handleExportTeamConfig()
  else if (action === 'import') importTeamConfig()
  else if (action === 'help') showHelp.value = true
}
</script>

<style scoped>
/* 拖拽相关样式 */
.drag-handle {
  cursor: grab;
  user-select: none;
  touch-action: none;
}

.drag-handle:active {
  cursor: grabbing;
}

/* sortablejs 拖拽样式 */
.sortable-ghost {
  opacity: 0.4;
  background: var(--el-color-primary-light-9);
}

.sortable-chosen {
  cursor: grabbing;
}

.sortable-drag {
  opacity: 0.8;
  transform: rotate(2deg);
}
</style>
