const fs = require('fs');
const path = require('path');

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
  } catch(e) {
    return { users: [] };
  }
}

function saveDB(data) {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); } catch(e) {}
}

function defaultStats() {
  return {
    '1v1': { wins: 0, losses: 0, elo: 500 },
    '2v2': { wins: 0, losses: 0, elo: 500 },
    '3v3': { wins: 0, losses: 0, elo: 500 },
    '5v5': { wins: 0, losses: 0, elo: 500 }
  };
}

function getUserByPseudo(pseudo) {
  return loadDB().users.find(u => u.pseudo.toLowerCase() === pseudo.toLowerCase());
}

function getUserById(id) {
  return loadDB().users.find(u => u.id === id);
}

function generateReferralCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function createUser(pseudo, hashedPassword, ip, referralCode) {
  const db = loadDB();
  // Generate unique referral code for new user
  let myCode;
  do { myCode = generateReferralCode(); } while (db.users.find(u => u.referralCode === myCode));

  const user = {
    id: Date.now().toString(),
    pseudo,
    password: hashedPassword,
    stats: defaultStats(),
    avatar: null,
    ip: ip || null,
    createdAt: new Date().toISOString(),
    referralCode: myCode,
    referredBy: null,
    referrals: []  // [{userId, pseudo, avatar, date, gamesPlayed}]
  };

  // Apply referral if valid code provided
  if (referralCode) {
    const referrer = db.users.find(u => u.referralCode === referralCode.toUpperCase());
    if (referrer && referrer.id !== user.id) {
      user.referredBy = referrer.id;
      if (!referrer.referrals) referrer.referrals = [];
      referrer.referrals.push({ userId: user.id, pseudo: user.pseudo, avatar: null, date: user.createdAt, gamesPlayed: 0 });
    }
  }

  db.users.push(user);
  saveDB(db);
  return user;
}

function updateAvatar(id, avatarBase64) {
  const db = loadDB();
  const user = db.users.find(u => u.id === id);
  if (user) { user.avatar = avatarBase64; saveDB(db); }
  return user;
}

function updateBanner(id, bannerBase64) {
  const db = loadDB();
  const user = db.users.find(u => u.id === id);
  if (user) { user.banner = bannerBase64; saveDB(db); }
  return user;
}

function getIpAccounts(ip) {
  if (!ip) return [];
  return loadDB().users.filter(u => u.ip === ip);
}

function computeEloChange(myElo, opponentAvgElo, won) {
  // Base: +15 win, -10 lose à ELO égal
  // Gagner contre plus fort = plus de gain. Perdre contre plus fort = moins de perte.
  // Gagner contre plus faible = moins de gain. Perdre contre plus faible = plus de perte.
  const diff = myElo - opponentAvgElo; // positif = je suis favori
  const steps = Math.floor(Math.abs(diff) / 50);
  if (won) {
    let base = 15;
    if (diff > 0) base = Math.max(4, base - steps * 3);  // favori gagne: moins
    else          base = Math.min(28, base + steps * 3); // underdog gagne: plus
    return base;
  } else {
    let base = 10;
    if (diff > 0) base = Math.max(3, base - steps * 2);  // favori perd: perd moins
    else          base = Math.min(22, base + steps * 2); // underdog perd: perd plus
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
      if (won) user.stats[mode].wins++;
      else user.stats[mode].losses++;
    }
    if (!user.matchHistory) user.matchHistory = [];
    user.matchHistory.unshift({
      date: new Date().toISOString(),
      mode,
      result: draw ? 'draw' : (won ? 'win' : 'loss'),
      eloChange,
      eloBefore,
      eloAfter: user.stats[mode].elo,
      opponents: (opponents || []).map(p => p.pseudo),
      teammates: (teammates || []).map(p => p.pseudo).filter(p => p !== user.pseudo)
    });
    if (user.matchHistory.length > 20) user.matchHistory = user.matchHistory.slice(0, 20);
    saveDB(db);
  }
  return user;
}

function banUser(id, reason) {
  const db = loadDB();
  const user = db.users.find(u => u.id === id);
  if (user) { user.banned = true; user.banReason = reason || ''; saveDB(db); }
  return user;
}

function unbanUser(id) {
  const db = loadDB();
  const user = db.users.find(u => u.id === id);
  if (user) { user.banned = false; user.banReason = ''; saveDB(db); }
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
      user.muteUntil = null; // permanent
      user.muteDuration = null;
    }
    saveDB(db);
  }
  return user;
}

function unmuteUser(id) {
  const db = loadDB();
  const user = db.users.find(u => u.id === id);
  if (user) { user.muted = false; user.muteUntil = null; user.muteDuration = null; saveDB(db); }
  return user;
}

function checkReferralReward(userId) {
  // Called after a game — check if this user is a referral and update their game count
  // If parrain now has 3 qualified referrals (3+ games each), give 1 week premium
  const db = loadDB();
  const user = db.users.find(u => u.id === userId);
  if (!user || !user.referredBy) return;

  const referrer = db.users.find(u => u.id === user.referredBy);
  if (!referrer) return;

  // Update game count for this referral entry
  const totalGames = Object.values(user.stats || {}).reduce((s, m) => s + (m.wins || 0) + (m.losses || 0), 0);
  if (!referrer.referrals) referrer.referrals = [];
  const entry = referrer.referrals.find(r => r.userId === userId);
  if (entry) {
    entry.gamesPlayed = totalGames;
    entry.avatar = user.avatar || null; // keep avatar updated
  }

  // Check if referrer now qualifies: 3 referrals with 3+ games each
  const qualified = referrer.referrals.filter(r => r.gamesPlayed >= 3).length;
  if (qualified >= 3 && !referrer.referralRewardGiven) {
    referrer.referralRewardGiven = true;
    // Give 7 days premium (1 week)
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    if (!referrer.isPremium || !referrer.premiumUntil || referrer.premiumUntil < Date.now()) {
      referrer.isPremium = true;
      referrer.premiumUntil = Date.now() + weekMs;
    } else {
      referrer.premiumUntil += weekMs; // extend if already premium
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
  // Anti-spam: max 2 open tickets per user
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
  // Auto-delete closed tickets older than 5 minutes
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
      return { id: u.id, pseudo: u.pseudo, elo: s.elo, wins: s.wins, losses: s.losses, avatar: u.avatar || null, banned: !!u.banned, muted: !!u.muted, stats: u.stats, isPremium: !!u.isPremium, premiumUntil: u.premiumUntil || null };
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
  return true;
}

function revokePremium(userId) {
  const db = loadDB();
  const user = db.users.find(u => u.id === userId);
  if (!user) return false;
  user.isPremium = false;
  user.premiumUntil = null;
  saveDB(db);
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

// ── ADMIN LOGS ──
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
  // Keep last 500 logs
  if (db.adminLogs.length > 500) db.adminLogs = db.adminLogs.slice(0, 500);
  saveDB(db);
}

function getAdminLogs() {
  const db = loadDB();
  return db.adminLogs || [];
}

// ── SEASONS ──
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
  if (new Date(db.season.endsAt) > new Date()) return; // not yet

  // Archive current season leaderboard
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

  // Soft reset: new ELO = 500 + (oldElo - 500) * 0.5 (keeps some progress)
  db.users.forEach(u => {
    ['1v1','2v2','3v3','5v5'].forEach(mode => {
      if (!u.stats?.[mode]) return;
      const old = u.stats[mode].elo || 500;
      u.stats[mode].elo = Math.round(500 + (old - 500) * 0.5);
    });
  });

  // Start new season
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

module.exports = { getUserByPseudo, getUserById, createUser, checkReferralReward, updateUserElo, computeEloChange, getLeaderboard, updateAvatar, updateBanner, getIpAccounts, defaultStats, banUser, unbanUser, muteUser, unmuteUser, checkMuteExpiry, createTicket, getTickets, replyTicket, closeTicket, setPremium, revokePremium, checkPremiumExpiry, loadDB, saveDB, addAdminLog, getAdminLogs, getCurrentSeason, checkSeasonReset, getSeasonArchives };