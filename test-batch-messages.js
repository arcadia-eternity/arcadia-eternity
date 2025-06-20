// 简单测试批量消息功能
const { BattleClient } = require('./packages/client/dist/client.js')

// 模拟测试
async function testBatchMessages() {
  console.log('Testing batch message functionality...')
  
  // 创建模拟的BattleClient
  const client = new BattleClient({
    serverUrl: 'http://localhost:3000',
    autoReconnect: false
  })
  
  let receivedMessages = []
  let batchCount = 0
  
  // 监听单个battleEvent
  client.on('battleEvent', (message) => {
    receivedMessages.push(message)
    console.log(`Received single message: ${message.type}`)
  })
  
  // 监听批量battleEventBatch (这个在实际使用中不会被外部监听，但用于测试)
  client.on('battleEventBatch', (messages) => {
    batchCount++
    console.log(`Received batch with ${messages.length} messages`)
    messages.forEach((msg, index) => {
      console.log(`  Batch message ${index + 1}: ${msg.type}`)
    })
  })
  
  // 模拟接收批量消息
  const mockBatchMessages = [
    { type: 'SKILL_USE', data: { user: 'pet1', skill: 'skill1' } },
    { type: 'DAMAGE', data: { target: 'pet2', damage: 50 } },
    { type: 'HP_CHANGE', data: { pet: 'pet2', before: 100, after: 50 } }
  ]
  
  // 模拟Socket.IO事件触发
  console.log('\nSimulating batch message reception...')
  client.socket.emit('battleEventBatch', mockBatchMessages)
  
  // 等待处理
  await new Promise(resolve => setTimeout(resolve, 100))
  
  console.log(`\nResults:`)
  console.log(`- Received ${receivedMessages.length} individual messages`)
  console.log(`- Received ${batchCount} batches`)
  console.log(`- Expected: 3 individual messages from 1 batch`)
  
  if (receivedMessages.length === 3 && batchCount === 1) {
    console.log('✅ Batch message test PASSED')
  } else {
    console.log('❌ Batch message test FAILED')
  }
}

// 如果直接运行此文件
if (require.main === module) {
  testBatchMessages().catch(console.error)
}

module.exports = { testBatchMessages }
