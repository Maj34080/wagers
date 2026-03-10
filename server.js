const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const db = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const JWT_SECRET = process.env.JWT_SECRET || 'wagers_secret_2024';
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve static files
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Leaderboard API
app.get('/api/leaderboard', (req, res) => {
  res.json(db.getLeaderboard());
});

// ─── SOCKET.IO ──────────────────────────────────
const groups = {};
const rooms = {};

function generateCode(len = 6) {
  return Math.random().toString(36).substring(2, 2 + len).toUpperCase();
}

function getGroupBySocket(socketId) {
  return Object.entries(groups).find(([, g]) => g.players.some(p => p.socketId === socketId));
}

function getRoomBySocket(socketId) {
  return Object.entries(rooms).find(([, r]) =>
    r.teams.flat().some(p => p.socketId === socketId)
  );
}

io.on('connection', (socket) => {

  // ── REGISTER ──
  socket.on('register', async ({ pseudo, password }) => {
    try {
      if (!pseudo || !password) return socket.emit('auth_error', 'Champs manquants');
      if (pseudo.length < 3) return socket.emit('auth_error', 'Pseudo trop court (3 min)');
      if (db.getUserByPseudo(pseudo)) return socket.emit('auth_error', 'Pseudo déjà pris');
      const hashed = await bcrypt.hash(password, 10);
      const user = db.createUser(pseudo, hashed);
      socket.userId = user.id;
      socket.pseudo = user.pseudo;
      socket.elo = user.elo;
      socket.emit('auth_ok', { pseudo: user.pseudo, elo: user.elo, wins: user.wins });
    } catch(e) {
      socket.emit('auth_error', 'Erreur serveur: ' + e.message);
    }
  });

  // ── LOGIN ──
  socket.on('login', async ({ pseudo, password }) => {
    try {
      const user = db.getUserByPseudo(pseudo);
      if (!user) return socket.emit('auth_error', 'Pseudo introuvable');
      const valid = await bcrypt.compare(password, user.password);
      if (!valid) return socket.emit('auth_error', 'Mot de passe incorrect');
      socket.userId = user.id;
      socket.pseudo = user.pseudo;
      socket.elo = user.elo;
      socket.emit('auth_ok', { pseudo: user.pseudo, elo: user.elo, wins: user.wins });
    } catch(e) {
      socket.emit('auth_error', 'Erreur serveur: ' + e.message);
    }
  });

  // ── CRÉER UN GROUPE ──
  socket.on('create_group', () => {
    const existing = getGroupBySocket(socket.id);
    if (existing) {
      const [code, group] = existing;
      group.players = group.players.filter(p => p.socketId !== socket.id);
      if (group.players.length === 0) delete groups[code];
    }

    const code = generateCode();
    groups[code] = {
      players: [{ id: socket.userId, pseudo: socket.pseudo, elo: socket.elo, socketId: socket.id }]
    };
    socket.groupCode = code;
    socket.join('group_' + code);
    socket.emit('group_created', { code, players: groups[code].players.map(p => ({ pseudo: p.pseudo, elo: p.elo })) });
  });

  // ── REJOINDRE UN GROUPE ──
  socket.on('join_group', ({ code }) => {
    const group = groups[code.toUpperCase()];
    if (!group) return socket.emit('group_error', 'Code invalide');
    if (group.players.length >= 2) return socket.emit('group_error', 'Groupe complet');
    if (group.players.some(p => p.id === socket.userId)) return socket.emit('group_error', 'Déjà dans ce groupe');

    const existing = getGroupBySocket(socket.id);
    if (existing) {
      const [oldCode, oldGroup] = existing;
      oldGroup.players = oldGroup.players.filter(p => p.socketId !== socket.id);
      if (oldGroup.players.length === 0) delete groups[oldCode];
    }

    group.players.push({ id: socket.userId, pseudo: socket.pseudo, elo: socket.elo, socketId: socket.id });
    socket.groupCode = code.toUpperCase();
    socket.join('group_' + code.toUpperCase());

    const publicPlayers = group.players.map(p => ({ pseudo: p.pseudo, elo: p.elo }));
    io.to('group_' + code.toUpperCase()).emit('group_updated', { players: publicPlayers });
    socket.emit('group_joined', { code: code.toUpperCase(), players: publicPlayers });
  });

  // ── CRÉER UNE ROOM ──
  socket.on('create_room', () => {
    const entry = getGroupBySocket(socket.id);
    if (!entry) return socket.emit('room_error', 'Pas dans un groupe');
    const [code, group] = entry;
    if (group.players.length < 2) return socket.emit('room_error', 'Il faut 2 joueurs dans le groupe');

    let roomId = null;
    let room = null;

    const waiting = Object.entries(rooms).find(([, r]) => r.status === 'waiting');
    if (waiting) {
      [roomId, room] = waiting;
      room.teams[1] = group.players;
      room.status = 'ban_phase';
    } else {
      roomId = 'R' + generateCode(4);
      room = {
        id: roomId,
        teams: [group.players, []],
        chat: [],
        mapBans: { t1: null, t2: null },
        banPhase: 1,
        status: 'waiting'
      };
      rooms[roomId] = room;
    }

    group.players.forEach(p => {
      const s = io.sockets.sockets.get(p.socketId);
      if (s) { s.join('room_' + roomId); s.roomId = roomId; }
    });

    if (room.status === 'ban_phase') {
      const payload = {
        roomId,
        team1: room.teams[0].map(p => ({ pseudo: p.pseudo, elo: p.elo })),
        team2: room.teams[1].map(p => ({ pseudo: p.pseudo, elo: p.elo })),
      };
      io.to('room_' + roomId).emit('room_ready', payload);
      io.to('room_' + roomId).emit('chat_msg', { author: 'Système', team: 'system', text: '🎮 Room créée ! Phase de ban des maps.' });
      io.to('room_' + roomId).emit('ban_phase', { turn: 1 });
    } else {
      socket.emit('room_waiting', { roomId });
    }
  });

  // ── CHAT ──
  socket.on('chat_msg', ({ text }) => {
    if (!socket.roomId) return;
    if (!text || text.trim().length === 0) return;
    if (text.length > 200) return;

    const room = rooms[socket.roomId];
    if (!room) return;

    const team = room.teams[0].some(p => p.id === socket.userId) ? 'team1' : 'team2';
    const msg = { author: socket.pseudo, team, text: text.trim(), time: Date.now() };
    room.chat.push(msg);
    io.to('room_' + socket.roomId).emit('chat_msg', msg);
  });

  // ── BAN DE MAP ──
  socket.on('ban_map', ({ map }) => {
    if (!socket.roomId) return;
    const room = rooms[socket.roomId];
    if (!room || room.status !== 'ban_phase') return;

    const isTeam1 = room.teams[0].some(p => p.id === socket.userId);
    const isTeam2 = room.teams[1].some(p => p.id === socket.userId);

    if (room.banPhase === 1 && !isTeam1) return socket.emit('ban_error', "Ce n'est pas votre tour");
    if (room.banPhase === 2 && !isTeam2) return socket.emit('ban_error', "Ce n'est pas votre tour");

    const MAPS = ['Ascent','Bind','Haven','Icebox','Lotus','Pearl','Split'];
    if (!MAPS.includes(map)) return;
    if (room.mapBans.t1 === map || room.mapBans.t2 === map) return;

    if (room.banPhase === 1) {
      room.mapBans.t1 = map;
      room.banPhase = 2;
      io.to('room_' + socket.roomId).emit('map_banned', { team: 1, map });
      io.to('room_' + socket.roomId).emit('chat_msg', { author: 'Système', team: 'system', text: `❌ Équipe 1 a banni ${map}` });
      io.to('room_' + socket.roomId).emit('ban_phase', { turn: 2 });
    } else if (room.banPhase === 2) {
      room.mapBans.t2 = map;
      room.banPhase = 'done';
      room.status = 'playing';

      const remaining = MAPS.filter(m => m !== room.mapBans.t1 && m !== room.mapBans.t2);
      const chosen = remaining[Math.floor(Math.random() * remaining.length)];
      room.chosenMap = chosen;

      io.to('room_' + socket.roomId).emit('map_banned', { team: 2, map });
      io.to('room_' + socket.roomId).emit('chat_msg', { author: 'Système', team: 'system', text: `❌ Équipe 2 a banni ${map}` });
      io.to('room_' + socket.roomId).emit('map_chosen', { map: chosen });
      io.to('room_' + socket.roomId).emit('chat_msg', { author: 'Système', team: 'system', text: `🗺️ Map jouée : ${chosen} — GO !` });
    }
  });

  // ── RÉSULTAT ──
  socket.on('declare_result', ({ winner }) => {
    if (!socket.roomId) return;
    const room = rooms[socket.roomId];
    if (!room || room.status !== 'playing') return;
    if (room.resultDeclared) return;
    room.resultDeclared = true;
    room.status = 'finished';

    const winTeam = winner === 1 ? room.teams[0] : room.teams[1];
    const loseTeam = winner === 1 ? room.teams[1] : room.teams[0];

    winTeam.forEach(p => db.updateUserElo(p.id, +20, true));
    loseTeam.forEach(p => db.updateUserElo(p.id, -20, false));

    io.to('room_' + socket.roomId).emit('game_result', {
      winner,
      winTeam: winTeam.map(p => p.pseudo),
      loseTeam: loseTeam.map(p => p.pseudo),
    });

    setTimeout(() => { delete rooms[socket.roomId]; }, 30000);
  });

  // ── DÉCONNEXION ──
  socket.on('disconnect', () => {
    const groupEntry = getGroupBySocket(socket.id);
    if (groupEntry) {
      const [code, group] = groupEntry;
      group.players = group.players.filter(p => p.socketId !== socket.id);
      if (group.players.length === 0) delete groups[code];
      else io.to('group_' + code).emit('group_updated', { players: group.players.map(p => ({ pseudo: p.pseudo, elo: p.elo })) });
    }
  });
});

server.listen(PORT, () => {
  console.log(`✅ Serveur WAGERS lancé sur http://localhost:${PORT}`);
});