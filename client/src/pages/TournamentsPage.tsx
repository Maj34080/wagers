import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Trophy, Calendar, Users, Clock, Plus, RefreshCw, ChevronRight, Lock, XCircle } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import api from '../lib/api'
import socket from '../lib/socket'
import toast from 'react-hot-toast'

interface TournamentTeam {
  captainId: string
  captainPseudo: string
  clanTag: string
  teamName: string
  memberIds: string[]
}

interface Tournament {
  id: string
  name: string
  mode: '1v1' | '2v2' | '3v3' | '5v5'
  teamSize: number
  maxTeams: number
  description: string
  creatorId: string
  creatorPseudo: string
  status: 'open' | 'full' | 'in_progress' | 'finished' | 'cancelled'
  teams: TournamentTeam[]
  teamCount: number
  scheduledAt: number
  createdAt: number
}

const MODE_COLORS: Record<string, string> = {
  '1v1': '#f59e0b',
  '2v2': '#10b981',
  '3v3': '#6366f1',
  '5v5': '#ff4655',
}

const STATUS_LABELS: Record<string, string> = {
  open: 'Ouvert',
  full: 'Complet',
  in_progress: 'En cours',
  finished: 'Terminé',
  cancelled: 'Annulé',
}

const STATUS_COLORS: Record<string, string> = {
  open: '#10b981',
  full: '#f59e0b',
  in_progress: '#6366f1',
  finished: 'rgba(255,255,255,0.3)',
  cancelled: '#ef4444',
}

function formatDate(ts: number) {
  return new Date(ts).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function timeUntil(ts: number) {
  const diff = ts - Date.now()
  if (diff <= 0) return 'Démarré'
  const days = Math.floor(diff / 86400000)
  const hours = Math.floor((diff % 86400000) / 3600000)
  const mins = Math.floor((diff % 3600000) / 60000)
  if (days > 0) return `Dans ${days}j ${hours}h`
  if (hours > 0) return `Dans ${hours}h ${mins}min`
  return `Dans ${mins}min`
}

export default function TournamentsPage() {
  const { user } = useAuth()
  const [tournaments, setTournaments] = useState<Tournament[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Tournament | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  // Create form
  const [cName, setCName] = useState('')
  const [cMode, setCMode] = useState<'1v1' | '2v2' | '3v3' | '5v5'>('5v5')
  const [cMaxTeams, setCMaxTeams] = useState(8)
  const [cDesc, setCDesc] = useState('')
  const [cScheduled, setCScheduled] = useState('')
  const [creating, setCreating] = useState(false)

  const fetchTournaments = async () => {
    try {
      const res = await api.get('/api/tournaments')
      setTournaments(res.data || [])
    } catch {
      toast.error('Erreur chargement des tournois')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTournaments()
  }, [])

  useEffect(() => {
    const onCreated = () => fetchTournaments()
    const onCancelled = ({ id }: { id: string }) => {
      setTournaments(prev => prev.filter(t => t.id !== id))
      if (selected?.id === id) setSelected(null)
    }
    socket.on('tournament_created', onCreated)
    socket.on('tournament_cancelled', onCancelled)
    return () => {
      socket.off('tournament_created', onCreated)
      socket.off('tournament_cancelled', onCancelled)
    }
  }, [selected])

  const handleCreate = async () => {
    if (!cName.trim()) { toast.error('Nom requis'); return }
    if (!cScheduled) { toast.error('Date requise'); return }
    setCreating(true)
    try {
      await api.post('/api/tournaments/create', {
        userId: user?.id,
        name: cName.trim(),
        mode: cMode,
        maxTeams: cMaxTeams,
        description: cDesc.trim(),
        scheduledAt: new Date(cScheduled).toISOString(),
      })
      toast.success('Tournoi créé !')
      setShowCreate(false)
      setCName('')
      setCMode('5v5')
      setCMaxTeams(8)
      setCDesc('')
      setCScheduled('')
      fetchTournaments()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      if (msg === 'CONTENT_REQUIRED') toast.error('Réservé aux Content Creators et Admins')
      else toast.error(msg || 'Erreur création')
    } finally {
      setCreating(false)
    }
  }

  const isContentOrAdmin = user?.isAdmin || user?.isContent

  const handleAdminCancelTournament = async (e: React.MouseEvent, tournamentId: string) => {
    e.stopPropagation()
    if (!window.confirm('Fermer ce tournoi ? Cette action est irréversible.')) return
    try {
      const adminKey = localStorage.getItem('rv_admin_key') || ''
      await api.post('/api/admin/cancel-tournament', { tournamentId }, {
        headers: { 'x-admin-key': adminKey, 'x-admin-pseudo': user?.pseudo || '' },
      })
      toast.success('Tournoi fermé')
      setTournaments(prev => prev.filter(t => t.id !== tournamentId))
      if (selected?.id === tournamentId) setSelected(null)
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Erreur')
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
    </div>
  )

  // ─── TOURNAMENT DETAIL ───
  if (selected) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <button
          onClick={() => setSelected(null)}
          className="mb-4 flex items-center gap-2 text-sm"
          style={{ color: 'rgba(255,255,255,0.5)' }}
        >
          ← Retour aux tournois
        </button>

        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-6 mb-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <span
                  className="px-2 py-0.5 rounded text-xs font-bold"
                  style={{ background: `${MODE_COLORS[selected.mode]}20`, color: MODE_COLORS[selected.mode], border: `1px solid ${MODE_COLORS[selected.mode]}40` }}
                >
                  {selected.mode.toUpperCase()}
                </span>
                <span
                  className="px-2 py-0.5 rounded text-xs font-semibold"
                  style={{ background: `${STATUS_COLORS[selected.status]}20`, color: STATUS_COLORS[selected.status] }}
                >
                  {STATUS_LABELS[selected.status]}
                </span>
              </div>
              <h1 className="font-display font-bold text-2xl mb-1">{selected.name}</h1>
              {selected.description && (
                <p className="text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>{selected.description}</p>
              )}
              <p className="text-xs mt-2" style={{ color: 'rgba(255,255,255,0.35)' }}>
                Créé par <strong>{selected.creatorPseudo}</strong>
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="text-right">
                <p className="font-bold text-xl">{selected.teams.length}/{selected.maxTeams}</p>
                <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>équipes</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold" style={{ color: '#f59e0b' }}>{timeUntil(selected.scheduledAt)}</p>
                <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{formatDate(selected.scheduledAt)}</p>
              </div>
            </div>
          </div>
        </motion.div>

        <div className="glass-card p-5">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <Users size={14} style={{ color: '#ff4655' }} />
            Équipes inscrites ({selected.teams.length}/{selected.maxTeams})
          </h2>
          {selected.teams.length === 0 ? (
            <p className="text-sm text-center py-6" style={{ color: 'rgba(255,255,255,0.3)' }}>
              Aucune équipe inscrite pour le moment
            </p>
          ) : (
            <div className="space-y-2">
              {selected.teams.map((team, i) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)' }}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs flex-shrink-0"
                    style={{ background: 'rgba(255,70,85,0.15)', color: '#ff4655' }}>
                    #{i + 1}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold">{team.teamName}</p>
                    <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
                      Cap: {team.captainPseudo} · [{team.clanTag}]
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ─── MAIN LIST ───
  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display font-bold text-3xl flex items-center gap-3">
            <Trophy size={28} style={{ color: '#ff4655' }} /> Tournois
          </h1>
          <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
            {tournaments.length} tournoi{tournaments.length !== 1 ? 's' : ''} actif{tournaments.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchTournaments} className="p-2.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <RefreshCw size={14} style={{ color: 'rgba(255,255,255,0.5)' }} />
          </button>
          {isContentOrAdmin && (
            <button
              onClick={() => setShowCreate(v => !v)}
              className="btn-primary flex items-center gap-2 text-sm px-4 py-2"
            >
              <Plus size={14} />
              Créer un tournoi
            </button>
          )}
          {!isContentOrAdmin && (
            <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.3)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <Lock size={12} />
              Content Creator requis
            </div>
          )}
        </div>
      </div>

      {/* Create form */}
      {showCreate && isContentOrAdmin && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="glass-card p-5 mb-6"
        >
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <Plus size={14} style={{ color: '#ff4655' }} />
            Nouveau tournoi
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold mb-1 block" style={{ color: 'rgba(255,255,255,0.5)' }}>Nom *</label>
              <input className="input-field" placeholder="Nom du tournoi" value={cName} onChange={e => setCName(e.target.value)} maxLength={32} />
            </div>
            <div>
              <label className="text-xs font-semibold mb-1 block" style={{ color: 'rgba(255,255,255,0.5)' }}>Mode *</label>
              <select
                className="input-field"
                value={cMode}
                onChange={e => setCMode(e.target.value as typeof cMode)}
                style={{ background: '#0e0e1a' }}
              >
                {['1v1', '2v2', '3v3', '5v5'].map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold mb-1 block" style={{ color: 'rgba(255,255,255,0.5)' }}>Nombre d'équipes max *</label>
              <select
                className="input-field"
                value={cMaxTeams}
                onChange={e => setCMaxTeams(Number(e.target.value))}
                style={{ background: '#0e0e1a' }}
              >
                {[4, 8, 16].map(n => <option key={n} value={n}>{n} équipes</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold mb-1 block" style={{ color: 'rgba(255,255,255,0.5)' }}>Date de début * (min +24h)</label>
              <input
                className="input-field"
                type="datetime-local"
                value={cScheduled}
                onChange={e => setCScheduled(e.target.value)}
                style={{ colorScheme: 'dark' }}
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs font-semibold mb-1 block" style={{ color: 'rgba(255,255,255,0.5)' }}>Description</label>
              <textarea className="input-field resize-none" placeholder="Description (optionnel)" value={cDesc} onChange={e => setCDesc(e.target.value)} rows={2} maxLength={120} />
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={handleCreate} disabled={creating} className="btn-primary text-sm px-6 py-2">
              {creating ? 'Création…' : 'Créer le tournoi'}
            </button>
            <button onClick={() => setShowCreate(false)} className="btn-ghost text-sm px-4 py-2">
              Annuler
            </button>
          </div>
        </motion.div>
      )}

      {/* Tournament list */}
      {tournaments.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Trophy size={48} className="mx-auto mb-4" style={{ color: 'rgba(255,255,255,0.1)' }} />
          <p className="text-lg font-semibold" style={{ color: 'rgba(255,255,255,0.3)' }}>Aucun tournoi en cours</p>
          <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.2)' }}>
            Les Content Creators peuvent en créer un
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {tournaments.map((t, i) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              onClick={() => setSelected(t)}
              className="glass-card p-5 cursor-pointer group transition-all"
              style={{ borderColor: 'rgba(255,255,255,0.06)' }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(255,70,85,0.2)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)')}
            >
              <div className="flex items-center gap-4">
                {/* Mode badge */}
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center font-display font-bold text-sm flex-shrink-0"
                  style={{ background: `${MODE_COLORS[t.mode]}15`, color: MODE_COLORS[t.mode], border: `1px solid ${MODE_COLORS[t.mode]}30` }}
                >
                  {t.mode}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold truncate">{t.name}</h3>
                    <span
                      className="px-1.5 py-0.5 rounded text-xs font-semibold flex-shrink-0"
                      style={{ background: `${STATUS_COLORS[t.status]}15`, color: STATUS_COLORS[t.status] }}
                    >
                      {STATUS_LABELS[t.status]}
                    </span>
                  </div>
                  {t.description && (
                    <p className="text-xs truncate mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>{t.description}</p>
                  )}
                  <div className="flex items-center gap-4 text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
                    <span className="flex items-center gap-1">
                      <Users size={10} />
                      {t.teamCount}/{t.maxTeams} équipes
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock size={10} />
                      {timeUntil(t.scheduledAt)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar size={10} />
                      {formatDate(t.scheduledAt)}
                    </span>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="hidden md:flex flex-col items-end gap-1 flex-shrink-0">
                  <div className="w-24 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${(t.teamCount / t.maxTeams) * 100}%`,
                        background: t.teamCount >= t.maxTeams ? '#f59e0b' : '#10b981'
                      }}
                    />
                  </div>
                  <span className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
                    {t.teamCount}/{t.maxTeams}
                  </span>
                </div>

                <ChevronRight size={16} className="flex-shrink-0 transition-transform group-hover:translate-x-1" style={{ color: 'rgba(255,255,255,0.3)' }} />

                {/* Admin close button */}
                {user?.isAdmin && (t.status === 'in_progress' || t.status === 'open' || t.status === 'full') && (
                  <button
                    onClick={e => handleAdminCancelTournament(e, t.id)}
                    className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all"
                    style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.25)' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.25)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.1)' }}
                  >
                    <XCircle size={11} />
                    Fermer
                  </button>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}
