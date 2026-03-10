const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  transports: ['polling', 'websocket']
});

const PORT = process.env.PORT || 3000;
const MAPS = ['Ascent', 'Bind', 'Haven', 'Icebox', 'Lotus', 'Pearl', 'Split'];
const BAN_TIMEOUT = 15000;
const START_COUNTDOWN = 5000;
const ADMIN_PSEUDOS = ['Karim34']; // ← ajoute ton pseudo ici

app.use(express.json());
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/api/leaderboard/:mode', (req, res) => res.json(db.getLeaderboard(req.params.mode)));

// Avatar upload
app.post('/api/avatar', express.json({ limit: '2mb' }), (req, res) => {
  const { userId, avatar } = req.body;
  if (!userId || !avatar) return res.status(400).json({ error: 'Manquant' });
  db.updateAvatar(userId, avatar);
  res.json({ ok: true });
});

const groups = {};
const rooms = {};

function generateCode(len = 6) {
  return Math.random().toString(36).substring(2, 2 + len).toUpperCase();
}

function getGroupBySocket(socketId) {
  return Object.entries(groups).find(([, g]) => g.players.some(p => p.socketId === socketId));
}

function getTeamSize(mode) {
  return mode === '1v1' ? 1 : mode === '5v5' ? 5 : 2;
}

function getModeElo(userId, mode) {
  const user = db.getUserById(userId);
  return user?.stats?.[mode]?.elo || 500;
}

// ── BAN TIMER ──
function startBanTimer(roomId) {
  const room = rooms[roomId];
  if (!room || room.status !== 'ban_phase') return;

  clearTimeout(room.banTimer);
  room.banTimer = setTimeout(() => {
    const room = rooms[roomId];
    if (!room || room.status !== 'ban_phase') return;

    // Auto-ban a random remaining map
    const remaining = MAPS.filter(m => !room.mapBans.includes(m));
    if (remaining.length <= 1) return;

    const currentTeam = room.banTurn % 2 === 0 ? 0 : 1;
    const autoMap = remaining[Math.floor(Math.random() * remaining.length)];

    room.mapBans.push(autoMap);
    room.banTurn++;

    const newRemaining = MAPS.filter(m => !room.mapBans.includes(m));
    const teamNum = currentTeam + 1;

    io.to('room_' + roomId).emit('map_banned', { team: teamNum, map: autoMap, remainingMaps: newRemaining, auto: true });
    io.to('room_' + roomId).emit('chat_msg', { author: 'Système', team: 'system', text: `⏱️ Équipe ${teamNum} n'a pas banni — ${autoMap} auto-banni !` });

    if (newRemaining.length === 1) {
      const chosen = newRemaining[0];
      room.chosenMap = chosen;
      room.status = 'playing';
      io.to('room_' + roomId).emit('map_chosen', { map: chosen });
      io.to('room_' + roomId).emit('chat_msg', { author: 'Système', team: 'system', text: `🗺️ Map jouée : ${chosen} — GO !` });
    } else {
      const nextTeam = room.banTurn % 2 === 0 ? 1 : 2;
      io.to('room_' + roomId).emit('ban_phase', { turn: room.banTurn, team: nextTeam, mapsLeft: newRemaining.length });
      startBanTimer(roomId);
    }
  }, BAN_TIMEOUT);

  io.to('room_' + roomId).emit('ban_timer_start', { seconds: BAN_TIMEOUT / 1000 });
}

// ── START COUNTDOWN ──
function startRoomCountdown(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  let count = START_COUNTDOWN / 1000;
  io.to('room_' + roomId).emit('countdown_start', { seconds: count });

  const interval = setInterval(() => {
    count--;
    io.to('room_' + roomId).emit('countdown_tick', { seconds: count });
    if (count <= 0) {
      clearInterval(interval);
      const room = rooms[roomId];
      if (!room) return;

      if (room.mode === '1v1' || room.mode === '2v2') {
        room.status = 'playing';
        io.to('room_' + roomId).emit('game_start', { mode: room.mode });
      } else {
        room.status = 'ban_phase';
        io.to('room_' + roomId).emit('ban_phase', { turn: 0, team: 1, mapsLeft: MAPS.length });
        io.to('room_' + roomId).emit('chat_msg', { author: 'Système', team: 'system', text: '🗺️ Phase de ban ! Équipe 1 commence.' });
        startBanTimer(roomId);
      }
    }
  }, 1000);
}

io.on('connection', (socket) => {

  // ── REGISTER ──
  socket.on('register', async ({ pseudo, password }) => {
    try {
      if (!pseudo || !password) return socket.emit('auth_error', 'Champs manquants');
      if (pseudo.length < 3) return socket.emit('auth_error', 'Pseudo trop court (3 min)');
      if (db.getUserByPseudo(pseudo)) return socket.emit('auth_error', 'Pseudo déjà pris');

      // Anti double compte par IP
      const ip = socket.handshake.headers['x-forwarded-for']?.split(',')[0] || socket.handshake.address;
      const existing = db.getIpAccounts(ip);
      if (existing.length >= 2) return socket.emit('auth_error', 'Trop de comptes créés depuis cette adresse');

      const hashed = await bcrypt.hash(password, 10);
      const user = db.createUser(pseudo, hashed, ip);
      socket.userId = user.id;
      socket.pseudo = user.pseudo;
      socket.isAdmin = ADMIN_PSEUDOS.includes(pseudo);
      socket.emit('auth_ok', {
        pseudo: user.pseudo,
        elo: user.stats['2v2'].elo,
        stats: user.stats,
        isAdmin: socket.isAdmin,
        avatar: user.avatar || null,
        userId: user.id
      });
    } catch(e) { socket.emit('auth_error', 'Erreur: ' + e.message); }
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
      socket.isAdmin = ADMIN_PSEUDOS.includes(pseudo);
      const stats = user.stats || db.defaultStats();
      socket.emit('auth_ok', {
        pseudo: user.pseudo,
        elo: stats['2v2']?.elo || 500,
        stats,
        isAdmin: socket.isAdmin,
        avatar: user.avatar || null,
        userId: user.id
      });
    } catch(e) { socket.emit('auth_error', 'Erreur: ' + e.message); }
  });

  // ── PROFILE ──
  socket.on('get_profile', ({ pseudo }) => {
    const user = db.getUserByPseudo(pseudo);
    if (!user) return socket.emit('profile_data', null);
    const stats = user.stats || db.defaultStats();
    const totalWins = Object.values(stats).reduce((a, s) => a + (s.wins||0), 0);
    const totalLosses = Object.values(stats).reduce((a, s) => a + (s.losses||0), 0);
    const total = totalWins + totalLosses;
    const winrate = total > 0 ? Math.round((totalWins / total) * 100) : 0;
    socket.emit('profile_data', { pseudo: user.pseudo, stats, winrate, totalWins, totalLosses, avatar: user.avatar || null });
  });

  // ── ADMIN: SPAWN BOTS ──
  socket.on('spawn_bots', ({ mode }) => {
    if (!socket.isAdmin) return socket.emit('notify_error', 'Accès refusé');
    const entry = getGroupBySocket(socket.id);
    if (!entry) return socket.emit('notify_error', 'Pas dans un groupe');
    const [code, group] = entry;
    const teamSize = getTeamSize(mode || group.mode);

    // Fill group to teamSize with bots
    while (group.players.length < teamSize) {
      const botNum = group.players.filter(p => p.isBot).length + 1;
      group.players.push({ id: 'bot_' + Date.now(), pseudo: 'Bot' + botNum, elo: 500, socketId: null, isBot: true });
    }
    io.to('group_' + code).emit('group_updated', { players: group.players.map(p => ({ pseudo: p.pseudo, elo: p.elo, avatar: p.avatar || null })), mode: group.mode });
    socket.emit('group_created', { code, mode: group.mode, players: group.players.map(p => ({ pseudo: p.pseudo, elo: p.elo, avatar: p.avatar || null })) });

    // Also create a fake opponent group and trigger room
    const oppGroupCode = generateCode();
    const oppPlayers = [];
    for (let i = 0; i < teamSize; i++) {
      oppPlayers.push({ id: 'bot_opp_' + i, pseudo: 'Adversaire' + (i+1), elo: 500, socketId: null, isBot: true });
    }
    groups[oppGroupCode] = { mode: group.mode, players: oppPlayers };

    // Find or create room
    let roomId, room;
    const waiting = Object.entries(rooms).find(([, r]) => r.status === 'waiting' && r.mode === group.mode);
    if (waiting) {
      [roomId, room] = waiting;
      room.teams[1] = oppPlayers;
    } else {
      roomId = 'R' + generateCode(4);
      room = { id: roomId, mode: group.mode, teams: [group.players, oppPlayers], chat: [], mapBans: [], banTurn: 0, status: 'waiting', chosenMap: null, banTimer: null };
      rooms[roomId] = room;
    }

    // Join real players to room
    group.players.filter(p => !p.isBot).forEach(p => {
      const s = io.sockets.sockets.get(p.socketId);
      if (s) { s.join('room_' + roomId); s.roomId = roomId; }
    });

    room.teams[1] = oppPlayers;
    const payload = {
      roomId, mode: room.mode,
      team1: room.teams[0].map(p => ({ pseudo: p.pseudo, elo: p.elo, avatar: p.avatar || null })),
      team2: room.teams[1].map(p => ({ pseudo: p.pseudo, elo: p.elo, avatar: p.avatar || null })),
      waiting: false
    };
    io.to('room_' + roomId).emit('room_ready', payload);
    io.to('room_' + roomId).emit('chat_msg', { author: 'Système', team: 'system', text: '🤖 Bots adverses ajoutés ! Début dans 10 secondes…' });
    startRoomCountdown(roomId);
  });

  // ── CREATE GROUP ──
  socket.on('create_group', ({ mode }) => {
    const existing = getGroupBySocket(socket.id);
    if (existing) {
      const [code, group] = existing;
      group.players = group.players.filter(p => p.socketId !== socket.id);
      if (group.players.length === 0) delete groups[code];
      else socket.leave('group_' + code);
    }

    const code = generateCode();
    const elo = getModeElo(socket.userId, mode);
    const userRecord = db.getUserById(socket.userId);
    groups[code] = {
      mode,
      players: [{ id: socket.userId, pseudo: socket.pseudo, elo, avatar: userRecord?.avatar || null, socketId: socket.id }]
    };
    socket.groupCode = code;
    socket.groupMode = mode;
    socket.join('group_' + code);
    socket.emit('group_created', { code, mode, players: groups[code].players.map(p => ({ pseudo: p.pseudo, elo: p.elo, avatar: p.avatar || null })) });
  });

  // ── JOIN GROUP ──
  socket.on('join_group', ({ code }) => {
    const group = groups[code.toUpperCase()];
    if (!group) return socket.emit('group_error', 'Code invalide');
    const teamSize = getTeamSize(group.mode);
    if (group.players.length >= teamSize) return socket.emit('group_error', 'Groupe complet');
    if (group.players.some(p => p.id === socket.userId)) return socket.emit('group_error', 'Déjà dans ce groupe');

    const existing = getGroupBySocket(socket.id);
    if (existing) {
      const [oldCode, oldGroup] = existing;
      oldGroup.players = oldGroup.players.filter(p => p.socketId !== socket.id);
      if (oldGroup.players.length === 0) delete groups[oldCode];
      else socket.leave('group_' + oldCode);
    }

    const elo = getModeElo(socket.userId, group.mode);
    const userRecord = db.getUserById(socket.userId);
    group.players.push({ id: socket.userId, pseudo: socket.pseudo, elo, avatar: userRecord?.avatar || null, socketId: socket.id });
    socket.groupCode = code.toUpperCase();
    socket.groupMode = group.mode;
    socket.join('group_' + code.toUpperCase());

    const publicPlayers = group.players.map(p => ({ pseudo: p.pseudo, elo: p.elo, avatar: p.avatar || null }));
    io.to('group_' + code.toUpperCase()).emit('group_updated', { players: publicPlayers, mode: group.mode });
    socket.emit('group_joined', { code: code.toUpperCase(), players: publicPlayers, mode: group.mode });
  });

  // ── CREATE ROOM ──
  socket.on('create_room', () => {
    const entry = getGroupBySocket(socket.id);
    if (!entry) return socket.emit('room_error', 'Pas dans un groupe');
    const [code, group] = entry;
    const teamSize = getTeamSize(group.mode);
    if (group.players.length < teamSize) return socket.emit('room_error', `Il faut ${teamSize} joueur(s) dans le groupe`);

    // Check if already in a room
    let existingRoom = Object.entries(rooms).find(([, r]) => r.status === 'waiting' && r.mode === group.mode);

    let roomId, room;

    if (existingRoom) {
      [roomId, room] = existingRoom;
      room.teams[1] = group.players;

      // Join socket room
      group.players.forEach(p => {
        const s = io.sockets.sockets.get(p.socketId);
        if (s) { s.join('room_' + roomId); s.roomId = roomId; }
      });

      // Send full room info to everyone
      const payload = {
        roomId,
        mode: room.mode,
        team1: room.teams[0].map(p => ({ pseudo: p.pseudo, elo: p.elo, avatar: p.avatar || null })),
        team2: room.teams[1].map(p => ({ pseudo: p.pseudo, elo: p.elo, avatar: p.avatar || null })),
        waiting: false
      };
      io.to('room_' + roomId).emit('room_ready', payload);
      io.to('room_' + roomId).emit('chat_msg', { author: 'Système', team: 'system', text: '✅ 4 joueurs connectés ! Début dans 10 secondes…' });

      startRoomCountdown(roomId);

    } else {
      roomId = 'R' + generateCode(4);
      room = {
        id: roomId,
        mode: group.mode,
        teams: [group.players, []],
        chat: [],
        mapBans: [],
        banTurn: 0,
        status: 'waiting',
        chosenMap: null,
        banTimer: null
      };
      rooms[roomId] = room;

      group.players.forEach(p => {
        const s = io.sockets.sockets.get(p.socketId);
        if (s) { s.join('room_' + roomId); s.roomId = roomId; }
      });

      // Send room in waiting state — team 2 slots empty
      const payload = {
        roomId,
        mode: room.mode,
        team1: room.teams[0].map(p => ({ pseudo: p.pseudo, elo: p.elo, avatar: p.avatar || null })),
        team2: [],
        waiting: true
      };
      io.to('room_' + roomId).emit('room_ready', payload);
      io.to('room_' + roomId).emit('chat_msg', { author: 'Système', team: 'system', text: '⏳ En attente d\'une équipe adverse…' });
    }
  });

  // ── CHAT ──
  socket.on('chat_msg', ({ text }) => {
    if (!socket.roomId) return;
    if (!text || text.trim().length === 0 || text.length > 200) return;
    const room = rooms[socket.roomId];
    if (!room) return;
    const team = socket.isAdmin ? 'admin' : (room.teams[0].some(p => p.id === socket.userId) ? 'team1' : 'team2');
    const displayPseudo = socket.isAdmin ? `${socket.pseudo} [ADMIN]` : socket.pseudo;
    const msg = { author: displayPseudo, team, text: text.trim(), time: Date.now() };
    room.chat.push(msg);
    io.to('room_' + socket.roomId).emit('chat_msg', msg);
  });

  // ── BAN MAP ──
  socket.on('ban_map', ({ map }) => {
    if (!socket.roomId) return;
    const room = rooms[socket.roomId];
    if (!room || room.status !== 'ban_phase') return;
    if (!MAPS.includes(map) || room.mapBans.includes(map)) return;

    const currentTeam = room.banTurn % 2 === 0 ? 0 : 1;
    const isMyTeam = room.teams[currentTeam].some(p => p.id === socket.userId);
    if (!isMyTeam) return socket.emit('ban_error', "Ce n'est pas votre tour");

    clearTimeout(room.banTimer);

    room.mapBans.push(map);
    room.banTurn++;

    const remainingMaps = MAPS.filter(m => !room.mapBans.includes(m));
    const teamNum = currentTeam + 1;

    io.to('room_' + socket.roomId).emit('map_banned', { team: teamNum, map, remainingMaps });
    io.to('room_' + socket.roomId).emit('chat_msg', { author: 'Système', team: 'system', text: `❌ Équipe ${teamNum} a banni ${map}` });

    if (remainingMaps.length === 1) {
      const chosen = remainingMaps[0];
      room.chosenMap = chosen;
      room.status = 'playing';
      io.to('room_' + socket.roomId).emit('map_chosen', { map: chosen });
      io.to('room_' + socket.roomId).emit('chat_msg', { author: 'Système', team: 'system', text: `🗺️ Map jouée : ${chosen} — GO !` });
    } else {
      const nextTeam = room.banTurn % 2 === 0 ? 1 : 2;
      io.to('room_' + socket.roomId).emit('ban_phase', { turn: room.banTurn, team: nextTeam, mapsLeft: remainingMaps.length });
      startBanTimer(socket.roomId);
    }
  });

  // ── RESULT ──
  socket.on('declare_result', ({ winner }) => {
    if (!socket.roomId) return;
    const room = rooms[socket.roomId];
    if (!room || room.status !== 'playing') return;
    if (room.resultDeclared) return;
    room.resultDeclared = true;
    room.status = 'finished';
    clearTimeout(room.banTimer);

    const winTeam = winner === 1 ? room.teams[0] : room.teams[1];
    const loseTeam = winner === 1 ? room.teams[1] : room.teams[0];

    winTeam.forEach(p => db.updateUserElo(p.id, +20, true, room.mode));
    loseTeam.forEach(p => db.updateUserElo(p.id, -20, false, room.mode));

    io.to('room_' + socket.roomId).emit('game_result', {
      winner,
      winTeam: winTeam.map(p => p.pseudo),
      loseTeam: loseTeam.map(p => p.pseudo),
      mode: room.mode
    });

    setTimeout(() => { delete rooms[socket.roomId]; }, 30000);
  });

  // ── DISCONNECT ──
  socket.on('disconnect', () => {
    const groupEntry = getGroupBySocket(socket.id);
    if (groupEntry) {
      const [code, group] = groupEntry;
      group.players = group.players.filter(p => p.socketId !== socket.id);
      if (group.players.length === 0) delete groups[code];
      else io.to('group_' + code).emit('group_updated', { players: group.players.map(p => ({ pseudo: p.pseudo, elo: p.elo, avatar: p.avatar || null })), mode: group.mode });
    }
  });

  // ── LEAVE GROUP ──
  socket.on('leave_group', () => {
    const entry = getGroupBySocket(socket.id);
    if (!entry) return;
    const [code, group] = entry;
    group.players = group.players.filter(p => p.socketId !== socket.id);
    socket.leave('group_' + code);
    socket.groupCode = null;
    if (group.players.length === 0) delete groups[code];
    else io.to('group_' + code).emit('group_updated', { players: group.players.map(p => ({ pseudo: p.pseudo, elo: p.elo, avatar: p.avatar || null })), mode: group.mode });
    // Create a fresh solo group
    const newCode = generateCode();
    const elo = getModeElo(socket.userId, socket.groupMode || '2v2');
    const userRec = db.getUserById(socket.userId);
    groups[newCode] = { mode: socket.groupMode || '2v2', players: [{ id: socket.userId, pseudo: socket.pseudo, elo, avatar: userRec?.avatar || null, socketId: socket.id }] };
    socket.groupCode = newCode;
    socket.join('group_' + newCode);
    socket.emit('group_created', { code: newCode, mode: socket.groupMode || '2v2', players: [{ pseudo: socket.pseudo, elo }] });
  });

  // ── CHAT IMAGE ──
  socket.on('chat_img', ({ img }) => {
    if (!socket.roomId) return;
    const room = rooms[socket.roomId];
    if (!room) return;
    const team = room.teams[0].some(p => p.id === socket.userId) ? 'team1' : 'team2';
    io.to('room_' + socket.roomId).emit('chat_img', { author: socket.pseudo, team, img, time: Date.now() });
  });

  // ── ADMIN ALERT ──
  socket.on('admin_alert', ({ roomId, type, pseudo }) => {
    const room = rooms[roomId];
    if (!room) return;
    // Anti-spam: one alert per user per room
    if (!room.alerts) room.alerts = new Set();
    if (room.alerts.has(socket.userId)) return;
    room.alerts.add(socket.userId);
    // Send to all admin sockets
    io.sockets.sockets.forEach(s => {
      if (s.isAdmin) s.emit('admin_alert_received', { roomId, type, pseudo });
    });
  });

  // ── ADMIN JOIN ROOM ──
  socket.on('admin_join_room', ({ roomId }) => {
    if (!socket.isAdmin) return;
    const room = rooms[roomId];
    if (!room) return socket.emit('notify_error', 'Room introuvable');
    socket.join('room_' + roomId);
    socket.adminRoomId = roomId;
    socket.emit('admin_joined_room', {
      roomId,
      mode: room.mode,
      team1: room.teams[0].map(p => ({ pseudo: p.pseudo, elo: p.elo, avatar: p.avatar || null })),
      team2: room.teams[1].map(p => ({ pseudo: p.pseudo, elo: p.elo, avatar: p.avatar || null }))
    });
    io.to('room_' + roomId).emit('chat_msg', { author: 'Système', team: 'system', text: '👁️ Un admin a rejoint la room en spectateur.' });
  });

  // ── ADMIN DECIDE ──
  socket.on('admin_decide', ({ roomId, winner }) => {
    if (!socket.isAdmin) return;
    const room = rooms[roomId];
    if (!room || room.resultDeclared) return;
    room.resultDeclared = true;
    room.status = 'finished';
    clearTimeout(room.banTimer);
    const winTeam = winner === 1 ? room.teams[0] : room.teams[1];
    const loseTeam = winner === 1 ? room.teams[1] : room.teams[0];
    winTeam.filter(p => !p.isBot).forEach(p => db.updateUserElo(p.id, +20, true, room.mode));
    loseTeam.filter(p => !p.isBot).forEach(p => db.updateUserElo(p.id, -20, false, room.mode));
    io.to('room_' + roomId).emit('chat_msg', { author: 'Système', team: 'system', text: `⚖️ Décision admin : Équipe ${winner} gagne !` });
    io.to('room_' + roomId).emit('game_result', { winner, winTeam: winTeam.map(p => p.pseudo), loseTeam: loseTeam.map(p => p.pseudo), mode: room.mode });
    setTimeout(() => { delete rooms[roomId]; }, 30000);
  });
});

server.listen(PORT, () => console.log(`✅ WAGERS sur http://localhost:${PORT}`));