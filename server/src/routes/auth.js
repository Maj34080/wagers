const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

const AVATAR_COLORS = [
  '#7c3aed', '#06b6d4', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#0ea5e9', '#14b8a6', '#f97316', '#ec4899'
];

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Tous les champs sont requis' });
    }

    if (username.length < 3 || username.length > 20) {
      return res.status(400).json({ error: 'Le pseudo doit contenir entre 3 et 20 caractères' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Email invalide' });
    }

    const existingUser = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email);
    if (existingUser) {
      return res.status(409).json({ error: 'Ce pseudo ou email est déjà utilisé' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const userId = uuidv4();
    const avatarColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];

    db.prepare(`
      INSERT INTO users (id, username, email, password_hash, balance, avatar_color)
      VALUES (?, ?, ?, ?, 100.00, ?)
    `).run(userId, username, email, passwordHash, avatarColor);

    // Record initial deposit transaction
    db.prepare(`
      INSERT INTO transactions (id, user_id, amount, type, reference_id)
      VALUES (?, ?, ?, 'deposit', ?)
    `).run(uuidv4(), userId, 100.00, 'welcome_bonus');

    const token = jwt.sign(
      { userId, username },
      process.env.JWT_SECRET || 'supersecretkey123',
      { expiresIn: '7d' }
    );

    const user = db.prepare('SELECT id, username, email, balance, created_at, avatar_color FROM users WHERE id = ?').get(userId);

    res.status(201).json({ token, user });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Erreur serveur lors de l\'inscription' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Pseudo et mot de passe requis' });
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(username, username);

    if (!user) {
      return res.status(401).json({ error: 'Identifiants incorrects' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Identifiants incorrects' });
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username },
      process.env.JWT_SECRET || 'supersecretkey123',
      { expiresIn: '7d' }
    );

    const { password_hash, ...userWithoutPassword } = user;

    res.json({ token, user: userWithoutPassword });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Erreur serveur lors de la connexion' });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, (req, res) => {
  try {
    const user = db.prepare('SELECT id, username, email, balance, created_at, avatar_color, discord_id, discord_username, discord_avatar, is_admin FROM users WHERE id = ?').get(req.userId);

    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    res.json({ user });
  } catch (err) {
    console.error('Me error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

const axios = require('axios');

// GET /api/auth/discord — redirect to Discord OAuth
router.get('/discord', (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: process.env.DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify email'
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

// GET /api/auth/discord/callback — handle Discord OAuth callback
router.get('/discord/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect(`${process.env.CLIENT_URL}/login?error=no_code`);

  try {
    // Exchange code for token
    const tokenRes = await axios.post('https://discord.com/api/oauth2/token',
      new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.DISCORD_REDIRECT_URI,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token } = tokenRes.data;

    // Get Discord user info
    const userRes = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${access_token}` }
    });

    const discord = userRes.data;
    const { id: discordId, username: discordUsername, avatar: discordAvatar, email: discordEmail } = discord;

    // Find or create user
    let user = db.prepare('SELECT * FROM users WHERE discord_id = ?').get(discordId);

    if (!user) {
      const userId = uuidv4();
      const avatarColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];

      db.prepare(`
        INSERT INTO users (id, username, email, password_hash, balance, avatar_color, discord_id, discord_username, discord_avatar)
        VALUES (?, ?, ?, ?, 100.00, ?, ?, ?, ?)
      `).run(userId, discordUsername, discordEmail || `${discordId}@discord.local`, 'discord_oauth', avatarColor, discordId, discordUsername, discordAvatar);

      db.prepare(`
        INSERT INTO transactions (id, user_id, amount, type, reference_id)
        VALUES (?, ?, 100.00, 'deposit', 'welcome_bonus')
      `).run(uuidv4(), userId);

      user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    } else {
      // Update Discord info
      db.prepare(`UPDATE users SET discord_username = ?, discord_avatar = ? WHERE discord_id = ?`).run(discordUsername, discordAvatar, discordId);
      user = db.prepare('SELECT * FROM users WHERE discord_id = ?').get(discordId);
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username },
      process.env.JWT_SECRET || 'supersecretkey123',
      { expiresIn: '7d' }
    );

    const { password_hash, ...safeUser } = user;
    const userB64 = Buffer.from(JSON.stringify(safeUser)).toString('base64');

    res.redirect(`${process.env.CLIENT_URL}/auth/discord/callback?token=${token}&user=${userB64}`);
  } catch (err) {
    console.error('Discord OAuth error:', err.response?.data || err.message);
    res.redirect(`${process.env.CLIENT_URL}/login?error=discord_failed`);
  }
});

module.exports = router;
