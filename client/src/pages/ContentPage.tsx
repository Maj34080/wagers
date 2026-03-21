import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Clapperboard, Users, Crown, TrendingUp, Copy, CheckCircle, Euro, Lock, ChevronRight } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import api from '../lib/api'
import UserAvatar from '../components/UserAvatar'
import toast from 'react-hot-toast'

interface Palier {
  min: number
  max: number
  pct: number
  label: string
}

interface Referral {
  id: string
  pseudo: string
  avatar: string | null
  createdAt: string
  isPremium: boolean
  premiumUntil: number | null
  premiumPaidAmount: number
}

interface Payment {
  amount: number
  note: string
  date: string
  admin: string
}

interface ContentDashboard {
  pseudo: string
  referralCode: string
  referrals: Referral[]
  totalReferrals: number
  premiumCount: number
  palier: Palier
  nextPalier: Palier | null
  pct: number
  portefeuille: number
  paid: number
  pending: number
  paliers: Palier[]
  payments: Payment[]
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return "aujourd'hui"
  if (days === 1) return 'hier'
  if (days < 30) return `il y a ${days}j`
  return new Date(dateStr).toLocaleDateString('fr-FR')
}

export default function ContentPage() {
  const { user } = useAuth()
  const [data, setData] = useState<ContentDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [activeTab, setActiveTab] = useState<'overview' | 'referrals' | 'payments'>('overview')

  const canAccess = user?.isContent || user?.isAdmin

  useEffect(() => {
    if (!user || !canAccess) { setLoading(false); return }
    api.get(`/api/content/dashboard/${user.id}`)
      .then(res => setData(res.data))
      .catch(() => toast.error('Erreur chargement du dashboard'))
      .finally(() => setLoading(false))
  }, [user])

  const copyCode = () => {
    if (!data) return
    const link = `https://revenge.gg/register?ref=${data.referralCode}`
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true)
      toast.success('Lien copié !')
      setTimeout(() => setCopied(false), 2000)
    })
  }

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
    </div>
  )

  // Not a content creator
  if (!canAccess) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="glass-card p-12 text-center">
          <Lock size={48} className="mx-auto mb-4" style={{ color: 'rgba(255,255,255,0.1)' }} />
          <h1 className="font-display font-bold text-2xl mb-2">Dashboard Content Creator</h1>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
            Réservé aux Content Creators. Contacte un admin pour obtenir le statut.
          </p>
        </div>
      </div>
    )
  }

  if (!data) return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="glass-card p-8 text-center" style={{ color: 'rgba(255,255,255,0.3)' }}>Erreur chargement</div>
    </div>
  )

  const palierProgress = data.nextPalier
    ? ((data.premiumCount - data.palier.min) / (data.nextPalier.min - data.palier.min)) * 100
    : 100

  const PALIER_COLORS: Record<string, string> = {
    Débutant: '#6b7280',
    Actif: '#10b981',
    Influenceur: '#6366f1',
    Expert: '#f59e0b',
    Elite: '#ff4655',
  }

  const palierColor = PALIER_COLORS[data.palier.label] || '#ff4655'

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="font-display font-bold text-3xl flex items-center gap-3">
          <Clapperboard size={28} style={{ color: '#06b6d4' }} />
          Dashboard Content
        </h1>
        <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
          Bienvenue, <strong style={{ color: '#06b6d4' }}>{data.pseudo}</strong> 🎬
        </p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Filleuls total', value: data.totalReferrals, color: '#6366f1', icon: Users },
          { label: 'Filleuls Premium', value: data.premiumCount, color: '#f59e0b', icon: Crown },
          { label: 'Commission', value: `${data.pct}%`, color: palierColor, icon: TrendingUp },
          { label: 'En attente', value: `${data.pending.toFixed(2)}€`, color: '#10b981', icon: Euro },
        ].map(item => (
          <motion.div
            key={item.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card p-4 text-center"
          >
            <item.icon size={18} className="mx-auto mb-2" style={{ color: item.color }} />
            <p className="font-bold text-2xl" style={{ color: item.color }}>{item.value}</p>
            <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>{item.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Palier + code parrainage */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {/* Palier actuel */}
        <div className="glass-card p-5">
          <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: 'rgba(255,255,255,0.4)' }}>Palier actuel</p>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm"
              style={{ background: `${palierColor}15`, color: palierColor, border: `1px solid ${palierColor}30` }}>
              {data.pct}%
            </div>
            <div>
              <p className="font-bold text-lg" style={{ color: palierColor }}>{data.palier.label}</p>
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
                {data.premiumCount} filleul{data.premiumCount > 1 ? 's' : ''} premium
              </p>
            </div>
          </div>
          {/* Progress bar */}
          <div className="space-y-1">
            <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, palierProgress)}%`, background: palierColor }}
              />
            </div>
            {data.nextPalier ? (
              <div className="flex justify-between text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
                <span>{data.premiumCount} / {data.nextPalier.min}</span>
                <span className="flex items-center gap-1">
                  Prochain : {data.nextPalier.label} ({data.nextPalier.pct}%)
                  <ChevronRight size={10} />
                </span>
              </div>
            ) : (
              <p className="text-xs" style={{ color: palierColor }}>🏆 Palier maximum atteint !</p>
            )}
          </div>
          {/* All paliers */}
          <div className="mt-3 grid grid-cols-5 gap-1">
            {data.paliers.map(p => (
              <div key={p.label} className="text-center">
                <div
                  className="h-1 rounded-full mb-1"
                  style={{
                    background: data.premiumCount >= p.min ? (PALIER_COLORS[p.label] || '#fff') : 'rgba(255,255,255,0.1)'
                  }}
                />
                <p className="text-xs" style={{ color: data.premiumCount >= p.min ? PALIER_COLORS[p.label] : 'rgba(255,255,255,0.2)', fontSize: 9 }}>
                  {p.label}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Code parrainage */}
        <div className="glass-card p-5">
          <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: 'rgba(255,255,255,0.4)' }}>Ton lien de parrainage</p>
          <div
            className="p-3 rounded-xl mb-3 font-mono text-sm break-all"
            style={{ background: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.2)', color: '#06b6d4' }}
          >
            revenge.gg/register?ref=<strong>{data.referralCode}</strong>
          </div>
          <button
            onClick={copyCode}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-sm transition-all"
            style={{
              background: copied ? 'rgba(16,185,129,0.15)' : 'rgba(6,182,212,0.15)',
              border: `1px solid ${copied ? 'rgba(16,185,129,0.3)' : 'rgba(6,182,212,0.3)'}`,
              color: copied ? '#10b981' : '#06b6d4',
            }}
          >
            {copied ? <CheckCircle size={14} /> : <Copy size={14} />}
            {copied ? 'Copié !' : 'Copier le lien'}
          </button>

          <div className="mt-4 p-3 rounded-xl text-xs" style={{ background: 'rgba(255,255,255,0.04)' }}>
            <p className="font-semibold mb-2" style={{ color: 'rgba(255,255,255,0.6)' }}>Portefeuille :</p>
            <div className="flex justify-between mb-1">
              <span style={{ color: 'rgba(255,255,255,0.4)' }}>Total généré</span>
              <span className="font-bold" style={{ color: '#f59e0b' }}>{data.portefeuille.toFixed(2)}€</span>
            </div>
            <div className="flex justify-between mb-1">
              <span style={{ color: 'rgba(255,255,255,0.4)' }}>Déjà payé</span>
              <span className="font-bold" style={{ color: '#10b981' }}>{data.paid.toFixed(2)}€</span>
            </div>
            <div className="flex justify-between pt-2 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
              <span style={{ color: 'rgba(255,255,255,0.4)' }}>En attente</span>
              <span className="font-bold text-sm" style={{ color: data.pending > 0 ? '#ff4655' : '#6b7280' }}>
                {data.pending.toFixed(2)}€
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        {([
          { key: 'overview', label: 'Vue générale' },
          { key: 'referrals', label: `Filleuls (${data.totalReferrals})` },
          { key: 'payments', label: `Paiements (${data.payments.length})` },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className="px-4 py-2 rounded-lg text-sm font-semibold transition-all"
            style={{
              background: activeTab === t.key ? 'rgba(6,182,212,0.15)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${activeTab === t.key ? 'rgba(6,182,212,0.4)' : 'rgba(255,255,255,0.08)'}`,
              color: activeTab === t.key ? '#06b6d4' : 'rgba(255,255,255,0.5)',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Overview */}
      {activeTab === 'overview' && (
        <div className="glass-card p-5">
          <p className="text-xs font-bold uppercase tracking-wide mb-4" style={{ color: 'rgba(255,255,255,0.4)' }}>
            Comment ça marche
          </p>
          <div className="space-y-3">
            {[
              { step: '1', text: 'Partage ton lien de parrainage sur tes réseaux', color: '#06b6d4' },
              { step: '2', text: 'Tes abonnés s\'inscrivent via ton lien → ils deviennent tes filleuls', color: '#6366f1' },
              { step: '3', text: 'Dès qu\'un filleul achète le Premium, tu touches ta commission', color: '#f59e0b' },
              { step: '4', text: 'Plus tu as de filleuls Premium, plus ton palier monte et ta commission augmente', color: '#10b981' },
            ].map(item => (
              <div key={item.step} className="flex items-start gap-3 p-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.03)' }}>
                <div className="w-7 h-7 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0"
                  style={{ background: `${item.color}20`, color: item.color, border: `1px solid ${item.color}30` }}>
                  {item.step}
                </div>
                <p className="text-sm" style={{ color: 'rgba(255,255,255,0.7)' }}>{item.text}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 p-3 rounded-xl" style={{ background: 'rgba(255,70,85,0.06)', border: '1px solid rgba(255,70,85,0.1)' }}>
            <p className="text-xs" style={{ color: 'rgba(255,70,85,0.8)' }}>
              💡 Les paiements sont effectués manuellement par l'admin. Contacte le support pour déclencher un virement.
            </p>
          </div>
        </div>
      )}

      {/* Referrals */}
      {activeTab === 'referrals' && (
        <div className="glass-card overflow-hidden">
          {data.referrals.length === 0 ? (
            <div className="p-10 text-center" style={{ color: 'rgba(255,255,255,0.3)' }}>
              Aucun filleul pour le moment. Partage ton lien !
            </div>
          ) : (
            <div>
              <div className="grid grid-cols-4 gap-4 px-4 py-2 text-xs font-semibold" style={{ color: 'rgba(255,255,255,0.35)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <span>Joueur</span>
                <span className="text-center">Inscrit</span>
                <span className="text-center">Status</span>
                <span className="text-right">Commission</span>
              </div>
              {data.referrals.map((ref, i) => {
                const earned = ref.isPremium
                  ? ((ref.premiumPaidAmount || 7.99) * data.pct / 100).toFixed(2)
                  : '0.00'
                return (
                  <motion.div
                    key={ref.id}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                    className="grid grid-cols-4 gap-4 px-4 py-3 items-center"
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <UserAvatar pseudo={ref.pseudo} avatar={ref.avatar} size="sm" />
                      <span className="text-sm font-medium truncate">{ref.pseudo}</span>
                    </div>
                    <span className="text-center text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
                      {timeAgo(ref.createdAt)}
                    </span>
                    <div className="flex justify-center">
                      {ref.isPremium ? (
                        <span className="px-2 py-0.5 rounded text-xs font-bold" style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}>
                          👑 Premium
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-xs font-bold" style={{ background: 'rgba(107,114,128,0.1)', color: '#6b7280' }}>
                          Gratuit
                        </span>
                      )}
                    </div>
                    <span className="text-right text-sm font-bold" style={{ color: ref.isPremium ? '#10b981' : 'rgba(255,255,255,0.2)' }}>
                      +{earned}€
                    </span>
                  </motion.div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Payments history */}
      {activeTab === 'payments' && (
        <div className="glass-card overflow-hidden">
          {data.payments.length === 0 ? (
            <div className="p-10 text-center" style={{ color: 'rgba(255,255,255,0.3)' }}>
              Aucun paiement reçu pour le moment.
            </div>
          ) : (
            <div>
              <div className="grid grid-cols-3 gap-4 px-4 py-2 text-xs font-semibold" style={{ color: 'rgba(255,255,255,0.35)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <span>Date</span>
                <span>Note</span>
                <span className="text-right">Montant</span>
              </div>
              {data.payments.map((pay, i) => (
                <div key={i} className="grid grid-cols-3 gap-4 px-4 py-3 items-center" style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                  <span className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    {new Date(pay.date).toLocaleDateString('fr-FR')}
                  </span>
                  <span className="text-xs" style={{ color: 'rgba(255,255,255,0.6)' }}>{pay.note || '—'}</span>
                  <span className="text-right font-bold" style={{ color: '#10b981' }}>+{pay.amount.toFixed(2)}€</span>
                </div>
              ))}
              <div className="px-4 py-3 flex justify-between items-center" style={{ borderTop: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}>
                <span className="text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.5)' }}>Total reçu</span>
                <span className="font-bold text-lg" style={{ color: '#10b981' }}>{data.paid.toFixed(2)}€</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
