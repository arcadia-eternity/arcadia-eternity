<template>
  <div class="min-h-screen bg-gray-50">
    <!-- 头部导航 -->
    <header class="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-40">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="flex items-center justify-between h-16">
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
            <div class="hidden sm:block">
              <span
                class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800"
              >
                {{ playerStore.name || '未命名训练师' }}
              </span>
            </div>
          </div>
          <div class="flex items-center space-x-3">
            <span class="text-sm text-gray-500"> 总计: {{ petStorage.storage.length + totalTeamPets }} 只精灵 </span>
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
      <div class="grid grid-cols-1 lg:grid-cols-4 gap-6">
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
                    <div
                      v-for="pet in team.pets"
                      :key="pet.id"
                      @click="
                        event =>
                          handlePetInteraction(event, pet.id, 'click', () =>
                            createTeamPetHandler(pet.id, petStorage.teams.indexOf(team)),
                          )
                      "
                      @dblclick.stop="
                        event =>
                          handlePetInteraction(event, pet.id, 'dblclick', () =>
                            createTeamPetHandler(pet.id, petStorage.teams.indexOf(team)),
                          )
                      "
                      @contextmenu.prevent="
                        event =>
                          handlePetInteraction(event, pet.id, 'contextmenu', () =>
                            createTeamPetHandler(pet.id, petStorage.teams.indexOf(team)),
                          )
                      "
                      @touchstart="
                        event =>
                          handlePetInteraction(event, pet.id, 'touchstart', () =>
                            createTeamPetHandler(pet.id, petStorage.teams.indexOf(team)),
                          )
                      "
                      @touchend="
                        event =>
                          handlePetInteraction(event, pet.id, 'touchend', () =>
                            createTeamPetHandler(pet.id, petStorage.teams.indexOf(team)),
                          )
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
                          @click.stop="showTeamPetContextMenu($event, pet, petStorage.teams.indexOf(team))"
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
                <span class="text-sm text-gray-500 hidden sm:inline">
                  显示 {{ paginatedPets.length }} 只 (共 {{ filteredPets.length }}/{{ petStorage.storage.length }} 只)
                </span>
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
                <div
                  v-for="pet in paginatedPets"
                  :key="pet.id"
                  @click="event => handlePetInteraction(event, pet.id, 'click', () => createStoragePetHandler(pet.id))"
                  @dblclick.stop="
                    event => handlePetInteraction(event, pet.id, 'dblclick', () => createStoragePetHandler(pet.id))
                  "
                  @contextmenu.prevent="
                    event => handlePetInteraction(event, pet.id, 'contextmenu', () => createStoragePetHandler(pet.id))
                  "
                  @touchstart="
                    event => handlePetInteraction(event, pet.id, 'touchstart', () => createStoragePetHandler(pet.id))
                  "
                  @touchend="
                    event => handlePetInteraction(event, pet.id, 'touchend', () => createStoragePetHandler(pet.id))
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
                      @click.stop="showContextMenu($event, pet)"
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
import { ref, computed, nextTick, watch, onMounted, onUnmounted } from 'vue'
import { nanoid } from 'nanoid'
import { usePetStorageStore } from '../stores/petStorage'
import { usePlayerStore } from '../stores/player'
import { useGameDataStore } from '../stores/gameData'
import { useTranslation } from 'i18next-vue'
import type { PetSchemaType } from '@arcadia-eternity/schema'
import { Gender, Nature, NatureMap, ELEMENT_MAP } from '@arcadia-eternity/const'
import PetIcon from '../components/PetIcon.vue'
import ContextMenu from '../components/ContextMenu.vue'

const petStorage = usePetStorageStore()
const playerStore = usePlayerStore()
const gameDataStore = useGameDataStore()
const { i18next } = useTranslation()

// 响应式状态
const showHelp = ref(false)
const editingIndex = ref(-1)
const tempTeamName = ref('')

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

// 右键菜单状态
const contextMenu = ref({
  visible: false,
  position: { x: 0, y: 0 },
  items: [] as any[],
})

// 精灵详情状态
const showPetDetail = ref(false)
const selectedPetForDetail = ref<PetSchemaType | null>(null)

// 统一的交互处理系统
interface InteractionConfig {
  onSingleTap?: () => void
  onDoubleTap?: () => void
  onLongPress?: () => void
  onContextMenu?: (event: MouseEvent) => void
  cooldownMs?: number
}

// 创建交互处理器
const createInteractionHandler = (config: InteractionConfig) => {
  let tapCount = 0
  let lastTapTime = 0
  let lastTapTarget: string | null = null
  let longPressTimer: NodeJS.Timeout | null = null
  let singleTapTimer: NodeJS.Timeout | null = null
  let isProcessing = false

  const DOUBLE_TAP_DELAY = 300
  const LONG_PRESS_DELAY = 500
  const DEFAULT_COOLDOWN = 300

  const cooldown = config.cooldownMs || DEFAULT_COOLDOWN

  const reset = () => {
    tapCount = 0
    lastTapTime = 0
    lastTapTarget = null
    isProcessing = false
    if (longPressTimer) {
      clearTimeout(longPressTimer)
      longPressTimer = null
    }
    if (singleTapTimer) {
      clearTimeout(singleTapTimer)
      singleTapTimer = null
    }
  }

  const handleStart = (_event: TouchEvent | MouseEvent, targetId: string) => {
    const now = Date.now()
    const isSameTarget = lastTapTarget === targetId
    const isWithinDelay = now - lastTapTime < DOUBLE_TAP_DELAY

    // 清除之前的定时器
    if (longPressTimer) {
      clearTimeout(longPressTimer)
      longPressTimer = null
    }
    if (singleTapTimer) {
      clearTimeout(singleTapTimer)
      singleTapTimer = null
    }

    // 检测双击
    if (isSameTarget && isWithinDelay && tapCount === 1 && !isProcessing) {
      // 这是第二次点击，触发双击
      tapCount = 2
      if (config.onDoubleTap) {
        isProcessing = true
        config.onDoubleTap()
        setTimeout(reset, cooldown)
        return
      }
    } else if (!isProcessing) {
      // 这是第一次点击或不同目标
      tapCount = 1
      lastTapTarget = targetId
      lastTapTime = now

      // 设置长按定时器
      if (config.onLongPress) {
        longPressTimer = setTimeout(() => {
          if (tapCount === 1 && !isProcessing && lastTapTarget === targetId) {
            isProcessing = true
            config.onLongPress!()
            setTimeout(reset, cooldown)
          }
        }, LONG_PRESS_DELAY)
      }

      // 设置单击延迟检测
      if (config.onSingleTap) {
        singleTapTimer = setTimeout(() => {
          if (tapCount === 1 && !isProcessing && lastTapTarget === targetId) {
            config.onSingleTap!()
            reset()
          }
        }, DOUBLE_TAP_DELAY + 50)
      }
    }
  }

  const handleEnd = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer)
      longPressTimer = null
    }
  }

  const handleDoubleClick = (_targetId: string) => {
    // 桌面端双击处理 - 强制重置状态后执行
    if (!isMobile() && config.onDoubleTap) {
      reset() // 先重置状态
      config.onDoubleTap()
    }
  }

  const handleContextMenu = (event: MouseEvent) => {
    if (config.onContextMenu) {
      event.preventDefault()
      config.onContextMenu(event)
    }
  }

  return {
    handleStart,
    handleEnd,
    handleDoubleClick,
    handleContextMenu,
    reset,
  }
}

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
  // 计算队伍容器能容纳的队伍数量
  if (teamContainerRef.value) {
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

    // 精灵项的尺寸：每个精灵卡片约 120px 宽 + 12px 间距，约 100px 高 + 12px 间距
    const petItemWidth = 132 // 包含间距
    const petItemHeight = 112 // 包含间距

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
  let timeout: NodeJS.Timeout
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

  // 清理所有交互处理器缓存
  resetAllHandlerCaches()
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
    await ElMessageBox.confirm(`确定要删除队伍 "${petStorage.teams[index].name}" 吗？`, '删除队伍', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
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

// 导出队伍
const exportTeam = (index: number) => {
  try {
    const team = petStorage.teams[index]
    if (!team || team.pets.length === 0) {
      ElMessage.warning('队伍为空，无法导出')
      return
    }

    const teamData = {
      name: team.name,
      pets: team.pets,
    }

    const dataStr = JSON.stringify(teamData, null, 2)
    const dataBlob = new Blob([dataStr], { type: 'application/json' })
    const url = URL.createObjectURL(dataBlob)

    const link = document.createElement('a')
    link.href = url
    link.download = `${team.name}.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)

    ElMessage.success('队伍导出成功！')
  } catch (error) {
    console.error('导出失败:', error)
    ElMessage.error('导出失败，请重试')
  }
}

// 导入队伍
const importTeam = () => {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json'

  input.onchange = event => {
    const file = (event.target as HTMLInputElement).files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = e => {
      try {
        const teamData = JSON.parse(e.target?.result as string)

        if (!teamData.name || !Array.isArray(teamData.pets)) {
          throw new Error('无效的队伍文件格式')
        }

        petStorage.createNewTeam(teamData.name)
        const newTeamIndex = petStorage.teams.length - 1

        teamData.pets.forEach((pet: PetSchemaType) => {
          // 为导入的精灵生成新的ID，避免冲突
          const petCopy = { ...pet, id: nanoid() }
          petStorage.storage.push(petCopy)
          petStorage.moveToTeam(petCopy.id, newTeamIndex)
        })

        // moveToTeam 已经包含了 saveToLocal，但这里需要额外保存storage的变化
        petStorage.saveToLocal()
        ElMessage.success(`成功导入队伍 "${teamData.name}"！`)
      } catch (error) {
        console.error('导入失败:', error)
        ElMessage.error('导入失败：文件格式错误或数据无效')
      }
    }
    reader.readAsText(file)
  }

  input.click()
}

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

// 创建队伍精灵交互处理器 - 使用petId动态获取最新精灵对象
const createTeamPetHandler = (petId: string, _teamIndex: number) => {
  return createInteractionHandler({
    onSingleTap: () => {
      // 使用统一的精灵查找函数
      const result = findPetById(petId)
      if (!result) return

      const { pet, location, teamIndex: foundTeamIndex } = result

      if (isMobile()) {
        const syntheticEvent = {
          preventDefault: () => {},
          clientX: window.innerWidth / 2,
          clientY: window.innerHeight / 2,
        } as MouseEvent

        if (location === 'team' && foundTeamIndex !== undefined) {
          showTeamPetContextMenu(syntheticEvent, pet, foundTeamIndex)
        } else {
          showContextMenu(syntheticEvent, pet)
        }
      }
    },
    onDoubleTap: () => {
      // 使用统一的精灵查找函数
      const result = findPetById(petId)
      if (!result) return

      const { pet, location } = result

      if (location === 'team') {
        moveToStorage(petId)
      } else {
        addToCurrentTeam(pet)
      }
    },
    onLongPress: () => {
      // 使用统一的精灵查找函数
      const result = findPetById(petId)
      if (!result) return

      const { pet, location, teamIndex: foundTeamIndex } = result
      const syntheticEvent = {
        preventDefault: () => {},
        clientX: window.innerWidth / 2,
        clientY: window.innerHeight / 2,
      } as MouseEvent

      if (location === 'team' && foundTeamIndex !== undefined) {
        showTeamPetContextMenu(syntheticEvent, pet, foundTeamIndex)
      } else {
        showContextMenu(syntheticEvent, pet)
      }

      // 添加触觉反馈
      if (navigator.vibrate) {
        navigator.vibrate(50)
      }
    },
    onContextMenu: (event: MouseEvent) => {
      // 使用统一的精灵查找函数
      const result = findPetById(petId)
      if (!result) return

      const { pet, location, teamIndex: foundTeamIndex } = result

      if (location === 'team' && foundTeamIndex !== undefined) {
        showTeamPetContextMenu(event, pet, foundTeamIndex)
      } else {
        showContextMenu(event, pet)
      }
    },
  })
}

// 创建仓库精灵交互处理器 - 使用petId动态获取最新精灵对象
const createStoragePetHandler = (petId: string) => {
  return createInteractionHandler({
    onSingleTap: () => {
      // 使用统一的精灵查找函数
      const result = findPetById(petId)
      if (!result) return

      const { pet, location, teamIndex: foundTeamIndex } = result

      if (isMobile()) {
        const syntheticEvent = {
          preventDefault: () => {},
          clientX: window.innerWidth / 2,
          clientY: window.innerHeight / 2,
        } as MouseEvent

        if (location === 'team' && foundTeamIndex !== undefined) {
          showTeamPetContextMenu(syntheticEvent, pet, foundTeamIndex)
        } else {
          showContextMenu(syntheticEvent, pet)
        }
      }
    },
    onDoubleTap: () => {
      // 使用统一的精灵查找函数
      const result = findPetById(petId)
      if (!result) return

      const { pet, location } = result

      if (location === 'storage') {
        addToCurrentTeam(pet)
      } else {
        moveToStorage(petId)
      }
    },
    onLongPress: () => {
      // 使用统一的精灵查找函数
      const result = findPetById(petId)
      if (!result) return

      const { pet, location, teamIndex: foundTeamIndex } = result
      const syntheticEvent = {
        preventDefault: () => {},
        clientX: window.innerWidth / 2,
        clientY: window.innerHeight / 2,
      } as MouseEvent

      if (location === 'team' && foundTeamIndex !== undefined) {
        showTeamPetContextMenu(syntheticEvent, pet, foundTeamIndex)
      } else {
        showContextMenu(syntheticEvent, pet)
      }

      // 添加触觉反馈
      if (navigator.vibrate) {
        navigator.vibrate(50)
      }
    },
    onContextMenu: (event: MouseEvent) => {
      // 使用统一的精灵查找函数
      const result = findPetById(petId)
      if (!result) return

      const { pet, location, teamIndex: foundTeamIndex } = result

      if (location === 'team' && foundTeamIndex !== undefined) {
        showTeamPetContextMenu(event, pet, foundTeamIndex)
      } else {
        showContextMenu(event, pet)
      }
    },
  })
}

// 全局交互处理器缓存 - 使用更智能的缓存策略
const interactionHandlers = new Map<string, ReturnType<typeof createInteractionHandler>>()

// 获取或创建交互处理器，但允许更新精灵引用
const getOrCreateHandler = (petId: string, handlerFactory: () => ReturnType<typeof createInteractionHandler>) => {
  let handler = interactionHandlers.get(petId)
  if (!handler) {
    handler = handlerFactory()
    interactionHandlers.set(petId, handler)
  }
  return handler
}

// 清除特定精灵的交互处理器缓存
const clearPetHandlerCache = (petId: string) => {
  if (interactionHandlers.has(petId)) {
    // 先重置处理器状态，再删除缓存
    const handler = interactionHandlers.get(petId)
    if (handler) {
      handler.reset()
    }
    interactionHandlers.delete(petId)
  }
}

// 强制重置所有交互处理器缓存
const resetAllHandlerCaches = () => {
  interactionHandlers.forEach(handler => {
    handler.reset()
  })
  interactionHandlers.clear()
}

// 统一的事件处理函数
const handlePetInteraction = (
  event: Event,
  petId: string,
  eventType: 'click' | 'dblclick' | 'contextmenu' | 'touchstart' | 'touchend',
  handlerFactory: () => ReturnType<typeof createInteractionHandler>,
) => {
  // 获取或创建处理器，保持状态连续性
  const handler = getOrCreateHandler(petId, handlerFactory)

  // 根据事件类型调用相应的处理方法
  switch (eventType) {
    case 'click':
      // 桌面端单击不做处理，移动端在touchstart中处理
      break
    case 'dblclick':
      handler.handleDoubleClick(petId)
      break
    case 'contextmenu':
      handler.handleContextMenu(event as MouseEvent)
      break
    case 'touchstart':
      if (isMobile()) {
        event.preventDefault() // 防止触发原生双击
        handler.handleStart(event as TouchEvent, petId)
      }
      break
    case 'touchend':
      if (isMobile()) {
        handler.handleEnd()
      }
      break
  }
}

// 精灵操作
const moveToStorage = (petId: string) => {
  // moveToPC 现在返回 boolean 表示是否成功
  const success = petStorage.moveToPC(petId)

  if (success) {
    // 清除交互处理器缓存，确保下次使用最新的精灵对象
    clearPetHandlerCache(petId)

    // 检查并修正分页状态
    nextTick(() => {
      checkAndFixPagination()
    })

    ElMessage.success('精灵已移入仓库')
  } else {
    ElMessage.error('移动精灵失败，请重试')
  }
}

const addToCurrentTeam = (pet: PetSchemaType) => {
  const currentTeam = petStorage.teams[petStorage.currentTeamIndex]
  if (currentTeam.pets.length >= 6) {
    ElMessage.warning('当前队伍已满')
    return
  }

  // 检查精灵是否存在（在仓库或其他队伍中）
  const petInStorage = petStorage.storage.find(p => p.id === pet.id)
  const petInTeams = petStorage.teams.some(team => team.pets.some(p => p.id === pet.id))

  if (!petInStorage && !petInTeams) {
    ElMessage.error('精灵不存在')
    return
  }

  try {
    // moveToTeam 现在返回 boolean 表示是否成功
    const success = petStorage.moveToTeam(pet.id, petStorage.currentTeamIndex)

    if (success) {
      // 清除交互处理器缓存，确保下次使用最新的精灵对象
      clearPetHandlerCache(pet.id)

      // 检查并修正分页状态
      nextTick(() => {
        checkAndFixPagination()
      })

      ElMessage.success(`精灵 ${pet.name} 已加入队伍`)
    } else {
      ElMessage.error('移动精灵失败，请重试')
    }
  } catch (error) {
    ElMessage.error('移动精灵失败，请重试')
  }
}

const deletePet = async (petId: string) => {
  try {
    await ElMessageBox.confirm('确定要永久删除此精灵吗？此操作无法撤销！', '删除精灵', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })

    petStorage.removeFromStorage(petId)
    petStorage.saveToLocal()

    // 检查并修正分页状态
    nextTick(() => {
      checkAndFixPagination()
    })

    ElMessage.success('精灵删除成功')
  } catch {
    // 用户取消
  }
}

// 右键菜单相关函数
const showContextMenu = (event: MouseEvent, pet: PetSchemaType) => {
  event.preventDefault()

  const currentTeam = petStorage.teams[petStorage.currentTeamIndex]
  const canAddToTeam = currentTeam.pets.length < 6

  contextMenu.value = {
    visible: true,
    position: { x: event.clientX, y: event.clientY },
    items: [
      {
        label: '快速移动到当前队伍',
        iconPath: 'M17 8l4 4m0 0l-4 4m4-4H3',
        action: () => addToCurrentTeam(pet),
        disabled: !canAddToTeam,
      },
      {
        label: '查看详情',
        iconPath:
          'M15 12a3 3 0 11-6 0 3 3 0 016 0zM2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z',
        action: () => showPetDetails(pet),
      },
      {
        label: '复制精灵',
        iconPath:
          'M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z',
        action: () => copyPet(pet),
      },
      {
        label: '永久删除',
        iconPath:
          'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16',
        action: () => deletePet(pet.id),
        danger: true,
      },
    ],
  }
}

// 队伍精灵右键菜单
const showTeamPetContextMenu = (event: MouseEvent, pet: PetSchemaType, teamIndex: number) => {
  event.preventDefault()

  const otherTeams = petStorage.teams.filter((_, index) => index !== teamIndex && _.pets.length < 6)

  const menuItems = [
    {
      label: '查看详情',
      iconPath:
        'M15 12a3 3 0 11-6 0 3 3 0 016 0zM2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z',
      action: () => showPetDetails(pet),
    },
    {
      label: '复制精灵',
      iconPath:
        'M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z',
      action: () => copyPet(pet),
    },
    {
      label: '移回仓库',
      iconPath: 'M7 16l-4-4m0 0l4-4m-4 4h18',
      action: () => moveToStorage(pet.id),
    },
  ]

  // 添加移动到其他队伍的选项
  otherTeams.forEach(team => {
    const realIndex = petStorage.teams.findIndex(t => t === team)
    menuItems.splice(-1, 0, {
      label: `移动到 ${team.name}`,
      iconPath: 'M17 8l4 4m0 0l-4 4m4-4H3',
      action: () => moveToTeam(pet.id, realIndex),
    })
  })

  contextMenu.value = {
    visible: true,
    position: { x: event.clientX, y: event.clientY },
    items: menuItems,
  }
}

const closeContextMenu = () => {
  contextMenu.value.visible = false
}

// 移动精灵到指定队伍
const moveToTeam = (petId: string, teamIndex: number) => {
  // moveToTeam 已经包含了 saveToLocal()
  petStorage.moveToTeam(petId, teamIndex)

  // 清除交互处理器缓存，确保下次使用最新的精灵对象
  clearPetHandlerCache(petId)

  // 检查并修正分页状态
  nextTick(() => {
    checkAndFixPagination()
  })

  ElMessage.success(`精灵已移动到 ${petStorage.teams[teamIndex].name}`)
}

// 精灵详情
const showPetDetails = (pet: PetSchemaType) => {
  selectedPetForDetail.value = pet
  showPetDetail.value = true
}

// 复制精灵
const copyPet = (pet: PetSchemaType) => {
  try {
    const petCopy = JSON.parse(JSON.stringify(pet))
    petCopy.id = nanoid()
    petCopy.name = `${pet.name} (副本)`

    petStorage.storage.push(petCopy)
    petStorage.saveToLocal()
    ElMessage.success('精灵复制成功！')
  } catch (error) {
    console.error('复制失败:', error)
    ElMessage.error('复制失败，请重试')
  }
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
</style>
