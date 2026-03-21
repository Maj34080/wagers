import { motion } from 'framer-motion'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { getRankFromElo, getRankProgress, getWinRate } from '../utils/rank'
import { ModeStats, Mode } from '../types'

interface EloCardProps {
  mode: Mode
  stats: ModeStats
  onClick?: () => void
}

const modeLabels: Record<Mode, string> = {
  '1v1': '1v1',
  '2v2': '2v2',
  '3v3': '3v3',
  '5v5': '5v5',
}

const modeDescriptions: Record<Mode, string> = {
  '1v1': 'Duel solo',
  '2v2': 'Duo ranked',
  '3v3': 'Trio ranked',
  '5v5': 'Full team',
}

export default function EloCard({ mode, stats, onClick }: EloCardProps) {
  const rank = getRankFromElo(stats.elo)
  const progress = getRankProgress(stats.elo)
  const winrate = getWinRate(stats.wins, stats.losses)
  const isPositive = stats.currentStreak && stats.currentStreak > 0

  return (
    <motion.div
      whileHover={{ scale: 1.02, y: -2 }}
      onClick={onClick}
      className="glass-card p-5 cursor-pointer relative overflow-hidden"
      style={{ cursor: onClick ? 'pointer' : 'default' }}
    >
      {/* Glow accent */}
      <div
        className="absolute top-0 left-0 right-0 h-1 rounded-t-2xl"
        style={{ background: rank.color }}
      />

      <div className="flex items-start justify-between mb-3">
        <div>
          <span className="text-xs font-bold tracking-widest uppercase" style={{ color: 'rgba(255,255,255,0.4)' }}>
            {modeLabels[mode]}
          </span>
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>{modeDescriptions[mode]}</p>
        </div>
        <div className="flex items-center gap-1 text-xs" style={{ color: isPositive ? '#10b981' : '#ef4444' }}>
          {isPositive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          <span>{stats.currentStreak ? `${Math.abs(stats.currentStreak)} streak` : '—'}</span>
        </div>
      </div>

      <div className="mb-3">
        <p className="font-display font-bold text-3xl" style={{ color: rank.color }}>{stats.elo}</p>
        <p className="text-sm font-semibold mt-0.5" style={{ color: rank.color }}>{rank.name}</p>
      </div>

      {/* Progress bar */}
      <div className="mb-3">
        <div className="flex justify-between text-xs mb-1" style={{ color: 'rgba(255,255,255,0.3)' }}>
          <span>Progression</span>
          <span>{progress}%</span>
        </div>
        <div className="h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            className="h-full rounded-full"
            style={{ background: rank.color }}
          />
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center justify-between text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>
        <span><span style={{ color: '#10b981', fontWeight: 700 }}>{stats.wins}W</span> / <span style={{ color: '#ef4444', fontWeight: 700 }}>{stats.losses}L</span></span>
        <span>{winrate}% WR</span>
      </div>
    </motion.div>
  )
}
