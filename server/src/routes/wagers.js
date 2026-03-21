const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// GET /api/wagers - list all wagers
router.get('/', authMiddleware, (req, res) => {
  try {
    const { status } = req.query;

    let query = `
      SELECT
        w.*,
        t1.name as team1_name,
        t2.name as team2_name,
        u1.username as team1_captain,
        u2.username as team2_captain,
        (SELECT COUNT(*) FROM wager_players wp WHERE wp.wager_id = w.id) as player_count
      FROM wagers w
      LEFT JOIN teams t1 ON w.team1_id = t1.id
      LEFT JOIN teams t2 ON w.team2_id = t2.id
      LEFT JOIN users u1 ON t1.captain_id = u1.id
      LEFT JOIN users u2 ON t2.captain_id = u2.id
    `;

    if (status && status !== 'all') {
      query += ` WHERE w.status = ?`;
      query += ` ORDER BY w.created_at DESC`;
      const wagers = db.prepare(query).all(status);
      return res.json({ wagers });
    }

    query += ` ORDER BY w.created_at DESC`;
    const wagers = db.prepare(query).all();
    res.json({ wagers });
  } catch (err) {
    console.error('Get wagers error:', err);
    res.status(500).json({ error: 'Erreur lors du chargement des wagers' });
  }
});

// GET /api/wagers/:id - get single wager
router.get('/:id', authMiddleware, (req, res) => {
  try {
    const wager = db.prepare(`
      SELECT
        w.*,
        t1.name as team1_name,
        t2.name as team2_name,
        u1.username as team1_captain,
        u2.username as team2_captain
      FROM wagers w
      LEFT JOIN teams t1 ON w.team1_id = t1.id
      LEFT JOIN teams t2 ON w.team2_id = t2.id
      LEFT JOIN users u1 ON t1.captain_id = u1.id
      LEFT JOIN users u2 ON t2.captain_id = u2.id
      WHERE w.id = ?
    `).get(req.params.id);

    if (!wager) {
      return res.status(404).json({ error: 'Wager non trouvé' });
    }

    // Get team1 players
    const team1Players = db.prepare(`
      SELECT u.id, u.username, u.avatar_color, wp.paid
      FROM wager_players wp
      JOIN users u ON wp.user_id = u.id
      WHERE wp.wager_id = ? AND wp.team_id = ?
    `).all(req.params.id, wager.team1_id);

    // Get team2 players
    const team2Players = db.prepare(`
      SELECT u.id, u.username, u.avatar_color, wp.paid
      FROM wager_players wp
      JOIN users u ON wp.user_id = u.id
      WHERE wp.wager_id = ? AND wp.team_id = ?
    `).all(req.params.id, wager.team2_id);

    // Get matches
    const matches = db.prepare(`
      SELECT * FROM matches WHERE wager_id = ? ORDER BY match_number
    `).all(req.params.id);

    res.json({
      wager,
      team1Players,
      team2Players,
      matches
    });
  } catch (err) {
    console.error('Get wager error:', err);
    res.status(500).json({ error: 'Erreur lors du chargement du wager' });
  }
});

// POST /api/wagers - create wager
router.post('/', authMiddleware, (req, res) => {
  try {
    const { teamName, buyIn, mapName, gameMode } = req.body;

    if (!teamName || !buyIn) {
      return res.status(400).json({ error: 'Nom d\'équipe et mise obligatoires' });
    }

    const validBuyIns = [1, 2, 5, 10];
    if (!validBuyIns.includes(Number(buyIn))) {
      return res.status(400).json({ error: 'Mise invalide' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
    if (user.balance < buyIn) {
      return res.status(400).json({ error: 'Solde insuffisant' });
    }

    // Create team
    const teamId = uuidv4();
    db.prepare(`
      INSERT INTO teams (id, name, captain_id) VALUES (?, ?, ?)
    `).run(teamId, teamName, req.userId);

    // Add captain to team_members
    db.prepare(`INSERT INTO team_members (team_id, user_id) VALUES (?, ?)`).run(teamId, req.userId);

    // Create wager
    const wagerId = uuidv4();
    db.prepare(`
      INSERT INTO wagers (id, team1_id, buy_in_per_player, game_mode, map_name)
      VALUES (?, ?, ?, ?, ?)
    `).run(wagerId, teamId, buyIn, gameMode || 'CvC Standard', mapName || 'Los Santos');

    // Deduct buy-in from user balance
    db.prepare(`UPDATE users SET balance = balance - ? WHERE id = ?`).run(buyIn, req.userId);

    // Add wager player entry
    db.prepare(`
      INSERT INTO wager_players (wager_id, user_id, team_id, paid) VALUES (?, ?, ?, 1)
    `).run(wagerId, req.userId, teamId);

    // Update total pot
    db.prepare(`UPDATE wagers SET total_pot = total_pot + ? WHERE id = ?`).run(buyIn, wagerId);

    // Record transaction
    db.prepare(`
      INSERT INTO transactions (id, user_id, amount, type, reference_id)
      VALUES (?, ?, ?, 'wager_entry', ?)
    `).run(uuidv4(), req.userId, -buyIn, wagerId);

    // Create BO3 matches
    for (let i = 1; i <= 3; i++) {
      db.prepare(`
        INSERT INTO matches (id, wager_id, match_number) VALUES (?, ?, ?)
      `).run(uuidv4(), wagerId, i);
    }

    const newWager = db.prepare(`
      SELECT w.*, t1.name as team1_name, u1.username as team1_captain
      FROM wagers w
      LEFT JOIN teams t1 ON w.team1_id = t1.id
      LEFT JOIN users u1 ON t1.captain_id = u1.id
      WHERE w.id = ?
    `).get(wagerId);

    // Emit socket event
    if (req.io) {
      req.io.emit('wager_created', newWager);
    }

    res.status(201).json({ wager: newWager });
  } catch (err) {
    console.error('Create wager error:', err);
    res.status(500).json({ error: 'Erreur lors de la création du wager' });
  }
});

// POST /api/wagers/:id/join - join wager
router.post('/:id/join', authMiddleware, (req, res) => {
  try {
    const { teamNumber, teamName } = req.body;
    const wagerId = req.params.id;

    const wager = db.prepare('SELECT * FROM wagers WHERE id = ?').get(wagerId);
    if (!wager) {
      return res.status(404).json({ error: 'Wager non trouvé' });
    }

    if (wager.status !== 'open') {
      return res.status(400).json({ error: 'Ce wager n\'est plus ouvert' });
    }

    // Check if user already in wager
    const existing = db.prepare('SELECT * FROM wager_players WHERE wager_id = ? AND user_id = ?').get(wagerId, req.userId);
    if (existing) {
      return res.status(400).json({ error: 'Vous êtes déjà dans ce wager' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
    if (user.balance < wager.buy_in_per_player) {
      return res.status(400).json({ error: 'Solde insuffisant' });
    }

    let teamId;

    if (teamNumber === 2 && !wager.team2_id) {
      // Create team 2
      teamId = uuidv4();
      db.prepare(`INSERT INTO teams (id, name, captain_id) VALUES (?, ?, ?)`).run(teamId, teamName || `Équipe 2`, req.userId);
      db.prepare(`INSERT INTO team_members (team_id, user_id) VALUES (?, ?)`).run(teamId, req.userId);
      db.prepare(`UPDATE wagers SET team2_id = ? WHERE id = ?`).run(teamId, wagerId);
    } else if (teamNumber === 1 && wager.team1_id) {
      teamId = wager.team1_id;
      db.prepare(`INSERT OR IGNORE INTO team_members (team_id, user_id) VALUES (?, ?)`).run(teamId, req.userId);
    } else if (teamNumber === 2 && wager.team2_id) {
      teamId = wager.team2_id;
      db.prepare(`INSERT OR IGNORE INTO team_members (team_id, user_id) VALUES (?, ?)`).run(teamId, req.userId);
    } else {
      return res.status(400).json({ error: 'Équipe invalide' });
    }

    // Deduct buy-in
    db.prepare(`UPDATE users SET balance = balance - ? WHERE id = ?`).run(wager.buy_in_per_player, req.userId);

    // Add wager player
    db.prepare(`
      INSERT INTO wager_players (wager_id, user_id, team_id, paid) VALUES (?, ?, ?, 1)
    `).run(wagerId, req.userId, teamId);

    // Update total pot
    db.prepare(`UPDATE wagers SET total_pot = total_pot + ? WHERE id = ?`).run(wager.buy_in_per_player, wagerId);

    // Record transaction
    db.prepare(`
      INSERT INTO transactions (id, user_id, amount, type, reference_id)
      VALUES (?, ?, ?, 'wager_entry', ?)
    `).run(uuidv4(), req.userId, -wager.buy_in_per_player, wagerId);

    // Check if wager is ready (both teams have players)
    const updatedWager = db.prepare('SELECT * FROM wagers WHERE id = ?').get(wagerId);
    if (updatedWager.team1_id && updatedWager.team2_id) {
      const t1Count = db.prepare('SELECT COUNT(*) as c FROM wager_players WHERE wager_id = ? AND team_id = ?').get(wagerId, updatedWager.team1_id).c;
      const t2Count = db.prepare('SELECT COUNT(*) as c FROM wager_players WHERE wager_id = ? AND team_id = ?').get(wagerId, updatedWager.team2_id).c;

      if (t1Count >= 1 && t2Count >= 1) {
        db.prepare(`UPDATE wagers SET status = 'ready' WHERE id = ?`).run(wagerId);
      }
    }

    const fullWager = db.prepare(`
      SELECT w.*, t1.name as team1_name, t2.name as team2_name
      FROM wagers w
      LEFT JOIN teams t1 ON w.team1_id = t1.id
      LEFT JOIN teams t2 ON w.team2_id = t2.id
      WHERE w.id = ?
    `).get(wagerId);

    if (req.io) {
      req.io.emit('wager_updated', fullWager);
      req.io.emit('user_joined', { wagerId, userId: req.userId, username: req.username });
    }

    res.json({ wager: fullWager });
  } catch (err) {
    console.error('Join wager error:', err);
    res.status(500).json({ error: 'Erreur lors de la participation au wager' });
  }
});

// POST /api/wagers/:id/start - start wager (go live)
router.post('/:id/start', authMiddleware, (req, res) => {
  try {
    const wagerId = req.params.id;
    const wager = db.prepare('SELECT * FROM wagers WHERE id = ?').get(wagerId);

    if (!wager) {
      return res.status(404).json({ error: 'Wager non trouvé' });
    }

    if (wager.status !== 'ready') {
      return res.status(400).json({ error: 'Le wager n\'est pas prêt à démarrer' });
    }

    // Check if user is captain of team1
    const team1 = db.prepare('SELECT * FROM teams WHERE id = ?').get(wager.team1_id);
    if (team1.captain_id !== req.userId) {
      return res.status(403).json({ error: 'Seul le capitaine peut démarrer le wager' });
    }

    db.prepare(`
      UPDATE wagers SET status = 'live', started_at = datetime('now') WHERE id = ?
    `).run(wagerId);

    // Start first match
    db.prepare(`
      UPDATE matches SET status = 'live', started_at = datetime('now')
      WHERE wager_id = ? AND match_number = 1
    `).run(wagerId);

    const updatedWager = db.prepare(`
      SELECT w.*, t1.name as team1_name, t2.name as team2_name
      FROM wagers w
      LEFT JOIN teams t1 ON w.team1_id = t1.id
      LEFT JOIN teams t2 ON w.team2_id = t2.id
      WHERE w.id = ?
    `).get(wagerId);

    if (req.io) {
      req.io.emit('wager_updated', updatedWager);
    }

    res.json({ wager: updatedWager });
  } catch (err) {
    console.error('Start wager error:', err);
    res.status(500).json({ error: 'Erreur lors du démarrage du wager' });
  }
});

// POST /api/wagers/:id/matches/:matchId/score - report match score
router.post('/:id/matches/:matchId/score', authMiddleware, (req, res) => {
  try {
    const { wagerId, matchId } = { wagerId: req.params.id, matchId: req.params.matchId };
    const { team1Score, team2Score } = req.body;

    const wager = db.prepare('SELECT * FROM wagers WHERE id = ?').get(wagerId);
    if (!wager) {
      return res.status(404).json({ error: 'Wager non trouvé' });
    }

    if (wager.status !== 'live') {
      return res.status(400).json({ error: 'Le wager n\'est pas en cours' });
    }

    // Update match score
    db.prepare(`
      UPDATE matches SET team1_score = ?, team2_score = ?, status = 'completed', completed_at = datetime('now')
      WHERE id = ? AND wager_id = ?
    `).run(team1Score, team2Score, matchId, wagerId);

    // Check BO3 winner
    const allMatches = db.prepare('SELECT * FROM matches WHERE wager_id = ? ORDER BY match_number').all(wagerId);
    const completedMatches = allMatches.filter(m => m.status === 'completed');

    let team1Wins = 0;
    let team2Wins = 0;

    for (const match of completedMatches) {
      if (match.team1_score > match.team2_score) team1Wins++;
      else if (match.team2_score > match.team1_score) team2Wins++;
    }

    // Check if someone won BO3 (2 wins) or all matches done
    let winnerTeamId = null;

    if (team1Wins >= 2 || (completedMatches.length === 3 && team1Wins > team2Wins)) {
      winnerTeamId = wager.team1_id;
    } else if (team2Wins >= 2 || (completedMatches.length === 3 && team2Wins > team1Wins)) {
      winnerTeamId = wager.team2_id;
    }

    if (winnerTeamId) {
      // Complete the wager
      db.prepare(`
        UPDATE wagers SET status = 'completed', winner_team_id = ?, completed_at = datetime('now')
        WHERE id = ?
      `).run(winnerTeamId, wagerId);

      // Mark remaining matches as completed
      db.prepare(`
        UPDATE matches SET status = 'completed' WHERE wager_id = ? AND status = 'pending'
      `).run(wagerId);

      // Distribute winnings to winners
      const winners = db.prepare(`
        SELECT * FROM wager_players WHERE wager_id = ? AND team_id = ?
      `).all(wagerId, winnerTeamId);

      const totalPot = wager.total_pot;
      const winnerCount = winners.length;
      const winningPerPlayer = totalPot / winnerCount;

      for (const winner of winners) {
        db.prepare(`UPDATE users SET balance = balance + ? WHERE id = ?`).run(winningPerPlayer, winner.user_id);
        db.prepare(`
          INSERT INTO transactions (id, user_id, amount, type, reference_id)
          VALUES (?, ?, ?, 'wager_win', ?)
        `).run(uuidv4(), winner.user_id, winningPerPlayer, wagerId);
      }

      if (req.io) {
        req.io.emit('wager_updated', { ...wager, status: 'completed', winner_team_id: winnerTeamId });
      }
    } else {
      // Start next match if available
      const nextMatch = allMatches.find(m => m.status === 'pending');
      if (nextMatch) {
        db.prepare(`
          UPDATE matches SET status = 'live', started_at = datetime('now') WHERE id = ?
        `).run(nextMatch.id);
      }
    }

    const updatedMatches = db.prepare('SELECT * FROM matches WHERE wager_id = ? ORDER BY match_number').all(wagerId);

    if (req.io) {
      req.io.emit('match_updated', { wagerId, matches: updatedMatches });
    }

    res.json({ matches: updatedMatches, team1Wins, team2Wins, winnerTeamId });
  } catch (err) {
    console.error('Score report error:', err);
    res.status(500).json({ error: 'Erreur lors du signalement du score' });
  }
});

module.exports = router;
