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

function updateUserElo(id, eloChange, won, mode) {
  const db = loadDB();
  const user = db.users.find(u => u.id === id);
  if (user) {
    if (!user.stats) user.stats = defaultStats();
    if (!user.stats[mode]) user.stats[mode] = { wins: 0, losses: 0, elo: 500 };
    user.stats[mode].elo = Math.max(0, user.stats[mode].elo + eloChange);
    if (won) user.stats[mode].wins++;
    else user.stats[mode].losses++;
    saveDB(db);
  }
  return user;
}

function getLeaderboard(mode) {
  const db = loadDB();
  return db.users
    .map(u => {
      const s = u.stats?.[mode] || { wins: 0, losses: 0, elo: 500 };
      return { pseudo: u.pseudo, elo: s.elo, wins: s.wins, losses: s.losses };
    })
    .sort((a, b) => b.elo - a.elo)
    .slice(0, 20);
}

module.exports = { getUserByPseudo, getUserById, createUser, updateUserElo, getLeaderboard, updateAvatar, getIpAccounts, defaultStats };