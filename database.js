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

function createUser(pseudo, hashedPassword, ip) {
  const db = loadDB();
  const user = {
    id: Date.now().toString(),
    pseudo,
    password: hashedPassword,
    stats: defaultStats(),
    avatar: null,
    ip: ip || null,
    createdAt: new Date().toISOString()
  };
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

function getIpAccounts(ip) {
  if (!ip) return [];
  return loadDB().users.filter(u => u.ip === ip);
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

function muteUser(id) {
  const db = loadDB();
  const user = db.users.find(u => u.id === id);
  if (user) { user.muted = true; saveDB(db); }
  return user;
}

function unmuteUser(id) {
  const db = loadDB();
  const user = db.users.find(u => u.id === id);
  if (user) { user.muted = false; saveDB(db); }
  return user;
}

function createTicket(userId, pseudo, subject, message) {
  const db = loadDB();
  if (!db.tickets) db.tickets = [];
  const ticket = {
    id: Date.now().toString(),
    userId, pseudo, subject, message,
    status: 'open', // open | closed
    createdAt: new Date().toISOString(),
    replies: []
  };
  db.tickets.push(ticket);
  saveDB(db);
  return ticket;
}

function getTickets() {
  const db = loadDB();
  return (db.tickets || []).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
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
  if (ticket) { ticket.status = 'closed'; saveDB(db); }
  return ticket;
}

function getLeaderboard(mode) {
  const db = loadDB();
  return db.users
    .filter(u => !u.banned)
    .map(u => {
      const s = u.stats?.[mode] || { wins: 0, losses: 0, elo: 500 };
      return { id: u.id, pseudo: u.pseudo, elo: s.elo, wins: s.wins, losses: s.losses, avatar: u.avatar || null, banned: !!u.banned, muted: !!u.muted, stats: u.stats };
    })
    .sort((a, b) => b.elo - a.elo)
    .slice(0, 50);
}

module.exports = { getUserByPseudo, getUserById, createUser, updateUserElo, getLeaderboard, updateAvatar, getIpAccounts, defaultStats, banUser, unbanUser, muteUser, unmuteUser, createTicket, getTickets, replyTicket, closeTicket };