import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Trophy, Search } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import api from '../lib/api'
import UserAvatar from '../components/UserAvatar'
import RankBadge from '../components/RankBadge'
import { Mode, LeaderboardEntry } from '../types'
import { getWinRate } from '../utils/rank'

const MODES: Mode[] = ['1v1', '2v2', '3v3', '5v5']

export default function LeaderboardPage() {
  const { user } = useAuth()
  const [mode, setMode] = useState<Mode>('2v2')
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    setLoading(true)
    api.get(`/api/leaderboard/${mode}`)
      .then(res => setEntries(res.data || []))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false))
  }, [mode])

  const filtered = entries.filter(e =>
    e.pseudo.toLowerCase().includes(search.toLowerCase())
  )

  const top3 = filtered.slice(0, 3)
  const rest = filtered.slice(3)

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="font-display font-bold text-3xl flex items-center gap-3">
          <Trophy size={28} style={{ color: '#f59e0b' }} />
          Classement
        </h1>
        <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>Top joueurs par ELO</p>
      </div>

      {/* Mode tabs */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {MODES.map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className="px-4 py-2 rounded-lg font-semibold text-sm transition-all"
            style={{
              background: mode === m ? 'rgba(255,70,85,0.15)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${mode === m ? 'rgba(255,70,85,0.4)' : 'rgba(255,255,255,0.08)'}`,
              color: mode === m ? '#ff4655' : 'rgba(255,255,255,0.5)',
            }}
          >
            {m}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'rgba(255,255,255,0.3)' }} />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Rechercher un joueur…"
          className="input-field pl-9"
        />
      </div>

      {loading ? (
        <div className="text-center py-16">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : (
        <>
          {/* Top 3 Podium */}
          {!search && top3.length > 0 && (
            <div className="flex items-end justify-center gap-4 mb-8">
              {/* 2nd */}
              {top3[1] && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="glass-card p-4 text-center w-36 relative"
                  style={{ marginBottom: 0 }}
                >
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                    style={{ background: '#9ca3af', color: '#0a0a14' }}>2</div>
                  <UserAvatar pseudo={top3[1].pseudo} avatar={top3[1].avatar} size="md" isPremium={top3[1].isPremium} frame={top3[1].avatarFrame} />
                  <p className="font-semibold text-sm mt-2 truncate">{top3[1].pseudo}</p>
                  <p className="font-bold" style={{ color: '#9ca3af' }}>{top3[1].elo}</p>
                </motion.div>
              )}
              {/* 1st */}
              {top3[0] && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="glass-card p-5 text-center w-40 relative"
                  style={{ border: '1px solid rgba(245,158,11,0.3)', marginBottom: 16 }}
                >
                  <div className="text-2xl mb-1">👑</div>
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                    style={{ background: '#f59e0b', color: '#0a0a14' }}>1</div>
                  <UserAvatar pseudo={top3[0].pseudo} avatar={top3[0].avatar} size="lg" isPremium={top3[0].isPremium} frame={top3[0].avatarFrame} />
                  <p className="font-bold text-base mt-2 truncate">{top3[0].pseudo}</p>
                  <p className="font-bold text-lg" style={{ color: '#f59e0b' }}>{top3[0].elo}</p>
                </motion.div>
              )}
              {/* 3rd */}
              {top3[2] && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="glass-card p-4 text-center w-36 relative"
                >
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                    style={{ background: '#cd7f32', color: '#0a0a14' }}>3</div>
                  <UserAvatar pseudo={top3[2].pseudo} avatar={top3[2].avatar} size="md" isPremium={top3[2].isPremium} frame={top3[2].avatarFrame} />
                  <p className="font-semibold text-sm mt-2 truncate">{top3[2].pseudo}</p>
                  <p className="font-bold" style={{ color: '#cd7f32' }}>{top3[2].elo}</p>
                </motion.div>
              )}
            </div>
          )}

          {/* Full table */}
          <div className="glass-card overflow-hidden">
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  {['#', 'Joueur', 'ELO', 'V', 'D', 'WR', 'Rang'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold" style={{ color: 'rgba(255,255,255,0.4)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(search ? filtered : rest).map((entry, i) => {
                  const rank = search ? i + 1 : i + 4
                  const isMe = entry.pseudo === user?.pseudo
                  return (
                    <motion.tr
                      key={entry.pseudo}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: i * 0.02 }}
                      style={{
                        borderBottom: '1px solid rgba(255,255,255,0.04)',
                        background: isMe ? 'rgba(255,70,85,0.05)' : 'transparent',
                      }}
                    >
                      <td className="px-4 py-3 text-sm font-bold" style={{ color: 'rgba(255,255,255,0.4)' }}>{rank}</td>
                      <td className="px-4 py-3">
                        <Link to={`/app/profile/${entry.pseudo}`} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                          <UserAvatar pseudo={entry.pseudo} avatar={entry.avatar} size="sm" isPremium={entry.isPremium} frame={entry.avatarFrame} />
                          <span className="text-sm font-semibold">{entry.pseudo}</span>
                          {isMe && <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,70,85,0.2)', color: '#ff4655' }}>Toi</span>}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-bold text-sm">{entry.elo}</span>
                      </td>
                      <td className="px-4 py-3 text-sm" style={{ color: '#10b981' }}>{entry.wins}</td>
                      <td className="px-4 py-3 text-sm" style={{ color: '#ef4444' }}>{entry.losses}</td>
                      <td className="px-4 py-3 text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
                        {getWinRate(entry.wins, entry.losses)}%
                      </td>
                      <td className="px-4 py-3">
                        <RankBadge elo={entry.elo} showElo={false} size="sm" />
                      </td>
                    </motion.tr>
                  )
                })}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div className="text-center py-12" style={{ color: 'rgba(255,255,255,0.3)' }}>
                Aucun joueur trouvé
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
