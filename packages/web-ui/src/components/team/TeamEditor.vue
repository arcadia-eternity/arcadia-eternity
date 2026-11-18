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
  <div v-else ref="editorRoot" class="bg-gray-50" :class="{ 'min-h-screen': !compact }">
    <!-- 头部信息栏 -->
    <header v-if="!compact" class="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-40">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="flex items-center justify-between h-16">
          <div class="flex items-center space-x-4">
            <h1 class="text-xl font-semibold text-gray-900">队伍编辑器</h1>
            <div class="min-w-0">
              <span
                class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800"
              >
                {{ delegate.subtitle?.value || currentTeamName }}
              </span>
            </div>
          </div>
          <div class="flex items-center space-x-3">
            <button
              v-if="delegate.clear"
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
              {{ delegate.clearLabel || '清空队伍' }}
            </button>
            <router-link
              v-if="delegate.storageRoute"
              :to="delegate.storageRoute"
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
    <div v-if="showGuide && delegate.storageRoute" class="max-w-7xl mx-auto px-2 sm:px-4 lg:px-6 pt-3">
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
              <router-link
                v-if="delegate.storageRoute"
                :to="delegate.storageRoute || '/'"
                class="font-medium text-blue-800 hover:text-blue-900 underline"
                >精灵仓库</router-link
              >
              中管理多个队伍，包括创建新队伍、复制队伍、导入导出队伍等功能。
            </p>
            <div class="flex flex-wrap gap-2">
              <router-link
                :to="delegate.storageRoute || '/'"
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
    <div
      v-if="!compact || !teamValidationResult.isValid || teamValidationResult.warnings.length"
      class="max-w-7xl mx-auto px-2 sm:px-4 lg:px-6 pt-3"
    >
      <!-- 验证中状态 -->
      <div v-if="isValidating" class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-3">
        <div class="flex items-center space-x-3">
          <div class="flex-shrink-0">
            <el-icon class="text-blue-600 animate-spin" :size="20"><Loading /></el-icon>
          </div>
          <div class="flex-1">
            <h3 class="text-sm font-medium text-blue-800">正在验证队伍</h3>
            <p class="text-sm text-blue-700">正在检查队伍...</p>
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
            <p class="text-sm text-green-700">当前队伍通过基本检查</p>
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
              <h3 class="text-sm font-medium text-red-800">队伍未通过基本检查</h3>
              <div class="flex items-center space-x-2">
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
                role="button"
                tabindex="0"
                @keydown.enter.prevent="handleErrorClick(error)"
                @keydown.space.prevent="handleErrorClick(error)"
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
              <div class="flex items-center justify-between">
                <div>
                  <h2 class="text-base font-medium text-gray-900">当前队伍</h2>
                  <p class="text-xs text-gray-500 mt-1">{{ currentTeam.length }}/{{ teamCapacity }} 只精灵</p>
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
                          <p class="text-xs font-medium text-gray-900 truncate">{{ pet.name }}</p>
                        </div>
                        <p class="text-xs text-gray-500 truncate">
                          {{
                            gameDataStore.getSpecies(pet.species)
                              ? contentName(pet.species, 'species')
                              : `缺失精灵：${pet.species}`
                          }}
                        </p>
                        <div class="flex items-center space-x-1 mt-0.5">
                          <span
                            class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-200 text-gray-800"
                          >
                            Lv.{{ pet.level }}
                          </span>
                          <span
                            v-if="!compact"
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
                        <!-- 删除按钮 -->
                        <button
                          @click.stop="handleDeletePet(pet.id)"
                          class="md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-200 p-1 rounded-full text-gray-400 hover:text-red-500 hover:bg-red-50"
                          :title="delegate.removeLabel || '移出队伍'"
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
                :disabled="currentTeam.length >= teamCapacity"
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
            <section
              v-if="selectedMissingContent.length"
              class="bg-amber-50 border border-amber-300 rounded-lg p-4"
              role="status"
              data-testid="missing-team-content"
            >
              <h3 class="font-medium text-amber-900">当前对局缺少内容</h3>
              <p class="text-sm text-amber-800 mt-1">
                原始配置会保留，可以保存和导出；恢复对应内容后会重新检查。此队伍暂时无法出战。
              </p>
              <ul class="text-sm text-amber-900 mt-2 space-y-2">
                <li v-for="item in selectedMissingContent" :key="`${item.kind}-${item.skillIndex ?? item.contentId}`">
                  {{ item.message }}
                  <button
                    v-if="item.kind === 'skill'"
                    type="button"
                    class="ml-2 underline"
                    :data-team-field="'skills.' + item.skillIndex"
                    :aria-label="`移除缺失技能 ${item.contentId}`"
                    @click="removeMissingSkill(item.skillIndex!)"
                  >
                    移除此技能
                  </button>
                </li>
              </ul>
            </section>
            <WarehouseMemberPicker
              v-if="delegate.warehouse"
              :key="selectedPet.id"
              :current="selectedPet"
              :team="currentTeam"
              :warehouse="delegate.warehouse"
              @replaced="selectedPetId = $event"
            />
            <PetPresetPanel :pet="selectedPet" :team="currentTeam" @apply="applyPetBuild" />
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
                    @click="handleDeletePet(selectedPet.id)"
                    class="ml-2 inline-flex items-center px-2 py-1 text-xs font-medium text-red-600 bg-red-100 rounded hover:bg-red-200 transition-colors"
                  >
                    <el-icon class="mr-1" :size="12"><Delete /></el-icon>
                    {{ delegate.removeLabel || '移出队伍' }}
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
                        aria-label="精灵名称"
                        type="text"
                        class="block w-full px-2 py-1.5 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm"
                        placeholder="输入精灵名称"
                      />
                    </div>
                    <div>
                      <label class="block text-xs font-medium text-gray-700 mb-1">种族</label>
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
                      <section v-if="speciesCandidate" aria-label="更换种族预览" class="mt-2">
                        <ul>
                          <li v-for="change in buildDifferences(selectedPet, speciesCandidate)" :key="change">
                            {{ change }}
                          </li>
                        </ul>
                        <button type="button" @click="applySpeciesChange">确认更换种族</button>
                        <button type="button" @click="speciesChoice = undefined">取消</button>
                      </section>
                      <button v-if="canUndoSpecies" type="button" @click="restoreSpecies">撤销更换种族</button>
                    </div>
                  </div>

                  <!-- 第二行：基础属性 -->
                  <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div>
                      <label class="block text-xs font-medium text-gray-700 mb-1">等级</label>
                      <input
                        v-model.number="selectedPet.level"
                        aria-label="等级"
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
                </form>
              </div>
            </div>

            <el-tabs v-model="editSection" aria-label="精灵配置">
              <el-tab-pane label="配招" name="moves">
                <!-- 技能配置 -->
                <div class="bg-white rounded-lg shadow-sm border border-gray-200">
                  <div class="px-4 py-3 border-b border-gray-200">
                    <h3 class="text-base font-medium text-gray-900">技能配置</h3>
                  </div>
                  <div class="p-4">
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <!-- 特性选择 -->
                      <div>
                        <label class="block text-xs font-medium text-gray-700 mb-1">特性</label>
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
                              <div class="text-sm font-medium text-gray-900 truncate">{{ item.label }}</div>
                              <div class="text-xs text-gray-500 leading-relaxed break-words whitespace-normal">
                                {{ item.description }}
                              </div>
                            </div>
                          </template>
                        </el-select-v2>
                      </div>
                    </div>
                    <label v-if="learning?.eligible || selectedPet.inheritedSkill" class="block mb-3"
                      >遗传技能
                      <select
                        data-team-field="inheritedSkill"
                        :value="selectedPet.inheritedSkill ?? ''"
                        @change="setInheritedSkill"
                      >
                        <option value="">无</option>
                        <option
                          v-if="selectedPet.inheritedSkill && !learning?.inherited.has(selectedPet.inheritedSkill)"
                          data-team-field="inheritedSkill"
                          :value="selectedPet.inheritedSkill"
                        >
                          {{ selectedPet.inheritedSkill }}（当前不可用）
                        </option>
                        <option
                          v-for="id in learning?.inherited"
                          :key="id"
                          :value="id"
                          :disabled="!allowsTeamContent(gameDataStore.rules, 'skills', id)"
                        >
                          {{ contentName(id, 'skill') }}
                        </option>
                      </select>
                    </label>
                    <!-- 普通技能配置 -->
                    <div class="mb-6">
                      <h4 class="text-sm font-medium text-gray-800 mb-3">
                        普通技能（最多 {{ skillSlots.normalMax }} 个）
                      </h4>
                      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <div v-for="(_, index) in displayedNormalSkills" :key="`normal-${index}`" class="space-y-2">
                          <label class="block text-xs font-medium text-gray-700">
                            普通技能 {{ index + 1 }}
                            <span v-if="index >= skillSlots.normalMax">超出槽位</span>
                          </label>
                          <el-select-v2
                            :model-value="displayedNormalSkills[index]"
                            :data-testid="`normal-skill-${index}`"
                            @update:model-value="value => changeSkill(false, index, value)"
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
                                  <ElementIcon
                                    v-if="item.element"
                                    :element="item.element"
                                    class="w-4 h-4 flex-shrink-0"
                                  />
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
                                <ContentDescription
                                  class="text-xs text-gray-600 leading-relaxed break-words whitespace-normal prose prose-xs max-w-none overflow-hidden"
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
                    </div>

                    <!-- 必杀技能配置 -->
                    <div>
                      <h4 class="text-sm font-medium text-gray-800 mb-3">
                        必杀技能（最多 {{ skillSlots.climaxMax }} 个）
                      </h4>
                      <div v-for="(_, index) in displayedClimaxSkills" :key="index" class="max-w-md">
                        <label class="block text-xs font-medium text-gray-700 mb-2">
                          必杀技能 {{ index + 1 }}
                          <span v-if="index >= skillSlots.climaxMax">超出槽位</span>
                          <span v-else-if="index < (skillSlots.climaxMin ?? 0)">必选</span>
                        </label>
                        <el-select-v2
                          :model-value="displayedClimaxSkills[index]"
                          @update:model-value="value => changeSkill(true, index, value)"
                          :options="climaxSkillSelectOptions"
                          :disabled="!displayedClimaxSkills[index] && (!currentSpecies || !hasClimaxSkills)"
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
                                <ElementIcon
                                  v-if="item.element"
                                  :element="item.element"
                                  class="w-4 h-4 flex-shrink-0"
                                />
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
                              <ContentDescription
                                class="text-xs text-gray-600 leading-relaxed break-words whitespace-normal prose prose-xs max-w-none overflow-hidden"
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
                  </div>
                </div>
              </el-tab-pane>
              <el-tab-pane label="养成" name="training">
                <!-- 能力值配置 -->
                <div v-if="trainingPet" class="bg-white rounded-lg shadow-sm border border-gray-200">
                  <div class="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                    <h3 class="text-base font-medium text-gray-900">能力值配置</h3>
                    <button v-if="!trialPet" type="button" @click="startTrainingTrial">试算养成</button>
                    <div v-else class="flex flex-wrap gap-2">
                      <button type="button" @click="applyTrainingTrial">采用配法</button>
                      <button type="button" @click="trialPet = null">取消试算</button>
                    </div>
                    <span
                      class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium"
                      :class="currentEVTotal > 510 ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'"
                    >
                      学习力总和: {{ currentEVTotal }}/510
                    </span>
                  </div>
                  <div class="p-4">
                    <div v-if="trialChanges.length" class="mb-2 text-sm">
                      <ul aria-label="试算改动">
                        <li v-for="change in trialChanges" :key="change">{{ change }}</li>
                      </ul>
                      <p v-if="trialTeams.length > 1">
                        共用这只精灵的队伍：{{ trialTeams.map(team => team.name).join('、') }}
                      </p>
                    </div>
                    <ul v-if="trialPet && trialIssues.length" aria-live="polite" class="mb-2 text-sm">
                      <li v-for="issue in trialIssues" :key="issue">{{ issue }}</li>
                    </ul>
                    <!-- 性格选择 -->
                    <div>
                      <label class="block text-xs font-medium text-gray-700 mb-1">性格</label>
                      <el-select-v2
                        v-model="trainingPet.nature"
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
                    <fieldset v-if="availableStages.length || trainingPet.enhancement">
                      <legend>神魔化</legend>
                      <label
                        >强化阶段
                        <select
                          data-team-field="enhancement"
                          :value="trainingPet.enhancement ?? ''"
                          @change="selectStage(($event.target as HTMLSelectElement).value)"
                        >
                          <option value="">无</option>
                          <option
                            v-if="
                              trainingPet.enhancement &&
                              !availableStages.some(row => row.id === trainingPet?.enhancement)
                            "
                            data-team-field="enhancement"
                            :value="trainingPet.enhancement"
                            disabled
                          >
                            {{ gameDataStore.getEnhancement(trainingPet.enhancement)?.name ?? trainingPet.enhancement }}
                            {{ enhancementPolicy?.mode === 'suppressed' ? '（本局不生效）' : '（当前不可用）' }}
                          </option>
                          <optgroup
                            v-for="(stages, branch) in stagesByBranch"
                            :key="branch"
                            :label="
                              branch === 'divine' ? '神化／圣化' : branch === 'demonic' ? '魔化／冥化' : String(branch)
                            "
                          >
                            <option v-for="stage in stages" :key="stage.id" :value="stage.id">{{ stage.name }}</option>
                          </optgroup>
                        </select>
                      </label>
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
                    <div v-if="trainingPet.nature" class="p-3 bg-gray-50 rounded-md">
                      <p class="text-sm font-medium text-gray-700 mb-2">性格效果：</p>
                      <div class="flex flex-wrap gap-1">
                        <span
                          v-for="(value, stat) in gameDataStore.getNature(trainingPet.nature)?.multipliers"
                          :key="stat"
                          class="inline-flex items-center px-2 py-1 rounded text-sm font-medium"
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
                    <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                      <div v-for="stat in statList" :key="stat" class="bg-gray-50 rounded-md p-3">
                        <!-- 能力值头部 -->
                        <div class="flex items-center justify-between mb-2">
                          <h4 class="text-xs font-medium text-gray-900">{{ statChineseMap[stat] }}</h4>
                          <div class="text-right">
                            <div class="text-sm font-bold text-gray-900">
                              <span v-if="trialPet" :aria-label="'原' + statChineseMap[stat]"
                                >{{ originalStats[stat]?.total ?? '—' }} →
                              </span>
                              {{ computedStats[stat]?.total ?? '—' }}
                            </div>
                            <div class="text-xs text-gray-500">最终值</div>
                          </div>
                        </div>

                        <details v-if="computedStats[stat]" class="mb-2 text-xs">
                          <summary :aria-label="statChineseMap[stat] + '计算明细'">计算明细</summary>
                          <div>学习力折算 ⌊{{ trainingPet.evs[stat] }} ÷ 4⌋ = {{ computedStats[stat]!.effort }}</div>
                          <div>
                            等级折算 ⌊(2 × {{ currentSpecies?.baseStats[stat] }} + {{ trainingPet.ivs[stat] }} +
                            {{ computedStats[stat]!.effort }}) × {{ trainingPet.level }} ÷ 100⌋ =
                            {{ computedStats[stat]!.scaled }}
                          </div>
                          <div>
                            性格 ({{ computedStats[stat]!.scaled }} + {{ computedStats[stat]!.levelBonus }}) ×
                            {{ computedStats[stat]!.natureMultiplier }} = {{ computedStats[stat]!.afterNature }}
                          </div>
                          <div>阶段加成 +{{ computedStats[stat]!.stageBonus }}</div>
                        </details>
                        <!-- 学习力滑块 -->
                        <div class="mb-3">
                          <label class="block text-xs font-medium text-gray-700 mb-1">
                            学习力: {{ trainingPet?.evs[stat] || 0 }}
                          </label>
                          <input
                            type="range"
                            :value="trainingPet.evs[stat]"
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
                            <span class="font-medium">{{ currentSpecies?.baseStats[stat] ?? '—' }}</span>
                          </div>
                          <div class="flex justify-between text-xs">
                            <span class="text-gray-600">个体值</span>
                            <input
                              :aria-label="statChineseMap[stat] + '个体值'"
                              :data-team-field="'ivs.' + stat"
                              :value="trainingPet.ivs[stat]"
                              @input="changeIndividualValue(stat, $event)"
                              @blur="restoreIndividualInput(stat, $event)"
                              type="number"
                              min="0"
                              :max="gameDataStore.rules?.mechanics?.individualValues?.max ?? 31"
                              class="w-12 px-1 py-0.5 text-xs border border-gray-300 rounded text-right focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          </div>
                          <div class="flex justify-between text-xs">
                            <span class="text-gray-600">性格修正</span>
                            <span
                              class="font-medium"
                              :class="{
                                'text-green-600': (getNatureMultiplier(trainingPet.nature, stat) ?? 1) > 1,
                                'text-red-600': (getNatureMultiplier(trainingPet.nature, stat) ?? 1) < 1,
                                'text-gray-600': getNatureMultiplier(trainingPet.nature, stat) === 1,
                              }"
                            >
                              {{
                                gameDataStore.getNature(trainingPet.nature)
                                  ? getNatureMultiplier(trainingPet.nature, stat) + 'x'
                                  : '—'
                              }}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </el-tab-pane>
            </el-tabs>
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
                  v-if="delegate.storageRoute"
                  :to="delegate.storageRoute || '/'"
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
      v-if="!compact"
      class="fixed bottom-0 left-4 right-4 z-50 md:left-1/2 md:right-auto md:transform md:-translate-x-1/2 md:max-w-fit"
    >
      <div
        class="flex items-center justify-center space-x-2 bg-white shadow-lg border border-gray-200 rounded-t-lg px-4 py-3 md:rounded-lg"
      >
        <!-- 保存按钮 - 在移动端更突出 -->
        <button
          v-if="delegate.save"
          @click="saveCurrentTeam()"
          class="flex-1 md:flex-none inline-flex items-center justify-center px-4 py-2 bg-blue-600 border border-transparent rounded-lg font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors duration-200 text-sm md:px-3 md:py-1.5 md:rounded-md"
        >
          <svg class="w-4 h-4 md:w-3 md:h-3 md:mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
          </svg>
          <span class="ml-1 md:ml-0">{{
            delegate.affected?.value.length ? '复制一只给本队' : delegate.saveLabel || '保存'
          }}</span>
        </button>

        <button v-if="delegate.affected?.value.length" @click="saveCurrentTeam('original')">
          修改原精灵（同时影响 {{ delegate.affected.value.join('、') }}）
        </button>
        <!-- 导出按钮 -->
        <button
          v-if="delegate.exportTeam"
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
          v-if="delegate.importTeam"
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
                  <li v-if="delegate.warehouse">从队伍移出后，这只精灵仍保存在仓库中。</li>
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
                  <li v-if="delegate.warehouse">多个队伍共用一只时，保存可以修改原只，也可以复制一只给本队。</li>
                  <li>使用“导出”和“导入”功能，可以方便地备份和分享你的队伍配置。</li>
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
import type { TeamEditorDelegate } from './delegate'
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import { useGameDataStore } from '@/stores/gameData'
import { useValidationStore } from '@/stores/validation'

import { resolveLearnset, isEligible } from '@arcadia-eternity/content-sdk/environment-rules'
import { type PetSchemaType } from '@arcadia-eternity/schema'
import { useTranslation } from 'i18next-vue'
import { defaultEditorSkillSlots, Gender } from '@arcadia-eternity/const'
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
import PetPresetPanel from './PetPresetPanel.vue'
import WarehouseMemberPicker from './WarehouseMemberPicker.vue'
import ContentDescription from '@/components/ContentDescription'
import {
  InfoFilled,
  FolderOpened,
  Close,
  SuccessFilled,
  WarningFilled,
  ArrowDown,
  ArrowUp,
  ArrowRight,
  Loading,
  StarFilled,
} from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useMobile } from '@/composition/useMobile'
import { readLocalData, writeLocalData } from '@/services/localStorage'
import { findMissingTeamContent, replaceResolvedSkills } from '@/utils/teamContent'

const { i18next } = useTranslation()

const props = defineProps<{ delegate: TeamEditorDelegate; compact?: boolean }>()
const delegate = props.delegate
const gameDataStore = useGameDataStore()
const validationStore = useValidationStore()
const importTeamConfig = () => delegate.importTeam?.()

// 移动端检测
const { isMobile } = useMobile()

// 响应式状态
const editSection = ref<'moves' | 'training'>('moves')
const selectedPetId = ref<string | null>(delegate.team.value[0]?.id ?? null)
const showGuide = ref(!props.compact && !!delegate.storageRoute && readLocalData('teamBuilderGuideHidden') !== 'true') // 控制指引显示
const showDragTip = ref(!props.compact && readLocalData('teamBuilderDragTipHidden') !== 'true') // 控制拖拽提示显示
const showValidationDetails = ref(false) // 控制验证详情显示
const showHelp = ref(false) // 控制帮助对话框显示

// 排序锁状态 - PC端默认关闭，移动端默认开启
const sortLocked = ref(isMobile.value)

const drag = ref(false)

onMounted(() => {
  void validationStore.initialize()
})

// 关闭指引
const hideGuide = () => {
  showGuide.value = false
  writeLocalData('teamBuilderGuideHidden', 'true')
}

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

// 初始化状态检查
const isInitialized = computed(() => {
  // 检查游戏数据是否加载完成
  if (!gameDataStore.loaded) {
    return false
  }

  // 检查petStorage是否已初始化
  if (!delegate.ready.value) {
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

  if (!delegate.ready.value) {
    return '正在加载队伍数据...'
  }

  if (validationStore.isLoading) {
    return '正在初始化验证...'
  }

  if (!validationStore.isInitialized) {
    return '正在初始化验证...'
  }

  return '初始化完成'
})

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
  section?: 'moves' | 'training'
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
const trialPet = ref<PetSchemaType | null>(null)
const trainingPet = computed(() => trialPet.value ?? selectedPet.value)

function startTrainingTrial() {
  if (selectedPet.value) trialPet.value = JSON.parse(JSON.stringify(selectedPet.value))
}

// A trial belongs to one member in one editor context.
watch(
  [selectedPet, () => gameDataStore.rules, () => gameDataStore.species],
  () => {
    trialPet.value = null
  },
  { flush: 'sync' },
)

function applyTrainingTrial() {
  const pet = selectedPet.value
  const trial = trialPet.value
  if (!pet || !trial || pet.id !== trial.id) return
  pet.ivs = { ...trial.ivs }
  pet.evs = { ...trial.evs }
  pet.nature = trial.nature
  if (trial.enhancement) pet.enhancement = trial.enhancement
  else delete pet.enhancement
  trialPet.value = null
}

const trialTeams = computed(() => (trialPet.value ? (delegate.warehouse?.teamsUsing(trialPet.value.id) ?? []) : []))
const trialChanges = computed(() => {
  const before = selectedPet.value
  const after = trialPet.value
  if (!before || !after) return []
  const changes: string[] = []
  for (const stat of statList) {
    if (before.ivs[stat] !== after.ivs[stat])
      changes.push(`${statChineseMap[stat]}个体值 ${before.ivs[stat]} → ${after.ivs[stat]}`)
    if (before.evs[stat] !== after.evs[stat])
      changes.push(`${statChineseMap[stat]}学习力 ${before.evs[stat]} → ${after.evs[stat]}`)
  }
  if (before.nature !== after.nature)
    changes.push(`性格 ${getNatureName(before.nature)} → ${getNatureName(after.nature)}`)
  if (before.enhancement !== after.enhancement) {
    const name = (id?: string) => (id ? (gameDataStore.getEnhancement(id)?.name ?? id) : '无')
    changes.push(`强化阶段 ${name(before.enhancement)} → ${name(after.enhancement)}`)
  }
  return changes
})

const trialIssues = computed(() => {
  const trial = trialPet.value
  if (!trial) return []
  const candidate = currentTeam.value.map(pet => (pet.id === trial.id ? trial : pet))
  const before = new Set(teamValidationResult.value.errors.map(error => error.message))
  const after = new Set(validationStore.validateTeam(candidate).errors.map(error => error.message))
  return [
    ...[...after].filter(message => !before.has(message)).map(message => '新增问题 · ' + message),
    ...[...before].filter(message => !after.has(message)).map(message => '已解决 · ' + message),
  ]
})

function changeIndividualValue(stat: StatKey, event: Event) {
  const input = event.currentTarget as HTMLInputElement
  if (
    trainingPet.value &&
    Number.isSafeInteger(input.valueAsNumber) &&
    input.valueAsNumber >= 0 &&
    input.valueAsNumber <= 120
  ) {
    trainingPet.value.ivs[stat] = input.valueAsNumber
  }
}

function restoreIndividualInput(stat: StatKey, event: Event) {
  if (trainingPet.value) (event.currentTarget as HTMLInputElement).value = String(trainingPet.value.ivs[stat])
}

const selectedMissingContent = computed(() =>
  selectedPet.value && gameDataStore.loaded ? findMissingTeamContent([selectedPet.value], gameDataStore) : [],
)
const removeMissingSkill = (index: number) => {
  if (!selectedPet.value || gameDataStore.getSkill(selectedPet.value.skills[index])) return
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
  const skills = new Set(sources.normal)
  const inherited = selectedPet.value?.inheritedSkill
  if (inherited && sources.inherited.has(inherited)) skills.add(inherited)
  return [...skills].map(skill => gameDataStore.getSkill(skill)).filter(Boolean)
})
const hasClimaxSkills = computed(() => filteredSkills.value.some(skill => skill?.category === 'Climax'))

function setInheritedSkill(event: Event) {
  if (!selectedPet.value) return
  const id = (event.target as HTMLSelectElement).value
  if (id) selectedPet.value.inheritedSkill = id
  else delete selectedPet.value.inheritedSkill
}

const genderChineseMap: Record<Gender, string> = {
  [Gender.Male]: '雄性',
  [Gender.Female]: '雌性',
  [Gender.NoGender]: '无性别',
}

// 获取性格中文名称
const getNatureName = (id: string) =>
  i18next.t(id + '.name', { ns: 'nature', nsSeparator: false, defaultValue: gameDataStore.getNature(id)?.name ?? id })

const skillSlots = computed(() => gameDataStore.rules?.mechanics?.skillSlots ?? defaultEditorSkillSlots)
function categorySlots(climax: boolean) {
  return computed(() => {
    const limit = climax ? skillSlots.value.climaxMax : skillSlots.value.normalMax
    const equipped = (selectedPet.value?.skills ?? []).filter(id => {
      const skill = gameDataStore.getSkill(id)
      return skill && (skill.category === 'Climax') === climax
    })
    // A smaller target format must leave every occupied slot visible and removable.
    return [...equipped, ...Array<string>(Math.max(0, limit - equipped.length)).fill('')]
  })
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
  const policy = enhancementPolicy.value
  const species = selectedPet.value?.species
  if (!species || policy?.mode !== 'active' || (policy.species && !policy.species.includes(species))) return []
  return gameDataStore.enhancements.filter(stage => !policy.stages || policy.stages.includes(stage.id))
})
const stagesByBranch = computed(() => {
  const groups = Object.create(null) as Record<string, typeof availableStages.value>
  for (const stage of availableStages.value) (groups[stage.branch] ??= []).push(stage)
  return groups
})
const activeStage = computed(() => availableStages.value.find(stage => stage.id === trainingPet.value?.enhancement))
function selectStage(id: string) {
  if (!trainingPet.value) return
  if (!id) delete trainingPet.value.enhancement
  else if (availableStages.value.some(stage => stage.id === id)) trainingPet.value.enhancement = id
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
  const id = trainingPet.value?.nature
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

// 普通技能选项
const normalSkillSelectOptions = computed(() => {
  const currentNormalSkills = displayedNormalSkills.value.filter(s => s)
  const currentClimaxSkills = displayedClimaxSkills.value

  return filteredSkills.value
    .filter((skill): skill is NonNullable<typeof skill> => !!skill && skill.category !== 'Climax')
    .map(skill => ({
      value: skill.id,
      label: contentName(skill.id, 'skill'),
      description: i18next.t(`${skill.id}.description`, { ns: 'skill' }),
      element: skill.element,
      power: skill.power,
      category: skill.category,
      rage: skill.rage,
      accuracy: skill.accuracy,
      disabled:
        !allowsTeamContent(gameDataStore.rules, 'skills', skill.id) ||
        currentNormalSkills.includes(skill.id) ||
        currentClimaxSkills.includes(skill.id),
    }))
})

// 必杀技能选项
const climaxSkillSelectOptions = computed(() => {
  const currentNormalSkills = displayedNormalSkills.value.filter(s => s)

  return filteredSkills.value
    .filter((skill): skill is NonNullable<typeof skill> => !!skill && skill.category === 'Climax')
    .map(skill => ({
      value: skill.id,
      label: contentName(skill.id, 'skill'),
      description: i18next.t(`${skill.id}.description`, { ns: 'skill' }),
      element: skill.element,
      power: skill.power,
      category: skill.category,
      rage: skill.rage,
      accuracy: skill.accuracy,
      disabled:
        !allowsTeamContent(gameDataStore.rules, 'skills', skill.id) ||
        currentNormalSkills.includes(skill.id) ||
        displayedClimaxSkills.value.includes(skill.id),
    }))
})

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

const getErrorContext = (error: ValidationError): Record<string, unknown> => {
  return error.context || {}
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
      if (error.section) editSection.value = error.section
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
  if (!trainingPet.value) return 0
  return Object.values(trainingPet.value.evs).reduce((a, b) => a + b, 0)
})

const handleEVUpdate = (stat: StatKey, value: number) => {
  if (!trainingPet.value) return

  const currentStatEV = trainingPet.value.evs[stat]
  const otherEVSum = currentEVTotal.value - currentStatEV
  let maxAllowed = Math.min(255, 510 - otherEVSum)

  // 确保maxAllowed是4的倍数
  maxAllowed = Math.floor(maxAllowed / 4) * 4

  const roundedValue = Math.round(value / 4) * 4
  const clampedValue = Math.min(Math.max(0, roundedValue), maxAllowed)

  trainingPet.value.evs[stat] = clampedValue
}

const computedStats = computed(() => buildStatSteps(trainingPet.value, gameDataStore))
const originalStats = computed(() => buildStatSteps(selectedPet.value, gameDataStore))

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
  selected[index] = next ?? ''
  try {
    pet.skills = replaceResolvedSkills(pet.skills, selected, climax, gameDataStore.getSkill)
    debouncedSave()
  } catch (error) {
    ElMessage.error((error as Error).message)
  }
}

// 导出队伍配置的包装函数
const handleExportTeamConfig = () => {
  delegate.exportTeam?.(currentTeam.value)
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
