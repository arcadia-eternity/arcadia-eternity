<template>
  <div class="demo-container">
    <div class="demo-header">
      <h1>九帧特效动画组件演示</h1>
      <div class="controls">
        <button @click="playAnimation" :disabled="isAnimationPlaying" class="play-btn">
          {{ isAnimationPlaying ? '播放中...' : '播放动画' }}
        </button>
        <button @click="stopAnimation" :disabled="!isAnimationPlaying" class="stop-btn">停止动画</button>
        <label class="checkbox-label">
          <input type="checkbox" v-model="autoLoop" />
          循环播放
        </label>
      </div>
    </div>

    <!-- 动画容器 -->
    <div class="animation-container">
      <ClimaxEffectAnimation
        ref="animationRef"
        :auto-play="false"
        :loop="autoLoop"
        :frame-duration="frameDuration"
        :on-complete="onAnimationComplete"
      />
    </div>

    <!-- 控制面板 -->
    <div class="control-panel">
      <div class="panel-section">
        <h3>动画控制</h3>
        <div class="control-item">
          <label>帧持续时间 (ms):</label>
          <input type="range" v-model.number="frameDuration" min="50" max="1000" step="50" class="slider" />
          <span class="value">{{ frameDuration }}ms</span>
        </div>
      </div>

      <div class="panel-section">
        <h3>动画信息</h3>
        <div class="info-grid">
          <div class="info-item">
            <span class="label">状态:</span>
            <span class="value" :class="{ playing: isAnimationPlaying }">
              {{ isAnimationPlaying ? '播放中' : '已停止' }}
            </span>
          </div>
          <div class="info-item">
            <span class="label">循环:</span>
            <span class="value">{{ autoLoop ? '开启' : '关闭' }}</span>
          </div>
          <div class="info-item">
            <span class="label">播放次数:</span>
            <span class="value">{{ playCount }}</span>
          </div>
        </div>
      </div>

      <div class="panel-section">
        <h3>使用说明</h3>
        <div class="usage-info">
          <p>• 这是一个基于您调整数据的九帧特效动画组件</p>
          <p>• 可以通过 props 控制自动播放、循环等行为</p>
          <p>• 支持动画完成回调和手动控制播放/停止</p>
          <p>• 可以调整帧持续时间来控制动画速度</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import ClimaxEffectAnimation from '@/components/ClimaxEffectAnimation.vue'

// 响应式数据
const animationRef = ref<InstanceType<typeof ClimaxEffectAnimation>>()
const isAnimationPlaying = ref(false)
const autoLoop = ref(false)
const frameDuration = ref(100)
const playCount = ref(0)

// 播放动画
const playAnimation = () => {
  if (animationRef.value) {
    animationRef.value.play()
    isAnimationPlaying.value = true
  }
}

// 停止动画
const stopAnimation = () => {
  if (animationRef.value) {
    animationRef.value.stop()
    isAnimationPlaying.value = false
  }
}

// 动画完成回调
const onAnimationComplete = () => {
  playCount.value++
  if (!autoLoop.value) {
    isAnimationPlaying.value = false
  }
}
</script>

<style scoped>
.demo-container {
  width: 100vw;
  height: 100vh;
  background: #000;
  color: white;
  font-family: 'Arial', sans-serif;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.demo-header {
  position: absolute;
  top: 20px;
  left: 20px;
  z-index: 100;
}

.demo-header h1 {
  margin: 0 0 15px 0;
  font-size: 24px;
  color: #fff;
  text-shadow: 0 0 10px rgba(255, 255, 255, 0.5);
}

.controls {
  display: flex;
  gap: 15px;
  align-items: center;
  flex-wrap: wrap;
}

.play-btn,
.stop-btn {
  padding: 10px 20px;
  border: none;
  border-radius: 25px;
  color: white;
  font-size: 14px;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.3s ease;
}

.play-btn {
  background: linear-gradient(45deg, #4caf50, #45a049);
  box-shadow: 0 4px 15px rgba(76, 175, 80, 0.3);
}

.stop-btn {
  background: linear-gradient(45deg, #f44336, #d32f2f);
  box-shadow: 0 4px 15px rgba(244, 67, 54, 0.3);
}

.play-btn:hover:not(:disabled),
.stop-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
}

.play-btn:disabled,
.stop-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  cursor: pointer;
}

.checkbox-label input[type='checkbox'] {
  width: 16px;
  height: 16px;
}

.animation-container {
  flex: 1;
  position: relative;
  width: 100%;
  height: 100%;
}

.control-panel {
  position: absolute;
  bottom: 20px;
  right: 20px;
  width: 320px;
  background: rgba(0, 0, 0, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 10px;
  padding: 20px;
  z-index: 100;
}

.panel-section {
  margin-bottom: 20px;
}

.panel-section:last-child {
  margin-bottom: 0;
}

.panel-section h3 {
  margin: 0 0 15px 0;
  font-size: 16px;
  color: #fff;
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
  padding-bottom: 8px;
}

.control-item {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.control-item label {
  font-size: 12px;
  color: #ccc;
  min-width: 120px;
}

.slider {
  flex: 1;
  height: 4px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
  outline: none;
}

.slider::-webkit-slider-thumb {
  appearance: none;
  width: 16px;
  height: 16px;
  background: #4caf50;
  border-radius: 50%;
  cursor: pointer;
}

.control-item .value {
  font-size: 12px;
  color: #4caf50;
  min-width: 60px;
  text-align: right;
}

.info-grid {
  display: grid;
  gap: 8px;
}

.info-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.info-item .label {
  font-size: 12px;
  color: #ccc;
}

.info-item .value {
  font-size: 12px;
  color: #fff;
}

.info-item .value.playing {
  color: #4caf50;
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.6;
  }
}

.usage-info {
  font-size: 12px;
  color: #ccc;
  line-height: 1.5;
}

.usage-info p {
  margin: 8px 0;
}
</style>
