import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { Zap, Crown, Lock, CheckCircle, Star, ChevronLeft, ChevronRight } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import api from '../lib/api'
import toast from 'react-hot-toast'
import UserAvatar from '../components/UserAvatar'

interface BPReward {
  level: number
  free: { type: string; amount?: number; frame?: string; label?: string; emoji?: string }
  premium: { type: string; amount?: number; frame?: string; label?: string; emoji?: string }
}

interface BPData {
  xp: number
  level: number
  levelXp: number
  xpPerLevel: number
  maxLevel: number
  premium: boolean
  claimedRewards: string[]
  coins: number
  rewards: BPReward[]
  unlockedFrames?: string[]
  equippedFrame?: string | null
}

export default function BattlePassPage() {
  const { user } = useAuth()
  const [bp, setBp] = useState<BPData | null>(null)
  const [loading, setLoading] = useState(true)
  const [buying, setBuying] = useState(false)
  const [claiming, setClaiming] = useState<string | null>(null)
  const [equipping, setEquipping] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const fetchBP = async () => {
    try {
      const token = localStorage.getItem('token')
      const res = await api.get('/api/battle-pass', { headers: { Authorization: `Bearer ${token}` } })
      setBp(res.data)
    } catch {
      toast.error('Erreur lors du chargement')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchBP() }, [])

  useEffect(() => {
    if (bp && scrollRef.current) {
      const el = scrollRef.current.querySelector(`[data-level="${bp.level}"]`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
    }
  }, [bp?.level])

  const handleEquipFrame = async (frame: string) => {
    setEquipping(frame)
    try {
      const token = localStorage.getItem('token')
      await api.post('/api/battle-pass/equip-frame', { frame }, { headers: { Authorization: `Bearer ${token}` } })
      toast.success('Bordure équipée !')
      fetchBP()
    } catch {
      toast.error('Erreur')
    } finally {
      setEquipping(null)
    }
  }

  const handleBuyPremium = async () => {
    if (!bp) return
    if ((user?.coins ?? 0) < 500) { toast.error('Tu n\'as pas assez de coins (500 requis)'); return }
    if (!window.confirm('Activer le Passe Premium pour 500 coins ?')) return
    setBuying(true)
    try {
      const token = localStorage.getItem('token')
      await api.post('/api/battle-pass/buy-premium', {}, { headers: { Authorization: `Bearer ${token}` } })
      toast.success('🎉 Passe Premium activé !')
      fetchBP()
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Erreur')
    } finally {
      setBuying(false)
    }
  }

  const handleClaim = async (level: number, track: 'free' | 'premium') => {
    const key = `${level}_${track}`
    setClaiming(key)
    try {
      const token = localStorage.getItem('token')
      const res = await api.post('/api/battle-pass/claim', { level, track }, { headers: { Authorization: `Bearer ${token}` } })
      const reward = res.data.reward
      if (reward.type === 'frame') toast.success(`🖼️ Bordure "${reward.label}" débloquée !`)
      else toast.success(`🎁 +${reward.amount} coins réclamés !`)
      fetchBP()
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Erreur')
    } finally {
      setClaiming(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 rounded-full border-2 border-t-transparent"
          style={{ borderColor: '#ff4655', borderTopColor: 'transparent', animation: 'spin 1s linear infinite' }} />
      </div>
    )
  }
  if (!bp) return null

  const xpProgress = bp.xpPerLevel > 0 ? (bp.levelXp / bp.xpPerLevel) * 100 : 0

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)' }}>
              <Star size={20} style={{ color: '#f59e0b' }} />
            </div>
            <div>
              <h1 className="font-display font-bold text-2xl">Passe de Combat</h1>
              <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
                Saison 1 · Niveau {bp.level}/{bp.maxLevel}
              </p>
            </div>
          </div>
          {!bp.premium ? (
            <button onClick={handleBuyPremium} disabled={buying}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm transition-all"
              style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)', color: '#000', boxShadow: '0 0 20px rgba(245,158,11,0.3)', opacity: buying ? 0.7 : 1 }}>
              <Crown size={15} /> Premium · 500 🪙
            </button>
          ) : (
            <div className="flex items-center gap-2 px-4 py-2 rounded-xl"
              style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)' }}>
              <Crown size={14} style={{ color: '#f59e0b' }} />
              <span className="text-sm font-bold" style={{ color: '#f59e0b' }}>Premium actif</span>
              <CheckCircle size={13} style={{ color: '#10b981' }} />
            </div>
          )}
        </div>

        {/* XP Bar */}
        <div className="mt-5 glass-card p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Zap size={14} style={{ color: '#ff4655' }} />
              <span className="text-sm font-semibold">XP : {bp.xp.toLocaleString()}</span>
            </div>
            <span className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
              {bp.levelXp} / {bp.xpPerLevel} XP — prochain niveau dans {bp.xpPerLevel - bp.levelXp} XP
            </span>
          </div>
          <div className="h-3 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <motion.div initial={{ width: 0 }} animate={{ width: `${xpProgress}%` }}
              transition={{ duration: 0.8, ease: 'easeOut' }} className="h-full rounded-full"
              style={{ background: 'linear-gradient(90deg, #ff4655, #f59e0b)' }} />
          </div>
          <div className="flex items-center gap-4 mt-3 text-xs flex-wrap" style={{ color: 'rgba(255,255,255,0.45)' }}>
            <span>🎮 Jouer : +20 XP</span>
            <span>🏆 Victoire : +35 XP</span>
            <span>🔥 Streak x3 : +50 XP</span>
            <span>✅ Mission : +75 XP</span>
          </div>
        </div>
      </motion.div>

      {/* Track labels */}
      <div className="flex items-center gap-3 mb-3">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full" style={{ background: '#9ca3af' }} />
          <span className="text-xs font-semibold" style={{ color: 'rgba(255,255,255,0.5)' }}>Gratuit</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full" style={{ background: '#f59e0b' }} />
          <span className="text-xs font-semibold" style={{ color: '#f59e0b' }}>Premium</span>
          {!bp.premium && <Lock size={10} style={{ color: 'rgba(255,255,255,0.3)' }} />}
        </div>
        <div className="ml-auto flex gap-1">
          <button onClick={() => scrollRef.current?.scrollBy({ left: -300, behavior: 'smooth' })}
            className="p-1.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <ChevronLeft size={14} />
          </button>
          <button onClick={() => scrollRef.current?.scrollBy({ left: 300, behavior: 'smooth' })}
            className="p-1.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {/* Level track */}
      <div ref={scrollRef} className="overflow-x-auto pb-4" style={{ scrollbarWidth: 'thin' }}>
        <div className="flex gap-2" style={{ minWidth: 'max-content' }}>
          {bp.rewards.map((reward) => {
            const unlocked = reward.level <= bp.level
            const freeClaimed = bp.claimedRewards.includes(`${reward.level}_free`)
            const premClaimed = bp.claimedRewards.includes(`${reward.level}_premium`)
            const isCurrent = reward.level === bp.level

            return (
              <div key={reward.level} data-level={reward.level}
                className="flex flex-col rounded-xl overflow-hidden flex-shrink-0"
                style={{
                  width: 84,
                  background: isCurrent ? 'rgba(255,70,85,0.1)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${isCurrent ? 'rgba(255,70,85,0.4)' : unlocked ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.05)'}`,
                  boxShadow: isCurrent ? '0 0 16px rgba(255,70,85,0.2)' : 'none',
                }}>
                {/* Level number */}
                <div className="py-1.5 text-center text-xs font-black"
                  style={{
                    background: isCurrent ? 'rgba(255,70,85,0.2)' : unlocked ? 'rgba(255,255,255,0.04)' : 'transparent',
                    color: isCurrent ? '#ff4655' : unlocked ? '#e8e8f0' : 'rgba(255,255,255,0.3)',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                  }}>
                  {reward.level}
                </div>

                {/* Free reward */}
                <div className="p-2 flex flex-col items-center gap-1" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', minHeight: 72 }}>
                  <span className="text-lg">{reward.free.type === 'frame' ? (reward.free.emoji || '🖼️') : '🪙'}</span>
                  <span className="text-center font-bold" style={{ color: '#9ca3af', fontSize: '9px', lineHeight: '1.2' }}>
                    {reward.free.type === 'frame' ? reward.free.label : `+${reward.free.amount}`}
                  </span>
                  {unlocked ? freeClaimed ? (
                    <CheckCircle size={13} style={{ color: '#10b981' }} />
                  ) : (
                    <button onClick={() => handleClaim(reward.level, 'free')} disabled={claiming === `${reward.level}_free`}
                      className="text-xs px-2 py-0.5 rounded-md font-bold"
                      style={{ background: 'rgba(156,163,175,0.2)', color: '#9ca3af', border: '1px solid rgba(156,163,175,0.3)' }}>
                      {claiming === `${reward.level}_free` ? '…' : 'Claim'}
                    </button>
                  ) : <Lock size={11} style={{ color: 'rgba(255,255,255,0.2)' }} />}
                </div>

                {/* Premium reward */}
                <div className="p-2 flex flex-col items-center gap-1" style={{ minHeight: 72 }}>
                  <span className="text-lg">{reward.premium.type === 'frame' ? (reward.premium.emoji || '🖼️') : '🪙'}</span>
                  <span className="text-center font-bold" style={{ color: '#f59e0b', fontSize: '9px', lineHeight: '1.2' }}>
                    {reward.premium.type === 'frame' ? reward.premium.label : `+${reward.premium.amount}`}
                  </span>
                  {bp.premium && unlocked ? premClaimed ? (
                    <CheckCircle size={13} style={{ color: '#10b981' }} />
                  ) : (
                    <button onClick={() => handleClaim(reward.level, 'premium')} disabled={claiming === `${reward.level}_premium`}
                      className="text-xs px-2 py-0.5 rounded-md font-bold"
                      style={{ background: 'rgba(245,158,11,0.2)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)' }}>
                      {claiming === `${reward.level}_premium` ? '…' : 'Claim'}
                    </button>
                  ) : <Lock size={11} style={{ color: bp.premium ? 'rgba(255,255,255,0.2)' : 'rgba(245,158,11,0.3)' }} />}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Info */}
      <div className="mt-6 p-4 rounded-xl flex items-start gap-3"
        style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)' }}>
        <span className="text-base flex-shrink-0">ℹ️</span>
        <p className="text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.5)' }}>
          Le passe de combat se réinitialise chaque saison (environ tous les 3 mois).
          Gagne de l'XP en jouant des parties ranked, en remportant des victoires et en complétant tes missions quotidiennes.
          Le Passe Premium débloque les récompenses dorées pour toute la saison.
        </p>
      </div>

      {/* Unlocked frames */}
      {bp.unlockedFrames && bp.unlockedFrames.length > 0 && (
        <div className="mt-6 glass-card p-5">
          <h3 className="font-display font-bold text-base mb-4">🖼️ Mes bordures débloquées</h3>
          <div className="flex gap-4 flex-wrap">
            {bp.unlockedFrames.map(frame => (
              <button key={frame} onClick={() => handleEquipFrame(frame)} disabled={equipping === frame}
                className="flex flex-col items-center gap-2 p-3 rounded-xl transition-all"
                style={{
                  background: bp.equippedFrame === frame ? 'rgba(255,70,85,0.15)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${bp.equippedFrame === frame ? 'rgba(255,70,85,0.4)' : 'rgba(255,255,255,0.08)'}`,
                  minWidth: 80,
                }}>
                <UserAvatar pseudo={user?.pseudo || '?'} avatar={user?.avatar} size="md" frame={frame} />
                <span className="font-semibold text-center"
                  style={{ color: bp.equippedFrame === frame ? '#ff4655' : 'rgba(255,255,255,0.5)', fontSize: '9px' }}>
                  {frame.replace(/_/g, ' ')}
                </span>
                {bp.equippedFrame === frame && <span style={{ color: '#10b981', fontSize: 10 }}>✓ Équipée</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
