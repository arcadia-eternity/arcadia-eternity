<template>
  <div class="min-h-screen bg-gray-50">
    <!-- 头部信息栏 -->
    <header class="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-40">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="flex items-center justify-between h-16">
          <div class="flex items-center space-x-4">
            <h1 class="text-xl font-semibold text-gray-900">队伍编辑器</h1>
            <div class="hidden sm:block">
              <span
                class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800"
              >
                {{ playerStore.name || '未命名训练师' }}
              </span>
            </div>
          </div>
          <router-link
            to="/storage"
            class="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
              />
            </svg>
            仓库管理
          </router-link>
        </div>
      </div>
    </header>

    <!-- 队伍管理指引 -->
    <div v-if="showGuide" class="max-w-7xl mx-auto px-2 sm:px-4 lg:px-6 pt-3">
      <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-3">
        <div class="flex items-start space-x-3">
          <div class="flex-shrink-0">
            <el-icon class="text-blue-600" :size="20"><InfoFilled /></el-icon>
          </div>
          <div class="flex-1">
            <h3 class="text-sm font-medium text-blue-800 mb-1">队伍管理提示</h3>
            <p class="text-sm text-blue-700 mb-2">
              当前正在编辑：<span class="font-medium">{{ currentTeamName }}</span>
            </p>
            <p class="text-sm text-blue-700 mb-3">
              您可以在
              <router-link to="/storage" class="font-medium text-blue-800 hover:text-blue-900 underline"
                >精灵仓库</router-link
              >
              中管理多个队伍，包括创建新队伍、复制队伍、导入导出队伍等功能。
            </p>
            <div class="flex flex-wrap gap-2">
              <router-link
                to="/storage"
                class="inline-flex items-center px-3 py-1 text-xs font-medium text-blue-700 bg-blue-100 rounded-md hover:bg-blue-200 transition-colors"
              >
                <el-icon class="mr-1" :size="14"><FolderOpened /></el-icon>
                管理所有队伍
              </router-link>
            </div>
          </div>
          <button @click="hideGuide" class="flex-shrink-0 text-blue-400 hover:text-blue-600 transition-colors">
            <el-icon :size="16"><Close /></el-icon>
          </button>
        </div>
      </div>
    </div>

    <!-- 主要内容区域 -->
    <main class="max-w-7xl mx-auto px-2 sm:px-4 lg:px-6 py-3 pb-20">
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <!-- 队伍列表 - 移动端全宽，桌面端占3列 -->
        <div class="lg:col-span-3">
          <div class="bg-white rounded-lg shadow-sm border border-gray-200">
            <div class="p-3 border-b border-gray-200">
              <div class="flex items-center justify-between">
                <div>
                  <h2 class="text-base font-medium text-gray-900">当前队伍</h2>
                  <p class="text-xs text-gray-500 mt-1">{{ currentTeam.length }}/6 只精灵</p>
                </div>
                <el-tooltip content="在精灵仓库中可以管理多个队伍" placement="left" :show-after="500" class="md:hidden">
                  <router-link
                    to="/storage"
                    class="flex items-center justify-center w-8 h-8 text-gray-400 hover:text-blue-600 transition-colors"
                  >
                    <el-icon :size="16"><QuestionFilled /></el-icon>
                  </router-link>
                </el-tooltip>
              </div>
            </div>

            <div class="p-3 space-y-2">
              <Sortable
                :list="currentTeam"
                item-key="id"
                :options="{
                  animation: 150,
                  handle: '.drag-handle',
                  disabled: currentTeam.length <= 1,
                  group: 'pets',
                  ghostClass: 'sortable-ghost',
                  chosenClass: 'sortable-chosen',
                  dragClass: 'sortable-drag',
                }"
                @start="onStart"
                @end="handleDragEnd"
                class="space-y-3"
              >
                <template #item="{ element: pet }">
                  <div
                    :key="pet.id"
                    class="group relative bg-gray-50 rounded-md p-2 cursor-pointer transition-all duration-200 hover:bg-gray-100 drag-handle"
                    :class="{
                      'ring-2 ring-blue-500 bg-blue-50': selectedPetId === pet.id,
                      'hover:shadow-md': selectedPetId !== pet.id,
                    }"
                    @click="selectedPetId = pet.id"
                  >
                    <div class="flex items-center space-x-2">
                      <div class="flex-shrink-0">
                        <PetIcon :id="gameDataStore.getSpecies(pet.species)?.num" class="w-10 h-10" />
                      </div>
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center space-x-1">
                          <ElementIcon
                            v-if="gameDataStore.getSpecies(pet.species)?.element"
                            :element="gameDataStore.getSpecies(pet.species)?.element"
                            class="w-3 h-3 flex-shrink-0"
                          />
                          <p class="text-xs font-medium text-gray-900 truncate">{{ pet.name }}</p>
                        </div>
                        <p class="text-xs text-gray-500 truncate">
                          {{ i18next.t(`${gameDataStore.getSpecies(pet.species)?.id}.name`, { ns: 'species' }) }}
                        </p>
                        <div class="flex items-center space-x-1 mt-0.5">
                          <span
                            class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-200 text-gray-800"
                          >
                            Lv.{{ pet.level }}
                          </span>
                          <span
                            class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800"
                          >
                            #{{ pet.id.slice(-4) }}
                          </span>
                        </div>
                      </div>
                      <button
                        @click.stop="removePet(pet.id)"
                        :disabled="currentTeam.length === 1"
                        class="opacity-0 group-hover:opacity-100 transition-opacity duration-200 p-1 rounded-full text-gray-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>
                </template>
              </Sortable>

              <button
                @click="addNewPet"
                :disabled="currentTeam.length >= 6"
                class="w-full flex items-center justify-center px-3 py-2 border-2 border-dashed border-gray-300 rounded-md text-xs font-medium text-gray-600 hover:border-gray-400 hover:text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
              >
                <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                  />
                </svg>
                添加精灵
              </button>
            </div>
          </div>
        </div>

        <!-- 配置区域 - 移动端全宽，桌面端占9列 -->
        <div class="lg:col-span-9" v-if="selectedPet">
          <div class="space-y-3">
            <!-- 基础信息卡片 -->
            <div class="bg-white rounded-lg shadow-sm border border-gray-200">
              <div class="px-4 py-3 border-b border-gray-200">
                <h3 class="text-base font-medium text-gray-900">基础信息</h3>
              </div>
              <div class="p-4">
                <form class="space-y-4">
                  <!-- 第一行：精灵名称和种族 -->
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label class="block text-xs font-medium text-gray-700 mb-1">精灵名称</label>
                      <input
                        v-model="selectedPet.name"
                        type="text"
                        class="block w-full px-2 py-1.5 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm"
                        placeholder="输入精灵名称"
                      />
                    </div>
                    <div>
                      <label class="block text-xs font-medium text-gray-700 mb-1">种族</label>
                      <el-select-v2
                        v-model="selectedPet.species"
                        :options="speciesOptions"
                        @change="handleSpeciesChange"
                        placeholder="选择种族"
                        filterable
                        clearable
                        class="w-full"
                        style="width: 100%"
                      >
                        <template #default="{ item }">
                          <div class="flex items-center space-x-2">
                            <PetIcon :id="item.num" class="w-6 h-6 flex-shrink-0" />
                            <div class="flex-1 min-w-0">
                              <div class="flex items-center space-x-1 text-xs font-medium text-gray-900 truncate">
                                <ElementIcon
                                  v-if="item.element"
                                  :element="item.element"
                                  class="w-3 h-3 flex-shrink-0"
                                />
                                <span class="truncate">{{ item.label }}</span>
                              </div>
                              <div class="flex items-center space-x-1 text-xs text-gray-500 truncate">
                                <span>#{{ item.num }}</span>
                                <span>{{ item.element || '未知' }}</span>
                              </div>
                            </div>
                          </div>
                        </template>
                      </el-select-v2>
                    </div>
                  </div>

                  <!-- 第二行：基础属性 -->
                  <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div>
                      <label class="block text-xs font-medium text-gray-700 mb-1">等级</label>
                      <input
                        v-model.number="selectedPet.level"
                        type="number"
                        min="1"
                        max="100"
                        class="block w-full px-2 py-1.5 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm"
                      />
                    </div>
                    <div>
                      <label class="block text-xs font-medium text-gray-700 mb-1">性别</label>
                      <el-select-v2
                        v-model="selectedPet.gender"
                        :options="genderOptions"
                        :disabled="!currentSpecies?.genderRatio"
                        placeholder="选择性别"
                        filterable
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
                    </div>
                    <div>
                      <label class="block text-xs font-medium text-gray-700 mb-1">身高</label>
                      <input
                        v-model.number="selectedPet.height"
                        type="number"
                        :min="currentSpecies?.heightRange[0]"
                        :max="currentSpecies?.heightRange[1]"
                        class="block w-full px-2 py-1.5 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm"
                      />
                    </div>
                    <div>
                      <label class="block text-xs font-medium text-gray-700 mb-1">体重</label>
                      <input
                        v-model.number="selectedPet.weight"
                        type="number"
                        :min="currentSpecies?.weightRange[0]"
                        :max="currentSpecies?.weightRange[1]"
                        class="block w-full px-2 py-1.5 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm"
                      />
                    </div>
                  </div>

                  <!-- 第三行：特性、纹章与性格 -->
                  <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <!-- 特性选择 -->
                    <div>
                      <label class="block text-xs font-medium text-gray-700 mb-1">特性</label>
                      <el-select-v2
                        v-model="selectedPet.ability"
                        :options="abilitySelectOptions"
                        :disabled="!currentSpecies"
                        placeholder="选择特性"
                        filterable
                        clearable
                        class="w-full"
                        style="width: 100%"
                        :height="300"
                        :item-height="80"
                      >
                        <template #default="{ item }">
                          <div class="flex flex-col space-y-1 p-3 min-w-0">
                            <div class="text-sm font-medium text-gray-900 truncate">{{ item.label }}</div>
                            <div class="text-xs text-gray-500 leading-relaxed break-words whitespace-normal">
                              {{ item.description }}
                            </div>
                          </div>
                        </template>
                      </el-select-v2>
                    </div>

                    <!-- 纹章选择 -->
                    <div>
                      <label class="block text-xs font-medium text-gray-700 mb-1">纹章</label>
                      <el-select-v2
                        v-model="selectedPet.emblem"
                        :options="emblemSelectOptions"
                        placeholder="选择纹章"
                        filterable
                        clearable
                        class="w-full"
                        style="width: 100%"
                        :height="300"
                        :item-height="80"
                      >
                        <template #default="{ item }">
                          <div class="flex flex-col space-y-1 p-3 min-w-0">
                            <div class="text-sm font-medium text-gray-900 truncate">{{ item.label }}</div>
                            <div class="text-xs text-gray-500 leading-relaxed break-words whitespace-normal">
                              {{ item.description }}
                            </div>
                          </div>
                        </template>
                      </el-select-v2>
                    </div>

                    <!-- 性格选择 -->
                    <div>
                      <label class="block text-xs font-medium text-gray-700 mb-1">性格</label>
                      <el-select-v2
                        v-model="selectedPet.nature"
                        :options="natureSelectOptions"
                        placeholder="选择性格"
                        filterable
                        class="w-full"
                        style="width: 100%"
                        :height="300"
                        :item-height="100"
                      >
                        <template #default="{ item }">
                          <div class="flex flex-col space-y-2 p-3 min-w-0">
                            <div class="text-sm font-medium text-gray-900 truncate">{{ item.label }}</div>
                            <div class="flex flex-wrap gap-1">
                              <span
                                v-for="(value, stat) in item.effects"
                                :key="stat"
                                class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium flex-shrink-0"
                                :class="{
                                  'bg-green-100 text-green-800': value > 1,
                                  'bg-red-100 text-red-800': value < 1,
                                  'bg-gray-100 text-gray-800': value === 1,
                                }"
                              >
                                {{ String(stat).toUpperCase() }} {{ value }}x
                              </span>
                            </div>
                          </div>
                        </template>
                      </el-select-v2>
                    </div>
                  </div>

                  <!-- 性格效果显示 -->
                  <div v-if="selectedPet.nature" class="p-3 bg-gray-50 rounded-md">
                    <p class="text-sm font-medium text-gray-700 mb-2">性格效果：</p>
                    <div class="flex flex-wrap gap-1">
                      <span
                        v-for="(value, stat) in NatureMap[selectedPet.nature as Nature]"
                        :key="stat"
                        class="inline-flex items-center px-2 py-1 rounded text-sm font-medium"
                        :class="{
                          'bg-green-100 text-green-800': value > 1,
                          'bg-red-100 text-red-800': value < 1,
                          'bg-gray-100 text-gray-800': value === 1,
                        }"
                      >
                        {{ stat.toUpperCase() }} {{ value }}x
                      </span>
                    </div>
                  </div>
                </form>
              </div>
            </div>

            <!-- 能力值配置 -->
            <div class="bg-white rounded-lg shadow-sm border border-gray-200">
              <div class="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                <h3 class="text-base font-medium text-gray-900">能力值配置</h3>
                <span
                  class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium"
                  :class="currentEVTotal > 510 ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'"
                >
                  学习力总和: {{ currentEVTotal }}/510
                </span>
              </div>
              <div class="p-4">
                <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                  <div v-for="stat in statList" :key="stat" class="bg-gray-50 rounded-md p-3">
                    <!-- 能力值头部 -->
                    <div class="flex items-center justify-between mb-2">
                      <h4 class="text-xs font-medium text-gray-900">{{ statChineseMap[stat] }}</h4>
                      <div class="text-right">
                        <div class="text-sm font-bold text-gray-900">{{ computedStats[stat] }}</div>
                        <div class="text-xs text-gray-500">最终值</div>
                      </div>
                    </div>

                    <!-- 学习力滑块 -->
                    <div class="mb-3">
                      <label class="block text-xs font-medium text-gray-700 mb-1">
                        学习力: {{ selectedPet?.evs[stat] || 0 }}
                      </label>
                      <input
                        type="range"
                        :value="selectedPet.evs[stat]"
                        @input="handleEVUpdate(stat, Number(($event.target as HTMLInputElement).value))"
                        min="0"
                        max="255"
                        step="4"
                        class="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
                      />
                      <div class="flex justify-between text-xs text-gray-500 mt-0.5">
                        <span>0</span>
                        <span>255</span>
                      </div>
                    </div>

                    <!-- 详细数值 -->
                    <div class="space-y-1">
                      <div class="flex justify-between text-xs">
                        <span class="text-gray-600">种族值</span>
                        <span class="font-medium">{{ currentSpecies?.baseStats[stat] || 0 }}</span>
                      </div>
                      <div class="flex justify-between text-xs">
                        <span class="text-gray-600">个体值</span>
                        <input
                          v-model.number="selectedPet.ivs[stat]"
                          type="number"
                          min="0"
                          max="31"
                          class="w-12 px-1 py-0.5 text-xs border border-gray-300 rounded text-right focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                      <div v-if="stat !== 'hp'" class="flex justify-between text-xs">
                        <span class="text-gray-600">性格修正</span>
                        <span
                          class="font-medium"
                          :class="{
                            'text-green-600': getNatureMultiplier(selectedPet.nature, stat) > 1,
                            'text-red-600': getNatureMultiplier(selectedPet.nature, stat) < 1,
                            'text-gray-600': getNatureMultiplier(selectedPet.nature, stat) === 1,
                          }"
                        >
                          {{ getNatureMultiplier(selectedPet.nature, stat) }}x
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 技能配置 -->
            <div class="bg-white rounded-lg shadow-sm border border-gray-200">
              <div class="px-4 py-3 border-b border-gray-200">
                <h3 class="text-base font-medium text-gray-900">技能配置</h3>
                <p class="text-xs text-gray-500 mt-1">最多可配置5个技能</p>
              </div>
              <div class="p-4">
                <div class="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                  <div v-for="(_, index) in 5" :key="index" class="space-y-2">
                    <label class="block text-xs font-medium text-gray-700">
                      技能 {{ index + 1 }}
                      <span v-if="index === 0" class="text-red-500">*</span>
                    </label>
                    <el-select-v2
                      :model-value="displayedSkills[index]"
                      @update:model-value="value => handleSkillChange(value, index)"
                      :options="skillSelectOptions"
                      :disabled="!currentSpecies"
                      placeholder="选择技能"
                      filterable
                      clearable
                      class="w-full"
                      style="width: 100%"
                      :height="400"
                      :item-height="140"
                    >
                      <template #default="{ item }">
                        <div class="flex flex-col space-y-2 p-3 min-w-0 max-w-full">
                          <!-- 技能名称 -->
                          <div class="flex items-center space-x-1 text-sm font-medium text-gray-900">
                            <ElementIcon v-if="item.element" :element="item.element" class="w-4 h-4 flex-shrink-0" />
                            <span class="font-medium">{{ item.label }}</span>
                          </div>
                          <!-- 技能标签 -->
                          <div class="flex flex-wrap gap-1">
                            <span
                              class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800"
                            >
                              威力: {{ item.power }}
                            </span>
                            <span
                              class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800"
                            >
                              {{ item.category }}
                            </span>
                            <span
                              class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-800"
                            >
                              怒气: {{ item.rage }}
                            </span>
                            <span
                              class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800"
                            >
                              命中: {{ item.accuracy }}%
                            </span>
                          </div>
                          <!-- 技能描述 -->
                          <div
                            class="text-xs text-gray-600 leading-relaxed break-words whitespace-normal prose prose-xs max-w-none overflow-hidden"
                            v-html="md.render(item.description)"
                          ></div>
                        </div>
                      </template>
                    </el-select-v2>

                    <!-- 技能详情显示 -->
                    <div v-if="displayedSkills[index]" class="p-2 bg-gray-50 rounded-md">
                      <div class="flex items-center justify-between mb-1">
                        <div class="flex items-center space-x-1">
                          <ElementIcon
                            v-if="gameDataStore.skillList.find(s => s.id === displayedSkills[index])?.element"
                            :element="gameDataStore.skillList.find(s => s.id === displayedSkills[index])?.element!"
                            class="w-3 h-3 flex-shrink-0"
                          />
                          <h4 class="text-xs font-medium text-gray-900">
                            {{ i18next.t(`${displayedSkills[index]}.name`, { ns: 'skill' }) }}
                          </h4>
                        </div>
                        <div class="flex flex-wrap gap-1">
                          <span
                            class="inline-flex items-center px-1 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800"
                          >
                            威力: {{ gameDataStore.skillList.find(s => s.id === displayedSkills[index])?.power }}
                          </span>
                          <span
                            class="inline-flex items-center px-1 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800"
                          >
                            {{ gameDataStore.skillList.find(s => s.id === displayedSkills[index])?.category }}
                          </span>
                          <span
                            class="inline-flex items-center px-1 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-800"
                          >
                            怒气: {{ gameDataStore.skillList.find(s => s.id === displayedSkills[index])?.rage }}
                          </span>
                          <span
                            class="inline-flex items-center px-1 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800"
                          >
                            命中: {{ gameDataStore.skillList.find(s => s.id === displayedSkills[index])?.accuracy }}%
                          </span>
                        </div>
                      </div>
                      <div
                        class="text-xs text-gray-600 leading-relaxed break-words whitespace-normal prose prose-xs max-w-none"
                        v-html="md.render(i18next.t(`${displayedSkills[index]}.description`, { ns: 'skill' }))"
                      ></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>

    <!-- 全局操作栏 -->
    <div
      class="fixed bottom-0 left-4 right-4 z-50 md:left-1/2 md:right-auto md:transform md:-translate-x-1/2 md:max-w-fit"
    >
      <div
        class="flex items-center justify-center space-x-2 bg-white shadow-lg border border-gray-200 rounded-t-lg px-4 py-3 md:rounded-lg"
      >
        <!-- 保存按钮 - 在移动端更突出 -->
        <button
          @click="saveCurrentTeam"
          class="flex-1 md:flex-none inline-flex items-center justify-center px-4 py-2 bg-blue-600 border border-transparent rounded-lg font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors duration-200 text-sm md:px-3 md:py-1.5 md:rounded-md"
        >
          <svg class="w-4 h-4 md:w-3 md:h-3 md:mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
          </svg>
          <span class="ml-1 md:ml-0">保存</span>
        </button>

        <!-- 导出按钮 -->
        <button
          @click="handleExportTeamConfig"
          class="flex-1 md:flex-none inline-flex items-center justify-center px-3 py-2 border border-gray-300 rounded-lg font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors duration-200 text-sm md:px-3 md:py-1.5 md:rounded-md"
        >
          <svg class="w-4 h-4 md:w-3 md:h-3 md:mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <span class="ml-1 md:ml-0">导出</span>
        </button>

        <!-- 导入按钮 -->
        <button
          @click="importTeamConfig"
          class="flex-1 md:flex-none inline-flex items-center justify-center px-3 py-2 border border-gray-300 rounded-lg font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors duration-200 text-sm md:px-3 md:py-1.5 md:rounded-md"
        >
          <svg class="w-4 h-4 md:w-3 md:h-3 md:mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10"
            />
          </svg>
          <span class="ml-1 md:ml-0">导入</span>
        </button>

        <!-- 仓库管理提示 -->
        <div class="hidden md:flex items-center ml-3 pl-3 border-l border-gray-300">
          <el-tooltip content="在精灵仓库中可以管理多个队伍、复制队伍等更多功能" placement="top" :show-after="500">
            <router-link
              to="/storage"
              class="inline-flex items-center text-xs text-gray-500 hover:text-blue-600 transition-colors"
            >
              <el-icon class="mr-1" :size="12"><QuestionFilled /></el-icon>
              更多队伍管理功能
            </router-link>
          </el-tooltip>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 技能下拉框样式优化 */
:deep(.el-select-dropdown__item) {
  height: auto !important;
  min-height: 140px !important;
  padding: 0 !important;
}

/* Markdown渲染样式 */
:deep(.prose) {
  color: inherit;
}

:deep(.prose p) {
  margin: 0;
  line-height: 1.4;
}

:deep(.prose strong) {
  font-weight: 600;
  color: #374151;
}

:deep(.prose em) {
  font-style: italic;
  color: #6b7280;
}

:deep(.prose ul) {
  margin: 0.25rem 0;
  padding-left: 1rem;
}

:deep(.prose li) {
  margin: 0;
  line-height: 1.3;
}

/* 确保HTML内容不会溢出 */
:deep(.prose *) {
  max-width: 100%;
  word-wrap: break-word;
  overflow-wrap: break-word;
}
</style>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { nanoid } from 'nanoid'
import { usePlayerStore } from '@/stores/player'
import { useGameDataStore } from '@/stores/gameData'
import { usePetStorageStore } from '@/stores/petStorage'

import { type PetSchemaType } from '@arcadia-eternity/schema'
import { useTranslation } from 'i18next-vue'
import { Gender, NatureMap } from '@arcadia-eternity/const'
import { Nature } from '@arcadia-eternity/const'
import { Sortable } from 'sortablejs-vue3'
import PetIcon from '@/components/PetIcon.vue'
import ElementIcon from '@/components/battle/ElementIcon.vue'
import MarkdownIt from 'markdown-it'
import { InfoFilled, FolderOpened, Close, QuestionFilled } from '@element-plus/icons-vue'
import { usePetManagement } from '@/composables/usePetManagement'
import { useTeamExport } from '@/composables/useTeamExport'

const { i18next } = useTranslation()

const playerStore = usePlayerStore()
const gameDataStore = useGameDataStore()
const petStorage = usePetStorageStore()

// 使用组合式函数
const { importTeamConfig } = usePetManagement()
const { exportTeamConfig } = useTeamExport()

// 创建markdown-it实例
const md = new MarkdownIt({
  html: true,
  linkify: false,
  typographer: false,
})

// 响应式状态
const selectedPetId = ref<string | null>(null)
const showGuide = ref(localStorage.getItem('teamBuilderGuideHidden') !== 'true') // 控制指引显示

type StatKey = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe'

const statList: StatKey[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe']

const drag = ref(false)

// 关闭指引
const hideGuide = () => {
  showGuide.value = false
  localStorage.setItem('teamBuilderGuideHidden', 'true')
}

const onStart = () => {
  drag.value = true
}

const handleDragEnd = (event: any) => {
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
      petStorage.updateTeamOrder(petStorage.currentTeamIndex, newOrder)

      // 自动保存机制
      petStorage.saveToLocal()

      // 视觉反馈
      console.log('队伍顺序已自动保存')
    } catch (error) {
      console.error('拖拽操作保存失败:', error)
      console.error('队伍顺序保存失败，请手动保存')
    }
  }
}

// 简单的验证函数
const validateTeam = () => {
  if (currentTeam.value.length < 1 || currentTeam.value.length > 6) {
    return '队伍数量必须在1到6之间'
  }

  for (const pet of currentTeam.value) {
    if (!pet.name || pet.name.length > 20) {
      return '精灵名称不能为空且不能超过20个字符'
    }
    if (!pet.species) {
      return '请为所有精灵选择种族'
    }
    if (currentEVTotal.value > 510) {
      return '学习力总和不能超过510'
    }
  }

  return null
}

// 计算属性
const currentTeam = computed<PetSchemaType[]>({
  get: () => petStorage.getCurrentTeam(),
  set: newOrder => {
    petStorage.updateTeamOrder(petStorage.currentTeamIndex, newOrder)
  },
})

const currentTeamName = computed(() => {
  return petStorage.teams[petStorage.currentTeamIndex]?.name || '未知队伍'
})

const selectedPet = computed<PetSchemaType | null>(() => {
  return currentTeam.value.find(p => p.id === selectedPetId.value) || null
})

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

const filteredSkills = computed(() => {
  if (!currentSpecies.value) return []

  return currentSpecies.value.learnable_skills
    .filter(learnable => (selectedPet.value?.level ?? 0) >= learnable.level)
    .map(learnable => gameDataStore.skillList.find(v => v.id === learnable.skill_id))
    .filter(Boolean)
})

const statChineseMap: Record<StatKey, string> = {
  hp: '体力',
  atk: '攻击',
  def: '防御',
  spa: '特攻',
  spd: '特防',
  spe: '速度',
}

const genderChineseMap: Record<Gender, string> = {
  [Gender.Male]: '雄性',
  [Gender.Female]: '雌性',
  [Gender.NoGender]: '无性别',
}

const natureChineseMap: Record<Nature, string> = {
  [Nature.Adamant]: '固执',
  [Nature.Bashful]: '害羞',
  [Nature.Bold]: '大胆',
  [Nature.Brave]: '勇敢',
  [Nature.Calm]: '冷静',
  [Nature.Careful]: '慎重',
  [Nature.Docile]: '坦率',
  [Nature.Gentle]: '温和',
  [Nature.Hardy]: '勤奋',
  [Nature.Hasty]: '急躁',
  [Nature.Impish]: '淘气',
  [Nature.Jolly]: '爽朗',
  [Nature.Lax]: '乐天',
  [Nature.Lonely]: '怕寂寞',
  [Nature.Mild]: '温和',
  [Nature.Modest]: '内敛',
  [Nature.Naive]: '天真',
  [Nature.Naughty]: '顽皮',
  [Nature.Quiet]: '冷静',
  [Nature.Quirky]: '古怪',
  [Nature.Rash]: '马虎',
  [Nature.Relaxed]: '悠闲',
  [Nature.Sassy]: '自大',
  [Nature.Serious]: '认真',
  [Nature.Timid]: '胆小',
}

const displayedSkills = computed({
  get: () => {
    return Array.from({ length: 5 }, (_, i) => selectedPet.value?.skills[i] || '')
  },
  set: newValues => {
    if (!selectedPet.value) return

    // 保留所有位置，空字符串转为undefined后过滤
    selectedPet.value.skills = newValues.map(s => s || undefined).filter((s): s is string => s !== undefined)
  },
})

// 新的下拉框选项计算属性
const speciesOptions = computed(() => {
  const options = gameDataStore.speciesList.map(species => ({
    value: species.id,
    label: i18next.t(`${species.id}.name`, { ns: 'species' }),
    num: species.num,
    element: species.element,
  }))
  options.sort((a, b) => a.num - b.num)
  return options
})

const genderOptions = computed(() => {
  return Object.values(Gender).map(gender => ({
    value: gender,
    label: genderChineseMap[gender as Gender],
    icon: gender === Gender.Male ? '♂' : gender === Gender.Female ? '♀' : '⚲',
  }))
})

const abilitySelectOptions = computed(() => {
  if (!selectedPet.value) return []
  const currentAblity = selectedPet.value.ability
  return filteredAbility.value
    .filter(ability => !!ability)
    .map(ability => ({
      value: ability.id,
      label: i18next.t(`${ability.id}.name`, {
        ns: ['mark', 'mark_ability', 'mark_emblem', 'mark_global'],
      }),
      description: i18next.t(`${ability.id}.description`, {
        ns: ['mark', 'mark_ability', 'mark_emblem', 'mark_global'],
      }),
      disabled: currentAblity === ability.id,
    }))
})

const emblemSelectOptions = computed(() => {
  if (!selectedPet.value) return []
  const currentElblem = selectedPet.value.emblem
  return filteredElblem.value
    .filter(elblem => !!elblem)
    .map(elblem => ({
      value: elblem.id,
      label: i18next.t(`${elblem.id}.name`, { ns: ['mark', 'mark_ability', 'mark_emblem', 'mark_global'] }),
      description: i18next.t(`${elblem.id}.description`, {
        ns: ['mark', 'mark_ability', 'mark_emblem', 'mark_global'],
      }),
      disabled: currentElblem === elblem.id,
    }))
})

const natureSelectOptions = computed(() => {
  return Object.values(Nature).map(nature => ({
    value: nature,
    label: natureChineseMap[nature],
    effects: NatureMap[nature],
  }))
})

const skillSelectOptions = computed(() => {
  const currentSkills = displayedSkills.value.filter(s => s)
  return filteredSkills.value
    .filter(skill => !!skill)
    .map(skill => ({
      value: skill.id,
      label: i18next.t(`${skill.id}.name`, { ns: 'skill' }),
      description: i18next.t(`${skill.id}.description`, { ns: 'skill' }),
      element: skill.element,
      power: skill.power,
      category: skill.category,
      rage: skill.rage,
      accuracy: skill.accuracy,
      disabled: currentSkills.includes(skill.id),
    }))
})

const addNewPet = () => {
  if (currentTeam.value.length >= 6) {
    ElMessage.warning('队伍已满，最多只能添加六个精灵')
    return
  }

  const newPet: PetSchemaType = {
    id: nanoid(),
    name: '迪兰特',
    species: 'pet_dilante',
    level: 100,
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    skills: [
      gameDataStore.skillList.find(
        s =>
          s.category === 'Climax' &&
          currentSpecies.value?.learnable_skills?.some((ls: { skill_id: string }) => ls.skill_id === s.id),
      )?.id || 'skill_paida',
    ],
    gender: Gender.Male,
    nature: Nature.Adamant,
    ability: 'mark_ability_zhongjie',
    emblem: 'mark_emblem_zhuiji',
  }

  // 先添加到仓库再移动到队伍
  petStorage.addToStorage(newPet)
  petStorage.moveToTeam(newPet.id, petStorage.currentTeamIndex)
  selectedPetId.value = newPet.id
  handleSpeciesChange(newPet.species)
}

const removePet = (petId: string) => {
  if (currentTeam.value.length <= 1) {
    ElMessage.warning('队伍中至少需要保留一个精灵')
    return
  }
  petStorage.moveToPC(petId)
}

const saveCurrentTeam = () => {
  const error = validateTeam()
  if (error) {
    ElMessage.error(error)
    return
  }

  try {
    petStorage.saveToLocal()
    ElMessage.success('队伍保存成功')
  } catch (err) {
    ElMessage.error('保存失败，请检查数据')
  }
}

const handleSpeciesChange = (newSpeciesId: string) => {
  if (!selectedPet.value) return

  // 获取新的种族数据
  const species = gameDataStore.getSpecies(newSpeciesId)
  if (!species) return

  petStorage.$patch(state => {
    const pet = state.teams[state.currentTeamIndex].pets.find(p => p.id === selectedPetId.value)
    if (pet) {
      pet.skills = []
      // 只有当该种族有climax技能时才优先选择
      const hasClimax = species.learnable_skills?.some(
        (ls: { skill_id: string }) =>
          gameDataStore.skillList.find((s: { id: string }) => s.id === ls.skill_id)?.category === 'Climax',
      )

      if (hasClimax) {
        const climaxSkill = species.learnable_skills.find(
          (ls: { skill_id: string }) =>
            gameDataStore.skillList.find((s: { id: string }) => s.id === ls.skill_id)?.category === 'Climax',
        )
        pet.skills.push(climaxSkill?.skill_id || species.learnable_skills[0]?.skill_id)
      } else {
        pet.skills.push(species.learnable_skills[0]?.skill_id)
      }
      pet.name = i18next.t(`${species.id}.name`, {
        ns: 'species',
      })
      pet.evs = {
        hp: 0,
        atk: 0,
        def: 0,
        spa: 0,
        spd: 0,
        spe: 0,
      }
      pet.ability = species.ability[0] ?? undefined
      pet.emblem = undefined
      if (!species.genderRatio) {
        pet.gender = Gender.NoGender
      } else {
        pet.gender = species.genderRatio[0] > 0 ? Gender.Female : Gender.Male
      }

      pet.height = species.heightRange[1]
      pet.weight = species.weightRange[1]
    }
  })
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

const computedStats = computed(() => {
  if (!selectedPet.value || !currentSpecies.value) return {} as Record<StatKey, number>

  const stats: Record<StatKey, number> = {
    hp: 0,
    atk: 0,
    def: 0,
    spa: 0,
    spd: 0,
    spe: 0,
  }

  const level = selectedPet.value.level
  const baseStats = currentSpecies.value.baseStats
  const nature = selectedPet.value.nature // 从宠物数据获取性格

  // HP计算
  stats.hp = Math.floor(
    ((2 * baseStats.hp + selectedPet.value.ivs.hp + Math.floor(selectedPet.value.evs.hp / 4)) * level) / 100 +
      level +
      10,
  )

  // 其他属性计算
  const otherStats: Exclude<StatKey, 'hp'>[] = ['atk', 'def', 'spa', 'spd', 'spe']
  otherStats.forEach(stat => {
    const base = Math.floor(
      ((2 * baseStats[stat] + selectedPet.value!.ivs[stat] + Math.floor(selectedPet.value!.evs[stat] / 4)) * level) /
        100 +
        5,
    )

    // 应用性格修正
    const natureMultiplier = getNatureMultiplier(nature, stat)
    stats[stat] = Math.floor(base * natureMultiplier)
  })

  return stats
})

// 添加性格修正映射
const getNatureMultiplier = (nature: Nature, stat: Exclude<StatKey, 'hp'>): number => {
  return NatureMap[nature]?.[stat] ?? 1.0
}

const debouncedSave = debounce(() => {
  if (!selectedPet.value) return

  try {
    petStorage.saveToLocal()
  } catch (err) {
    ElMessage.error('自动保存失败')
  }
}, 100)

watch(
  () => ({
    skills: selectedPet.value?.skills,
    evs: selectedPet.value?.evs,
    ability: selectedPet.value?.ability,
    emblem: selectedPet.value?.emblem,
  }),
  (newVal, oldVal) => {
    if (JSON.stringify(newVal) !== JSON.stringify(oldVal)) {
      debouncedSave()
    }
  },
  { deep: true },
)

const handleSkillChange = (newVal: string, index: number) => {
  const newSkills = [...displayedSkills.value]
  let value = newVal ?? ''

  // 检查重复技能
  if (value && newSkills.filter(s => s === value).length > 1) {
    ElMessage.warning('该技能已存在于其他槽位')
    newSkills[index] = ''
    displayedSkills.value = newSkills
    return
  }

  // 检查当前队伍中Climax技能的数量
  let currentClimaxCount = newSkills.filter(skillId => {
    const skill = gameDataStore.skillList.find(s => s.id === skillId)
    return skill?.category === 'Climax'
  }).length

  // 如果当前修改的技能槽位是Climax技能，在计算总数时先减去
  const currentSkill = gameDataStore.skillList.find(s => s.id === displayedSkills.value[index])
  if (currentSkill?.category === 'Climax') {
    currentClimaxCount--
  }

  // 种族是否拥有Climax技能
  const hasClimax = currentSpecies.value?.learnable_skills?.some(
    ls => gameDataStore.skillList.find(s => s.id === ls.skill_id)?.category === 'Climax',
  )

  if (hasClimax) {
    // 尝试移除最后一个Climax技能
    if (value === '' && currentClimaxCount === 0 && currentSkill?.category === 'Climax') {
      ElMessage.warning('必须保留一个必杀技')
      return
    }

    // 尝试添加新的Climax技能，但队伍中已经存在一个
    const newSkill = gameDataStore.skillList.find(s => s.id === value)
    if (newSkill?.category === 'Climax' && currentClimaxCount >= 1) {
      ElMessage.warning('队伍中只能存在一个必杀技')
      return
    }

    // 自动设置第一个可用的Climax技能（仅当没有时）
    if (currentClimaxCount === 0 && value === '') {
      const firstClimax = currentSpecies.value?.learnable_skills
        ?.map((ls: { skill_id: string }) => gameDataStore.skillList.find((s: { id: string }) => s.id === ls.skill_id))
        ?.find((s?: { category: string }) => s?.category === 'Climax')

      if (firstClimax) {
        newSkills[index] = firstClimax.id
        value = firstClimax.id
      }
    }
  }

  // 更新指定位置的值
  newSkills[index] = value
  displayedSkills.value = newSkills
  debouncedSave()
}

function debounce(fn: Function, delay: number) {
  let timer: ReturnType<typeof setTimeout> | null = null
  return function (this: any, ...args: any[]) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn.apply(this, args), delay)
  }
}

// 导出队伍配置的包装函数
const handleExportTeamConfig = () => {
  exportTeamConfig(currentTeam.value)
}

// 导入和导出函数已移动到组合式函数中
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
  background: #c8ebfb;
}

.sortable-chosen {
  cursor: grabbing;
}

.sortable-drag {
  opacity: 0.8;
  transform: rotate(2deg);
}

/* 学习力滑块样式 */
.slider {
  background: linear-gradient(to right, #3b82f6 0%, #3b82f6 var(--value, 0%), #e5e7eb var(--value, 0%), #e5e7eb 100%);
}

.slider::-webkit-slider-thumb {
  appearance: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #3b82f6;
  cursor: pointer;
  border: 2px solid white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.slider::-moz-range-thumb {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #3b82f6;
  cursor: pointer;
  border: 2px solid white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

/* 过渡动画 */
.pet-list-move,
.pet-list-enter-active,
.pet-list-leave-active {
  transition: all 0.3s ease;
}

.pet-list-enter-from,
.pet-list-leave-to {
  opacity: 0;
  transform: translateX(30px);
}

.pet-list-leave-active {
  position: absolute;
}

/* 操作栏样式优化 */
.fixed.bottom-0 {
  box-shadow:
    0 -4px 6px -1px rgba(0, 0, 0, 0.1),
    0 -2px 4px -1px rgba(0, 0, 0, 0.06);
}

/* 响应式网格调整 */
@media (max-width: 1024px) {
  .lg\:col-span-3 {
    grid-column: span 12 / span 12;
  }

  .lg\:col-span-9 {
    grid-column: span 12 / span 12;
  }
}

/* Element Plus 虚拟下拉框样式优化 */
:deep(.el-select-v2__wrapper) {
  width: 100% !important;
}

:deep(.el-select-dropdown__item) {
  height: auto !important;
  min-height: 34px;
  padding: 0 !important;
}

:deep(.el-select-dropdown__item.is-hovering) {
  background-color: #f5f7fa;
}

:deep(.el-select-dropdown__item.is-selected) {
  background-color: #ecf5ff;
  color: #409eff;
}

/* 确保文本不会被截断 */
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
