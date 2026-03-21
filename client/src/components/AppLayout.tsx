import { useState, useEffect, useRef } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard, Sword, Trophy, Shield, Users, Headphones,
  Settings, LogOut, Zap, Circle, Calendar, Clapperboard,
  Bell, Gavel, Eye, X, ShoppingBag, XCircle, BookOpen, AlertTriangle, Gift
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import socket from '../lib/socket'
import api from '../lib/api'
import UserAvatar from './UserAvatar'
import RankBadge from './RankBadge'
import GlobalChat from './GlobalChat'

interface SeasonData {
  season: { number: number; endsAt: string }
}

interface AppNotif {
  id: number
  icon: string
  text: string
  time: number
  color: string
}

interface AdminAlert {
  roomId: string
  type: 'conflict' | 'decision' | 'report'
  pseudo: string
  time: number
}

interface AdminRoomData {
  roomId: string
  mode: string
  team1: { pseudo: string; elo: number; avatar: string | null }[]
  team2: { pseudo: string; elo: number; avatar: string | null }[]
}

export default function AppLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [onlineCount, setOnlineCount] = useState(0)
  const [season, setSeason] = useState<SeasonData | null>(null)
  const [adminWarning, setAdminWarning] = useState<{ reason: string; admin: string } | null>(null)
  const [xpToast, setXpToast] = useState<{ xpGained: number; level: number; levelUp: boolean } | null>(null)
  const [userXp, setUserXp] = useState<number>(user?.xp || 0)
  const [userLevel, setUserLevel] = useState<number>(user?.battlePassLevel || 0)

  // ── Admin alert system (active on all pages) ──
  const [alerts, setAlerts] = useState<AdminAlert[]>([])
  const [showAlerts, setShowAlerts] = useState(false)
  const [adminRoom, setAdminRoom] = useState<AdminRoomData | null>(null)
  const [decidingWinner, setDecidingWinner] = useState<0 | 1 | 2 | null>(null)
  const alertPanelRef = useRef<HTMLDivElement>(null)

  // ── Global notifications (tous les joueurs) ──
  const [notifs, setNotifs] = useState<AppNotif[]>([])
  const [showNotifs, setShowNotifs] = useState(false)
  const [unreadNotifs, setUnreadNotifs] = useState(0)
  const notifPanelRef = useRef<HTMLDivElement>(null)
  const notifIdRef = useRef(0)

  const pushNotif = (icon: string, text: string, color = '#ff4655') => {
    const id = ++notifIdRef.current
    setNotifs(prev => [{ id, icon, text, time: Date.now(), color }, ...prev].slice(0, 30))
    setUnreadNotifs(c => c + 1)
  }

  useEffect(() => {
    api.get('/api/stats').then(res => setOnlineCount(res.data.onlinePlayers || 0)).catch(() => {})
    api.get('/api/season').then(res => setSeason(res.data)).catch(() => {})
  }, [])

  useEffect(() => {
    const handler = () => {
      api.get('/api/stats').then(res => setOnlineCount(res.data.onlinePlayers || 0)).catch(() => {})
    }
    socket.on('connect', handler)
    socket.on('disconnect', handler)
    return () => { socket.off('connect', handler); socket.off('disconnect', handler) }
  }, [])

  // ── Notifications globales pour tous les joueurs ──
  useEffect(() => {
    const onGameResult = (data: { winner: number; winTeam: string[]; loseTeam: string[] }) => {
      const pseudo = user?.pseudo
      if (!pseudo) return
      const isWin = data.winTeam?.includes(pseudo)
      const isDraw = data.winner === 0
      if (isDraw) pushNotif('⚖️', 'Partie terminée — Égalité !', '#f59e0b')
      else if (isWin) pushNotif('🏆', 'Victoire ! Tu as gagné cette partie.', '#10b981')
      else pushNotif('💀', 'Défaite — retente ta chance !', '#ef4444')
    }
    const onRoomReady = () => {
      pushNotif('⚔️', 'Adversaire trouvé ! La partie commence.', '#ff4655')
    }
    const onTournamentStarted = (data: { name: string }) => {
      pushNotif('🏆', `Tournoi "${data.name}" a démarré !`, '#f59e0b')
    }
    const onTournamentFinished = (data: { name: string; champion: string }) => {
      pushNotif('🥇', `${data.champion} remporte "${data.name}" !`, '#f59e0b')
    }
    const onClanChallengeReceived = (data: { challengerTag: string }) => {
      pushNotif('⚔️', `Le clan [${data.challengerTag}] vous défie en BO3 !`, '#8b5cf6')
    }
    const onReportReceived = (data: { target: string; reason: string; reporter: string }) => {
      if (user?.isAdmin) pushNotif('🚨', `Signalement : ${data.target} (${data.reason}) par ${data.reporter}`, '#ef4444')
    }
    const onAdminWarning = ({ reason, admin }: { reason: string; admin: string }) => {
      setAdminWarning({ reason, admin })
    }
    const onXpGained = (data: { xpGained: number; xp: number; level: number; levelUp: boolean }) => {
      setUserXp(data.xp)
      setUserLevel(data.level)
      setXpToast({ xpGained: data.xpGained, level: data.level, levelUp: data.levelUp })
      setTimeout(() => setXpToast(null), 3000)
      if (data.levelUp) {
        pushNotif('⭐', `Niveau ${data.level} atteint sur le Passe de Combat !`, '#f59e0b')
      }
    }
    socket.on('game_result', onGameResult)
    socket.on('room_ready', onRoomReady)
    socket.on('tournament_started', onTournamentStarted)
    socket.on('tournament_finished', onTournamentFinished)
    socket.on('clan_challenge_received', onClanChallengeReceived)
    socket.on('player_reported', onReportReceived)
    socket.on('admin_warning', onAdminWarning)
    socket.on('xp_gained', onXpGained)
    return () => {
      socket.off('game_result', onGameResult)
      socket.off('room_ready', onRoomReady)
      socket.off('tournament_started', onTournamentStarted)
      socket.off('tournament_finished', onTournamentFinished)
      socket.off('clan_challenge_received', onClanChallengeReceived)
      socket.off('player_reported', onReportReceived)
      socket.off('admin_warning', onAdminWarning)
      socket.off('xp_gained', onXpGained)
    }
  }, [user?.pseudo, user?.isAdmin])

  // Close notif panel on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (notifPanelRef.current && !notifPanelRef.current.contains(e.target as Node)) {
        setShowNotifs(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // ── Admin socket events — mounted globally so they fire on ANY page ──
  useEffect(() => {
    if (!user?.isAdmin) return

    // Activate admin mode on the socket so server knows we're listening
    socket.emit('set_admin_mode', { active: true })

    const onAlert = (data: { roomId: string; type: string; pseudo: string }) => {
      const alert: AdminAlert = {
        roomId: data.roomId,
        type: data.type as AdminAlert['type'],
        pseudo: data.pseudo,
        time: Date.now(),
      }
      setAlerts(prev => [alert, ...prev].slice(0, 20))
      setShowAlerts(true)
    }

    const onJoined = (data: AdminRoomData) => {
      setAdminRoom(data)
      setDecidingWinner(null)
      setShowAlerts(false)
    }

    socket.on('admin_alert_received', onAlert)
    socket.on('admin_joined_room', onJoined)

    return () => {
      socket.off('admin_alert_received', onAlert)
      socket.off('admin_joined_room', onJoined)
      socket.emit('set_admin_mode', { active: false })
    }
  }, [user?.isAdmin])

  // Close alert panel on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (alertPanelRef.current && !alertPanelRef.current.contains(e.target as Node)) {
        setShowAlerts(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const handleJoinRoom = (roomId: string) => {
    socket.emit('admin_join_room', { roomId })
  }

  const handleDecide = (winner: 0 | 1 | 2) => {
    if (!adminRoom) return
    setDecidingWinner(winner)
    socket.emit('admin_decide', { roomId: adminRoom.roomId, winner })
    setTimeout(() => {
      setAdminRoom(null)
      setDecidingWinner(null)
      setAlerts(prev => prev.filter(a => a.roomId !== adminRoom.roomId))
    }, 1500)
  }

  const handleCloseRoom = () => {
    if (!adminRoom) return
    if (!window.confirm('Fermer cette room de force ? Les joueurs seront renvoyés au menu.')) return
    socket.emit('admin_close_room', { roomId: adminRoom.roomId })
    setAlerts(prev => prev.filter(a => a.roomId !== adminRoom!.roomId))
    setAdminRoom(null)
  }

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const bestElo = Math.max(...Object.values(user?.stats || {}).map(s => (s as { elo?: number })?.elo || 0), 500)

  // Nav groups — structured to avoid overflow
  const navGroups = [
    {
      label: null,
      items: [
        { icon: LayoutDashboard, label: 'Accueil', to: '/app' },
        { icon: Sword, label: 'Ranked', to: '/app/ranked' },
        { icon: Trophy, label: 'Classement', to: '/app/leaderboard' },
      ],
    },
    {
      label: 'COMMUNAUTÉ',
      items: [
        { icon: Shield, label: 'Clans', to: '/app/clans' },
        { icon: Calendar, label: 'Tournois', to: '/app/tournaments' },
        { icon: Users, label: 'Amis', to: '/app/friends' },
      ],
    },
    {
      label: 'MON COMPTE',
      items: [
        { icon: ShoppingBag, label: 'Boutique', to: '/app/shop' },
        { icon: Gift, label: 'Passe', to: '/app/battle-pass' },
        { icon: Zap, label: 'Missions', to: '/app/missions' },
      ],
    },
    {
      label: 'AIDE',
      items: [
        { icon: BookOpen, label: 'Règlement', to: '/app/faq' },
        { icon: Headphones, label: 'Support', to: '/app/support' },
      ],
    },
  ]

  const adminNavItems: { icon: typeof Settings; label: string; to: string }[] = []
  if (user?.isContent || user?.isAdmin) adminNavItems.push({ icon: Clapperboard, label: 'Content', to: '/app/content' })
  if (user?.isAdmin) adminNavItems.push({ icon: Settings, label: 'Admin', to: '/app/admin' })

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#08080e' }}>
      {/* Sidebar */}
      <motion.aside
        initial={{ x: -220 }}
        animate={{ x: 0 }}
        className="flex flex-col h-full w-56 flex-shrink-0 border-r"
        style={{ background: '#0a0a14', borderColor: 'rgba(255,255,255,0.06)' }}
      >
        {/* Logo */}
        <div className="p-5 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-2">
            <Zap size={22} style={{ color: '#ff4655' }} />
            <span className="font-display font-bold text-xl gradient-text">REVENGE</span>
          </div>
          {season && (
            <div className="mt-2 px-2 py-1 rounded-lg text-xs font-semibold"
              style={{ background: 'rgba(255,70,85,0.1)', color: '#ff4655', display: 'inline-block' }}>
              Saison {season.season.number}
            </div>
          )}
        </div>

        {/* Nav — grouped, no scroll */}
        <nav className="flex-1 px-3 py-2 flex flex-col overflow-hidden">
          {navGroups.map((group, gi) => (
            <div key={gi} className={gi > 0 ? 'mt-2' : ''}>
              {group.label && (
                <p className="px-2 mb-0.5 text-[9px] font-bold tracking-widest uppercase"
                  style={{ color: 'rgba(255,255,255,0.2)' }}>
                  {group.label}
                </p>
              )}
              {group.items.map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/app'}
                  className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                >
                  <item.icon size={15} />
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
          {adminNavItems.length > 0 && (
            <div className="mt-2">
              <p className="px-2 mb-0.5 text-[9px] font-bold tracking-widest uppercase"
                style={{ color: 'rgba(255,70,85,0.35)' }}>
                STAFF
              </p>
              {adminNavItems.map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                >
                  <item.icon size={15} />
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          )}
        </nav>

        {/* Online count */}
        <div className="px-4 py-2 flex items-center gap-2">
          <Circle size={8} fill="#10b981" style={{ color: '#10b981' }} />
          <span className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{onlineCount} en ligne</span>
        </div>

        {/* User card */}
        <div className="p-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          <NavLink to={`/app/profile`} className="flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 transition-colors">
            <UserAvatar
              pseudo={user?.pseudo ?? '?'}
              avatar={user?.avatar}
              size="lg"
              isPremium={user?.isPremium}
              isContent={user?.isContent}
              isFondateur={user?.isFondateur}
              frame={user?.avatarFrame}
              noBadge={user?.hidePremiumBadge}
            />
            <div className="flex-1 min-w-0">
              <p className="text-base font-bold truncate">{user?.pseudo}</p>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <RankBadge elo={bestElo} size="sm" />
                <span style={{ color: '#f59e0b', fontSize: '11px', fontWeight: 700 }}>💰 {user?.coins ?? 0}</span>
              </div>
              <div className="mt-1.5 w-full">
                <div className="flex items-center justify-between mb-0.5">
                  <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: '10px' }}>Lv.{userLevel}</span>
                  <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: '10px' }}>{userXp % 150}/{150} XP</span>
                </div>
                <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(((userXp % 150) / 150) * 100, 100)}%`,
                      background: 'linear-gradient(90deg, #ff4655, #f59e0b)',
                    }}
                  />
                </div>
              </div>
            </div>
          </NavLink>
          <button
            onClick={handleLogout}
            className="w-full mt-2 flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors"
            style={{ color: 'rgba(255,255,255,0.4)' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#ff4655')}
            onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.4)')}
          >
            <LogOut size={12} />
            Déconnexion
          </button>
        </div>
      </motion.aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto scrollbar-thin relative">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="h-full"
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>

        {/* ── Notifications globales (tous les joueurs) ── */}
        <div className="absolute top-4 right-4 z-40 flex items-center gap-2" ref={notifPanelRef}>
          <button
            onClick={() => { setShowNotifs(v => !v); setUnreadNotifs(0) }}
            className="relative w-9 h-9 rounded-xl flex items-center justify-center transition-all"
            style={{
              background: unreadNotifs > 0 ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.06)',
              border: `1px solid ${unreadNotifs > 0 ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.1)'}`,
            }}
          >
            <Bell size={15} color={unreadNotifs > 0 ? '#818cf8' : 'rgba(255,255,255,0.4)'} />
            {unreadNotifs > 0 && (
              <motion.span
                initial={{ scale: 0 }} animate={{ scale: 1 }}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-xs font-black"
                style={{ background: '#6366f1', color: '#fff' }}
              >
                {unreadNotifs > 9 ? '9+' : unreadNotifs}
              </motion.span>
            )}
          </button>

          {/* Notif dropdown */}
          <AnimatePresence>
            {showNotifs && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: -6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -6 }}
                className="absolute right-0 top-11 w-72 rounded-2xl overflow-hidden"
                style={{ background: '#0e0e17', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 20px 48px rgba(0,0,0,0.6)' }}
              >
                <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                  <span className="text-sm font-bold">🔔 Notifications</span>
                  {notifs.length > 0 && (
                    <button onClick={() => setNotifs([])} className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
                      Tout effacer
                    </button>
                  )}
                </div>
                <div className="max-h-64 overflow-y-auto">
                  {notifs.length === 0 ? (
                    <p className="text-xs text-center py-6" style={{ color: 'rgba(255,255,255,0.25)' }}>Aucune notification</p>
                  ) : notifs.map(n => (
                    <div key={n.id} className="px-4 py-3 flex items-start gap-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <span className="text-base flex-shrink-0 mt-0.5">{n.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs leading-snug" style={{ color: 'rgba(255,255,255,0.85)' }}>{n.text}</p>
                        <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.3)' }}>
                          {new Date(n.time).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5" style={{ background: n.color }} />
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Admin floating system (visible on all pages) ── */}
        {user?.isAdmin && (
          <>
            {/* Bell button — top right corner of main area (admin alerts) */}
            <div className="absolute top-4 right-16 z-40" ref={alertPanelRef}>
              <button
                onClick={() => setShowAlerts(v => !v)}
                className="relative w-9 h-9 rounded-xl flex items-center justify-center transition-all"
                style={{
                  background: alerts.length > 0 ? 'rgba(255,70,85,0.2)' : 'rgba(255,255,255,0.06)',
                  border: `1px solid ${alerts.length > 0 ? 'rgba(255,70,85,0.5)' : 'rgba(255,255,255,0.1)'}`,
                }}
              >
                <Bell size={15} color={alerts.length > 0 ? '#ff4655' : 'rgba(255,255,255,0.4)'} />
                {alerts.length > 0 && (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-xs font-black"
                    style={{ background: '#ff4655', color: '#fff' }}
                  >
                    {alerts.length}
                  </motion.span>
                )}
              </button>

              {/* Alerts dropdown */}
              <AnimatePresence>
                {showAlerts && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: -6 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: -6 }}
                    className="absolute right-0 mt-2 w-72 rounded-2xl overflow-hidden"
                    style={{
                      background: '#0e0e17',
                      border: '1px solid rgba(255,255,255,0.12)',
                      boxShadow: '0 20px 48px rgba(0,0,0,0.6)',
                    }}
                  >
                    <div className="px-4 py-3 flex items-center justify-between"
                      style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                      <span className="text-sm font-bold">🚨 Alertes rooms</span>
                      {alerts.length > 0 && (
                        <button onClick={() => setAlerts([])}
                          className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
                          Tout effacer
                        </button>
                      )}
                    </div>
                    <div className="max-h-60 overflow-y-auto">
                      {alerts.length === 0 ? (
                        <p className="text-xs text-center py-5" style={{ color: 'rgba(255,255,255,0.25)' }}>
                          Aucune alerte
                        </p>
                      ) : alerts.map((a, i) => (
                        <div key={i} className="px-4 py-3 flex items-center gap-3"
                          style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                          <div className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ background: '#ff4655' }} />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold">Room #{a.roomId.slice(-6)}</p>
                            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
                              {a.type === 'decision' ? '⚖️ Décision demandée' : a.type === 'conflict' ? '⚠️ Conflit de vote' : '🚨 Report'} · {a.pseudo}
                            </p>
                          </div>
                          <button
                            onClick={() => handleJoinRoom(a.roomId)}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold flex-shrink-0"
                            style={{ background: 'rgba(255,70,85,0.15)', color: '#ff4655', border: '1px solid rgba(255,70,85,0.3)' }}
                          >
                            <Eye size={10} /> Rejoindre
                          </button>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Admin room decision panel — floating bottom right */}
            <AnimatePresence>
              {adminRoom && (
                <motion.div
                  initial={{ opacity: 0, y: 20, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 20, scale: 0.95 }}
                  className="absolute bottom-4 right-4 z-50 w-80 rounded-2xl overflow-hidden"
                  style={{
                    background: '#0e0e17',
                    border: '1px solid rgba(245,158,11,0.4)',
                    boxShadow: '0 24px 48px rgba(0,0,0,0.7)',
                  }}
                >
                  {/* Header */}
                  <div className="px-4 py-3 flex items-center gap-2"
                    style={{ background: 'rgba(245,158,11,0.08)', borderBottom: '1px solid rgba(245,158,11,0.2)' }}>
                    <Eye size={14} color="#f59e0b" />
                    <span className="text-sm font-bold" style={{ color: '#f59e0b' }}>
                      Room #{adminRoom.roomId.slice(-6)} · {adminRoom.mode}
                    </span>
                    <button onClick={() => setAdminRoom(null)}
                      className="ml-auto p-1 rounded-lg transition-all"
                      style={{ color: 'rgba(255,255,255,0.3)' }}
                      onMouseEnter={e => (e.currentTarget.style.color = '#fff')}
                      onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.3)')}>
                      <X size={13} />
                    </button>
                  </div>

                  {/* Teams */}
                  <div className="p-4 grid grid-cols-2 gap-3 mb-1">
                    {[
                      { label: 'Équipe 1', players: adminRoom.team1, color: '#06b6d4' },
                      { label: 'Équipe 2', players: adminRoom.team2, color: '#f97316' },
                    ].map((team, ti) => (
                      <div key={ti} className="p-3 rounded-xl"
                        style={{ background: `${team.color}0d`, border: `1px solid ${team.color}30` }}>
                        <p className="text-xs font-bold mb-1.5 uppercase tracking-wide" style={{ color: team.color }}>
                          {team.label}
                        </p>
                        {team.players.map(p => (
                          <p key={p.pseudo} className="text-xs py-0.5 truncate" style={{ color: 'rgba(255,255,255,0.8)' }}>
                            {p.pseudo} <span style={{ color: 'rgba(255,255,255,0.3)' }}>({p.elo})</span>
                          </p>
                        ))}
                      </div>
                    ))}
                  </div>

                  {/* Decision buttons */}
                  <div className="px-4 pb-4">
                    <p className="text-xs font-bold uppercase tracking-wider mb-2"
                      style={{ color: 'rgba(255,255,255,0.4)' }}>
                      <Gavel size={11} className="inline mr-1" />Décision admin
                    </p>
                    <div className="flex gap-2 mb-2">
                      <button
                        onClick={() => handleDecide(1)}
                        disabled={decidingWinner !== null}
                        className="flex-1 py-2 rounded-xl text-xs font-black transition-all"
                        style={{
                          background: decidingWinner === 1 ? '#06b6d4' : 'rgba(6,182,212,0.1)',
                          border: '1px solid rgba(6,182,212,0.4)',
                          color: decidingWinner === 1 ? '#fff' : '#06b6d4',
                        }}
                      >
                        ✅ EQ1
                      </button>
                      <button
                        onClick={() => handleDecide(0)}
                        disabled={decidingWinner !== null}
                        className="px-3 py-2 rounded-xl text-xs font-black transition-all"
                        style={{
                          background: decidingWinner === 0 ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)',
                          border: '1px solid rgba(255,255,255,0.15)',
                          color: '#e8e8f0',
                        }}
                      >
                        ⚖️
                      </button>
                      <button
                        onClick={() => handleDecide(2)}
                        disabled={decidingWinner !== null}
                        className="flex-1 py-2 rounded-xl text-xs font-black transition-all"
                        style={{
                          background: decidingWinner === 2 ? '#f97316' : 'rgba(249,115,22,0.1)',
                          border: '1px solid rgba(249,115,22,0.4)',
                          color: decidingWinner === 2 ? '#fff' : '#f97316',
                        }}
                      >
                        ✅ EQ2
                      </button>
                    </div>
                    {/* Force close room */}
                    <button
                      onClick={handleCloseRoom}
                      disabled={decidingWinner !== null}
                      className="w-full py-1.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all"
                      style={{
                        background: 'rgba(239,68,68,0.08)',
                        border: '1px solid rgba(239,68,68,0.2)',
                        color: 'rgba(239,68,68,0.7)',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.18)'; e.currentTarget.style.color = '#ef4444' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.08)'; e.currentTarget.style.color = 'rgba(239,68,68,0.7)' }}
                    >
                      <XCircle size={11} />
                      Fermer la room
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}

        {/* XP Toast */}
        <AnimatePresence>
          {xpToast && (
            <motion.div
              initial={{ opacity: 0, y: 40, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 40, scale: 0.9 }}
              className="fixed bottom-6 left-1/2 z-50 flex items-center gap-3 px-5 py-3 rounded-2xl"
              style={{
                transform: 'translateX(-50%)',
                background: '#0e0e17',
                border: '1px solid rgba(245,158,11,0.4)',
                boxShadow: '0 8px 32px rgba(245,158,11,0.2)',
              }}
            >
              <span className="text-xl">{xpToast.levelUp ? '⭐' : '⚡'}</span>
              <div>
                <p className="text-sm font-bold" style={{ color: xpToast.levelUp ? '#f59e0b' : '#e8e8f0' }}>
                  {xpToast.levelUp ? `Niveau ${xpToast.level} !` : `+${xpToast.xpGained} XP`}
                </p>
                {xpToast.levelUp && (
                  <p className="text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>Passe de combat · Niveau {xpToast.level}</p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Global chat */}
      <GlobalChat />

      {/* Admin Warning Modal */}
      <AnimatePresence>
        {adminWarning && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="w-full max-w-md rounded-2xl overflow-hidden"
              style={{ background: '#0e0e17', border: '1px solid rgba(239,68,68,0.5)', boxShadow: '0 24px 64px rgba(239,68,68,0.2)' }}
            >
              <div className="px-6 py-4 flex items-center gap-3"
                style={{ background: 'rgba(239,68,68,0.1)', borderBottom: '1px solid rgba(239,68,68,0.2)' }}>
                <AlertTriangle size={20} style={{ color: '#ef4444' }} />
                <h2 className="font-display font-bold text-lg" style={{ color: '#ef4444' }}>
                  Avertissement de l'administration
                </h2>
              </div>
              <div className="p-6">
                <p className="text-xs mb-2" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  Message de <strong style={{ color: '#ff4655' }}>{adminWarning.admin}</strong> :
                </p>
                <p className="text-base leading-relaxed mb-6" style={{ color: '#e8e8f0' }}>
                  {adminWarning.reason}
                </p>
                <button
                  onClick={() => setAdminWarning(null)}
                  className="w-full py-3 rounded-xl font-bold transition-all"
                  style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', color: '#ef4444' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.25)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.15)')}
                >
                  J'ai compris
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
