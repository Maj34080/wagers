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

app.use(express.json());

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/leaderboard/:mode', (req, res) => {
  const mode = req.params.mode;
  res.json(db.getLeaderboard(mode));
});

// ─── STATE ───────────────────────────────────────
const groups = {};
const rooms = {};
const MAPS = ['Ascent', 'Bind', 'Haven', 'Icebox', 'Lotus', 'Pearl', 'Split'];

function generateCode(len = 6) {
  return Math.random().toString(36).substring(2, 2 + len).toUpperCase();
}

function getGroupBySocket(socketId) {
  return Object.entries(groups).find(([, g]) => g.players.some(p => p.socketId === socketId));
}

function getTeamSize(mode) {
  if (mode === '1v1') return 1;
  if (mode === '2v2') return 2;
  if (mode === '5v5') return 5;
  return 2;
}

// ─── SOCKET ──────────────────────────────────────
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
      socket.emit('auth_ok', { pseudo: user.pseudo, elo: user.elo, wins: user.wins, stats: user.stats });
    } catch(e) {
      socket.emit('auth_error', 'Erreur: ' + e.message);
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
      socket.emit('auth_ok', { pseudo: user.pseudo, elo: user.elo, wins: user.wins, stats: user.stats });
    } catch(e) {
      socket.emit('auth_error', 'Erreur: ' + e.message);
    }
  });

  // ── GET PROFILE ──
  socket.on('get_profile', ({ pseudo }) => {
    const user = db.getUserByPseudo(pseudo);
    if (!user) return socket.emit('profile_data', null);
    const stats = user.stats || { '1v1': { wins:0, losses:0, elo:500 }, '2v2': { wins:0, losses:0, elo:500 }, '5v5': { wins:0, losses:0, elo:500 } };
    const totalWins = Object.values(stats).reduce((a, s) => a + s.wins, 0);
    const totalLosses = Object.values(stats).reduce((a, s) => a + s.losses, 0);
    const total = totalWins + totalLosses;
    const winrate = total > 0 ? Math.round((totalWins / total) * 100) : 0;
    socket.emit('profile_data', { pseudo: user.pseudo, stats, winrate, totalWins, totalLosses });
  });

  // ── CRÉER UN GROUPE ──
  socket.on('create_group', ({ mode }) => {
    const existing = getGroupBySocket(socket.id);
    if (existing) {
      const [code, group] = existing;
      group.players = group.players.filter(p => p.socketId !== socket.id);
      if (group.players.length === 0) delete groups[code];
      else socket.leave('group_' + code);
    }

    const code = generateCode();
    const modeElo = (socket.userId && db.getUserById(socket.userId)?.stats?.[mode]?.elo) || 500;
    groups[code] = {
      mode,
      players: [{ id: socket.userId, pseudo: socket.pseudo, elo: modeElo, socketId: socket.id }]
    };
    socket.groupCode = code;
    socket.groupMode = mode;
    socket.join('group_' + code);
    socket.emit('group_created', { code, mode, players: groups[code].players.map(p => ({ pseudo: p.pseudo, elo: p.elo })) });
  });

  // ── REJOINDRE UN GROUPE ──
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

    const modeElo = (socket.userId && db.getUserById(socket.userId)?.stats?.[group.mode]?.elo) || 500;
    group.players.push({ id: socket.userId, pseudo: socket.pseudo, elo: modeElo, socketId: socket.id });
    socket.groupCode = code.toUpperCase();
    socket.groupMode = group.mode;
    socket.join('group_' + code.toUpperCase());

    const publicPlayers = group.players.map(p => ({ pseudo: p.pseudo, elo: p.elo }));
    io.to('group_' + code.toUpperCase()).emit('group_updated', { players: publicPlayers, mode: group.mode });
    socket.emit('group_joined', { code: code.toUpperCase(), players: publicPlayers, mode: group.mode });
  });

  // ── CRÉER UNE ROOM ──
  socket.on('create_room', () => {
    const entry = getGroupBySocket(socket.id);
    if (!entry) return socket.emit('room_error', 'Pas dans un groupe');
    const [code, group] = entry;
    const teamSize = getTeamSize(group.mode);
    if (group.players.length < teamSize) return socket.emit('room_error', `Il faut ${teamSize} joueur(s) dans le groupe`);

    let roomId = null;
    let room = null;

    const waiting = Object.entries(rooms).find(([, r]) => r.status === 'waiting' && r.mode === group.mode);
    if (waiting) {
      [roomId, room] = waiting;
      room.teams[1] = group.players;
      room.status = group.mode === '1v1' ? 'playing' : 'ban_phase';
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
        chosenMap: null
      };
      rooms[roomId] = room;
    }

    group.players.forEach(p => {
      const s = io.sockets.sockets.get(p.socketId);
      if (s) { s.join('room_' + roomId); s.roomId = roomId; }
    });

    if (room.status === 'ban_phase' || room.status === 'playing') {
      const payload = {
        roomId,
        mode: room.mode,
        team1: room.teams[0].map(p => ({ pseudo: p.pseudo, elo: p.elo })),
        team2: room.teams[1].map(p => ({ pseudo: p.pseudo, elo: p.elo })),
      };
      io.to('room_' + roomId).emit('room_ready', payload);

      if (room.mode === '1v1') {
        io.to('room_' + roomId).emit('chat_msg', { author: 'Système', team: 'system', text: '🎮 Room 1v1 créée ! Bonne chance !' });
      } else {
        io.to('room_' + roomId).emit('chat_msg', { author: 'Système', team: 'system', text: `🎮 Room ${room.mode} créée ! Phase de ban — Équipe 1 commence.` });
        // Ban phase: teams alternate, last map is chosen
        // Total bans: MAPS.length - 1 = 6 bans, 1 map left
        io.to('room_' + roomId).emit('ban_phase', { turn: 0, team: 1, mapsLeft: MAPS.length });
      }
    } else {
      socket.emit('room_waiting', { roomId, mode: group.mode });
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

  // ── BAN MAP ──
  socket.on('ban_map', ({ map }) => {
    if (!socket.roomId) return;
    const room = rooms[socket.roomId];
    if (!room || room.status !== 'ban_phase') return;
    if (!MAPS.includes(map)) return;
    if (room.mapBans.includes(map)) return;

    // Determine whose turn: alternates t1, t2, t1, t2...
    const currentTeam = room.banTurn % 2 === 0 ? 0 : 1;
    const isMyTeam = room.teams[currentTeam].some(p => p.id === socket.userId);
    if (!isMyTeam) return socket.emit('ban_error', "Ce n'est pas votre tour");

    room.mapBans.push(map);
    room.banTurn++;

    const remainingMaps = MAPS.filter(m => !room.mapBans.includes(m));
    const teamNum = currentTeam + 1;

    io.to('room_' + socket.roomId).emit('map_banned', { team: teamNum, map, remainingMaps });
    io.to('room_' + socket.roomId).emit('chat_msg', { author: 'Système', team: 'system', text: `❌ Équipe ${teamNum} a banni ${map}` });

    if (remainingMaps.length === 1) {
      // Last map chosen
      const chosen = remainingMaps[0];
      room.chosenMap = chosen;
      room.status = 'playing';
      io.to('room_' + socket.roomId).emit('map_chosen', { map: chosen });
      io.to('room_' + socket.roomId).emit('chat_msg', { author: 'Système', team: 'system', text: `🗺️ Map jouée : ${chosen} — GO !` });
    } else {
      // Next team's turn
      const nextTeam = room.banTurn % 2 === 0 ? 1 : 2;
      io.to('room_' + socket.roomId).emit('ban_phase', { turn: room.banTurn, team: nextTeam, mapsLeft: remainingMaps.length });
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

  // ── DÉCONNEXION ──
  socket.on('disconnect', () => {
    const groupEntry = getGroupBySocket(socket.id);
    if (groupEntry) {
      const [code, group] = groupEntry;
      group.players = group.players.filter(p => p.socketId !== socket.id);
      if (group.players.length === 0) delete groups[code];
      else io.to('group_' + code).emit('group_updated', { players: group.players.map(p => ({ pseudo: p.pseudo, elo: p.elo })), mode: group.mode });
    }
  });
});

server.listen(PORT, () => {
  console.log(`✅ Serveur WAGERS lancé sur http://localhost:${PORT}`);
});