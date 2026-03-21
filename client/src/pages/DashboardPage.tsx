import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Sword, TrendingUp, TrendingDown, Calendar, Zap, Users, Target, BarChart3, ShoppingBag, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import api from '../lib/api'
import EloCard from '../components/EloCard'
import ActivityFeed from '../components/ActivityFeed'
import RankBadge from '../components/RankBadge'
import { Mode, MatchRecord } from '../types'
import { getRankFromElo, getWinRate } from '../utils/rank'

const MODES: Mode[] = ['1v1', '2v2', '3v3', '5v5']

interface CotdEntry {
  pseudo: string
  avatar: string | null
  gain: number
}

export default function DashboardPage() {
  const { user } = useAuth()
  const [cotd, setCotd] = useState<CotdEntry[]>([])
  const [onlinePlayers, setOnlinePlayers] = useState(0)
  const [graphMode, setGraphMode] = useState<Mode | null>(null)

  useEffect(() => {
    api.get('/api/cotd').then(res => setCotd(res.data.data || [])).catch(() => {})
    api.get('/api/stats').then(res => setOnlinePlayers(res.data.onlinePlayers || 0)).catch(() => {})
  }, [])

  if (!user) return null

  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
  const recentHistory = (user.matchHistory || []).slice(0, 5)

  // Global stats across all modes
  const totalWins = Object.values(user.stats || {}).reduce((a, s) => a + (s?.wins || 0), 0)
  const totalLosses = Object.values(user.stats || {}).reduce((a, s) => a + (s?.losses || 0), 0)
  const totalGames = totalWins + totalLosses
  const globalWR = getWinRate(totalWins, totalLosses)
  const bestElo = Math.max(...Object.values(user.stats || {}).map(s => s?.elo || 0), 500)
  const bestRank = getRankFromElo(bestElo)

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Welcome banner */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6 flex items-center justify-between flex-wrap gap-4"
      >
        <div>
          <h1 className="font-display font-bold text-3xl">
            Bienvenue, <span className="gradient-text">{user.pseudo}</span> 👋
          </h1>
          <p className="text-sm mt-1 capitalize flex items-center gap-2" style={{ color: 'rgba(255,255,255,0.4)' }}>
            <Calendar size={13} /> {today}
          </p>
        </div>
        <Link to="/app/ranked">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.97 }}
            className="btn-primary px-6 py-3"
          >
            <Sword size={16} /> Trouver une partie
          </motion.button>
        </Link>
      </motion.div>

      {/* Global stats strip */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6"
      >
        {[
          { label: 'Parties jouées', value: totalGames, icon: Target, color: '#6366f1' },
          { label: 'Victoires totales', value: totalWins, icon: TrendingUp, color: '#10b981' },
          { label: 'Win Rate global', value: `${globalWR}%`, icon: BarChart3, color: '#f59e0b' },
          { label: 'Joueurs en ligne', value: onlinePlayers, icon: Users, color: '#ff4655' },
        ].map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 + i * 0.05 }}
            className="glass-card p-4 flex items-center gap-3"
          >
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: `${s.color}15`, border: `1px solid ${s.color}30` }}>
              <s.icon size={16} style={{ color: s.color }} />
            </div>
            <div>
              <p className="font-bold text-xl" style={{ color: s.color }}>{s.value}</p>
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{s.label}</p>
            </div>
          </motion.div>
        ))}
      </motion.div>

      {/* Best rank + quick actions */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="glass-card p-4 mb-6 flex items-center justify-between flex-wrap gap-3"
      >
        <div className="flex items-center gap-3">
          <div className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>Meilleur rang :</div>
          <RankBadge elo={bestElo} size="md" />
          <span className="text-xs" style={{ color: 'rgba(255,255,255,0.25)' }}>{bestElo} ELO</span>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/app/shop">
            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
              style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', color: '#f59e0b' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(245,158,11,0.15)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(245,158,11,0.08)')}>
              <ShoppingBag size={12} /> Boutique
            </button>
          </Link>
          <Link to="/app/leaderboard">
            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
              style={{ background: 'rgba(255,70,85,0.08)', border: '1px solid rgba(255,70,85,0.2)', color: '#ff4655' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,70,85,0.15)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,70,85,0.08)')}>
              <BarChart3 size={12} /> Classement
            </button>
          </Link>
        </div>
      </motion.div>

      {/* ELO Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {MODES.map((mode, i) => (
          <motion.div
            key={mode}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
          >
            <EloCard
              mode={mode}
              stats={user.stats[mode] || { wins: 0, losses: 0, elo: 500 }}
              onClick={() => setGraphMode(mode)}
            />
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent matches */}
        <div className="lg:col-span-2 space-y-4">
          <div className="glass-card p-5">
            <h2 className="font-display font-semibold text-lg mb-4 flex items-center gap-2">
              <Zap size={16} style={{ color: '#ff4655' }} /> Dernières parties
            </h2>
            {recentHistory.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>Aucune partie jouée</p>
                <Link to="/app/ranked" className="btn-primary mt-3 inline-flex px-4 py-2 text-sm">
                  Jouer maintenant
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                {recentHistory.map((match: MatchRecord, i: number) => (
                  <MatchRow key={i} match={match} />
                ))}
              </div>
            )}
          </div>

          {/* COTD */}
          {cotd.length > 0 && (
            <div className="glass-card p-5">
              <h2 className="font-display font-semibold text-lg mb-4">
                🏆 Classement du jour
              </h2>
              <div className="space-y-2">
                {cotd.map((entry, i) => (
                  <div key={entry.pseudo} className="flex items-center gap-3 py-2">
                    <span
                      className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                      style={{
                        background: i === 0 ? 'rgba(245,158,11,0.2)' : i === 1 ? 'rgba(156,163,175,0.2)' : i === 2 ? 'rgba(205,127,50,0.2)' : 'rgba(255,255,255,0.05)',
                        color: i === 0 ? '#f59e0b' : i === 1 ? '#9ca3af' : i === 2 ? '#cd7f32' : 'rgba(255,255,255,0.5)',
                      }}
                    >
                      {i + 1}
                    </span>
                    <Link to={`/app/profile/${entry.pseudo}`} className="flex-1 font-medium text-sm hover:text-accent transition-colors">
                      {entry.pseudo}
                    </Link>
                    <span className="text-sm font-bold" style={{ color: '#10b981' }}>+{entry.gain}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Activity feed */}
        <div>
          <ActivityFeed />
        </div>
      </div>

      {/* ELO Graph Modal */}
      <AnimatePresence>
        {graphMode && (
          <EloGraphModal
            mode={graphMode}
            history={(user.matchHistory || []).filter((m: MatchRecord) => m.mode === graphMode)}
            currentElo={user.stats[graphMode]?.elo ?? 500}
            onClose={() => setGraphMode(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── ELO Graph Modal ──────────────────────────────────────────────────────────
function EloGraphModal({ mode, history, currentElo, onClose }: {
  mode: Mode
  history: MatchRecord[]
  currentElo: number
  onClose: () => void
}) {
  const rank = getRankFromElo(currentElo)

  // Build ELO data points (oldest → newest), starting from 500 before first match
  const points = history.length > 0
    ? [...history].reverse().map(m => m.eloAfter ?? currentElo)
    : [currentElo]

  const minElo = Math.max(0, Math.min(...points) - 50)
  const maxElo = Math.max(...points) + 50
  const range = maxElo - minElo || 1

  // SVG dimensions
  const W = 480
  const H = 160
  const PAD = 16

  const toX = (i: number) => PAD + (i / Math.max(points.length - 1, 1)) * (W - PAD * 2)
  const toY = (elo: number) => PAD + (1 - (elo - minElo) / range) * (H - PAD * 2)

  const pathD = points.map((elo, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(elo).toFixed(1)}`).join(' ')
  const areaD = points.length > 0
    ? `${pathD} L ${toX(points.length - 1).toFixed(1)} ${H - PAD} L ${toX(0).toFixed(1)} ${H - PAD} Z`
    : ''

  const wins = history.filter(m => m.result === 'win').length
  const losses = history.filter(m => m.result === 'loss').length
  const wr = getWinRate(wins, losses)

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.92, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.92, y: 20 }}
        transition={{ type: 'spring', damping: 22, stiffness: 280 }}
        className="w-full max-w-lg rounded-2xl overflow-hidden"
        style={{ background: '#0e0e17', border: `1px solid ${rank.color}40`, boxShadow: `0 24px 64px rgba(0,0,0,0.8)` }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between"
          style={{ background: `${rank.color}10`, borderBottom: `1px solid ${rank.color}25` }}>
          <div>
            <div className="flex items-center gap-2">
              <BarChart3 size={16} style={{ color: rank.color }} />
              <span className="font-display font-bold text-lg" style={{ color: rank.color }}>
                Progression {mode}
              </span>
            </div>
            <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
              {history.length} partie{history.length !== 1 ? 's' : ''} jouée{history.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg transition-colors hover:bg-white/10">
            <X size={16} style={{ color: 'rgba(255,255,255,0.5)' }} />
          </button>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-px" style={{ background: 'rgba(255,255,255,0.06)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          {[
            { label: 'ELO actuel', value: currentElo, color: rank.color },
            { label: 'Win Rate', value: `${wr}%`, color: wr >= 50 ? '#10b981' : '#ef4444' },
            { label: 'W / L', value: `${wins} / ${losses}`, color: 'rgba(255,255,255,0.7)' },
          ].map(s => (
            <div key={s.label} className="py-3 text-center" style={{ background: '#0e0e17' }}>
              <p className="text-base font-bold" style={{ color: s.color }}>{s.value}</p>
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>{s.label}</p>
            </div>
          ))}
        </div>

        {/* SVG Graph */}
        <div className="p-5">
          {history.length < 2 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-2">
              <p className="text-sm" style={{ color: 'rgba(255,255,255,0.3)' }}>
                {history.length === 0 ? 'Aucune partie jouée dans ce mode.' : 'Jouez au moins 2 parties pour voir le graphique.'}
              </p>
            </div>
          ) : (
            <div className="relative">
              <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible' }}>
                <defs>
                  <linearGradient id={`grad-${mode}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={rank.color} stopOpacity="0.25" />
                    <stop offset="100%" stopColor={rank.color} stopOpacity="0" />
                  </linearGradient>
                </defs>
                {/* Grid lines */}
                {[0, 0.25, 0.5, 0.75, 1].map(t => {
                  const y = PAD + t * (H - PAD * 2)
                  const elo = Math.round(maxElo - t * range)
                  return (
                    <g key={t}>
                      <line x1={PAD} y1={y} x2={W - PAD} y2={y} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
                      <text x={PAD - 4} y={y + 4} textAnchor="end" fontSize="9" fill="rgba(255,255,255,0.25)">{elo}</text>
                    </g>
                  )
                })}
                {/* Area fill */}
                <path d={areaD} fill={`url(#grad-${mode})`} />
                {/* Line */}
                <path d={pathD} fill="none" stroke={rank.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                {/* Dots */}
                {points.map((elo, i) => (
                  <circle
                    key={i}
                    cx={toX(i)}
                    cy={toY(elo)}
                    r={i === points.length - 1 ? 4.5 : 3}
                    fill={i === points.length - 1 ? rank.color : '#0e0e17'}
                    stroke={rank.color}
                    strokeWidth="1.5"
                  />
                ))}
              </svg>
              <div className="flex justify-between text-xs mt-1" style={{ color: 'rgba(255,255,255,0.25)' }}>
                <span>Partie 1</span>
                <span>Partie {points.length}</span>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}

function MatchRow({ match }: { match: MatchRecord }) {
  const isWin = match.result === 'win'
  const isDraw = match.result === 'draw'
  const rank = getRankFromElo(match.eloAfter || 500)
  const date = new Date(match.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })

  return (
    <div className="flex items-center gap-3 p-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.03)' }}>
      <span
        className="px-2 py-1 rounded-lg text-xs font-bold flex-shrink-0"
        style={{
          background: isWin ? 'rgba(16,185,129,0.15)' : isDraw ? 'rgba(107,114,128,0.15)' : 'rgba(239,68,68,0.15)',
          color: isWin ? '#10b981' : isDraw ? '#6b7280' : '#ef4444',
        }}
      >
        {isWin ? 'WIN' : isDraw ? 'NUL' : 'LOSS'}
      </span>
      <span className="text-xs font-semibold" style={{ color: 'rgba(255,255,255,0.5)' }}>{match.mode}</span>
      <div className="flex-1 text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
        vs {match.opponents?.join(', ') || '?'}
      </div>
      <div className="flex items-center gap-1 text-xs font-bold">
        {match.eloChange >= 0
          ? <><TrendingUp size={10} style={{ color: '#10b981' }} /><span style={{ color: '#10b981' }}>+{match.eloChange}</span></>
          : <><TrendingDown size={10} style={{ color: '#ef4444' }} /><span style={{ color: '#ef4444' }}>{match.eloChange}</span></>
        }
      </div>
      <span className="text-xs" style={{ color: rank.color }}>{match.eloAfter}</span>
      <span className="text-xs flex-shrink-0" style={{ color: 'rgba(255,255,255,0.25)' }}>{date}</span>
    </div>
  )
}
