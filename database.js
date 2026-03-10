const fs = require('fs');
const path = require('path');

const DB_FILE = process.env.NODE_ENV === 'production' 
  ? '/tmp/db.json' 
  : path.join(__dirname, 'db.json');

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    const initial = { users: [], rooms: [] };
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function saveDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function getUsers() {
  return loadDB().users;
}

function getUserByPseudo(pseudo) {
  return loadDB().users.find(u => u.pseudo.toLowerCase() === pseudo.toLowerCase());
}

function getUserById(id) {
  return loadDB().users.find(u => u.id === id);
}

function createUser(pseudo, hashedPassword) {
  const db = loadDB();
  const user = {
    id: Date.now().toString(),
    pseudo,
    password: hashedPassword,
    elo: 500,
    wins: 0,
    losses: 0,
    createdAt: new Date().toISOString()
  };
  db.users.push(user);
  saveDB(db);
  return user;
}

function updateUserElo(id, eloChange, won) {
  const db = loadDB();
  const user = db.users.find(u => u.id === id);
  if (user) {
    user.elo = Math.max(0, user.elo + eloChange);
    if (won) user.wins++;
    else user.losses++;
    saveDB(db);
  }
  return user;
}

function getLeaderboard() {
  const db = loadDB();
  return db.users
    .map(u => ({ pseudo: u.pseudo, elo: u.elo, wins: u.wins, losses: u.losses }))
    .sort((a, b) => b.elo - a.elo)
    .slice(0, 20);
}

module.exports = {
  getUsers, getUserByPseudo, getUserById,
  createUser, updateUserElo, getLeaderboard
};