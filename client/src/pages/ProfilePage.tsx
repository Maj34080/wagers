import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { TrendingUp, TrendingDown, Upload, Copy } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import api from '../lib/api'
import UserAvatar from '../components/UserAvatar'
import RankBadge from '../components/RankBadge'
import EloCard from '../components/EloCard'
import { Mode, MatchRecord } from '../types'
import { getWinRate } from '../utils/rank'
import toast from 'react-hot-toast'

const MODES: Mode[] = ['1v1', '2v2', '3v3', '5v5']

interface ProfileData {
  id: string
  pseudo: string
  stats: Record<Mode, { wins: number; losses: number; elo: number }>
  avatar: string | null
  banner: string | null
  isPremium: boolean
  isContent: boolean
  isFondateur: boolean
  fondateurDate: string | null
  referralCode: string | null
  matchHistory: MatchRecord[]
  winrate: number
  totalWins: number
  totalLosses: number
  banned: boolean
  muted: boolean
}

export default function ProfilePage() {
  const { user, updateUser } = useAuth()
  const { pseudo } = useParams<{ pseudo?: string }>()
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)

  const targetPseudo = pseudo || user?.pseudo
  const isOwnProfile = !pseudo || pseudo === user?.pseudo

  useEffect(() => {
    if (!targetPseudo) return
    setLoading(true)
    api.get(`/api/profile/${targetPseudo}`)
      .then(res => {
        const d = res.data
        // Compute totals
        const totalWins = Object.values(d.stats || {}).reduce((a: number, s: unknown) => a + ((s as { wins?: number })?.wins || 0), 0)
        const totalLosses = Object.values(d.stats || {}).reduce((a: number, s: unknown) => a + ((s as { losses?: number })?.losses || 0), 0)
        const total = totalWins + totalLosses
        setProfile({ ...d, totalWins, totalLosses, winrate: total > 0 ? Math.round(totalWins / total * 100) : 0 })
      })
      .catch(() => setProfile(null))
      .finally(() => setLoading(false))
  }, [targetPseudo])

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !user) return
    if (file.size > 2 * 1024 * 1024) { toast.error('Image trop lourde (max 2MB)'); return }
    setUploading(true)
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        await api.post('/api/avatar', { userId: user.id, avatar: reader.result })
        updateUser({ avatar: reader.result as string })
        toast.success('Avatar mis à jour !')
        setProfile(prev => prev ? { ...prev, avatar: reader.result as string } : prev)
      } catch {
        toast.error('Erreur upload')
      } finally {
        setUploading(false)
      }
    }
    reader.readAsDataURL(file)
  }

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (!profile) return (
    <div className="flex items-center justify-center min-h-screen">
      <p style={{ color: 'rgba(255,255,255,0.4)' }}>Joueur introuvable</p>
    </div>
  )

  const effectiveProfile = isOwnProfile && user ? {
    ...profile,
    isPremium: user.isPremium,
    isAdmin: user.isAdmin,
    isContent: user.isContent,
    isFondateur: user.isFondateur,
    avatar: user.avatar || profile.avatar,
    banner: user.banner || profile.banner,
    stats: user.stats || profile.stats,
  } : profile

  return (
    <div className="max-w-4xl mx-auto">
      {/* Banner */}
      <div
        className="relative h-40 rounded-b-2xl overflow-hidden"
        style={{
          background: effectiveProfile.banner
            ? `url(${effectiveProfile.banner}) center/cover`
            : 'linear-gradient(135deg, #ff455514, #7c3aed14)',
        }}
      >
        <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.3)' }} />
      </div>

      {/* Profile header */}
      <div className="px-6 pb-6">
        <div className="flex items-end gap-4 -mt-12 mb-6">
          <div className="relative">
            <UserAvatar
              pseudo={effectiveProfile.pseudo}
              avatar={effectiveProfile.avatar}
              size="xl"
              isPremium={effectiveProfile.isPremium}
              isFondateur={effectiveProfile.isFondateur}
              isContent={effectiveProfile.isContent}
            />
            {isOwnProfile && (
              <label className="absolute bottom-0 right-0 w-7 h-7 rounded-full flex items-center justify-center cursor-pointer"
                style={{ background: '#ff4655' }}>
                <Upload size={12} />
                <input type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} disabled={uploading} />
              </label>
            )}
          </div>
          <div className="flex-1 pb-2">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="font-display font-bold text-3xl">{effectiveProfile.pseudo}</h1>
              {effectiveProfile.isPremium && (
                <span className="px-2 py-0.5 rounded text-xs font-bold" style={{ background: 'rgba(245,158,11,0.2)', color: '#f59e0b' }}>👑 PREMIUM</span>
              )}
              {effectiveProfile.isFondateur && (
                <span className="px-2 py-0.5 rounded text-xs font-bold" style={{ background: 'rgba(124,58,237,0.2)', color: '#7c3aed' }}>⭐ FONDATEUR</span>
              )}
              {effectiveProfile.isContent && (
                <span className="px-2 py-0.5 rounded text-xs font-bold" style={{ background: 'rgba(6,182,212,0.2)', color: '#06b6d4' }}>🎬 CONTENT</span>
              )}
            </div>
            <div className="flex items-center gap-4 mt-1">
              <RankBadge elo={effectiveProfile.stats['2v2']?.elo || 500} />
              <span className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
                {effectiveProfile.totalWins}V / {effectiveProfile.totalLosses}D • {effectiveProfile.winrate}% WR
              </span>
            </div>
          </div>
        </div>

        {/* ELO cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          {MODES.map((m) => (
            <EloCard key={m} mode={m} stats={effectiveProfile.stats[m] || { wins: 0, losses: 0, elo: 500 }} />
          ))}
        </div>

        {/* Match history */}
        <div className="glass-card p-5 mb-4">
          <h2 className="font-display font-semibold text-lg mb-4">Historique des parties</h2>
          {effectiveProfile.matchHistory.length === 0 ? (
            <p className="text-sm text-center py-6" style={{ color: 'rgba(255,255,255,0.3)' }}>Aucune partie jouée</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    {['Date', 'Mode', 'Résultat', 'Adversaires', 'ELO'].map(h => (
                      <th key={h} className="text-left pb-2 pr-4 text-xs font-semibold" style={{ color: 'rgba(255,255,255,0.4)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {effectiveProfile.matchHistory.slice(0, 20).map((match: MatchRecord, i: number) => {
                    const isWin = match.result === 'win'
                    return (
                      <motion.tr
                        key={i}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: i * 0.02 }}
                        style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}
                      >
                        <td className="py-2 pr-4" style={{ color: 'rgba(255,255,255,0.4)', fontSize: '11px' }}>
                          {new Date(match.date).toLocaleDateString('fr-FR')}
                        </td>
                        <td className="py-2 pr-4 font-semibold">{match.mode}</td>
                        <td className="py-2 pr-4">
                          <span className="px-2 py-0.5 rounded text-xs font-bold"
                            style={{
                              background: isWin ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
                              color: isWin ? '#10b981' : '#ef4444',
                            }}>
                            {isWin ? 'WIN' : 'LOSS'}
                          </span>
                        </td>
                        <td className="py-2 pr-4 text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>
                          {match.opponents?.join(', ') || '—'}
                        </td>
                        <td className="py-2">
                          <span className="flex items-center gap-1 font-bold text-xs">
                            {match.eloChange >= 0
                              ? <><TrendingUp size={10} style={{ color: '#10b981' }} /><span style={{ color: '#10b981' }}>+{match.eloChange}</span></>
                              : <><TrendingDown size={10} style={{ color: '#ef4444' }} /><span style={{ color: '#ef4444' }}>{match.eloChange}</span></>
                            }
                          </span>
                        </td>
                      </motion.tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Referral section (own profile only) */}
        {isOwnProfile && (
          <div className="glass-card p-5">
            <h2 className="font-display font-semibold text-lg mb-3">Parrainage</h2>
            <div className="flex items-center gap-3">
              <div className="flex-1 p-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)' }}>
                <p className="text-xs mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>Ton code</p>
                <p className="font-display font-bold text-lg" style={{ color: '#ff4655' }}>
                  {user?.referralCode || user?.pseudo}
                </p>
              </div>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(user?.referralCode || user?.pseudo || '')
                  toast.success('Code copié !')
                }}
                className="btn-ghost px-4 py-3 text-sm"
              >
                <Copy size={14} /> Copier
              </button>
            </div>
            <p className="text-xs mt-3" style={{ color: 'rgba(255,255,255,0.35)' }}>
              Parraine 3 joueurs actifs (3+ parties) et gagne 1 semaine de Premium !
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
