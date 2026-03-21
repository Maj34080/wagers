import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  Settings, Users, Ticket, ScrollText, Ban, Volume2, VolumeX,
  Crown, Star, Search, BarChart3, Zap, Clapperboard, Swords,
  CheckCircle, XCircle, RefreshCw, Trash2, AlertTriangle
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import api from '../lib/api'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import socket from '../lib/socket'

type AdminTab = 'stats' | 'players' | 'simulation' | 'tickets' | 'logs'

interface AdminStats {
  totalPlayers: number
  onlinePlayers: number
  activeRooms: number
  totalMatches: number
}

interface FoundUser {
  id: string
  pseudo: string
  ip: string | null
  createdAt: string
  banned: boolean
  banReason: string | null
  muted: boolean
  muteUntil: number | null
  isPremium: boolean
  premiumUntil: number | null
  isContent: boolean
  isFondateur: boolean
  stats: Record<string, { elo: number; wins: number; losses: number; currentStreak?: number }>
  sameIpAccounts: { pseudo: string }[]
  online: boolean
  coins: number
}

interface Ticket {
  id: string
  pseudo: string
  subject: string
  status: 'open' | 'closed'
  createdAt: string
  messages: { author: string; text: string; time: number }[]
}

interface Log {
  admin: string
  action: string
  target: string
  detail: string
  time: number
}

interface BotMatchResult {
  eloChange: number
  eloBefore: number
  eloAfter: number
  mode: string
  outcome: string
  rankChange: { from: string; to: string } | null
}

const LOG_COLORS: Record<string, string> = {
  BAN: '#ef4444', UNBAN: '#10b981', MUTE: '#f59e0b', UNMUTE: '#10b981',
  PREMIUM: '#f59e0b', REVOKE_PREMIUM: '#6b7280', ELO: '#6366f1',
  BOT_MATCH: '#ff4655', SET_CONTENT: '#06b6d4', REVOKE_CONTENT: '#6b7280',
}

export default function AdminPage() {
  const { user, isLoading } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab] = useState<AdminTab>('stats')
  const [adminKey, setAdminKey] = useState(localStorage.getItem('rv_admin_key') || '')
  const [stats, setStats] = useState<AdminStats | null>(null)

  // Players tab
  const [searchPseudo, setSearchPseudo] = useState('')
  const [foundUser, setFoundUser] = useState<FoundUser | null>(null)
  const [searching, setSearching] = useState(false)
  const [banReason, setBanReason] = useState('')
  const [muteDuration, setMuteDuration] = useState('60')
  const [premiumMonths, setPremiumMonths] = useState('1')
  const [eloMode, setEloMode] = useState('2v2')
  const [eloAmount, setEloAmount] = useState('0')
  const [coinsAmount, setCoinsAmount] = useState('100')

  // Simulation tab
  const [simUserId, setSimUserId] = useState('')
  const [simUserPseudo, setSimUserPseudo] = useState('')
  const [simSearchInput, setSimSearchInput] = useState('')
  const [simMode, setSimMode] = useState<'1v1' | '2v2' | '3v3' | '5v5'>('2v2')
  const [simOutcome, setSimOutcome] = useState<'win' | 'loss'>('win')
  const [simBotElo, setSimBotElo] = useState('500')
  const [simTeamSize, setSimTeamSize] = useState('1')
  const [simRunning, setSimRunning] = useState(false)
  const [simResult, setSimResult] = useState<BotMatchResult | null>(null)
  // Tickets & logs
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [logs, setLogs] = useState<Log[]>([])
  const [replyText, setReplyText] = useState<Record<string, string>>({})

  // Warn modal
  const [showWarnModal, setShowWarnModal] = useState(false)
  const [warnReason, setWarnReason] = useState('')

  // Detailed admin stats
  const [detailedStats, setDetailedStats] = useState<{
    totalUsers: number; todayUsers: number; weekUsers: number; onlineCount: number;
    totalMatches: number; modeMatches: Record<string, number>; totalClans: number;
    topPlayers: { pseudo: string; maxElo: number; totalWins: number }[];
    recentUsers: { pseudo: string; createdAt: string; banned: boolean }[];
    bannedCount: number; mutedCount: number; openTickets: number;
  } | null>(null)

  useEffect(() => {
    if (!isLoading && !user?.isAdmin) navigate('/app')
  }, [user, isLoading, navigate])

  useEffect(() => {
    api.get('/api/stats').then(res => setStats(res.data)).catch(() => {})
  }, [])

  useEffect(() => {
    if (tab === 'tickets') {
      api.get('/api/tickets', { headers: { 'x-admin-key': adminKey } })
        .then(res => setTickets(res.data || [])).catch(() => {})
    }
    if (tab === 'logs') {
      api.get('/api/admin/logs', { headers: { 'x-admin-key': adminKey } })
        .then(res => setLogs((res.data.logs || []).reverse())).catch(() => {})
    }
    if (tab === 'stats' && adminKey) {
      api.get('/api/admin/stats', { headers: { 'x-admin-key': adminKey } })
        .then(res => setDetailedStats(res.data)).catch(() => {})
    }
  }, [tab, adminKey])

  const saveKey = () => {
    localStorage.setItem('rv_admin_key', adminKey)
    toast.success('Clé sauvegardée')
  }

  const headers = { 'x-admin-key': adminKey, 'x-admin-pseudo': user?.pseudo || '' }

  const findUser = async () => {
    if (!searchPseudo.trim()) return
    setSearching(true)
    try {
      const res = await api.get(`/api/admin/find-user?pseudo=${encodeURIComponent(searchPseudo)}`, { headers })
      setFoundUser(res.data)
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      if (status === 403) toast.error('Clé admin incorrecte — sauvegarde-la en haut de la page')
      else if (status === 404) toast.error('Joueur introuvable')
      else toast.error(msg || 'Erreur réseau')
      setFoundUser(null)
    } finally {
      setSearching(false)
    }
  }

  const adminAction = async (path: string, body: Record<string, unknown>, successMsg: string) => {
    try {
      await api.post(path, body, { headers })
      toast.success(successMsg)
      findUser()
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Erreur admin')
    }
  }

  const findSimUser = async () => {
    if (!simSearchInput.trim()) return
    if (!adminKey.trim()) {
      toast.error('Entre et sauvegarde ta clé admin en haut de la page avant de chercher')
      return
    }
    try {
      const currentHeaders = { 'x-admin-key': adminKey, 'x-admin-pseudo': user?.pseudo || '' }
      const res = await api.get(`/api/admin/find-user?pseudo=${encodeURIComponent(simSearchInput.trim())}`, { headers: currentHeaders })
      setSimUserId(res.data.id)
      setSimUserPseudo(res.data.pseudo)
      setSimResult(null)
      toast.success(`Joueur trouvé : ${res.data.pseudo}`)
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      if (status === 403) toast.error('Clé admin incorrecte — vérifie la clé en haut de la page')
      else if (status === 404) toast.error(`Pseudo "${simSearchInput.trim()}" introuvable en base`)
      else toast.error(msg || 'Erreur réseau')
    }
  }

  const runBotMatch = async () => {
    if (!simUserId) { toast.error('Choisis un joueur d\'abord'); return }
    setSimRunning(true)
    setSimResult(null)
    try {
      const res = await api.post('/api/admin/bot-match', {
        userId: simUserId,
        mode: simMode,
        outcome: simOutcome,
        botElo: parseInt(simBotElo),
        teamSize: parseInt(simTeamSize),
      }, { headers })
      setSimResult(res.data)
      toast.success(`Simulation OK : ${res.data.eloChange > 0 ? '+' : ''}${res.data.eloChange} ELO`)
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      if (status === 403) toast.error('Clé admin incorrecte')
      else if (status === 404) toast.error('Joueur introuvable')
      else toast.error(msg || 'Erreur serveur — redémarre le serveur et réessaie')
    } finally {
      setSimRunning(false)
    }
  }

  const replyTicket = async (ticketId: string) => {
    const text = replyText[ticketId]
    if (!text?.trim()) return
    try {
      await api.post(`/api/tickets/${ticketId}/reply`, { author: user?.pseudo, message: text }, { headers: { 'x-admin-key': adminKey } })
      toast.success('Réponse envoyée')
      setReplyText(prev => ({ ...prev, [ticketId]: '' }))
      const res = await api.get('/api/tickets', { headers: { 'x-admin-key': adminKey } })
      setTickets(res.data || [])
    } catch { toast.error('Erreur') }
  }

  const closeTicket = async (ticketId: string) => {
    try {
      await api.post(`/api/tickets/${ticketId}/close`, {}, { headers: { 'x-admin-key': adminKey } })
      toast.success('Ticket fermé')
      setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, status: 'closed' } : t))
    } catch { toast.error('Erreur') }
  }

  if (!user?.isAdmin) return null

  const tabs: { key: AdminTab; label: string; icon: typeof Settings }[] = [
    { key: 'stats', label: 'Stats', icon: BarChart3 },
    { key: 'players', label: 'Joueurs', icon: Users },
    { key: 'simulation', label: 'Simulation', icon: Swords },
    { key: 'tickets', label: 'Tickets', icon: Ticket },
    { key: 'logs', label: 'Logs', icon: ScrollText },
  ]

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="font-display font-bold text-3xl flex items-center gap-3">
          <Settings size={28} style={{ color: '#ff4655' }} /> Panel Admin
        </h1>
        <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>Connecté en tant que <strong>{user?.pseudo}</strong></p>
      </div>

      {/* Admin key */}
      <div className="glass-card p-4 mb-6 flex items-center gap-3">
        <span className="text-sm font-semibold flex-shrink-0" style={{ color: 'rgba(255,255,255,0.5)' }}>Clé admin :</span>
        <input
          type="password"
          value={adminKey}
          onChange={e => setAdminKey(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && saveKey()}
          placeholder="••••••••"
          className="input-field py-2 flex-1"
        />
        <button onClick={saveKey} className="btn-ghost text-sm px-4 py-2 flex-shrink-0">Sauvegarder</button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm transition-all"
            style={{
              background: tab === t.key ? 'rgba(255,70,85,0.15)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${tab === t.key ? 'rgba(255,70,85,0.4)' : 'rgba(255,255,255,0.08)'}`,
              color: tab === t.key ? '#ff4655' : 'rgba(255,255,255,0.5)',
            }}
          >
            <t.icon size={13} />
            {t.label}
          </button>
        ))}
      </div>

      {/* ─── STATS ─── */}
      {tab === 'stats' && (
        <div className="space-y-6">
          {/* Basic stats cards */}
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Joueurs inscrits', value: stats.totalPlayers, color: '#ff4655' },
                { label: 'En ligne', value: stats.onlinePlayers, color: '#10b981' },
                { label: 'Rooms actives', value: stats.activeRooms, color: '#6366f1' },
                { label: 'Parties jouées', value: stats.totalMatches, color: '#f59e0b' },
              ].map(item => (
                <motion.div
                  key={item.label}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="glass-card p-5 text-center"
                >
                  <p className="font-display font-bold text-4xl mb-1" style={{ color: item.color }}>{item.value}</p>
                  <p className="text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>{item.label}</p>
                </motion.div>
              ))}
            </div>
          )}

          {/* Detailed stats (requires admin key) */}
          {detailedStats ? (
            <>
              {/* Extended cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'Nouveaux (today)', value: detailedStats.todayUsers, color: '#06b6d4' },
                  { label: 'Nouveaux (semaine)', value: detailedStats.weekUsers, color: '#8b5cf6' },
                  { label: 'Clans', value: detailedStats.totalClans, color: '#f97316' },
                  { label: 'Bannis', value: detailedStats.bannedCount, color: '#ef4444' },
                  { label: 'Mutés', value: detailedStats.mutedCount, color: '#f59e0b' },
                  { label: 'Tickets ouverts', value: detailedStats.openTickets, color: '#10b981' },
                ].map(item => (
                  <div key={item.label} className="glass-card p-4 text-center">
                    <p className="font-bold text-2xl mb-1" style={{ color: item.color }}>{item.value}</p>
                    <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{item.label}</p>
                  </div>
                ))}
              </div>

              {/* Mode breakdown */}
              <div className="glass-card p-5">
                <h3 className="text-sm font-bold mb-4 flex items-center gap-2">
                  <BarChart3 size={14} style={{ color: '#ff4655' }} />
                  Parties par mode
                </h3>
                {Object.entries(detailedStats.modeMatches).map(([mode, count]) => {
                  const total = Object.values(detailedStats.modeMatches).reduce((a, b) => a + b, 0)
                  const pct = total > 0 ? Math.round((count / total) * 100) : 0
                  return (
                    <div key={mode} className="mb-3">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="font-bold">{mode}</span>
                        <span style={{ color: 'rgba(255,255,255,0.4)' }}>{count} ({pct}%)</span>
                      </div>
                      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${pct}%`, background: 'linear-gradient(90deg,#ff4655,#8b5cf6)' }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Top players + Recent users */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Top 5 players */}
                <div className="glass-card p-5">
                  <h3 className="text-sm font-bold mb-4 flex items-center gap-2">
                    <Crown size={14} style={{ color: '#f59e0b' }} />
                    Top 5 Joueurs
                  </h3>
                  <div className="space-y-2">
                    {detailedStats.topPlayers.map((p, i) => (
                      <div key={p.pseudo} className="flex items-center gap-3 py-1">
                        <span className="text-xs font-bold w-5 text-center" style={{ color: i === 0 ? '#f59e0b' : 'rgba(255,255,255,0.3)' }}>
                          {i + 1}
                        </span>
                        <span className="flex-1 text-sm font-semibold truncate">{p.pseudo}</span>
                        <span className="text-xs font-bold" style={{ color: '#ff4655' }}>{p.maxElo} ELO</span>
                        <span className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>{p.totalWins}V</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Recent registrations */}
                <div className="glass-card p-5">
                  <h3 className="text-sm font-bold mb-4 flex items-center gap-2">
                    <Users size={14} style={{ color: '#10b981' }} />
                    Inscriptions récentes
                  </h3>
                  <div className="space-y-2">
                    {detailedStats.recentUsers.map(u => (
                      <div key={u.pseudo} className="flex items-center gap-3 py-1">
                        <span className="flex-1 text-sm font-semibold truncate" style={{ color: u.banned ? '#ef4444' : '#e8e8f0' }}>
                          {u.pseudo}
                          {u.banned && <span className="ml-1 text-xs">🚫</span>}
                        </span>
                        <span className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
                          {u.createdAt ? new Date(u.createdAt).toLocaleDateString('fr-FR') : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <p className="text-xs text-center py-4" style={{ color: 'rgba(255,255,255,0.3)' }}>
              Sauvegarde ta clé admin pour voir les statistiques détaillées
            </p>
          )}
        </div>
      )}

      {/* ─── PLAYERS ─── */}
      {tab === 'players' && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'rgba(255,255,255,0.3)' }} />
              <input
                value={searchPseudo}
                onChange={e => setSearchPseudo(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && findUser()}
                placeholder="Chercher un joueur…"
                className="input-field pl-9"
              />
            </div>
            <button onClick={findUser} disabled={searching} className="btn-primary px-5 text-sm">
              {searching ? '…' : 'Chercher'}
            </button>
          </div>

          {foundUser && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-5 space-y-5">
              {/* User header */}
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="font-display font-bold text-xl">{foundUser.pseudo}</h2>
                <span className="px-2 py-0.5 rounded text-xs font-bold"
                  style={{ background: foundUser.online ? 'rgba(16,185,129,0.15)' : 'rgba(107,114,128,0.15)', color: foundUser.online ? '#10b981' : '#6b7280' }}>
                  {foundUser.online ? '● En ligne' : '○ Hors ligne'}
                </span>
                {foundUser.banned && <span className="px-2 py-0.5 rounded text-xs font-bold" style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}>BANNI</span>}
                {foundUser.muted && <span className="px-2 py-0.5 rounded text-xs font-bold" style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}>MUTE</span>}
                {foundUser.isPremium && <span className="px-2 py-0.5 rounded text-xs font-bold" style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}>👑 PREMIUM</span>}
                {foundUser.isFondateur && <span className="px-2 py-0.5 rounded text-xs font-bold" style={{ background: 'rgba(124,58,237,0.15)', color: '#7c3aed' }}>⭐ FONDATEUR</span>}
                {foundUser.isContent && <span className="px-2 py-0.5 rounded text-xs font-bold" style={{ background: 'rgba(6,182,212,0.15)', color: '#06b6d4' }}>🎬 CONTENT</span>}
              </div>

              {/* Meta */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span style={{ color: 'rgba(255,255,255,0.4)' }}>ID : </span><span className="font-mono text-xs">{foundUser.id}</span></div>
                <div><span style={{ color: 'rgba(255,255,255,0.4)' }}>IP : </span>{foundUser.ip || '—'}</div>
                <div><span style={{ color: 'rgba(255,255,255,0.4)' }}>Créé le : </span>{new Date(foundUser.createdAt).toLocaleDateString('fr-FR')}</div>
                {foundUser.premiumUntil && (
                  <div><span style={{ color: 'rgba(255,255,255,0.4)' }}>Premium jusqu'au : </span>{new Date(foundUser.premiumUntil).toLocaleDateString('fr-FR')}</div>
                )}
                {foundUser.sameIpAccounts?.length > 0 && (
                  <div className="col-span-2">
                    <span style={{ color: '#f59e0b' }}>⚠ Comptes même IP : </span>
                    {foundUser.sameIpAccounts.map(a => a.pseudo).join(', ')}
                  </div>
                )}
              </div>

              {/* Stats per mode */}
              <div className="grid grid-cols-4 gap-2">
                {Object.entries(foundUser.stats || {}).map(([mode, s]) => (
                  <div key={mode} className="text-center p-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <p className="text-xs font-bold mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>{mode}</p>
                    <p className="font-bold text-lg" style={{ color: '#ff4655' }}>{s.elo}</p>
                    <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{s.wins}V / {s.losses}D</p>
                    {(s.currentStreak ?? 0) !== 0 && (
                      <p className="text-xs font-bold mt-1" style={{ color: (s.currentStreak ?? 0) > 0 ? '#10b981' : '#ef4444' }}>
                        {(s.currentStreak ?? 0) > 0 ? `🔥 +${s.currentStreak}` : `❄️ ${s.currentStreak}`}
                      </p>
                    )}
                  </div>
                ))}
              </div>

              {/* Actions */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>

                {/* Ban */}
                <div className="space-y-2">
                  <p className="text-xs font-bold uppercase tracking-wide" style={{ color: 'rgba(255,255,255,0.35)' }}>Ban / Unban</p>
                  <input className="input-field text-sm py-2" placeholder="Raison du ban…" value={banReason} onChange={e => setBanReason(e.target.value)} />
                  <div className="flex gap-2">
                    <button onClick={() => adminAction('/api/admin/ban', { userId: foundUser.id, reason: banReason }, 'Banni !')}
                      disabled={!!foundUser.banned}
                      className="flex items-center gap-1.5 btn-primary flex-1 text-sm py-2 justify-center"
                      style={{ opacity: foundUser.banned ? 0.5 : 1 }}>
                      <Ban size={12} /> Ban
                    </button>
                    <button onClick={() => adminAction('/api/admin/unban', { pseudo: foundUser.pseudo }, 'Débanni !')}
                      disabled={!foundUser.banned}
                      className="btn-ghost flex-1 text-sm py-2">
                      Unban
                    </button>
                  </div>
                </div>

                {/* Mute */}
                <div className="space-y-2">
                  <p className="text-xs font-bold uppercase tracking-wide" style={{ color: 'rgba(255,255,255,0.35)' }}>Mute / Unmute</p>
                  <input className="input-field text-sm py-2" placeholder="Durée en minutes (vide = permanent)" value={muteDuration} onChange={e => setMuteDuration(e.target.value)} />
                  <div className="flex gap-2">
                    <button onClick={() => adminAction('/api/admin/mute', { userId: foundUser.id, duration: muteDuration ? parseInt(muteDuration) : null }, 'Mute !')}
                      disabled={!!foundUser.muted}
                      className="flex items-center gap-1.5 btn-primary flex-1 text-sm py-2 justify-center"
                      style={{ opacity: foundUser.muted ? 0.5 : 1, background: 'linear-gradient(135deg,#f59e0b,#d97706)' }}>
                      <VolumeX size={12} /> Mute
                    </button>
                    <button onClick={() => adminAction('/api/admin/unmute', { pseudo: foundUser.pseudo }, 'Unmute !')}
                      disabled={!foundUser.muted}
                      className="flex items-center gap-1.5 btn-ghost flex-1 text-sm py-2 justify-center">
                      <Volume2 size={12} /> Unmute
                    </button>
                  </div>
                </div>

                {/* Premium */}
                <div className="space-y-2">
                  <p className="text-xs font-bold uppercase tracking-wide" style={{ color: 'rgba(255,255,255,0.35)' }}>Premium 👑</p>
                  <div className="flex gap-2 items-center">
                    <input className="input-field text-sm py-2 w-20" placeholder="Mois" value={premiumMonths} onChange={e => setPremiumMonths(e.target.value)} type="number" min="1" />
                    <button onClick={() => adminAction('/api/admin/premium', { userId: foundUser.id, months: parseInt(premiumMonths) }, 'Premium accordé !')}
                      className="btn-primary flex-1 text-sm py-2 flex items-center gap-1.5 justify-center"
                      style={{ background: 'linear-gradient(135deg,#f59e0b,#d97706)' }}>
                      <Crown size={12} /> Accorder
                    </button>
                    <button onClick={() => adminAction('/api/admin/revoke-premium', { userId: foundUser.id }, 'Premium révoqué')}
                      className="btn-ghost text-sm py-2 px-3">
                      Révoquer
                    </button>
                  </div>
                  <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
                    ℹ Le rang Fondateur ⭐ est auto-attribué au 1er octroi Premium.
                  </p>
                </div>

                {/* Content Creator */}
                <div className="space-y-2">
                  <p className="text-xs font-bold uppercase tracking-wide" style={{ color: 'rgba(255,255,255,0.35)' }}>Content Creator 🎬</p>
                  <div className="flex gap-2">
                    <button onClick={() => adminAction('/api/admin/set-content', { pseudo: foundUser.pseudo }, 'Content Creator accordé !')}
                      disabled={!!foundUser.isContent}
                      className="flex items-center gap-1.5 btn-primary flex-1 text-sm py-2 justify-center"
                      style={{ opacity: foundUser.isContent ? 0.5 : 1, background: 'linear-gradient(135deg,#06b6d4,#0284c7)' }}>
                      <Clapperboard size={12} /> Accorder
                    </button>
                    <button onClick={() => adminAction('/api/admin/revoke-content', { pseudo: foundUser.pseudo }, 'Content révoqué')}
                      disabled={!foundUser.isContent}
                      className="btn-ghost flex-1 text-sm py-2">
                      Révoquer
                    </button>
                  </div>
                  <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
                    Permet de créer des tournois + dashboard Content Creator.
                  </p>
                </div>

                {/* ELO */}
                <div className="space-y-2 md:col-span-2">
                  <p className="text-xs font-bold uppercase tracking-wide" style={{ color: 'rgba(255,255,255,0.35)' }}>Ajuster ELO manuellement</p>
                  <div className="flex gap-2">
                    <select className="input-field text-sm py-2" value={eloMode} onChange={e => setEloMode(e.target.value)} style={{ background: '#0e0e1a' }}>
                      {['1v1', '2v2', '3v3', '5v5'].map(m => <option key={m}>{m}</option>)}
                    </select>
                    <input className="input-field text-sm py-2 flex-1" placeholder="±ELO (ex: 100 ou -50)" value={eloAmount} onChange={e => setEloAmount(e.target.value)} />
                    <button onClick={() => adminAction('/api/admin/elo', { pseudo: foundUser.pseudo, mode: eloMode, amount: parseInt(eloAmount) }, 'ELO ajusté !')}
                      className="btn-primary text-sm py-2 px-4 flex items-center gap-1.5">
                      <Star size={12} /> Appliquer
                    </button>
                  </div>
                </div>

                {/* Coins */}
                <div className="space-y-2">
                  <p className="text-xs font-bold uppercase tracking-wide" style={{ color: 'rgba(255,255,255,0.35)' }}>🪙 Ajouter des Coins</p>
                  <div className="flex items-center gap-2 text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
                    <span>Solde actuel :</span>
                    <span className="font-bold" style={{ color: '#f59e0b' }}>{foundUser.coins ?? 0} 🪙</span>
                  </div>
                  <input
                    className="input-field text-sm py-2"
                    placeholder="Montant (négatif = retirer)"
                    value={coinsAmount}
                    onChange={e => setCoinsAmount(e.target.value)}
                    type="number"
                  />
                  <button
                    onClick={() => adminAction('/api/admin/add-coins', { userId: foundUser.id, amount: parseInt(coinsAmount) || 0 }, `${parseInt(coinsAmount) > 0 ? '+' : ''}${coinsAmount} coins appliqués !`)}
                    className="btn-ghost w-full text-sm py-2 flex items-center justify-center gap-1.5"
                    style={{ borderColor: 'rgba(245,158,11,0.3)', color: '#f59e0b' }}
                  >
                    💰 Appliquer
                  </button>
                </div>
              </div>

              {/* Warn + Delete */}
              <div className="pt-2 border-t flex items-center justify-between gap-2 flex-wrap" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                <button
                  onClick={() => { setShowWarnModal(true); setWarnReason('') }}
                  className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg transition-colors"
                  style={{ color: 'rgba(245,158,11,0.8)', border: '1px solid rgba(245,158,11,0.2)' }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#f59e0b')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'rgba(245,158,11,0.8)')}
                >
                  <AlertTriangle size={12} /> Avertir
                </button>
                <button
                  onClick={() => {
                    if (!window.confirm(`Supprimer définitivement ${foundUser.pseudo} ?`)) return
                    adminAction('/api/admin/delete-user', { pseudo: foundUser.pseudo }, 'Compte supprimé').then(() => setFoundUser(null))
                  }}
                  className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg transition-colors"
                  style={{ color: 'rgba(239,68,68,0.6)', border: '1px solid rgba(239,68,68,0.15)' }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'rgba(239,68,68,0.6)')}
                >
                  <Trash2 size={12} /> Supprimer le compte
                </button>
              </div>

              {/* Warn Modal */}
              {showWarnModal && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-3 p-4 rounded-xl"
                  style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.3)' }}
                >
                  <p className="text-sm font-bold mb-3 flex items-center gap-2" style={{ color: '#f59e0b' }}>
                    <AlertTriangle size={14} /> Avertir {foundUser.pseudo}
                  </p>
                  <textarea
                    value={warnReason}
                    onChange={e => setWarnReason(e.target.value)}
                    placeholder="Raison de l'avertissement…"
                    className="input-field text-sm w-full mb-3"
                    rows={3}
                    style={{ resize: 'vertical' }}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        if (!warnReason.trim()) { toast.error('Entrez une raison'); return }
                        socket.emit('warn_player', { targetPseudo: foundUser.pseudo, reason: warnReason.trim() })
                        toast.success(`Avertissement envoyé à ${foundUser.pseudo}`)
                        setShowWarnModal(false)
                        setWarnReason('')
                      }}
                      className="btn-primary text-sm py-2 px-4 flex items-center gap-1.5"
                      style={{ background: 'linear-gradient(135deg,#f59e0b,#d97706)' }}
                    >
                      <AlertTriangle size={12} /> Envoyer
                    </button>
                    <button onClick={() => setShowWarnModal(false)} className="btn-ghost text-sm py-2 px-4">
                      Annuler
                    </button>
                  </div>
                </motion.div>
              )}
            </motion.div>
          )}
        </div>
      )}

      {/* ─── SIMULATION ─── */}
      {tab === 'simulation' && (
        <div className="space-y-6">

          {/* Bot match card */}
          <div className="glass-card p-5">
            <h2 className="font-semibold mb-1 flex items-center gap-2">
              <Swords size={16} style={{ color: '#ff4655' }} />
              Simuler une partie contre des bots
            </h2>
            <p className="text-xs mb-5" style={{ color: 'rgba(255,255,255,0.4)' }}>
              Applique un résultat fictif à un joueur (ELO, wins/losses, match history, streak). Utile pour tester les seuils de rang et le système ELO.
            </p>

            {/* Step 1 */}
            <div className="mb-4">
              <p className="text-xs font-bold mb-2 uppercase tracking-wide" style={{ color: 'rgba(255,255,255,0.4)' }}>1. Sélectionner le joueur</p>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'rgba(255,255,255,0.3)' }} />
                  <input
                    className="input-field pl-9"
                    placeholder="Pseudo du joueur…"
                    value={simSearchInput}
                    onChange={e => setSimSearchInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && findSimUser()}
                  />
                </div>
                <button onClick={findSimUser} className="btn-primary text-sm px-4">Sélectionner</button>
              </div>
              {simUserPseudo && (
                <div className="mt-2 flex items-center gap-2 text-sm">
                  <CheckCircle size={14} style={{ color: '#10b981' }} />
                  <span>Joueur : <strong style={{ color: '#ff4655' }}>{simUserPseudo}</strong></span>
                  <button onClick={() => { setSimUserId(''); setSimUserPseudo(''); setSimResult(null) }}>
                    <XCircle size={14} style={{ color: 'rgba(255,255,255,0.3)' }} />
                  </button>
                </div>
              )}
            </div>

            {/* Step 2 */}
            <div className="mb-5">
              <p className="text-xs font-bold mb-3 uppercase tracking-wide" style={{ color: 'rgba(255,255,255,0.4)' }}>2. Paramètres</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs mb-1 block" style={{ color: 'rgba(255,255,255,0.5)' }}>Mode</label>
                  <select className="input-field text-sm py-2" value={simMode} onChange={e => setSimMode(e.target.value as typeof simMode)} style={{ background: '#0e0e1a' }}>
                    {['1v1', '2v2', '3v3', '5v5'].map(m => <option key={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs mb-1 block" style={{ color: 'rgba(255,255,255,0.5)' }}>Résultat</label>
                  <select className="input-field text-sm py-2" value={simOutcome} onChange={e => setSimOutcome(e.target.value as 'win' | 'loss')} style={{ background: '#0e0e1a' }}>
                    <option value="win">🏆 Victoire</option>
                    <option value="loss">💀 Défaite</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs mb-1 block" style={{ color: 'rgba(255,255,255,0.5)' }}>ELO des bots</label>
                  <input className="input-field text-sm py-2" type="number" min="0" max="2000" value={simBotElo} onChange={e => setSimBotElo(e.target.value)} placeholder="500" />
                </div>
                <div>
                  <label className="text-xs mb-1 block" style={{ color: 'rgba(255,255,255,0.5)' }}>Nb. bots adverses</label>
                  <input className="input-field text-sm py-2" type="number" min="1" max="5" value={simTeamSize} onChange={e => setSimTeamSize(e.target.value)} placeholder="1" />
                </div>
              </div>
            </div>

            <button
              onClick={runBotMatch}
              disabled={simRunning || !simUserId}
              className="btn-primary flex items-center gap-2 text-sm px-6 py-2.5"
              style={{ opacity: !simUserId ? 0.5 : 1 }}
            >
              <Swords size={14} />
              {simRunning ? 'Simulation en cours…' : 'Lancer la simulation'}
            </button>

            {simResult && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-4 p-4 rounded-xl"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                <p className="font-bold text-sm mb-3 flex items-center gap-2">
                  <Zap size={14} style={{ color: '#ff4655' }} />
                  Résultat — <span style={{ color: '#ff4655' }}>{simUserPseudo}</span>
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
                  {[
                    { label: 'Mode', value: simResult.mode, color: '#6366f1' },
                    { label: 'ELO avant', value: simResult.eloBefore, color: 'white' },
                    { label: 'Variation', value: `${simResult.eloChange >= 0 ? '+' : ''}${simResult.eloChange}`, color: simResult.eloChange >= 0 ? '#10b981' : '#ef4444' },
                    { label: 'ELO après', value: simResult.eloAfter, color: '#ff4655' },
                  ].map(item => (
                    <div key={item.label} className="p-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.04)' }}>
                      <p className="text-xs mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>{item.label}</p>
                      <p className="font-bold text-lg" style={{ color: item.color }}>{item.value}</p>
                    </div>
                  ))}
                </div>
                {simResult.rankChange && (
                  <div className="mt-3 p-2 rounded-lg text-center text-sm font-semibold" style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.2)' }}>
                    🏅 Changement de rang : {simResult.rankChange.from} → {simResult.rankChange.to}
                  </div>
                )}
              </motion.div>
            )}
          </div>


          {/* ELO formula reference */}
          <div className="glass-card p-5">
            <h2 className="font-semibold mb-3 flex items-center gap-2">
              <BarChart3 size={16} style={{ color: '#10b981' }} />
              Formule ELO — référence
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs mb-4">
              <div className="p-3 rounded-lg space-y-1" style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)' }}>
                <p className="font-bold text-sm mb-2" style={{ color: '#10b981' }}>🏆 Victoire</p>
                <p>Base : <strong>+15 ELO</strong></p>
                <p>Adversaire fort (+50 ELO d'écart) : jusqu'à <strong>+28</strong></p>
                <p>Adversaire faible (−50 ELO d'écart) : jusqu'à <strong>+4</strong></p>
              </div>
              <div className="p-3 rounded-lg space-y-1" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)' }}>
                <p className="font-bold text-sm mb-2" style={{ color: '#ef4444' }}>💀 Défaite</p>
                <p>Base : <strong>−10 ELO</strong></p>
                <p>Adversaire faible (+50 ELO d'écart) : jusqu'à <strong>−3</strong></p>
                <p>Adversaire fort (−50 ELO d'écart) : jusqu'à <strong>−22</strong></p>
              </div>
            </div>
            <div className="p-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <p className="text-xs font-bold mb-2" style={{ color: 'rgba(255,255,255,0.5)' }}>Seuils de rang</p>
              <div className="flex gap-4 flex-wrap text-xs">
                {[
                  { name: 'Silver',   range: '0 – 599',     color: '#9ca3af' },
                  { name: 'Gold',     range: '600 – 899',   color: '#f59e0b' },
                  { name: 'Platinum', range: '900 – 1199',  color: '#06b6d4' },
                  { name: 'Diamond',  range: '1200 – 1499', color: '#8b5cf6' },
                  { name: 'Immortal', range: '1500 – 1799', color: '#ef4444' },
                  { name: 'Radiant',  range: '1800+',       color: '#ff4655' },
                ].map(r => (
                  <div key={r.name} className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full" style={{ background: r.color }} />
                    <span style={{ color: r.color }}>{r.name}</span>
                    <span style={{ color: 'rgba(255,255,255,0.3)' }}>({r.range})</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── TICKETS ─── */}
      {tab === 'tickets' && (
        <div className="space-y-4">
          {tickets.length === 0 && (
            <div className="glass-card p-8 text-center" style={{ color: 'rgba(255,255,255,0.3)' }}>Aucun ticket</div>
          )}
          {tickets.map(ticket => (
            <div key={ticket.id} className="glass-card p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <span className="font-semibold">{ticket.subject}</span>
                  <span className="ml-2 text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>par {ticket.pseudo}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded text-xs font-bold"
                    style={{
                      background: ticket.status === 'open' ? 'rgba(16,185,129,0.15)' : 'rgba(107,114,128,0.15)',
                      color: ticket.status === 'open' ? '#10b981' : '#6b7280',
                    }}>
                    {ticket.status === 'open' ? 'OUVERT' : 'FERMÉ'}
                  </span>
                  {ticket.status === 'open' && (
                    <button onClick={() => closeTicket(ticket.id)} className="btn-ghost text-xs px-2 py-1">Fermer</button>
                  )}
                </div>
              </div>
              <div className="space-y-2 mb-3">
                {ticket.messages?.map((msg, i) => (
                  <div key={i} className="p-2 rounded-lg text-sm"
                    style={{ background: 'rgba(255,255,255,0.03)', borderLeft: `2px solid ${msg.author !== ticket.pseudo ? '#ff4655' : 'rgba(255,255,255,0.1)'}` }}>
                    <span className="font-semibold text-xs" style={{ color: msg.author !== ticket.pseudo ? '#ff4655' : 'rgba(255,255,255,0.6)' }}>
                      {msg.author}:
                    </span>
                    <span className="ml-2 text-xs">{msg.text}</span>
                  </div>
                ))}
              </div>
              {ticket.status === 'open' && (
                <div className="flex gap-2">
                  <input
                    value={replyText[ticket.id] || ''}
                    onChange={e => setReplyText(prev => ({ ...prev, [ticket.id]: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && replyTicket(ticket.id)}
                    placeholder="Répondre…"
                    className="input-field text-sm py-2 flex-1"
                  />
                  <button onClick={() => replyTicket(ticket.id)} className="btn-primary text-sm px-4 py-2">Envoyer</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ─── LOGS ─── */}
      {tab === 'logs' && (
        <div className="glass-card overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
            <span className="font-semibold text-sm">Journal des actions admin</span>
            <button
              onClick={() => api.get('/api/admin/logs', { headers }).then(res => setLogs((res.data.logs || []).reverse())).catch(() => {})}
              className="p-2 rounded-lg"
              style={{ background: 'rgba(255,255,255,0.06)' }}
            >
              <RefreshCw size={13} style={{ color: 'rgba(255,255,255,0.4)' }} />
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  {['Heure', 'Admin', 'Action', 'Cible', 'Détail'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold" style={{ color: 'rgba(255,255,255,0.4)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs.map((log, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                    <td className="px-4 py-2 text-xs font-mono" style={{ color: 'rgba(255,255,255,0.3)' }}>
                      {new Date(log.time).toLocaleString('fr-FR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                    </td>
                    <td className="px-4 py-2 text-xs font-semibold" style={{ color: '#ff4655' }}>{log.admin}</td>
                    <td className="px-4 py-2 text-xs">
                      <span className="px-1.5 py-0.5 rounded text-xs font-bold"
                        style={{
                          background: `${LOG_COLORS[log.action] || 'rgba(255,255,255,0.1)'}20`,
                          color: LOG_COLORS[log.action] || 'rgba(255,255,255,0.6)',
                          border: `1px solid ${LOG_COLORS[log.action] || 'rgba(255,255,255,0.08)'}40`,
                        }}>
                        {log.action}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs font-semibold">{log.target}</td>
                    <td className="px-4 py-2 text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>{log.detail}</td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr><td colSpan={5} className="text-center py-10" style={{ color: 'rgba(255,255,255,0.3)' }}>Aucun log</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
