const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// ── Pool PostgreSQL ──────────────────────────────────────────────
const pool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
}) : null;

// ── Fallback JSON (si pas de DATABASE_URL) ───────────────────────
const DB_FILE = process.env.NODE_ENV === 'production'
  ? '/tmp/db.json'
  : path.join(__dirname, 'db.json');

function loadDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const initial = { users: [] };
      fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2));
      return initial;
    }
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch(e) { return { users: [] }; }
}

function saveDB(data) {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); } catch(e) {}
}

// ── Helper SQL ───────────────────────────────────────────────────
async function sql(text, params) {
  if (!pool) return null;
  const client = await pool.connect();
  try { return await client.query(text, params); }
  finally { client.release(); }
}

// ── Convertir une row PG en objet user ───────────────────────────
function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    pseudo: row.pseudo,
    password: row.password,
    stats: row.stats || defaultStats(),
    avatar: row.avatar || null,
    banner: row.banner || null,
    ip: row.ip || null,
    createdAt: row.created_at || row.createdAt,
    referralCode: row.referral_code || row.referralCode,
    referredBy: row.referred_by || row.referredBy || null,
    referrals: row.referrals || [],
    matchHistory: row.match_history || row.matchHistory || [],
    banned: !!row.banned,
    banReason: row.ban_reason || row.banReason || '',
    muted: !!row.muted,
    muteUntil: row.mute_until ? new Date(row.mute_until).getTime() : (row.muteUntil || null),
    muteDuration: row.mute_duration || row.muteDuration || null,
    isPremium: !!row.is_premium || !!row.isPremium,
    premiumUntil: row.premium_until ? new Date(row.premium_until).getTime() : (row.premiumUntil || null),
    referralRewardGiven: !!(row.referral_reward_given || row.referralRewardGiven),
    friends: row.friends || [],
    friendRequests: row.friend_requests || row.friendRequests || [],
    clanId: row.clan_id || row.clanId || null,
    lastClanDissolved: row.last_clan_dissolved ? new Date(row.last_clan_dissolved).getTime() : (row.lastClanDissolved || null),
    lastSeen: row.last_seen || row.lastSeen || null,
    isBot: !!row.is_bot || !!row.isBot,
    premiumPaidAmount: row.premium_paid_amount || row.premiumPaidAmount || 0,
    isFondateur: !!(row.is_fondateur || row.isFondateur),
    fondateurDate: row.fondateur_date || row.fondateurDate || null,
    isContent: !!(row.is_content || row.isContent)
  };
}

// ── STATS PAR DÉFAUT ──────────────────────────────────────────────
function defaultStats() {
  return {
    '1v1': { wins: 0, losses: 0, elo: 500 },
    '2v2': { wins: 0, losses: 0, elo: 500 },
    '3v3': { wins: 0, losses: 0, elo: 500 },
    '5v5': { wins: 0, losses: 0, elo: 500 }
  };
}

// ── UTILISATEURS ─────────────────────────────────────────────────
function getUserByPseudo(pseudo) {
  if (!pool) {
    return loadDB().users.find(u => u.pseudo.toLowerCase() === pseudo.toLowerCase()) || null;
  }
  // Version sync pour compatibilité — retourne une Promise transparente
  // server.js appelle cette fonction sans await, donc on retourne l'objet directement
  // via le cache JSON en attendant la migration complète
  return loadDB().users.find(u => u.pseudo.toLowerCase() === pseudo.toLowerCase()) || null;
}

function getUserById(id) {
  if (!pool) {
    return loadDB().users.find(u => u.id === id) || null;
  }
  return loadDB().users.find(u => u.id === id) || null;
}

function generateReferralCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function createUser(pseudo, hashedPassword, ip, referralCode) {
  const db = loadDB();

  const user = {
    id: Date.now().toString(),
    pseudo,
    password: hashedPassword,
    stats: defaultStats(),
    avatar: null,
    ip: ip || null,
    createdAt: new Date().toISOString(),
    referralCode: pseudo,  // Le code parrainage = le pseudo
    referredBy: null,
    referrals: []
  };

  if (referralCode) {
    // Chercher le parrain par pseudo (le code = pseudo du parrain)
    const referrer = db.users.find(u =>
      u.pseudo.toLowerCase() === referralCode.toLowerCase() ||
      u.referralCode === referralCode.toUpperCase()
    );
    if (referrer && referrer.id !== user.id) {
      user.referredBy = referrer.id;
      if (!referrer.referrals) referrer.referrals = [];
      referrer.referrals.push({ userId: user.id, pseudo: user.pseudo, avatar: null, date: user.createdAt, gamesPlayed: 0 });
    }
  }

  db.users.push(user);
  saveDB(db);

  // Sync vers PostgreSQL en arrière-plan
  if (pool) {
    sql(`INSERT INTO users (id, pseudo, password, stats, ip, referral_code, referred_by, referrals, match_history, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()) ON CONFLICT (id) DO NOTHING`,
      [user.id, user.pseudo, user.password, JSON.stringify(user.stats), user.ip,
       user.referralCode, user.referredBy, JSON.stringify(user.referrals), JSON.stringify([])]
    ).catch(e => console.error('[DB] createUser sync error:', e.message));
  }

  return user;
}

function updateAvatar(id, avatarBase64) {
  const db = loadDB();
  const user = db.users.find(u => u.id === id);
  if (user) {
    user.avatar = avatarBase64;
    saveDB(db);
    if (pool) sql('UPDATE users SET avatar = $1 WHERE id = $2', [avatarBase64, id]).catch(()=>{});
  }
  return user;
}

function updateBanner(id, bannerBase64) {
  const db = loadDB();
  const user = db.users.find(u => u.id === id);
  if (user) {
    user.banner = bannerBase64;
    saveDB(db);
    if (pool) sql('UPDATE users SET banner = $1 WHERE id = $2', [bannerBase64, id]).catch(()=>{});
  }
  return user;
}

function getIpAccounts(ip) {
  if (!ip) return [];
  const norm = ip.toString().split(',')[0].trim().toLowerCase();
  return loadDB().users.filter(u => {
    if (!u.ip) return false;
    return u.ip.toString().split(',')[0].trim().toLowerCase() === norm;
  });
}

function computeEloChange(myElo, opponentAvgElo, won) {
  const diff = myElo - opponentAvgElo;
  const steps = Math.floor(Math.abs(diff) / 50);
  if (won) {
    let base = 15;
    if (diff > 0) base = Math.max(4, base - steps * 3);
    else          base = Math.min(28, base + steps * 3);
    return base;
  } else {
    let base = 10;
    if (diff > 0) base = Math.max(3, base - steps * 2);
    else          base = Math.min(22, base + steps * 2);
    return -base;
  }
}

function updateUserElo(id, eloChange, won, mode, opponents, teammates, draw) {
  const db = loadDB();
  const user = db.users.find(u => u.id === id);
  if (user) {
    if (!user.stats) user.stats = defaultStats();
    if (!user.stats[mode]) user.stats[mode] = { wins: 0, losses: 0, elo: 500 };
    const eloBefore = user.stats[mode].elo;
    user.stats[mode].elo = Math.max(0, eloBefore + eloChange);
    if (!draw) {
      if (won) {
        user.stats[mode].wins++;
        // Streak tracking
        if (!user.stats[mode].currentStreak || user.stats[mode].currentStreak < 0) user.stats[mode].currentStreak = 0;
        user.stats[mode].currentStreak++;
        if (!user.stats[mode].bestStreak || user.stats[mode].currentStreak > user.stats[mode].bestStreak)
          user.stats[mode].bestStreak = user.stats[mode].currentStreak;
      } else {
        user.stats[mode].losses++;
        if (!user.stats[mode].currentStreak || user.stats[mode].currentStreak > 0) user.stats[mode].currentStreak = 0;
        user.stats[mode].currentStreak--;
      }
    }
    if (!user.matchHistory) user.matchHistory = [];
    user.matchHistory.unshift({
      date: new Date().toISOString(),
      mode,
      result: draw ? 'draw' : (won ? 'win' : 'loss'),
      eloChange, eloBefore,
      eloAfter: user.stats[mode].elo,
      opponents: (opponents || []).map(p => p.pseudo),
      teammates: (teammates || []).map(p => p.pseudo).filter(p => p !== user.pseudo)
    });
    if (user.matchHistory.length > 20) user.matchHistory = user.matchHistory.slice(0, 20);
    saveDB(db);

    // Sync vers PostgreSQL
    if (pool) {
      sql('UPDATE users SET stats = $1, match_history = $2 WHERE id = $3',
        [JSON.stringify(user.stats), JSON.stringify(user.matchHistory), id]
      ).catch(()=>{});
    }
  }
  return user;
}

function banUser(id, reason) {
  const db = loadDB();
  const user = db.users.find(u => u.id === id);
  if (user) {
    user.banned = true; user.banReason = reason || '';
    saveDB(db);
    if (pool) sql('UPDATE users SET banned=true, ban_reason=$1 WHERE id=$2', [reason||'', id]).catch(()=>{});
  }
  return user;
}

function unbanUser(id) {
  const db = loadDB();
  const user = db.users.find(u => u.id === id);
  if (user) {
    user.banned = false; user.banReason = '';
    saveDB(db);
    if (pool) sql('UPDATE users SET banned=false, ban_reason=NULL WHERE id=$1', [id]).catch(()=>{});
  }
  return user;
}

function muteUser(id, durationMinutes) {
  const db = loadDB();
  const user = db.users.find(u => u.id === id);
  if (user) {
    user.muted = true;
    if (durationMinutes && durationMinutes > 0) {
      user.muteUntil = Date.now() + durationMinutes * 60 * 1000;
      user.muteDuration = durationMinutes;
    } else {
      user.muteUntil = null;
      user.muteDuration = null;
    }
    saveDB(db);
    if (pool) sql('UPDATE users SET muted=true, mute_until=$1, mute_duration=$2 WHERE id=$3',
      [user.muteUntil ? new Date(user.muteUntil) : null, durationMinutes||null, id]).catch(()=>{});
  }
  return user;
}

function unmuteUser(id) {
  const db = loadDB();
  const user = db.users.find(u => u.id === id);
  if (user) {
    user.muted = false; user.muteUntil = null; user.muteDuration = null;
    saveDB(db);
    if (pool) sql('UPDATE users SET muted=false, mute_until=NULL, mute_duration=NULL WHERE id=$1', [id]).catch(()=>{});
  }
  return user;
}

function checkReferralReward(userId) {
  const db = loadDB();
  const user = db.users.find(u => u.id === userId);
  if (!user || !user.referredBy) return;
  const referrer = db.users.find(u => u.id === user.referredBy);
  if (!referrer) return;

  const totalGames = Object.values(user.stats || {}).reduce((s, m) => s + (m.wins||0) + (m.losses||0), 0);
  if (!referrer.referrals) referrer.referrals = [];
  const entry = referrer.referrals.find(r => r.userId === userId);
  if (entry) { entry.gamesPlayed = totalGames; entry.avatar = user.avatar || null; }

  const qualified = referrer.referrals.filter(r => r.gamesPlayed >= 3).length;
  if (qualified >= 3 && !referrer.referralRewardGiven) {
    referrer.referralRewardGiven = true;
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    if (!referrer.isPremium || !referrer.premiumUntil || referrer.premiumUntil < Date.now()) {
      referrer.isPremium = true;
      referrer.premiumUntil = Date.now() + weekMs;
    } else {
      referrer.premiumUntil += weekMs;
    }
    saveDB(db);
    return { rewardGiven: true, referrerId: referrer.id, premiumUntil: referrer.premiumUntil };
  }
  saveDB(db);
  return { rewardGiven: false };
}

function checkMuteExpiry() {
  const db = loadDB();
  const now = Date.now();
  let changed = false;
  db.users.forEach(u => {
    if (u.muted && u.muteUntil && u.muteUntil <= now) {
      u.muted = false; u.muteUntil = null; u.muteDuration = null;
      changed = true;
    }
  });
  if (changed) saveDB(db);
}

function createTicket(userId, pseudo, subject, message) {
  const db = loadDB();
  if (!db.tickets) db.tickets = [];
  const openCount = db.tickets.filter(t => t.userId === userId && t.status === 'open').length;
  if (openCount >= 2) return { error: 'MAX_TICKETS' };
  const ticket = {
    id: Date.now().toString(),
    userId, pseudo, subject, message,
    status: 'open',
    createdAt: new Date().toISOString(),
    replies: []
  };
  db.tickets.push(ticket);
  saveDB(db);
  return ticket;
}

function getTickets() {
  const db = loadDB();
  const fiveMin = 5 * 60 * 1000;
  const now = Date.now();
  const before = (db.tickets || []).length;
  db.tickets = (db.tickets || []).filter(t => {
    if (t.status !== 'closed') return true;
    const closedAt = t.closedAt ? new Date(t.closedAt).getTime() : new Date(t.createdAt).getTime();
    return (now - closedAt) < fiveMin;
  });
  if (db.tickets.length !== before) saveDB(db);
  return db.tickets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function replyTicket(ticketId, author, message) {
  const db = loadDB();
  if (!db.tickets) return null;
  const ticket = db.tickets.find(t => t.id === ticketId);
  if (ticket) {
    ticket.replies.push({ author, message, createdAt: new Date().toISOString() });
    saveDB(db);
  }
  return ticket;
}

function closeTicket(ticketId) {
  const db = loadDB();
  if (!db.tickets) return null;
  const ticket = db.tickets.find(t => t.id === ticketId);
  if (ticket) {
    ticket.status = 'closed';
    ticket.closedAt = new Date().toISOString();
    saveDB(db);
  }
  return ticket;
}

function getLeaderboard(mode) {
  const db = loadDB();
  return db.users
    .filter(u => !u.banned)
    .map(u => {
      const s = u.stats?.[mode] || { wins: 0, losses: 0, elo: 500 };
      return { id: u.id, pseudo: u.pseudo, elo: s.elo, wins: s.wins, losses: s.losses, avatar: u.avatar || null, banned: !!u.banned, muted: !!u.muted, stats: u.stats, isPremium: !!u.isPremium, premiumUntil: u.premiumUntil || null, isContent: !!u.isContent, avatarFrame: u.avatarFrame || null };
    })
    .sort((a, b) => b.elo - a.elo)
    .slice(0, 50);
}

function setPremium(userId, months) {
  const db = loadDB();
  const user = db.users.find(u => u.id === userId);
  if (!user) return false;
  const now = Date.now();
  const current = user.premiumUntil && user.premiumUntil > now ? user.premiumUntil : now;
  user.isPremium = true;
  user.premiumUntil = current + months * 30 * 24 * 60 * 60 * 1000;
  saveDB(db);
  if (pool) sql('UPDATE users SET is_premium=true, premium_until=$1 WHERE id=$2',
    [new Date(user.premiumUntil), userId]).catch(()=>{});
  return true;
}

function revokePremium(userId) {
  const db = loadDB();
  const user = db.users.find(u => u.id === userId);
  if (!user) return false;
  user.isPremium = false; user.premiumUntil = null;
  saveDB(db);
  if (pool) sql('UPDATE users SET is_premium=false, premium_until=NULL WHERE id=$1', [userId]).catch(()=>{});
  return true;
}

function checkPremiumExpiry() {
  const db = loadDB();
  const now = Date.now();
  let changed = false;
  db.users.forEach(u => {
    if (u.isPremium && u.premiumUntil && u.premiumUntil < now) {
      u.isPremium = false;
      changed = true;
    }
  });
  if (changed) saveDB(db);
}

function addAdminLog(adminPseudo, action, targetPseudo, details) {
  const db = loadDB();
  if (!db.adminLogs) db.adminLogs = [];
  db.adminLogs.unshift({
    id: Date.now().toString(),
    date: new Date().toISOString(),
    admin: adminPseudo,
    action,
    target: targetPseudo || null,
    details: details || null
  });
  if (db.adminLogs.length > 500) db.adminLogs = db.adminLogs.slice(0, 500);
  saveDB(db);
}

function getAdminLogs() {
  return loadDB().adminLogs || [];
}

function getCurrentSeason() {
  const db = loadDB();
  if (!db.season) {
    db.season = { number: 1, startedAt: new Date().toISOString(), endsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString() };
    saveDB(db);
  }
  return db.season;
}

function checkSeasonReset() {
  const db = loadDB();
  if (!db.season) { getCurrentSeason(); return; }
  if (new Date(db.season.endsAt) > new Date()) return;

  if (!db.seasonArchives) db.seasonArchives = [];
  const topByMode = {};
  ['1v1','2v2','3v3','5v5'].forEach(mode => {
    topByMode[mode] = [...db.users]
      .filter(u => u.stats?.[mode]?.wins > 0 || u.stats?.[mode]?.losses > 0)
      .sort((a, b) => (b.stats[mode]?.elo || 500) - (a.stats[mode]?.elo || 500))
      .slice(0, 10)
      .map(u => ({ pseudo: u.pseudo, elo: u.stats[mode]?.elo || 500, wins: u.stats[mode]?.wins || 0, losses: u.stats[mode]?.losses || 0 }));
  });
  db.seasonArchives.unshift({ season: db.season.number, endedAt: new Date().toISOString(), top: topByMode });
  if (db.seasonArchives.length > 10) db.seasonArchives = db.seasonArchives.slice(0, 10);

  db.users.forEach(u => {
    ['1v1','2v2','3v3','5v5'].forEach(mode => {
      if (!u.stats?.[mode]) return;
      const old = u.stats[mode].elo || 500;
      u.stats[mode].elo = Math.round(500 + (old - 500) * 0.5);
    });
  });

  db.season = {
    number: db.season.number + 1,
    startedAt: new Date().toISOString(),
    endsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
  };
  saveDB(db);
  console.log(`[SEASON] Saison ${db.season.number} démarrée, ELO reset.`);
  return db.season;
}

function getSeasonArchives() {
  return loadDB().seasonArchives || [];
}

// ── Ensure PG schema has all required columns ────────────────────
async function ensureSchema() {
  if (!pool) return;
  const cols = [
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS banner TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS ip TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_premium BOOLEAN DEFAULT false",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS premium_until BIGINT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS premium_paid_amount FLOAT DEFAULT 0",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS referrals JSONB DEFAULT '[]'",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS match_history JSONB DEFAULT '[]'",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS friends JSONB DEFAULT '[]'",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS friend_requests JSONB DEFAULT '[]'",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS clan_id TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS banned BOOLEAN DEFAULT false",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS muted BOOLEAN DEFAULT false",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS mute_until BIGINT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS mute_duration INT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_fondateur BOOLEAN DEFAULT false",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS fondateur_date TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_clan_dissolved BIGINT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_tournament_at BIGINT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_reward_given BOOLEAN DEFAULT false",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_content BOOLEAN DEFAULT false",
  ];
  for (const stmt of cols) { await sql(stmt).catch(() => {}); }
  console.log('[DB] ✅ Schema ensured');
}

// ── Sync initial depuis PostgreSQL vers JSON au démarrage ────────
async function syncFromPostgres() {
  if (!pool) return;
  try {
    console.log('[DB] Syncing from PostgreSQL...');
    const usersRes = await sql('SELECT * FROM users WHERE is_bot = false OR is_bot IS NULL LIMIT 10000');
    if (!usersRes || !usersRes.rows.length) {
      console.log('[DB] No users in PostgreSQL, using JSON file');
      return;
    }

    const db = loadDB();

    // Mettre à jour les users depuis PostgreSQL
    usersRes.rows.forEach(row => {
      const pgUser = rowToUser(row);
      const existing = db.users.find(u => u.id === pgUser.id);
      if (existing) {
        // Merge PG → JSON with field-specific rules
        Object.keys(pgUser).forEach(k => {
          // Always trust PG for these fields
          if (['password','banned','isPremium','premiumUntil','muted','muteUntil'].includes(k)) {
            existing[k] = pgUser[k];
            return;
          }
          // For stats: only trust PG if PG has real data (not just defaults)
          if (k === 'stats') {
            const pgStats = pgUser[k];
            const pgHasRealData = pgStats && Object.values(pgStats).some(m => (m.elo||500) !== 500 || (m.wins||0) > 0 || (m.losses||0) > 0);
            if (pgHasRealData) { existing[k] = pgUser[k]; }
            // else: keep JSON stats (they have real data)
            return;
          }
          // For boolean "upgrade" fields: only overwrite JSON false→PG true, never true→false
          if (['isFondateur', 'isContent'].includes(k)) {
            if (pgUser[k] === true) existing[k] = true;
            // if PG says false but JSON says true, keep JSON true
            return;
          }
          // For array fields (friends, friendRequests): merge PG and JSON, keep longest
          if (['friends', 'friendRequests'].includes(k)) {
            const pgArr = pgUser[k] || [];
            const jsonArr = existing[k] || [];
            // Merge: union of both arrays
            const merged = [...new Set([...jsonArr, ...pgArr])];
            existing[k] = merged;
            return;
          }
          // For nullable fields: only overwrite if PG has a real value
          if (pgUser[k] !== null && pgUser[k] !== undefined) {
            existing[k] = pgUser[k];
          } else if (existing[k] === undefined) {
            existing[k] = pgUser[k];
          }
        });
      } else {
        db.users.push(pgUser);
      }
    });

    // Sync tickets
    try {
      const ticketsRes = await sql('SELECT * FROM tickets ORDER BY created_at DESC');
      if (ticketsRes && ticketsRes.rows.length) {
        db.tickets = ticketsRes.rows.map(t => ({
          id: t.id, userId: t.user_id, pseudo: t.pseudo,
          subject: t.subject, message: t.message, status: t.status,
          replies: t.replies || [], createdAt: t.created_at,
          closedAt: t.closed_at || null
        }));
      }
    } catch(e) {}

    // Sync clans
    try {
      const clansRes = await sql('SELECT * FROM clans');
      if (clansRes && clansRes.rows.length) {
        db.clans = clansRes.rows.map(c => ({
          id: c.id, name: c.name, tag: c.tag, description: c.description,
          leaderId: c.leader_id, members: c.members || [],
          joinRequests: c.join_requests || [],
          weeklyPoints: c.weekly_points || 0,
          bo3Wins: c.bo3_wins || 0, bo3Losses: c.bo3_losses || 0,
          bo3ReadyMembers: c.bo3_ready_members || [],
          createdAt: c.created_at
        }));
      }
    } catch(e) {}

    saveDB(db);
    console.log(`[DB] ✅ Synced ${usersRes.rows.length} users from PostgreSQL`);

    // ── Push JSON-only fields back to PG (avatar, banner, ip, isFondateur etc) ──
    for (const u of db.users) {
      if (!u.id) continue;
      // Only push fields that have actual values in JSON (don't overwrite PG good data with nulls)
      const updates = [];
      const vals = [];
      let idx = 1;
      if (u.avatar)           { updates.push(`avatar = $${idx++}`);            vals.push(u.avatar); }
      if (u.banner)           { updates.push(`banner = $${idx++}`);            vals.push(u.banner); }
      if (u.ip)               { updates.push(`ip = $${idx++}`);                vals.push(u.ip); }
      if (u.isFondateur)      { updates.push(`is_fondateur = $${idx++}`);      vals.push(true); }
      if (u.fondateurDate)    { updates.push(`fondateur_date = $${idx++}`);    vals.push(u.fondateurDate); }
      if (u.referralCode)     { updates.push(`referral_code = $${idx++}`);     vals.push(u.referralCode); }
      if (u.isContent)        { updates.push(`is_content = $${idx++}`);         vals.push(true); }
      if (u.stats && Object.keys(u.stats).length) { updates.push(`stats = $${idx++}`); vals.push(JSON.stringify(u.stats)); }
      if (u.friends && u.friends.length) { updates.push(`friends = $${idx++}`); vals.push(JSON.stringify(u.friends)); }
      if (u.friendRequests && u.friendRequests.length) { updates.push(`friend_requests = $${idx++}`); vals.push(JSON.stringify(u.friendRequests)); }
      if (u.lastTournamentAt) { updates.push(`last_tournament_at = $${idx++}`); vals.push(u.lastTournamentAt); }
      if (u.lastClanDissolved){ updates.push(`last_clan_dissolved = $${idx++}`); vals.push(u.lastClanDissolved); }
      if (updates.length > 0) {
        vals.push(u.id);
        sql(`UPDATE users SET ${updates.join(', ')} WHERE id = $${idx}`, vals).catch(()=>{});
      }
    }
  } catch(e) {
    console.error('[DB] Sync error:', e.message);
  }
}

// Helper: sync stats for one user to PG immediately
async function syncStatsToPg(userId, stats) {
  if (!pool) return;
  await sql('UPDATE users SET stats = $1 WHERE id = $2', [JSON.stringify(stats), userId]);
}

module.exports = {
  sql, ensureSchema, syncFromPostgres, syncStatsToPg,
  getUserByPseudo, getUserById, createUser, checkReferralReward,
  updateUserElo, computeEloChange, getLeaderboard, updateAvatar, updateBanner,
  getIpAccounts, defaultStats, banUser, unbanUser, muteUser, unmuteUser,
  checkMuteExpiry, createTicket, getTickets, replyTicket, closeTicket,
  setPremium, revokePremium, checkPremiumExpiry, loadDB, saveDB,
  addAdminLog, getAdminLogs, getCurrentSeason, checkSeasonReset, getSeasonArchives
};