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
const ADMIN_PSEUDOS = ['Karim34', 'Telech', 'Biscuit']; // ← ajoute ton pseudo ici
const CONTENT_PSEUDOS = []; // ← pseudos avec le rôle Content (créateurs de tournois illimités)

// Check premium expiry on boot and every hour
db.checkPremiumExpiry();
setInterval(() => db.checkPremiumExpiry(), 60 * 60 * 1000);

// ── CHECK MUTE EXPIRY EVERY MINUTE ──
db.checkMuteExpiry();
setInterval(() => {
  db.checkMuteExpiry();
  [...io.sockets.sockets.values()].forEach(s => {
    if (s.isMuted && s.muteUntil && s.muteUntil <= Date.now()) {
      s.isMuted = false;
      s.muteUntil = null;
      s.emit('unmuted_by_admin', { message: '🔊 Ton mute a expiré, tu peux à nouveau écrire.' });
    }
  });
}, 60 * 1000);

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

// Twitch live cache
const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID || '';
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET || '';
let twitchTokenCache = null;
let twitchStreamsCache = [];
let twitchLastFetch = 0;

async function getTwitchToken() {
  if (twitchTokenCache && twitchTokenCache.expiresAt > Date.now()) return twitchTokenCache.token;
  if (!TWITCH_CLIENT_ID || !TWITCH_CLIENT_SECRET) return null;
  try {
    const r = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${TWITCH_CLIENT_ID}&client_secret=${TWITCH_CLIENT_SECRET}&grant_type=client_credentials`, { method: 'POST' });
    const d = await r.json();
    if (!d.access_token) return null;
    twitchTokenCache = { token: d.access_token, expiresAt: Date.now() + (d.expires_in - 60) * 1000 };
    return twitchTokenCache.token;
  } catch(e) { return null; }
}

async function fetchTwitchStreams() {
  const token = await getTwitchToken();
  if (!token) return [];
  try {
    const r = await fetch('https://api.twitch.tv/helix/streams?game_name=VALORANT&first=20', {
      headers: { 'Client-ID': TWITCH_CLIENT_ID, 'Authorization': `Bearer ${token}` }
    });
    const d = await r.json();
    // Filter streams with #Revenge or #RevengeGG in their title
    const streams = (d.data || []).filter(s =>
      s.title && (
        s.title.toLowerCase().includes('#revenge') ||
        s.title.toLowerCase().includes('revenge.gg') ||
        s.title.toLowerCase().includes('revengegg') ||
        s.tags?.some?.(t => t.toLowerCase() === 'revenge')
      )
    );
    return streams.map(s => ({
      user_login: s.user_login,
      user_name: s.user_name,
      title: s.title,
      viewer_count: s.viewer_count,
      thumbnail_url: s.thumbnail_url.replace('{width}', '320').replace('{height}', '180'),
      started_at: s.started_at,
    }));
  } catch(e) { return []; }
}

// Refresh every 2 minutes
async function refreshTwitchCache() {
  twitchStreamsCache = await fetchTwitchStreams();
  twitchLastFetch = Date.now();
}
if (TWITCH_CLIENT_ID) {
  refreshTwitchCache();
  setInterval(refreshTwitchCache, 2 * 60 * 1000);
}
function isAdminReq(req) { return req.headers['x-admin-key'] === ADMIN_KEY; }
// ── ADMIN: PREMIUM ──
// Smurf detection: find IPs with 2+ accounts having ELO difference > 150
// Referral API
app.get('/api/referrals/:userId', (req, res) => {
  try {
    const data = db.loadDB();
    const user = data.users.find(u => u.id === req.params.userId);
    if (!user) return res.status(404).json({ error: 'Introuvable' });

    // Recalculate gamesPlayed live from each referral's actual stats
    const knownReferrals = (user.referrals || []).map(r => {
      const ru = data.users.find(u => u.id === r.userId);
      const gamesPlayed = ru
        ? Object.values(ru.stats || {}).reduce((s, m) => s + (m.wins || 0) + (m.losses || 0), 0)
        : (r.gamesPlayed || 0);
      return { userId: r.userId, pseudo: ru?.pseudo || r.pseudo, avatar: ru?.avatar || null, date: r.date, gamesPlayed };
    });

    // Also find any referrals not yet in the array (edge case / old accounts)
    const knownIds = new Set(knownReferrals.map(r => r.userId));
    const extraReferrals = data.users
      .filter(u => u.referredBy === user.id && !knownIds.has(u.id))
      .map(u => ({
        userId: u.id,
        pseudo: u.pseudo,
        avatar: u.avatar || null,
        date: u.createdAt,
        gamesPlayed: Object.values(u.stats || {}).reduce((s, m) => s + (m.wins || 0) + (m.losses || 0), 0)
      }));

    const allReferrals = [...knownReferrals, ...extraReferrals];
    const qualified = allReferrals.filter(r => r.gamesPlayed >= 3).length;

    // Auto-grant reward if now eligible but not yet given
    if (qualified >= 3 && !user.referralRewardGiven) {
      user.referralRewardGiven = true;
      const weekMs = 7 * 24 * 60 * 60 * 1000;
      user.isPremium = true;
      user.premiumUntil = (user.premiumUntil && user.premiumUntil > Date.now())
        ? user.premiumUntil + weekMs : Date.now() + weekMs;
      db.saveDB(data);
      const s = [...io.sockets.sockets.values()].find(s => s.userId === user.id);
      if (s) s.emit('premium_granted', { months: 0.25, message: '🎁 Tu as parrainé 3 joueurs actifs ! 1 semaine de Premium offerte !' });
    }

    res.json({ referralCode: user.referralCode, referrals: allReferrals, rewardGiven: !!user.referralRewardGiven });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Staff online status
app.get('/api/admin/staff', (req, res) => {
  if (!isAdminReq(req)) return res.status(403).json({ error: 'Interdit' });
  const onlineSockets = [...io.sockets.sockets.values()];
  const staff = ADMIN_PSEUDOS.map(pseudo => {
    const s = onlineSockets.find(s => s.pseudo === pseudo);
    const user = (() => { try { const d = require('fs').existsSync(DBFILE()) ? JSON.parse(require('fs').readFileSync(DBFILE(),'utf8')) : {users:[]}; return d.users.find(u => u.pseudo === pseudo); } catch(e) { return null; } })();
    return {
      pseudo,
      online: !!s,
      lastSeen: s ? null : (user?.lastSeen || null),
      avatar: user?.avatar || null
    };
  });
  res.json({ staff });
});

// Group chat - socket event handled below
// Admin ELO adjustment
app.post('/api/admin/elo', express.json(), (req, res) => {
  if (!isAdminReq(req)) return res.status(403).json({ error: 'Interdit' });
  const { pseudo, mode, amount } = req.body;
  if (!pseudo || !mode || amount === undefined) return res.status(400).json({ error: 'Champs manquants' });
  const amt = parseInt(amount);
  if (isNaN(amt) || Math.abs(amt) > 9999) return res.status(400).json({ error: 'Montant invalide (max ±9999)' });
  const data = (() => { try { return require('fs').existsSync(DBFILE()) ? JSON.parse(require('fs').readFileSync(DBFILE(),'utf8')) : {users:[]}; } catch(e) { return {users:[]}; } })();
  const user = data.users.find(u => u.pseudo.toLowerCase() === pseudo.toLowerCase());
  if (!user) return res.status(404).json({ error: 'Joueur introuvable' });
  if (!user.stats) user.stats = {};
  if (!user.stats[mode]) user.stats[mode] = { elo: 500, wins: 0, losses: 0 };
  const before = user.stats[mode].elo;
  user.stats[mode].elo = Math.max(0, before + amt);
  require('fs').writeFileSync(DBFILE(), JSON.stringify(data, null, 2));
  // Notify player if online
  const playerSocket = [...io.sockets.sockets.values()].find(s => s.userId === user.id);
  if (playerSocket) {
    playerSocket.emit('elo_adjusted', { mode, amount: amt, newElo: user.stats[mode].elo });
  }
  db.addAdminLog(req.headers['x-admin-pseudo'] || 'Admin', 'ELO', user.pseudo, `${mode}: ${amt > 0 ? '+' : ''}${amt} (${before} → ${user.stats[mode].elo})`);
  res.json({ ok: true, pseudo: user.pseudo, mode, before, after: user.stats[mode].elo, change: amt });
});

app.get('/api/admin/smurfs', (req, res) => {
  if (!isAdminReq(req)) return res.status(403).json({ error: 'Interdit' });
  try {
    const data = (() => { try { return require('fs').existsSync(DBFILE()) ? JSON.parse(require('fs').readFileSync(DBFILE(),'utf8')) : {users:[]}; } catch(e) { return {users:[]}; } })();
    const byIp = {};
    (data.users || []).forEach(u => {
      if (!u.ip) return;
      if (!byIp[u.ip]) byIp[u.ip] = [];
      const maxElo = Math.max(...['1v1','2v2','3v3','5v5'].map(m => u.stats?.[m]?.elo || 500));
      byIp[u.ip].push({ id: u.id, pseudo: u.pseudo, maxElo, banned: !!u.banned, createdAt: u.createdAt });
    });
    const suspects = [];
    Object.entries(byIp).forEach(([ip, accounts]) => {
      if (accounts.length < 2) return;
      suspects.push({ ip, accounts, count: accounts.length });
    });
    suspects.sort((a, b) => b.count - a.count);
    res.json({ suspects });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/all-users', (req, res) => {
  if (!isAdminReq(req)) return res.status(403).json({ error: 'Interdit' });
  const { loadDB } = require('./database');
  // read directly
  const data = (() => { try { return require('fs').existsSync(DBFILE()) ? JSON.parse(require('fs').readFileSync(DBFILE(),'utf8')) : {users:[]}; } catch(e) { return {users:[]}; } })();
  const users = (data.users || []).map(u => ({
    id: u.id, pseudo: u.pseudo, isPremium: !!u.isPremium, premiumUntil: u.premiumUntil || null, banned: !!u.banned
  }));
  res.json({ users });
});

app.get('/api/admin/find-user', (req, res) => {
  if (!isAdminReq(req)) return res.status(403).json({ error: 'Interdit' });
  const pseudo = req.query.pseudo;
  if (!pseudo) return res.status(400).json({ error: 'Pseudo requis' });
  const user = db.getUserByPseudo(pseudo);
  if (!user) return res.status(404).json({ error: 'Introuvable' });
  const data = db.loadDB();
  const isTargetAdmin = ADMIN_PSEUDOS.includes(user.pseudo);
  // Find all accounts sharing the same IP (hidden if target is admin)
  const sameIpAccounts = (!isTargetAdmin && user.ip)
    ? data.users.filter(u => u.ip === user.ip && u.id !== user.id).map(u => ({ id: u.id, pseudo: u.pseudo, createdAt: u.createdAt, banned: !!u.banned, stats: u.stats }))
    : [];
  // Is user currently online?
  const onlineSocket = [...io.sockets.sockets.values()].find(s => s.userId === user.id);
  res.json({
    id: user.id,
    pseudo: user.pseudo,
    ip: isTargetAdmin ? '🔒 Masquée (compte staff)' : (user.ip || null),
    createdAt: user.createdAt,
    banned: !!user.banned,
    banReason: user.banReason || null,
    muted: !!user.muted,
    muteUntil: user.muteUntil || null,
    isPremium: !!user.isPremium,
    premiumUntil: user.premiumUntil || null,
    stats: user.stats || {},
    matchHistory: (user.matchHistory || []),
    sameIpAccounts,
    online: !!onlineSocket,
    clanId: user.clanId || null,
    referralCode: user.referralCode || null,
    referredBy: user.referredBy || null,
    referrals: (user.referrals || []).map(r => { const ru = data.users.find(u => u.id === r.userId); return { ...r, pseudo: ru?.pseudo || r.pseudo }; })
  });
});

app.post('/api/admin/premium', (req, res) => {
  if (!isAdminReq(req)) return res.status(403).json({ error: 'Interdit' });
  const { userId, months } = req.body;
  const ok = db.setPremium(userId, months || 1);
  if (!ok) return res.status(404).json({ error: 'Utilisateur introuvable' });
  const pu = db.getUserById(userId);
  db.addAdminLog(req.headers['x-admin-pseudo'] || 'Admin', 'PREMIUM', pu?.pseudo || userId, `${months || 1} mois`);
  io.sockets.sockets.forEach(s => {
    if (s.userId === userId) s.emit('premium_granted', { months: months || 1 });
  });
  res.json({ success: true });
});

app.post('/api/admin/revoke-premium', (req, res) => {
  if (!isAdminReq(req)) return res.status(403).json({ error: 'Interdit' });
  const { userId } = req.body;
  const ok = db.revokePremium(userId);
  if (!ok) return res.status(404).json({ error: 'Utilisateur introuvable' });
  io.sockets.sockets.forEach(s => {
    if (s.userId === userId) s.emit('premium_revoked');
  });
  res.json({ success: true });
});

app.post('/api/admin/revoke-premium', (req, res) => {
  if (!isAdminReq(req)) return res.status(403).json({ error: 'Interdit' });
  const { userId } = req.body;
  const ok = db.revokePremium(userId);
  if (!ok) return res.status(404).json({ error: 'Utilisateur introuvable' });
  io.sockets.sockets.forEach(s => {
    if (s.userId === userId) s.emit('premium_revoked');
  });
  res.json({ success: true });
});

// ── CONTENT ROLE ──
app.post('/api/admin/set-content', (req, res) => {
  if (!isAdminReq(req)) return res.status(403).json({ error: 'Interdit' });
  const { pseudo } = req.body;
  if (!pseudo) return res.status(400).json({ error: 'Pseudo manquant' });
  if (!CONTENT_PSEUDOS.includes(pseudo)) {
    CONTENT_PSEUDOS.push(pseudo);
    // Mettre à jour le socket actif si connecté
    io.sockets.sockets.forEach(s => {
      if (s.pseudo === pseudo) { s.isContent = true; s.emit('content_granted'); }
    });
  }
  res.json({ ok: true, contentPseudos: CONTENT_PSEUDOS });
});

app.post('/api/admin/revoke-content', (req, res) => {
  if (!isAdminReq(req)) return res.status(403).json({ error: 'Interdit' });
  const { pseudo } = req.body;
  const idx = CONTENT_PSEUDOS.indexOf(pseudo);
  if (idx !== -1) {
    CONTENT_PSEUDOS.splice(idx, 1);
    io.sockets.sockets.forEach(s => {
      if (s.pseudo === pseudo) { s.isContent = false; s.emit('content_revoked'); }
    });
  }
  res.json({ ok: true, contentPseudos: CONTENT_PSEUDOS });
});

app.get('/api/admin/content-list', (req, res) => {
  if (!isAdminReq(req)) return res.status(403).json({ error: 'Interdit' });
  res.json({ contentPseudos: CONTENT_PSEUDOS });
});

app.post('/api/admin/ban', (req, res) => {
  if (!isAdminReq(req)) return res.status(403).json({ error: 'Interdit' });
  const { pseudo, userId, reason } = req.body;
  const user = pseudo ? db.getUserByPseudo(pseudo) : db.getUserById(userId);
  if (!user) return res.status(404).json({ error: 'Introuvable' });
  db.banUser(user.id, reason);
  db.addAdminLog(req.headers['x-admin-pseudo'] || 'Admin', 'BAN', user.pseudo, reason || 'violation des règles');
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
  db.addAdminLog(req.headers['x-admin-pseudo'] || 'Admin', 'UNBAN', user.pseudo, null);
  res.json({ ok: true });
});
app.post('/api/admin/mute', (req, res) => {
  if (!isAdminReq(req)) return res.status(403).json({ error: 'Interdit' });
  const { pseudo, userId, duration } = req.body; // duration in minutes, null = permanent
  const user = pseudo ? db.getUserByPseudo(pseudo) : db.getUserById(userId);
  if (!user) return res.status(404).json({ error: 'Introuvable' });
  db.muteUser(user.id, duration || null);
  // Update socket state live
  const s = [...io.sockets.sockets.values()].find(s => s.userId === user.id);
  if (s) {
    s.isMuted = true;
    s.muteUntil = user.muteUntil || null;
    const msg = duration ? `🔇 Tu as été mute pour ${duration} minute${duration>1?'s':''}.` : '🔇 Tu as été mute indéfiniment par un admin.';
    s.emit('muted_by_admin', { duration, muteUntil: user.muteUntil, message: msg });
  }
  db.addAdminLog(req.headers['x-admin-pseudo'] || 'Admin', 'MUTE', user.pseudo, duration ? `${duration} min` : 'permanent');
  res.json({ ok: true, pseudo: user.pseudo, duration });
});
app.post('/api/admin/unmute', (req, res) => {
  if (!isAdminReq(req)) return res.status(403).json({ error: 'Interdit' });
  const { pseudo } = req.body;
  const user = db.getUserByPseudo(pseudo);
  if (!user) return res.status(404).json({ error: 'Introuvable' });
  db.unmuteUser(user.id);
  db.addAdminLog(req.headers['x-admin-pseudo'] || 'Admin', 'UNMUTE', user.pseudo, null);
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
  if (ticket.error === 'MAX_TICKETS') return res.status(429).json({ error: 'Tu as déjà 2 tickets ouverts. Attends qu\'ils soient résolus avant d\'en créer un autre.' });
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

app.post('/api/banner', express.json({ limit: '3mb' }), (req, res) => {
  const { userId, banner } = req.body;
  if (!userId || !banner) return res.status(400).json({ error: 'Manquant' });
  const user = db.getUserById(userId);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  if (!user.isPremium) return res.status(403).json({ error: 'PREMIUM_REQUIRED' });
  db.updateBanner(userId, banner);
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
  if (!userId || !pseudo || !text || text.length > 120) return res.status(400).json({ error: 'Invalide' });
  const user = db.getUserById(userId);
  if (!user || user.banned) return res.status(403).json({ error: 'Interdit' });
  if (user.muted) return res.status(403).json({ error: 'Mute' });
  const isAdminUser = ADMIN_PSEUDOS.includes(pseudo);
  const isContentUser = CONTENT_PSEUDOS.includes(pseudo);
  const role = isAdminUser ? 'admin' : (isContentUser ? 'content' : null);
  const msg = { pseudo, text: text.trim(), time: Date.now(), avatar: user.avatar||null, isPremium: !!user.isPremium, role };
  globalChat.push(msg);
  if (globalChat.length > GLOBAL_CHAT_MAX) globalChat.shift();
  io.emit('global_chat_msg', msg);
  res.json({ ok: true });
});

const groups = {};
const rooms = {};
const archivedRooms = {};
// Solo queue: { mode -> [{ player, groupCode, socketId, elo, joinedAt }] }
const soloQueue = { '2v2': [], '3v3': [], '5v5': [] };

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
  room.startedAt = Date.now(); // toujours réinitialiser au vrai début
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


// Emit game_result to all room members by their stored socketId (guarantees delivery even if socket room membership was lost)
function emitGameResult(roomId, payload) {
  const room = rooms[roomId];
  // Broadcast to socket room (covers normal case)
  io.to('room_' + roomId).emit('game_result', payload);
  // Also send directly to each player socket as backup
  if (room) {
    [...(room.teams[0] || []), ...(room.teams[1] || [])].filter(p => p.socketId).forEach(p => {
      const s = io.sockets.sockets.get(p.socketId);
      if (s) s.emit('game_result', payload);
    });
  }
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
      room.startedAt = room.startedAt || Date.now();
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

// ── SEASON CHECK ──
db.checkSeasonReset();
setInterval(() => { db.checkSeasonReset(); }, 60 * 1000);

// ── ADMIN LOGS & SEASON API ──
app.get('/api/admin/logs', (req, res) => {
  if (!isAdminReq(req)) return res.status(403).json({ error: 'Interdit' });
  res.json({ logs: db.getAdminLogs() });
});

app.get('/api/season', (req, res) => {
  res.json({ season: db.getCurrentSeason(), archives: db.getSeasonArchives() });
});

app.post('/api/admin/backup', async (req, res) => {
  if (!isAdminReq(req)) return res.status(403).json({ error: 'Interdit' });
  await sendBackupToDiscord();
  res.json({ ok: true, message: 'Backup envoyée sur Discord' });
});

// Route pour restaurer la DB depuis un upload direct (admin only)
app.post('/api/admin/restore-db', (req, res) => {
  if (!isAdminReq(req)) return res.status(403).json({ error: 'Interdit' });
  try {
    const data = req.body;
    if (!data || !Array.isArray(data.users)) return res.status(400).json({ error: 'Format invalide' });
    const fs = require('fs');
    const DBFILE_PATH = process.env.NODE_ENV === 'production' ? '/tmp/db.json' : './db.json';
    fs.writeFileSync(DBFILE_PATH, JSON.stringify(data, null, 2));
    // Reload in memory
    const fresh = db.loadDB();
    res.json({ ok: true, users: fresh.users.length });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

io.on('connection', (socket) => {

  // ── REGISTER ──
  socket.on('register', async ({ pseudo, password, referralCode }) => {
    try {
      if (!pseudo || !password) return socket.emit('auth_error', 'Champs manquants');
      if (pseudo.length < 3) return socket.emit('auth_error', 'Pseudo trop court (3 min)');
      if (db.getUserByPseudo(pseudo)) return socket.emit('auth_error', 'Pseudo déjà pris');

      // Anti double compte par IP
      const ip = socket.handshake.headers['x-forwarded-for']?.split(',')[0] || socket.handshake.address;
      const existing = db.getIpAccounts(ip);
      if (existing.length >= 2) return socket.emit('auth_error', 'Trop de comptes créés depuis cette adresse');

      const hashed = await bcrypt.hash(password, 10);
      const user = db.createUser(pseudo, hashed, ip, referralCode || null);
      socket.userId = user.id;
      socket.pseudo = user.pseudo;
      socket.isAdmin = ADMIN_PSEUDOS.includes(pseudo);
      socket.isContent = CONTENT_PSEUDOS.includes(pseudo);
      socket.isMuted = false;
      socket.isPremium = false;
      const stats = user.stats || db.defaultStats();
      socket.emit('auth_ok', {
        pseudo: user.pseudo,
        elo: stats['2v2']?.elo || 500,
        stats,
        isAdmin: socket.isAdmin,
        isContent: socket.isContent || false,
        avatar: user.avatar || null,
        userId: user.id,
        isPremium: false,
        premiumUntil: null,
        referralCode: user.referralCode || null
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
      socket.isContent = CONTENT_PSEUDOS.includes(pseudo);
      socket.isMuted = !!user.muted && (!user.muteUntil || user.muteUntil > Date.now());
      socket.muteUntil = user.muteUntil || null;
      const stats = user.stats || db.defaultStats();
      socket.isPremium = !!user.isPremium;
      socket.emit('auth_ok', {
        pseudo: user.pseudo,
        elo: stats['2v2']?.elo || 500,
        stats,
        isAdmin: socket.isAdmin,
        isContent: socket.isContent || false,
        avatar: user.avatar || null,
        userId: user.id,
        isPremium: !!user.isPremium,
        premiumUntil: user.premiumUntil || null,
        referralCode: user.referralCode || null
      });
    } catch(e) { socket.emit('auth_error', 'Erreur: ' + e.message); }
  });

  // ── REJOIN ROOM (reconnexion F5) ──
  socket.on('rejoin_room', ({ roomId, userId }) => {
    if (!roomId || !userId) return;
    // Vérifier que la room existe et est active
    const room = rooms[roomId];
    if (!room || room.status === 'finished') {
      socket.emit('rejoin_failed', { reason: 'Room terminée ou introuvable' });
      return;
    }
    // Vérifier que le joueur est bien dans cette room
    const allPlayers = [...(room.teams[0] || []), ...(room.teams[1] || [])];
    const player = allPlayers.find(p => p.id === userId);
    if (!player) {
      socket.emit('rejoin_failed', { reason: "Tu n'es pas dans cette room" });
      return;
    }
    // Mettre à jour le socketId du joueur
    player.socketId = socket.id;
    socket.userId = userId;
    socket.pseudo = player.pseudo;
    socket.roomId = roomId;
    socket.join('room_' + roomId);
    // Reconstituer le payload
    const cap1 = room.captains ? room.captains[0] : null;
    const cap2 = room.captains ? room.captains[1] : null;
    const capPseudos = [
      cap1 ? (allPlayers.find(p => p.id === cap1)?.pseudo || null) : null,
      cap2 ? (allPlayers.find(p => p.id === cap2)?.pseudo || null) : null
    ];
    socket.emit('room_ready', {
      roomId,
      mode: room.mode,
      team1: room.teams[0].map(p => ({ pseudo: p.pseudo, elo: p.elo, avatar: p.avatar || null, stats: p.stats || null, isPremium: !!p.isPremium })),
      team2: room.teams[1].map(p => ({ pseudo: p.pseudo, elo: p.elo, avatar: p.avatar || null, stats: p.stats || null, isPremium: !!p.isPremium })),
      captains: capPseudos,
      waiting: room.status === 'waiting' && room.teams[1].length === 0
    });
    // Renvoyer l'historique du chat
    if (room.chat && room.chat.length > 0) {
      socket.emit('rejoin_chat', { history: room.chat.slice(-30) });
    }
    // Notifier la room
    io.to('room_' + roomId).emit('chat_msg', { author: 'Système', team: 'system', text: `🔄 ${player.pseudo} a rejoint la room.` });
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
    socket.emit('profile_data', { id: user.id, pseudo: user.pseudo, stats, winrate, totalWins, totalLosses, avatar: user.avatar || null, banner: user.banner || null, isPremium: !!user.isPremium });
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
    io.to('group_' + code).emit('group_updated', { players: group.players.map(p => ({ pseudo: p.pseudo, elo: p.elo, avatar: p.avatar || null, stats: p.stats || null })), mode: group.mode });
    socket.emit('group_created', { code, mode: group.mode, players: group.players.map(p => ({ pseudo: p.pseudo, elo: p.elo, avatar: p.avatar || null, stats: p.stats || null })) });

    // Also create a fake opponent group and trigger room
    const oppGroupCode = generateCode();
    const oppPlayers = [];
    for (let i = 0; i < teamSize; i++) {
      oppPlayers.push({ id: 'bot_opp_' + i, pseudo: 'Adversaire' + (i+1), elo: 500, stats: { '1v1': {elo:500,wins:0,losses:0}, '2v2': {elo:500,wins:0,losses:0}, '3v3': {elo:500,wins:0,losses:0}, '5v5': {elo:500,wins:0,losses:0} }, socketId: null, isBot: true });
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
    const botCap1 = room.teams[0].find(p => !p.isBot);
    room.captains = [botCap1?.id || null, null]; // no cap2 since all bots
    room.votes = {};
    const payload = {
      roomId, mode: room.mode,
      team1: room.teams[0].map(p => ({ pseudo: p.pseudo, elo: p.elo, avatar: p.avatar || null, stats: p.stats || null })),
      team2: room.teams[1].map(p => ({ pseudo: p.pseudo, elo: p.elo, avatar: p.avatar || null, stats: p.stats || null })),
      captains: [botCap1?.pseudo || null, null],
      waiting: false
    };
    if (rooms[roomId]) rooms[roomId].startedAt = rooms[roomId].startedAt || Date.now();
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
      players: [{ id: socket.userId, pseudo: socket.pseudo, elo, avatar: userRecord?.avatar || null, stats: userRecord?.stats || null, isPremium: !!userRecord?.isPremium, socketId: socket.id }]
    };
    socket.groupCode = code;
    socket.groupMode = mode;
    socket.join('group_' + code);
    socket.emit('group_created', { code, mode, players: groups[code].players.map(p => ({ pseudo: p.pseudo, elo: p.elo, avatar: p.avatar || null, stats: p.stats || null })) });
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
    socket.emit('group_created', { code: newCode, mode: group.mode, players: group.players.map(p => ({ pseudo: p.pseudo, elo: p.elo, avatar: p.avatar || null, stats: p.stats || null })) });
    io.to('group_' + newCode).emit('group_updated', { players: group.players.map(p => ({ pseudo: p.pseudo, elo: p.elo, avatar: p.avatar || null, stats: p.stats || null })), mode: group.mode, newCode });
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
    group.players.push({ id: socket.userId, pseudo: socket.pseudo, elo, avatar: userRecord?.avatar || null, stats: userRecord?.stats || null, socketId: socket.id });
    socket.groupCode = code.toUpperCase();
    socket.groupMode = group.mode;
    socket.join('group_' + code.toUpperCase());

    const publicPlayers = group.players.map(p => ({ pseudo: p.pseudo, elo: p.elo, avatar: p.avatar || null, stats: p.stats || null }));
    io.to('group_' + code.toUpperCase()).emit('group_updated', { players: publicPlayers, mode: group.mode });
    socket.emit('group_joined', { code: code.toUpperCase(), players: publicPlayers, mode: group.mode });
  });

  // ── CREATE ROOM ──
  socket.on('create_room', () => {
    const entry = getGroupBySocket(socket.id);
    if (!entry) return socket.emit('room_error', 'Pas dans un groupe');
    const [code, group] = entry;
    const teamSize = getTeamSize(group.mode);

    // ── SOLO QUEUE (1 player queueing in 2v2/3v3/5v5) ──
    if (group.players.length === 1 && teamSize > 1 && soloQueue[group.mode] !== undefined) {
      const player = group.players[0];
      // Refresh ELO from DB
      const fresh = db.getUserById(player.id);
      if (fresh) { player.stats = fresh.stats; player.elo = fresh.stats?.[group.mode]?.elo || 500; }
      // Remove from queue if already in it (reconnect case)
      soloQueue[group.mode] = soloQueue[group.mode].filter(e => e.player.id !== player.id);
      soloQueue[group.mode].push({ player, groupCode: code, elo: player.elo || 500, joinedAt: Date.now() });
      socket.emit('chat_msg', { author: 'Système', team: 'system', text: `⏳ Tu es en file solo ${group.mode} — en attente de ${teamSize * 2 - 1} autre(s) joueur(s)…` });
      // Check if we have enough solos to form a full match (2 × teamSize)
      const needed = teamSize * 2;
      if (soloQueue[group.mode].length >= needed) {
        // Sort by ELO and take the needed players (closest ELO match possible)
        const sorted = [...soloQueue[group.mode]].sort((a, b) => a.elo - b.elo);
        const chosen = sorted.slice(0, needed);
        // Remove chosen from queue
        const chosenIds = new Set(chosen.map(e => e.player.id));
        soloQueue[group.mode] = soloQueue[group.mode].filter(e => !chosenIds.has(e.player.id));
        // Split into two teams
        const team1Players = chosen.slice(0, teamSize).map(e => e.player);
        const team2Players = chosen.slice(teamSize).map(e => e.player);
        const roomId = 'R' + generateCode(4);
        const cap1 = team1Players[0];
        const cap2 = team2Players[0];
        const room = {
          id: roomId, mode: group.mode,
          teams: [team1Players, team2Players],
          chat: [], mapBans: [], banTurn: 0, status: 'waiting',
          chosenMap: null, banTimer: null, createdAt: Date.now(),
          avgElo: Math.round(chosen.reduce((s, e) => s + e.elo, 0) / chosen.length),
          captains: [cap1.id, cap2.id], captainPseudos: [cap1.pseudo, cap2.pseudo], votes: {}
        };
        rooms[roomId] = room;
        // Join all players to socket room
        chosen.forEach(e => {
          const s = io.sockets.sockets.get(e.player.socketId);
          if (s) { s.join('room_' + roomId); s.roomId = roomId; }
        });
        const payload = {
          roomId, mode: room.mode,
          team1: team1Players.map(p => ({ pseudo: p.pseudo, elo: p.elo, avatar: p.avatar || null, stats: p.stats || null, isPremium: !!p.isPremium })),
          team2: team2Players.map(p => ({ pseudo: p.pseudo, elo: p.elo, avatar: p.avatar || null, stats: p.stats || null, isPremium: !!p.isPremium })),
          captains: [cap1.pseudo, cap2.pseudo], waiting: false
        };
        io.to('room_' + roomId).emit('room_ready', payload);
        io.to('room_' + roomId).emit('chat_msg', { author: 'Système', team: 'system', text: `✅ Match solo trouvé en ${group.mode} ! Début dans 10 secondes…` });
        startRoomCountdown(roomId);
      }
      return;
    }

    if (group.players.length < teamSize) return socket.emit('room_error', `Il faut ${teamSize} joueur(s) dans le groupe`);
    // Refresh stats/elo from DB for all real players before entering room
    group.players.filter(p => !p.isBot).forEach(p => {
      const fresh = db.getUserById(p.id);
      if (fresh) { p.stats = fresh.stats; p.elo = fresh.stats?.[group.mode]?.elo || 500; }
    });

    // ── ELO MATCHMAKING ──
    // Average ELO of this group
    const groupAvgElo = Math.round(
      group.players.filter(p => !p.isBot).reduce((s, p) => s + (p.elo || 500), 0) /
      Math.max(1, group.players.filter(p => !p.isBot).length)
    );

    // Tag room with search start time + avg elo for matchmaking
    // Find best ELO match among waiting rooms of same mode
    const waitingRooms = Object.entries(rooms).filter(([, r]) => r.status === 'waiting' && r.mode === group.mode);

    // Expanding ELO window: starts at ±100, grows by 50 every 60s (max ±500)
    function getEloWindow(room) {
      const waitSecs = (Date.now() - (room.createdAt || Date.now())) / 1000;
      return Math.min(500, 100 + Math.floor(waitSecs / 60) * 50);
    }

    // Find best matching room (closest ELO within current window)
    let bestMatch = null, bestDiff = Infinity;
    for (const [rId, r] of waitingRooms) {
      const roomAvg = r.avgElo || 500;
      const window = getEloWindow(r);
      const diff = Math.abs(roomAvg - groupAvgElo);
      if (diff <= window && diff < bestDiff) {
        bestDiff = diff;
        bestMatch = [rId, r];
      }
    }

    let roomId, room;

    if (bestMatch) {
      [roomId, room] = bestMatch;
      room.teams[1] = group.players;

      // Join socket room
      group.players.forEach(p => {
        const s = io.sockets.sockets.get(p.socketId);
        if (s) { s.join('room_' + roomId); s.roomId = roomId; }
      });

      // Store captains (first real player of each team)
      const cap1 = room.teams[0].find(p => !p.isBot);
      const cap2 = room.teams[1].find(p => !p.isBot);
      room.captains = [cap1?.id || null, cap2?.id || null];
      room.votes = {};
      // Send full room info to everyone
      const payload = {
        roomId,
        mode: room.mode,
        team1: room.teams[0].map(p => ({ pseudo: p.pseudo, elo: p.elo, avatar: p.avatar || null, stats: p.stats || null, isPremium: !!p.isPremium })),
        team2: room.teams[1].map(p => ({ pseudo: p.pseudo, elo: p.elo, avatar: p.avatar || null, stats: p.stats || null, isPremium: !!p.isPremium })),
        captains: [cap1?.pseudo || null, cap2?.pseudo || null],
        waiting: false
      };
      io.to('room_' + roomId).emit('room_ready', payload);
      io.to('room_' + roomId).emit('chat_msg', { author: 'Système', team: 'system', text: `✅ Équipes trouvées ! (Δ ELO : ${bestDiff}) Début dans 10 secondes…` });

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
        createdAt: Date.now(),
        avgElo: groupAvgElo   // ← stored for matchmaking
      };
      rooms[roomId] = room;

      group.players.forEach(p => {
        const s = io.sockets.sockets.get(p.socketId);
        if (s) { s.join('room_' + roomId); s.roomId = roomId; }
      });

      // Store captain of team 1 (team 2 captain set when they join)
      const cap1 = room.teams[0].find(p => !p.isBot);
      room.captains = [cap1?.id || null, null];
      room.votes = {};
      // Send room in waiting state — team 2 slots empty
      const payload = {
        roomId,
        mode: room.mode,
        team1: room.teams[0].map(p => ({ pseudo: p.pseudo, elo: p.elo, avatar: p.avatar || null, stats: p.stats || null })),
        team2: [],
        captains: [cap1?.pseudo || null, null],
        waiting: true,
        avgElo: groupAvgElo
      };
      rooms[roomId].startedAt = rooms[roomId].startedAt || Date.now();
      io.to('room_' + roomId).emit('room_ready', payload);
      io.to('room_' + roomId).emit('elo_window_start', { avgElo: groupAvgElo, createdAt: room.createdAt });
      io.to('room_' + roomId).emit('chat_msg', { author: 'Système', team: 'system', text: `⏳ Recherche d'adversaires (~${groupAvgElo} ELO)…` });
    }
  });

  // ── GROUP CHAT ──
  socket.on('group_chat_msg', ({ text }) => {
    if (!text || text.trim().length === 0 || text.length > 120) return;
    if (socket.isMuted) return;
    const entry = getGroupBySocket(socket.id);
    if (!entry) return;
    const [code, group] = entry;
    if (group.players.length < 2) return; // need at least 2 people
    const msg = {
      pseudo: socket.pseudo,
      text: text.trim(),
      time: Date.now()
    };
    // Send to all group members
    group.players.forEach(p => {
      if (p.socketId) {
        const s = io.sockets.sockets.get(p.socketId);
        if (s) s.emit('group_chat_msg', msg);
      }
    });
  });

  // ── CHAT ──
  socket.on('chat_msg', ({ text }) => {
    if (!socket.roomId) return;
    if (!text || text.trim().length === 0 || text.length > 120) return;
    if (socket.isMuted) {
      if (socket.muteUntil && socket.muteUntil <= Date.now()) {
        socket.isMuted = false; socket.muteUntil = null; // expired
      } else {
        const timeLeft = socket.muteUntil ? Math.ceil((socket.muteUntil - Date.now()) / 60000) + ' min restante(s)' : 'indéfini';
        return socket.emit('chat_msg', { author: 'Système', team: 'system', text: `🔇 Tu es mute (${timeLeft}). Tu ne peux pas envoyer de messages.` });
      }
    }
    const room = rooms[socket.roomId];
    if (!room) return;
    const inTeam = room.teams[0].some(p => p.id === socket.userId) || (room.teams[1] && room.teams[1].some(p => p.id === socket.userId));
    const isSpectatingAdmin = socket.isAdmin && !inTeam;
    const team = isSpectatingAdmin ? 'admin' : (room.teams[0].some(p => p.id === socket.userId) ? 'team1' : 'team2');
    const displayPseudo = isSpectatingAdmin ? `${socket.pseudo} [ADMIN]` : socket.pseudo;
    const userRec = db.getUserById(socket.userId);
    const role = socket.isAdmin ? 'admin' : (socket.isContent ? 'content' : null);
    const msg = { author: displayPseudo, team, text: text.trim(), time: Date.now(), isPremium: !!(userRec?.isPremium), role };
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
      room.startedAt = room.startedAt || Date.now();
      io.to('room_' + socket.roomId).emit('map_chosen', { map: chosen });
      io.to('room_' + socket.roomId).emit('chat_msg', { author: 'Système', team: 'system', text: `🗺️ Map jouée : ${chosen} — GO !` });
    } else {
      const nextTeam = room.banTurn % 2 === 0 ? 1 : 2;
      io.to('room_' + socket.roomId).emit('ban_phase', { turn: room.banTurn, team: nextTeam, mapsLeft: remainingMaps.length });
      startBanTimer(socket.roomId);
    }
  });


function avgTeamElo(team, mode) {
  const players = team.filter(p => !p.isBot);
  if (!players.length) return 500;
  return Math.round(players.reduce((sum, p) => sum + (p.stats?.[mode]?.elo || p.elo || 500), 0) / players.length);
}


// Rang depuis ELO (pour le fil d'activité)
function getRankNameFromElo(elo) {
  if (elo >= 901) return 'Radiant';
  if (elo >= 751) return 'Diamond';
  if (elo >= 601) return 'Platine';
  if (elo >= 451) return 'Gold';
  if (elo >= 301) return 'Silver';
  return 'Bronze';
}

// Émettre un événement dans le fil d'activité global
function emitActivity(type, data) {
  io.emit('activity_feed', { type, data, time: Date.now() });
}
function applyEloResult(winTeam, loseTeam, mode) {
  // Always read ELO from DB (fresh, not stale group data)
  const getElo = (p) => {
    if (p.isBot) return p.stats?.[mode]?.elo || 500;
    const fresh = db.getUserById(p.id);
    return fresh?.stats?.[mode]?.elo || 500;
  };
  const winRealPlayers = winTeam.filter(p => !p.isBot);
  const loseRealPlayers = loseTeam.filter(p => !p.isBot);
  const winAvg = winRealPlayers.length ? Math.round(winRealPlayers.reduce((s,p) => s + getElo(p), 0) / winRealPlayers.length) : 500;
  const loseAvg = loseTeam.filter(p => !p.isBot).length
    ? Math.round(loseTeam.filter(p => !p.isBot).reduce((s,p) => s + getElo(p), 0) / loseTeam.filter(p => !p.isBot).length)
    : (loseTeam.length ? loseTeam[0].stats?.[mode]?.elo || 500 : 500);
  const eloChanges = {};
  winRealPlayers.forEach(p => {
    const myElo = getElo(p);
    const change = db.computeEloChange(myElo, loseAvg, true);
    eloChanges[p.id] = change;
    const oldElo = getElo(p);
    db.updateUserElo(p.id, change, true, mode, loseTeam, winTeam, false);
    const newElo = getElo(p);
    const ps = [...io.sockets.sockets.values()].find(s => s.userId === p.id);
    if (ps) ps.emit('elo_update', { mode, newElo, change });
    // Rank up detection
    const oldRank = getRankNameFromElo(oldElo);
    const newRankName = getRankNameFromElo(newElo);
    if (oldRank !== newRankName) {
      if (ps) ps.emit('rank_up', { oldRank, newRank: newRankName, newElo, mode });
      emitActivity('rank_up', { pseudo: p.pseudo, oldRank, newRank: newRankName, newElo, mode });
    }
    // Win activity (every 5th win or first win)
    const freshUser = db.getUserById(p.id);
    const totalWins = Object.values(freshUser?.stats || {}).reduce((a,m) => a + (m.wins||0), 0);
    if (totalWins === 1 || totalWins % 10 === 0) {
      emitActivity('milestone', { pseudo: p.pseudo, wins: totalWins });
    }
    // Check referral reward
    const ref = db.checkReferralReward(p.id);
    if (ref && ref.rewardGiven) {
      const s = [...io.sockets.sockets.values()].find(s => s.userId === ref.referrerId);
      if (s) s.emit('premium_granted', { months: 0.25, message: '🎁 Tu as parrainé 3 joueurs actifs ! 1 semaine de Premium offerte !' });
    }
  });
  loseRealPlayers.forEach(p => {
    const myElo = getElo(p);
    const change = db.computeEloChange(myElo, winAvg, false);
    eloChanges[p.id] = change;
    db.updateUserElo(p.id, change, false, mode, winTeam, loseTeam, false);
    const newElo = getElo(p);
    const ps = [...io.sockets.sockets.values()].find(s => s.userId === p.id);
    if (ps) ps.emit('elo_update', { mode, newElo, change });
    // Check referral reward
    const ref = db.checkReferralReward(p.id);
    if (ref && ref.rewardGiven) {
      const s = [...io.sockets.sockets.values()].find(s => s.userId === ref.referrerId);
      if (s) s.emit('premium_granted', { months: 0.25, message: '🎁 Tu as parrainé 3 joueurs actifs ! 1 semaine de Premium offerte !' });
    }
  });
  return eloChanges;
}
  // ── CAPTAIN VOTE ──
  socket.on('vote_result', ({ myTeamWon }) => {
    if (!socket.roomId) return;
    const room = rooms[socket.roomId];
    if (!room) return;
    if (room.resultDeclared) return;
    const validStatuses = ['playing', 'ban_phase', 'weapon_vote'];
    if (!validStatuses.includes(room.status)) return;
    // Block vote if room started less than 5 minutes ago
    const VOTE_DELAY_MS = 5 * 60 * 1000;
    if (room.startedAt && (Date.now() - room.startedAt) < VOTE_DELAY_MS) {
      const remaining = Math.ceil((VOTE_DELAY_MS - (Date.now() - room.startedAt)) / 1000);
      socket.emit('vote_too_early', { remaining });
      return;
    }
    // Check if this socket is a captain
    const capIndex = (room.captains || []).indexOf(socket.userId);
    if (capIndex === -1) return;
    // Store vote: true = my team won
    room.votes = room.votes || {};
    room.votes[socket.userId] = myTeamWon;
    // Notify room that captain voted
    const teamLabel = capIndex === 0 ? 'Équipe 1' : 'Équipe 2';
    io.to('room_' + socket.roomId).emit('chat_msg', { author: 'Système', team: 'system', text: `⚖️ Le capitaine de l'${teamLabel} a voté.` });
    // Check if both captains voted
    const cap1 = room.captains[0], cap2 = room.captains[1];
    if (cap1 && cap2 && room.votes[cap1] !== undefined && room.votes[cap2] !== undefined) {
      // cap1Won: true = cap1 thinks team1 won; false = cap1 thinks team1 lost
      // cap2Won: true = cap2 thinks team2 won; false = cap2 thinks team2 lost
      // Agreement: cap1 says team1 won (true) AND cap2 says team2 lost (false)
      //         OR cap1 says team1 lost (false) AND cap2 says team2 won (true)
      const cap1Won = room.votes[cap1] === true;
      const cap2Won = room.votes[cap2] === true;
      const agreed = (cap1Won === true && cap2Won === false) || (cap1Won === false && cap2Won === true);
      if (agreed) {
        const winner = cap1Won ? 1 : 2;
        room.resultDeclared = true;
        room.status = 'finished';
        const winTeam = winner === 1 ? room.teams[0] : room.teams[1];
        const loseTeam = winner === 1 ? room.teams[1] : room.teams[0];
        // No ELO changes for tournament rooms
        const eloChanges = (room.tournamentId || room.isClanMatch) ? {} : applyEloResult(winTeam, loseTeam, room.mode);
        if (!room.tournamentId && !room.isClanMatch) computeCotd();
        emitGameResult(socket.roomId, {
          winner,
          winTeam: winTeam.map(p => p.pseudo),
          loseTeam: loseTeam.map(p => p.pseudo),
          mode: room.mode,
          eloChanges,
          tournamentId: room.tournamentId || null,
          isClanMatch: !!room.isClanMatch
        });
        // Advance tournament bracket if tournament room
        if (room.tournamentId) {
          const t = tournaments[room.tournamentId];
          if (t) {
            const match = t.bracket[room.tournamentRoundIdx]?.[room.tournamentMatchIdx];
            if (match && !match.winner) {
              const winnerTeamName = winTeam === room.teams[0] ? match.team1 : match.team2;
              setMatchWinner(t, room.tournamentRoundIdx, room.tournamentMatchIdx, winnerTeamName, socket.roomId);
            }
          }
        }
        // Points de clan
        if (room.isClanMatch && room.challengeId) {
          resolveClanMatch(room.challengeId, winner === 1 ? 0 : 1);
        }
        setTimeout(() => { archiveRoom(socket.roomId); }, 30000);
      } else {
        // Disagreement — alert admins
        room.votes = {}; // reset votes
        io.to('room_' + socket.roomId).emit('chat_msg', { author: 'Système', team: 'system', text: "❌ Les capitaines ne sont pas d'accord. Appelez un staff via le bouton \"Demander une décision\"." });
        io.to('room_' + socket.roomId).emit('vote_conflict');
        // Alert admins
        io.sockets.sockets.forEach(s => {
          if (s.isAdmin && s.adminModeActive !== false) s.emit('admin_alert_received', { roomId: socket.roomId, type: 'conflict', pseudo: 'Conflit de vote' });
        });
      }
    }
  });

  // ── RESULT ──
  socket.on('declare_result', ({ winner }) => {
    if (!socket.roomId) return;
    const room = rooms[socket.roomId];
    if (!room) return;
    if (room.resultDeclared) return;
    const validStatuses = ['playing', 'ban_phase', 'weapon_vote'];
    if (!validStatuses.includes(room.status)) return;
    if (!winner || (winner !== 1 && winner !== 2)) return;
    room.resultDeclared = true;
    room.status = 'finished';
    clearTimeout(room.banTimer);

    const winTeam = winner === 1 ? room.teams[0] : room.teams[1];
    const loseTeam = winner === 1 ? room.teams[1] : room.teams[0];

    // No ELO changes for tournament rooms or clan match rooms
    const eloChanges = (room.tournamentId || room.isClanMatch) ? {} : applyEloResult(winTeam, loseTeam, room.mode);
    if (!room.tournamentId && !room.isClanMatch) computeCotd();

    emitGameResult(socket.roomId, {
      winner,
      winTeam: winTeam.map(p => p.pseudo),
      loseTeam: loseTeam.map(p => p.pseudo),
      mode: room.mode,
      eloChanges,
      tournamentId: room.tournamentId || null,
      isClanMatch: !!room.isClanMatch
    });

    // Advance tournament bracket if tournament room
    if (room.tournamentId) {
      const t = tournaments[room.tournamentId];
      if (t) {
        const match = t.bracket[room.tournamentRoundIdx]?.[room.tournamentMatchIdx];
        if (match && !match.winner) {
          const winnerTeamName = winTeam === room.teams[0] ? match.team1 : match.team2;
          setMatchWinner(t, room.tournamentRoundIdx, room.tournamentMatchIdx, winnerTeamName, socket.roomId);
        }
      }
    }

    // Appliquer les points de clan si c'est un match de clan
    if (room.isClanMatch && room.challengeId) {
      const winnerTeamIndex = winTeam === room.teams[0] ? 0 : 1;
      resolveClanMatch(room.challengeId, winnerTeamIndex);
    }

    setTimeout(() => { archiveRoom(socket.roomId); }, 30000);
  });

  // ── DISCONNECT ──
  socket.on('disconnect', () => {
    // Remove from solo queue on disconnect
    for (const mode of Object.keys(soloQueue)) {
      soloQueue[mode] = soloQueue[mode].filter(e => e.player.socketId !== socket.id);
    }
    // Save lastSeen for staff members
    if (socket.pseudo && ADMIN_PSEUDOS.includes(socket.pseudo)) {
      try {
        const data = require('fs').existsSync(DBFILE()) ? JSON.parse(require('fs').readFileSync(DBFILE(),'utf8')) : {users:[]};
        const user = data.users.find(u => u.pseudo === socket.pseudo);
        if (user) { user.lastSeen = new Date().toISOString(); require('fs').writeFileSync(DBFILE(), JSON.stringify(data, null, 2)); }
      } catch(e) {}
    }
    const groupEntry = getGroupBySocket(socket.id);
    if (groupEntry) {
      const [code, group] = groupEntry;
      group.players = group.players.filter(p => p.socketId !== socket.id);
      if (group.players.length === 0) delete groups[code];
      else io.to('group_' + code).emit('group_updated', { players: group.players.map(p => ({ pseudo: p.pseudo, elo: p.elo, avatar: p.avatar || null, stats: p.stats || null })), mode: group.mode });
    }
  });

  // ── REMATCH ──
  socket.on('request_rematch', () => {
    if (!socket.roomId) return;
    const room = rooms[socket.roomId] || archivedRooms[socket.roomId];
    if (!room || room.status !== 'finished') return;
    if (!room.rematchRequests) room.rematchRequests = new Set();
    room.rematchRequests.add(socket.userId);
    // Notify everyone in room
    const allPlayers = [...(room.teams[0] || []), ...(room.teams[1] || [])].filter(p => !p.isBot);
    io.to('room_' + socket.roomId).emit('rematch_update', {
      count: room.rematchRequests.size,
      total: allPlayers.length
    });
    // If all players accepted — create new room
    if (room.rematchRequests.size >= allPlayers.length) {
      const newRoomId = Date.now().toString() + '_rematch';
      rooms[newRoomId] = {
        id: newRoomId,
        mode: room.mode,
        teams: [room.teams[0].map(p => ({...p})), room.teams[1].map(p => ({...p}))],
        status: 'playing',
        map: room.map || null,
        weapon: room.weapon || null,
        createdAt: new Date().toISOString(),
        captains: room.captains ? [...room.captains] : [],
        votes: {},
        rematchRequests: new Set(),
        resultDeclared: false,
        isRematch: true
      };
      // Move all players to new room
      allPlayers.forEach(p => {
        const s = [...io.sockets.sockets.values()].find(s => s.userId === p.id);
        if (s) {
          s.leave('room_' + socket.roomId);
          s.join('room_' + newRoomId);
          s.roomId = newRoomId;
        }
      });
      const payload = {
        roomId: newRoomId,
        mode: room.mode,
        team1: room.teams[0].map(p => ({ pseudo: p.pseudo, elo: p.elo, avatar: p.avatar || null, stats: p.stats || null, isPremium: !!p.isPremium, isBot: !!p.isBot })),
        team2: room.teams[1].map(p => ({ pseudo: p.pseudo, elo: p.elo, avatar: p.avatar || null, stats: p.stats || null, isPremium: !!p.isPremium, isBot: !!p.isBot })),
        captains: room.captains || [],
        map: room.map,
        weapon: room.weapon,
        isRematch: true
      };
      io.to('room_' + newRoomId).emit('room_ready', payload);
    }
  });

  // ── CANCEL QUEUE ──
  // ── INVITE AMI DANS LE GROUPE ──
  socket.on('invite_friend_to_group', ({ friendId }) => {
    const entry = getGroupBySocket(socket.id);
    if (!entry) return socket.emit('notify_error', "Tu n'es pas dans un groupe");
    const [code, group] = entry;
    if (group.captain !== socket.userId) return socket.emit('notify_error', 'Seul le capitaine peut inviter');
    const teamSize = { '1v1':1, '2v2':2, '3v3':3, '5v5':5 }[group.mode] || 2;
    if (group.players.length >= teamSize) return socket.emit('notify_error', 'Groupe déjà complet');
    // Vérifier que friendId est bien ami avec l'invitant
    const inviterRec = db.getUserById(socket.userId);
    if (!inviterRec || !(inviterRec.friends||[]).includes(friendId)) return socket.emit('notify_error', "Ce joueur n'est pas dans ta liste d'amis");
    // Envoyer l'invitation au socket de l'ami
    io.sockets.sockets.forEach(s => {
      if (s.userId === friendId) {
        s.emit('group_invite_received', {
          fromId: socket.userId, fromPseudo: socket.pseudo, fromAvatar: inviterRec.avatar||null,
          groupCode: code, mode: group.mode
        });
      }
    });
    socket.emit('chat_msg', { author: 'Système', team: 'system', text: `📨 Invitation envoyée !` });
  });

  socket.on('cancel_queue', () => {
    // Also remove from solo queue
    for (const mode of Object.keys(soloQueue)) {
      const before = soloQueue[mode].length;
      soloQueue[mode] = soloQueue[mode].filter(e => e.player.id !== socket.userId);
      if (soloQueue[mode].length < before) {
        socket.emit('chat_msg', { author: 'Système', team: 'system', text: '❌ Tu as quitté la file solo.' });
      }
    }
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

  // ── ADMIN MODE TOGGLE ──
  socket.on('set_admin_mode', ({ active }) => {
    if (!socket.isAdmin) return;
    socket.adminModeActive = !!active;
  });

  // ── ADMIN ALERT ──
  socket.on('admin_alert', ({ roomId, type, pseudo }) => {
    const room = rooms[roomId] || archivedRooms[roomId];
    if (!room) {
      console.log(`[admin_alert] room introuvable: ${roomId} | userId: ${socket.userId} | rooms: ${Object.keys(rooms).join(',')}`);
      socket.emit('notify_error', 'Room introuvable, impossible d\'envoyer l\'alerte.');
      return;
    }
    let adminCount = 0;
    io.sockets.sockets.forEach(s => {
      if (s.isAdmin && s.adminModeActive !== false) { s.emit('admin_alert_received', { roomId, type, pseudo }); adminCount++; }
    });
    console.log(`[admin_alert] roomId=${roomId} type=${type} pseudo=${pseudo} admins_notifiés=${adminCount}`);
    if (adminCount === 0) {
      socket.emit('notify_error', 'Aucun admin connecté pour le moment.');
    }
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
    // Leave previous spectated room first to avoid receiving events from old room
    if (socket.adminRoomId && socket.adminRoomId !== roomId) {
      socket.leave('room_' + socket.adminRoomId);
    }
    socket.join('room_' + roomId);
    socket.adminRoomId = roomId;
    socket.roomId = roomId;
    socket.emit('admin_joined_room', {
      roomId,
      mode: room.mode,
      team1: (room.teams[0] || []).map(p => ({ pseudo: p.pseudo, elo: p.elo, avatar: p.avatar || null, stats: p.stats || null })),
      team2: (room.teams[1] || []).map(p => ({ pseudo: p.pseudo, elo: p.elo, avatar: p.avatar || null, stats: p.stats || null })),
      chatHistory: (room.chat || [])
    });
    if (rooms[roomId]) {
      io.to('room_' + roomId).emit('chat_msg', { author: 'Système', team: 'system', text: '👁️ Un admin a rejoint la room en spectateur.' });
    }
  });

  // ── ADMIN LEAVE ROOM ──
  socket.on('admin_leave_room', ({ roomId }) => {
    if (!socket.isAdmin) return;
    socket.leave('room_' + roomId);
    if (socket.adminRoomId === roomId) socket.adminRoomId = null;
    socket.roomId = null;
  });

  // ── ADMIN DECIDE (with draw) ──
  socket.on('admin_decide', ({ roomId, winner }) => {
    if (!socket.isAdmin) return;
    const room = rooms[roomId];
    if (!room) return;
    if (room.resultDeclared) return;
    const validStatuses = ['playing', 'ban_phase', 'weapon_vote', 'waiting'];
    if (!validStatuses.includes(room.status)) return;
    room.resultDeclared = true;
    room.status = 'finished';
    clearTimeout(room.banTimer);
    if (winner === 0) {
      if (!room.tournamentId) {
        (room.teams[0] || []).filter(p => !p.isBot).forEach(p => db.updateUserElo(p.id, 0, false, room.mode, room.teams[1], room.teams[0], true));
        (room.teams[1] || []).filter(p => !p.isBot).forEach(p => db.updateUserElo(p.id, 0, false, room.mode, room.teams[0], room.teams[1], true));
        computeCotd();
      }
      io.to('room_' + roomId).emit('chat_msg', { author: 'Système', team: 'system', text: '⚖️ Décision admin : Égalité — aucun ELO modifié.' });
      emitGameResult(roomId, { winner: 0, winTeam: [], loseTeam: [], mode: room.mode, draw: true });
    } else {
      const winTeam = winner === 1 ? room.teams[0] : room.teams[1];
      const loseTeam = winner === 1 ? room.teams[1] : room.teams[0];
      // No ELO changes for tournament rooms
      const eloChanges = (room.tournamentId || room.isClanMatch) ? {} : applyEloResult(winTeam, loseTeam, room.mode);
      if (!room.tournamentId && !room.isClanMatch) computeCotd();
      io.to('room_' + roomId).emit('chat_msg', { author: 'Système', team: 'system', text: `⚖️ Décision admin : Équipe ${winner} gagne !` });
      emitGameResult(roomId, { winner, winTeam: winTeam.map(p => p.pseudo), loseTeam: loseTeam.map(p => p.pseudo), mode: room.mode, eloChanges, tournamentId: room.tournamentId || null, isClanMatch: !!room.isClanMatch });
      // ── Advance tournament bracket if this is a tournament room ──
      if (room.tournamentId) {
        const t = tournaments[room.tournamentId];
        if (t) {
          const match = t.bracket[room.tournamentRoundIdx]?.[room.tournamentMatchIdx];
          if (match && !match.winner) {
            const winnerTeamName = winTeam === room.teams[0] ? match.team1 : match.team2;
            setMatchWinner(t, room.tournamentRoundIdx, room.tournamentMatchIdx, winnerTeamName, roomId);
          }
        }
      }
      // Points de clan
      if (room.isClanMatch && room.challengeId) {
        resolveClanMatch(room.challengeId, winner === 1 ? 0 : 1);
      }
    }
    setTimeout(() => { archiveRoom(roomId); }, 30000);
  });

  // ── CLAN LINEUP SUBMIT ──
  socket.on('clan_submit_lineup', ({ challengeId, playerIds }) => {
    const ch = clanChallenges[challengeId];
    if (!ch || ch.status !== 'lineup_select') return socket.emit('notify_error', 'Challenge introuvable ou déjà lancé');
    const data = readDB();
    const challengerClan = (data.clans||[]).find(c => c.id === ch.challengerClanId);
    const challengedClan = (data.clans||[]).find(c => c.id === ch.challengedClanId);

    // Déterminer quel clan soumet
    let myClan, teamIdx;
    if (challengerClan && challengerClan.leaderId === socket.userId) { myClan = challengerClan; teamIdx = 0; }
    else if (challengedClan && challengedClan.leaderId === socket.userId) { myClan = challengedClan; teamIdx = 1; }
    else return socket.emit('notify_error', 'Seul le chef de clan peut soumettre la lineup');

    const mode = ch.mode || '5v5';
    const teamSize = ch.teamSize || 5;
    if (!playerIds || playerIds.length !== teamSize) return socket.emit('notify_error', `Sélectionne exactement ${teamSize} joueur(s)`);
    // Vérifier que tous les joueurs sélectionnés sont membres du clan et online
    const onlineSockets = [...io.sockets.sockets.values()];
    const onlineIds = onlineSockets.filter(s => myClan.members.includes(s.userId)).map(s => s.userId);
    const invalid = playerIds.filter(id => !onlineIds.includes(id));
    if (invalid.length) return socket.emit('notify_error', 'Certains joueurs sélectionnés ne sont plus en ligne');

    // Stocker la lineup
    if (!ch.lineups) ch.lineups = {};
    ch.lineups[myClan.id] = playerIds;
    socket.emit('clan_lineup_submitted', { challengeId, teamIdx });

    // Notifier l'autre chef qu'on attend encore
    const otherClan = teamIdx === 0 ? challengedClan : challengerClan;
    const otherSubmitted = ch.lineups[otherClan?.id];
    if (!otherSubmitted) {
      socket.emit('notify_error', `✅ Lineup soumise ! En attente du chef de [${otherClan.tag}] ${otherClan.name}…`);
      // Pas d'erreur, juste un message — utiliser chat_msg via une notif custom
      return;
    }

    // Les deux chefs ont soumis → créer la room
    ch.status = 'active';
    const buildTeam = (clan, ids) => ids.map(id => {
      const u = data.users.find(u => u.id === id);
      const s = onlineSockets.find(s => s.userId === id);
      if (!u || !s) return null;
      return { id: u.id, pseudo: u.pseudo, elo: u.stats?.[mode]?.elo || 500, stats: u.stats || {}, avatar: u.avatar || null, socketId: s.id, isPremium: !!u.isPremium };
    }).filter(Boolean);

    const team1 = buildTeam(challengerClan, ch.lineups[challengerClan.id]);
    const team2 = buildTeam(challengedClan, ch.lineups[challengedClan.id]);

    if (team1.length < teamSize || team2.length < teamSize) {
      ch.status = 'lineup_select';
      delete ch.lineups[myClan.id];
      return socket.emit('notify_error', 'Certains joueurs sélectionnés se sont déconnectés. Refais ta sélection.');
    }

    const roomId = 'C' + generateCode(4);
    const cap1 = team1[0];
    const cap2 = team2[0];
    const room = {
      id: roomId, mode,
      teams: [team1, team2],
      chat: [], mapBans: [], banTurn: 0, status: 'waiting',
      chosenMap: null, banTimer: null, createdAt: Date.now(),
      captains: [cap1.id, cap2.id], captainPseudos: [cap1.pseudo, cap2.pseudo], votes: {},
      isClanMatch: true, challengeId,
      challengerClanId: ch.challengerClanId, challengedClanId: ch.challengedClanId
    };
    rooms[roomId] = room;
    ch.roomId = roomId;

    // Joindre tous les joueurs au socket room
    [...team1, ...team2].forEach(p => {
      const s = io.sockets.sockets.get(p.socketId);
      if (s) { s.join('room_' + roomId); s.roomId = roomId; }
    });

    const payload = {
      roomId, mode,
      team1: team1.map(p => ({ pseudo: p.pseudo, elo: p.elo, avatar: p.avatar || null, stats: p.stats || null, isPremium: !!p.isPremium })),
      team2: team2.map(p => ({ pseudo: p.pseudo, elo: p.elo, avatar: p.avatar || null, stats: p.stats || null, isPremium: !!p.isPremium })),
      captains: [cap1.pseudo, cap2.pseudo], waiting: false
    };
    io.to('room_' + roomId).emit('room_ready', payload);
    io.to('room_' + roomId).emit('chat_msg', { author: 'Système', team: 'system',
      text: `⚔️ Match de clan : [${challengerClan.tag}] ${challengerClan.name} vs [${challengedClan.tag}] ${challengedClan.name} — Mode ${mode} ! Début dans 10 secondes…`
    });
    startRoomCountdown(roomId);

    // Notifier tous les membres
    const allIds = [...challengerClan.members, ...challengedClan.members];
    onlineSockets.forEach(s => {
      if (allIds.includes(s.userId)) s.emit('clan_room_created', { challengeId, roomId, mode });
    });
  });

});

// Radiant leaderboard (sorted by best ELO across all modes)
app.get('/api/radiant-rank/:userId', (req, res) => {
  try {
    const data = require('./database').getUserById ? null : null; // just use readDB
    const { readFileSync, existsSync } = require('fs');
    const dbFile = process.env.NODE_ENV === 'production' ? '/tmp/db.json' : './db.json';
    const db = JSON.parse(readFileSync(dbFile, 'utf8'));
    const getMax = u => Math.max(...['1v1','2v2','3v3','5v5'].map(m => u.stats?.[m]?.elo || 0));
    const radiants = db.users.filter(u => !u.banned && getMax(u) >= 901).sort((a,b) => getMax(b) - getMax(a));
    const pos = radiants.findIndex(u => u.id === req.params.userId);
    res.json({ position: pos >= 0 ? pos + 1 : null, total: radiants.length });
  } catch(e) { res.json({ position: null, total: 0 }); }
});

// Match history API
app.get('/api/match-history/:userId', (req, res) => {
  try {
    const user = db.getUserById(req.params.userId);
    if (!user) return res.json([]);
    res.json((user.matchHistory || []).slice(0, 20));
  } catch(e) { res.json([]); }
});

app.get('/api/twitch-live', async (req, res) => {
  // If no Twitch credentials, return demo/empty
  if (!TWITCH_CLIENT_ID) {
    return res.json({ streams: [], configured: false });
  }
  // Refresh if cache older than 2 min
  if (Date.now() - twitchLastFetch > 2 * 60 * 1000) await refreshTwitchCache();
  res.json({ streams: twitchStreamsCache, configured: true });
});

server.listen(PORT, async () => {
  console.log(`✅ WAGERS sur http://localhost:${PORT}`);
  // Restore DB from Discord if /tmp/db.json is missing or empty
  await restoreDBFromDiscord();
});

// ── DISCORD BACKUP SYSTEM ──
const DISCORD_WEBHOOK = process.env.DISCORD_BACKUP_WEBHOOK || null;
const DISCORD_CHANNEL_ID = process.env.DISCORD_BACKUP_CHANNEL_ID || null;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || null;

async function sendBackupToDiscord() {
  if (!DISCORD_WEBHOOK) return;
  try {
    const data = db.loadDB();
    const json = JSON.stringify(data, null, 2);
    const now = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
    const users = (data.users || []).length;
    const matches = (data.users || []).reduce((s, u) => s + (u.matchHistory || []).length, 0);

    // Build multipart form with file attachment
    const boundary = '----FormBoundary' + Date.now();
    const filename = `revenge_db_${Date.now()}.json`;
    const fileContent = Buffer.from(json, 'utf8');

    const payloadJson = JSON.stringify({
      content: `📦 **Backup automatique** — ${now}\n👤 ${users} comptes · 🎮 ${matches} parties enregistrées`
    });

    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="payload_json"\r\n\r\n${payloadJson}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/json\r\n\r\n`),
      fileContent,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    const https = require('https');
    const url = new URL(DISCORD_WEBHOOK);
    await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length }
      }, res => {
        res.resume();
        res.on('end', resolve);
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
    console.log(`[BACKUP] ✅ DB envoyée sur Discord (${users} users, ${(json.length/1024).toFixed(1)}KB)`);
  } catch(e) {
    console.error('[BACKUP] ❌ Erreur envoi Discord:', e.message);
  }
}

async function restoreDBFromDiscord() {
  if (!DISCORD_WEBHOOK) {
    console.log('[BACKUP] Webhook manquant, restore ignorée.');
    return false;
  }
  const DBFILE_PATH = process.env.NODE_ENV === 'production' ? '/tmp/db.json' : null;
  if (!DBFILE_PATH) return false;

  const fs = require('fs');
  try {
    if (fs.existsSync(DBFILE_PATH)) {
      const existing = JSON.parse(fs.readFileSync(DBFILE_PATH, 'utf8'));
      if ((existing.users || []).length > 0) {
        console.log(`[BACKUP] DB déjà présente (${existing.users.length} users), pas de restore.`);
        return true;
      }
    }
  } catch(e) {}

  console.log('[BACKUP] DB vide/absente — tentative de restore depuis Discord…');
  try {
    const https = require('https');

    // Extract webhook ID and token from webhook URL
    // Format: https://discord.com/api/webhooks/{id}/{token}
    const webhookMatch = DISCORD_WEBHOOK.match(/webhooks\/(\d+)\/([^/?]+)/);
    if (!webhookMatch) throw new Error('URL webhook invalide');
    const [, webhookId, webhookToken] = webhookMatch;

    // Use channel ID + bot token if available, otherwise fall back to webhook messages endpoint
    const useBot = DISCORD_BOT_TOKEN && DISCORD_CHANNEL_ID;
    const path = useBot
      ? `/api/v10/channels/${DISCORD_CHANNEL_ID}/messages?limit=50`
      : `/api/v10/webhooks/${webhookId}/${webhookToken}/messages?limit=10`;
    const authHeader = useBot
      ? `Bot ${DISCORD_BOT_TOKEN}`
      : null;

    const rawMessages = await new Promise((resolve, reject) => {
      const headers = { 'User-Agent': 'RevengeBot/1.0' };
      if (authHeader) headers['Authorization'] = authHeader;
      const req = https.request({
        hostname: 'discord.com',
        path,
        method: 'GET',
        headers
      }, res => {
        let raw = '';
        res.on('data', d => raw += d);
        res.on('end', () => {
          console.log('[BACKUP] Discord API status:', res.statusCode, '| path:', path);
          try { resolve(JSON.parse(raw)); } catch(e) { resolve([]); }
        });
      });
      req.on('error', reject);
      req.end();
    });

    const messages = Array.isArray(rawMessages) ? rawMessages : [];
    console.log(`[BACKUP] ${messages.length} messages trouvés`);

    // Log attachment info for debugging
    messages.forEach((m, i) => {
      if (m.attachments?.length) console.log(`[BACKUP] msg[${i}] attachments:`, m.attachments.map(a => a.filename));
    });

    const backupMsg = messages.find(m => m.attachments?.some(a => a.filename?.endsWith('.json')));
    if (!backupMsg) {
      console.log('[BACKUP] Aucun message avec fichier .json trouvé.');
      return false;
    }

    const attachment = backupMsg.attachments.find(a => a.filename?.endsWith('.json'));
    console.log('[BACKUP] Fichier trouvé:', attachment.filename, '| URL:', attachment.url.slice(0, 60));

    const fileUrl = new URL(attachment.url);
    const jsonData = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: fileUrl.hostname,
        path: fileUrl.pathname + fileUrl.search,
        method: 'GET',
        headers: { 'User-Agent': 'RevengeBot/1.0' }
      }, res => {
        let raw = '';
        res.on('data', d => raw += d);
        res.on('end', () => resolve(raw));
      });
      req.on('error', reject);
      req.end();
    });

    const parsed = JSON.parse(jsonData);
    if (!parsed.users || !Array.isArray(parsed.users)) throw new Error('Format invalide');
    fs.writeFileSync(DBFILE_PATH, JSON.stringify(parsed, null, 2));
    console.log(`[BACKUP] ✅ DB restaurée depuis Discord (${parsed.users.length} users)`);
    return true;
  } catch(e) {
    console.error('[BACKUP] ❌ Erreur restore:', e.message);
    return false;
  }
}

// Send backup every hour
setInterval(sendBackupToDiscord, 60 * 60 * 1000);
// On boot: restore first, then send backup only if restore failed (to avoid overwriting with empty)
setTimeout(async () => {
  const restored = await restoreDBFromDiscord();
  if (!restored) {
    console.log('[BACKUP] Restore échouée au boot, pas de backup envoyée pour éviter d\'écraser.');
  }
}, 5000);

// Fake rooms for live display
const FAKE_NAMES = ['Shadow','Blaze','Nova','Viper','Ghost','Storm','Frost','Ace','Echo','Raven','Void','Flux','Dusk','Neon','Wolf'];
const FAKE_MODES = ['1v1','2v2','3v3','5v5'];
const FAKE_WEAPONS_LIST = ['Vandal/Phantom','Sheriff','Operator','Marshall','Ghost'];
let fakeRooms = [];

function createOneFakeRoom(mode) {
  const size = getTeamSize(mode);
  const fakeName = () => FAKE_NAMES[Math.floor(Math.random()*FAKE_NAMES.length)] + Math.floor(Math.random()*999);
  const t1 = Array.from({length:size}, fakeName);
  const t2 = Array.from({length:size}, fakeName);
  const statuses = ['playing','playing','playing','weapon_vote'];
  const id = 'FAKE_' + generateCode(4);
  const createdAt = Date.now();
  const minMs = 15 * 60 * 1000;
  const maxMs = 18 * 60 * 1000;
  const lifetime = minMs + Math.floor(Math.random() * (maxMs - minMs));
  const room = {
    id, mode, status: statuses[Math.floor(Math.random()*statuses.length)],
    duration: '0m00s',
    weapon: FAKE_WEAPONS_LIST[Math.floor(Math.random()*FAKE_WEAPONS_LIST.length)],
    map: null,
    team1: t1.map(p => p.slice(0,2)+'***'),
    team2: t2.map(p => p.slice(0,2)+'***'),
    total: size*2, max: size*2, fake: true, createdAt: createdAt
  };
  fakeRooms.push(room);
  // Mettre à jour la durée chaque minute
  const durationTimer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - createdAt) / 1000);
    const m = Math.floor(elapsed / 60);
    const sec = (elapsed % 60).toString().padStart(2,'0');
    room.duration = m + 'm' + sec + 's';
    room.createdAt = createdAt; // always keep createdAt for client-side calc
  }, 1000);
  // Résoudre automatiquement entre 15 et 18 minutes
  setTimeout(() => {
    clearInterval(durationTimer);
    const winnerTeam = Math.random() < 0.5 ? 1 : 2;
    room.status = 'finished';
    room.fakeWinner = winnerTeam;
    fakeRooms = fakeRooms.filter(r => r.id !== id);
    broadcastFakeRooms();
  }, lifetime);
  broadcastFakeRooms();
  return room;
}

function broadcastFakeRooms() {
  // Re-emit active rooms to all connected clients
  const real = Object.values(rooms).filter(r => r.status !== 'finished').map(r => ({
    id: r.id, mode: r.mode, status: r.status,
    duration: r.createdAt ? (() => { const e = Math.floor((Date.now()-r.createdAt)/1000); return Math.floor(e/60)+'m'+(e%60).toString().padStart(2,'0')+'s'; })() : '0m00s',
    weapon: r.chosenWeapon || null, map: r.chosenMap || null,
    team1: (r.teams[0]||[]).map(p=>p.pseudo), team2: (r.teams[1]||[]).map(p=>p.pseudo),
    total: (r.teams[0]||[]).length+(r.teams[1]||[]).length,
    max: getTeamSize(r.mode)*2
  }));
  io.emit('active_rooms_update', [...real, ...fakeRooms]);
}

// Admin API : ajouter des fake rooms
app.post('/api/admin/fake-rooms', (req, res) => {
  if (!isAdminReq(req)) return res.status(403).json({ error: 'Interdit' });
  const { count, mode } = req.body;
  const n = Math.min(Math.max(parseInt(count)||1, 1), 10);
  const modes = mode ? [mode] : FAKE_MODES;
  const created = [];
  for (let i = 0; i < n; i++) {
    const m = modes[Math.floor(Math.random()*modes.length)];
    created.push(createOneFakeRoom(m));
  }
  res.json({ ok: true, created: created.length, total: fakeRooms.length });
});

// Admin API : vider toutes les fake rooms
app.post('/api/admin/fake-rooms/clear', (req, res) => {
  if (!isAdminReq(req)) return res.status(403).json({ error: 'Interdit' });
  fakeRooms = [];
  broadcastFakeRooms();
  res.json({ ok: true });
});

// Démarrer avec 0 fake rooms (contrôle admin uniquement)
fakeRooms = [];

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
  const fromUser = db.getUserById(fromId);
  const msg = { from: fromId, text: text.slice(0,300), time: Date.now(), isPremium: !!(fromUser?.isPremium) };
  friendMessages[key].push(msg);
  // Notify recipient if online
  io.sockets.sockets.forEach(s => {
    if (s.userId === toId) s.emit('friend_message', { from: fromId, text: msg.text, time: msg.time, isPremium: msg.isPremium });
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
// ── ADMIN STATS ──
app.get('/api/admin/stats', (req, res) => {
  if (req.headers['x-admin-key'] !== (process.env.ADMIN_KEY || 'revenge_admin_secret')) return res.status(403).json({ error: 'Non autorisé' });
  try {
    const data = readDB();
    const users = data.users || [];
    const clans = data.clans || [];

    // Online count
    const onlineCount = [...io.sockets.sockets.values()].filter(s => s.userId).length;

    // Total matches = sum of all wins across all users/modes (each match = 1 win)
    let totalMatches = 0;
    const modeMatches = { '1v1': 0, '2v2': 0, '3v3': 0, '5v5': 0 };
    users.forEach(u => {
      ['1v1','2v2','3v3','5v5'].forEach(m => {
        const w = u.stats?.[m]?.wins || 0;
        totalMatches += w;
        modeMatches[m] += w;
      });
    });

    // Today registrations
    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    const todayUsers = users.filter(u => u.createdAt && new Date(u.createdAt) >= todayStart).length;
    const weekStart = new Date(Date.now() - 7*24*3600*1000);
    const weekUsers = users.filter(u => u.createdAt && new Date(u.createdAt) >= weekStart).length;

    // Top players by max elo
    const topPlayers = users
      .filter(u => !u.banned)
      .map(u => {
        const maxElo = Math.max(...['1v1','2v2','3v3','5v5'].map(m => u.stats?.[m]?.elo || 500));
        const totalWins = ['1v1','2v2','3v3','5v5'].reduce((s,m) => s + (u.stats?.[m]?.wins||0), 0);
        return { pseudo: u.pseudo, avatar: u.avatar||null, maxElo, totalWins };
      })
      .sort((a,b) => b.maxElo - a.maxElo).slice(0, 5);

    // Recent registrations
    const recentUsers = [...users]
      .sort((a,b) => new Date(b.createdAt||0) - new Date(a.createdAt||0))
      .slice(0, 6)
      .map(u => ({ pseudo: u.pseudo, avatar: u.avatar||null, createdAt: u.createdAt, banned: !!u.banned }));

    // Moderation
    const bannedCount = users.filter(u => u.banned).length;
    const mutedCount = users.filter(u => u.muted && !u.banned).length;
    const openTickets = (data.tickets||[]).filter(t => t.status === 'open').length;

    res.json({
      totalUsers: users.length, todayUsers, weekUsers, onlineCount,
      totalMatches, modeMatches, totalClans: clans.length,
      topPlayers, recentUsers, bannedCount, mutedCount, openTickets
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ═══════════════════════════════════════════════

// GET clan info
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
    // Cooldown 7 jours après dissolution
    const cooldown7d = 7 * 24 * 60 * 60 * 1000;
    if (user.lastClanDissolved && (Date.now() - user.lastClanDissolved) < cooldown7d) {
      const remaining = Math.ceil((cooldown7d - (Date.now() - user.lastClanDissolved)) / (1000 * 3600 * 24));
      return res.status(400).json({ error: `Tu dois attendre encore ${remaining} jour(s) avant de créer un nouveau clan.` });
    }
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
    if (clan.members.length >= 10) return res.status(400).json({ error: 'Clan complet (10/10)' });
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
      // Cooldown 7 jours avant de recréer un clan
      user.lastClanDissolved = Date.now();
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
  if (!text || text.length > 120) return res.status(400).json({ error: 'Invalide' });
  const data = readDB();
  const user = data.users.find(u => u.id === userId);
  if (!user || user.banned) return res.status(403).json({ error: 'Interdit' });
  const clan = (data.clans || []).find(c => c.id === req.params.id);
  if (!clan || !clan.members.includes(userId)) return res.status(403).json({ error: 'Pas membre du clan' });
  if (!clanMessages[req.params.id]) clanMessages[req.params.id] = [];
  const msg = { pseudo, text: text.trim(), time: Date.now(), avatar: user.avatar || null, isPremium: !!user.isPremium };
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
    res.json({ ...clan, members, joinRequests: requests, weeklyPoints: clan.weeklyPoints || 0, bo3Wins: clan.bo3Wins || 0, bo3Losses: clan.bo3Losses || 0, bo3ReadyMembers: clan.bo3ReadyMembers || [] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════
// BO3 CLAN CHALLENGE SYSTEM
// ══════════════════════════════════════════════════════

const clanChallenges = {}; // challengeId -> { challengerClanId, challengedClanId, status, series, currentGame, maps, winnerId }

// Challenge leaderboard enriched with weeklyPoints
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
        return sum + Math.max(...['1v1','2v2','3v3','5v5'].map(mode => u.stats?.[mode]?.elo || 500));
      }, 0);
      return {
        id: c.id, name: c.name, tag: c.tag, description: c.description || '',
        leaderId: c.leaderId, members, memberCount: members.length, totalElo,
        weeklyPoints: c.weeklyPoints || 0, bo3Wins: c.bo3Wins || 0, bo3Losses: c.bo3Losses || 0,
        bo3ReadyCount: (c.bo3ReadyMembers || []).length,
        createdAt: c.createdAt
      };
    }).sort((a, b) => (b.weeklyPoints - a.weeklyPoints) || (b.totalElo - a.totalElo));
    res.json(clans);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Send clan challenge — le challengeur choisit le mode
app.post('/api/clans/challenge', express.json(), (req, res) => {
  try {
    const { leaderId, challengerClanId, challengedClanId, mode } = req.body;
    const validMode = ['1v1','2v2','3v3','5v5'].includes(mode) ? mode : '5v5';
    const teamSize = { '1v1':1, '2v2':2, '3v3':3, '5v5':5 }[validMode];
    const data = readDB();
    const challengerClan = (data.clans||[]).find(c => c.id === challengerClanId);
    const challengedClan = (data.clans||[]).find(c => c.id === challengedClanId);
    if (!challengerClan || !challengedClan) return res.status(404).json({ error: 'Clan introuvable' });
    if (challengerClan.leaderId !== leaderId) return res.status(403).json({ error: 'Seul le chef peut lancer un challenge' });
    if (challengerClan.members.length < teamSize) return res.status(400).json({ error: `Il faut au moins ${teamSize} membres dans ton clan pour ce mode` });
    if (challengedClan.members.length < teamSize) return res.status(400).json({ error: `Le clan adverse n'a pas assez de membres pour ce mode` });
    // Pas de double challenge entre ces deux clans
    const existing = Object.values(clanChallenges).find(ch =>
      ch.status === 'pending' &&
      ((ch.challengerClanId === challengerClanId && ch.challengedClanId === challengedClanId) ||
       (ch.challengerClanId === challengedClanId && ch.challengedClanId === challengerClanId))
    );
    if (existing) return res.status(400).json({ error: 'Un challenge est déjà en cours entre ces clans' });
    const challengeId = 'ch_' + Date.now();
    clanChallenges[challengeId] = {
      id: challengeId, challengerClanId, challengedClanId,
      challengerName: challengerClan.name, challengerTag: challengerClan.tag,
      challengedName: challengedClan.name, challengedTag: challengedClan.tag,
      mode: validMode, teamSize,
      status: 'pending', series: [0, 0], createdAt: Date.now()
    };
    // Notifier le chef du clan adverse
    io.sockets.sockets.forEach(s => {
      if (s.userId === challengedClan.leaderId) {
        s.emit('clan_challenge_received', { challengeId, from: challengerClan.name, tag: challengerClan.tag, mode: validMode });
      }
    });
    res.json({ ok: true, challengeId });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Accept/decline BO3 challenge
app.post('/api/clans/challenge/respond', express.json(), (req, res) => {
  try {
    const { leaderId, challengeId, accept } = req.body;
    const ch = clanChallenges[challengeId];
    if (!ch) return res.status(404).json({ error: 'Challenge introuvable' });
    if (ch.status !== 'pending') return res.status(400).json({ error: 'Challenge déjà traité' });
    const data = readDB();
    const challengedClan = (data.clans||[]).find(c => c.id === ch.challengedClanId);
    const challengerClan = (data.clans||[]).find(c => c.id === ch.challengerClanId);
    if (!challengedClan || challengedClan.leaderId !== leaderId) return res.status(403).json({ error: 'Non autorisé' });
    if (!accept) {
      ch.status = 'declined';
      io.sockets.sockets.forEach(s => {
        if (s.userId === challengerClan?.leaderId)
          s.emit('clan_challenge_declined', { challengeId, by: challengedClan.name });
      });
      return res.json({ ok: true });
    }
    ch.status = 'lineup_select';
    ch.series = [0, 0];
    ch.lineups = {}; // { [clanId]: [playerIds] }

    const mode = ch.mode || '5v5';
    const teamSize = ch.teamSize || 5;

    // Récupérer les membres online de chaque clan
    const onlineSockets = [...io.sockets.sockets.values()];
    const getOnlineMembers = (clan) => {
      const members = [];
      for (const s of onlineSockets) {
        if (clan.members.includes(s.userId) && s.userId) {
          const u = data.users.find(u => u.id === s.userId);
          if (u) members.push({ id: u.id, pseudo: u.pseudo, elo: u.stats?.[mode]?.elo || 500, avatar: u.avatar || null, socketId: s.id });
        }
      }
      return members;
    };

    const team1Online = getOnlineMembers(challengerClan);
    const team2Online = getOnlineMembers(challengedClan);

    // Envoyer l'event de sélection de lineup aux deux chefs
    // (même si pas assez online — le chef verra combien sont dispo)
    const sendLineupSelect = (leaderId, myClan, opponentClan, myOnline, teamIdx) => {
      io.sockets.sockets.forEach(s => {
        if (s.userId === leaderId) {
          s.emit('clan_lineup_select', {
            challengeId, mode, teamSize, teamIdx,
            myClanName: myClan.name, myClanTag: myClan.tag,
            opponentName: opponentClan.name, opponentTag: opponentClan.tag,
            availablePlayers: myOnline.map(p => ({ id: p.id, pseudo: p.pseudo, elo: p.elo, avatar: p.avatar }))
          });
        }
      });
    };

    sendLineupSelect(challengerClan.leaderId, challengerClan, challengedClan, team1Online, 0);
    sendLineupSelect(challengedClan.leaderId, challengedClan, challengerClan, team2Online, 1);

    // Notifier tous les membres des deux clans
    const allMemberIds = [...challengerClan.members, ...challengedClan.members];
    onlineSockets.forEach(s => {
      if (allMemberIds.includes(s.userId)) {
        s.emit('clan_challenge_accepted', { challengeId, by: challengedClan.name, mode });
      }
    });

    res.json({ ok: true, challengeId, lineupSelect: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// List pending/active challenges for a clan
app.get('/api/clans/:clanId/challenges', (req, res) => {
  const { clanId } = req.params;
  const relevant = Object.values(clanChallenges).filter(ch =>
    (ch.challengerClanId === clanId || ch.challengedClanId === clanId) &&
    ['pending', 'active'].includes(ch.status)
  );
  res.json(relevant);
});

// Report BO3 game result (called when a room in the BO3 series ends)
// The room's game_result triggers this via the challengeId tag on the room
// Calcul proportionnel des points de clan
// Base +25/-15 à égalité. Si l'écart est grand (favori gagne), gain/perte réduits. Underdog = plus de gain.
function computeClanPoints(winnerPts, loserPts) {
  const diff = winnerPts - loserPts; // positif = winner était favori
  const steps = Math.floor(Math.abs(diff) / 50);
  let gain = 25, loss = 15;
  if (diff > 0) {
    // Le favori gagne : moins de points
    gain = Math.max(8, 25 - steps * 4);
    loss = Math.min(25, 15 + steps * 3);
  } else if (diff < 0) {
    // L'underdog gagne : plus de points
    gain = Math.min(45, 25 + steps * 5);
    loss = Math.max(5, 15 - steps * 3);
  }
  return { gain: Math.round(gain), loss: Math.round(loss) };
}

function resolveClanMatch(challengeId, winnerTeamIndex) {
  const ch = clanChallenges[challengeId];
  if (!ch || !['active'].includes(ch.status)) return;
  const winnerId = winnerTeamIndex === 0 ? ch.challengerClanId : ch.challengedClanId;
  const loserId  = winnerTeamIndex === 0 ? ch.challengedClanId : ch.challengerClanId;
  ch.status = 'finished';
  ch.winnerId = winnerId;
  ch.finishedAt = Date.now();

  const data = readDB();
  const winner = (data.clans||[]).find(c => c.id === winnerId);
  const loser  = (data.clans||[]).find(c => c.id === loserId);

  const winnerPts = winner?.weeklyPoints || 0;
  const loserPts  = loser?.weeklyPoints  || 0;
  const { gain, loss } = computeClanPoints(winnerPts, loserPts);

  if (winner) {
    winner.weeklyPoints = (winner.weeklyPoints || 0) + gain;
    winner.bo3Wins = (winner.bo3Wins || 0) + 1;
  }
  if (loser) {
    loser.weeklyPoints = Math.max(0, (loser.weeklyPoints || 0) - loss);
    loser.bo3Losses = (loser.bo3Losses || 0) + 1;
  }
  writeDB(data);

  // Notifier tous les membres des deux clans
  const notifyMembers = (clanId, event, payload) => {
    const clan = (data.clans||[]).find(c => c.id === clanId);
    if (!clan) return;
    clan.members.forEach(mId => {
      io.sockets.sockets.forEach(s => { if (s.userId === mId) s.emit(event, payload); });
    });
  };
  notifyMembers(winnerId, 'clan_bo3_won',  { challengeId, series: ch.series || [1,0], opponentName: loser?.name  || '?', pointsGained: gain });
  notifyMembers(loserId,  'clan_bo3_lost', { challengeId, series: ch.series || [0,1], opponentName: winner?.name || '?', pointsLost: loss });
  // Broadcast leaderboard update
  io.emit('clan_points_updated');
}

// Kept for backward compat (BO3 series — not used in new single-match flow but kept in case)
function resolveClanBo3Game(challengeId, winnerTeamClanId) {
  const ch = clanChallenges[challengeId];
  if (!ch || ch.status !== 'active') return;
  if (winnerTeamClanId === ch.challengerClanId) ch.series[0]++;
  else if (winnerTeamClanId === ch.challengedClanId) ch.series[1]++;
}

// ══════════════════════════════════════════════════════
// WEEKLY CLAN RESET — every Friday at 20:00
// ══════════════════════════════════════════════════════

function getNextFriday20h() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun,1=Mon,...,5=Fri
  let daysUntilFriday = (5 - day + 7) % 7;
  if (daysUntilFriday === 0 && now.getHours() >= 20) daysUntilFriday = 7;
  const next = new Date(now);
  next.setDate(now.getDate() + daysUntilFriday);
  next.setHours(20, 0, 0, 0);
  return next.getTime() - Date.now();
}

function doWeeklyReset() {
  try {
    const data = readDB();
    const clans = (data.clans || []);
    if (!clans.length) return;
    // Sort by weeklyPoints to find top 3
    const ranked = [...clans].sort((a, b) => (b.weeklyPoints||0) - (a.weeklyPoints||0));
    const top3 = ranked.slice(0, 3).filter(c => (c.weeklyPoints||0) > 0);
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    top3.forEach((clan, idx) => {
      const premiumDays = idx === 0 ? 14 : 7; // 1st = 2 weeks, 2nd/3rd = 1 week
      const premiumMs = premiumDays * 24 * 60 * 60 * 1000;
      clan.members.forEach(mId => {
        const u = data.users.find(u => u.id === mId);
        if (!u) return;
        u.isPremium = true;
        u.premiumUntil = Math.max(u.premiumUntil || Date.now(), Date.now()) + premiumMs;
        // Notify online members
        io.sockets.sockets.forEach(s => {
          if (s.userId === mId) {
            s.emit('premium_granted', { message: `🏆 Top ${idx+1} clan hebdo ! ${premiumDays} jours Premium offerts !` });
          }
        });
      });
      // Announce in clan chat
      if (!clanMessages[clan.id]) clanMessages[clan.id] = [];
      clanMessages[clan.id].push({ pseudo: 'Système', text: `🏆 Votre clan termine #${idx+1} ! Tous les membres reçoivent ${premiumDays} jours Premium !`, time: Date.now(), isSystem: true });
    });
    // Reset all clan weekly points
    clans.forEach(c => { c.weeklyPoints = 0; c.bo3Wins = c.bo3Wins || 0; c.bo3Losses = c.bo3Losses || 0; });
    writeDB(data);
    // Clear finished challenges
    Object.keys(clanChallenges).forEach(k => { if (clanChallenges[k].status === 'finished') delete clanChallenges[k]; });
    // Broadcast reset to all connected clients
    io.emit('clan_weekly_reset', { top3: top3.map((c, i) => ({ name: c.name, tag: c.tag, rank: i+1 })) });
    console.log('[Weekly Reset] Done — top3:', top3.map(c => c.name));
    // Schedule next reset
    setTimeout(doWeeklyReset, getNextFriday20h());
  } catch(e) { console.error('[Weekly Reset] Error:', e.message); }
}
// Schedule first reset
setTimeout(doWeeklyReset, getNextFriday20h());
console.log(`[Weekly Reset] Next reset in ${Math.round(getNextFriday20h()/1000/3600)}h`);

// ══════════════════════════════════════════════════════
// TOURNAMENTS (Premium create, all can join)
// ══════════════════════════════════════════════════════

const tournaments = {}; // id -> tournament obj

app.post('/api/tournaments/create', express.json(), (req, res) => {
  try {
    const { userId, name, mode, maxTeams, description, scheduledAt } = req.body;
    const data = readDB();
    const user = data.users.find(u => u.id === userId);
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
    const isContentCreator = CONTENT_PSEUDOS.includes(user.pseudo);
    if (!user.isPremium && !isContentCreator) return res.status(403).json({ error: 'PREMIUM_REQUIRED' });
    // 5-day cooldown entre tournois — pas de cooldown pour les Content
    if (!isContentCreator) {
      const lastCreated = user.lastTournamentAt || 0;
      const cooldownMs = 5 * 24 * 60 * 60 * 1000;
      if (Date.now() - lastCreated < cooldownMs) {
        const remaining = Math.ceil((cooldownMs - (Date.now() - lastCreated)) / (1000 * 3600));
        return res.status(400).json({ error: `Prochain tournoi disponible dans ${remaining}h` });
      }
    }
    // Scheduled date: minimum 24h from now, maximum 7 days
    const scheduled = scheduledAt ? new Date(scheduledAt).getTime() : 0;
    if (!scheduled || scheduled < Date.now() + 24 * 60 * 60 * 1000) {
      return res.status(400).json({ error: 'La date doit être au minimum 24h dans le futur' });
    }
    if (scheduled > Date.now() + 7 * 24 * 60 * 60 * 1000) {
      return res.status(400).json({ error: 'La date ne peut pas dépasser 7 jours' });
    }
    // 1 active tournament per user at a time
    const hasActive = Object.values(tournaments).find(t => t.creatorId === userId && t.status !== 'finished' && t.status !== 'cancelled');
    if (hasActive) return res.status(400).json({ error: 'Vous avez déjà un tournoi actif' });
    const id = 'tourney_' + Date.now();
    const validMode = ['1v1','2v2','3v3','5v5'].includes(mode) ? mode : '5v5';
    const teamSize = { '1v1':1, '2v2':2, '3v3':3, '5v5':5 }[validMode] || 5;
    const maxT = Math.min(16, Math.max(4, parseInt(maxTeams) || 8));
    tournaments[id] = {
      id, name: (name||'Tournoi').slice(0,32), mode: validMode, teamSize,
      maxTeams: maxT, description: (description||'').slice(0,120),
      creatorId: userId, creatorPseudo: user.pseudo,
      status: 'open', teams: [], pendingTeams: {}, scheduledAt: scheduled, createdAt: Date.now()
    };
    user.lastTournamentAt = Date.now();
    writeDB(data);
    io.emit('tournament_created', { id, name: tournaments[id].name, mode: validMode, creatorPseudo: user.pseudo, scheduledAt: scheduled });
    res.json({ ok: true, id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/tournaments', (req, res) => {
  const list = Object.values(tournaments)
    .filter(t => t.status !== 'finished' && t.status !== 'cancelled')
    .map(t => ({ ...t, teamCount: t.teams.length }));
  res.json(list);
});

// ── TEAM INVITATION SYSTEM ──
// Captain sends invites to clan members, they accept/decline.
// Once ALL accepted → team registered officially.

app.post('/api/tournaments/invite', express.json(), (req, res) => {
  try {
    const { captainId, tournamentId, memberIds, teamName } = req.body;
    const t = tournaments[tournamentId];
    if (!t) return res.status(404).json({ error: 'Tournoi introuvable' });
    if (t.status !== 'open' && t.status !== 'full') return res.status(400).json({ error: 'Tournoi fermé' });
    if (t.teams.length >= t.maxTeams) return res.status(400).json({ error: 'Tournoi complet' });
    if (!Array.isArray(memberIds) || memberIds.length !== t.teamSize - 1) {
      return res.status(400).json({ error: `Il faut exactement ${t.teamSize - 1} coéquipier(s) en plus du capitaine` });
    }
    const data = readDB();
    const captain = data.users.find(u => u.id === captainId);
    if (!captain) return res.status(404).json({ error: 'Capitaine introuvable' });
    // Check captain is in a clan with all these members
    if (!captain.clanId) return res.status(400).json({ error: 'Tu dois être dans un clan pour inscrire une équipe' });
    const clan = (data.clans||[]).find(c => c.id === captain.clanId);
    if (!clan) return res.status(400).json({ error: 'Clan introuvable' });
    const allInClan = memberIds.every(id => clan.members.includes(id));
    if (!allInClan) return res.status(400).json({ error: 'Tous les membres doivent être dans ton clan' });
    // Check not already in a pending/confirmed team
    const alreadyIn = [...t.teams, ...Object.values(t.pendingTeams||{})].find(tm =>
      tm.captainId === captainId || (tm.memberIds||[]).includes(captainId) ||
      memberIds.some(id => tm.captainId === id || (tm.memberIds||[]).includes(id))
    );
    if (alreadyIn) return res.status(400).json({ error: 'Un ou plusieurs joueurs sont déjà inscrits/invités' });
    const pendingId = 'pteam_' + Date.now();
    if (!t.pendingTeams) t.pendingTeams = {};
    t.pendingTeams[pendingId] = {
      pendingId, captainId, captainPseudo: captain.pseudo, clanTag: clan.tag,
      teamName: (teamName || clan.tag || captain.pseudo).slice(0, 20),
      memberIds, acceptedIds: [captainId], declinedIds: [], createdAt: Date.now()
    };
    // Notify each invitee via socket
    memberIds.forEach(mId => {
      const member = data.users.find(u => u.id === mId);
      io.sockets.sockets.forEach(s => {
        if (s.userId === mId) s.emit('tournament_invite', {
          pendingId, tournamentId, tournamentName: t.name,
          captainPseudo: captain.pseudo, teamName: t.pendingTeams[pendingId].teamName,
          mode: t.mode, scheduledAt: t.scheduledAt
        });
      });
    });
    res.json({ ok: true, pendingId });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Member responds to tournament invite
app.post('/api/tournaments/invite/respond', express.json(), (req, res) => {
  try {
    const { userId, tournamentId, pendingId, accept } = req.body;
    const t = tournaments[tournamentId];
    if (!t || !t.pendingTeams) return res.status(404).json({ error: 'Invitation introuvable' });
    const pt = t.pendingTeams[pendingId];
    if (!pt) return res.status(404).json({ error: 'Invitation introuvable' });
    if (!pt.memberIds.includes(userId)) return res.status(403).json({ error: 'Non autorisé' });
    if (!accept) {
      pt.declinedIds.push(userId);
      // Cancel the pending team — notify captain
      io.sockets.sockets.forEach(s => {
        if (s.userId === pt.captainId) s.emit('tournament_invite_declined', {
          tournamentId, pendingId, by: userId,
          tournamentName: t.name
        });
      });
      delete t.pendingTeams[pendingId];
      return res.json({ ok: true });
    }
    pt.acceptedIds.push(userId);
    // If all members accepted → register officially
    const allAccepted = pt.memberIds.every(id => pt.acceptedIds.includes(id));
    if (allAccepted) {
      const team = {
        captainId: pt.captainId, captainPseudo: pt.captainPseudo,
        teamName: pt.teamName, clanTag: pt.clanTag,
        memberIds: [pt.captainId, ...pt.memberIds],
        joinedAt: Date.now()
      };
      t.teams.push(team);
      if (t.teams.length >= t.maxTeams) t.status = 'full';
      delete t.pendingTeams[pendingId];
      // Notify all team members
      team.memberIds.forEach(mId => {
        io.sockets.sockets.forEach(s => {
          if (s.userId === mId) s.emit('tournament_team_confirmed', {
            tournamentId, tournamentName: t.name, teamName: team.teamName
          });
        });
      });
      io.emit('tournament_updated', { id: tournamentId, teamCount: t.teams.length, maxTeams: t.maxTeams, status: t.status });
    } else {
      // Notify captain of progress
      io.sockets.sockets.forEach(s => {
        if (s.userId === pt.captainId) s.emit('tournament_invite_progress', {
          tournamentId, pendingId, accepted: pt.acceptedIds.length, total: pt.memberIds.length + 1
        });
      });
    }
    res.json({ ok: true, allAccepted });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Cancel team registration (up to 1h before start)
app.post('/api/tournaments/cancel-team', express.json(), (req, res) => {
  try {
    const { userId, tournamentId } = req.body;
    const t = tournaments[tournamentId];
    if (!t) return res.status(404).json({ error: 'Tournoi introuvable' });
    // Check 1h limit
    if (t.scheduledAt && Date.now() > t.scheduledAt - 60 * 60 * 1000) {
      return res.status(400).json({ error: 'Impossible d\'annuler moins d\'1h avant le tournoi' });
    }
    const teamIdx = t.teams.findIndex(tm => tm.memberIds && tm.memberIds.includes(userId));
    if (teamIdx === -1) {
      // Check pending teams too
      const pendingKey = Object.keys(t.pendingTeams||{}).find(k => {
        const pt = t.pendingTeams[k];
        return pt.captainId === userId || pt.memberIds.includes(userId);
      });
      if (pendingKey) { delete t.pendingTeams[pendingKey]; return res.json({ ok: true }); }
      return res.status(404).json({ error: 'Équipe introuvable' });
    }
    const team = t.teams[teamIdx];
    t.teams.splice(teamIdx, 1);
    if (t.status === 'full') t.status = 'open';
    // Notify all team members
    (team.memberIds||[]).forEach(mId => {
      io.sockets.sockets.forEach(s => {
        if (s.userId === mId) s.emit('tournament_team_cancelled', { tournamentId, tournamentName: t.name });
      });
    });
    io.emit('tournament_updated', { id: tournamentId, teamCount: t.teams.length, maxTeams: t.maxTeams, status: t.status });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Start tournament + generate random bracket
app.post('/api/tournaments/start', express.json(), (req, res) => {
  try {
    const { userId, tournamentId } = req.body;
    const t = tournaments[tournamentId];
    if (!t) return res.status(404).json({ error: 'Tournoi introuvable' });
    if (t.creatorId !== userId) return res.status(403).json({ error: 'Non autorisé' });
    if (t.teams.length < 2) return res.status(400).json({ error: 'Minimum 2 équipes pour démarrer' });
    // Shuffle teams for random bracket
    const shuffled = [...t.teams].sort(() => Math.random() - 0.5);
    // Build bracket rounds
    const bracket = [];
    let round1 = [];
    for (let i = 0; i < shuffled.length; i += 2) {
      if (shuffled[i + 1]) {
        round1.push({ team1: shuffled[i].teamName, team2: shuffled[i+1].teamName, winner: null, votes: {} });
      } else {
        // Odd team → bye
        round1.push({ team1: shuffled[i].teamName, team2: 'BYE', winner: shuffled[i].teamName, votes: {} });
      }
    }
    bracket.push(round1);
    t.status = 'started';
    t.bracket = bracket;
    t.currentRound = 0;
    io.emit('tournament_started', { id: tournamentId, name: t.name, bracket });

    // Create rooms for round 1 matches (with slight delay for sockets to re-settle)
    setTimeout(() => {
      round1.forEach((match, mi) => {
        if (!match.winner && match.team2 !== 'BYE') createTournamentRoom(t, match, 0, mi);
      });
    }, 800);

    res.json({ ok: true, bracket });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Vote match result
app.post('/api/tournaments/vote', express.json(), (req, res) => {
  try {
    const { userId, tournamentId, roundIdx, matchIdx, winner } = req.body;
    const t = tournaments[tournamentId];
    if (!t || !t.bracket) return res.status(404).json({ error: 'Tournoi introuvable' });
    const match = t.bracket[roundIdx]?.[matchIdx];
    if (!match) return res.status(404).json({ error: 'Match introuvable' });
    if (match.winner) return res.status(400).json({ error: 'Match déjà terminé' });
    const team1 = t.teams.find(tm => tm.teamName === match.team1);
    const team2 = t.teams.find(tm => tm.teamName === match.team2);
    const inTeam1 = team1 && (team1.captainId === userId || (team1.memberIds||[]).includes(userId));
    const inTeam2 = team2 && (team2.captainId === userId || (team2.memberIds||[]).includes(userId));
    if (!inTeam1 && !inTeam2) return res.status(403).json({ error: 'Tu n\'es pas dans ce match' });
    if (!match.votes) match.votes = {};
    match.votes[userId] = winner;
    const capt1Vote = team1 ? match.votes[team1.captainId] : null;
    const capt2Vote = team2 ? match.votes[team2.captainId] : null;
    if (capt1Vote && capt2Vote) {
      if (capt1Vote === capt2Vote) {
        setMatchWinner(t, roundIdx, matchIdx, capt1Vote);
      } else {
        ADMIN_PSEUDOS.forEach(pseudo => {
          io.sockets.sockets.forEach(s => {
            if (s.pseudo === pseudo) s.emit('tournament_dispute', { tournamentId, tournamentName: t.name, roundIdx, matchIdx, team1: match.team1, team2: match.team2, capt1Vote, capt2Vote });
          });
        });
        match.disputed = true;
        io.emit('tournament_match_disputed', { tournamentId, roundIdx, matchIdx });
      }
    }
    res.json({ ok: true, votes: match.votes });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── BRACKET ADVANCEMENT HELPER ──
function advanceBracket(t) {
  const currentRound = t.bracket[t.bracket.length - 1];
  const allDone = currentRound.every(m => m.winner);
  if (!allDone) return;

  // Collect winners (skip BYE matches which are already resolved)
  const winners = currentRound.map(m => m.winner).filter(w => w && w !== 'BYE');

  // Final: only 1 match left and it has a winner
  if (currentRound.length === 1 && currentRound[0].winner) {
    t.status = 'finished';
    t.champion = currentRound[0].winner;
    io.emit('tournament_finished', { id: t.id, name: t.name, champion: t.champion });
    emitActivity('tournament_win', { pseudo: t.champion, tournamentName: t.name });
    return;
  }

  // Check if this round had only 1 real match (final) 
  if (winners.length === 1) {
    t.status = 'finished';
    t.champion = winners[0];
    io.emit('tournament_finished', { id: t.id, name: t.name, champion: t.champion });
    return;
  }

  // Build next round
  const nextRound = [];
  for (let i = 0; i < winners.length; i += 2) {
    if (winners[i + 1]) {
      nextRound.push({ team1: winners[i], team2: winners[i + 1], winner: null, votes: {}, roomId: null });
    } else {
      // Odd winner → bye
      nextRound.push({ team1: winners[i], team2: 'BYE', winner: winners[i], votes: {} });
    }
  }

  if (nextRound.length === 0) return;
  t.bracket.push(nextRound);
  t.currentRound = t.bracket.length - 1;
  io.emit('tournament_round_advanced', { id: t.id, newRound: nextRound, roundIdx: t.currentRound });

  // If next round has only 1 real match and it's a BYE → auto-resolve and check again
  if (nextRound.length === 1 && nextRound[0].winner) {
    advanceBracket(t);
  }
}

// Create a ranked room for a tournament match
function createTournamentRoom(t, match, roundIdx, matchIdx) {
  if (match.roomId || match.winner || match.team2 === 'BYE') return;
  const team1Obj = t.teams.find(tm => tm.teamName === match.team1);
  const team2Obj = t.teams.find(tm => tm.teamName === match.team2);
  if (!team1Obj || !team2Obj) return;

  const data = readDB();
  const makePlayer = (userId) => {
    const u = data.users.find(u => u.id === userId);
    if (!u) return null;
    return { id: u.id, pseudo: u.pseudo, elo: (u.stats?.[t.mode]?.elo || 500), avatar: u.avatar || null, stats: u.stats || null, isBot: !!u.isBot, socketId: null, isPremium: !!u.isPremium };
  };

  const team1Members = team1Obj.memberIds?.length ? team1Obj.memberIds : [team1Obj.captainId];
  const team2Members = team2Obj.memberIds?.length ? team2Obj.memberIds : [team2Obj.captainId];
  const players1 = team1Members.map(makePlayer).filter(Boolean);
  const players2 = team2Members.map(makePlayer).filter(Boolean);

  // Attach live socketIds
  io.sockets.sockets.forEach(s => {
    players1.forEach(p => { if (s.userId === p.id) p.socketId = s.id; });
    players2.forEach(p => { if (s.userId === p.id) p.socketId = s.id; });
  });

  const roomId = 'TR' + Date.now();
  const room = {
    id: roomId, mode: t.mode,
    teams: [players1, players2],
    chat: [], mapBans: [], banTurn: 0, status: 'waiting', chosenMap: null, banTimer: null,
    tournamentId: t.id, tournamentName: t.name, tournamentRoundIdx: roundIdx, tournamentMatchIdx: matchIdx,
    captains: [team1Obj.captainId, team2Obj.captainId],
    captainPseudos: [team1Obj.captainPseudo, team2Obj.captainPseudo],
    votes: {}
  };
  rooms[roomId] = room;
  match.roomId = roomId;

  const basePayload = {
    roomId, mode: t.mode,
    team1: players1.map(p => ({ pseudo: p.pseudo, elo: p.elo, avatar: p.avatar, stats: p.stats, isPremium: p.isPremium })),
    team2: players2.map(p => ({ pseudo: p.pseudo, elo: p.elo, avatar: p.avatar, stats: p.stats, isPremium: p.isPremium })),
    captains: [team1Obj.captainPseudo, team2Obj.captainPseudo],
    waiting: false,
    isTournamentMatch: true,
    tournamentId: t.id,
    tournamentName: t.name,
    tournamentRoundIdx: roundIdx,
    tournamentMatchIdx: matchIdx
  };

  // Send tournament_room_assigned directly to each player's socket (skip admins in spectator)
  const allPlayers = [...players1, ...players2];
  allPlayers.filter(p => p.socketId).forEach(p => {
    const s = io.sockets.sockets.get(p.socketId);
    if (!s) return;
    if (!s.isAdmin) {
      s.join('room_' + roomId);
      s.roomId = roomId;
    }
    s.emit('tournament_room_assigned', basePayload);
  });

  // Also send chat + countdown to the room (only joined non-admin players are in it)
  io.to('room_' + roomId).emit('chat_msg', { author: 'Système', team: 'system', text: `🏆 Match de tournoi — ${t.name} · ${match.team1} vs ${match.team2}` });
  startRoomCountdown(roomId);
  io.emit('tournament_match_room_created', { tournamentId: t.id, roundIdx, matchIdx, roomId });
}

// Tell players in a just-finished room which next match/round they're in
function notifyTournamentNextRound(t, finishedRoundIdx, finishedRoomId) {
  const nextRoundIdx = finishedRoundIdx + 1;
  if (!t.bracket[nextRoundIdx]) return; // tournament may be finished
  const nextRound = t.bracket[nextRoundIdx];
  // Find which match in next round each player belongs to
  const room = rooms[finishedRoomId] || archivedRooms[finishedRoomId];
  if (!room) return;
  const allPlayerIds = [...(room.teams[0]||[]), ...(room.teams[1]||[])].map(p => p.id);
  nextRound.forEach((match, mi) => {
    const team1Obj = t.teams.find(tm => tm.teamName === match.team1);
    const team2Obj = t.teams.find(tm => tm.teamName === match.team2);
    const nextPlayerIds = [
      ...((team1Obj?.memberIds)||[team1Obj?.captainId]).filter(Boolean),
      ...((team2Obj?.memberIds)||[team2Obj?.captainId]).filter(Boolean)
    ];
    const roundLabel = nextRoundIdx === t.bracket.length - 1 ? 'la Finale' :
      nextRoundIdx === t.bracket.length - 2 ? 'les Demi-finales' :
      `le Round ${nextRoundIdx + 1}`;
    nextPlayerIds.filter(id => allPlayerIds.includes(id)).forEach(playerId => {
      io.sockets.sockets.forEach(s => {
        if (s.userId === playerId) {
          s.emit('tournament_next_round', {
            tournamentId: t.id,
            tournamentName: t.name,
            roundIdx: nextRoundIdx,
            matchIdx: mi,
            roundLabel,
            roomId: match.roomId || null
          });
        }
      });
    });
  });
}

// Helper: set match winner and trigger bracket advance + room creation for next matches
function setMatchWinner(t, roundIdx, matchIdx, winner, finishedRoomId) {
  const match = t.bracket[roundIdx][matchIdx];
  match.winner = winner;
  match.disputed = false;

  io.emit('tournament_match_result', { tournamentId: t.id, roundIdx, matchIdx, winner });

  // Try to advance bracket (creates next round if all done)
  advanceBracket(t);

  // Create rooms for newly created next round matches
  if (t.bracket.length > roundIdx + 1) {
    const nextRound = t.bracket[roundIdx + 1];
    nextRound.forEach((m, mi) => {
      if (!m.winner && m.team2 !== 'BYE') createTournamentRoom(t, m, roundIdx + 1, mi);
    });
    // Tell players which next match they're going to
    if (finishedRoomId) notifyTournamentNextRound(t, roundIdx, finishedRoomId);
  }
}

// Admin resolve disputed match (and set winner)
app.post('/api/tournaments/resolve', express.json(), (req, res) => {
  try {
    const { adminKey, tournamentId, roundIdx, matchIdx, winner } = req.body;
    if (adminKey !== ADMIN_KEY) return res.status(403).json({ error: 'Non autorisé' });
    const t = tournaments[tournamentId];
    if (!t || !t.bracket) return res.status(404).json({ error: 'Tournoi introuvable' });
    const match = t.bracket[roundIdx]?.[matchIdx];
    if (!match) return res.status(404).json({ error: 'Match introuvable' });
    setMatchWinner(t, roundIdx, matchIdx, winner);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin declare winner directly (same as resolve but explicit endpoint)
app.post('/api/tournaments/admin-declare', express.json(), (req, res) => {
  try {
    const { adminKey, tournamentId, roundIdx, matchIdx, winner } = req.body;
    if (adminKey !== ADMIN_KEY) return res.status(403).json({ error: 'Non autorisé' });
    const t = tournaments[tournamentId];
    if (!t || !t.bracket) return res.status(404).json({ error: 'Tournoi introuvable' });
    const match = t.bracket[roundIdx]?.[matchIdx];
    if (!match) return res.status(404).json({ error: 'Match introuvable' });
    if (match.winner) return res.status(400).json({ error: 'Match déjà terminé' });
    setMatchWinner(t, roundIdx, matchIdx, winner);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin kick/disqualify a team from tournament
app.post('/api/tournaments/kick-team', express.json(), (req, res) => {
  try {
    const { adminKey, tournamentId, teamName } = req.body;
    if (adminKey !== ADMIN_KEY) return res.status(403).json({ error: 'Non autorisé' });
    const t = tournaments[tournamentId];
    if (!t) return res.status(404).json({ error: 'Tournoi introuvable' });
    const before = t.teams.length;
    t.teams = t.teams.filter(tm => tm.teamName !== teamName);
    if (t.bracket) {
      t.bracket.forEach((round, ri) => {
        round.forEach((match, mi) => {
          if (!match.winner) {
            if (match.team1 === teamName || match.team2 === teamName) {
              const opp = match.team1 === teamName ? match.team2 : match.team1;
              setMatchWinner(t, ri, mi, opp);
            }
          }
        });
      });
    }
    io.emit('tournament_updated', { id: tournamentId, teamCount: t.teams.length, maxTeams: t.maxTeams, status: t.status });
    io.emit('tournament_team_disqualified', { tournamentId, teamName });
    res.json({ ok: true, removed: before - t.teams.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Get full tournament detail (for spectator view)
app.get('/api/tournaments/:id', (req, res) => {
  const t = tournaments[req.params.id];

  if (!t) return res.status(404).json({ error: 'Introuvable' });
  res.json(t);
});

// ── BO3 READY SYSTEM ──
app.post('/api/clans/bo3-ready', express.json(), (req, res) => {
  try {
    const { userId, clanId, ready } = req.body;
    const data = readDB();
    const clan = (data.clans||[]).find(c => c.id === clanId);
    if (!clan) return res.status(404).json({ error: 'Clan introuvable' });
    if (!clan.members.includes(userId)) return res.status(403).json({ error: 'Pas membre du clan' });
    if (!clan.bo3ReadyMembers) clan.bo3ReadyMembers = [];
    if (ready) {
      if (!clan.bo3ReadyMembers.includes(userId)) clan.bo3ReadyMembers.push(userId);
    } else {
      clan.bo3ReadyMembers = clan.bo3ReadyMembers.filter(id => id !== userId);
    }
    writeDB(data);
    // Notify all clan members
    clan.members.forEach(mId => {
      io.sockets.sockets.forEach(s => {
        if (s.userId === mId) s.emit('clan_bo3_ready_update', { clanId, readyCount: clan.bo3ReadyMembers.length, readyMembers: clan.bo3ReadyMembers });
      });
    });
    res.json({ ok: true, readyCount: clan.bo3ReadyMembers.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Include bo3ReadyMembers in clan user endpoint

// Admin: simulate a full tournament with bots
app.post('/api/admin/simulate-tournament', express.json(), (req, res) => {
  try {
    const { adminKey, userId, name, mode, teamCount } = req.body;
    if (adminKey !== ADMIN_KEY) return res.status(403).json({ error: 'Non autorisé' });
    const data = readDB();
    const user = data.users.find(u => u.id === userId);
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });

    const validMode = ['1v1','2v2','3v3','5v5'].includes(mode) ? mode : '5v5';
    const teamSize = { '1v1':1, '2v2':2, '3v3':3, '5v5':5 }[validMode] || 5;
    const numTeams = Math.min(16, Math.max(4, parseInt(teamCount) || 8));
    const id = 'tourney_sim_' + Date.now();
    const scheduledAt = Date.now() + 60 * 1000; // 1 min from now (bypass 24h for admin)

    // Generate bot teams
    const botTeams = [];
    const teamNames = ['Alpha','Bravo','Charlie','Delta','Echo','Foxtrot','Golf','Hotel','India','Juliet','Kilo','Lima','Mike','November','Oscar','Papa'];
    for (let i = 0; i < numTeams; i++) {
      const tName = teamNames[i] || ('Team' + (i+1));
      const memberIds = [];
      for (let j = 0; j < teamSize; j++) {
        const botId = 'bot_sim_' + Date.now() + '_t' + i + '_m' + j;
        const elo = 400 + Math.floor(Math.random() * 600);
        data.users.push({ id: botId, pseudo: tName + (j===0?'_Cap':'_P'+(j+1)), isBot: true, stats: { [validMode]: { elo, wins: 0, losses: 0 } } });
        memberIds.push(botId);
      }
      botTeams.push({
        captainId: memberIds[0],
        captainPseudo: tName + '_Cap',
        teamName: tName,
        clanTag: tName.slice(0,3).toUpperCase(),
        memberIds,
        joinedAt: Date.now()
      });
    }

    // If admin is in a clan, add their team too as first team
    const adminTeam = {
      captainId: userId,
      captainPseudo: user.pseudo,
      teamName: user.pseudo + "'s Team",
      clanTag: null,
      memberIds: [userId],
      joinedAt: Date.now()
    };

    const allTeams = [adminTeam, ...botTeams.slice(0, numTeams - 1)]; // replace last bot with admin

    // Build bracket immediately
    const shuffled = [...allTeams].sort(() => Math.random() - 0.5);
    const round1 = [];
    for (let i = 0; i < shuffled.length; i += 2) {
      if (shuffled[i + 1]) {
        round1.push({ team1: shuffled[i].teamName, team2: shuffled[i+1].teamName, winner: null, votes: {} });
      } else {
        round1.push({ team1: shuffled[i].teamName, team2: 'BYE', winner: shuffled[i].teamName, votes: {} });
      }
    }

    tournaments[id] = {
      id, name: (name || 'Tournoi Simulé').slice(0, 32),
      mode: validMode, teamSize,
      maxTeams: numTeams, description: '🤖 Simulation admin',
      creatorId: userId, creatorPseudo: user.pseudo,
      status: 'started', teams: allTeams, pendingTeams: {},
      scheduledAt, createdAt: Date.now(),
      bracket: [round1], currentRound: 0
    };

    writeDB(data);
    io.emit('tournament_created', { id, name: tournaments[id].name, mode: validMode, creatorPseudo: user.pseudo, scheduledAt });
    io.emit('tournament_started', { id, name: tournaments[id].name, bracket: [round1] });

    // Create rooms for round 1 real matches
    setTimeout(() => {
      const t = tournaments[id];
      if (t) round1.forEach((match, mi) => {
        if (!match.winner && match.team2 !== 'BYE') createTournamentRoom(t, match, 0, mi);
      });
    }, 800);

    res.json({ ok: true, id, teamCount: allTeams.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/admin/clan-bots', express.json(), (req, res) => {
  try {
    const { adminKey, userId } = req.body;
    if (adminKey !== ADMIN_KEY) return res.status(403).json({ error: 'Non autorisé' });
    const data = readDB();
    const user = data.users.find(u => u.id === userId);
    if (!user || !user.clanId) return res.status(400).json({ error: 'Tu dois être dans un clan' });
    const clan = (data.clans||[]).find(c => c.id === user.clanId);
    if (!clan) return res.status(404).json({ error: 'Clan introuvable' });
    // Add bot members until 5 total (or existing count if already ≥5)
    const needed = Math.max(0, 5 - clan.members.length);
    for (let i = 0; i < needed; i++) {
      const botId = 'bot_clan_' + Date.now() + '_' + i;
      const botUser = { id: botId, pseudo: 'BotClan' + (i+1), stats: { '5v5': { elo: 500, wins: 0, losses: 0 } }, isBot: true, clanId: clan.id };
      data.users.push(botUser);
      clan.members.push(botId);
    }
    // Mark all members ready for BO3
    clan.bo3ReadyMembers = [...clan.members];
    writeDB(data);
    // Notify clan members
    clan.members.forEach(mId => {
      io.sockets.sockets.forEach(s => {
        if (s.userId === mId) s.emit('clan_bo3_ready_update', { clanId: clan.id, readyCount: clan.bo3ReadyMembers.length, readyMembers: clan.bo3ReadyMembers });
      });
    });
    res.json({ ok: true, memberCount: clan.members.length, botsAdded: needed });
  } catch(e) { res.status(500).json({ error: e.message }); }
});