const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// GET /api/wallet/balance
router.get('/balance', authMiddleware, (req, res) => {
  try {
    const user = db.prepare('SELECT id, username, balance FROM users WHERE id = ?').get(req.userId);

    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    res.json({ balance: user.balance });
  } catch (err) {
    console.error('Balance error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/wallet/transactions
router.get('/transactions', authMiddleware, (req, res) => {
  try {
    const transactions = db.prepare(`
      SELECT * FROM transactions
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 50
    `).all(req.userId);

    res.json({ transactions });
  } catch (err) {
    console.error('Transactions error:', err);
    res.status(500).json({ error: 'Erreur lors du chargement des transactions' });
  }
});

// POST /api/wallet/deposit - mock deposit
router.post('/deposit', authMiddleware, (req, res) => {
  try {
    const { amount } = req.body;

    const validAmounts = [5, 10, 20, 50, 100];
    if (!validAmounts.includes(Number(amount))) {
      return res.status(400).json({ error: 'Montant invalide. Choisissez parmi: 5, 10, 20, 50, 100' });
    }

    db.prepare(`UPDATE users SET balance = balance + ? WHERE id = ?`).run(amount, req.userId);

    const transactionId = uuidv4();
    db.prepare(`
      INSERT INTO transactions (id, user_id, amount, type, reference_id)
      VALUES (?, ?, ?, 'deposit', ?)
    `).run(transactionId, req.userId, amount, `mock_deposit_${Date.now()}`);

    const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(req.userId);

    res.json({
      message: `Dépôt de €${amount.toFixed ? amount.toFixed(2) : amount} effectué avec succès`,
      balance: user.balance,
      transaction: {
        id: transactionId,
        amount,
        type: 'deposit'
      }
    });
  } catch (err) {
    console.error('Deposit error:', err);
    res.status(500).json({ error: 'Erreur lors du dépôt' });
  }
});

// POST /api/wallet/withdraw - mock withdraw
router.post('/withdraw', authMiddleware, (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Montant invalide' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);

    if (user.balance < amount) {
      return res.status(400).json({ error: 'Solde insuffisant' });
    }

    if (amount < 5) {
      return res.status(400).json({ error: 'Montant minimum de retrait: €5' });
    }

    db.prepare(`UPDATE users SET balance = balance - ? WHERE id = ?`).run(amount, req.userId);

    const transactionId = uuidv4();
    db.prepare(`
      INSERT INTO transactions (id, user_id, amount, type, reference_id)
      VALUES (?, ?, ?, 'withdraw', ?)
    `).run(transactionId, req.userId, -amount, `mock_withdraw_${Date.now()}`);

    const updatedUser = db.prepare('SELECT balance FROM users WHERE id = ?').get(req.userId);

    res.json({
      message: `Retrait de €${Number(amount).toFixed(2)} effectué avec succès`,
      balance: updatedUser.balance,
      transaction: {
        id: transactionId,
        amount: -amount,
        type: 'withdraw'
      }
    });
  } catch (err) {
    console.error('Withdraw error:', err);
    res.status(500).json({ error: 'Erreur lors du retrait' });
  }
});

module.exports = router;
