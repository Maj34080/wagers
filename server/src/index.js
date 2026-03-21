require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const db = require('./database');
const authRoutes = require('./routes/auth');
const wagerRoutes = require('./routes/wagers');
const userRoutes = require('./routes/users');
const walletRoutes = require('./routes/wallet');
const adminRoutes = require('./routes/admin');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: ['http://localhost:5173', 'http://localhost:3000'],
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Middleware
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true
}));
app.use(express.json());

// Attach io to requests so routes can emit events
app.use((req, res, next) => {
  req.io = io;
  next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/wagers', wagerRoutes);
app.use('/api/users', userRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/admin', adminRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Global stats endpoint
app.get('/api/stats', (req, res) => {
  try {
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const wagerCount = db.prepare('SELECT COUNT(*) as count FROM wagers').get().count;
    const totalDistributed = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'wager_win'
    `).get().total;

    res.json({
      users: userCount,
      wagers: wagerCount,
      totalDistributed
    });
  } catch (err) {
    res.status(500).json({ error: 'Erreur stats' });
  }
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  socket.on('join_wager', (wagerId) => {
    socket.join(`wager_${wagerId}`);
    console.log(`Socket ${socket.id} joined wager room: ${wagerId}`);
  });

  socket.on('leave_wager', (wagerId) => {
    socket.leave(`wager_${wagerId}`);
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`\n🚀 FiveM Wagers Server running on port ${PORT}`);
  console.log(`📊 API: http://localhost:${PORT}/api`);
  console.log(`🔌 Socket.io ready\n`);
});
