import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Zap, Clock, CheckCircle } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import api from '../lib/api'
import toast from 'react-hot-toast'

interface Mission {
  id: string
  label: string
  reward: number
  target: number
  progress: number
  claimed: boolean
}

interface MissionsData {
  missions: Mission[]
  coins: number
  msUntilReset: number
}

function formatTime(ms: number) {
  const totalSeconds = Math.floor(ms / 1000)
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

export default function MissionsPage() {
  const { user, updateUser } = useAuth()
  const [data, setData] = useState<MissionsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [claiming, setClaiming] = useState<string | null>(null)
  const [timeLeft, setTimeLeft] = useState(0)

  const fetchMissions = async () => {
    try {
      const token = localStorage.getItem('rv_token')
      const res = await api.get('/api/missions', {
        headers: { Authorization: `Bearer ${token}` }
      })
      setData(res.data)
      setTimeLeft(res.data.msUntilReset)
    } catch {
      toast.error('Impossible de charger les missions')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchMissions()
  }, [])

  useEffect(() => {
    if (timeLeft <= 0) return
    const interval = setInterval(() => {
      setTimeLeft(prev => Math.max(0, prev - 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [timeLeft])

  const claimMission = async (missionId: string) => {
    setClaiming(missionId)
    try {
      const token = localStorage.getItem('rv_token')
      const res = await api.post('/api/missions/claim', { missionId }, {
        headers: { Authorization: `Bearer ${token}` }
      })
      toast.success(`+${res.data.reward} coins réclamés !`)
      updateUser({ coins: res.data.coins })
      setData(prev => {
        if (!prev) return prev
        return {
          ...prev,
          coins: res.data.coins,
          missions: prev.missions.map(m =>
            m.id === missionId ? { ...m, claimed: true } : m
          )
        }
      })
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      toast.error(msg || 'Erreur lors de la réclamation')
    } finally {
      setClaiming(null)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#08080e' }}>
        <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: '#ff4655', borderTopColor: 'transparent' }} />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)' }}>
            <span className="text-xl">💰</span>
          </div>
          <div>
            <h1 className="font-display font-bold text-2xl">Missions Quotidiennes</h1>
            <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>Complète des missions pour gagner des coins</p>
          </div>
        </div>
      </motion.div>

      {/* Coin Balance */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.1 }}
        className="glass-card p-5 mb-6 flex items-center justify-between"
      >
        <div>
          <p className="text-xs uppercase tracking-wider mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>Solde de coins</p>
          <div className="flex items-center gap-2">
            <span className="text-3xl font-display font-black" style={{ color: '#f59e0b' }}>
              💰 {data?.coins ?? user?.coins ?? 0}
            </span>
            <span className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>coins</span>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs mb-1" style={{ color: 'rgba(255,255,255,0.35)' }}>Réinitialisation dans</p>
          <div className="flex items-center gap-1.5 justify-end">
            <Clock size={13} style={{ color: '#6366f1' }} />
            <span className="font-mono font-bold text-sm" style={{ color: '#818cf8' }}>
              {formatTime(timeLeft)}
            </span>
          </div>
        </div>
      </motion.div>

      {/* Missions */}
      <div className="space-y-4">
        {(data?.missions || []).map((mission, i) => {
          const pct = Math.min(100, Math.round((mission.progress / mission.target) * 100))
          const isComplete = mission.progress >= mission.target
          const canClaim = isComplete && !mission.claimed

          return (
            <motion.div
              key={mission.id}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 + i * 0.08 }}
              className="glass-card p-5"
              style={{
                border: canClaim
                  ? '1px solid rgba(245,158,11,0.4)'
                  : mission.claimed
                  ? '1px solid rgba(16,185,129,0.2)'
                  : '1px solid rgba(255,255,255,0.08)',
              }}
            >
              <div className="flex items-start justify-between gap-4 mb-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    {mission.claimed ? (
                      <CheckCircle size={14} style={{ color: '#10b981' }} />
                    ) : (
                      <Zap size={14} style={{ color: canClaim ? '#f59e0b' : 'rgba(255,255,255,0.3)' }} />
                    )}
                    <p className="text-sm font-semibold" style={{
                      color: mission.claimed ? 'rgba(255,255,255,0.4)' : '#e8e8f0',
                      textDecoration: mission.claimed ? 'line-through' : 'none'
                    }}>
                      {mission.label}
                    </p>
                  </div>
                  <p className="text-xs ml-5" style={{ color: 'rgba(255,255,255,0.35)' }}>
                    {mission.progress} / {mission.target}
                  </p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <div className="text-right">
                    <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>Récompense</p>
                    <p className="font-bold text-sm" style={{ color: '#f59e0b' }}>💰 {mission.reward}</p>
                  </div>
                  {canClaim && (
                    <button
                      onClick={() => claimMission(mission.id)}
                      disabled={claiming === mission.id}
                      className="px-4 py-2 rounded-xl text-xs font-bold transition-all"
                      style={{
                        background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                        color: '#000',
                        opacity: claiming === mission.id ? 0.7 : 1,
                      }}
                    >
                      {claiming === mission.id ? '…' : 'Réclamer'}
                    </button>
                  )}
                  {mission.claimed && (
                    <span className="px-3 py-1.5 rounded-xl text-xs font-bold"
                      style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981', border: '1px solid rgba(16,185,129,0.2)' }}>
                      ✓ Réclamé
                    </span>
                  )}
                </div>
              </div>

              {/* Progress bar */}
              <div className="h-1.5 rounded-full overflow-hidden"
                style={{ background: 'rgba(255,255,255,0.06)' }}>
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.6, delay: 0.2 + i * 0.08 }}
                  className="h-full rounded-full"
                  style={{
                    background: mission.claimed
                      ? '#10b981'
                      : isComplete
                      ? 'linear-gradient(90deg, #f59e0b, #d97706)'
                      : 'linear-gradient(90deg, #6366f1, #8b5cf6)',
                  }}
                />
              </div>
              <p className="text-right text-xs mt-1" style={{ color: 'rgba(255,255,255,0.3)' }}>{pct}%</p>
            </motion.div>
          )
        })}
      </div>

      {/* Info */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="text-center text-xs mt-8"
        style={{ color: 'rgba(255,255,255,0.2)' }}
      >
        Les missions se réinitialisent chaque jour à minuit
      </motion.p>
    </div>
  )
}
