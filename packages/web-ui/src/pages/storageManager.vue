<template>
  <div class="min-h-screen bg-gray-50">
    <!-- 头部导航 -->
    <header class="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-40">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <!-- 桌面端布局 -->
        <div class="hidden sm:flex items-center justify-between h-16">
          <div class="flex items-center space-x-4">
            <button
              @click="$router.back()"
              class="inline-flex items-center px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
              </svg>
              返回
            </button>
            <h1 class="text-xl font-semibold text-gray-900">精灵仓库</h1>
            <div class="hidden lg:block">
              <span
                class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800"
              >
                {{ playerStore.name || '未命名训练师' }}
              </span>
            </div>
            <!-- 模式切换按钮 -->
            <div class="flex items-center space-x-2 bg-gray-100 rounded-lg p-1">
              <button
                @click="viewMode = 'team'"
                :class="[
                  'px-3 py-1 text-sm font-medium rounded-md transition-colors duration-200 whitespace-nowrap',
                  viewMode === 'team' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900',
                ]"
              >
                队伍管理
              </button>
              <button
                @click="viewMode = 'storage'"
                :class="[
                  'px-3 py-1 text-sm font-medium rounded-md transition-colors duration-200 whitespace-nowrap',
                  viewMode === 'storage' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900',
                ]"
              >
                仓库管理
              </button>
            </div>
          </div>
          <div class="flex items-center space-x-3">
            <span class="text-sm text-gray-500 hidden lg:inline">
              总计: {{ petStorage.storage.length + totalTeamPets }} 只精灵
            </span>
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
            <button
              @click="showHelp = true"
              class="p-2 text-gray-400 hover:text-gray-500 rounded-full hover:bg-gray-100"
              title="帮助"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </button>
          </div>
        </div>

        <!-- 移动端布局 -->
        <div class="sm:hidden">
          <!-- 第一行：返回按钮、清理按钮和帮助按钮 -->
          <div class="flex items-center justify-between h-12 border-b border-gray-100">
            <button
              @click="$router.back()"
              class="inline-flex items-center px-2 py-1 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
            >
              <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
              </svg>
              返回
            </button>
            <div class="flex items-center space-x-2">
              <button
                @click="clearAllData"
                class="inline-flex items-center px-2 py-1 border border-red-300 text-xs font-medium rounded-md text-red-700 bg-white hover:bg-red-50"
              >
                <svg class="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
                清理
              </button>
              <button
                @click="showHelp = true"
                class="p-2 text-gray-400 hover:text-gray-500 rounded-full hover:bg-gray-100"
                title="帮助"
              >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </button>
            </div>
          </div>

          <!-- 第二行：标题和模式切换 -->
          <div class="flex items-center justify-between h-12 px-1">
            <h1 class="text-lg font-semibold text-gray-900 flex-shrink-0">精灵仓库</h1>
            <!-- 模式切换按钮 - 移动端优化 -->
            <div class="flex items-center bg-gray-100 rounded-lg p-0.5 ml-2 flex-shrink-0">
              <button
                @click="viewMode = 'team'"
                :class="[
                  'px-2 py-1 text-xs font-medium rounded-md transition-colors duration-200 whitespace-nowrap',
                  viewMode === 'team' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600',
                ]"
              >
                队伍
              </button>
              <button
                @click="viewMode = 'storage'"
                :class="[
                  'px-2 py-1 text-xs font-medium rounded-md transition-colors duration-200 whitespace-nowrap',
                  viewMode === 'storage' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600',
                ]"
              >
                仓库
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>

    <!-- 主要内容区域 -->
    <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <!-- 统计信息卡片 -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div class="bg-white rounded-md shadow-sm border border-gray-200 p-3">
          <div class="flex items-center">
            <div class="w-6 h-6 bg-blue-100 rounded-md flex items-center justify-center mr-3">
              <svg class="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
            </div>
            <div>
              <p class="text-xs font-medium text-gray-500">队伍</p>
              <p class="text-lg font-semibold text-gray-900">{{ petStorage.teams.length }}</p>
            </div>
          </div>
        </div>

        <div class="bg-white rounded-md shadow-sm border border-gray-200 p-3">
          <div class="flex items-center">
            <div class="w-6 h-6 bg-green-100 rounded-md flex items-center justify-center mr-3">
              <svg class="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <div>
              <p class="text-xs font-medium text-gray-500">队伍精灵</p>
              <p class="text-lg font-semibold text-gray-900">{{ totalTeamPets }}</p>
            </div>
          </div>
        </div>

        <div class="bg-white rounded-md shadow-sm border border-gray-200 p-3">
          <div class="flex items-center">
            <div class="w-6 h-6 bg-yellow-100 rounded-md flex items-center justify-center mr-3">
              <svg class="w-4 h-4 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                />
              </svg>
            </div>
            <div>
              <p class="text-xs font-medium text-gray-500">仓库精灵</p>
              <p class="text-lg font-semibold text-gray-900">{{ petStorage.storage.length }}</p>
            </div>
          </div>
        </div>

        <div class="bg-white rounded-md shadow-sm border border-gray-200 p-3">
          <div class="flex items-center">
            <div class="w-6 h-6 bg-purple-100 rounded-md flex items-center justify-center mr-3">
              <svg class="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <p class="text-xs font-medium text-gray-500">总计</p>
              <p class="text-lg font-semibold text-gray-900">{{ petStorage.storage.length + totalTeamPets }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- 主要内容区域 -->
      <div v-if="viewMode === 'team'" class="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <!-- 队伍管理区域 -->
        <div class="lg:col-span-3">
          <div class="bg-white rounded-lg shadow-sm border border-gray-200">
            <div class="px-6 py-4 border-b border-gray-200">
              <div class="flex items-center justify-between">
                <h2 class="text-lg font-medium text-gray-900">队伍管理</h2>
                <div class="flex items-center space-x-3">
                  <button
                    @click="createNewTeam"
                    class="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                  >
                    <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                      />
                    </svg>
                    新建队伍
                  </button>
                  <button
                    @click="importTeam"
                    class="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                  >
                    <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10"
                      />
                    </svg>
                    导入队伍
                  </button>
                </div>
              </div>

              <!-- 移动端操作提示 -->
              <div class="mt-3 sm:hidden">
                <div class="bg-blue-50 border border-blue-200 rounded-md p-3">
                  <div class="flex">
                    <svg
                      class="w-5 h-5 text-blue-400 mr-2 flex-shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    <div class="text-sm text-blue-700">
                      <p class="font-medium">移动端操作提示：</p>
                      <p>• 单击精灵查看操作菜单</p>
                      <p>• 双击精灵快速移动</p>
                      <p>• 长按精灵显示详细菜单</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="p-6">
              <!-- 队伍列表 -->
              <div ref="teamContainerRef" class="space-y-6 min-h-[600px]">
                <div
                  v-for="team in paginatedTeams"
                  :key="petStorage.teams.indexOf(team)"
                  @dblclick="handleTeamDoubleClick(petStorage.teams.indexOf(team))"
                  :class="[
                    'border rounded-lg p-4 transition-all duration-200 cursor-pointer',
                    petStorage.teams.indexOf(team) === petStorage.currentTeamIndex
                      ? 'border-blue-500 bg-blue-50 shadow-md'
                      : 'border-gray-200 hover:border-gray-300 hover:shadow-sm',
                  ]"
                >
                  <!-- 队伍头部 -->
                  <div class="flex items-center justify-between mb-4">
                    <div class="flex items-center space-x-3">
                      <h3
                        v-if="editingIndex !== petStorage.teams.indexOf(team)"
                        class="text-lg font-medium text-gray-900 cursor-pointer"
                        @click="editTeamName(petStorage.teams.indexOf(team))"
                      >
                        {{ team.name }}
                      </h3>
                      <input
                        v-else
                        v-model="tempTeamName"
                        @blur="saveTeamName(petStorage.teams.indexOf(team))"
                        @keyup.enter="saveTeamName(petStorage.teams.indexOf(team))"
                        class="text-lg font-medium text-gray-900 border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        ref="editInput"
                      />
                      <span
                        class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800"
                      >
                        {{ team.pets.length }}/6
                      </span>
                      <span
                        v-if="petStorage.teams.indexOf(team) === petStorage.currentTeamIndex"
                        class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800"
                      >
                        当前队伍
                      </span>
                    </div>
                    <div class="flex items-center space-x-2">
                      <button
                        @click="setCurrentTeam(petStorage.teams.indexOf(team))"
                        :disabled="petStorage.teams.indexOf(team) === petStorage.currentTeamIndex"
                        class="px-3 py-1 text-xs border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        设为当前
                      </button>
                      <button
                        @click="copyTeam(petStorage.teams.indexOf(team))"
                        class="px-3 py-1 text-xs bg-green-600 text-white rounded-md hover:bg-green-700"
                      >
                        复制
                      </button>
                      <button
                        @click="exportTeam(petStorage.teams.indexOf(team))"
                        class="px-3 py-1 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700"
                      >
                        导出
                      </button>
                      <button
                        @click="deleteTeam(petStorage.teams.indexOf(team))"
                        :disabled="petStorage.teams.length <= 1"
                        class="px-3 py-1 text-xs bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        删除
                      </button>
                    </div>
                  </div>

                  <!-- 队伍精灵 -->
                  <div
                    class="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-6 gap-2 sm:gap-3 min-h-[100px] p-2 sm:p-3 border-2 border-dashed border-gray-200 rounded-lg"
                  >
                    <!-- 队伍精灵列表 -->
                    <el-tooltip
                      v-for="pet in team.pets"
                      :key="pet.id"
                      placement="top"
                      :show-after="500"
                      :hide-after="0"
                      popper-class="pet-tooltip"
                    >
                      <template #content>
                        <div class="pet-tooltip-content">
                          <div class="flex items-center space-x-3 mb-2">
                            <PetIcon :id="gameDataStore.getSpecies(pet.species)?.num" class="w-12 h-12" />
                            <div>
                              <div class="font-semibold text-white">{{ pet.name }}</div>
                              <div class="text-gray-300 text-sm">
                                {{ i18next.t(`${gameDataStore.getSpecies(pet.species)?.id}.name`, { ns: 'species' }) }}
                              </div>
                              <div class="text-gray-400 text-xs">等级 {{ pet.level }}</div>
                            </div>
                          </div>
                          <div class="grid grid-cols-2 gap-2 text-xs">
                            <div class="flex justify-between">
                              <span class="text-gray-300">体力:</span>
                              <span class="text-white font-medium">{{ computePetStat(pet, 'hp') }}</span>
                            </div>
                            <div class="flex justify-between">
                              <span class="text-gray-300">攻击:</span>
                              <span class="text-white font-medium">{{ computePetStat(pet, 'atk') }}</span>
                            </div>
                            <div class="flex justify-between">
                              <span class="text-gray-300">防御:</span>
                              <span class="text-white font-medium">{{ computePetStat(pet, 'def') }}</span>
                            </div>
                            <div class="flex justify-between">
                              <span class="text-gray-300">特攻:</span>
                              <span class="text-white font-medium">{{ computePetStat(pet, 'spa') }}</span>
                            </div>
                            <div class="flex justify-between">
                              <span class="text-gray-300">特防:</span>
                              <span class="text-white font-medium">{{ computePetStat(pet, 'spd') }}</span>
                            </div>
                            <div class="flex justify-between">
                              <span class="text-gray-300">速度:</span>
                              <span class="text-white font-medium">{{ computePetStat(pet, 'spe') }}</span>
                            </div>
                          </div>
                          <div class="mt-2 pt-2 border-t border-gray-600 flex justify-between text-xs">
                            <span class="text-gray-300">
                              性格: <span class="text-white">{{ getNatureText(pet.nature) }}</span>
                            </span>
                            <span class="text-gray-300">
                              性别: <span class="text-white">{{ getGenderText(pet.gender) }}</span>
                            </span>
                          </div>
                          <div v-if="pet.skills && pet.skills.length > 0" class="mt-2 pt-2 border-t border-gray-600">
                            <div class="text-gray-300 text-xs mb-1">技能配招:</div>
                            <div class="flex flex-wrap gap-1">
                              <span
                                v-for="skillId in pet.skills"
                                :key="skillId"
                                class="inline-block px-2 py-1 bg-blue-600 text-white text-xs rounded"
                              >
                                {{ getSkillName(skillId) }}
                              </span>
                            </div>
                          </div>
                        </div>
                      </template>
                      <div
                        :ref="
                          el => {
                            if (el) setupPetInteraction(el, pet, petStorage.teams.indexOf(team))
                          }
                        "
                        class="relative bg-white rounded-lg border border-gray-200 p-1 sm:p-2 hover:shadow-md transition-all duration-200 group cursor-pointer active:bg-gray-50 touch-manipulation"
                      >
                        <div class="flex flex-col items-center space-y-1">
                          <PetIcon :id="gameDataStore.getSpecies(pet.species)?.num" class="w-8 h-8 sm:w-10 sm:h-10" />
                          <div class="text-center w-full">
                            <p class="text-xs sm:text-xs font-medium text-gray-900 truncate">{{ pet.name }}</p>
                            <p class="text-xs sm:text-xs text-gray-500">Lv.{{ pet.level }}</p>
                            <p class="text-xs sm:text-xs text-gray-400 truncate hidden sm:block">
                              {{ i18next.t(`${gameDataStore.getSpecies(pet.species)?.id}.name`, { ns: 'species' }) }}
                            </p>
                          </div>
                          <!-- 移动端显示操作按钮，桌面端悬停显示 -->
                          <button
                            @click.stop="handleShowTeamPetContextMenu($event, pet, petStorage.teams.indexOf(team))"
                            class="absolute top-1 right-1 p-1 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-full transition-colors duration-200 sm:opacity-0 sm:group-hover:opacity-100 opacity-100"
                            title="更多操作"
                          >
                            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
                              />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </el-tooltip>

                    <!-- 空槽位 -->
                    <div
                      v-for="n in Math.max(0, 6 - team.pets.length)"
                      :key="`empty-${n}`"
                      class="bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg p-2 flex items-center justify-center text-gray-400 hover:border-gray-400 transition-colors duration-200"
                    >
                      <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                        />
                      </svg>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 队伍分页 -->
              <div v-if="petStorage.teams.length > teamPagination.pageSize" class="mt-6 flex justify-center">
                <el-pagination
                  v-model:current-page="teamPagination.currentPage"
                  :page-size="teamPagination.pageSize"
                  layout="total, prev, pager, next"
                  :total="petStorage.teams.length"
                  @current-change="handleTeamPageChange"
                  small
                />
              </div>
            </div>
          </div>
        </div>

        <!-- 仓库区域 -->
        <div class="lg:col-span-1">
          <div class="bg-white rounded-lg shadow-sm border border-gray-200">
            <div class="px-6 py-4 border-b border-gray-200">
              <div class="flex items-center justify-between">
                <h2 class="text-lg font-medium text-gray-900">精灵仓库</h2>
                <div class="flex items-center space-x-3">
                  <span class="text-sm text-gray-500 hidden sm:inline">
                    显示 {{ paginatedPets.length }} 只 (共 {{ filteredPets.length }}/{{ petStorage.storage.length }} 只)
                  </span>
                  <!-- 仓库导入导出按钮 -->
                  <div class="flex items-center space-x-2">
                    <button
                      @click="importStorage"
                      class="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                    >
                      <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10"
                        />
                      </svg>
                      导入仓库
                    </button>
                    <!-- 导出下拉菜单 -->
                    <el-dropdown @command="handleExportCommand">
                      <button
                        class="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                      >
                        <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                          />
                        </svg>
                        导出仓库
                        <svg class="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      <template #dropdown>
                        <el-dropdown-menu>
                          <el-dropdown-item command="exportFull">导出完整仓库</el-dropdown-item>
                          <el-dropdown-item command="exportPetsOnly">仅导出精灵</el-dropdown-item>
                        </el-dropdown-menu>
                      </template>
                    </el-dropdown>
                  </div>
                </div>
              </div>

              <!-- 移动端精灵数量显示 -->
              <div class="mt-2 sm:hidden">
                <span class="text-xs text-gray-500">
                  显示 {{ paginatedPets.length }} 只 (共 {{ filteredPets.length }}/{{ petStorage.storage.length }} 只)
                </span>
              </div>
            </div>

            <!-- 搜索和筛选区域 -->
            <div class="px-4 py-3 border-b border-gray-200 bg-gray-50">
              <!-- 搜索框 -->
              <div class="mb-3">
                <el-input
                  v-model="searchQuery"
                  placeholder="搜索精灵名称或种族..."
                  clearable
                  size="small"
                  class="w-full"
                >
                  <template #prefix>
                    <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                      />
                    </svg>
                  </template>
                </el-input>
              </div>

              <!-- 筛选器 -->
              <div class="space-y-2">
                <!-- 元素类型筛选 -->
                <div class="flex items-center space-x-2">
                  <label class="text-xs font-medium text-gray-600 w-12 flex-shrink-0">元素:</label>
                  <el-select v-model="filters.element" placeholder="全部" clearable size="small" class="flex-1">
                    <el-option
                      v-for="element in availableElements"
                      :key="element.value"
                      :label="element.label"
                      :value="element.value"
                    />
                  </el-select>
                </div>

                <!-- 等级范围筛选 -->
                <div class="flex items-center space-x-2">
                  <label class="text-xs font-medium text-gray-600 w-12 flex-shrink-0">等级:</label>
                  <div class="flex items-center space-x-1 flex-1 min-w-0">
                    <el-input-number
                      v-model="filters.levelMin"
                      :min="1"
                      :max="100"
                      size="small"
                      controls-position="right"
                      placeholder="最低"
                      class="flex-1 min-w-0"
                      style="max-width: calc(50% - 8px)"
                    />
                    <span class="text-gray-400 flex-shrink-0">-</span>
                    <el-input-number
                      v-model="filters.levelMax"
                      :min="1"
                      :max="100"
                      size="small"
                      controls-position="right"
                      placeholder="最高"
                      class="flex-1 min-w-0"
                      style="max-width: calc(50% - 8px)"
                    />
                  </div>
                </div>

                <!-- 性别筛选 -->
                <div class="flex items-center space-x-2">
                  <label class="text-xs font-medium text-gray-600 w-12 flex-shrink-0">性别:</label>
                  <el-select v-model="filters.gender" placeholder="全部" clearable size="small" class="flex-1">
                    <el-option label="雄性" :value="Gender.Male" />
                    <el-option label="雌性" :value="Gender.Female" />
                    <el-option label="无性别" :value="Gender.NoGender" />
                  </el-select>
                </div>

                <!-- 排序选择 -->
                <div class="flex items-center space-x-2">
                  <label class="text-xs font-medium text-gray-600 w-12 flex-shrink-0">排序:</label>
                  <el-select v-model="sortBy" size="small" class="flex-1">
                    <el-option label="名称" value="name" />
                    <el-option label="等级" value="level" />
                    <el-option label="种族编号" value="speciesNum" />
                    <el-option label="体力" value="hp" />
                    <el-option label="攻击力" value="atk" />
                    <el-option label="防御力" value="def" />
                    <el-option label="特攻" value="spa" />
                    <el-option label="特防" value="spd" />
                    <el-option label="速度" value="spe" />
                  </el-select>
                  <el-button size="small" @click="sortOrder = sortOrder === 'asc' ? 'desc' : 'asc'" class="px-2">
                    <svg
                      v-if="sortOrder === 'asc'"
                      class="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12"
                      />
                    </svg>
                    <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M3 4h13M3 8h9m-9 4h9m5-4v12m0 0l-4-4m4 4l4-4"
                      />
                    </svg>
                  </el-button>
                </div>

                <!-- 清除筛选按钮 -->
                <div class="flex justify-end">
                  <el-button size="small" type="info" plain @click="clearFilters" class="text-xs"> 清除筛选 </el-button>
                </div>
              </div>
            </div>

            <!-- 仓库区域 -->
            <div ref="storageContainerRef" class="p-4 min-h-[400px] max-h-[600px] overflow-y-auto">
              <!-- 空仓库提示 -->
              <div
                v-if="petStorage.storage.length === 0"
                class="flex flex-col items-center justify-center h-64 text-gray-500 border-2 border-dashed border-gray-300 rounded-lg"
              >
                <svg class="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                  />
                </svg>
                <p class="text-lg font-medium">仓库为空</p>
                <p class="text-sm">双击队伍精灵或使用右键菜单将精灵移动到仓库</p>
              </div>

              <!-- 无筛选结果提示 -->
              <div
                v-else-if="filteredPets.length === 0"
                class="flex flex-col items-center justify-center h-64 text-gray-500 border-2 border-dashed border-gray-300 rounded-lg"
              >
                <svg class="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
                <p class="text-lg font-medium">没有找到匹配的精灵</p>
                <p class="text-sm">尝试调整搜索条件或清除筛选</p>
              </div>

              <!-- 仓库精灵列表 -->
              <div v-else class="grid grid-cols-2 sm:grid-cols-2 gap-2 sm:gap-3">
                <el-tooltip
                  v-for="pet in paginatedPets"
                  :key="pet.id"
                  placement="top"
                  :show-after="500"
                  :hide-after="0"
                  popper-class="pet-tooltip"
                >
                  <template #content>
                    <div class="pet-tooltip-content">
                      <div class="flex items-center space-x-3 mb-2">
                        <PetIcon :id="gameDataStore.getSpecies(pet.species)?.num" class="w-12 h-12" />
                        <div>
                          <div class="font-semibold text-white">{{ pet.name }}</div>
                          <div class="text-gray-300 text-sm">
                            {{ i18next.t(`${gameDataStore.getSpecies(pet.species)?.id}.name`, { ns: 'species' }) }}
                          </div>
                          <div class="text-gray-400 text-xs">等级 {{ pet.level }}</div>
                        </div>
                      </div>
                      <div class="grid grid-cols-2 gap-2 text-xs">
                        <div class="flex justify-between">
                          <span class="text-gray-300">体力:</span>
                          <span class="text-white font-medium">{{ computePetStat(pet, 'hp') }}</span>
                        </div>
                        <div class="flex justify-between">
                          <span class="text-gray-300">攻击:</span>
                          <span class="text-white font-medium">{{ computePetStat(pet, 'atk') }}</span>
                        </div>
                        <div class="flex justify-between">
                          <span class="text-gray-300">防御:</span>
                          <span class="text-white font-medium">{{ computePetStat(pet, 'def') }}</span>
                        </div>
                        <div class="flex justify-between">
                          <span class="text-gray-300">特攻:</span>
                          <span class="text-white font-medium">{{ computePetStat(pet, 'spa') }}</span>
                        </div>
                        <div class="flex justify-between">
                          <span class="text-gray-300">特防:</span>
                          <span class="text-white font-medium">{{ computePetStat(pet, 'spd') }}</span>
                        </div>
                        <div class="flex justify-between">
                          <span class="text-gray-300">速度:</span>
                          <span class="text-white font-medium">{{ computePetStat(pet, 'spe') }}</span>
                        </div>
                      </div>
                      <div class="mt-2 pt-2 border-t border-gray-600 flex justify-between text-xs">
                        <span class="text-gray-300">
                          性格:
                          <span class="text-white">{{ getNatureText(pet.nature) }}</span>
                        </span>
                        <span class="text-gray-300">
                          性别: <span class="text-white">{{ getGenderText(pet.gender) }}</span>
                        </span>
                      </div>
                      <div v-if="pet.skills && pet.skills.length > 0" class="mt-2 pt-2 border-t border-gray-600">
                        <div class="text-gray-300 text-xs mb-1">技能配招:</div>
                        <div class="flex flex-wrap gap-1">
                          <span
                            v-for="skillId in pet.skills"
                            :key="skillId"
                            class="inline-block px-2 py-1 bg-blue-600 text-white text-xs rounded"
                          >
                            {{ getSkillName(skillId) }}
                          </span>
                        </div>
                      </div>
                    </div>
                  </template>
                  <div
                    :ref="
                      el => {
                        if (el) setupPetInteraction(el, pet)
                      }
                    "
                    class="relative bg-white rounded-lg border border-gray-200 p-1 sm:p-2 hover:shadow-md transition-all duration-200 group cursor-pointer active:bg-gray-50 touch-manipulation"
                  >
                    <div class="flex flex-col items-center space-y-1">
                      <PetIcon :id="gameDataStore.getSpecies(pet.species)?.num" class="w-8 h-8 sm:w-10 sm:h-10" />
                      <div class="text-center w-full">
                        <p class="text-xs sm:text-xs font-medium text-gray-900 truncate">{{ pet.name }}</p>
                        <p class="text-xs sm:text-xs text-gray-500">Lv.{{ pet.level }}</p>
                        <p class="text-xs sm:text-xs text-gray-400 truncate hidden sm:block">
                          {{ i18next.t(`${gameDataStore.getSpecies(pet.species)?.id}.name`, { ns: 'species' }) }}
                        </p>
                      </div>

                      <!-- 移动端显示操作按钮，桌面端悬停显示 -->
                      <button
                        @click.stop="handleShowContextMenu($event, pet)"
                        class="absolute top-1 right-1 p-1 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-full transition-colors duration-200 sm:opacity-0 sm:group-hover:opacity-100 opacity-100"
                        title="更多操作"
                      >
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>
                </el-tooltip>
              </div>

              <!-- 仓库分页 -->
              <div v-if="filteredPets.length > storagePagination.pageSize" class="mt-4 flex justify-center">
                <el-pagination
                  v-model:current-page="storagePagination.currentPage"
                  :page-size="storagePagination.pageSize"
                  layout="total, prev, pager, next"
                  :total="filteredPets.length"
                  @current-change="handleStoragePageChange"
                  small
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 仓库管理模式 -->
      <div v-else class="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <!-- 当前队伍区域（紧凑显示） -->
        <div class="lg:col-span-1">
          <div class="bg-white rounded-lg shadow-sm border border-gray-200">
            <div class="px-4 py-3 border-b border-gray-200">
              <h2 class="text-lg font-medium text-gray-900">当前队伍</h2>
              <p class="text-sm text-gray-500 mt-1">{{ petStorage.teams[petStorage.currentTeamIndex]?.name }}</p>
            </div>
            <div class="p-4">
              <!-- 当前队伍精灵 -->
              <div class="grid grid-cols-2 gap-2 min-h-[200px]">
                <!-- 队伍精灵列表 -->
                <el-tooltip
                  v-for="pet in petStorage.teams[petStorage.currentTeamIndex]?.pets || []"
                  :key="pet.id"
                  placement="top"
                  :show-after="500"
                  :hide-after="0"
                  popper-class="pet-tooltip"
                >
                  <template #content>
                    <div class="pet-tooltip-content">
                      <div class="flex items-center space-x-3 mb-2">
                        <PetIcon :id="gameDataStore.getSpecies(pet.species)?.num" class="w-12 h-12" />
                        <div>
                          <div class="font-semibold text-white">{{ pet.name }}</div>
                          <div class="text-gray-300 text-sm">
                            {{ i18next.t(`${gameDataStore.getSpecies(pet.species)?.id}.name`, { ns: 'species' }) }}
                          </div>
                          <div class="text-gray-400 text-xs">等级 {{ pet.level }}</div>
                        </div>
                      </div>
                      <div class="grid grid-cols-2 gap-2 text-xs">
                        <div class="flex justify-between">
                          <span class="text-gray-300">体力:</span>
                          <span class="text-white font-medium">{{ computePetStat(pet, 'hp') }}</span>
                        </div>
                        <div class="flex justify-between">
                          <span class="text-gray-300">攻击:</span>
                          <span class="text-white font-medium">{{ computePetStat(pet, 'atk') }}</span>
                        </div>
                        <div class="flex justify-between">
                          <span class="text-gray-300">防御:</span>
                          <span class="text-white font-medium">{{ computePetStat(pet, 'def') }}</span>
                        </div>
                        <div class="flex justify-between">
                          <span class="text-gray-300">特攻:</span>
                          <span class="text-white font-medium">{{ computePetStat(pet, 'spa') }}</span>
                        </div>
                        <div class="flex justify-between">
                          <span class="text-gray-300">特防:</span>
                          <span class="text-white font-medium">{{ computePetStat(pet, 'spd') }}</span>
                        </div>
                        <div class="flex justify-between">
                          <span class="text-gray-300">速度:</span>
                          <span class="text-white font-medium">{{ computePetStat(pet, 'spe') }}</span>
                        </div>
                      </div>
                      <div class="mt-2 pt-2 border-t border-gray-600 flex justify-between text-xs">
                        <span class="text-gray-300">
                          性格: <span class="text-white">{{ getNatureText(pet.nature) }}</span>
                        </span>
                        <span class="text-gray-300">
                          性别: <span class="text-white">{{ getGenderText(pet.gender) }}</span>
                        </span>
                      </div>
                      <div v-if="pet.skills && pet.skills.length > 0" class="mt-2 pt-2 border-t border-gray-600">
                        <div class="text-gray-300 text-xs mb-1">技能配招:</div>
                        <div class="flex flex-wrap gap-1">
                          <span
                            v-for="skillId in pet.skills"
                            :key="skillId"
                            class="inline-block px-2 py-1 bg-blue-600 text-white text-xs rounded"
                          >
                            {{ getSkillName(skillId) }}
                          </span>
                        </div>
                      </div>
                    </div>
                  </template>
                  <div
                    :ref="
                      el => {
                        if (el) setupPetInteraction(el, pet, petStorage.currentTeamIndex)
                      }
                    "
                    class="relative bg-white rounded-lg border border-gray-200 p-2 hover:shadow-md transition-all duration-200 group cursor-pointer active:bg-gray-50 touch-manipulation"
                  >
                    <div class="flex flex-col items-center space-y-1">
                      <PetIcon :id="gameDataStore.getSpecies(pet.species)?.num" class="w-8 h-8" />
                      <div class="text-center w-full">
                        <p class="text-xs font-medium text-gray-900 truncate">{{ pet.name }}</p>
                        <p class="text-xs text-gray-500">Lv.{{ pet.level }}</p>
                      </div>
                      <!-- 操作按钮 -->
                      <button
                        @click.stop="handleShowTeamPetContextMenu($event, pet, petStorage.currentTeamIndex)"
                        class="absolute top-1 right-1 p-1 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-full transition-colors duration-200 sm:opacity-0 sm:group-hover:opacity-100 opacity-100"
                        title="更多操作"
                      >
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>
                </el-tooltip>

                <!-- 空槽位 -->
                <div
                  v-for="n in Math.max(0, 6 - (petStorage.teams[petStorage.currentTeamIndex]?.pets.length || 0))"
                  :key="`empty-${n}`"
                  class="bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg p-2 flex items-center justify-center text-gray-400 hover:border-gray-400 transition-colors duration-200"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                    />
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 仓库区域（扩展显示） -->
        <div class="lg:col-span-4">
          <div class="bg-white rounded-lg shadow-sm border border-gray-200">
            <div class="px-6 py-4 border-b border-gray-200">
              <div class="flex items-center justify-between">
                <h2 class="text-lg font-medium text-gray-900">精灵仓库</h2>
                <div class="flex items-center space-x-3">
                  <span class="text-sm text-gray-500">
                    显示 {{ paginatedPets.length }} 只 (共 {{ filteredPets.length }}/{{ petStorage.storage.length }} 只)
                  </span>
                  <!-- 仓库导入导出按钮 -->
                  <div class="flex items-center space-x-2">
                    <button
                      @click="importStorage"
                      class="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                    >
                      <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10"
                        />
                      </svg>
                      导入仓库
                    </button>
                    <!-- 导出下拉菜单 -->
                    <el-dropdown @command="handleExportCommand">
                      <button
                        class="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                      >
                        <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                          />
                        </svg>
                        导出仓库
                        <svg class="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      <template #dropdown>
                        <el-dropdown-menu>
                          <el-dropdown-item command="exportFull">导出完整仓库</el-dropdown-item>
                          <el-dropdown-item command="exportPetsOnly">仅导出精灵</el-dropdown-item>
                        </el-dropdown-menu>
                      </template>
                    </el-dropdown>
                  </div>
                </div>
              </div>
            </div>

            <!-- 搜索和筛选区域 -->
            <div class="px-4 py-3 border-b border-gray-200 bg-gray-50">
              <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <!-- 搜索框 -->
                <div class="lg:col-span-2">
                  <el-input
                    v-model="searchQuery"
                    placeholder="搜索精灵名称或种族..."
                    clearable
                    size="small"
                    class="w-full"
                  >
                    <template #prefix>
                      <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                        />
                      </svg>
                    </template>
                  </el-input>
                </div>

                <!-- 元素类型筛选 -->
                <div>
                  <el-select v-model="filters.element" placeholder="选择元素" clearable size="small" class="w-full">
                    <el-option
                      v-for="element in availableElements"
                      :key="element.value"
                      :label="element.label"
                      :value="element.value"
                    />
                  </el-select>
                </div>

                <!-- 排序选择 -->
                <div class="flex space-x-2">
                  <el-select v-model="sortBy" size="small" class="flex-1">
                    <el-option label="名称" value="name" />
                    <el-option label="等级" value="level" />
                    <el-option label="种族编号" value="speciesNum" />
                    <el-option label="体力" value="hp" />
                    <el-option label="攻击力" value="atk" />
                    <el-option label="防御力" value="def" />
                    <el-option label="特攻" value="spa" />
                    <el-option label="特防" value="spd" />
                    <el-option label="速度" value="spe" />
                  </el-select>
                  <el-button size="small" @click="sortOrder = sortOrder === 'asc' ? 'desc' : 'asc'" class="px-2">
                    <svg
                      v-if="sortOrder === 'asc'"
                      class="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12"
                      />
                    </svg>
                    <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M3 4h13M3 8h9m-9 4h9m5-4v12m0 0l-4-4m4 4l4-4"
                      />
                    </svg>
                  </el-button>
                </div>
              </div>

              <!-- 第二行筛选器 -->
              <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                <!-- 等级范围筛选 -->
                <div class="flex items-center space-x-2">
                  <label class="text-xs font-medium text-gray-600 w-12 flex-shrink-0">等级:</label>
                  <div class="flex items-center space-x-1 flex-1">
                    <el-input-number
                      v-model="filters.levelMin"
                      :min="1"
                      :max="100"
                      size="small"
                      controls-position="right"
                      placeholder="最低"
                      class="flex-1"
                    />
                    <span class="text-gray-400">-</span>
                    <el-input-number
                      v-model="filters.levelMax"
                      :min="1"
                      :max="100"
                      size="small"
                      controls-position="right"
                      placeholder="最高"
                      class="flex-1"
                    />
                  </div>
                </div>

                <!-- 性别筛选 -->
                <div class="flex items-center space-x-2">
                  <label class="text-xs font-medium text-gray-600 w-12 flex-shrink-0">性别:</label>
                  <el-select v-model="filters.gender" placeholder="全部" clearable size="small" class="flex-1">
                    <el-option label="雄性" :value="Gender.Male" />
                    <el-option label="雌性" :value="Gender.Female" />
                    <el-option label="无性别" :value="Gender.NoGender" />
                  </el-select>
                </div>

                <!-- 清除筛选按钮 -->
                <div class="flex justify-end">
                  <el-button size="small" type="info" plain @click="clearFilters" class="text-xs"> 清除筛选 </el-button>
                </div>
              </div>
            </div>

            <!-- 仓库区域 -->
            <div ref="storageContainerRef" class="p-4 min-h-[500px] max-h-[700px] overflow-y-auto">
              <!-- 空仓库提示 -->
              <div
                v-if="petStorage.storage.length === 0"
                class="flex flex-col items-center justify-center h-64 text-gray-500 border-2 border-dashed border-gray-300 rounded-lg"
              >
                <svg class="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                  />
                </svg>
                <p class="text-lg font-medium">仓库为空</p>
                <p class="text-sm">双击队伍精灵或使用右键菜单将精灵移动到仓库</p>
              </div>

              <!-- 无筛选结果提示 -->
              <div
                v-else-if="filteredPets.length === 0"
                class="flex flex-col items-center justify-center h-64 text-gray-500 border-2 border-dashed border-gray-300 rounded-lg"
              >
                <svg class="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
                <p class="text-lg font-medium">没有找到匹配的精灵</p>
                <p class="text-sm">尝试调整搜索条件或清除筛选</p>
              </div>

              <!-- 仓库精灵列表 -->
              <div
                v-else
                :class="[
                  'grid gap-3',
                  viewMode === 'storage' ? 'grid-cols-4 sm:grid-cols-6 lg:grid-cols-8' : 'grid-cols-2 sm:grid-cols-2',
                ]"
              >
                <el-tooltip
                  v-for="pet in paginatedPets"
                  :key="pet.id"
                  placement="top"
                  :show-after="500"
                  :hide-after="0"
                  popper-class="pet-tooltip"
                >
                  <template #content>
                    <div class="pet-tooltip-content">
                      <div class="flex items-center space-x-3 mb-2">
                        <PetIcon :id="gameDataStore.getSpecies(pet.species)?.num" class="w-12 h-12" />
                        <div>
                          <div class="font-semibold text-white">{{ pet.name }}</div>
                          <div class="text-gray-300 text-sm">
                            {{ i18next.t(`${gameDataStore.getSpecies(pet.species)?.id}.name`, { ns: 'species' }) }}
                          </div>
                          <div class="text-gray-400 text-xs">等级 {{ pet.level }}</div>
                        </div>
                      </div>
                      <div class="grid grid-cols-2 gap-2 text-xs">
                        <div class="flex justify-between">
                          <span class="text-gray-300">体力:</span>
                          <span class="text-white font-medium">{{ computePetStat(pet, 'hp') }}</span>
                        </div>
                        <div class="flex justify-between">
                          <span class="text-gray-300">攻击:</span>
                          <span class="text-white font-medium">{{ computePetStat(pet, 'atk') }}</span>
                        </div>
                        <div class="flex justify-between">
                          <span class="text-gray-300">防御:</span>
                          <span class="text-white font-medium">{{ computePetStat(pet, 'def') }}</span>
                        </div>
                        <div class="flex justify-between">
                          <span class="text-gray-300">特攻:</span>
                          <span class="text-white font-medium">{{ computePetStat(pet, 'spa') }}</span>
                        </div>
                        <div class="flex justify-between">
                          <span class="text-gray-300">特防:</span>
                          <span class="text-white font-medium">{{ computePetStat(pet, 'spd') }}</span>
                        </div>
                        <div class="flex justify-between">
                          <span class="text-gray-300">速度:</span>
                          <span class="text-white font-medium">{{ computePetStat(pet, 'spe') }}</span>
                        </div>
                      </div>
                      <div class="mt-2 pt-2 border-t border-gray-600 flex justify-between text-xs">
                        <span class="text-gray-300">
                          性格: <span class="text-white">{{ getNatureText(pet.nature) }}</span>
                        </span>
                        <span class="text-gray-300">
                          性别: <span class="text-white">{{ getGenderText(pet.gender) }}</span>
                        </span>
                      </div>
                      <div v-if="pet.skills && pet.skills.length > 0" class="mt-2 pt-2 border-t border-gray-600">
                        <div class="text-gray-300 text-xs mb-1">技能配招:</div>
                        <div class="flex flex-wrap gap-1">
                          <span
                            v-for="skillId in pet.skills"
                            :key="skillId"
                            class="inline-block px-2 py-1 bg-blue-600 text-white text-xs rounded"
                          >
                            {{ getSkillName(skillId) }}
                          </span>
                        </div>
                      </div>
                    </div>
                  </template>
                  <div
                    :ref="
                      el => {
                        if (el) setupPetInteraction(el, pet)
                      }
                    "
                    class="relative bg-white rounded-lg border border-gray-200 p-2 hover:shadow-md transition-all duration-200 group cursor-pointer active:bg-gray-50 touch-manipulation"
                  >
                    <div class="flex flex-col items-center space-y-1">
                      <PetIcon :id="gameDataStore.getSpecies(pet.species)?.num" class="w-10 h-10" />
                      <div class="text-center w-full">
                        <p class="text-xs font-medium text-gray-900 truncate">{{ pet.name }}</p>
                        <p class="text-xs text-gray-500">Lv.{{ pet.level }}</p>
                        <p class="text-xs text-gray-400 truncate">
                          {{ i18next.t(`${gameDataStore.getSpecies(pet.species)?.id}.name`, { ns: 'species' }) }}
                        </p>
                      </div>

                      <!-- 操作按钮 -->
                      <button
                        @click.stop="handleShowContextMenu($event, pet)"
                        class="absolute top-1 right-1 p-1 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-full transition-colors duration-200 sm:opacity-0 sm:group-hover:opacity-100 opacity-100"
                        title="更多操作"
                      >
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>
                </el-tooltip>
              </div>

              <!-- 仓库分页 -->
              <div v-if="filteredPets.length > storagePagination.pageSize" class="mt-4 flex justify-center">
                <el-pagination
                  v-model:current-page="storagePagination.currentPage"
                  :page-size="storagePagination.pageSize"
                  layout="total, prev, pager, next"
                  :total="filteredPets.length"
                  @current-change="handleStoragePageChange"
                  small
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>

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
                <h4 class="font-medium text-gray-900 mb-2">快捷操作</h4>
                <ul class="space-y-1 list-disc list-inside">
                  <li>双击仓库精灵加入当前队伍</li>
                  <li>双击队伍精灵移入仓库</li>
                  <li>双击队伍容器切换当前队伍</li>
                  <li>右键精灵查看更多操作</li>
                  <li>点击队伍名称编辑名称</li>
                </ul>
              </div>
              <div>
                <h4 class="font-medium text-gray-900 mb-2">队伍管理</h4>
                <ul class="space-y-1 list-disc list-inside">
                  <li>创建多个队伍配置</li>
                  <li>导出/导入队伍文件</li>
                  <li>设置当前使用的队伍</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 右键菜单 -->
    <ContextMenu
      :visible="contextMenu.visible"
      :position="contextMenu.position"
      :menu-items="contextMenu.items"
      @close="closeContextMenu"
    />

    <!-- 精灵详情对话框 -->
    <div v-if="showPetDetail" class="fixed inset-0 z-[9999] overflow-y-auto">
      <div class="flex items-center justify-center min-h-screen p-4">
        <div class="fixed inset-0 bg-black/50 transition-opacity" @click="showPetDetail = false"></div>

        <div
          class="relative bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all max-w-2xl w-full"
        >
          <div class="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
            <div class="flex items-center justify-between mb-4">
              <h3 class="text-lg font-medium text-gray-900">精灵详情</h3>
              <button @click="showPetDetail = false" class="text-gray-400 hover:text-gray-500">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div v-if="selectedPetForDetail" class="space-y-4">
              <div class="flex items-center space-x-4">
                <PetIcon :id="gameDataStore.getSpecies(selectedPetForDetail.species)?.num" class="w-16 h-16" />
                <div>
                  <h4 class="text-xl font-semibold text-gray-900">{{ selectedPetForDetail.name }}</h4>
                  <p class="text-gray-600">
                    {{
                      i18next.t(`${gameDataStore.getSpecies(selectedPetForDetail.species)?.id}.name`, { ns: 'species' })
                    }}
                  </p>
                  <p class="text-sm text-gray-500">等级 {{ selectedPetForDetail.level }}</p>
                </div>
              </div>

              <div class="grid grid-cols-2 gap-4">
                <div>
                  <h5 class="font-medium text-gray-900 mb-2">基础信息</h5>
                  <div class="space-y-1 text-sm">
                    <p>
                      <span class="text-gray-600">性别:</span>
                      {{
                        selectedPetForDetail && selectedPetForDetail.gender !== undefined
                          ? genderMap[selectedPetForDetail.gender]
                          : '未知'
                      }}
                    </p>
                    <p>
                      <span class="text-gray-600">性格:</span>
                      {{
                        selectedPetForDetail && selectedPetForDetail.nature !== undefined
                          ? natureMap[selectedPetForDetail.nature]
                          : '未知'
                      }}
                    </p>
                    <p><span class="text-gray-600">身高:</span> {{ selectedPetForDetail.height }}cm</p>
                    <p><span class="text-gray-600">体重:</span> {{ selectedPetForDetail.weight }}kg</p>
                  </div>
                </div>

                <div>
                  <h5 class="font-medium text-gray-900 mb-2">能力值</h5>
                  <div class="space-y-1 text-sm">
                    <p>
                      <span class="text-gray-600">体力:</span>
                      {{ selectedPetForDetail ? computePetStat(selectedPetForDetail, 'hp') : 0 }}
                    </p>
                    <p>
                      <span class="text-gray-600">攻击:</span>
                      {{ selectedPetForDetail ? computePetStat(selectedPetForDetail, 'atk') : 0 }}
                    </p>
                    <p>
                      <span class="text-gray-600">防御:</span>
                      {{ selectedPetForDetail ? computePetStat(selectedPetForDetail, 'def') : 0 }}
                    </p>
                    <p>
                      <span class="text-gray-600">特攻:</span>
                      {{ selectedPetForDetail ? computePetStat(selectedPetForDetail, 'spa') : 0 }}
                    </p>
                    <p>
                      <span class="text-gray-600">特防:</span>
                      {{ selectedPetForDetail ? computePetStat(selectedPetForDetail, 'spd') : 0 }}
                    </p>
                    <p>
                      <span class="text-gray-600">速度:</span>
                      {{ selectedPetForDetail ? computePetStat(selectedPetForDetail, 'spe') : 0 }}
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <h5 class="font-medium text-gray-900 mb-2">技能</h5>
                <div class="flex flex-wrap gap-2">
                  <span
                    v-for="skillId in selectedPetForDetail?.skills || []"
                    :key="skillId"
                    class="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-800"
                  >
                    {{ i18next.t(`${skillId}.name`, { ns: 'skill' }) }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 仓库导入选项对话框 -->
    <el-dialog
      v-model="showImportDialog"
      title="导入仓库数据"
      width="500px"
      :close-on-click-modal="false"
      :close-on-press-escape="true"
    >
      <div class="space-y-4">
        <div>
          <h4 class="text-sm font-medium text-gray-900 mb-2">导入模式</h4>
          <el-radio-group v-model="importOptions.mode">
            <el-radio value="merge">合并模式</el-radio>
            <el-radio value="replace">替换模式</el-radio>
          </el-radio-group>
          <p class="text-xs text-gray-500 mt-1">
            合并模式：将导入的数据添加到现有数据中<br />
            替换模式：清空现有数据，使用导入的数据替换
          </p>
        </div>

        <div>
          <h4 class="text-sm font-medium text-gray-900 mb-2">导入内容</h4>
          <div class="space-y-2">
            <el-checkbox v-model="importOptions.importStorage">导入仓库精灵</el-checkbox>
            <el-checkbox v-model="importOptions.importTeams">导入队伍配置</el-checkbox>
          </div>
        </div>

        <div v-if="importOptions.mode === 'replace'" class="bg-red-50 border border-red-200 rounded-md p-3">
          <div class="flex">
            <svg class="w-5 h-5 text-red-400 mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
              />
            </svg>
            <div class="text-sm text-red-700">
              <p class="font-medium">警告：替换模式将删除所有现有数据</p>
              <p>此操作无法撤销，请确保已备份重要数据。</p>
            </div>
          </div>
        </div>
      </div>

      <template #footer>
        <div class="flex justify-end space-x-3">
          <el-button @click="cancelImport">取消</el-button>
          <el-button
            type="primary"
            @click="confirmImport"
            :disabled="!importOptions.importStorage && !importOptions.importTeams"
          >
            确认导入
          </el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
/* 移动端触摸优化 */
@media (max-width: 768px) {
  /* 防止移动端选择文本 */
  .cursor-pointer {
    -webkit-user-select: none;
    -moz-user-select: none;
    -ms-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
  }

  /* 优化触摸反馈 */
  .touch-manipulation {
    touch-action: manipulation;
    /* 防止双击缩放 */
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    -khtml-user-select: none;
    -moz-user-select: none;
    -ms-user-select: none;
    user-select: none;
    /* 防止双击事件 */
    pointer-events: auto;
  }

  /* 移动端按钮样式优化 */
  button {
    min-height: 44px; /* iOS 推荐的最小触摸目标 */
  }

  /* 精灵卡片触摸优化 */
  .group {
    -webkit-tap-highlight-color: rgba(59, 130, 246, 0.1);
    /* 防止双击选择和缩放 */
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    -khtml-user-select: none;
    -moz-user-select: none;
    -ms-user-select: none;
    user-select: none;
  }
}
</style>

<script setup lang="ts">
import { ref, computed, nextTick, watch, onMounted, onUnmounted, type ComponentPublicInstance } from 'vue'
import { onLongPress, useEventListener } from '@vueuse/core'
import { nanoid } from 'nanoid'
import { usePetStorageStore } from '../stores/petStorage'
import { usePlayerStore } from '../stores/player'
import { useGameDataStore } from '../stores/gameData'
import { useTranslation } from 'i18next-vue'
import type { PetSchemaType } from '@arcadia-eternity/schema'
import { Gender, Nature, NatureMap, ELEMENT_MAP } from '@arcadia-eternity/const'
import PetIcon from '../components/PetIcon.vue'
import ContextMenu from '../components/ContextMenu.vue'
import { usePetManagement } from '@/composition/usePetManagement'
import { useTeamExport } from '@/composition/useTeamExport'
import { useStorageImportExport } from '@/composition/useStorageImportExport'

const petStorage = usePetStorageStore()
const playerStore = usePlayerStore()
const gameDataStore = useGameDataStore()
const { i18next } = useTranslation()

// 使用组合式函数
const {
  contextMenu,
  showPetDetail,
  selectedPetForDetail,
  importTeam,
  moveToStorage,
  addToCurrentTeam,
  moveToTeam,
  deletePet,
  copyPet,
  showPetDetails,
  showContextMenu,
  showTeamPetContextMenu,
  closeContextMenu,
} = usePetManagement()

const { exportTeam } = useTeamExport()

// 使用仓库导入导出功能
const {
  showImportDialog,
  importOptions,
  importStorage,
  exportFullStorage,
  exportStorageOnly,
  confirmImport,
  cancelImport,
} = useStorageImportExport()

// 导出命令处理
const handleExportCommand = (command: string) => {
  switch (command) {
    case 'exportFull':
      exportFullStorage()
      break
    case 'exportPetsOnly':
      exportStorageOnly()
      break
  }
}

// 简化的移动端交互处理
const handleMobileTap = (pet: PetSchemaType, teamIndex?: number) => {
  console.log('移动端长按处理 - 显示上下文菜单', pet.name, '时间:', Date.now())
  if (!isMobile()) return

  const syntheticEvent = {
    preventDefault: () => {},
    clientX: window.innerWidth / 2,
    clientY: window.innerHeight / 2,
  } as MouseEvent

  if (teamIndex !== undefined) {
    console.log('显示队伍精灵上下文菜单')
    handleShowTeamPetContextMenu(syntheticEvent, pet, teamIndex)
  } else {
    console.log('显示仓库精灵上下文菜单')
    handleShowContextMenu(syntheticEvent, pet)
  }
}

// 简化的双击处理
const handleDoubleTap = (pet: PetSchemaType) => {
  console.log('双击', pet.name)
  const result = findPetById(pet.id)
  if (!result) return

  const { location } = result

  if (location === 'storage') {
    handleAddToCurrentTeam(pet)
  } else {
    handleMoveToStorage(pet.id)
  }
}

// 用于跟踪已设置交互的元素，避免重复设置
const interactionElements = new WeakSet<HTMLElement>()

// 设置精灵交互 - 直接在元素上设置事件
const setupPetInteraction = (
  element: Element | ComponentPublicInstance | null,
  pet: PetSchemaType,
  teamIndex?: number,
) => {
  // 类型检查，确保是 HTMLElement
  if (!element || !(element instanceof HTMLElement)) {
    return
  }

  // 如果已经设置过交互，直接返回
  if (interactionElements.has(element)) {
    return
  }

  // 标记为已设置
  interactionElements.add(element)

  // 长按处理 - 显示上下文菜单
  onLongPress(
    element,
    () => {
      console.log('长按触发 - 显示上下文菜单', pet.name, '时间:', Date.now())
      handleMobileTap(pet, teamIndex)
      // 添加触觉反馈
      if (navigator.vibrate) {
        navigator.vibrate(50)
      }
    },
    { delay: 600 },
  )

  // 双击处理 - 移动精灵
  let clickCount = 0
  let clickTimer: ReturnType<typeof setTimeout> | null = null

  useEventListener(element, 'click', () => {
    if (!isMobile()) {
      // 桌面端不处理点击
      return
    }

    clickCount++

    if (clickCount === 1) {
      clickTimer = setTimeout(() => {
        // 单击 - 不做任何操作，让 tooltip 自然显示
        clickCount = 0
      }, 300)
    } else if (clickCount === 2) {
      // 双击 - 移动精灵
      if (clickTimer) {
        clearTimeout(clickTimer)
        clickTimer = null
      }
      console.log('移动端双击 - 移动精灵', pet.name)
      handleDoubleTap(pet)
      clickCount = 0
    }
  })

  // 桌面端双击处理
  useEventListener(element, 'dblclick', () => {
    if (!isMobile()) {
      handleDoubleTap(pet)
    }
  })

  // 桌面端右键菜单
  useEventListener(element, 'contextmenu', e => {
    if (!isMobile()) {
      e.preventDefault()
      if (teamIndex !== undefined) {
        handleShowTeamPetContextMenu(e as MouseEvent, pet, teamIndex)
      } else {
        handleShowContextMenu(e as MouseEvent, pet)
      }
    }
  })
}

// 响应式状态
const showHelp = ref(false)
const editingIndex = ref(-1)
const tempTeamName = ref('')
const viewMode = ref<'team' | 'storage'>('team') // 视图模式：队伍管理模式或仓库管理模式

// 搜索和筛选状态
const searchQuery = ref('')
const filters = ref({
  element: '',
  levelMin: null as number | null,
  levelMax: null as number | null,
  gender: undefined as Gender | undefined,
})
const sortBy = ref('name')
const sortOrder = ref<'asc' | 'desc'>('asc')

// 容器尺寸监听
const teamContainerRef = ref<HTMLElement>()
const storageContainerRef = ref<HTMLElement>()

// 分页状态
const teamPagination = ref({
  currentPage: 1,
  pageSize: 2, // 初始值，会被自动计算覆盖
})

const storagePagination = ref({
  currentPage: 1,
  pageSize: 6, // 初始值，会被自动计算覆盖
})

// 右键菜单状态已移动到组合式函数中

// 精灵详情状态已移动到组合式函数中

// 统一的交互处理系统已简化，不再需要复杂的配置接口

// 映射对象
const genderMap = {
  [Gender.Male]: '雄性',
  [Gender.Female]: '雌性',
  [Gender.NoGender]: '无性别',
}

const natureMap = {
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

// 计算属性
const totalTeamPets = computed(() => {
  return petStorage.teams.reduce((total, team) => total + team.pets.length, 0)
})

// 可用元素类型选项
const availableElements = computed(() => {
  const elements = new Set<string>()
  petStorage.storage.forEach(pet => {
    const species = gameDataStore.getSpecies(pet.species)
    if (species?.element) {
      elements.add(species.element)
    }
  })

  return Array.from(elements)
    .map(element => ({
      label: ELEMENT_MAP[element]?.name || element,
      value: element,
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
})

// 分页后的队伍列表
const paginatedTeams = computed(() => {
  const teams = petStorage.teams
  const start = (teamPagination.value.currentPage - 1) * teamPagination.value.pageSize
  const end = start + teamPagination.value.pageSize
  return teams.slice(start, end)
})

// 筛选和排序后的精灵列表（不分页）
const filteredPets = computed(() => {
  let pets = [...petStorage.storage]

  // 搜索筛选
  if (searchQuery.value.trim()) {
    const query = searchQuery.value.trim().toLowerCase()
    pets = pets.filter(pet => {
      const species = gameDataStore.getSpecies(pet.species)
      const speciesName = species ? i18next.t(`${species.id}.name`, { ns: 'species' }) : ''
      return pet.name.toLowerCase().includes(query) || speciesName.toLowerCase().includes(query)
    })
  }

  // 元素筛选
  if (filters.value.element) {
    pets = pets.filter(pet => {
      const species = gameDataStore.getSpecies(pet.species)
      return species?.element === filters.value.element
    })
  }

  // 等级筛选
  if (filters.value.levelMin !== null) {
    pets = pets.filter(pet => pet.level >= filters.value.levelMin!)
  }
  if (filters.value.levelMax !== null) {
    pets = pets.filter(pet => pet.level <= filters.value.levelMax!)
  }

  // 性别筛选
  if (filters.value.gender !== undefined) {
    pets = pets.filter(pet => pet.gender === filters.value.gender)
  }

  // 排序
  pets.sort((a, b) => {
    let aValue: any, bValue: any

    switch (sortBy.value) {
      case 'name':
        aValue = a.name
        bValue = b.name
        break
      case 'level':
        aValue = a.level
        bValue = b.level
        break
      case 'speciesNum':
        aValue = gameDataStore.getSpecies(a.species)?.num || 0
        bValue = gameDataStore.getSpecies(b.species)?.num || 0
        break
      case 'hp':
        aValue = computePetStat(a, 'hp')
        bValue = computePetStat(b, 'hp')
        break
      case 'atk':
        aValue = computePetStat(a, 'atk')
        bValue = computePetStat(b, 'atk')
        break
      case 'def':
        aValue = computePetStat(a, 'def')
        bValue = computePetStat(b, 'def')
        break
      case 'spa':
        aValue = computePetStat(a, 'spa')
        bValue = computePetStat(b, 'spa')
        break
      case 'spd':
        aValue = computePetStat(a, 'spd')
        bValue = computePetStat(b, 'spd')
        break
      case 'spe':
        aValue = computePetStat(a, 'spe')
        bValue = computePetStat(b, 'spe')
        break
      default:
        aValue = a.name
        bValue = b.name
    }

    if (typeof aValue === 'string' && typeof bValue === 'string') {
      const result = aValue.localeCompare(bValue)
      return sortOrder.value === 'asc' ? result : -result
    } else {
      const result = aValue - bValue
      return sortOrder.value === 'asc' ? result : -result
    }
  })

  return pets
})

// 分页后的精灵列表
const paginatedPets = computed(() => {
  const pets = filteredPets.value
  const start = (storagePagination.value.currentPage - 1) * storagePagination.value.pageSize
  const end = start + storagePagination.value.pageSize
  return pets.slice(start, end)
})

// 清除筛选
const clearFilters = () => {
  searchQuery.value = ''
  filters.value = {
    element: '',
    levelMin: null,
    levelMax: null,
    gender: undefined,
  }
  sortBy.value = 'name'
  sortOrder.value = 'asc'
  // 重置仓库分页到第一页
  storagePagination.value.currentPage = 1
}

// 分页事件处理
const handleTeamPageChange = (page: number) => {
  teamPagination.value.currentPage = page
}

const handleStoragePageChange = (page: number) => {
  storagePagination.value.currentPage = page
}

// 自动计算分页大小
const calculatePageSizes = () => {
  // 只在队伍管理模式下计算队伍容器分页
  if (viewMode.value === 'team' && teamContainerRef.value) {
    const container = teamContainerRef.value
    const containerHeight = container.clientHeight

    // 每个队伍项的估计高度：内容区域 + 边距
    // 队伍项包含：头部(约60px) + 精灵网格(约120px) + 内边距(32px) + 边框间距(24px)
    const teamItemHeight = 236 // 估计高度
    const maxTeamsPerPage = Math.max(1, Math.floor(containerHeight / teamItemHeight))

    if (maxTeamsPerPage !== teamPagination.value.pageSize) {
      teamPagination.value.pageSize = maxTeamsPerPage
      // 检查分页状态
      nextTick(() => {
        checkAndFixPagination()
      })
    }
  }

  // 计算仓库容器能容纳的精灵数量
  if (storageContainerRef.value) {
    const container = storageContainerRef.value
    const containerWidth = container.clientWidth
    const containerHeight = container.clientHeight - 60 // 减去分页组件高度

    // 根据视图模式调整精灵项尺寸
    let petItemWidth: number
    let petItemHeight: number

    if (viewMode.value === 'storage') {
      // 仓库管理模式：更小的精灵卡片，更多列数
      petItemWidth = 100 // 包含间距，更紧凑
      petItemHeight = 100 // 包含间距，更紧凑
    } else {
      // 队伍管理模式：原有尺寸
      petItemWidth = 132 // 包含间距
      petItemHeight = 112 // 包含间距
    }

    const petsPerRow = Math.max(1, Math.floor(containerWidth / petItemWidth))
    const maxRows = Math.max(1, Math.floor(containerHeight / petItemHeight))
    const maxPetsPerPage = petsPerRow * maxRows

    if (maxPetsPerPage !== storagePagination.value.pageSize) {
      storagePagination.value.pageSize = maxPetsPerPage
      // 检查分页状态
      nextTick(() => {
        checkAndFixPagination()
      })
    }
  }
}

// 防抖函数
const debounce = (func: Function, wait: number) => {
  let timeout: ReturnType<typeof setTimeout>
  return (...args: any[]) => {
    clearTimeout(timeout)
    timeout = setTimeout(() => func.apply(null, args), wait)
  }
}

const debouncedCalculatePageSizes = debounce(calculatePageSizes, 150)

// ResizeObserver 实例
let resizeObserver: ResizeObserver | null = null

// 监听筛选条件变化，重置分页
watch(
  [searchQuery, filters],
  () => {
    storagePagination.value.currentPage = 1
    // 延迟检查分页状态，确保筛选结果已更新
    nextTick(() => {
      checkAndFixPagination()
    })
  },
  { deep: true },
)

// 监听筛选结果变化，重新计算分页
watch(
  filteredPets,
  () => {
    nextTick(() => {
      debouncedCalculatePageSizes()
    })
  },
  { immediate: true },
)

// 监听视图模式变化，重新计算分页大小
watch(viewMode, () => {
  // 重置分页到第一页
  storagePagination.value.currentPage = 1
  teamPagination.value.currentPage = 1

  // 重新计算分页大小
  nextTick(() => {
    debouncedCalculatePageSizes()
  })
})

// 检查并修正分页状态的辅助函数
const checkAndFixPagination = () => {
  // 检查精灵仓库分页 - 如果当前页没有数据且不是第一页，则切换到上一页
  if (paginatedPets.value.length === 0 && storagePagination.value.currentPage > 1) {
    storagePagination.value.currentPage = storagePagination.value.currentPage - 1
  }

  // 检查队伍分页 - 如果当前页没有数据且不是第一页，则切换到上一页
  if (paginatedTeams.value.length === 0 && teamPagination.value.currentPage > 1) {
    teamPagination.value.currentPage = teamPagination.value.currentPage - 1
  }
}

// 生命周期钩子
onMounted(() => {
  // 初始计算
  nextTick(() => {
    calculatePageSizes()
  })

  // 设置 ResizeObserver
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      debouncedCalculatePageSizes()
    })

    // 观察容器尺寸变化
    if (teamContainerRef.value) {
      resizeObserver.observe(teamContainerRef.value)
    }
    if (storageContainerRef.value) {
      resizeObserver.observe(storageContainerRef.value)
    }
  }

  // 监听窗口尺寸变化作为备选方案
  window.addEventListener('resize', debouncedCalculatePageSizes)
})

onUnmounted(() => {
  // 清理 ResizeObserver
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }

  // 移除窗口事件监听
  window.removeEventListener('resize', debouncedCalculatePageSizes)
})

// 队伍名称编辑
const editTeamName = (index: number) => {
  tempTeamName.value = petStorage.teams[index].name
  editingIndex.value = index

  nextTick(() => {
    const input = document.querySelector('input[ref="editInput"]') as HTMLInputElement
    if (input) {
      input.focus()
      input.select()
    }
  })
}

const saveTeamName = (index: number) => {
  if (tempTeamName.value.trim()) {
    petStorage.teams[index].name = tempTeamName.value.trim()
    petStorage.saveToLocal()
  }
  editingIndex.value = -1
}

// 队伍管理
const createNewTeam = () => {
  petStorage.createNewTeam()
  ElMessage.success('队伍创建成功！')
}

const deleteTeam = async (index: number) => {
  if (petStorage.teams.length <= 1) {
    ElMessage.warning('至少需要保留一个队伍')
    return
  }

  try {
    console.log('开始删除队伍确认流程:', petStorage.teams[index].name)

    await ElMessageBox.confirm(`确定要删除队伍 "${petStorage.teams[index].name}" 吗？`, '删除队伍', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
      customStyle: {
        zIndex: '10000', // 确保确认框在最顶层
      },
      // 移动端优化
      center: true,
      showClose: true,
      // 防止被其他事件干扰
      closeOnClickModal: false,
      closeOnPressEscape: true,
      beforeClose: (action, _instance, done) => {
        console.log('队伍删除确认框关闭动作:', action)
        done()
      },
    })

    petStorage.deleteTeam(index)
    petStorage.saveToLocal()

    // 检查并修正分页状态
    nextTick(() => {
      checkAndFixPagination()
    })

    ElMessage.success('队伍删除成功！')
  } catch {
    // 用户取消
  }
}

const setCurrentTeam = (index: number) => {
  closeContextMenu()
  petStorage.currentTeamIndex = index
  petStorage.saveToLocal()
}

// 双击队伍选择当前队伍
const handleTeamDoubleClick = (index: number) => {
  if (index === petStorage.currentTeamIndex) {
    return // 如果已经是当前队伍，不需要操作
  }

  petStorage.switchTeam(index)
  ElMessage.success(`已切换到队伍：${petStorage.teams[index].name}`)
}

// 导出队伍函数已移动到组合式函数中

// 导入队伍函数已移动到组合式函数中

// 检测是否为移动设备
const isMobile = () => {
  return (
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
    window.innerWidth <= 768
  )
}

// 统一的精灵查找函数
const findPetById = (petId: string) => {
  // 先在仓库中查找
  let pet = petStorage.storage.find(p => p.id === petId)
  if (pet) {
    return { pet, location: 'storage' as const }
  }

  // 再在队伍中查找
  for (let i = 0; i < petStorage.teams.length; i++) {
    pet = petStorage.teams[i].pets.find(p => p.id === petId)
    if (pet) {
      return { pet, location: 'team' as const, teamIndex: i }
    }
  }

  return null
}

// 精灵操作函数已移动到组合式函数中，但需要包装以处理缓存清理
const handleMoveToStorage = (petId: string) => {
  moveToStorage(petId, () => {
    nextTick(() => {
      checkAndFixPagination()
    })
  })
}

const handleAddToCurrentTeam = (pet: PetSchemaType) => {
  addToCurrentTeam(pet, () => {
    nextTick(() => {
      checkAndFixPagination()
    })
  })
}

const handleShowContextMenu = (event: MouseEvent, pet: PetSchemaType) => {
  showContextMenu(event, pet)
}

const handleShowTeamPetContextMenu = (event: MouseEvent, pet: PetSchemaType, teamIndex: number) => {
  showTeamPetContextMenu(event, pet, teamIndex)
}

// 复制队伍
const copyTeam = (index: number) => {
  try {
    const originalTeam = petStorage.teams[index]
    if (!originalTeam) {
      ElMessage.error('队伍不存在')
      return
    }

    // 创建新队伍
    const newTeamName = `${originalTeam.name} (副本)`
    petStorage.createNewTeam(newTeamName)
    const newTeamIndex = petStorage.teams.length - 1
    petStorage.teams[newTeamIndex].pets = []

    // 复制队伍中的所有精灵
    originalTeam.pets.forEach(pet => {
      const petCopy = JSON.parse(JSON.stringify(pet))
      petCopy.id = nanoid()
      petCopy.name = `${pet.name} (副本)`

      // 先添加到仓库，再移动到新队伍
      petStorage.storage.push(petCopy)
      petStorage.moveToTeam(petCopy.id, newTeamIndex)
    })

    petStorage.saveToLocal()
    ElMessage.success(`队伍 "${originalTeam.name}" 复制成功！`)
  } catch (error) {
    console.error('队伍复制失败:', error)
    ElMessage.error('队伍复制失败，请重试')
  }
}

// 清理所有数据
const clearAllData = async () => {
  try {
    await ElMessageBox.confirm('此操作将清空所有队伍和仓库数据，无法撤销！确定要继续吗？', '清理所有数据', {
      confirmButtonText: '确定清理',
      cancelButtonText: '取消',
      type: 'warning',
      customStyle: { zIndex: '10000' },
    })

    petStorage.clearStorage()
    ElMessage.success('所有数据已清理完成！')
  } catch {
    // 用户取消操作
  }
}

// 计算精灵能力值
const computePetStat = (pet: PetSchemaType, stat: 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe') => {
  const species = gameDataStore.getSpecies(pet.species)
  if (!species) return 0

  const baseStat = species.baseStats[stat] || 0
  const iv = pet.ivs[stat] || 0
  const ev = pet.evs[stat] || 0
  const level = pet.level

  if (stat === 'hp') {
    return Math.floor(((2 * baseStat + iv + Math.floor(ev / 4)) * level) / 100) + level + 10
  } else {
    const natureMultiplier = NatureMap[pet.nature as Nature]?.[stat] || 1
    return Math.floor((Math.floor(((2 * baseStat + iv + Math.floor(ev / 4)) * level) / 100) + 5) * natureMultiplier)
  }
}

// 获取性别文本
const getGenderText = (gender?: Gender) => {
  if (gender === undefined) return '未知'
  switch (gender) {
    case Gender.Male:
      return '雄性'
    case Gender.Female:
      return '雌性'
    case Gender.NoGender:
      return '无性别'
    default:
      return '未知'
  }
}

// 性格中文映射
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

// 获取性格文本
const getNatureText = (nature: Nature) => {
  return natureChineseMap[nature] || nature
}

// 获取技能名称
const getSkillName = (skillId: string) => {
  return i18next.t(`${skillId}.name`, { ns: 'skill' })
}
</script>

<style scoped>
/* 自定义滚动条 */
.overflow-y-auto::-webkit-scrollbar {
  width: 6px;
}

.overflow-y-auto::-webkit-scrollbar-track {
  background: #f1f1f1;
  border-radius: 3px;
}

.overflow-y-auto::-webkit-scrollbar-thumb {
  background: #c1c1c1;
  border-radius: 3px;
}

.overflow-y-auto::-webkit-scrollbar-thumb:hover {
  background: #a8a8a8;
}

/* 响应式调整 */
@media (max-width: 1024px) {
  .lg\:col-span-3 {
    grid-column: span 1 / span 1;
  }

  .lg\:col-span-1 {
    grid-column: span 1 / span 1;
  }
}

@media (max-width: 768px) {
  .md\:grid-cols-4 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .md\:grid-cols-6 {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

/* 移动端触摸优化 */
.touch-manipulation {
  touch-action: manipulation;
}

/* 确保按钮在移动端可见 */
@media (max-width: 640px) {
  .sm\:opacity-0 {
    opacity: 1 !important;
  }
}

/* 精灵tooltip样式 */
:global(.pet-tooltip) {
  max-width: 320px !important;
}

:global(.pet-tooltip .el-popper__arrow::before) {
  background: rgba(0, 0, 0, 0.9) !important;
  border: 1px solid rgba(255, 255, 255, 0.1) !important;
}

.pet-tooltip-content {
  background: rgba(0, 0, 0, 0.9);
  border-radius: 8px;
  padding: 12px;
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}
</style>
