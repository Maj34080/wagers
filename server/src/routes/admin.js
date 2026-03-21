const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const adminAuth = require('../middleware/adminAuth');

const router = express.Router();

// All admin routes require admin auth
router.use(adminAuth);

// GET /api/admin/stats
router.get('/stats', (req, res) => {
  try {
    const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
    const wagerCount = db.prepare('SELECT COUNT(*) as c FROM wagers').get().c;
    const activeWagers = db.prepare("SELECT COUNT(*) as c FROM wagers WHERE status IN ('open','ready','live')").get().c;
    const totalDistributed = db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM transactions WHERE type='wager_win'").get().t;
    const totalDeposited = db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM transactions WHERE type='deposit'").get().t;
    const recentUsers = db.prepare('SELECT id,username,email,balance,created_at,is_admin,discord_username,discord_avatar FROM users ORDER BY created_at DESC LIMIT 5').all();
    res.json({ userCount, wagerCount, activeWagers, totalDistributed, totalDeposited, recentUsers });
  } catch (err) {
    res.status(500).json({ error: 'Erreur stats admin' });
  }
});

// GET /api/admin/users
router.get('/users', (req, res) => {
  try {
    const { search, page = 1, limit = 20 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    let query = 'SELECT id,username,email,balance,created_at,is_admin,avatar_color,discord_id,discord_username,discord_avatar FROM users';
    const params = [];
    if (search) {
      query += ' WHERE username LIKE ? OR email LIKE ?';
      params.push(`%${search}%`, `%${search}%`);
    }
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), offset);
    const users = db.prepare(query).all(...params);
    const total = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
    res.json({ users, total });
  } catch (err) {
    res.status(500).json({ error: 'Erreur chargement utilisateurs' });
  }
});

// PATCH /api/admin/users/:id
router.patch('/users/:id', (req, res) => {
  try {
    const { balance, is_admin } = req.body;
    const updates = [];
    const params = [];
    if (balance !== undefined) { updates.push('balance = ?'); params.push(Number(balance)); }
    if (is_admin !== undefined) { updates.push('is_admin = ?'); params.push(is_admin ? 1 : 0); }
    if (updates.length === 0) return res.status(400).json({ error: 'Rien à modifier' });
    params.push(req.params.id);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    const user = db.prepare('SELECT id,username,email,balance,is_admin,avatar_color,discord_username FROM users WHERE id = ?').get(req.params.id);
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: 'Erreur modification utilisateur' });
  }
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', (req, res) => {
  try {
    // Can't delete yourself
    if (req.params.id === req.userId) return res.status(400).json({ error: 'Impossible de se supprimer soi-même' });
    db.prepare('DELETE FROM wager_players WHERE user_id = ?').run(req.params.id);
    db.prepare('DELETE FROM transactions WHERE user_id = ?').run(req.params.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur suppression utilisateur' });
  }
});

// GET /api/admin/wagers
router.get('/wagers', (req, res) => {
  try {
    const { status } = req.query;
    let query = `
      SELECT w.*, t1.name as team1_name, t2.name as team2_name,
        u1.username as team1_captain, u2.username as team2_captain,
        (SELECT COUNT(*) FROM wager_players wp WHERE wp.wager_id = w.id) as player_count
      FROM wagers w
      LEFT JOIN teams t1 ON w.team1_id = t1.id
      LEFT JOIN teams t2 ON w.team2_id = t2.id
      LEFT JOIN users u1 ON t1.captain_id = u1.id
      LEFT JOIN users u2 ON t2.captain_id = u2.id
    `;
    const params = [];
    if (status && status !== 'all') { query += ' WHERE w.status = ?'; params.push(status); }
    query += ' ORDER BY w.created_at DESC LIMIT 100';
    const wagers = db.prepare(query).all(...params);
    res.json({ wagers });
  } catch (err) {
    res.status(500).json({ error: 'Erreur chargement wagers' });
  }
});

// POST /api/admin/wagers/:id/cancel
router.post('/wagers/:id/cancel', (req, res) => {
  try {
    const wagerId = req.params.id;
    const wager = db.prepare('SELECT * FROM wagers WHERE id = ?').get(wagerId);
    if (!wager) return res.status(404).json({ error: 'Wager non trouvé' });
    if (wager.status === 'completed' || wager.status === 'cancelled') {
      return res.status(400).json({ error: 'Wager déjà terminé ou annulé' });
    }
    // Refund all players
    const players = db.prepare('SELECT * FROM wager_players WHERE wager_id = ?').all(wagerId);
    for (const p of players) {
      db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(wager.buy_in_per_player, p.user_id);
      db.prepare("INSERT INTO transactions (id, user_id, amount, type, reference_id) VALUES (?, ?, ?, 'deposit', ?)").run(uuidv4(), p.user_id, wager.buy_in_per_player, wagerId);
    }
    db.prepare("UPDATE wagers SET status = 'cancelled', completed_at = datetime('now') WHERE id = ?").run(wagerId);
    res.json({ success: true, refunded: players.length });
  } catch (err) {
    res.status(500).json({ error: 'Erreur annulation' });
  }
});

// POST /api/admin/wagers/:id/force-complete
router.post('/wagers/:id/force-complete', (req, res) => {
  try {
    const { winnerTeamId } = req.body;
    const wagerId = req.params.id;
    const wager = db.prepare('SELECT * FROM wagers WHERE id = ?').get(wagerId);
    if (!wager) return res.status(404).json({ error: 'Wager non trouvé' });
    if (wager.status === 'completed') return res.status(400).json({ error: 'Wager déjà terminé' });
    if (!winnerTeamId) return res.status(400).json({ error: 'Équipe gagnante requise' });

    db.prepare("UPDATE wagers SET status='completed', winner_team_id=?, completed_at=datetime('now') WHERE id=?").run(winnerTeamId, wagerId);
    db.prepare("UPDATE matches SET status='completed' WHERE wager_id=? AND status!='completed'").run(wagerId);

    const winners = db.prepare('SELECT * FROM wager_players WHERE wager_id=? AND team_id=?').all(wagerId, winnerTeamId);
    const perPlayer = wager.total_pot / Math.max(winners.length, 1);
    for (const w of winners) {
      db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(perPlayer, w.user_id);
      db.prepare("INSERT INTO transactions (id,user_id,amount,type,reference_id) VALUES (?,?,?,'wager_win',?)").run(uuidv4(), w.user_id, perPlayer, wagerId);
    }
    res.json({ success: true, winnersCount: winners.length, perPlayer });
  } catch (err) {
    res.status(500).json({ error: 'Erreur force-complete' });
  }
});

// GET /api/admin/transactions
router.get('/transactions', (req, res) => {
  try {
    const transactions = db.prepare(`
      SELECT t.*, u.username FROM transactions t
      LEFT JOIN users u ON t.user_id = u.id
      ORDER BY t.created_at DESC LIMIT 100
    `).all();
    res.json({ transactions });
  } catch (err) {
    res.status(500).json({ error: 'Erreur transactions' });
  }
});

module.exports = router;
