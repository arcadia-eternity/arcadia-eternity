// server.ts
import express from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import { Battle } from '@core/battle.js';
import { Player } from '@core/player.js';
import { Pet } from '@core/pet.js';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

// 房间和匹配系统
const matchQueue: string[] = [];
const rooms = new Map<string, { 
  battle: Battle;
  playerA: Player;
  playerB: Player;
}>();

io.on('connection', (socket: Socket) => {
  console.log(`用户连接: ${socket.id}`);

  // 加入匹配队列
  socket.on('match', () => {
    matchQueue.push(socket.id);
    attemptMatch();
  });

  // 玩家操作处理
  socket.on('action', (data: { type: string; target?: string }) => {
    const room = [...rooms.entries()]
      .find(([_, room]) => 
        room.playerA.id === socket.id || 
        room.playerB.id === socket.id
      )?.[1];

    if (!room) return;

    const player = room.playerA.id === socket.id ? room.playerA : room.playerB;
    
    // 处理选择逻辑（需补充完整）
    switch (data.type) {
      case 'skill':
        player.setSelection(new UseSkillSelection(...));
        break;
      case 'switch':
        player.setSelection(new SwitchPetSelection(...));
        break;
    }

    // 广播操作
    io.to(roomId).emit('action', { player: socket.id, action: data });
  });

  socket.on('disconnect', () => {
    console.log(`用户断开: ${socket.id}`);
    // 处理断线逻辑
  });
});

function attemptMatch() {
  while (matchQueue.length >= 2) {
    const [player1, player2] = matchQueue.splice(0, 2);
    createRoom(player1, player2);
  }
}

function createRoom(player1Id: string, player2Id: string) {
  const roomId = `room_${Date.now()}`;
  
  // 初始化玩家和战斗
  const playerA = new Player("PlayerA", player1Id, samplePets);
  const playerB = new Player("PlayerB", player2Id, samplePets);
  const battle = new Battle(playerA, playerB);

  rooms.set(roomId, { battle, playerA, playerB });

  // 加入房间
  io.sockets.get(player1Id)?.join(roomId);
  io.sockets.get(player2Id)?.join(roomId);

  // 发送初始化数据
  io.to(roomId).emit('start', {
    roomId,
    players: {
      [player1Id]: playerA.toMessage(),
      [player2Id]: playerB.toMessage()
    }
  });

  // 启动游戏循环
  gameLoop(roomId);
}

async function gameLoop(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;

  const generator = room.battle.startBattle();
  while (!generator.done) {
    // 等待双方操作
    await new Promise(resolve => {
      const check = () => {
        if (room.playerA.selection && room.playerB.selection) {
          resolve(true);
          io.to(roomId).off('action', check);
        }
      };
      io.to(roomId).on('action', check);
    });

    // 执行回合逻辑
    generator.next();
    
    // 广播状态
    io.to(roomId).emit('update', room.battle.toMessage());
  }
}

server.listen(3000, () => {
  console.log('服务器运行在:3000');
});