import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Shield, Crown, Users, MessageCircle, Send, Lock, Search,
  UserPlus, UserMinus, CheckCircle, XCircle, RefreshCw,
  Trophy, Swords, Star, TrendingUp, LogOut
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import socket from '../lib/socket'
import api from '../lib/api'
import UserAvatar from '../components/UserAvatar'
import toast from 'react-hot-toast'

interface MemberData {
  id: string
  pseudo: string
  avatar?: string | null
  isLeader: boolean
  maxElo: number
}

interface JoinRequestData {
  id: string
  pseudo: string
  avatar?: string | null
}

interface ClanData {
  id: string
  name: string
  tag: string
  description: string
  leaderId: string
  members: MemberData[]
  joinRequests: JoinRequestData[]
  weeklyPoints: number
  bo3Wins: number
  bo3Losses: number
  bo3ReadyMembers?: string[]
}

interface ClanSummary {
  id: string
  name: string
  tag: string
  description: string
  leaderId: string
  memberCount: number
  totalElo: number
  weeklyPoints: number
  bo3Wins: number
  bo3Losses?: number
}

interface ClanChatMsg {
  pseudo: string
  text: string
  time: number
  avatar?: string | null
  isPremium?: boolean
}

interface ClanChallenge {
  id: string
  challengerClanId: string
  challengedClanId: string
  challengerName: string
  challengerTag: string
  challengedName: string
  challengedTag: string
  mode: string
  status: 'pending' | 'active' | 'finished'
  series?: [number, number]
}

type ClanTab = 'my-clan' | 'classement' | 'browse' | 'bo3'

export default function ClansPage() {
  const { user } = useAuth()
  const [clan, setClan] = useState<ClanData | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<ClanTab>('my-clan')

  // Create clan
  const [createName, setCreateName] = useState('')
  const [createTag, setCreateTag] = useState('')
  const [createDesc, setCreateDesc] = useState('')
  const [creating, setCreating] = useState(false)

  // Browse / join
  const [allClans, setAllClans] = useState<ClanSummary[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [joinSearch, setJoinSearch] = useState('')
  const [joining, setJoining] = useState(false)

  // Chat
  const [chatMessages, setChatMessages] = useState<ClanChatMsg[]>([])
  const [chatInput, setChatInput] = useState('')
  const [sendingMsg, setSendingMsg] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // BO3
  const [challenges, setChallenges] = useState<ClanChallenge[]>([])
  const [challengeTarget, setChallengeTarget] = useState('')
  const [challengeMode, setChallengeMode] = useState<'1v1' | '2v2' | '3v3' | '5v5'>('2v2')
  const [sendingChallenge, setSendingChallenge] = useState(false)
  const [incomingChallenge, setIncomingChallenge] = useState<{ id: string; from: string; tag: string; mode: string } | null>(null)

  const fetchMyClan = async () => {
    if (!user) return
    try {
      const res = await api.get(`/api/clans/user/${user.id}`)
      setClan(res.data)
      if (res.data) {
        fetchClanChat(res.data.id)
        fetchChallenges(res.data.id)
      }
    } catch {
      setClan(null)
    } finally {
      setLoading(false)
    }
  }

  const fetchClanChat = async (clanId: string) => {
    try {
      const res = await api.get(`/api/clans/${clanId}/chat`)
      setChatMessages(res.data || [])
    } catch {}
  }

  const fetchAllClans = async () => {
    try {
      const res = await api.get('/api/clans')
      setAllClans(res.data || [])
    } catch {}
  }

  const fetchChallenges = async (clanId: string) => {
    try {
      const res = await api.get(`/api/clans/${clanId}/challenges`)
      setChallenges(res.data || [])
    } catch {}
  }

  useEffect(() => {
    if (!user) return
    fetchMyClan()
    fetchAllClans()
  }, [user])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  // Socket events
  useEffect(() => {
    const onClanChatMsg = (data: { clanId: string; msg: ClanChatMsg }) => {
      if (clan && data.clanId === clan.id) {
        setChatMessages(prev => [...prev, data.msg].slice(-100))
      }
    }
    const onClanJoinRequest = () => fetchMyClan()

    const onChallengeReceived = (data: { challengeId: string; from: string; tag: string; mode: string }) => {
      setIncomingChallenge({ id: data.challengeId, from: data.from, tag: data.tag, mode: data.mode })
      toast(`⚔️ Défi reçu de [${data.tag}] ${data.from} — ${data.mode} !`, { duration: 8000 })
    }
    const onChallengeAccepted = () => {
      toast.success('🤝 Défi accepté ! La room va être créée…')
      if (clan) fetchChallenges(clan.id)
    }
    const onChallengeDeclined = (data: { by: string }) => {
      toast.error(`❌ [${data.by}] a refusé le défi`)
      setIncomingChallenge(null)
    }
    const onPointsUpdated = () => {
      fetchAllClans()
      if (clan) fetchMyClan()
    }
    const onBo3Won = (data: { opponentName: string; pointsGained: number }) => {
      toast.success(`🏆 Victoire BO3 vs ${data.opponentName} ! +${data.pointsGained} pts`)
      fetchMyClan()
    }
    const onBo3Lost = (data: { opponentName: string; pointsLost: number }) => {
      toast.error(`💀 Défaite BO3 vs ${data.opponentName} — -${data.pointsLost} pts`)
      fetchMyClan()
    }

    socket.on('clan_chat_msg', onClanChatMsg)
    socket.on('clan_join_request', onClanJoinRequest)
    socket.on('clan_challenge_received', onChallengeReceived)
    socket.on('clan_challenge_accepted', onChallengeAccepted)
    socket.on('clan_challenge_declined', onChallengeDeclined)
    socket.on('clan_points_updated', onPointsUpdated)
    socket.on('clan_bo3_won', onBo3Won)
    socket.on('clan_bo3_lost', onBo3Lost)

    return () => {
      socket.off('clan_chat_msg', onClanChatMsg)
      socket.off('clan_join_request', onClanJoinRequest)
      socket.off('clan_challenge_received', onChallengeReceived)
      socket.off('clan_challenge_accepted', onChallengeAccepted)
      socket.off('clan_challenge_declined', onChallengeDeclined)
      socket.off('clan_points_updated', onPointsUpdated)
      socket.off('clan_bo3_won', onBo3Won)
      socket.off('clan_bo3_lost', onBo3Lost)
    }
  }, [clan])

  const handleCreate = async () => {
    if (!createName || !createTag) { toast.error('Nom et tag requis'); return }
    if (!user?.isPremium) { toast.error('Création de clan réservée aux membres Premium'); return }
    setCreating(true)
    try {
      await api.post('/api/clans/create', {
        userId: user?.id, name: createName,
        tag: createTag.toUpperCase(), description: createDesc,
      })
      toast.success('Clan créé !')
      setCreateName(''); setCreateTag(''); setCreateDesc('')
      await fetchMyClan()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      if (msg === 'PREMIUM_REQUIRED') toast.error('Création réservée aux membres Premium')
      else toast.error(msg || 'Erreur lors de la création')
    } finally { setCreating(false) }
  }

  const handleJoinRequest = async (clanId: string) => {
    setJoining(true)
    try {
      await api.post('/api/clans/request', { userId: user?.id, clanId })
      toast.success('Demande envoyée au chef du clan !')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      toast.error(msg || 'Erreur')
    } finally { setJoining(false) }
  }

  const handleLeave = async () => {
    if (!clan) return
    if (!window.confirm('Quitter le clan ?')) return
    try {
      const res = await api.post('/api/clans/leave', { userId: user?.id, clanId: clan.id })
      if (res.data.dissolved) toast('Clan dissous (tu étais le chef)')
      else toast('Tu as quitté le clan')
      setClan(null); setChatMessages([])
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      toast.error(msg || 'Erreur')
    }
  }

  const handleKick = async (targetId: string, targetPseudo: string) => {
    if (!clan) return
    if (!window.confirm(`Exclure ${targetPseudo} ?`)) return
    try {
      await api.post('/api/clans/kick', { leaderId: user?.id, targetId, clanId: clan.id })
      toast.success(`${targetPseudo} exclu`)
      fetchMyClan()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      toast.error(msg || 'Erreur')
    }
  }

  const handleAccept = async (targetId: string) => {
    if (!clan) return
    try {
      await api.post('/api/clans/accept', { leaderId: user?.id, userId: targetId, clanId: clan.id })
      toast.success('Membre accepté !'); fetchMyClan()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      toast.error(msg || 'Erreur')
    }
  }

  const handleDecline = async (targetId: string) => {
    if (!clan) return
    try {
      await api.post('/api/clans/decline', { leaderId: user?.id, userId: targetId, clanId: clan.id })
      toast('Demande refusée'); fetchMyClan()
    } catch {}
  }

  const sendClanChat = async () => {
    if (!chatInput.trim() || !clan || sendingMsg) return
    setSendingMsg(true)
    try {
      await api.post(`/api/clans/${clan.id}/chat`, {
        userId: user?.id, pseudo: user?.pseudo, text: chatInput.trim(),
      })
      setChatInput('')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      toast.error(msg || 'Erreur envoi message')
    } finally { setSendingMsg(false) }
  }

  const handleSendChallenge = async () => {
    if (!clan || !user) return
    const target = allClans.find(c =>
      c.name.toLowerCase() === challengeTarget.toLowerCase() ||
      c.tag.toLowerCase() === challengeTarget.toLowerCase() ||
      c.id === challengeTarget
    )
    if (!target) { toast.error('Clan introuvable — essaie avec le tag exact'); return }
    if (target.id === clan.id) { toast.error('Tu ne peux pas te défier toi-même'); return }
    setSendingChallenge(true)
    try {
      await api.post('/api/clans/challenge', {
        leaderId: user.id,
        challengerClanId: clan.id,
        challengedClanId: target.id,
        mode: challengeMode,
      })
      toast.success(`⚔️ Défi envoyé à [${target.tag}] ${target.name} !`)
      setChallengeTarget('')
      if (clan) fetchChallenges(clan.id)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      toast.error(msg || 'Erreur lors du défi')
    } finally { setSendingChallenge(false) }
  }

  const handleRespondChallenge = async (challengeId: string, accept: boolean) => {
    if (!clan || !user) return
    try {
      await api.post('/api/clans/challenge/respond', { leaderId: user.id, challengeId, accept })
      if (accept) toast.success('✅ Défi accepté ! La room va être créée…')
      else toast('❌ Défi refusé')
      setIncomingChallenge(null)
      fetchChallenges(clan.id)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      toast.error(msg || 'Erreur')
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#ff4655 transparent transparent transparent' }} />
    </div>
  )

  // ── Leaderboard — available always ──
  const sortedClans = [...allClans].sort((a, b) => b.weeklyPoints - a.weeklyPoints)

  // ══════════════════════════════════════════════════════════════════
  // NO CLAN
  // ══════════════════════════════════════════════════════════════════
  if (!clan) {
    const filtered = allClans.filter(c =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.tag.toLowerCase().includes(searchQuery.toLowerCase())
    )

    return (
      <div className="p-6 max-w-5xl mx-auto">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="font-display font-black text-3xl flex items-center gap-3">
              <Shield size={28} color="#ff4655" /> Clans
            </h1>
            <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.35)' }}>Tu n'es dans aucun clan</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {([
            { key: 'my-clan', label: 'Créer / Rejoindre' },
            { key: 'classement', label: '🏆 Classement' },
            { key: 'browse', label: 'Parcourir' },
          ] as { key: ClanTab; label: string }[]).map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className="px-4 py-2 rounded-xl text-sm font-semibold transition-all"
              style={tab === t.key
                ? { background: 'rgba(255,70,85,0.15)', color: '#ff4655', border: '1px solid rgba(255,70,85,0.4)' }
                : { background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.07)' }
              }
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'my-clan' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Create */}
            <div className="rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <div className="flex items-center gap-2 mb-4">
                <Crown size={16} color="#f59e0b" />
                <h2 className="font-bold text-sm">Créer un clan</h2>
                {!user?.isPremium && <Lock size={12} color="#ff4655" />}
              </div>
              {!user?.isPremium && (
                <div className="p-3 rounded-xl mb-3 text-xs" style={{ background: 'rgba(255,70,85,0.08)', color: '#ff4655', border: '1px solid rgba(255,70,85,0.2)' }}>
                  👑 Réservé aux membres Premium
                </div>
              )}
              <div className="space-y-3">
                <input className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', color: '#e8e8f0' }}
                  placeholder="Nom du clan" value={createName}
                  onChange={e => setCreateName(e.target.value)} disabled={!user?.isPremium} />
                <input className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', color: '#e8e8f0' }}
                  placeholder="TAG (ex: RVG)" value={createTag}
                  onChange={e => setCreateTag(e.target.value.toUpperCase().slice(0, 4))}
                  maxLength={4} disabled={!user?.isPremium} />
                <textarea className="w-full px-3 py-2 rounded-xl text-sm outline-none resize-none"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', color: '#e8e8f0' }}
                  placeholder="Description (optionnel)" value={createDesc}
                  onChange={e => setCreateDesc(e.target.value)} rows={2} disabled={!user?.isPremium} />
                <button onClick={handleCreate} disabled={!user?.isPremium || creating}
                  className="w-full py-2.5 rounded-xl text-sm font-bold transition-all"
                  style={{ background: !user?.isPremium ? 'rgba(255,255,255,0.05)' : '#ff4655', color: !user?.isPremium ? 'rgba(255,255,255,0.3)' : '#fff', cursor: !user?.isPremium ? 'not-allowed' : 'pointer' }}>
                  {creating ? 'Création…' : 'Créer le clan'}
                </button>
              </div>
            </div>

            {/* Join */}
            <div className="rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <h2 className="font-bold text-sm mb-4">Rejoindre par ID</h2>
              <p className="text-xs mb-3" style={{ color: 'rgba(255,255,255,0.4)' }}>Entre l'ID ou parcours les clans pour envoyer une demande.</p>
              <div className="space-y-3">
                <input className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', color: '#e8e8f0' }}
                  placeholder="ID du clan" value={joinSearch}
                  onChange={e => setJoinSearch(e.target.value)} />
                <button onClick={() => { if (joinSearch.trim()) handleJoinRequest(joinSearch.trim()) }}
                  disabled={joining}
                  className="w-full py-2.5 rounded-xl text-sm font-bold transition-all"
                  style={{ background: 'rgba(255,70,85,0.12)', border: '1px solid rgba(255,70,85,0.3)', color: '#ff4655' }}>
                  {joining ? 'Envoi…' : 'Envoyer demande'}
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === 'classement' && <ClanLeaderboard clans={sortedClans} myClanId={null} />}

        {tab === 'browse' && (
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'rgba(255,255,255,0.3)' }} />
                <input className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm outline-none"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#e8e8f0' }}
                  placeholder="Rechercher un clan…" value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)} />
              </div>
              <button onClick={fetchAllClans}
                className="p-2.5 rounded-xl transition-all"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <RefreshCw size={14} style={{ color: 'rgba(255,255,255,0.5)' }} />
              </button>
            </div>
            <div className="space-y-2">
              {filtered.length === 0 && (
                <p className="text-center py-8 text-sm" style={{ color: 'rgba(255,255,255,0.25)' }}>Aucun clan trouvé</p>
              )}
              {filtered.map((c, i) => (
                <motion.div key={c.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                  className="flex items-center gap-4 px-4 py-3 rounded-xl"
                  style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center font-display font-bold text-xs flex-shrink-0"
                    style={{ background: 'rgba(255,70,85,0.1)', color: '#ff4655', border: '1px solid rgba(255,70,85,0.25)' }}>
                    [{c.tag}]
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">{c.name}</p>
                    <p className="text-xs truncate" style={{ color: 'rgba(255,255,255,0.35)' }}>{c.description || 'Pas de description'}</p>
                  </div>
                  <div className="flex items-center gap-5 flex-shrink-0 text-center">
                    <div><p className="text-xs font-bold" style={{ color: '#10b981' }}>{c.weeklyPoints}</p><p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>pts</p></div>
                    <div><p className="text-xs font-bold">{c.memberCount}/10</p><p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>membres</p></div>
                    <button onClick={() => handleJoinRequest(c.id)} disabled={joining}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-semibold"
                      style={{ background: 'rgba(255,70,85,0.1)', color: '#ff4655', border: '1px solid rgba(255,70,85,0.25)' }}>
                      <UserPlus size={11} /> Rejoindre
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════
  // IN A CLAN
  // ══════════════════════════════════════════════════════════════════
  const isLeader = clan.leaderId === user?.id
  const pendingChallenges = challenges.filter(ch => ch.status === 'pending')
  const activeChallenges = challenges.filter(ch => ch.status === 'active')
  const incomingChallengesForMe = pendingChallenges.filter(ch => ch.challengedClanId === clan.id)
  const sentChallenges = pendingChallenges.filter(ch => ch.challengerClanId === clan.id)

  return (
    <div className="p-6 max-w-5xl mx-auto">

      {/* Incoming challenge banner */}
      <AnimatePresence>
        {incomingChallenge && (
          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            className="mb-4 px-5 py-4 rounded-2xl flex items-center gap-4"
            style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.4)' }}
          >
            <Swords size={20} color="#f59e0b" />
            <div className="flex-1">
              <p className="font-bold text-sm" style={{ color: '#f59e0b' }}>
                ⚔️ Défi reçu de [{incomingChallenge.tag}] {incomingChallenge.from}
              </p>
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>Mode : {incomingChallenge.mode}</p>
            </div>
            {isLeader ? (
              <div className="flex gap-2">
                <button onClick={() => handleRespondChallenge(incomingChallenge.id, true)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold"
                  style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.4)', color: '#10b981' }}>
                  <CheckCircle size={14} /> Accepter
                </button>
                <button onClick={() => handleRespondChallenge(incomingChallenge.id, false)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold"
                  style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444' }}>
                  <XCircle size={14} /> Refuser
                </button>
              </div>
            ) : (
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>En attente de la décision du chef</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Clan header */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
        className="mb-5 px-6 py-5 rounded-2xl"
        style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center font-display font-black text-sm"
              style={{ background: 'rgba(255,70,85,0.12)', color: '#ff4655', border: '1px solid rgba(255,70,85,0.3)' }}>
              [{clan.tag}]
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-display font-black text-2xl">{clan.name}</h1>
                {isLeader && <Crown size={16} color="#f59e0b" />}
              </div>
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>ID: {clan.id}</p>
              {clan.description && <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.5)' }}>{clan.description}</p>}
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-center">
              <p className="font-black text-2xl" style={{ color: '#10b981' }}>{clan.weeklyPoints}</p>
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>Points semaine</p>
            </div>
            <div className="text-center">
              <p className="font-black text-2xl" style={{ color: '#f59e0b' }}>{clan.bo3Wins}</p>
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>BO3 wins</p>
            </div>
            <div className="text-center">
              <p className="font-black text-2xl" style={{ color: '#ef4444' }}>{clan.bo3Losses}</p>
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>BO3 losses</p>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Tabs */}
      <div className="flex gap-2 mb-5">
        {([
          { key: 'my-clan', label: '👥 Mon Clan' },
          { key: 'bo3', label: `⚔️ BO3${pendingChallenges.length + activeChallenges.length > 0 ? ` (${pendingChallenges.length + activeChallenges.length})` : ''}` },
          { key: 'classement', label: '🏆 Classement' },
          { key: 'browse', label: '🔍 Clans' },
        ] as { key: ClanTab; label: string }[]).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className="px-4 py-2 rounded-xl text-sm font-semibold transition-all"
            style={tab === t.key
              ? { background: 'rgba(255,70,85,0.15)', color: '#ff4655', border: '1px solid rgba(255,70,85,0.4)' }
              : { background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.07)' }
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── MY CLAN TAB ── */}
      {tab === 'my-clan' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Members */}
          <div className="rounded-2xl p-5 flex flex-col gap-4"
            style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <h2 className="font-bold text-sm flex items-center gap-2">
              <Users size={14} color="#ff4655" />
              Membres ({clan.members.length}/10)
            </h2>
            <div className="space-y-2 flex-1">
              {clan.members.map(member => (
                <div key={member.id} className="flex items-center gap-3 group py-1">
                  <UserAvatar pseudo={member.pseudo} avatar={member.avatar} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium truncate">{member.pseudo}</span>
                      {member.isLeader && <Crown size={10} color="#f59e0b" />}
                    </div>
                    <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>ELO max: {member.maxElo}</p>
                  </div>
                  {isLeader && !member.isLeader && (
                    <button onClick={() => handleKick(member.id, member.pseudo)}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded-lg transition-opacity"
                      style={{ color: '#ef4444' }} title="Exclure">
                      <UserMinus size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Join requests */}
            {isLeader && clan.joinRequests.length > 0 && (
              <div className="border-t pt-3" style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
                <p className="text-xs font-bold mb-2 uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  Demandes ({clan.joinRequests.length})
                </p>
                <div className="space-y-2">
                  {clan.joinRequests.map(req => (
                    <div key={req.id} className="flex items-center gap-2">
                      <UserAvatar pseudo={req.pseudo} avatar={req.avatar} size="sm" />
                      <span className="text-xs flex-1 truncate">{req.pseudo}</span>
                      <button onClick={() => handleAccept(req.id)} className="p-1 rounded" style={{ color: '#10b981' }}><CheckCircle size={14} /></button>
                      <button onClick={() => handleDecline(req.id)} className="p-1 rounded" style={{ color: '#ef4444' }}><XCircle size={14} /></button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button onClick={handleLeave}
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-semibold transition-all"
              style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.14)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.07)')}>
              <LogOut size={13} />
              {isLeader ? 'Dissoudre le clan' : 'Quitter le clan'}
            </button>
          </div>

          {/* Clan chat */}
          <div className="lg:col-span-2 rounded-2xl flex flex-col overflow-hidden"
            style={{ height: 440, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <div className="px-4 py-3 flex items-center gap-2 flex-shrink-0"
              style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <MessageCircle size={14} color="#ff4655" />
              <span className="text-sm font-bold">Chat du clan</span>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin" style={{ minHeight: 0 }}>
              {chatMessages.length === 0 && (
                <p className="text-xs text-center py-8" style={{ color: 'rgba(255,255,255,0.25)' }}>Pas encore de messages…</p>
              )}
              {chatMessages.map((msg, i) => (
                <div key={i} className="flex items-start gap-2">
                  <UserAvatar pseudo={msg.pseudo} avatar={msg.avatar} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-bold">{msg.pseudo}</span>
                      <span className="text-xs" style={{ color: 'rgba(255,255,255,0.2)' }}>
                        {new Date(msg.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-xs mt-0.5 break-words" style={{ color: 'rgba(255,255,255,0.7)' }}>{msg.text}</p>
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <div className="p-3 flex gap-2 flex-shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <input value={chatInput} onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendClanChat()}
                placeholder="Message au clan…" maxLength={300}
                className="flex-1 text-xs rounded-xl px-3 py-2 outline-none"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#e8e8f0' }} />
              <button onClick={sendClanChat} disabled={sendingMsg}
                className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-all"
                style={{ background: 'rgba(255,70,85,0.15)', color: '#ff4655' }}>
                <Send size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── BO3 TAB ── */}
      {tab === 'bo3' && (
        <div className="space-y-5">

          {/* Active matches */}
          {activeChallenges.length > 0 && (
            <div className="rounded-2xl p-5" style={{ background: 'rgba(16,185,129,0.05)', border: '1px solid rgba(16,185,129,0.2)' }}>
              <p className="text-sm font-bold mb-3" style={{ color: '#10b981' }}>🔥 Match en cours</p>
              {activeChallenges.map(ch => (
                <div key={ch.id} className="flex items-center gap-4 py-2">
                  <span className="font-bold">[{ch.challengerTag}] {ch.challengerName}</span>
                  <span className="font-black text-lg" style={{ color: '#ff4655' }}>VS</span>
                  <span className="font-bold">[{ch.challengedTag}] {ch.challengedName}</span>
                  <span className="ml-auto text-xs px-2 py-1 rounded-lg" style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981' }}>
                    {ch.mode}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Incoming challenges (for leader) */}
          {isLeader && incomingChallengesForMe.length > 0 && (
            <div className="rounded-2xl p-5" style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.25)' }}>
              <p className="text-sm font-bold mb-3" style={{ color: '#f59e0b' }}>⚔️ Défis reçus</p>
              {incomingChallengesForMe.map(ch => (
                <div key={ch.id} className="flex items-center gap-3 py-2">
                  <div className="flex-1">
                    <p className="text-sm font-semibold">[{ch.challengerTag}] {ch.challengerName}</p>
                    <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>Mode : {ch.mode}</p>
                  </div>
                  <button onClick={() => handleRespondChallenge(ch.id, true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold"
                    style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', color: '#10b981' }}>
                    <CheckCircle size={12} /> Accepter
                  </button>
                  <button onClick={() => handleRespondChallenge(ch.id, false)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold"
                    style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444' }}>
                    <XCircle size={12} /> Refuser
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Sent challenges */}
          {sentChallenges.length > 0 && (
            <div className="rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <p className="text-sm font-bold mb-3" style={{ color: 'rgba(255,255,255,0.6)' }}>⏳ Défis envoyés</p>
              {sentChallenges.map(ch => (
                <div key={ch.id} className="flex items-center gap-3 py-2">
                  <div className="flex-1">
                    <p className="text-sm font-semibold">[{ch.challengedTag}] {ch.challengedName}</p>
                    <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>Mode : {ch.mode} · En attente de réponse…</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Send challenge form */}
          {isLeader && (
            <div className="rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <div className="flex items-center gap-2 mb-4">
                <Swords size={16} color="#ff4655" />
                <h3 className="font-bold text-sm">Lancer un défi BO3</h3>
              </div>
              <div className="space-y-3">
                <div className="relative">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'rgba(255,255,255,0.3)' }} />
                  <input className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm outline-none"
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', color: '#e8e8f0' }}
                    placeholder="Nom ou TAG du clan adversaire…"
                    value={challengeTarget}
                    onChange={e => setChallengeTarget(e.target.value)} />
                </div>

                {/* Clan suggestions */}
                {challengeTarget.length >= 2 && (
                  <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
                    {allClans.filter(c =>
                      c.id !== clan.id &&
                      (c.name.toLowerCase().includes(challengeTarget.toLowerCase()) || c.tag.toLowerCase().includes(challengeTarget.toLowerCase()))
                    ).slice(0, 4).map(c => (
                      <button key={c.id}
                        onClick={() => setChallengeTarget(c.name)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-all"
                        style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,70,85,0.06)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}>
                        <span className="font-bold text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,70,85,0.15)', color: '#ff4655' }}>[{c.tag}]</span>
                        <span className="flex-1">{c.name}</span>
                        <span className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>{c.memberCount} membres</span>
                      </button>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-4 gap-2">
                  {(['1v1', '2v2', '3v3', '5v5'] as const).map(m => (
                    <button key={m} onClick={() => setChallengeMode(m)}
                      className="py-2 rounded-xl text-sm font-bold transition-all"
                      style={{
                        background: challengeMode === m ? 'rgba(255,70,85,0.15)' : 'rgba(255,255,255,0.04)',
                        border: `1px solid ${challengeMode === m ? 'rgba(255,70,85,0.4)' : 'rgba(255,255,255,0.08)'}`,
                        color: challengeMode === m ? '#ff4655' : 'rgba(255,255,255,0.5)',
                      }}>
                      {m}
                    </button>
                  ))}
                </div>

                <button onClick={handleSendChallenge} disabled={!challengeTarget.trim() || sendingChallenge}
                  className="w-full py-3 rounded-xl text-sm font-black flex items-center justify-center gap-2 transition-all"
                  style={{
                    background: !challengeTarget.trim() ? 'rgba(255,255,255,0.04)' : 'linear-gradient(135deg, #ff4655, #e03545)',
                    color: !challengeTarget.trim() ? 'rgba(255,255,255,0.3)' : '#fff',
                    cursor: !challengeTarget.trim() ? 'not-allowed' : 'pointer',
                  }}>
                  <Swords size={16} />
                  {sendingChallenge ? 'Envoi…' : `Défier en ${challengeMode}`}
                </button>
              </div>

              <div className="mt-4 p-3 rounded-xl text-xs" style={{ background: 'rgba(255,255,255,0.02)' }}>
                <p className="font-semibold mb-1" style={{ color: 'rgba(255,255,255,0.5)' }}>Comment ça marche ?</p>
                <ul className="space-y-1" style={{ color: 'rgba(255,255,255,0.3)' }}>
                  <li>1. Tu envoies un défi à un autre clan</li>
                  <li>2. Leur chef accepte ou refuse</li>
                  <li>3. Une room est créée automatiquement</li>
                  <li>4. Le gagnant remporte des points de classement</li>
                </ul>
              </div>
            </div>
          )}

          {!isLeader && challenges.length === 0 && (
            <div className="text-center py-12" style={{ color: 'rgba(255,255,255,0.3)' }}>
              <Swords size={32} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">Aucun défi en cours</p>
              <p className="text-xs mt-1">Seul le chef peut lancer des défis</p>
            </div>
          )}
        </div>
      )}

      {/* ── CLASSEMENT TAB ── */}
      {tab === 'classement' && <ClanLeaderboard clans={sortedClans} myClanId={clan.id} />}

      {/* ── BROWSE TAB ── */}
      {tab === 'browse' && (
        <div>
          <div className="flex items-center gap-3 mb-4">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'rgba(255,255,255,0.3)' }} />
              <input className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm outline-none"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#e8e8f0' }}
                placeholder="Rechercher…" value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)} />
            </div>
            <button onClick={fetchAllClans} className="p-2.5 rounded-xl"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <RefreshCw size={14} style={{ color: 'rgba(255,255,255,0.5)' }} />
            </button>
          </div>
          <div className="space-y-2">
            {allClans.filter(c =>
              c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
              c.tag.toLowerCase().includes(searchQuery.toLowerCase())
            ).map((c, i) => (
              <motion.div key={c.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                className="flex items-center gap-4 px-4 py-3 rounded-xl"
                style={{
                  background: c.id === clan.id ? 'rgba(255,70,85,0.06)' : 'rgba(255,255,255,0.02)',
                  border: `1px solid ${c.id === clan.id ? 'rgba(255,70,85,0.25)' : 'rgba(255,255,255,0.07)'}`,
                }}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center font-display font-bold text-xs flex-shrink-0"
                  style={{ background: 'rgba(255,70,85,0.1)', color: '#ff4655', border: '1px solid rgba(255,70,85,0.25)' }}>
                  [{c.tag}]
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-sm truncate">{c.name}</p>
                    {c.id === clan.id && <span className="text-xs px-1.5 py-0.5 rounded-full font-bold" style={{ background: 'rgba(255,70,85,0.15)', color: '#ff4655' }}>Mon clan</span>}
                  </div>
                  <p className="text-xs truncate" style={{ color: 'rgba(255,255,255,0.35)' }}>{c.description || 'Pas de description'}</p>
                </div>
                <div className="flex items-center gap-4 flex-shrink-0 text-center">
                  <div><p className="text-xs font-bold" style={{ color: '#10b981' }}>{c.weeklyPoints}</p><p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>pts</p></div>
                  <div><p className="text-xs font-bold">{c.memberCount}/10</p><p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>membres</p></div>
                  {c.id !== clan.id && isLeader && (
                    <button onClick={() => { setChallengeTarget(c.name); setTab('bo3') }}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-semibold"
                      style={{ background: 'rgba(255,70,85,0.1)', color: '#ff4655', border: '1px solid rgba(255,70,85,0.25)' }}>
                      <Swords size={11} /> Défier
                    </button>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Clan Leaderboard Component ───────────────────────────────────────────────
function ClanLeaderboard({ clans, myClanId }: { clans: ClanSummary[]; myClanId: string | null }) {
  const top3Colors = ['#f59e0b', '#9ca3af', '#cd7c2f']
  const top3Icons = ['🥇', '🥈', '🥉']

  return (
    <div className="space-y-2">
      {clans.length === 0 && (
        <div className="text-center py-16" style={{ color: 'rgba(255,255,255,0.25)' }}>
          <Trophy size={36} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Aucun clan pour l'instant</p>
        </div>
      )}

      {/* Top 3 podium */}
      {clans.length >= 3 && (
        <div className="grid grid-cols-3 gap-3 mb-5">
          {[clans[1], clans[0], clans[2]].map((c, i) => {
            const realRank = i === 0 ? 2 : i === 1 ? 1 : 3
            const realIdx = realRank - 1
            return (
              <motion.div key={c.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                className="relative flex flex-col items-center p-4 rounded-2xl text-center"
                style={{
                  background: `${top3Colors[realIdx]}10`,
                  border: `1px solid ${top3Colors[realIdx]}40`,
                  order: i === 1 ? -1 : 0,
                  marginTop: i === 1 ? 0 : 20,
                }}>
                <div className="text-3xl mb-2">{top3Icons[realIdx]}</div>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center font-display font-black text-xs mb-2"
                  style={{ background: `${top3Colors[realIdx]}20`, color: top3Colors[realIdx], border: `1px solid ${top3Colors[realIdx]}40` }}>
                  [{c.tag}]
                </div>
                <p className="font-bold text-sm truncate w-full">{c.name}</p>
                <p className="text-xs font-black mt-1" style={{ color: top3Colors[realIdx] }}>{c.weeklyPoints} pts</p>
                <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.3)' }}>{c.bo3Wins}W / {c.bo3Losses || 0}L</p>
                {c.id === myClanId && (
                  <div className="absolute top-2 right-2 w-2 h-2 rounded-full" style={{ background: '#10b981' }} />
                )}
              </motion.div>
            )
          })}
        </div>
      )}

      {/* Full list */}
      {clans.map((c, i) => (
        <motion.div key={c.id}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: Math.min(i * 0.04, 0.4) }}
          className="flex items-center gap-4 px-4 py-3 rounded-xl transition-all"
          style={{
            background: c.id === myClanId ? 'rgba(255,70,85,0.06)' : 'rgba(255,255,255,0.02)',
            border: `1px solid ${c.id === myClanId ? 'rgba(255,70,85,0.25)' : 'rgba(255,255,255,0.06)'}`,
          }}>
          {/* Rank */}
          <div className="w-8 text-center flex-shrink-0">
            {i < 3 ? (
              <span className="text-lg">{top3Icons[i]}</span>
            ) : (
              <span className="text-sm font-black" style={{ color: 'rgba(255,255,255,0.3)' }}>#{i + 1}</span>
            )}
          </div>

          {/* Tag */}
          <div className="w-12 h-9 rounded-lg flex items-center justify-center font-display font-black text-xs flex-shrink-0"
            style={{ background: 'rgba(255,70,85,0.1)', color: '#ff4655', border: '1px solid rgba(255,70,85,0.2)' }}>
            [{c.tag}]
          </div>

          {/* Name */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-bold text-sm truncate">{c.name}</p>
              {c.id === myClanId && <span className="text-xs font-bold" style={{ color: '#10b981' }}>← Mon clan</span>}
            </div>
            <div className="flex items-center gap-3 mt-0.5">
              <span className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>{c.memberCount} membres</span>
              <span className="text-xs font-bold" style={{ color: '#10b981' }}>{c.bo3Wins}W</span>
              <span className="text-xs font-bold" style={{ color: '#ef4444' }}>{c.bo3Losses || 0}L</span>
            </div>
          </div>

          {/* Points */}
          <div className="text-right flex-shrink-0">
            <p className="font-black text-lg" style={{ color: i === 0 ? '#f59e0b' : i === 1 ? '#9ca3af' : i === 2 ? '#cd7c2f' : '#e8e8f0' }}>
              {c.weeklyPoints}
            </p>
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>points</p>
          </div>

          {/* Trend icon */}
          <TrendingUp size={14} style={{ color: i < 3 ? top3Colors[i] : 'rgba(255,255,255,0.15)', flexShrink: 0 }} />
        </motion.div>
      ))}
    </div>
  )
}
