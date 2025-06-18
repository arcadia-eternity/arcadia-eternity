<template>
  <div class="cache-performance-test">
    <h1>缓存性能测试</h1>
    
    <div class="test-controls">
      <el-form inline>
        <el-form-item label="迭代次数:">
          <el-input-number v-model="iterations" :min="100" :max="10000" :step="100" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="runTest" :loading="testing">
            运行测试
          </el-button>
        </el-form-item>
      </el-form>
    </div>
    
    <div v-if="results" class="test-results">
      <h2>测试结果</h2>
      <el-card>
        <el-descriptions :column="2" border>
          <el-descriptions-item label="旧版本总时间">
            {{ results.oldTime.toFixed(2) }}ms
          </el-descriptions-item>
          <el-descriptions-item label="新版本总时间">
            {{ results.newTime.toFixed(2) }}ms
          </el-descriptions-item>
          <el-descriptions-item label="性能提升">
            <el-tag :type="results.improvement > 0 ? 'success' : 'danger'">
              {{ results.improvement.toFixed(1) }}%
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="速度倍数">
            {{ (results.oldTime / results.newTime).toFixed(2) }}x
          </el-descriptions-item>
          <el-descriptions-item label="旧版本平均">
            {{ results.avgOldTime.toFixed(3) }}ms/次
          </el-descriptions-item>
          <el-descriptions-item label="新版本平均">
            {{ results.avgNewTime.toFixed(3) }}ms/次
          </el-descriptions-item>
        </el-descriptions>
      </el-card>
      
      <div class="chart-container" style="margin-top: 20px;">
        <canvas ref="chartCanvas" width="600" height="300"></canvas>
      </div>
    </div>
    
    <div class="test-info">
      <h3>测试说明</h3>
      <ul>
        <li>旧版本：使用 flatMap、filter 等数组操作，每次都进行深拷贝</li>
        <li>新版本：使用 for 循环一次性收集，智能检测变化，节流更新</li>
        <li>测试数据：2个玩家，每人6只宠物，每只宠物4个技能和2个标记，3个全局标记</li>
        <li>新版本在后续调用中会复用缓存，只更新变化的对象</li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue'
import { runPerformanceTest } from '../utils/cachePerformanceTest'

const iterations = ref(1000)
const testing = ref(false)
const results = ref<any>(null)
const chartCanvas = ref<HTMLCanvasElement>()

async function runTest() {
  testing.value = true
  results.value = null
  
  try {
    // 等待一帧，确保UI更新
    await nextTick()
    
    const testResults = runPerformanceTest(iterations.value)
    results.value = testResults
    
    // 绘制图表
    await nextTick()
    drawChart()
  } catch (error) {
    console.error('测试失败:', error)
  } finally {
    testing.value = false
  }
}

function drawChart() {
  if (!chartCanvas.value || !results.value) return
  
  const canvas = chartCanvas.value
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  
  // 清空画布
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  
  // 设置样式
  ctx.fillStyle = '#f0f0f0'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  
  // 绘制标题
  ctx.fillStyle = '#333'
  ctx.font = '16px Arial'
  ctx.textAlign = 'center'
  ctx.fillText('性能对比图', canvas.width / 2, 30)
  
  // 绘制柱状图
  const barWidth = 100
  const barSpacing = 150
  const maxHeight = 200
  const baseY = 250
  
  const oldTime = results.value.oldTime
  const newTime = results.value.newTime
  const maxTime = Math.max(oldTime, newTime)
  
  // 旧版本柱子
  const oldHeight = (oldTime / maxTime) * maxHeight
  const oldX = canvas.width / 2 - barSpacing / 2 - barWidth / 2
  ctx.fillStyle = '#ff6b6b'
  ctx.fillRect(oldX, baseY - oldHeight, barWidth, oldHeight)
  
  // 新版本柱子
  const newHeight = (newTime / maxTime) * maxHeight
  const newX = canvas.width / 2 + barSpacing / 2 - barWidth / 2
  ctx.fillStyle = '#51cf66'
  ctx.fillRect(newX, baseY - newHeight, barWidth, newHeight)
  
  // 添加标签
  ctx.fillStyle = '#333'
  ctx.font = '12px Arial'
  ctx.textAlign = 'center'
  
  ctx.fillText('旧版本', oldX + barWidth / 2, baseY + 20)
  ctx.fillText(`${oldTime.toFixed(1)}ms`, oldX + barWidth / 2, baseY + 35)
  
  ctx.fillText('新版本', newX + barWidth / 2, baseY + 20)
  ctx.fillText(`${newTime.toFixed(1)}ms`, newX + barWidth / 2, baseY + 35)
  
  // 添加性能提升标注
  ctx.fillStyle = '#28a745'
  ctx.font = 'bold 14px Arial'
  ctx.fillText(`性能提升: ${results.value.improvement.toFixed(1)}%`, canvas.width / 2, baseY + 60)
}
</script>

<style scoped>
.cache-performance-test {
  padding: 20px;
  max-width: 800px;
  margin: 0 auto;
}

.test-controls {
  margin-bottom: 20px;
  padding: 20px;
  background: #f8f9fa;
  border-radius: 8px;
}

.test-results {
  margin-bottom: 20px;
}

.chart-container {
  display: flex;
  justify-content: center;
  padding: 20px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.test-info {
  padding: 20px;
  background: #e3f2fd;
  border-radius: 8px;
  border-left: 4px solid #2196f3;
}

.test-info h3 {
  margin-top: 0;
  color: #1976d2;
}

.test-info ul {
  margin: 10px 0;
  padding-left: 20px;
}

.test-info li {
  margin: 5px 0;
  color: #424242;
}
</style>
