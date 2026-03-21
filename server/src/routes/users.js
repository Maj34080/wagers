const express = require('express');
const db = require('../database');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// GET /api/users/leaderboard
router.get('/leaderboard', authMiddleware, (req, res) => {
  try {
    const players = db.prepare(`
      SELECT
        u.id,
        u.username,
        u.avatar_color,
        u.balance,
        COUNT(DISTINCT wp.wager_id) as wagers_played,
        SUM(CASE WHEN w.winner_team_id = wp.team_id THEN 1 ELSE 0 END) as wagers_won,
        COUNT(DISTINCT wp.wager_id) - SUM(CASE WHEN w.winner_team_id = wp.team_id THEN 1 ELSE 0 END) as wagers_lost,
        COALESCE(SUM(CASE WHEN t.type = 'wager_win' THEN t.amount ELSE 0 END), 0) as total_earned
      FROM users u
      LEFT JOIN wager_players wp ON u.id = wp.user_id
      LEFT JOIN wagers w ON wp.wager_id = w.id AND w.status = 'completed'
      LEFT JOIN transactions t ON u.id = t.user_id AND t.type = 'wager_win'
      GROUP BY u.id
      ORDER BY wagers_won DESC, total_earned DESC
      LIMIT 50
    `).all();

    const leaderboard = players.map((p, index) => ({
      ...p,
      rank: index + 1,
      win_rate: p.wagers_played > 0 ? Math.round((p.wagers_won / p.wagers_played) * 100) : 0
    }));

    res.json({ leaderboard });
  } catch (err) {
    console.error('Leaderboard error:', err);
    res.status(500).json({ error: 'Erreur lors du chargement du classement' });
  }
});

// GET /api/users/profile
router.get('/profile', authMiddleware, (req, res) => {
  try {
    const user = db.prepare('SELECT id, username, email, balance, created_at, avatar_color FROM users WHERE id = ?').get(req.userId);

    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    const stats = db.prepare(`
      SELECT
        COUNT(DISTINCT wp.wager_id) as wagers_played,
        SUM(CASE WHEN w.winner_team_id = wp.team_id THEN 1 ELSE 0 END) as wagers_won,
        COUNT(DISTINCT wp.wager_id) - SUM(CASE WHEN w.winner_team_id = wp.team_id THEN 1 ELSE 0 END) as wagers_lost,
        COALESCE(SUM(CASE WHEN t.type = 'wager_win' THEN t.amount ELSE 0 END), 0) as total_earned
      FROM wager_players wp
      LEFT JOIN wagers w ON wp.wager_id = w.id AND w.status = 'completed'
      LEFT JOIN transactions t ON ? = t.user_id AND t.type = 'wager_win' AND t.reference_id = w.id
      WHERE wp.user_id = ?
    `).get(req.userId, req.userId);

    const activeWagers = db.prepare(`
      SELECT COUNT(*) as count
      FROM wager_players wp
      JOIN wagers w ON wp.wager_id = w.id
      WHERE wp.user_id = ? AND w.status IN ('open', 'ready', 'live')
    `).get(req.userId);

    res.json({
      user,
      stats: {
        ...stats,
        wagers_won: stats.wagers_won || 0,
        wagers_lost: stats.wagers_lost || 0,
        win_rate: stats.wagers_played > 0 ? Math.round(((stats.wagers_won || 0) / stats.wagers_played) * 100) : 0,
        active_wagers: activeWagers.count
      }
    });
  } catch (err) {
    console.error('Profile error:', err);
    res.status(500).json({ error: 'Erreur lors du chargement du profil' });
  }
});

// GET /api/users/:id - get user by id
router.get('/:id', authMiddleware, (req, res) => {
  try {
    const user = db.prepare('SELECT id, username, balance, created_at, avatar_color FROM users WHERE id = ?').get(req.params.id);

    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    res.json({ user });
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
