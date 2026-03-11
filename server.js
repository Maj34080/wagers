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
const WEAPONS = ['Vandal/Phantom', 'Sheriff', 'Operator', 'Marshall', 'Ghost'];
const WEAPON_VOTE_TIMEOUT = 10000; // 10s pour voter
const BAN_TIMEOUT = 15000;
const START_COUNTDOWN = 5000;
const ADMIN_PSEUDOS = ['Karim34']; // ← ajoute ton pseudo ici

app.use(express.json());
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/api/leaderboard/:mode', (req, res) => res.json(db.getLeaderboard(req.params.mode)));
app.get('/api/profile/:pseudo', (req, res) => {
  const user = db.getUserByPseudo(req.params.pseudo);
  if (!user) return res.status(404).json({ error: 'Introuvable' });
  res.json({ id: user.id, pseudo: user.pseudo, stats: user.stats, avatar: user.avatar || null, banned: !!user.banned, muted: !!user.muted, createdAt: user.createdAt });
});

// Admin actions
const ADMIN_KEY = process.env.ADMIN_KEY || 'revenge_admin_secret';
function isAdminReq(req) { return req.headers['x-admin-key'] === ADMIN_KEY; }
app.post('/api/admin/ban', (req, res) => {
  if (!isAdminReq(req)) return res.status(403).json({ error: 'Interdit' });
  const { pseudo, reason } = req.body;
  const user = db.getUserByPseudo(pseudo);
  if (!user) return res.status(404).json({ error: 'Introuvable' });
  db.banUser(user.id, reason);
  // Kick connected socket immediately
  io.sockets.sockets.forEach(s => {
    if (s.userId === user.id) s.emit('you_are_banned', { reason: reason || 'violation des règles' });
  });
  res.json({ ok: true });
});
app.post('/api/admin/unban', (req, res) => {
  if (!isAdminReq(req)) return res.status(403).json({ error: 'Interdit' });
  const { pseudo } = req.body;
  const user = db.getUserByPseudo(pseudo);
  if (!user) return res.status(404).json({ error: 'Introuvable' });
  db.unbanUser(user.id);
  res.json({ ok: true });
});
app.post('/api/admin/mute', (req, res) => {
  if (!isAdminReq(req)) return res.status(403).json({ error: 'Interdit' });
  const { pseudo } = req.body;
  const user = db.getUserByPseudo(pseudo);
  if (!user) return res.status(404).json({ error: 'Introuvable' });
  db.muteUser(user.id);
  res.json({ ok: true });
});
app.post('/api/admin/unmute', (req, res) => {
  if (!isAdminReq(req)) return res.status(403).json({ error: 'Interdit' });
  const { pseudo } = req.body;
  const user = db.getUserByPseudo(pseudo);
  if (!user) return res.status(404).json({ error: 'Introuvable' });
  db.unmuteUser(user.id);
  res.json({ ok: true });
});

// Tickets
app.get('/api/tickets', (req, res) => {
  if (!isAdminReq(req)) return res.status(403).json({ error: 'Interdit' });
  res.json(db.getTickets());
});
app.post('/api/tickets', (req, res) => {
  const { userId, pseudo, subject, message } = req.body;
  if (!userId || !pseudo || !subject || !message) return res.status(400).json({ error: 'Manquant' });
  const ticket = db.createTicket(userId, pseudo, subject, message);
  res.json(ticket);
});
app.post('/api/tickets/:id/reply', (req, res) => {
  if (!isAdminReq(req)) return res.status(403).json({ error: 'Interdit' });
  const { author, message } = req.body;
  const ticket = db.replyTicket(req.params.id, author, message);
  if (!ticket) return res.status(404).json({ error: 'Introuvable' });
  res.json(ticket);
});
app.post('/api/tickets/:id/close', (req, res) => {
  if (!isAdminReq(req)) return res.status(403).json({ error: 'Interdit' });
  const ticket = db.closeTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Introuvable' });
  res.json(ticket);
});

app.get('/api/admin/banned', (req, res) => {
  if (!isAdminReq(req)) return res.status(403).json({ error: 'Interdit' });
  const dbFile = process.env.NODE_ENV === 'production' ? '/tmp/db.json' : path.join(__dirname, 'db.json');
  try {
    const data = JSON.parse(require('fs').readFileSync(dbFile, 'utf8'));
    res.json((data.users||[]).filter(u => u.banned).map(u => ({ id: u.id, pseudo: u.pseudo, banReason: u.banReason||'', createdAt: u.createdAt })));
  } catch(e) { res.json([]); }
});
app.post('/api/avatar', express.json({ limit: '2mb' }), (req, res) => {
  const { userId, avatar } = req.body;
  if (!userId || !avatar) return res.status(400).json({ error: 'Manquant' });
  db.updateAvatar(userId, avatar);
  res.json({ ok: true });
});

// ── CLASSEMENT OF THE DAY ──
let eloSnapshot = {};
let cotdData = [];
let lastSnapshotAt = 0;

const SNAPSHOT_FILE = () => process.env.NODE_ENV === 'production' ? '/tmp/elo_snapshot.json' : require('path').join(__dirname, 'elo_snapshot.json');

function loadSnapshot() {
  try {
    const raw = require('fs').readFileSync(SNAPSHOT_FILE(), 'utf8');
    const saved = JSON.parse(raw);
    eloSnapshot = saved.snapshot || {};
    lastSnapshotAt = saved.takenAt || 0;
  } catch(e) {
    // No snapshot yet — take one now as baseline
    takeEloSnapshot();
  }
}

function takeEloSnapshot() {
  try {
    const data = readDB();
    eloSnapshot = {};
    (data.users||[]).filter(u => !u.banned).forEach(u => {
      eloSnapshot[u.id] = { pseudo: u.pseudo, avatar: u.avatar||null, stats: JSON.parse(JSON.stringify(u.stats||{})) };
    });
    lastSnapshotAt = Date.now();
    require('fs').writeFileSync(SNAPSHOT_FILE(), JSON.stringify({ snapshot: eloSnapshot, takenAt: lastSnapshotAt }));
  } catch(e) {}
}

function computeCotd() {
  try {
    const data = readDB();
    const gains = [];
    (data.users||[]).filter(u => !u.banned).forEach(u => {
      const snap = eloSnapshot[u.id];
      // New user since snapshot — use 500 as baseline
      const baseStats = snap ? snap.stats : null;
      let totalGain = 0;
      ['1v1','2v2','3v3','5v5'].forEach(m => {
        const cur = u.stats?.[m]?.elo || 500;
        const prev = baseStats?.[m]?.elo || 500;
        totalGain += Math.max(0, cur - prev);
      });
      if (totalGain > 0) gains.push({ pseudo: u.pseudo, avatar: u.avatar||null, gain: totalGain });
    });
    cotdData = gains.sort((a,b) => b.gain - a.gain).slice(0, 10);
  } catch(e) {}
}

// Load persisted snapshot on startup (don't overwrite it)
loadSnapshot();

// Recompute rankings every 30s
setInterval(() => { computeCotd(); }, 30000);

// Reset snapshot every 24h at the same time
function scheduleNextReset() {
  const now = Date.now();
  const nextMidnight = new Date();
  nextMidnight.setHours(0, 0, 0, 0);
  nextMidnight.setDate(nextMidnight.getDate() + 1);
  const msUntilMidnight = nextMidnight.getTime() - now;
  setTimeout(() => {
    takeEloSnapshot();
    cotdData = [];
    scheduleNextReset();
  }, msUntilMidnight);
}
scheduleNextReset();

app.get('/api/cotd', (req, res) => {
  computeCotd();
  const nextReset = lastSnapshotAt + 24*60*60*1000;
  res.json({ data: cotdData, nextReset });
});

// ── GLOBAL CHAT ──
const globalChat = []; // { pseudo, text, time, avatar }
const GLOBAL_CHAT_MAX = 100;
app.get('/api/global-chat', (req, res) => res.json(globalChat.slice(-50)));
app.post('/api/global-chat', (req, res) => {
  const { userId, pseudo, text } = req.body;
  if (!userId || !pseudo || !text || text.length > 200) return res.status(400).json({ error: 'Invalide' });
  const user = db.getUserById(userId);
  if (!user || user.banned) return res.status(403).json({ error: 'Interdit' });
  if (user.muted) return res.status(403).json({ error: 'Mute' });
  const msg = { pseudo, text: text.trim(), time: Date.now(), avatar: user.avatar||null };
  globalChat.push(msg);
  if (globalChat.length > GLOBAL_CHAT_MAX) globalChat.shift();
  io.emit('global_chat_msg', msg);
  res.json({ ok: true });
});

const groups = {};
const rooms = {};
const archivedRooms = {};

function resolveWeaponVote(roomId) {
  const room = rooms[roomId];
  if (!room || room.status !== 'weapon_vote') return;
  clearTimeout(room.weaponTimer);
  const v1 = room.weaponVotes.team1;
  const v2 = room.weaponVotes.team2;
  let chosen;
  if (v1 && v2 && v1 === v2) {
    chosen = v1;
  } else {
    chosen = WEAPONS[Math.floor(Math.random() * WEAPONS.length)];
  }
  room.chosenWeapon = chosen;
  room.status = 'playing';
  const msg = (v1 && v2 && v1 === v2)
    ? `✅ Accord trouvé ! Arme jouée : **${chosen}**`
    : `🎲 Pas d'accord — arme choisie aléatoirement : **${chosen}**`;
  io.to('room_' + roomId).emit('weapon_chosen', { weapon: chosen, agreed: v1 === v2 && !!v1 });
  io.to('room_' + roomId).emit('chat_msg', { author: 'Système', team: 'system', text: msg });
  io.to('room_' + roomId).emit('game_start', { mode: room.mode, weapon: chosen });
}

function archiveRoom(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  room.archivedAt = Date.now();
  archivedRooms[roomId] = room;
  delete rooms[roomId];
  // Nettoyage auto après 24h
  setTimeout(() => { delete archivedRooms[roomId]; }, 24 * 60 * 60 * 1000);
}

function generateCode(len = 6) {
  return Math.random().toString(36).substring(2, 2 + len).toUpperCase();
}

function getGroupBySocket(socketId) {
  return Object.entries(groups).find(([, g]) => g.players.some(p => p.socketId === socketId));
}

function getTeamSize(mode) {
  return mode === '1v1' ? 1 : mode === '3v3' ? 3 : mode === '5v5' ? 5 : 2;
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

      if (room.mode === '1v1' || room.mode === '2v2' || room.mode === '3v3') {
        room.status = 'weapon_vote';
        room.weaponVotes = {}; // { team1: 'Vandal/Phantom', team2: null }
        io.to('room_' + roomId).emit('weapon_vote_start', { weapons: WEAPONS });
        io.to('room_' + roomId).emit('chat_msg', { author: 'Système', team: 'system', text: '🔫 Choisissez votre arme ! 20 secondes pour voter.' });
        room.weaponTimer = setTimeout(() => resolveWeaponVote(roomId), WEAPON_VOTE_TIMEOUT);
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
      if (user.banned) return socket.emit('auth_error', '🚫 Compte banni. Raison : ' + (user.banReason || 'violation des règles'));
      const valid = await bcrypt.compare(password, user.password);
      if (!valid) return socket.emit('auth_error', 'Mot de passe incorrect');
      socket.userId = user.id;
      socket.pseudo = user.pseudo;
      socket.isAdmin = ADMIN_PSEUDOS.includes(pseudo);
      socket.isMuted = !!user.muted;
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
      // If already captain of a group, just update mode without disbanding
      if (group.captain === socket.userId) {
        group.mode = mode;
        socket.groupMode = mode;
        const publicPlayers = group.players.map(p => ({ pseudo: p.pseudo, elo: getModeElo(p.id, mode), avatar: p.avatar || null }));
        io.to('group_' + code).emit('group_updated', { players: publicPlayers, mode });
        socket.emit('group_created', { code, mode, players: publicPlayers });
        return;
      }
      group.players = group.players.filter(p => p.socketId !== socket.id);
      if (group.players.length === 0) delete groups[code];
      else socket.leave('group_' + code);
    }

    const code = generateCode();
    const elo = getModeElo(socket.userId, mode);
    const userRecord = db.getUserById(socket.userId);
    groups[code] = {
      mode,
      captain: socket.userId,
      players: [{ id: socket.userId, pseudo: socket.pseudo, elo, avatar: userRecord?.avatar || null, socketId: socket.id }]
    };
    socket.groupCode = code;
    socket.groupMode = mode;
    socket.join('group_' + code);
    socket.emit('group_created', { code, mode, players: groups[code].players.map(p => ({ pseudo: p.pseudo, elo: p.elo, avatar: p.avatar || null })) });
  });

  // ── CHANGE MODE (without kicking members) ──
  socket.on('change_mode', ({ mode }) => {
    const entry = getGroupBySocket(socket.id);
    if (!entry) return;
    const [code, group] = entry;
    if (group.captain !== socket.userId) return socket.emit('notify_error', 'Seul le capitaine peut changer le mode');
    group.mode = mode;
    socket.groupMode = mode;
    const publicPlayers = group.players.map(p => ({ pseudo: p.pseudo, elo: getModeElo(p.id, mode), avatar: p.avatar || null }));
    io.to('group_' + code).emit('group_updated', { players: publicPlayers, mode });
    socket.emit('group_created', { code, mode, players: publicPlayers });
  });

  // ── RESET GROUP CODE ──
  socket.on('reset_group_code', () => {
    const entry = getGroupBySocket(socket.id);
    if (!entry) return;
    const [oldCode, group] = entry;
    if (group.captain !== socket.userId) return;
    const newCode = generateCode();
    groups[newCode] = { ...group };
    delete groups[oldCode];
    group.players.forEach(p => {
      const s = io.sockets.sockets.get(p.socketId);
      if (s) {
        s.leave('group_' + oldCode);
        s.join('group_' + newCode);
        s.groupCode = newCode;
      }
    });
    socket.emit('group_created', { code: newCode, mode: group.mode, players: group.players.map(p => ({ pseudo: p.pseudo, elo: p.elo, avatar: p.avatar || null })) });
    io.to('group_' + newCode).emit('group_updated', { players: group.players.map(p => ({ pseudo: p.pseudo, elo: p.elo, avatar: p.avatar || null })), mode: group.mode, newCode });
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
        banTimer: null,
        createdAt: Date.now()
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
    if (socket.isMuted) return socket.emit('chat_msg', { author: 'Système', team: 'system', text: '🔇 Vous êtes mute et ne pouvez pas envoyer de messages.' });
    const room = rooms[socket.roomId];
    if (!room) return;
    const inTeam = room.teams[0].some(p => p.id === socket.userId) || (room.teams[1] && room.teams[1].some(p => p.id === socket.userId));
    const isSpectatingAdmin = socket.isAdmin && !inTeam;
    const team = isSpectatingAdmin ? 'admin' : (room.teams[0].some(p => p.id === socket.userId) ? 'team1' : 'team2');
    const displayPseudo = isSpectatingAdmin ? `${socket.pseudo} [ADMIN]` : socket.pseudo;
    const msg = { author: displayPseudo, team, text: text.trim(), time: Date.now() };
    room.chat.push(msg);
    io.to('room_' + socket.roomId).emit('chat_msg', msg);
  });

  // ── BAN MAP ──
  // ── VOTE ARME ──
  socket.on('vote_weapon', ({ weapon }) => {
    if (!socket.roomId) return;
    const room = rooms[socket.roomId];
    if (!room || room.status !== 'weapon_vote') return;
    if (!WEAPONS.includes(weapon)) return;
    const inTeam1 = room.teams[0].some(p => p.id === socket.userId);
    const inTeam2 = room.teams[1] && room.teams[1].some(p => p.id === socket.userId);
    if (!inTeam1 && !inTeam2) return;
    const teamKey = inTeam1 ? 'team1' : 'team2';
    // Un vote par équipe (premier joueur à voter compte)
    if (room.weaponVotes[teamKey]) return;
    room.weaponVotes[teamKey] = weapon;
    const teamNum = inTeam1 ? 1 : 2;
    io.to('room_' + socket.roomId).emit('chat_msg', { author: 'Système', team: 'system', text: `🗳️ Équipe ${teamNum} a voté : ${weapon}` });
    // Si les deux équipes ont voté → résoudre immédiatement
    if (room.weaponVotes.team1 && room.weaponVotes.team2) {
      resolveWeaponVote(socket.roomId);
    }
  });

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
    computeCotd();

    io.to('room_' + socket.roomId).emit('game_result', {
      winner,
      winTeam: winTeam.map(p => p.pseudo),
      loseTeam: loseTeam.map(p => p.pseudo),
      mode: room.mode
    });

    setTimeout(() => { archiveRoom(socket.roomId); }, 30000);
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

  // ── CANCEL QUEUE ──
  socket.on('cancel_queue', () => {
    for (const [roomId, room] of Object.entries(rooms)) {
      if (room.status === 'waiting') {
        const inTeam0 = room.teams[0].some(p => p.id === socket.userId);
        const inTeam1 = room.teams[1] && room.teams[1].some(p => p.id === socket.userId);
        if (inTeam0 || inTeam1) {
          // Check if captain — if so, kick whole group from room
          const groupEntry = getGroupBySocket(socket.id);
          const isCaptain = groupEntry && groupEntry[1].captain === socket.userId;
          if (isCaptain && inTeam0) {
            // Kick all group members from room
            groupEntry[1].players.forEach(p => {
              const s = io.sockets.sockets.get(p.socketId);
              if (s) { s.leave('room_' + roomId); s.roomId = null; }
            });
            io.to('room_' + roomId).emit('captain_left');
            delete rooms[roomId];
          } else {
            socket.leave('room_' + roomId);
            socket.roomId = null;
            if (inTeam0) room.teams[0] = room.teams[0].filter(p => p.id !== socket.userId);
            if (inTeam1) room.teams[1] = room.teams[1].filter(p => p.id !== socket.userId);
            if (room.teams[0].length === 0) delete rooms[roomId];
          }
          break;
        }
      }
    }
  });

  // ── GET ROOM LOGS (admin) ──
  socket.on('get_room_logs', () => {
    if (!socket.isAdmin) return;
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const allRooms = [...Object.values(rooms), ...Object.values(archivedRooms)];
    const logs = allRooms
      .filter(r => !r.createdAt || r.createdAt > cutoff)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .map(r => ({
        id: r.id,
        mode: r.mode,
        status: r.status,
        createdAt: r.createdAt || Date.now(),
        chosenMap: r.chosenMap || null,
        teams: [
          (r.teams[0] || []).map(p => ({ pseudo: p.pseudo })),
          (r.teams[1] || []).map(p => ({ pseudo: p.pseudo }))
        ]
      }));
    socket.emit('room_logs', logs);
  });
  socket.on('leave_group', () => {
    const entry = getGroupBySocket(socket.id);
    if (!entry) return;
    const [code, group] = entry;
    const isCaptain = group.captain === socket.userId;

    group.players = group.players.filter(p => p.socketId !== socket.id);
    socket.leave('group_' + code);
    socket.groupCode = null;

    if (isCaptain) {
      // Captain leaves → kick all remaining members back to solo
      group.players.forEach(p => {
        const s = io.sockets.sockets.get(p.socketId);
        if (s) {
          s.leave('group_' + code);
          s.groupCode = null;
          // Create fresh solo group for them
          const solo = generateCode();
          const elo = getModeElo(s.userId, group.mode);
          const rec = db.getUserById(s.userId);
          groups[solo] = { mode: group.mode, captain: s.userId, players: [{ id: s.userId, pseudo: s.pseudo, elo, avatar: rec?.avatar||null, socketId: s.id }] };
          s.groupCode = solo;
          s.join('group_' + solo);
          s.emit('group_created', { code: solo, mode: group.mode, players: [{ pseudo: s.pseudo, elo }] });
          s.emit('chat_msg', { author: 'Système', team: 'system', text: '👑 Le capitaine a quitté le groupe.' });
        }
      });
      delete groups[code];
    } else {
      if (group.players.length === 0) delete groups[code];
      else io.to('group_' + code).emit('group_updated', { players: group.players.map(p => ({ pseudo: p.pseudo, elo: p.elo, avatar: p.avatar||null })), mode: group.mode });
    }

    // Create fresh solo group for the one who left
    const newCode = generateCode();
    const elo = getModeElo(socket.userId, socket.groupMode || '2v2');
    const userRec = db.getUserById(socket.userId);
    groups[newCode] = { mode: socket.groupMode||'2v2', captain: socket.userId, players: [{ id: socket.userId, pseudo: socket.pseudo, elo, avatar: userRec?.avatar||null, socketId: socket.id }] };
    socket.groupCode = newCode;
    socket.join('group_' + newCode);
    socket.emit('group_created', { code: newCode, mode: socket.groupMode||'2v2', players: [{ pseudo: socket.pseudo, elo }] });
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
    if (!room.alerts) room.alerts = new Set();
    if (room.alerts.has(socket.userId)) return;
    room.alerts.add(socket.userId);
    io.sockets.sockets.forEach(s => {
      if (s.isAdmin) s.emit('admin_alert_received', { roomId, type, pseudo });
    });
  });

  // ── RESET ALERT (admin dismissed, user can send once more) ──
  socket.on('reset_alert', ({ roomId }) => {
    if (!socket.isAdmin) return;
    const room = rooms[roomId];
    if (room && room.alerts) room.alerts.clear();
  });

  // ── ADMIN JOIN ROOM ──
  socket.on('admin_join_room', ({ roomId }) => {
    if (!socket.isAdmin) return;
    const room = rooms[roomId] || archivedRooms[roomId];
    if (!room) return socket.emit('notify_error', 'Room introuvable');
    socket.join('room_' + roomId);
    socket.adminRoomId = roomId;
    socket.roomId = roomId;
    socket.emit('admin_joined_room', {
      roomId,
      mode: room.mode,
      team1: (room.teams[0] || []).map(p => ({ pseudo: p.pseudo, elo: p.elo, avatar: p.avatar || null })),
      team2: (room.teams[1] || []).map(p => ({ pseudo: p.pseudo, elo: p.elo, avatar: p.avatar || null })),
      chatHistory: (room.chat || [])
    });
    if (rooms[roomId]) {
      io.to('room_' + roomId).emit('chat_msg', { author: 'Système', team: 'system', text: '👁️ Un admin a rejoint la room en spectateur.' });
    }
  });

  // ── ADMIN DECIDE (with draw) ──
  socket.on('admin_decide', ({ roomId, winner }) => {
    if (!socket.isAdmin) return;
    const room = rooms[roomId];
    if (!room || room.resultDeclared) return;
    room.resultDeclared = true;
    room.status = 'finished';
    clearTimeout(room.banTimer);
    if (winner === 0) {
      // Draw — no ELO change
      io.to('room_' + roomId).emit('chat_msg', { author: 'Système', team: 'system', text: '⚖️ Décision admin : Égalité — aucun ELO modifié.' });
      io.to('room_' + roomId).emit('game_result', { winner: 0, winTeam: [], loseTeam: [], mode: room.mode, draw: true });
    } else {
      const winTeam = winner === 1 ? room.teams[0] : room.teams[1];
      const loseTeam = winner === 1 ? room.teams[1] : room.teams[0];
      winTeam.filter(p => !p.isBot).forEach(p => db.updateUserElo(p.id, +20, true, room.mode));
      loseTeam.filter(p => !p.isBot).forEach(p => db.updateUserElo(p.id, -20, false, room.mode));
      computeCotd();
      io.to('room_' + roomId).emit('chat_msg', { author: 'Système', team: 'system', text: `⚖️ Décision admin : Équipe ${winner} gagne !` });
      io.to('room_' + roomId).emit('game_result', { winner, winTeam: winTeam.map(p => p.pseudo), loseTeam: loseTeam.map(p => p.pseudo), mode: room.mode });
    }
    setTimeout(() => { archiveRoom(roomId); }, 30000);
  });
});

server.listen(PORT, () => console.log(`✅ WAGERS sur http://localhost:${PORT}`));

// Fake rooms for live display
const FAKE_NAMES = ['Shadow','Blaze','Nova','Viper','Ghost','Storm','Frost','Ace','Echo','Raven','Void','Flux','Dusk','Neon','Wolf'];
const FAKE_MODES = ['1v1','2v2','3v3','5v5'];
const FAKE_WEAPONS_LIST = ['Vandal/Phantom','Sheriff','Operator','Marshall','Ghost'];
let fakeRooms = [];

function generateFakeRooms() {
  const count = 3 + Math.floor(Math.random() * 5); // 3-7
  fakeRooms = [];
  for (let i = 0; i < count; i++) {
    const mode = FAKE_MODES[Math.floor(Math.random() * FAKE_MODES.length)];
    const size = getTeamSize(mode);
    const fakeName = () => FAKE_NAMES[Math.floor(Math.random()*FAKE_NAMES.length)] + Math.floor(Math.random()*999);
    const t1 = Array.from({length:size}, fakeName);
    const t2 = Array.from({length:size}, fakeName);
    const statuses = ['playing','playing','playing','weapon_vote'];
    fakeRooms.push({
      id: 'FAKE_' + generateCode(4),
      mode, status: statuses[Math.floor(Math.random()*statuses.length)],
      duration: Math.floor(Math.random()*15) + 1 + 'm' + Math.floor(Math.random()*59).toString().padStart(2,'0') + 's',
      weapon: FAKE_WEAPONS_LIST[Math.floor(Math.random()*FAKE_WEAPONS_LIST.length)],
      map: null,
      team1: t1.map(p => p.slice(0,2)+'***'),
      team2: t2.map(p => p.slice(0,2)+'***'),
      total: size*2, max: size*2, fake: true
    });
  }
}
generateFakeRooms();
setInterval(generateFakeRooms, 20 * 60 * 1000); // refresh every 20min

// Friends API (request-based)
const DBFILE = () => process.env.NODE_ENV === 'production' ? '/tmp/db.json' : path.join(__dirname, 'db.json');
const readDB = () => JSON.parse(require('fs').readFileSync(DBFILE(), 'utf8'));
const writeDB = (data) => require('fs').writeFileSync(DBFILE(), JSON.stringify(data, null, 2));

app.get('/api/friends/:userId', (req, res) => {
  try {
    const data = readDB();
    const user = data.users.find(u => u.id === req.params.userId);
    if (!user) return res.json({ friends: [], requests: [] });
    const friends = (user.friends||[]).map(fId => {
      const f = data.users.find(u => u.id === fId);
      if (!f) return null;
      const online = [...io.sockets.sockets.values()].some(s => s.userId === fId);
      return { id: f.id, pseudo: f.pseudo, avatar: f.avatar||null, online };
    }).filter(Boolean);
    const incoming = (user.friendRequests||[]).map(rId => {
      const f = data.users.find(u => u.id === rId);
      if (!f) return null;
      return { id: f.id, pseudo: f.pseudo, avatar: f.avatar||null };
    }).filter(Boolean);
    res.json({ friends, requests: incoming });
  } catch(e) { res.json({ friends: [], requests: [] }); }
});

app.post('/api/friends/request', (req, res) => {
  const { userId, targetPseudo } = req.body;
  try {
    const data = readDB();
    const user = data.users.find(u => u.id === userId);
    const target = data.users.find(u => u.pseudo.toLowerCase() === (targetPseudo||'').toLowerCase());
    if (!user || !target) return res.status(404).json({ error: 'Joueur introuvable' });
    if (user.id === target.id) return res.status(400).json({ error: 'Impossible de vous ajouter vous-même' });
    if ((user.friends||[]).includes(target.id)) return res.status(400).json({ error: 'Déjà ami' });
    if (!target.friendRequests) target.friendRequests = [];
    if (target.friendRequests.includes(user.id)) return res.status(400).json({ error: 'Demande déjà envoyée' });
    target.friendRequests.push(user.id);
    writeDB(data);
    // Notify target if online
    io.sockets.sockets.forEach(s => {
      if (s.userId === target.id) s.emit('friend_request_received', { id: user.id, pseudo: user.pseudo, avatar: user.avatar||null });
    });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/friends/accept', (req, res) => {
  const { userId, requesterId } = req.body;
  try {
    const data = readDB();
    const user = data.users.find(u => u.id === userId);
    const requester = data.users.find(u => u.id === requesterId);
    if (!user || !requester) return res.status(404).json({ error: 'Introuvable' });
    user.friendRequests = (user.friendRequests||[]).filter(id => id !== requesterId);
    if (!user.friends) user.friends = [];
    if (!requester.friends) requester.friends = [];
    if (!user.friends.includes(requesterId)) user.friends.push(requesterId);
    if (!requester.friends.includes(userId)) requester.friends.push(userId);
    writeDB(data);
    io.sockets.sockets.forEach(s => {
      if (s.userId === requesterId) s.emit('friend_request_accepted', { id: user.id, pseudo: user.pseudo, avatar: user.avatar||null });
    });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/friends/decline', (req, res) => {
  const { userId, requesterId } = req.body;
  try {
    const data = readDB();
    const user = data.users.find(u => u.id === userId);
    if (user) user.friendRequests = (user.friendRequests||[]).filter(id => id !== requesterId);
    writeDB(data);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/friends/remove', (req, res) => {
  const { userId, targetId } = req.body;
  try {
    const data = readDB();
    const user = data.users.find(u => u.id === userId);
    const target = data.users.find(u => u.id === targetId);
    if (user) user.friends = (user.friends||[]).filter(f => f !== targetId);
    if (target) target.friends = (target.friends||[]).filter(f => f !== userId);
    writeDB(data);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Friend messages (in-memory per session, could be persisted)
const friendMessages = {}; // key: sortedIds joined, value: [{from, text, time}]
app.get('/api/friends/messages/:userId/:friendId', (req, res) => {
  const key = [req.params.userId, req.params.friendId].sort().join('_');
  res.json(friendMessages[key] || []);
});
app.post('/api/friends/messages', (req, res) => {
  const { fromId, toId, text } = req.body;
  if (!fromId || !toId || !text) return res.status(400).json({ error: 'Manquant' });
  const key = [fromId, toId].sort().join('_');
  if (!friendMessages[key]) friendMessages[key] = [];
  const msg = { from: fromId, text: text.slice(0,300), time: Date.now() };
  friendMessages[key].push(msg);
  // Notify recipient if online
  io.sockets.sockets.forEach(s => {
    if (s.userId === toId) s.emit('friend_message', { from: fromId, text: msg.text, time: msg.time });
  });
  res.json({ ok: true });
});

// Broadcast active rooms every 5s
function getActiveRoomsPayload() {
  const real = Object.values(rooms).filter(r => r.status !== 'finished').map(r => {
    const elapsed = Math.floor((Date.now() - (r.createdAt || Date.now())) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    const duration = mins > 0 ? `${mins}m${secs.toString().padStart(2,'0')}s` : `${secs}s`;
    const blur = (pseudo) => pseudo.slice(0,2) + '***';
    return {
      id: r.id, mode: r.mode, status: r.status, duration,
      weapon: r.chosenWeapon || null, map: r.chosenMap || null,
      team1: (r.teams[0]||[]).map(p => blur(p.pseudo)),
      team2: (r.teams[1]||[]).map(p => blur(p.pseudo)),
      total: ((r.teams[0]||[]).length + (r.teams[1]||[]).length),
      max: getTeamSize(r.mode) * 2, fake: false
    };
  });
  return [...real, ...fakeRooms];
}

setInterval(() => {
  io.emit('active_rooms_update', getActiveRoomsPayload());
}, 5000);

app.get('/api/active-rooms', (req, res) => res.json(getActiveRoomsPayload()));

// ═══════════════════════════════════════════════
// ── CLAN SYSTEM ──
// ═══════════════════════════════════════════════

// GET clan info
app.get('/api/clans', (req, res) => {
  try {
    const data = readDB();
    const clans = (data.clans || []).map(c => {
      const members = (c.members || []).map(mId => {
        const u = data.users.find(u => u.id === mId);
        return u ? { id: u.id, pseudo: u.pseudo, avatar: u.avatar || null } : null;
      }).filter(Boolean);
      const totalElo = members.reduce((sum, m) => {
        const u = data.users.find(u => u.id === m.id);
        if (!u) return sum;
        const elos = ['1v1','2v2','3v3','5v5'].map(mode => u.stats?.[mode]?.elo || 500);
        return sum + Math.max(...elos);
      }, 0);
      return { id: c.id, name: c.name, tag: c.tag, description: c.description || '', leaderId: c.leaderId, members, memberCount: members.length, totalElo, createdAt: c.createdAt };
    }).sort((a, b) => b.totalElo - a.totalElo);
    res.json(clans);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/clans/:id', (req, res) => {
  try {
    const data = readDB();
    const c = (data.clans || []).find(c => c.id === req.params.id);
    if (!c) return res.status(404).json({ error: 'Clan introuvable' });
    const members = (c.members || []).map(mId => {
      const u = data.users.find(u => u.id === mId);
      if (!u) return null;
      const maxElo = Math.max(...['1v1','2v2','3v3','5v5'].map(m => u.stats?.[m]?.elo || 500));
      return { id: u.id, pseudo: u.pseudo, avatar: u.avatar || null, isLeader: mId === c.leaderId, maxElo };
    }).filter(Boolean);
    const requests = (c.joinRequests || []).map(rId => {
      const u = data.users.find(u => u.id === rId);
      return u ? { id: u.id, pseudo: u.pseudo, avatar: u.avatar || null } : null;
    }).filter(Boolean);
    res.json({ ...c, members, joinRequests: requests });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Create clan
app.post('/api/clans/create', express.json(), (req, res) => {
  const { userId, name, tag, description } = req.body;
  if (!userId || !name || !tag) return res.status(400).json({ error: 'Champs manquants' });
  if (tag.length < 2 || tag.length > 4) return res.status(400).json({ error: 'Le tag doit faire 2 à 4 caractères' });
  if (name.length < 3 || name.length > 24) return res.status(400).json({ error: 'Nom: 3 à 24 caractères' });
  try {
    const data = readDB();
    if (!data.clans) data.clans = [];
    const user = data.users.find(u => u.id === userId);
    if (!user) return res.status(404).json({ error: 'Joueur introuvable' });
    if (user.clanId) return res.status(400).json({ error: 'Vous êtes déjà dans un clan' });
    const tagUp = tag.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (data.clans.find(c => c.tag === tagUp)) return res.status(400).json({ error: 'Ce tag est déjà pris' });
    if (data.clans.find(c => c.name.toLowerCase() === name.toLowerCase())) return res.status(400).json({ error: 'Ce nom est déjà pris' });
    const clan = { id: Date.now().toString(), name, tag: tagUp, description: description || '', leaderId: userId, members: [userId], joinRequests: [], createdAt: new Date().toISOString() };
    data.clans.push(clan);
    user.clanId = clan.id;
    writeDB(data);
    res.json({ ok: true, clan });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Request to join
app.post('/api/clans/request', express.json(), (req, res) => {
  const { userId, clanId } = req.body;
  try {
    const data = readDB();
    const user = data.users.find(u => u.id === userId);
    const clan = (data.clans || []).find(c => c.id === clanId);
    if (!user || !clan) return res.status(404).json({ error: 'Introuvable' });
    if (user.clanId) return res.status(400).json({ error: 'Vous êtes déjà dans un clan' });
    if (clan.members.length >= 10) return res.status(400).json({ error: 'Clan complet (10/10)' });
    if (!clan.joinRequests) clan.joinRequests = [];
    if (clan.joinRequests.includes(userId)) return res.status(400).json({ error: 'Demande déjà envoyée' });
    clan.joinRequests.push(userId);
    writeDB(data);
    // Notify leader
    io.sockets.sockets.forEach(s => { if (s.userId === clan.leaderId) s.emit('clan_join_request', { pseudo: user.pseudo, avatar: user.avatar || null, userId }); });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Accept/decline join request
app.post('/api/clans/accept', express.json(), (req, res) => {
  const { leaderId, userId, clanId } = req.body;
  try {
    const data = readDB();
    const clan = (data.clans || []).find(c => c.id === clanId);
    if (!clan) return res.status(404).json({ error: 'Clan introuvable' });
    if (clan.leaderId !== leaderId) return res.status(403).json({ error: 'Non autorisé' });
    if (clan.members.length >= 10) return res.status(400).json({ error: 'Clan complet' });
    clan.joinRequests = (clan.joinRequests || []).filter(id => id !== userId);
    if (!clan.members.includes(userId)) clan.members.push(userId);
    const target = data.users.find(u => u.id === userId);
    if (target) target.clanId = clanId;
    writeDB(data);
    io.sockets.sockets.forEach(s => { if (s.userId === userId) s.emit('clan_accepted', { clanName: clan.name, tag: clan.tag }); });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/clans/decline', express.json(), (req, res) => {
  const { leaderId, userId, clanId } = req.body;
  try {
    const data = readDB();
    const clan = (data.clans || []).find(c => c.id === clanId);
    if (!clan) return res.status(404).json({ error: 'Clan introuvable' });
    if (clan.leaderId !== leaderId) return res.status(403).json({ error: 'Non autorisé' });
    clan.joinRequests = (clan.joinRequests || []).filter(id => id !== userId);
    writeDB(data);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Leave clan
app.post('/api/clans/leave', express.json(), (req, res) => {
  const { userId, clanId } = req.body;
  try {
    const data = readDB();
    const clan = (data.clans || []).find(c => c.id === clanId);
    const user = data.users.find(u => u.id === userId);
    if (!clan || !user) return res.status(404).json({ error: 'Introuvable' });
    if (clan.leaderId === userId) {
      // Leader leaves → dissolve clan
      clan.members.forEach(mId => { const m = data.users.find(u => u.id === mId); if (m) { m.clanId = null; } });
      data.clans = data.clans.filter(c => c.id !== clanId);
      writeDB(data);
      return res.json({ ok: true, dissolved: true });
    }
    clan.members = clan.members.filter(id => id !== userId);
    user.clanId = null;
    writeDB(data);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Kick member (leader only)
app.post('/api/clans/kick', express.json(), (req, res) => {
  const { leaderId, targetId, clanId } = req.body;
  try {
    const data = readDB();
    const clan = (data.clans || []).find(c => c.id === clanId);
    if (!clan || clan.leaderId !== leaderId) return res.status(403).json({ error: 'Non autorisé' });
    clan.members = clan.members.filter(id => id !== targetId);
    const target = data.users.find(u => u.id === targetId);
    if (target) target.clanId = null;
    writeDB(data);
    io.sockets.sockets.forEach(s => { if (s.userId === targetId) s.emit('clan_kicked', { clanName: clan.name }); });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Clan chat messages (in-memory per session)
const clanMessages = {}; // clanId -> [{pseudo,text,time,avatar}]
app.get('/api/clans/:id/chat', (req, res) => {
  const msgs = (clanMessages[req.params.id] || []).slice(-60);
  res.json(msgs);
});
app.post('/api/clans/:id/chat', express.json(), (req, res) => {
  const { userId, pseudo, text } = req.body;
  if (!text || text.length > 200) return res.status(400).json({ error: 'Invalide' });
  const data = readDB();
  const user = data.users.find(u => u.id === userId);
  if (!user || user.banned) return res.status(403).json({ error: 'Interdit' });
  const clan = (data.clans || []).find(c => c.id === req.params.id);
  if (!clan || !clan.members.includes(userId)) return res.status(403).json({ error: 'Pas membre du clan' });
  if (!clanMessages[req.params.id]) clanMessages[req.params.id] = [];
  const msg = { pseudo, text: text.trim(), time: Date.now(), avatar: user.avatar || null };
  clanMessages[req.params.id].push(msg);
  if (clanMessages[req.params.id].length > 100) clanMessages[req.params.id].shift();
  // Emit to all clan members online
  clan.members.forEach(mId => { io.sockets.sockets.forEach(s => { if (s.userId === mId) s.emit('clan_chat_msg', { clanId: req.params.id, msg }); }); });
  res.json({ ok: true });
});

// Update clan description
app.post('/api/clans/update', express.json(), (req, res) => {
  const { leaderId, clanId, description } = req.body;
  try {
    const data = readDB();
    const clan = (data.clans || []).find(c => c.id === clanId);
    if (!clan || clan.leaderId !== leaderId) return res.status(403).json({ error: 'Non autorisé' });
    clan.description = (description || '').slice(0, 120);
    writeDB(data);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Get user's clan
app.get('/api/clans/user/:userId', (req, res) => {
  try {
    const data = readDB();
    const user = data.users.find(u => u.id === req.params.userId);
    if (!user || !user.clanId) return res.json(null);
    const clan = (data.clans || []).find(c => c.id === user.clanId);
    if (!clan) { user.clanId = null; writeDB(data); return res.json(null); }
    const members = clan.members.map(mId => {
      const m = data.users.find(u => u.id === mId);
      if (!m) return null;
      const maxElo = Math.max(...['1v1','2v2','3v3','5v5'].map(mo => m.stats?.[mo]?.elo || 500));
      return { id: m.id, pseudo: m.pseudo, avatar: m.avatar || null, isLeader: mId === clan.leaderId, maxElo };
    }).filter(Boolean);
    const requests = (clan.joinRequests || []).map(rId => {
      const u = data.users.find(u => u.id === rId);
      return u ? { id: u.id, pseudo: u.pseudo, avatar: u.avatar || null } : null;
    }).filter(Boolean);
    res.json({ ...clan, members, joinRequests: requests });
  } catch(e) { res.status(500).json({ error: e.message }); }
});