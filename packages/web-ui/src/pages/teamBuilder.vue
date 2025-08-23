<template>
  <!-- 加载界面 -->
  <div v-if="!isInitialized" class="min-h-screen bg-gray-50 flex items-center justify-center">
    <div class="text-center">
      <div class="mb-4">
        <el-icon class="animate-spin text-4xl text-blue-500" :size="48">
          <Loading />
        </el-icon>
      </div>
      <h2 class="text-xl font-semibold text-gray-700 mb-2">正在初始化队伍编辑器</h2>
      <p class="text-gray-500">{{ loadingMessage }}</p>
    </div>
  </div>

  <!-- 主要内容 -->
  <div v-else class="min-h-screen bg-gray-50">
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
          <div class="flex items-center space-x-3">
            <button
              @click="clearAllData"
              class="inline-flex items-center px-3 py-2 border border-red-300 text-sm font-medium rounded-md text-red-700 bg-white hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
            >
              <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
              清理所有数据
            </button>
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

    <!-- 队伍规则验证状态 -->
    <div class="max-w-7xl mx-auto px-2 sm:px-4 lg:px-6 pt-3">
      <!-- 验证中状态 -->
      <div v-if="isValidating" class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-3">
        <div class="flex items-center space-x-3">
          <div class="flex-shrink-0">
            <el-icon class="text-blue-600 animate-spin" :size="20"><Loading /></el-icon>
          </div>
          <div class="flex-1">
            <h3 class="text-sm font-medium text-blue-800">正在验证队伍</h3>
            <p class="text-sm text-blue-700">正在检查队伍是否符合规则要求...</p>
          </div>
        </div>
      </div>

      <!-- 验证成功状态 -->
      <div v-else-if="teamValidationResult.isValid" class="bg-green-50 border border-green-200 rounded-lg p-4 mb-3">
        <div class="flex items-center space-x-3">
          <div class="flex-shrink-0">
            <el-icon class="text-green-600" :size="20"><SuccessFilled /></el-icon>
          </div>
          <div class="flex-1">
            <h3 class="text-sm font-medium text-green-800">队伍验证通过</h3>
            <p class="text-sm text-green-700">当前队伍符合所选游戏模式的所有规则要求</p>
          </div>
        </div>
        <!-- 显示警告信息（如果有） -->
        <div v-if="teamValidationResult.warnings.length > 0" class="mt-3 pt-3 border-t border-green-200">
          <h4 class="text-xs font-medium text-green-800 mb-2">建议优化：</h4>
          <ul class="space-y-1">
            <li v-for="warning in teamValidationResult.warnings" :key="warning.code" class="text-xs text-green-700">
              • {{ warning.message }}
            </li>
          </ul>
        </div>
      </div>

      <!-- 验证失败状态 -->
      <div v-else class="bg-red-50 border border-red-200 rounded-lg p-4 mb-3">
        <div class="flex items-start space-x-3">
          <div class="flex-shrink-0">
            <el-icon class="text-red-600" :size="20"><WarningFilled /></el-icon>
          </div>
          <div class="flex-1">
            <div class="flex items-center justify-between mb-2">
              <h3 class="text-sm font-medium text-red-800">队伍不符合规则要求</h3>
              <div class="flex items-center space-x-2">
                <button
                  v-if="canAutoFix"
                  @click="handleAutoFix"
                  class="inline-flex items-center px-2 py-1 border border-red-300 text-xs font-medium rounded text-red-700 bg-white hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors"
                >
                  <el-icon class="mr-1" :size="12"><Tools /></el-icon>
                  自动修复
                </button>
                <button
                  @click="showValidationDetails = !showValidationDetails"
                  class="inline-flex items-center px-2 py-1 border border-red-300 text-xs font-medium rounded text-red-700 bg-white hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors"
                >
                  <el-icon class="mr-1" :size="12">
                    <ArrowDown v-if="!showValidationDetails" />
                    <ArrowUp v-else />
                  </el-icon>
                  {{ showValidationDetails ? '收起' : '详情' }}
                </button>
              </div>
            </div>
            <p class="text-sm text-red-700 mb-3">发现 {{ teamValidationResult.errors.length }} 个问题需要解决</p>

            <!-- 错误详情列表 -->
            <div v-if="showValidationDetails" class="space-y-2">
              <div
                v-for="(error, index) in teamValidationResult.errors"
                :key="`${getErrorCode(error)}-${index}`"
                class="bg-white border border-red-200 rounded-md p-3 cursor-pointer hover:bg-red-50 transition-colors"
                @click="handleErrorClick(error)"
              >
                <div class="flex items-start space-x-2">
                  <el-icon class="text-red-500 mt-0.5" :size="14">
                    <component :is="getErrorIcon(getErrorType(error))" />
                  </el-icon>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-red-800">{{ error.message }}</p>
                    <div v-if="getErrorObjectId(error) || getErrorContext(error)" class="mt-1 text-xs text-red-600">
                      <span v-if="getErrorObjectId(error)">
                        相关精灵: {{ getPetNameById(getErrorObjectId(error)!) || getErrorObjectId(error) }}
                      </span>
                      <span
                        v-if="getErrorContext(error) && Object.keys(getErrorContext(error)).length > 0"
                        class="ml-2"
                      >
                        {{ formatErrorContext(getErrorContext(error)) }}
                      </span>
                    </div>
                  </div>
                  <el-icon class="text-red-400" :size="12"><ArrowRight /></el-icon>
                </div>
              </div>
            </div>
          </div>
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
              <!-- 游戏模式选择器 -->
              <div class="mb-3">
                <label class="block text-xs font-medium text-gray-700 mb-1">游戏模式</label>
                <el-select
                  v-model="selectedGameMode"
                  @change="onGameModeChange"
                  size="small"
                  class="w-full"
                  placeholder="选择游戏模式"
                >
                  <el-option v-for="mode in availableGameModes" :key="mode.id" :label="mode.name" :value="mode.id">
                    <div>
                      <div class="font-medium">{{ mode.name }}</div>
                      <div class="text-xs text-gray-500">{{ mode.description }}</div>
                      <div class="text-xs text-gray-400 flex items-center mt-1">
                        {{ mode.ruleCount }} 条规则
                        <RuleSetTooltip :rule-set-id="mode.id" />
                      </div>
                    </div>
                  </el-option>
                </el-select>
              </div>

              <div class="flex items-center justify-between">
                <div>
                  <h2 class="text-base font-medium text-gray-900">当前队伍</h2>
                  <p class="text-xs text-gray-500 mt-1">{{ currentTeam.length }}/6 只精灵</p>
                </div>
                <el-tooltip content="使用教程" placement="left" :show-after="500" class="md:hidden">
                  <button
                    @click="showHelp = true"
                    class="flex items-center justify-center w-8 h-8 text-gray-400 hover:text-blue-600 transition-colors"
                  >
                    <el-icon :size="16"><InfoFilled /></el-icon>
                  </button>
                </el-tooltip>
              </div>
              <!-- 拖拽提示 -->
              <div
                v-if="currentTeam.length > 1 && showDragTip"
                class="mt-2 p-2 bg-blue-50 rounded-md border border-blue-200"
              >
                <div class="flex items-start space-x-2">
                  <el-icon class="text-blue-600 mt-0.5 flex-shrink-0" :size="14">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path
                        d="M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm-2-8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"
                      />
                    </svg>
                  </el-icon>
                  <div class="flex-1">
                    <p class="text-xs text-blue-700 leading-relaxed">
                      可拖拽精灵调整出战顺序，<span class="font-medium">第一位为首发精灵</span>
                    </p>
                  </div>
                  <button
                    @click="hideDragTip"
                    class="flex-shrink-0 p-0.5 rounded-full text-blue-400 hover:text-blue-600 hover:bg-blue-100 transition-colors"
                    title="关闭提示"
                  >
                    <el-icon :size="12"><Close /></el-icon>
                  </button>
                </div>
              </div>

              <!-- 排序锁控件 -->
              <div v-if="currentTeam.length > 1" class="mt-2 flex items-center justify-between">
                <div class="flex items-center space-x-2">
                  <el-icon :size="14" class="text-gray-500">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path
                        v-if="sortLocked"
                        d="M18,8A2,2 0 0,1 20,10V20A2,2 0 0,1 18,22H6A2,2 0 0,1 4,20V10A2,2 0 0,1 6,8H7V6A5,5 0 0,1 12,1A5,5 0 0,1 17,6V8H18M12,3A3,3 0 0,0 9,6V8H15V6A3,3 0 0,0 12,3Z"
                      />
                      <path
                        v-else
                        d="M18,8A2,2 0 0,1 20,10V20A2,2 0 0,1 18,22H6A2,2 0 0,1 4,20V10C4,8.89 4.9,8 6,8H7V6A5,5 0 0,1 12,1A5,5 0 0,1 17,6V8H18M12,3A3,3 0 0,0 9,6V8H15V6A3,3 0 0,0 12,3M6,10V20H18V10H6Z"
                      />
                    </svg>
                  </el-icon>
                  <span class="text-xs text-gray-600">排序锁</span>
                </div>
                <el-switch
                  v-model="sortLocked"
                  size="small"
                  :active-text="sortLocked ? '已锁定' : ''"
                  :inactive-text="!sortLocked ? '可拖拽' : ''"
                  active-color="#ef4444"
                  inactive-color="#10b981"
                />
              </div>
            </div>

            <div class="p-3 space-y-2">
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
                      <div class="flex items-center space-x-1">
                        <!-- 设置首发按钮 -->
                        <button
                          @click.stop="setAsStarter(pet.id)"
                          class="md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-200 p-1 rounded-full text-gray-400 hover:text-green-500 hover:bg-green-50"
                          title="设置为首发"
                        >
                          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                              d="M11 3L5 9h4v8h4V9h4l-6-6z"
                            />
                          </svg>
                        </button>
                        <!-- 移入仓库按钮 -->
                        <button
                          @click.stop="handleMoveToStorage(pet.id)"
                          class="md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-200 p-1 rounded-full text-gray-400 hover:text-blue-500 hover:bg-blue-50"
                          title="移入仓库"
                        >
                          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                              d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                            />
                          </svg>
                        </button>
                        <!-- 删除按钮 -->
                        <button
                          @click.stop="handleDeletePet(pet.id)"
                          class="md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-200 p-1 rounded-full text-gray-400 hover:text-red-500 hover:bg-red-50"
                          title="永久删除"
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
              <div class="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                <h3 class="text-base font-medium text-gray-900">基础信息</h3>
                <div>
                  <button
                    @click="setAsStarter(selectedPet.id)"
                    class="inline-flex items-center px-2 py-1 text-xs font-medium text-green-600 bg-green-100 rounded hover:bg-green-200 transition-colors"
                  >
                    <el-icon class="mr-1" :size="12"><StarFilled /></el-icon>
                    设置首发
                  </button>
                  <button
                    @click="handleMoveToStorage(selectedPet.id)"
                    class="ml-2 inline-flex items-center px-2 py-1 text-xs font-medium text-gray-600 bg-gray-100 rounded hover:bg-gray-200 transition-colors"
                  >
                    <el-icon class="mr-1" :size="12"><FolderOpened /></el-icon>
                    移入仓库
                  </button>
                  <button
                    @click="handleDeletePet(selectedPet.id)"
                    class="ml-2 inline-flex items-center px-2 py-1 text-xs font-medium text-red-600 bg-red-100 rounded hover:bg-red-200 transition-colors"
                  >
                    <el-icon class="mr-1" :size="12"><Delete /></el-icon>
                    永久删除
                  </button>
                </div>
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
                <p class="text-xs text-gray-500 mt-1">最多可配置4个普通技能和1个必杀技能</p>
              </div>
              <div class="p-4">
                <!-- 普通技能配置 -->
                <div class="mb-6">
                  <h4 class="text-sm font-medium text-gray-800 mb-3">普通技能 (最多4个)</h4>
                  <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div v-for="(_, index) in 4" :key="`normal-${index}`" class="space-y-2">
                      <label class="block text-xs font-medium text-gray-700">
                        普通技能 {{ index + 1 }}
                        <span v-if="index === 0" class="text-red-500">*</span>
                      </label>
                      <el-select-v2
                        :model-value="displayedNormalSkills[index]"
                        @update:model-value="value => handleNormalSkillChange(value, index)"
                        :options="normalSkillSelectOptions"
                        :disabled="!currentSpecies"
                        placeholder="选择普通技能"
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
                    </div>
                  </div>
                </div>

                <!-- 必杀技能配置 -->
                <div>
                  <h4 class="text-sm font-medium text-gray-800 mb-3">
                    必杀技能 {{ climaxSkillSelectOptions.length > 0 ? '(必须1个)' : '(无可用必杀技能)' }}
                  </h4>
                  <div class="max-w-md">
                    <label class="block text-xs font-medium text-gray-700 mb-2">
                      必杀技能
                      <span v-if="climaxSkillSelectOptions.length > 0" class="text-red-500">*</span>
                      <span v-else class="text-gray-400">(无)</span>
                    </label>
                    <el-select-v2
                      :model-value="displayedClimaxSkill"
                      @update:model-value="value => handleClimaxSkillChange(value)"
                      :options="climaxSkillSelectOptions"
                      :disabled="!currentSpecies || !hasClimaxSkills"
                      :placeholder="hasClimaxSkills ? '选择必杀技能' : '该种族无必杀技能'"
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
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 空队伍提示 -->
        <div class="lg:col-span-9" v-else-if="currentTeam.length === 0">
          <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
            <div class="max-w-md mx-auto">
              <svg class="mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                />
              </svg>
              <h3 class="text-lg font-medium text-gray-900 mb-2">队伍为空</h3>
              <p class="text-gray-500 mb-6">当前队伍中没有精灵。您可以添加新的精灵，或者从仓库中移入精灵来组建队伍。</p>
              <div class="flex flex-col sm:flex-row gap-3 justify-center">
                <button
                  @click="addNewPet"
                  class="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                    />
                  </svg>
                  添加新精灵
                </button>
                <router-link
                  to="/storage"
                  class="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                    />
                  </svg>
                  前往仓库
                </router-link>
              </div>
            </div>
          </div>
        </div>

        <!-- 未选中精灵提示 -->
        <div class="lg:col-span-9" v-else>
          <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
            <div class="max-w-md mx-auto">
              <svg class="mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M7 4V2a1 1 0 011-1h4a1 1 0 011 1v2h4a1 1 0 011 1v2a1 1 0 01-1 1h-1v9a2 2 0 01-2 2H8a2 2 0 01-2-2V8H5a1 1 0 01-1-1V5a1 1 0 011-1h2z"
                />
              </svg>
              <h3 class="text-lg font-medium text-gray-900 mb-2">请选择精灵</h3>
              <p class="text-gray-500">请从左侧队伍列表中选择一个精灵来查看和编辑其详细信息。</p>
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
          <el-tooltip content="查看使用教程" placement="top" :show-after="500">
            <button
              @click="showHelp = true"
              class="inline-flex items-center text-xs text-gray-500 hover:text-blue-600 transition-colors"
            >
              <el-icon class="mr-1" :size="12"><InfoFilled /></el-icon>
              使用教程
            </button>
          </el-tooltip>
        </div>
      </div>
    </div>
    <!-- 帮助对话框 -->
    <div v-if="showHelp" class="fixed inset-0 z-[9998] overflow-y-auto" @click="showHelp = false">
      <div class="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
        <div class="fixed inset-0 bg-black/50 transition-opacity"></div>

        <span class="hidden sm:inline-block sm:align-middle sm:h-screen">&#8203;</span>

        <div
          class="relative inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full z-10"
          @click.stop
        >
          <div class="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
            <div class="flex items-center justify-between mb-4">
              <h3 class="text-lg font-medium text-gray-900">使用帮助</h3>
              <button @click="showHelp = false" class="text-gray-400 hover:text-gray-500">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div class="space-y-4 text-sm text-gray-600">
              <div>
                <h4 class="font-medium text-gray-900 mb-2">队伍操作</h4>
                <ul class="space-y-1 list-disc list-inside">
                  <li>拖拽左侧列表中的精灵可以调整出战顺序。</li>
                  <li>点击“添加精灵”按钮可以向当前队伍中添加新的精灵。</li>
                  <li>在精灵卡片上，可以将精灵移入仓库或永久删除。</li>
                </ul>
              </div>
              <div>
                <h4 class="font-medium text-gray-900 mb-2">配置精灵</h4>
                <ul class="space-y-1 list-disc list-inside">
                  <li>在右侧配置区域，可以修改精灵的名称、种族、等级、性别等基础信息。</li>
                  <li>通过滑块和输入框精确调整精灵的能力值（学习力、个体值）。</li>
                  <li>为精灵选择合适的技能，包括普通技能和必杀技能。</li>
                </ul>
              </div>
              <div>
                <h4 class="font-medium text-gray-900 mb-2">数据管理</h4>
                <ul class="space-y-1 list-disc list-inside">
                  <li>点击“保存”按钮，可以将当前队伍的修改保存到本地。</li>
                  <li>使用“导出”和“导入”功能，可以方便地备份和分享你的队伍配置。</li>
                  <li>在仓库管理页面，可以管理多个队伍和所有未编队的精灵。</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.touch-panning-y .drag-handle {
  touch-action: pan-y;
}

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
import { ref, computed, watch, nextTick, onMounted, watchEffect, markRaw } from 'vue'
import { nanoid } from 'nanoid'
import { useDebounceFn } from '@vueuse/core'
import { usePlayerStore } from '@/stores/player'
import { useGameDataStore } from '@/stores/gameData'
import { usePetStorageStore } from '@/stores/petStorage'
import { useValidationStore } from '@/stores/validation'

import { type PetSchemaType } from '@arcadia-eternity/schema'
import { useTranslation } from 'i18next-vue'
import { Gender, NatureMap } from '@arcadia-eternity/const'
import { Nature } from '@arcadia-eternity/const'
import { Sortable } from 'sortablejs-vue3'
import PetIcon from '@/components/PetIcon.vue'
import ElementIcon from '@/components/battle/ElementIcon.vue'
import RuleSetTooltip from '@/components/RuleSetTooltip.vue'
import MarkdownIt from 'markdown-it'
import {
  InfoFilled,
  FolderOpened,
  Close,
  SuccessFilled,
  WarningFilled,
  ArrowDown,
  ArrowUp,
  ArrowRight,
  Tools,
  Loading,
  StarFilled,
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { usePetManagement } from '@/composition/usePetManagement'
import { useTeamExport } from '@/composition/useTeamExport'
import { useMobile } from '@/composition/useMobile'

const { i18next } = useTranslation()

const playerStore = usePlayerStore()
const gameDataStore = useGameDataStore()
const petStorage = usePetStorageStore()
const validationStore = useValidationStore()

// 使用组合式函数
const { importTeamConfig, moveToStorage, deletePet } = usePetManagement()
const { exportTeamConfig } = useTeamExport()

// 创建markdown-it实例
const md = new MarkdownIt({
  html: true,
  linkify: false,
  typographer: false,
})

// 移动端检测
const { isMobile } = useMobile()

// 响应式状态
const selectedPetId = ref<string | null>(null)
const showGuide = ref(localStorage.getItem('teamBuilderGuideHidden') !== 'true') // 控制指引显示
const showDragTip = ref(localStorage.getItem('teamBuilderDragTipHidden') !== 'true') // 控制拖拽提示显示
const showValidationDetails = ref(false) // 控制验证详情显示
const showHelp = ref(false) // 控制帮助对话框显示

// 排序锁状态 - PC端默认关闭，移动端默认开启
const sortLocked = ref(isMobile.value)

type StatKey = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe'

const statList: StatKey[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe']

const drag = ref(false)

// 游戏模式相关 - 使用 validation store
const availableGameModes = computed(() => validationStore.availableRuleSets)

// 初始化规则集
onMounted(async () => {
  // 初始化验证系统
  await validationStore.initialize()

  // 初始化时同步当前队伍的规则集
  const currentRuleSetId = petStorage.getCurrentTeamRuleSetId()
  validationStore.setSelectedRuleSet(currentRuleSetId)
})

// 监听队伍切换，同步规则集
watch(
  () => petStorage.currentTeamIndex,
  newIndex => {
    // 当切换队伍时，同步该队伍的规则集
    const ruleSetId = petStorage.getTeamRuleSetId(newIndex)
    validationStore.setSelectedRuleSet(ruleSetId)
    console.log(`切换到队伍 ${newIndex + 1}，规则集: ${ruleSetId}`)
  },
)

// 当前队伍的规则集（与队伍绑定）
const selectedGameMode = computed({
  get: () => petStorage.getCurrentTeamRuleSetId(),
  set: (newRuleSetId: string) => {
    petStorage.updateTeamRuleSetId(petStorage.currentTeamIndex, newRuleSetId)
    validationStore.setSelectedRuleSet(newRuleSetId)
  },
})

// 规则集变更处理
const onGameModeChange = async (ruleSetId: string) => {
  try {
    // 通过computed属性的setter更新规则集，这会自动保存到队伍数据中
    selectedGameMode.value = ruleSetId

    console.log(`规则集已切换为: ${ruleSetId}`)

    // 重新验证当前队伍
    const error = await validateTeam()
    if (error) {
      const ruleSetName = ruleSetId === 'competitive_ruleset' ? '竞技规则' : '休闲规则'
      ElMessage.warning(`切换到${ruleSetName}后，当前队伍不符合规则: ${error}`)
    }
  } catch (error) {
    console.error('切换规则集失败:', error)
    ElMessage.error('切换规则集失败')
  }
}

// 关闭指引
const hideGuide = () => {
  showGuide.value = false
  localStorage.setItem('teamBuilderGuideHidden', 'true')
}

// 关闭拖拽提示
const hideDragTip = () => {
  showDragTip.value = false
  localStorage.setItem('teamBuilderDragTipHidden', 'true')
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

// 使用规则系统的验证函数
const validateTeam = async () => {
  try {
    const validation = await validationStore.validateTeam(currentTeam.value)

    if (!validation.isValid) {
      // 返回第一个错误信息
      return validation.errors[0] || '队伍验证失败'
    }

    return null
  } catch (error) {
    console.error('队伍验证出错:', error)
    // 如果规则系统出错，回退到简单验证
    if (currentTeam.value.length > 6) {
      return '队伍数量不能超过6个'
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
}

// 初始化状态检查
const isInitialized = computed(() => {
  // 检查游戏数据是否加载完成
  if (!gameDataStore.loaded) {
    return false
  }

  // 检查petStorage是否已初始化
  if (!petStorage.initialized) {
    return false
  }

  // 检查验证系统是否准备就绪
  if (!validationStore.isInitialized) {
    return false
  }

  return true
})

const loadingMessage = computed(() => {
  if (!gameDataStore.loaded) {
    return '正在加载游戏数据...'
  }

  if (!petStorage.initialized) {
    return '正在加载队伍数据...'
  }

  if (validationStore.isLoading) {
    return '正在初始化规则系统...'
  }

  if (!validationStore.isInitialized) {
    return '正在初始化规则系统...'
  }

  return '初始化完成'
})

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

// 响应式的验证结果
interface ValidationError {
  type: string
  code: string
  message: string
  objectId?: string
  objectType?: string
  context?: Record<string, any>
}

type ValidationResult = {
  isValid: boolean
  errors: ValidationError[]
  warnings: ValidationError[]
}

const teamValidationResultRef = ref<ValidationResult>({
  isValid: true,
  errors: [] as ValidationError[],
  warnings: [] as ValidationError[],
})

// 验证状态管理
const isValidating = ref(false)

// 防抖验证函数
const debouncedValidate = useDebounceFn(async () => {
  if (isValidating.value) return // 防止重复验证

  try {
    isValidating.value = true

    const ruleSetId = selectedGameMode.value
    const team = currentTeam.value

    console.log(`验证队伍 - 规则集: ${ruleSetId}, 队伍大小: ${team.length}`)

    // 检查数据是否已加载完成
    if (!gameDataStore.loaded) {
      console.log('⏳ 游戏数据尚未加载完成，跳过验证')
      teamValidationResultRef.value = {
        isValid: true,
        errors: [] as ValidationError[],
        warnings: [
          {
            type: 'info' as const,
            code: 'DATA_LOADING',
            message: '正在加载游戏数据，请稍候...',
            objectId: undefined,
            objectType: undefined,
            context: {},
          },
        ],
      }
      return
    }

    // 检查验证系统是否已初始化
    if (!validationStore.isInitialized) {
      console.log('⏳ 验证系统尚未初始化，跳过验证')
      teamValidationResultRef.value = {
        isValid: true,
        errors: [] as ValidationError[],
        warnings: [
          {
            type: 'info' as const,
            code: 'VALIDATION_LOADING',
            message: '正在初始化验证系统，请稍候...',
            objectId: undefined,
            objectType: undefined,
            context: {},
          },
        ],
      }
      return
    }

    // 使用规则集验证队伍
    const result = await validationStore.validateTeam(team)

    // 直接使用 validation store 返回的完整格式
    teamValidationResultRef.value = markRaw(result)
  } catch (error) {
    console.error('队伍验证出错:', error)
    teamValidationResultRef.value = {
      isValid: false,
      errors: [
        {
          type: 'system_error' as const,
          code: 'VALIDATION_ERROR',
          message: '验证系统出现错误，请检查队伍配置',
          objectId: undefined,
          objectType: undefined,
          context: {},
        },
      ],
      warnings: [] as ValidationError[],
    }
  } finally {
    isValidating.value = false
  }
}, 300) // 300ms防抖

// 监听队伍和规则集变化
watchEffect(
  () => {
    // 依赖于规则集和队伍数据
    // 触发防抖验证
    debouncedValidate()
  },
  {
    flush: 'post',
  },
)

// 实时队伍验证结果
const teamValidationResult = computed(() => {
  return teamValidationResultRef.value
})

// 当前精灵的验证结果
const currentPetValidationResult = ref<ValidationResult>({
  isValid: true,
  errors: [] as ValidationError[],
  warnings: [] as ValidationError[],
})

// 精灵级别的防抖验证
const debouncedValidatePet = useDebounceFn(async () => {
  if (!selectedPet.value || !gameDataStore.loaded) {
    currentPetValidationResult.value = {
      isValid: true,
      errors: [] as ValidationError[],
      warnings: [] as ValidationError[],
    }
    return
  }

  try {
    const result = await validationStore.validatePet(selectedPet.value, currentTeam.value)
    currentPetValidationResult.value = markRaw(result)
  } catch (error) {
    console.error('精灵验证出错:', error)
    currentPetValidationResult.value = {
      isValid: true, // 验证失败时不显示错误，避免干扰用户
      errors: [] as ValidationError[],
      warnings: [] as ValidationError[],
    }
  }
}, 200)

// 检查是否可以自动修复
const canAutoFix = computed(() => {
  if (teamValidationResult.value.isValid) return false

  // 检查错误类型，某些错误可以自动修复
  return teamValidationResult.value.errors.some((error: ValidationError) =>
    ['TEAM_TOO_LARGE', 'LEVEL_TOO_HIGH', 'LEVEL_TOO_LOW', 'EV_TOTAL_TOO_HIGH'].includes(getErrorCode(error)),
  )
})

const selectedPet = computed<PetSchemaType | null>(() => {
  return currentTeam.value.find(p => p.id === selectedPetId.value) || null
})

// 监听当前精灵变化，触发精灵级别验证
watch(
  () => selectedPet.value,
  () => {
    debouncedValidatePet()
  },
  { deep: true },
)

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
const extraLearnableSkills = ref<Array<{ skill_id: string; level: number; hidden: boolean }>>([])

// 加载额外技能
const loadExtraSkills = async (speciesId: string) => {
  try {
    const skills = await validationStore.getSpeciesExtraLearnableSkills(speciesId)
    extraLearnableSkills.value = markRaw(skills)
  } catch (error) {
    console.warn('获取额外技能失败:', error)
    extraLearnableSkills.value = []
  }
}

const filteredSkills = computed(() => {
  if (!currentSpecies.value) return []

  // 获取原始可学习技能
  const originalSkills = currentSpecies.value.learnable_skills.filter(
    learnable => (selectedPet.value?.level ?? 0) >= learnable.level,
  )

  // 获取规则系统提供的额外技能
  const extraSkills = extraLearnableSkills.value.filter(learnable => (selectedPet.value?.level ?? 0) >= learnable.level)

  // 合并原始技能和额外技能
  const allLearnableSkills = [...originalSkills, ...extraSkills]

  // 转换为技能对象并过滤
  return allLearnableSkills
    .map(learnable => gameDataStore.skillList.find(v => v.id === learnable.skill_id))
    .filter(Boolean)
})

// 检查当前种族是否有必杀技能
const hasClimaxSkills = computed(() => {
  if (!currentSpecies.value) return false

  // 检查原始技能中是否有必杀技能
  const hasOriginalClimax =
    currentSpecies.value.learnable_skills?.some(
      ls => gameDataStore.skillList.find(s => s.id === ls.skill_id)?.category === 'Climax',
    ) ?? false

  // 检查额外技能中是否有必杀技能
  const hasExtraClimax = extraLearnableSkills.value.some(
    ls => gameDataStore.skillList.find(s => s.id === ls.skill_id)?.category === 'Climax',
  )

  return hasOriginalClimax || hasExtraClimax
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

// 获取性格中文名称
const getNatureName = (nature: Nature): string => {
  try {
    return i18next.t(`${nature}.name`, { ns: 'nature' }) || nature
  } catch {
    return nature
  }
}

// 分离普通技能和必杀技能的计算属性
const displayedNormalSkills = computed({
  get: () => {
    if (!selectedPet.value) return ['', '', '', '']
    const normalSkills = selectedPet.value.skills.filter(skillId => {
      const skill = gameDataStore.skillList.find(s => s.id === skillId)
      return skill && skill.category !== 'Climax'
    })
    return Array.from({ length: 4 }, (_, i) => normalSkills[i] || '')
  },
  set: newValues => {
    if (!selectedPet.value) return

    // 获取当前的必杀技能
    const climaxSkill = selectedPet.value.skills.find(skillId => {
      const skill = gameDataStore.skillList.find(s => s.id === skillId)
      return skill && skill.category === 'Climax'
    })

    // 合并普通技能和必杀技能
    const normalSkills = newValues.filter(s => s)
    const allSkills = climaxSkill ? [...normalSkills, climaxSkill] : normalSkills
    selectedPet.value.skills = allSkills
  },
})

const displayedClimaxSkill = computed({
  get: () => {
    if (!selectedPet.value) return ''
    const climaxSkill = selectedPet.value.skills.find(skillId => {
      const skill = gameDataStore.skillList.find(s => s.id === skillId)
      return skill && skill.category === 'Climax'
    })
    return climaxSkill || ''
  },
  set: newValue => {
    if (!selectedPet.value) return

    // 获取当前的普通技能
    const normalSkills = selectedPet.value.skills.filter(skillId => {
      const skill = gameDataStore.skillList.find(s => s.id === skillId)
      return skill && skill.category !== 'Climax'
    })

    // 合并普通技能和必杀技能
    const allSkills = newValue ? [...normalSkills, newValue] : normalSkills
    selectedPet.value.skills = allSkills
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
      const [allowedGenders] = await Promise.all([
        validationStore.getAllowedGendersForSpecies(newSpecies),
        loadExtraSkills(newSpecies),
      ])

      allowedGendersForCurrentSpecies.value = allowedGenders

      // 如果当前选中的性别不在允许范围内，自动选择第一个允许的性别
      if (selectedPet.value && selectedPet.value.gender && !allowedGenders.includes(selectedPet.value.gender)) {
        if (allowedGenders.length > 0) {
          selectedPet.value.gender = allowedGenders[0] as Gender
        }
      }
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
    label: getNatureName(nature),
    effects: NatureMap[nature],
  }))
})

// 普通技能选项
const normalSkillSelectOptions = computed(() => {
  const currentNormalSkills = displayedNormalSkills.value.filter(s => s)
  const currentClimaxSkill = displayedClimaxSkill.value

  return filteredSkills.value
    .filter((skill): skill is NonNullable<typeof skill> => !!skill && skill.category !== 'Climax')
    .map(skill => ({
      value: skill.id,
      label: i18next.t(`${skill.id}.name`, { ns: 'skill' }),
      description: i18next.t(`${skill.id}.description`, { ns: 'skill' }),
      element: skill.element,
      power: skill.power,
      category: skill.category,
      rage: skill.rage,
      accuracy: skill.accuracy,
      disabled: currentNormalSkills.includes(skill.id) || skill.id === currentClimaxSkill,
    }))
})

// 必杀技能选项
const climaxSkillSelectOptions = computed(() => {
  const currentNormalSkills = displayedNormalSkills.value.filter(s => s)

  return filteredSkills.value
    .filter((skill): skill is NonNullable<typeof skill> => !!skill && skill.category === 'Climax')
    .map(skill => ({
      value: skill.id,
      label: i18next.t(`${skill.id}.name`, { ns: 'skill' }),
      description: i18next.t(`${skill.id}.description`, { ns: 'skill' }),
      element: skill.element,
      power: skill.power,
      category: skill.category,
      rage: skill.rage,
      accuracy: skill.accuracy,
      disabled: currentNormalSkills.includes(skill.id),
    }))
})

const addNewPet = async () => {
  // 使用规则系统检查是否可以添加更多精灵
  try {
    const canAdd = await validationStore.canAddMorePets(currentTeam.value)
    if (!canAdd) {
      const limitations = await validationStore.getRuleLimitations()
      ElMessage.warning(`队伍已满，最多只能添加${limitations.teamSize.max}个精灵`)
      return
    }
  } catch (error) {
    console.error('检查队伍大小限制出错:', error)
    // 回退到简单检查
    if (currentTeam.value.length >= 6) {
      ElMessage.warning('队伍已满，最多只能添加六个精灵')
      return
    }
  }

  const newPet: PetSchemaType = {
    id: nanoid(),
    name: '迪兰特',
    species: 'pet_dilante',
    level: 100,
    evs: { hp: 4, atk: 0, def: 0, spa: 252, spd: 0, spe: 252 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    skills: ['skill_wujindaxuanwo', 'skill_ruodianbiaoji', 'skill_feiliupubu', 'skill_yanmo'], // 4个普通技能，必杀技能会在handleSpeciesChange中自动添加
    gender: Gender.Male,
    nature: Nature.Modest,
    ability: 'mark_ability_zhongjie',
    emblem: 'mark_emblem_zhuiji',
    height: 102,
    weight: 31,
  }

  // 先添加到仓库再移动到队伍
  petStorage.addToStorage(newPet)
  petStorage.moveToTeam(newPet.id, petStorage.currentTeamIndex)
  selectedPetId.value = newPet.id
  // handleSpeciesChange(newPet.species)
}

// 移入仓库处理函数
const handleMoveToStorage = (petId: string) => {
  moveToStorage(petId, () => {
    // 如果移动的是当前选中的精灵，选择队伍中的第一个精灵
    if (selectedPetId.value === petId) {
      const remainingTeam = currentTeam.value
      selectedPetId.value = remainingTeam.length > 0 ? remainingTeam[0].id : null
    }
  })
}

// 删除精灵处理函数
const handleDeletePet = (petId: string) => {
  deletePet(petId, () => {
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
  petStorage.updateTeamOrder(petStorage.currentTeamIndex, team)
  petStorage.saveToLocal()
  
  ElMessage.success('已设置为首发精灵')
}

const saveCurrentTeam = async () => {
  const error = await validateTeam()
  if (error) {
    ElMessage.error(error)
    return
  }

  try {
    petStorage.saveToLocal()
    ElMessage.success('队伍保存成功')
  } catch {
    ElMessage.error('保存失败，请检查数据')
  }
}

const clearAllData = async () => {
  try {
    await ElMessageBox.confirm('此操作将清空所有队伍和仓库数据，无法撤销！确定要继续吗？', '清理所有数据', {
      confirmButtonText: '确定清理',
      cancelButtonText: '取消',
      type: 'warning',
      customStyle: { zIndex: '10000' },
    })

    petStorage.clearStorage()
    selectedPetId.value = null
    ElMessage.success('所有数据已清理完成！')
  } catch {
    // 用户取消操作
  }
}

// 验证相关方法
const getErrorIcon = (errorType: string) => {
  switch (errorType) {
    case 'team_validation':
      return 'UserFilled'
    case 'pet_validation':
      return 'Avatar'
    case 'skill_validation':
      return 'MagicStick'
    case 'mark_validation':
      return 'Medal'
    case 'rule_conflict':
      return 'Warning'
    case 'config_error':
      return 'Setting'
    case 'system_error':
    default:
      return 'CircleCloseFilled'
  }
}

// 错误处理辅助函数
const getErrorCode = (error: ValidationError): string => {
  return error.code || 'UNKNOWN_ERROR'
}

const getErrorType = (error: ValidationError): string => {
  return error.type || 'system_error'
}

const getErrorObjectId = (error: ValidationError): string | undefined => {
  return error.objectId
}

const getErrorContext = (error: ValidationError): Record<string, any> => {
  return error.context || {}
}

const getPetNameById = (petId: string) => {
  return currentTeam.value.find(pet => pet.id === petId)?.name
}

const formatErrorContext = (context: Record<string, any>) => {
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

const handleErrorClick = (error: ValidationError) => {
  // 如果错误关联到特定精灵，选中该精灵
  if (error.objectId) {
    const pet = currentTeam.value.find(p => p.id === error.objectId)
    if (pet) {
      selectedPetId.value = pet.id
      ElMessage.info(`已选中精灵: ${pet.name}`)
    }
  }
}

const handleAutoFix = async () => {
  try {
    const result = await validationStore.autoFixTeam(currentTeam.value)

    if (result.changes.length === 0) {
      ElMessage.info('没有需要修复的问题')
      return
    }

    // 显示修复预览
    const changeMessages = result.changes
      .map((change: any) => {
        switch (change.type) {
          case 'removed':
            return `• 移除精灵: ${change.petName} (${change.description})`
          case 'modified':
            return `• 修改精灵: ${change.petName} - ${change.description}`
          default:
            return `• ${change.description}`
        }
      })
      .join('\n')

    await ElMessageBox.confirm(`将进行以下修复操作：\n\n${changeMessages}\n\n确定要应用这些修复吗？`, '自动修复预览', {
      confirmButtonText: '应用修复',
      cancelButtonText: '取消',
      type: 'warning',
      customStyle: { zIndex: '10000' },
    })

    // 应用修复
    petStorage.updateTeamOrder(petStorage.currentTeamIndex, result.fixedTeam)
    petStorage.saveToLocal()

    ElMessage.success(`已应用 ${result.changes.length} 项修复`)

    // 如果还有剩余问题，提示用户
    if (result.remainingIssues && !result.remainingIssues.isValid) {
      ElMessage.warning(`还有 ${result.remainingIssues.errors.length} 个问题需要手动处理`)
    }
  } catch (error) {
    if (error !== 'cancel') {
      console.error('自动修复失败:', error)
      ElMessage.error('自动修复失败，请手动调整队伍')
    }
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

      // 获取可学习的普通技能和必杀技能
      const normalSkills = species.learnable_skills
        ?.filter((ls: { skill_id: string }) => {
          const skill = gameDataStore.skillList.find((s: { id: string }) => s.id === ls.skill_id)
          return skill && skill.category !== 'Climax'
        })
        ?.slice(0, 4) // 最多4个普通技能

      const climaxSkills = species.learnable_skills?.filter((ls: { skill_id: string }) => {
        const skill = gameDataStore.skillList.find((s: { id: string }) => s.id === ls.skill_id)
        return skill && skill.category === 'Climax'
      })

      // 添加普通技能
      if (normalSkills && normalSkills.length > 0) {
        pet.skills.push(...normalSkills.map(ls => ls.skill_id))
      }

      // 添加必杀技能（仅当种族有必杀技能时）
      if (climaxSkills && climaxSkills.length > 0) {
        pet.skills.push(climaxSkills[0].skill_id)
      }
      // 如果没有必杀技能，不添加任何技能到必杀技能槽
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
      pet.emblem = species.emblem[0] ?? undefined
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

const debouncedSave = useDebounceFn(() => {
  if (!selectedPet.value) return

  try {
    petStorage.saveToLocal()
    // 保存后触发验证
    debouncedValidate()
  } catch {
    ElMessage.error('自动保存失败')
  }
}, 100)

// 监听精灵属性变化，触发保存和验证
watch(
  () => ({
    skills: selectedPet.value?.skills,
    evs: selectedPet.value?.evs,
    ability: selectedPet.value?.ability,
    emblem: selectedPet.value?.emblem,
    species: selectedPet.value?.species,
    nature: selectedPet.value?.nature,
    level: selectedPet.value?.level,
  }),
  (newVal, oldVal) => {
    if (JSON.stringify(newVal) !== JSON.stringify(oldVal)) {
      debouncedSave()
    }
  },
  { deep: true },
)

// 普通技能变更处理
const handleNormalSkillChange = (newVal: string, index: number) => {
  const newSkills = [...displayedNormalSkills.value]
  const value = newVal ?? ''

  // 检查重复技能
  if (value && newSkills.filter(s => s === value).length > 1) {
    ElMessage.warning('该技能已存在于其他槽位')
    return
  }

  // 检查是否与必杀技能重复
  if (value && value === displayedClimaxSkill.value) {
    ElMessage.warning('该技能已被设置为必杀技能')
    return
  }

  newSkills[index] = value
  displayedNormalSkills.value = newSkills
  debouncedSave() // 这会触发保存和验证
}

// 必杀技能变更处理
const handleClimaxSkillChange = (newVal: string) => {
  const value = newVal ?? ''

  // 检查是否与普通技能重复
  if (value && displayedNormalSkills.value.includes(value)) {
    ElMessage.warning('该技能已被设置为普通技能')
    return
  }

  // 如果种族有必杀技能但用户试图清空，并且当前等级下有可选的必杀技能，给出警告
  if (hasClimaxSkills.value && !value && climaxSkillSelectOptions.value.length > 0) {
    ElMessage.warning('必须选择一个必杀技能')
    return
  }

  displayedClimaxSkill.value = value
  debouncedSave() // 这会触发保存和验证
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
