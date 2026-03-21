import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Sword, Users, X, Shield, Zap, MessageCircle, Send,
  CheckCircle, Crown, Clock, Map, Target, Trophy, Skull,
  AlertTriangle, LogOut, ImageIcon
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../context/AuthContext'
import socket from '../lib/socket'
import UserAvatar from '../components/UserAvatar'
import RankBadge from '../components/RankBadge'
import { Mode, PlayerInfo, ChatMessage } from '../types'
import { getRankFromElo } from '../utils/rank'

type GameState = 'idle' | 'in_queue' | 'match_found' | 'in_room' | 'weapon_vote' | 'ban_phase' | 'playing' | 'game_over'

const MODES: Mode[] = ['1v1', '2v2', '3v3', '5v5']
const MAPS = ['Ascent', 'Bind', 'Haven', 'Icebox', 'Lotus', 'Pearl', 'Split']
const WEAPONS = ['Vandal/Phantom', 'Sheriff', 'Operator', 'Marshall', 'Ghost']

const MAP_COLORS: Record<string, string> = {
  Ascent: '#3b82f6', Bind: '#f59e0b', Haven: '#10b981',
  Icebox: '#06b6d4', Lotus: '#ec4899', Pearl: '#8b5cf6', Split: '#f97316',
}

const modeDesc: Record<Mode, string> = {
  '1v1': 'Duel solo — prouve ta valeur',
  '2v2': 'Duo ranked — jeu en équipe',
  '3v3': 'Trio ranked — coordination',
  '5v5': 'Full team — 5 vs 5 tactique',
}

interface RoomData {
  roomId: string
  mode: Mode
  team1: PlayerInfo[]
  team2: PlayerInfo[]
  captains: [string | null, string | null]
  waiting?: boolean
}

interface GameResult {
  winner: 0 | 1 | 2
  winTeam: string[]
  loseTeam: string[]
  mode: Mode
  eloChanges: Record<string, number>
  draw?: boolean
}

// ─── Player Card Component ───────────────────────────────────────────────────
function PlayerCard({ player, isCap, teamColor, side }: {
  player: PlayerInfo
  isCap?: boolean
  teamColor: string
  side?: 'left' | 'right'
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: side === 'left' ? -30 : side === 'right' ? 30 : 0 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4 }}
      className="flex items-center gap-3 p-3 rounded-xl"
      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      <div className="relative flex-shrink-0">
        <UserAvatar pseudo={player.pseudo} avatar={player.avatar} size="md" isPremium={player.isPremium} frame={player.avatarFrame} />
        {isCap && (
          <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center"
            style={{ background: '#f59e0b' }}>
            <Crown size={9} color="#000" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate" style={{ color: '#e8e8f0' }}>{player.pseudo}</p>
        <RankBadge elo={player.elo} size="sm" />
      </div>
      <div className="text-xs font-bold" style={{ color: teamColor }}>{player.elo}</div>
    </motion.div>
  )
}

// ─── Countdown Ring ───────────────────────────────────────────────────────────
function CountdownRing({ seconds, maxSeconds = 10 }: { seconds: number; maxSeconds?: number }) {
  const radius = 36
  const circ = 2 * Math.PI * radius
  const progress = (seconds / maxSeconds) * circ
  const color = seconds <= 3 ? '#ef4444' : seconds <= 6 ? '#f59e0b' : '#10b981'
  return (
    <div className="relative w-24 h-24 flex items-center justify-center mx-auto">
      <svg className="absolute inset-0 -rotate-90" width="96" height="96">
        <circle cx="48" cy="48" r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="4" />
        <motion.circle
          cx="48" cy="48" r={radius} fill="none"
          stroke={color} strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circ}
          animate={{ strokeDashoffset: circ - progress }}
          transition={{ duration: 0.5 }}
          style={{ strokeDashoffset: circ - progress }}
        />
      </svg>
      <motion.span
        key={seconds}
        initial={{ scale: 1.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="font-display font-bold text-3xl"
        style={{ color }}
      >
        {seconds}
      </motion.span>
    </div>
  )
}

// ─── RankUpModal ─────────────────────────────────────────────────────────────
function RankUpModal({ from, to, onClose }: {
  from: { name: string; color: string }
  to: { name: string; color: string }
  onClose: () => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.7, y: 40 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.7, y: 40 }}
        transition={{ type: 'spring', damping: 18, stiffness: 200 }}
        className="relative text-center px-10 py-10 rounded-3xl overflow-hidden"
        style={{ background: '#0e0e17', border: `1px solid ${to.color}60`, boxShadow: `0 0 60px ${to.color}40`, maxWidth: 380 }}
        onClick={e => e.stopPropagation()}
      >
        {/* Glow rings */}
        <motion.div
          animate={{ scale: [1, 1.3, 1], opacity: [0.3, 0.1, 0.3] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="absolute inset-0 rounded-3xl pointer-events-none"
          style={{ border: `2px solid ${to.color}`, boxShadow: `0 0 40px ${to.color}` }}
        />

        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.15, type: 'spring', stiffness: 300 }}
          className="text-5xl mb-3"
        >
          🏆
        </motion.div>

        <motion.h2
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="font-display font-black text-4xl mb-2 gradient-text"
        >
          RANK UP !
        </motion.h2>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="flex items-center justify-center gap-4 mt-4 mb-6"
        >
          <div className="flex flex-col items-center">
            <span className="text-xs mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>Avant</span>
            <span className="font-bold text-xl px-3 py-1 rounded-lg" style={{ color: from.color, background: `${from.color}15`, border: `1px solid ${from.color}30` }}>
              {from.name}
            </span>
          </div>
          <motion.span
            animate={{ x: [0, 6, 0] }}
            transition={{ duration: 0.8, repeat: Infinity }}
            className="text-2xl"
          >
            →
          </motion.span>
          <div className="flex flex-col items-center">
            <span className="text-xs mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>Maintenant</span>
            <span className="font-black text-2xl px-4 py-1 rounded-lg" style={{ color: to.color, background: `${to.color}20`, border: `1px solid ${to.color}50`, boxShadow: `0 0 12px ${to.color}40` }}>
              {to.name}
            </span>
          </div>
        </motion.div>

        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          onClick={onClose}
          className="text-xs px-6 py-2 rounded-full"
          style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.1)' }}
        >
          Continuer
        </motion.button>
      </motion.div>
    </motion.div>
  )
}

export default function RankedPage() {
  const { user } = useAuth()
  const [gameState, setGameState] = useState<GameState>('idle')
  const [selectedMode, setSelectedMode] = useState<Mode>('2v2')
  const [groupCode, setGroupCode] = useState<string | null>(null)
  const [groupPlayers, setGroupPlayers] = useState<PlayerInfo[]>([])
  const [joinCodeInput, setJoinCodeInput] = useState('')
  const [roomData, setRoomData] = useState<RoomData | null>(null)
  const [bannedMaps, setBannedMaps] = useState<string[]>([])
  const [banTurn, setBanTurn] = useState<number>(0)
  const [banTeam, setBanTeam] = useState<number>(1)
  const [banTimer, setBanTimer] = useState(15)
  const [votedWeapon, setVotedWeapon] = useState<string | null>(null)
  const [chosenWeapon, setChosenWeapon] = useState<string | null>(null)
  const [chosenMap, setChosenMap] = useState<string | null>(null)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [gameResult, setGameResult] = useState<GameResult | null>(null)
  const [myTeam, setMyTeam] = useState<1 | 2 | null>(null)
  const [rankUpData, setRankUpData] = useState<{ from: { name: string; color: string }; to: { name: string; color: string } } | null>(null)
  const [discussCountdown, setDiscussCountdown] = useState<number | null>(null)
  const discussTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [isCaptain, setIsCaptain] = useState(false)
  const [matchTimer, setMatchTimer] = useState(0)
  const [voteConflict, setVoteConflict] = useState(false)
  const [queueTime, setQueueTime] = useState(0)
  const [alertSent, setAlertSent] = useState(false)
  const [reportSent, setReportSent] = useState(false)
  const [showReportModal, setShowReportModal] = useState(false)
  const [reportTarget, setReportTarget] = useState<string | null>(null)
  const [queueCooldownEndsAt, setQueueCooldownEndsAt] = useState<number | null>(null)
  const [cooldownRemaining, setCooldownRemaining] = useState(0)
  const chatBottomRef = useRef<HTMLDivElement>(null)
  const matchTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const queueTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const banTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const cooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const matchFoundAtRef = useRef<number | null>(null)
  const imgInputRef = useRef<HTMLInputElement>(null)
  const [wager, setWager] = useState(0)
  const [wagerRooms, setWagerRooms] = useState<{ mode: string; wager: number; count: number }[]>([])
  const imgInputLobbyRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const savedRoomId = localStorage.getItem('rv_roomId')
    const savedUserId = localStorage.getItem('rv_userId') || user?.id
    if (savedRoomId && savedUserId) {
      socket.emit('rejoin_room', { roomId: savedRoomId, userId: savedUserId })
    }
    return () => {
      if (matchTimerRef.current) clearInterval(matchTimerRef.current)
      if (queueTimerRef.current) clearInterval(queueTimerRef.current)
    }
  }, [user?.id])

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  useEffect(() => {
    const onRoomReady = (data: RoomData) => {
      setRoomData(data)
      if (data.waiting) {
        setGameState('in_queue')
      } else {
        setGameState('match_found')
        matchFoundAtRef.current = Date.now()
        playMatchFoundSound()
        setBannedMaps([])
        setVotedWeapon(null)
        setChosenWeapon(null)
        setChosenMap(null)
        setChatMessages([])
        setVoteConflict(false)
        if (user) {
          const inTeam1 = data.team1.some(p => p.pseudo === user.pseudo)
          setMyTeam(inTeam1 ? 1 : 2)
          const capPseudo = inTeam1 ? data.captains[0] : data.captains[1]
          setIsCaptain(capPseudo === user.pseudo)
        }
        if (queueTimerRef.current) clearInterval(queueTimerRef.current)
        setQueueTime(0)
        localStorage.setItem('rv_roomId', data.roomId)
        // Switch to in_room after 3s (handled by onCountdownStart with minimum display time)
      }
    }

    const onCountdownStart = ({ seconds }: { seconds: number }) => {
      setCountdown(seconds)
      // Ensure "Adversaire trouvé" screen is visible for at least 2.5s before transitioning
      const MIN_DISPLAY = 2500
      const elapsed = matchFoundAtRef.current ? Date.now() - matchFoundAtRef.current : MIN_DISPLAY
      const delay = Math.max(0, MIN_DISPLAY - elapsed)
      setTimeout(() => {
        setGameState(prev => prev === 'match_found' || prev === 'in_room' ? 'in_room' : prev)
      }, delay)
    }
    const onCountdownTick = ({ seconds }: { seconds: number }) => setCountdown(seconds)
    const onCaptainDiscuss = ({ seconds }: { seconds: number }) => {
      setDiscussCountdown(seconds)
      if (discussTimerRef.current) clearInterval(discussTimerRef.current)
      discussTimerRef.current = setInterval(() => {
        setDiscussCountdown(prev => {
          if (prev === null || prev <= 1) { clearInterval(discussTimerRef.current!); return null }
          return prev - 1
        })
      }, 1000)
    }
    const onWeaponVoteStart = () => {
      setGameState('weapon_vote')
      setCountdown(null)
      setDiscussCountdown(null)
      if (discussTimerRef.current) clearInterval(discussTimerRef.current)
    }
    const onWeaponChosen = ({ weapon }: { weapon: string }) => {
      setChosenWeapon(weapon); setGameState('playing'); startMatchTimer()
    }
    const onBanPhase = ({ turn, team }: { turn: number; team: number }) => {
      setGameState('ban_phase'); setBanTurn(turn); setBanTeam(team); setCountdown(null)
    }
    const onBanTimerStart = ({ seconds }: { seconds: number }) => {
      setBanTimer(seconds)
      if (banTimerRef.current) clearInterval(banTimerRef.current)
      banTimerRef.current = setInterval(() => {
        setBanTimer(prev => { if (prev <= 1) { clearInterval(banTimerRef.current!); return 0 } return prev - 1 })
      }, 1000)
    }
    const onMapBanned = ({ map, remainingMaps }: { team: number; map: string; remainingMaps: string[] }) => {
      setBannedMaps(MAPS.filter(m => !remainingMaps.includes(m)))
      toast(`❌ ${map} banni`, { icon: '🗺️' })
    }
    const onMapChosen = ({ map }: { map: string }) => {
      setChosenMap(map); setGameState('playing'); startMatchTimer()
    }
    const onGameStart = () => { setGameState('playing'); startMatchTimer() }
    const onChatMsg = (msg: ChatMessage) => setChatMessages(prev => [...prev, msg].slice(-100))
    const onVoteConflict = () => { setVoteConflict(true); toast.error('Conflit de vote ! Appelez un staff.') }
    const onVoteTooEarly = ({ remaining }: { remaining: number }) => {
      toast(`⏱️ Attendez encore ${remaining}s avant de voter`, { icon: '⏳' })
    }
    const RANK_ORDER: Record<string, number> = { Silver: 0, Gold: 1, Platinum: 2, Diamond: 3, Radiant: 4 }
    const onGameResult = (result: GameResult) => {
      // Rank-up detection
      if (user && result.eloChanges && result.eloChanges[user.id]) {
        const mode = result.mode
        const currentElo = user.stats[mode]?.elo ?? 500
        const change = result.eloChanges[user.id]
        const oldRank = getRankFromElo(currentElo)
        const newRank = getRankFromElo(currentElo + change)
        if (oldRank.name !== newRank.name && (RANK_ORDER[newRank.name] ?? 0) > (RANK_ORDER[oldRank.name] ?? 0)) {
          setRankUpData({ from: { name: oldRank.name, color: oldRank.color }, to: { name: newRank.name, color: newRank.color } })
          setTimeout(() => setRankUpData(null), 5000)
        }
      }
      if ((result as any).wager > 0) {
        const won = (result as any).winTeam?.includes(user?.pseudo || '')
        if (won) toast.success(`💰 +${(result as any).wager} coins remportés !`)
        else toast.error(`💸 -${(result as any).wager} coins perdus...`)
      }
      setGameResult(result); setGameState('game_over')
      localStorage.removeItem('rv_roomId')
      if (matchTimerRef.current) clearInterval(matchTimerRef.current)
    }
    const onRejoinFailed = () => { localStorage.removeItem('rv_roomId'); setGameState('idle') }
    const onCaptainLeft = () => {
      toast.error('Le capitaine a quitté la room')
      setGameState('idle'); localStorage.removeItem('rv_roomId')
    }
    const onRoomClosedByAdmin = ({ reason }: { reason?: string }) => {
      const msg = reason === 'timeout'
        ? '⌛ Room fermée après 90 minutes d\'inactivité'
        : '🚫 La room a été fermée par un admin'
      toast.error(msg, { duration: 5000 })
      setGameState('idle')
      setRoomData(null)
      localStorage.removeItem('rv_roomId')
      if (matchTimerRef.current) clearInterval(matchTimerRef.current)
    }
    const onQueueCooldown = ({ endsAt }: { endsAt: number }) => {
      setQueueCooldownEndsAt(endsAt)
      const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))
      setCooldownRemaining(remaining)
      if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current)
      cooldownTimerRef.current = setInterval(() => {
        const rem = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))
        setCooldownRemaining(rem)
        if (rem <= 0) {
          clearInterval(cooldownTimerRef.current!)
          setQueueCooldownEndsAt(null)
        }
      }, 500)
    }
    const onReportSent = () => {
      setReportSent(true)
      toast.success('✅ Signalement envoyé aux admins')
      setTimeout(() => setReportSent(false), 10000)
    }
    const onGroupCreated = ({ code, mode, players }: { code: string; mode: Mode; players: PlayerInfo[] }) => {
      setGroupCode(code); setSelectedMode(mode); setGroupPlayers(players)
    }
    const onGroupUpdated = ({ players, mode }: { players: PlayerInfo[]; mode: Mode }) => {
      setGroupPlayers(players); setSelectedMode(mode)
    }
    const onGroupJoined = ({ code, players, mode }: { code: string; players: PlayerInfo[]; mode: Mode }) => {
      setGroupCode(code); setGroupPlayers(players); setSelectedMode(mode)
    }

    socket.on('room_ready', onRoomReady)
    socket.on('countdown_start', onCountdownStart)
    socket.on('countdown_tick', onCountdownTick)
    socket.on('captain_discuss', onCaptainDiscuss)
    socket.on('weapon_vote_start', onWeaponVoteStart)
    socket.on('weapon_chosen', onWeaponChosen)
    socket.on('ban_phase', onBanPhase)
    socket.on('ban_timer_start', onBanTimerStart)
    socket.on('map_banned', onMapBanned)
    socket.on('map_chosen', onMapChosen)
    socket.on('game_start', onGameStart)
    socket.on('chat_msg', onChatMsg)
    socket.on('vote_conflict', onVoteConflict)
    socket.on('vote_too_early', onVoteTooEarly)
    socket.on('game_result', onGameResult)
    socket.on('rejoin_failed', onRejoinFailed)
    socket.on('captain_left', onCaptainLeft)
    socket.on('group_created', onGroupCreated)
    socket.on('group_updated', onGroupUpdated)
    socket.on('group_joined', onGroupJoined)
    socket.on('room_closed_by_admin', onRoomClosedByAdmin)
    socket.on('queue_cooldown', onQueueCooldown)
    socket.on('report_sent', onReportSent)
    socket.on('wager_error', ({ error }: { error: string }) => {
      toast.error(error)
      setWager(0)
    })
    socket.on('wager_set', ({ amount }: { amount: number }) => {
      setWager(amount)
    })
    socket.on('wager_rooms_update', (data: { mode: string; wager: number; count: number }[]) => {
      setWagerRooms(data)
    })
    socket.emit('get_wager_rooms')

    return () => {
      socket.off('room_ready', onRoomReady)
      socket.off('countdown_start', onCountdownStart)
      socket.off('countdown_tick', onCountdownTick)
      socket.off('captain_discuss', onCaptainDiscuss)
      socket.off('weapon_vote_start', onWeaponVoteStart)
      if (discussTimerRef.current) clearInterval(discussTimerRef.current)
      socket.off('weapon_chosen', onWeaponChosen)
      socket.off('ban_phase', onBanPhase)
      socket.off('ban_timer_start', onBanTimerStart)
      socket.off('map_banned', onMapBanned)
      socket.off('map_chosen', onMapChosen)
      socket.off('game_start', onGameStart)
      socket.off('chat_msg', onChatMsg)
      socket.off('vote_conflict', onVoteConflict)
      socket.off('vote_too_early', onVoteTooEarly)
      socket.off('game_result', onGameResult)
      socket.off('rejoin_failed', onRejoinFailed)
      socket.off('captain_left', onCaptainLeft)
      socket.off('group_created', onGroupCreated)
      socket.off('group_updated', onGroupUpdated)
      socket.off('group_joined', onGroupJoined)
      socket.off('room_closed_by_admin', onRoomClosedByAdmin)
      socket.off('queue_cooldown', onQueueCooldown)
      socket.off('report_sent', onReportSent)
      socket.off('wager_error')
      socket.off('wager_set')
      socket.off('wager_rooms_update')
      if (banTimerRef.current) clearInterval(banTimerRef.current)
      if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current)
    }
  }, [user])

  function playMatchFoundSound() {
    try {
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      const play = (freq: number, start: number, dur: number) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain); gain.connect(ctx.destination)
        osc.frequency.setValueAtTime(freq, ctx.currentTime + start)
        osc.type = 'sine'
        gain.gain.setValueAtTime(0, ctx.currentTime + start)
        gain.gain.linearRampToValueAtTime(0.25, ctx.currentTime + start + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur)
        osc.start(ctx.currentTime + start)
        osc.stop(ctx.currentTime + start + dur)
      }
      play(660, 0, 0.15)
      play(880, 0.18, 0.2)
      play(1100, 0.38, 0.35)
    } catch { /* ignore */ }
  }

  function startMatchTimer() {
    setMatchTimer(0)
    if (matchTimerRef.current) clearInterval(matchTimerRef.current)
    matchTimerRef.current = setInterval(() => setMatchTimer(t => t + 1), 1000)
  }

  function formatTime(secs: number) {
    const m = Math.floor(secs / 60).toString().padStart(2, '0')
    const s = (secs % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  const handleCreateGroup = () => socket.emit('create_group', { mode: selectedMode })
  const handleJoinGroup = () => {
    if (!joinCodeInput.trim()) return
    socket.emit('join_group', { code: joinCodeInput.toUpperCase() })
    setJoinCodeInput('')
  }
  const handleFindMatch = () => {
    if (!groupCode) {
      socket.emit('create_group', { mode: selectedMode })
      setTimeout(() => socket.emit('create_room'), 200)
    } else {
      socket.emit('create_room')
    }
    setGameState('in_queue')
    setQueueTime(0)
    queueTimerRef.current = setInterval(() => setQueueTime(t => t + 1), 1000)
  }
  const handleBotMatch = () => {
    socket.emit('join_bot_match', { mode: selectedMode })
    setGameState('in_queue')
    setQueueTime(0)
  }
  const handleCancelQueue = () => {
    socket.emit('cancel_queue')
    setGameState('idle')
    setQueueTime(0)
    if (queueTimerRef.current) clearInterval(queueTimerRef.current)
  }
  const handleChangeMode = (mode: Mode) => {
    setSelectedMode(mode)
    if (groupCode) socket.emit('change_mode', { mode })
  }
  const handleBanMap = (map: string) => {
    if (!roomData) return
    if (myTeam !== banTeam) { toast.error("Ce n'est pas votre tour"); return }
    socket.emit('ban_map', { map })
  }
  const handleVoteWeapon = (weapon: string) => {
    setVotedWeapon(weapon)
    socket.emit('vote_weapon', { weapon })
    toast.success(`Arme votée : ${weapon}`)
  }
  const handleVoteResult = (myTeamWon: boolean) => {
    socket.emit('vote_result', { myTeamWon })
    toast('Vote envoyé !', { icon: '⚖️' })
  }
  const sendChat = () => {
    if (!chatInput.trim()) return
    socket.emit('chat_msg', { text: chatInput.trim() })
    setChatInput('')
  }

  const sendChatImg = (file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string
      if (!dataUrl) return
      socket.emit('chat_img', { dataUrl })
    }
    reader.readAsDataURL(file)
  }
  const handleLeaveRoom = () => {
    if (!window.confirm('Quitter la room ? Tu seras pénalisé si la partie est en cours.')) return
    socket.emit('leave_room')
    localStorage.removeItem('rv_roomId')
    setGameState('idle')
    setRoomData(null)
    setBannedMaps([])
    setCountdown(null)
    setChatMessages([])
  }

  const handleReport = (targetPseudo: string, reason: string) => {
    if (!roomData?.roomId) return
    socket.emit('report_player', { roomId: roomData.roomId, targetPseudo, reason })
    setShowReportModal(false)
    setReportTarget(null)
  }

  const handleRequestDecision = () => {
    if (!roomData?.roomId) return
    setAlertSent(true)
    socket.emit('admin_alert', { roomId: roomData.roomId, type: 'decision', pseudo: user?.pseudo })
    toast('⚖️ Demande envoyée aux admins !', { icon: '📡' })
  }

  const handleRematch = () => { socket.emit('request_rematch'); toast('Demande de revanche envoyée !', { icon: '🔄' }) }
  const handleReturnMenu = () => {
    setGameState('idle'); setGameResult(null); setRoomData(null)
    setBannedMaps([]); setChosenWeapon(null); setChosenMap(null)
    setVoteConflict(false); setChatMessages([])
    setAlertSent(false)
    localStorage.removeItem('rv_roomId')
  }

  if (!user) return null

  // ══════════════════════════════════════════════════════════════════
  // GAME OVER
  // ══════════════════════════════════════════════════════════════════
  if (gameState === 'game_over' && gameResult) {
    const isDraw = gameResult.draw === true || gameResult.winner === 0
    const isWin = !isDraw && myTeam === gameResult.winner
    const myChange = gameResult.eloChanges?.[user.id]

    const resultColor = isDraw ? '#f59e0b' : isWin ? '#10b981' : '#ef4444'
    const resultLabel = isDraw ? 'ÉGALITÉ' : isWin ? 'VICTOIRE' : 'DÉFAITE'
    const resultIcon = isDraw
      ? <Shield size={40} color="#f59e0b" />
      : isWin
        ? <Trophy size={40} color="#10b981" />
        : <Skull size={40} color="#ef4444" />

    return (
      <div className="min-h-screen flex items-center justify-center relative overflow-hidden"
        style={{ background: '#08080e' }}>

        {/* BG glow */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-0" style={{
            background: `radial-gradient(ellipse 60% 40% at 50% 0%, ${resultColor}25 0%, transparent 70%)`,
          }} />
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="relative w-full max-w-2xl mx-auto px-4"
        >
          {/* Result header */}
          <div className="text-center mb-8">
            <motion.div
              initial={{ scale: 0, rotate: -20 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ delay: 0.2, type: 'spring', stiffness: 180 }}
              className="w-24 h-24 rounded-full mx-auto mb-4 flex items-center justify-center"
              style={{ background: `${resultColor}20`, border: `2px solid ${resultColor}` }}
            >
              {resultIcon}
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="font-display font-black text-5xl tracking-wider mb-1"
              style={{ color: resultColor }}
            >
              {resultLabel}
            </motion.h1>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="text-sm font-semibold tracking-widest uppercase"
              style={{ color: 'rgba(255,255,255,0.3)' }}
            >
              {gameResult.mode} · Ranked
            </motion.p>
          </div>

          {/* ELO change */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45 }}
            className="flex justify-center mb-6"
          >
            {isDraw ? (
              <div className="px-8 py-3 rounded-2xl flex items-center gap-3"
                style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)' }}>
                <Zap size={18} color="#f59e0b" />
                <span className="font-display font-black text-2xl" style={{ color: '#f59e0b' }}>
                  ±0 ELO — Égalité décidée par un admin
                </span>
              </div>
            ) : myChange !== undefined && (
              <div className="px-8 py-3 rounded-2xl flex items-center gap-3"
                style={{
                  background: myChange >= 0 ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                  border: `1px solid ${myChange >= 0 ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
                }}>
                <Zap size={18} color={myChange >= 0 ? '#10b981' : '#ef4444'} />
                <span className="font-display font-black text-3xl" style={{ color: myChange >= 0 ? '#10b981' : '#ef4444' }}>
                  {myChange >= 0 ? '+' : ''}{myChange} ELO
                </span>
              </div>
            )}
          </motion.div>

          {/* Teams */}
          {!isDraw && (gameResult.winTeam.length > 0 || gameResult.loseTeam.length > 0) && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.55 }}
              className="grid grid-cols-2 gap-3 mb-6"
            >
              {[
                { label: '🏆 Équipe gagnante', players: gameResult.winTeam, win: true },
                { label: '💀 Équipe perdante', players: gameResult.loseTeam, win: false },
              ].map(team => (
                <div key={team.label} className="p-4 rounded-2xl"
                  style={{
                    background: team.win ? 'rgba(16,185,129,0.06)' : 'rgba(239,68,68,0.06)',
                    border: `1px solid ${team.win ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.15)'}`,
                  }}>
                  <p className="text-xs font-bold mb-3 uppercase tracking-wider"
                    style={{ color: team.win ? '#10b981' : '#ef4444' }}>
                    {team.label}
                  </p>
                  <div className="space-y-2">
                    {team.players.map(p => (
                      <div key={p} className="flex items-center justify-between text-sm py-1">
                        <span style={{ color: 'rgba(255,255,255,0.8)' }}>{p}</span>
                        <span className="text-xs font-bold" style={{ color: team.win ? '#10b981' : '#ef4444' }}>
                          {team.win ? `+${Math.abs(myChange || 15)}` : `-${Math.abs(myChange || 10)}`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </motion.div>
          )}

          {/* Buttons */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.65 }}
            className="flex gap-3 justify-center"
          >
            {!isDraw && (
              <button onClick={handleRematch}
                className="px-6 py-3 rounded-xl text-sm font-semibold transition-all"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#e8e8f0' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
              >
                🔄 Revanche
              </button>
            )}
            <button onClick={handleReturnMenu}
              className="px-8 py-3 rounded-xl text-sm font-bold transition-all"
              style={{ background: '#ff4655', color: '#fff' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#e03545')}
              onMouseLeave={e => (e.currentTarget.style.background = '#ff4655')}
            >
              Menu principal
            </button>
          </motion.div>
        </motion.div>

        {/* Rank-up overlay over game_over */}
        <AnimatePresence>
          {rankUpData && (
            <RankUpModal
              from={rankUpData.from}
              to={rankUpData.to}
              onClose={() => setRankUpData(null)}
            />
          )}
        </AnimatePresence>
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════
  // MATCH FOUND — Old style animation
  // ══════════════════════════════════════════════════════════════════
  if (gameState === 'match_found' && roomData) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4"
        style={{ background: '#08080e' }}>
        {/* BG glow */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-0" style={{
            background: 'radial-gradient(ellipse 50% 35% at 50% 0%, rgba(255,70,85,0.18) 0%, transparent 70%)',
          }} />
        </div>

        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="text-center mb-8 relative"
        >
          <p className="font-display font-black text-5xl gradient-text mb-1">Adversaire trouvé !</p>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
            Mode : <span style={{ color: '#ff4655', fontWeight: 700 }}>{roomData.mode}</span>
          </p>
        </motion.div>

        {/* Teams face-off */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2, duration: 0.4 }}
          className="w-full max-w-xl flex items-center gap-4 relative"
        >
          {/* Team 1 */}
          <div className="flex-1 rounded-2xl p-4"
            style={{ background: 'rgba(6,182,212,0.06)', border: '1px solid rgba(6,182,212,0.25)' }}>
            <p className="text-xs font-bold uppercase tracking-widest mb-3 text-center" style={{ color: '#06b6d4' }}>Équipe 1</p>
            <div className="flex flex-col gap-2">
              {roomData.team1.map((p, i) => (
                <motion.div
                  key={p.pseudo}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.25 + i * 0.07 }}
                  className="flex items-center gap-2"
                >
                  <UserAvatar pseudo={p.pseudo} avatar={p.avatar} size="md" isPremium={p.isPremium} frame={p.avatarFrame} />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{p.pseudo}</p>
                    <p className="text-xs" style={{ color: '#06b6d4' }}>{p.elo} ELO</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          {/* VS center */}
          <motion.div
            initial={{ scale: 0, rotate: -30 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ delay: 0.35, type: 'spring', stiffness: 200 }}
            className="flex-shrink-0 flex flex-col items-center gap-2"
          >
            <div className="w-14 h-14 rounded-full flex items-center justify-center glow-pulse"
              style={{ background: 'rgba(255,70,85,0.12)', border: '2px solid #ff4655' }}>
              <Sword size={24} style={{ color: '#ff4655' }} />
            </div>
            <span className="font-display font-black text-lg" style={{ color: '#ff4655' }}>VS</span>
          </motion.div>

          {/* Team 2 */}
          <div className="flex-1 rounded-2xl p-4"
            style={{ background: 'rgba(249,115,22,0.06)', border: '1px solid rgba(249,115,22,0.25)' }}>
            <p className="text-xs font-bold uppercase tracking-widest mb-3 text-center" style={{ color: '#f97316' }}>Équipe 2</p>
            <div className="flex flex-col gap-2">
              {roomData.team2.map((p, i) => (
                <motion.div
                  key={p.pseudo}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.25 + i * 0.07 }}
                  className="flex items-center gap-2 flex-row-reverse"
                >
                  <UserAvatar pseudo={p.pseudo} avatar={p.avatar} size="md" isPremium={p.isPremium} frame={p.avatarFrame} />
                  <div className="min-w-0 text-right">
                    <p className="text-sm font-semibold truncate">{p.pseudo}</p>
                    <p className="text-xs" style={{ color: '#f97316' }}>{p.elo} ELO</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="text-sm mt-8"
          style={{ color: 'rgba(255,255,255,0.3)' }}
        >
          Chargement de la room…
        </motion.p>
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════
  // IN ROOM — Countdown lobby
  // ══════════════════════════════════════════════════════════════════
  if (gameState === 'in_room' && roomData && !roomData.waiting) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4"
        style={{ background: '#08080e' }}>

        <div className="w-full max-w-3xl">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="text-xs font-bold tracking-widest uppercase" style={{ color: 'rgba(255,255,255,0.3)' }}>
                Room #{roomData.roomId.slice(-6)}
              </p>
              <h2 className="font-display font-black text-3xl mt-0.5">{roomData.mode} Ranked</h2>
            </div>

            {countdown !== null && (
              <div className="flex flex-col items-center">
                <CountdownRing seconds={countdown} maxSeconds={10} />
                <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>Début dans…</p>
              </div>
            )}
          </div>

          {/* Teams */}
          <div className="grid grid-cols-2 gap-4">
            {[
              { label: 'Équipe 1', players: roomData.team1, cap: roomData.captains[0], color: '#06b6d4', isMe: myTeam === 1 },
              { label: 'Équipe 2', players: roomData.team2, cap: roomData.captains[1], color: '#f97316', isMe: myTeam === 2 },
            ].map((team, i) => (
              <div key={i} className="rounded-2xl overflow-hidden"
                style={{ border: `1px solid ${team.isMe ? team.color + '50' : 'rgba(255,255,255,0.08)'}`, background: 'rgba(255,255,255,0.02)' }}>
                {/* Team header */}
                <div className="px-4 py-3 flex items-center justify-between"
                  style={{ background: `${team.color}12`, borderBottom: `1px solid ${team.color}30` }}>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ background: team.color }} />
                    <span className="text-sm font-bold" style={{ color: team.color }}>{team.label}</span>
                  </div>
                  {team.isMe && (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                      style={{ background: `${team.color}20`, color: team.color }}>
                      Votre équipe
                    </span>
                  )}
                </div>

                {/* Players */}
                <div className="p-3 space-y-2">
                  {team.players.map((p, pi) => (
                    <PlayerCard
                      key={p.pseudo}
                      player={p}
                      isCap={p.pseudo === team.cap}
                      teamColor={team.color}
                      side={i === 0 ? 'left' : 'right'}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Room info bar */}
          <div className="mt-4 flex items-center gap-4 px-4 py-3 rounded-xl"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="flex items-center gap-2 text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
              <Zap size={12} color="#ff4655" />
              <span>La partie va commencer automatiquement</span>
            </div>
            {isCaptain && (
              <div className="flex items-center gap-1 text-xs" style={{ color: '#f59e0b' }}>
                <Crown size={12} />
                <span>Capitaine</span>
              </div>
            )}
            <button onClick={handleLeaveRoom} className="ml-auto flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-all"
              style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.16)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.08)')}>
              <LogOut size={11} /> Quitter
            </button>
          </div>

          {/* Captain discussion countdown */}
          <AnimatePresence>
            {discussCountdown !== null && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="mt-4 flex items-center gap-3 px-4 py-3 rounded-xl"
                style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.4)' }}
              >
                <motion.span
                  key={discussCountdown}
                  initial={{ scale: 1.3 }}
                  animate={{ scale: 1 }}
                  className="text-xl font-display font-black flex-shrink-0"
                  style={{ color: '#f59e0b', minWidth: 28, textAlign: 'center' }}
                >
                  {discussCountdown}
                </motion.span>
                <div>
                  <p className="text-sm font-bold" style={{ color: '#f59e0b' }}>Phase de discussion</p>
                  <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    Concertez-vous avec votre équipe sur l'arme avant le vote !
                  </p>
                </div>
                <MessageCircle size={18} style={{ color: '#f59e0b', marginLeft: 'auto', flexShrink: 0 }} />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Announce banner */}
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="mt-4 flex items-center gap-3 px-4 py-3 rounded-xl"
            style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.3)' }}
          >
            <span className="text-lg flex-shrink-0">📢</span>
            <p className="text-sm font-semibold" style={{ color: '#a5b4fc' }}>
              Envoyez votre code de groupe Valorant pour vous jouer !
            </p>
          </motion.div>

          {/* Chat in lobby */}
          <div className="mt-3 rounded-2xl overflow-hidden"
            style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <div className="px-4 py-2.5 flex items-center gap-2"
              style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <MessageCircle size={13} color="#ff4655" />
              <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.5)' }}>Chat pré-match</span>
            </div>
            <div className="p-3 space-y-1.5 overflow-y-auto scrollbar-thin" style={{ maxHeight: 120 }}>
              {chatMessages.length === 0 && (
                <p className="text-xs text-center py-2" style={{ color: 'rgba(255,255,255,0.2)' }}>Dis bonjour à l'équipe adverse…</p>
              )}
              {chatMessages.map((msg, i) => (
                <div key={i} className="text-xs">
                  {msg.team === 'system' ? (
                    <span className="italic" style={{ color: 'rgba(255,255,255,0.3)' }}>{msg.text}</span>
                  ) : (
                    <>
                      <span className="font-bold" style={{ color: msg.team === 'team1' ? '#06b6d4' : '#f97316' }}>{msg.author}: </span>
                      <span style={{ color: 'rgba(255,255,255,0.75)' }}>{msg.text}</span>
                      {msg.img && (
                        <img src={msg.img} className="max-w-[180px] rounded-lg mt-1 cursor-pointer block" onClick={() => window.open(msg.img)} alt="screenshot" />
                      )}
                    </>
                  )}
                </div>
              ))}
              <div ref={chatBottomRef} />
            </div>
            <div className="p-2 flex gap-2" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
              <input value={chatInput} onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendChat()}
                placeholder="Message…" maxLength={120}
                className="flex-1 text-xs rounded-lg px-3 py-2 outline-none"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#e8e8f0' }} />
              <input type="file" accept="image/*" ref={imgInputLobbyRef} className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) sendChatImg(f); e.target.value = '' }} />
              <button onClick={() => imgInputLobbyRef.current?.click()}
                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)' }}
                title="Envoyer une image">
                <ImageIcon size={12} />
              </button>
              <button onClick={sendChat}
                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(255,70,85,0.15)', color: '#ff4655' }}>
                <Send size={12} />
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════
  // BAN PHASE
  // ══════════════════════════════════════════════════════════════════
  if (gameState === 'ban_phase' && roomData) {
    const isMyBanTurn = myTeam === banTeam

    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4"
        style={{ background: '#08080e' }}>
        <div className="w-full max-w-2xl">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-3 mb-3">
              <Map size={20} color="#ff4655" />
              <h2 className="font-display font-black text-3xl">Phase de Ban</h2>
            </div>
            <div className="flex items-center justify-center gap-4">
              <div className="px-4 py-2 rounded-xl flex items-center gap-2"
                style={{
                  background: isMyBanTurn ? 'rgba(16,185,129,0.1)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${isMyBanTurn ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.08)'}`,
                }}>
                <div className="w-2 h-2 rounded-full" style={{ background: isMyBanTurn ? '#10b981' : 'rgba(255,255,255,0.2)' }} />
                <span className="text-sm font-semibold" style={{ color: isMyBanTurn ? '#10b981' : 'rgba(255,255,255,0.4)' }}>
                  {isMyBanTurn ? 'À vous de bannir' : `Équipe ${banTeam} bannit…`}
                </span>
              </div>

              <div className="w-12 h-12 rounded-full flex items-center justify-center"
                style={{
                  background: banTimer <= 5 ? 'rgba(239,68,68,0.12)' : 'rgba(245,158,11,0.12)',
                  border: `2px solid ${banTimer <= 5 ? '#ef4444' : '#f59e0b'}`,
                }}>
                <span className="font-display font-black text-xl"
                  style={{ color: banTimer <= 5 ? '#ef4444' : '#f59e0b' }}>
                  {banTimer}
                </span>
              </div>
            </div>
          </div>

          {/* Ban turn progress */}
          <div className="flex items-center gap-1 justify-center mb-6">
            {Array.from({ length: MAPS.length - 1 }).map((_, i) => (
              <div key={i} className="h-1 flex-1 rounded-full transition-all"
                style={{ background: i < banTurn ? '#ff4655' : 'rgba(255,255,255,0.08)' }} />
            ))}
          </div>

          {/* Maps grid */}
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
            {MAPS.map(map => {
              const isBanned = bannedMaps.includes(map)
              const mapColor = MAP_COLORS[map] || '#6366f1'
              return (
                <motion.button
                  key={map}
                  onClick={() => !isBanned && isMyBanTurn && handleBanMap(map)}
                  disabled={isBanned || !isMyBanTurn}
                  whileHover={!isBanned && isMyBanTurn ? { scale: 1.04, y: -2 } : {}}
                  whileTap={!isBanned && isMyBanTurn ? { scale: 0.97 } : {}}
                  className="relative p-4 rounded-xl text-sm font-bold transition-all overflow-hidden"
                  style={{
                    background: isBanned
                      ? 'rgba(239,68,68,0.06)'
                      : isMyBanTurn
                        ? `${mapColor}15`
                        : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${isBanned ? 'rgba(239,68,68,0.25)' : isMyBanTurn ? `${mapColor}40` : 'rgba(255,255,255,0.07)'}`,
                    color: isBanned ? 'rgba(239,68,68,0.4)' : isMyBanTurn ? '#e8e8f0' : 'rgba(255,255,255,0.4)',
                    cursor: isBanned || !isMyBanTurn ? 'not-allowed' : 'pointer',
                    textDecoration: isBanned ? 'line-through' : 'none',
                  }}
                >
                  {/* Color accent line */}
                  {!isBanned && (
                    <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-xl"
                      style={{ background: isMyBanTurn ? mapColor : 'transparent' }} />
                  )}
                  {isBanned ? (
                    <span className="flex flex-col items-center gap-1">
                      <X size={16} color="rgba(239,68,68,0.5)" />
                      {map}
                    </span>
                  ) : map}
                </motion.button>
              )
            })}
          </div>

          <p className="text-center text-xs mt-4" style={{ color: 'rgba(255,255,255,0.25)' }}>
            {MAPS.length - bannedMaps.length} maps restantes · ban {banTurn + 1}/{MAPS.length - 1}
          </p>
        </div>
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════
  // WEAPON VOTE
  // ══════════════════════════════════════════════════════════════════
  if (gameState === 'weapon_vote') {
    const weaponIcons: Record<string, string> = {
      'Vandal/Phantom': '🔫', 'Sheriff': '🔰', 'Operator': '🎯', 'Marshall': '🏹', 'Ghost': '👻',
    }
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4"
        style={{ background: '#08080e' }}>
        <div className="w-full max-w-lg">
          <div className="text-center mb-8">
            <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center"
              style={{ background: 'rgba(255,70,85,0.1)', border: '1px solid rgba(255,70,85,0.3)' }}>
              <Target size={28} color="#ff4655" />
            </div>
            <h2 className="font-display font-black text-3xl mb-1">Vote d'Arme</h2>
            <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
              {votedWeapon ? `✅ Tu as voté pour ${votedWeapon}` : 'Choisissez votre arme de combat'}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3">
            {WEAPONS.map(w => {
              const selected = votedWeapon === w
              return (
                <motion.button
                  key={w}
                  onClick={() => !votedWeapon && handleVoteWeapon(w)}
                  disabled={!!votedWeapon}
                  whileHover={!votedWeapon ? { scale: 1.02, x: 4 } : {}}
                  whileTap={!votedWeapon ? { scale: 0.98 } : {}}
                  className="p-4 rounded-xl font-semibold text-sm transition-all flex items-center gap-4"
                  style={{
                    background: selected ? 'rgba(16,185,129,0.12)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${selected ? 'rgba(16,185,129,0.4)' : 'rgba(255,255,255,0.08)'}`,
                    color: selected ? '#10b981' : 'rgba(255,255,255,0.7)',
                    cursor: votedWeapon ? 'not-allowed' : 'pointer',
                  }}
                >
                  <span className="text-2xl">{weaponIcons[w] || '🔫'}</span>
                  <span className="flex-1 text-left">{w}</span>
                  {selected && <CheckCircle size={18} color="#10b981" />}
                </motion.button>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════
  // PLAYING
  // ══════════════════════════════════════════════════════════════════
  if (gameState === 'playing' && roomData) {
    return (
      <div className="min-h-screen p-4" style={{ background: '#08080e' }}>
        <div className="max-w-4xl mx-auto space-y-4">

          {/* Match bar */}
          <div className="flex items-center gap-4 px-5 py-3 rounded-2xl"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: '#10b981' }} />
              <span className="text-xs font-bold uppercase tracking-wider" style={{ color: '#10b981' }}>En cours</span>
            </div>
            <div className="h-4 w-px" style={{ background: 'rgba(255,255,255,0.1)' }} />
            <div className="flex items-center gap-1.5">
              <Clock size={13} color="rgba(255,255,255,0.4)" />
              <span className="font-mono text-sm font-bold" style={{ color: '#e8e8f0' }}>{formatTime(matchTimer)}</span>
            </div>
            {chosenMap && (
              <>
                <div className="h-4 w-px" style={{ background: 'rgba(255,255,255,0.1)' }} />
                <div className="flex items-center gap-1.5">
                  <Map size={13} color="rgba(255,255,255,0.4)" />
                  <span className="text-sm font-semibold" style={{ color: '#e8e8f0' }}>{chosenMap}</span>
                </div>
              </>
            )}
            {chosenWeapon && (
              <>
                <div className="h-4 w-px" style={{ background: 'rgba(255,255,255,0.1)' }} />
                <span className="text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>🔫 {chosenWeapon}</span>
              </>
            )}
            <div className="ml-auto text-xs font-semibold" style={{ color: 'rgba(255,255,255,0.4)' }}>
              {roomData.mode} · #{roomData.roomId.slice(-6)}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            {/* Teams */}
            <div className="col-span-2 grid grid-cols-2 gap-3">
              {[
                { label: 'Équipe 1', players: roomData.team1, cap: roomData.captains[0], color: '#06b6d4', isMe: myTeam === 1 },
                { label: 'Équipe 2', players: roomData.team2, cap: roomData.captains[1], color: '#f97316', isMe: myTeam === 2 },
              ].map((team, i) => (
                <div key={i} className="rounded-2xl overflow-hidden"
                  style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${team.isMe ? team.color + '40' : 'rgba(255,255,255,0.07)'}` }}>
                  <div className="px-4 py-2.5 flex items-center justify-between"
                    style={{ background: `${team.color}10`, borderBottom: `1px solid ${team.color}25` }}>
                    <span className="text-xs font-bold uppercase tracking-wider" style={{ color: team.color }}>
                      {team.isMe ? '✅ Mon équipe' : '❌ Adversaires'}
                    </span>
                  </div>
                  <div className="p-3 space-y-2">
                    {team.players.map(p => (
                      <div key={p.pseudo} className="flex items-center gap-2">
                        <UserAvatar pseudo={p.pseudo} avatar={p.avatar} size="md" isPremium={p.isPremium} frame={p.avatarFrame} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1">
                            <p className="text-sm font-semibold truncate">{p.pseudo}</p>
                            {p.pseudo === team.cap && <Crown size={11} color="#f59e0b" />}
                          </div>
                          <RankBadge elo={p.elo} size="sm" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Chat */}
            <div className="rounded-2xl flex flex-col overflow-hidden"
              style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', maxHeight: 360 }}>
              <div className="px-4 py-2.5 flex items-center gap-2"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <MessageCircle size={13} color="#ff4655" />
                <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.6)' }}>Chat</span>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-1.5 scrollbar-thin">
                {chatMessages.length === 0 && (
                  <p className="text-xs text-center py-4" style={{ color: 'rgba(255,255,255,0.2)' }}>Aucun message…</p>
                )}
                {chatMessages.map((msg, i) => (
                  <div key={i} className="text-xs leading-relaxed">
                    {msg.team === 'system' ? (
                      <span className="italic" style={{ color: 'rgba(255,255,255,0.35)' }}>{msg.text}</span>
                    ) : (
                      <>
                        <span className="font-bold" style={{
                          color: msg.team === 'team1' ? '#06b6d4' : msg.team === 'team2' ? '#f97316' : '#ff4655'
                        }}>
                          {msg.author}:{' '}
                        </span>
                        {msg.text && <span style={{ color: 'rgba(255,255,255,0.75)' }}>{msg.text}</span>}
                        {msg.img && (
                          <img src={msg.img} className="max-w-[180px] rounded-lg mt-1 cursor-pointer block" onClick={() => window.open(msg.img)} alt="screenshot" />
                        )}
                      </>
                    )}
                  </div>
                ))}
                <div ref={chatBottomRef} />
              </div>
              <div className="p-2 flex gap-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <input
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && sendChat()}
                  placeholder="Message…"
                  maxLength={120}
                  className="flex-1 text-xs rounded-lg px-3 py-2 outline-none"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#e8e8f0' }}
                />
                <input type="file" accept="image/*" ref={imgInputRef} className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) sendChatImg(f); e.target.value = '' }} />
                <button onClick={() => imgInputRef.current?.click()}
                  className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-all"
                  style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)' }}
                  title="Envoyer une image"
                >
                  <ImageIcon size={12} />
                </button>
                <button onClick={sendChat}
                  className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-all"
                  style={{ background: 'rgba(255,70,85,0.15)', color: '#ff4655' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,70,85,0.3)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,70,85,0.15)')}
                >
                  <Send size={12} />
                </button>
              </div>
            </div>
          </div>

          {/* Actions admin + report */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <button
              onClick={() => setShowReportModal(true)}
              disabled={reportSent}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all"
              style={{
                background: reportSent ? 'rgba(255,255,255,0.03)' : 'rgba(239,68,68,0.08)',
                border: `1px solid ${reportSent ? 'rgba(255,255,255,0.06)' : 'rgba(239,68,68,0.25)'}`,
                color: reportSent ? 'rgba(255,255,255,0.25)' : '#ef4444',
                cursor: reportSent ? 'not-allowed' : 'pointer',
              }}
            >
              <Skull size={11} />
              {reportSent ? 'Signalé ✓' : 'Signaler un joueur'}
            </button>
            <button
              onClick={handleRequestDecision}
              disabled={alertSent}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all"
              style={{
                background: alertSent ? 'rgba(255,255,255,0.04)' : 'rgba(245,158,11,0.08)',
                border: `1px solid ${alertSent ? 'rgba(255,255,255,0.08)' : 'rgba(245,158,11,0.3)'}`,
                color: alertSent ? 'rgba(255,255,255,0.3)' : '#f59e0b',
                cursor: alertSent ? 'not-allowed' : 'pointer',
              }}
            >
              <AlertTriangle size={13} />
              {alertSent ? 'Alerte envoyée…' : 'Demander une décision admin'}
            </button>
          </div>

          {/* Report modal */}
          {showReportModal && roomData && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="rounded-2xl p-4"
              style={{ background: 'rgba(14,14,23,0.98)', border: '1px solid rgba(239,68,68,0.3)' }}
            >
              <p className="text-sm font-bold mb-3 flex items-center gap-2">
                <Skull size={14} style={{ color: '#ef4444' }} />
                Signaler un joueur
              </p>
              {/* Target selection */}
              <p className="text-xs mb-2" style={{ color: 'rgba(255,255,255,0.4)' }}>Joueur à signaler :</p>
              <div className="flex flex-wrap gap-2 mb-3">
                {[...roomData.team1, ...roomData.team2]
                  .filter(p => p.pseudo !== user?.pseudo)
                  .map(p => (
                    <button
                      key={p.pseudo}
                      onClick={() => setReportTarget(p.pseudo)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                      style={{
                        background: reportTarget === p.pseudo ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.05)',
                        border: `1px solid ${reportTarget === p.pseudo ? 'rgba(239,68,68,0.5)' : 'rgba(255,255,255,0.1)'}`,
                        color: reportTarget === p.pseudo ? '#ef4444' : 'rgba(255,255,255,0.6)',
                      }}
                    >
                      {p.pseudo}
                    </button>
                  ))}
              </div>
              {/* Reason selection */}
              {reportTarget && (
                <>
                  <p className="text-xs mb-2" style={{ color: 'rgba(255,255,255,0.4)' }}>Raison :</p>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {['toxicité', 'triche', 'AFK', 'spam', 'autre'].map(r => (
                      <button
                        key={r}
                        onClick={() => handleReport(reportTarget, r)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                        style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#ef4444' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.2)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.1)')}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <button
                onClick={() => { setShowReportModal(false); setReportTarget(null) }}
                className="text-xs px-3 py-1.5 rounded-lg"
                style={{ color: 'rgba(255,255,255,0.3)' }}
              >
                Annuler
              </button>
            </motion.div>
          )}

          {/* Captain vote */}
          <AnimatePresence>
            {isCaptain && matchTimer >= 30 && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="p-5 rounded-2xl"
                style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.25)' }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <Crown size={16} color="#f59e0b" />
                  <p className="text-sm font-bold" style={{ color: '#f59e0b' }}>Déclarer le résultat</p>
                </div>
                {voteConflict && (
                  <div className="mb-3 p-3 rounded-xl text-xs flex items-center gap-2"
                    style={{ background: 'rgba(255,70,85,0.1)', color: '#ff4655', border: '1px solid rgba(255,70,85,0.2)' }}>
                    ⚠️ Conflit de vote détecté — Contactez un staff !
                  </div>
                )}
                <div className="flex gap-3">
                  <button onClick={() => handleVoteResult(true)}
                    className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-all"
                    style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', color: '#10b981' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(16,185,129,0.2)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'rgba(16,185,129,0.12)')}
                  >
                    ✅ Ma team a gagné
                  </button>
                  <button onClick={() => handleVoteResult(false)}
                    className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-all"
                    style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#ef4444' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.16)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.08)')}
                  >
                    ❌ Ma team a perdu
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════
  // IN QUEUE
  // ══════════════════════════════════════════════════════════════════
  if (gameState === 'in_queue') {
    return (
      <div className="p-6 flex items-center justify-center min-h-screen">
        <div className="text-center">
          <motion.div
            animate={{ scale: [1, 1.1, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="w-32 h-32 rounded-full mx-auto mb-6 flex items-center justify-center glow-pulse"
            style={{ background: 'rgba(255,70,85,0.1)', border: '2px solid #ff4655' }}
          >
            <Sword size={40} style={{ color: '#ff4655' }} />
          </motion.div>
          <h2 className="font-display font-bold text-2xl mb-2">Recherche en cours…</h2>
          <p className="text-sm mb-1" style={{ color: 'rgba(255,255,255,0.5)' }}>Mode : {selectedMode}</p>
          <p className="font-mono text-lg mb-6" style={{ color: '#ff4655' }}>{formatTime(queueTime)}</p>
          <button onClick={handleCancelQueue} className="btn-ghost px-6 py-2.5 flex items-center gap-2 mx-auto">
            <X size={16} /> Annuler
          </button>
        </div>
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════
  // IDLE — Main matchmaking screen
  // ══════════════════════════════════════════════════════════════════
  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="font-display font-black text-4xl">Matchmaking</h1>
        <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.35)' }}>
          Choisis ton mode et affronte des adversaires de ton niveau
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Mode selector + buttons */}
        <div className="lg:col-span-2 space-y-4">
          {/* Mode cards */}
          <div className="grid grid-cols-2 gap-3">
            {MODES.map(mode => {
              const elo = user.stats?.[mode]?.elo ?? 500
              const rank = getRankFromElo(elo)
              const isSelected = selectedMode === mode
              return (
                <motion.button
                  key={mode}
                  onClick={() => handleChangeMode(mode)}
                  whileHover={{ scale: 1.02, y: -2 }}
                  whileTap={{ scale: 0.98 }}
                  className="p-5 rounded-2xl text-left transition-all relative overflow-hidden"
                  style={{
                    background: isSelected ? 'rgba(255,70,85,0.08)' : 'rgba(255,255,255,0.03)',
                    border: `2px solid ${isSelected ? '#ff4655' : 'rgba(255,255,255,0.07)'}`,
                  }}
                >
                  {isSelected && (
                    <div className="absolute top-0 left-0 right-0 h-0.5"
                      style={{ background: 'linear-gradient(90deg, transparent, #ff4655, transparent)' }} />
                  )}
                  <div className="flex items-start justify-between mb-3">
                    <span className="font-display font-black text-2xl">{mode}</span>
                    <span className="text-sm font-bold" style={{ color: rank.color }}>{elo}</span>
                  </div>
                  <p className="text-xs mb-3" style={{ color: 'rgba(255,255,255,0.35)' }}>{modeDesc[mode]}</p>
                  <RankBadge elo={elo} size="sm" />
                </motion.button>
              )
            })}
          </div>

          {/* Mise de coins — tous les modes */}
          <div className="mb-4">
              <p className="text-xs font-semibold mb-2" style={{ color: 'rgba(255,255,255,0.5)' }}>💰 Mise de coins (optionnelle)</p>
              <div className="flex gap-2 flex-wrap">
                {[0, 50, 100, 200, 500].map(amt => {
                  const canAfford = amt === 0 || (user?.coins ?? 0) >= amt
                  return (
                    <button
                      key={amt}
                      onClick={() => {
                        if (!canAfford) { toast.error(`Coins insuffisants (tu as ${user?.coins ?? 0} 🪙)`); return }
                        setWager(amt); socket.emit('set_wager', { amount: amt })
                      }}
                      title={!canAfford ? `Tu as ${user?.coins ?? 0} 🪙` : undefined}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                      style={{
                        background: wager === amt ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.04)',
                        border: `1px solid ${wager === amt ? 'rgba(245,158,11,0.5)' : 'rgba(255,255,255,0.08)'}`,
                        color: wager === amt ? '#f59e0b' : canAfford ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.2)',
                        opacity: canAfford ? 1 : 0.5,
                        cursor: canAfford ? 'pointer' : 'not-allowed',
                      }}
                    >
                      {amt === 0 ? 'Sans mise' : `${amt} 🪙`}
                      {!canAfford && amt > 0 && <span className="ml-1">🔒</span>}
                    </button>
                  )
                })}
              </div>
              {wager > 0 && (
                <p className="text-xs mt-1.5" style={{ color: 'rgba(255,255,255,0.3)' }}>
                  Chaque gagnant remporte {wager} 🪙 d'un adversaire · Chaque perdant perd {wager} 🪙
                </p>
              )}
            </div>

          {/* Queue cooldown banner */}
          {queueCooldownEndsAt && cooldownRemaining > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-3 px-4 py-3 rounded-xl mb-2"
              style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)' }}
            >
              <Clock size={14} style={{ color: '#f59e0b', flexShrink: 0 }} />
              <div className="flex-1">
                <p className="text-xs font-semibold" style={{ color: '#f59e0b' }}>
                  Cooldown — nouvelle partie dans {cooldownRemaining}s
                </p>
                <div className="mt-1.5 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${(cooldownRemaining / 30) * 100}%`, background: '#f59e0b' }} />
                </div>
              </div>
            </motion.div>
          )}

          {/* CTA buttons */}
          <motion.button
            onClick={handleFindMatch}
            disabled={!!(queueCooldownEndsAt && cooldownRemaining > 0)}
            whileHover={{ scale: queueCooldownEndsAt && cooldownRemaining > 0 ? 1 : 1.01 }}
            whileTap={{ scale: queueCooldownEndsAt && cooldownRemaining > 0 ? 1 : 0.99 }}
            className="w-full py-4 rounded-2xl font-display font-black text-lg flex items-center justify-center gap-3 transition-all"
            style={{
              background: queueCooldownEndsAt && cooldownRemaining > 0
                ? 'rgba(255,255,255,0.05)'
                : 'linear-gradient(135deg, #ff4655, #e03545)',
              color: queueCooldownEndsAt && cooldownRemaining > 0 ? 'rgba(255,255,255,0.3)' : '#fff',
              boxShadow: queueCooldownEndsAt && cooldownRemaining > 0 ? 'none' : '0 4px 24px rgba(255,70,85,0.25)',
              cursor: queueCooldownEndsAt && cooldownRemaining > 0 ? 'not-allowed' : 'pointer',
              border: queueCooldownEndsAt && cooldownRemaining > 0 ? '1px solid rgba(255,255,255,0.08)' : 'none',
            }}
          >
            <Sword size={20} />
            {queueCooldownEndsAt && cooldownRemaining > 0 ? `Cooldown (${cooldownRemaining}s)` : 'Trouver une partie'}
          </motion.button>

          <motion.button
            onClick={handleBotMatch}
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            className="w-full py-3 rounded-2xl text-sm font-semibold flex items-center justify-center gap-2 transition-all"
            style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)', color: '#818cf8' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(99,102,241,0.15)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(99,102,241,0.08)')}
          >
            🤖 Tester vs Bots
            <span style={{ fontSize: 11, opacity: 0.5 }}>(test)</span>
          </motion.button>

          {/* Wager rooms lobby */}
          {wagerRooms.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-xl p-4"
              style={{ background: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.15)' }}
            >
              <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'rgba(245,158,11,0.7)' }}>
                💰 Files avec mises en attente
              </p>
              <div className="space-y-2">
                {wagerRooms.map((room, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2 rounded-lg"
                    style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div className="flex items-center gap-2">
                      <span className="font-black text-sm" style={{ color: '#ff4655' }}>{room.mode}</span>
                      <span className="text-xs px-2 py-0.5 rounded-md font-bold"
                        style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}>
                        {room.wager} 🪙
                      </span>
                      <span className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
                        {room.count} joueur{room.count > 1 ? 's' : ''} — pseudos masqués
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        if ((user?.coins ?? 0) < room.wager) {
                          toast.error(`Coins insuffisants pour cette mise (${room.wager} requis)`)
                          return
                        }
                        if (selectedMode !== room.mode as Mode) {
                          handleChangeMode(room.mode as Mode)
                        }
                        setWager(room.wager)
                        socket.emit('set_wager', { amount: room.wager })
                        setTimeout(() => handleFindMatch(), 100)
                      }}
                      className="text-xs px-3 py-1.5 rounded-lg font-bold transition-all"
                      style={{ background: 'rgba(245,158,11,0.2)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(245,158,11,0.35)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'rgba(245,158,11,0.2)')}
                    >
                      Rejoindre →
                    </button>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </div>

        {/* Group panel */}
        <div className="rounded-2xl p-5"
          style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <h2 className="font-bold mb-5 flex items-center gap-2 text-sm uppercase tracking-wider"
            style={{ color: 'rgba(255,255,255,0.5)' }}>
            <Users size={14} color="#ff4655" />
            Groupe
          </h2>

          {!groupCode ? (
            <div className="space-y-3">
              <button onClick={handleCreateGroup}
                className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all"
                style={{ background: 'rgba(255,70,85,0.1)', border: '1px solid rgba(255,70,85,0.25)', color: '#ff4655' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,70,85,0.18)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,70,85,0.1)')}
              >
                Créer un groupe
              </button>
              <div className="flex gap-2">
                <input
                  value={joinCodeInput}
                  onChange={e => setJoinCodeInput(e.target.value.toUpperCase())}
                  placeholder="Code groupe"
                  maxLength={6}
                  className="flex-1 text-sm py-2 px-3 rounded-xl outline-none"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#e8e8f0' }}
                />
                <button onClick={handleJoinGroup}
                  className="px-3 py-2 rounded-xl text-sm font-semibold transition-all"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                >
                  Rejoindre
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div className="p-4 rounded-xl mb-4 text-center"
                style={{ background: 'rgba(255,70,85,0.06)', border: '1px solid rgba(255,70,85,0.2)' }}>
                <p className="text-xs mb-1" style={{ color: 'rgba(255,255,255,0.35)' }}>Code du groupe</p>
                <p className="font-display font-black text-2xl tracking-widest" style={{ color: '#ff4655' }}>{groupCode}</p>
              </div>
              <div className="space-y-2">
                {groupPlayers.map(p => (
                  <div key={p.pseudo} className="flex items-center gap-2 p-2 rounded-lg"
                    style={{ background: 'rgba(255,255,255,0.03)' }}>
                    <UserAvatar pseudo={p.pseudo} size="sm" />
                    <span className="text-sm font-medium flex-1">{p.pseudo}</span>
                    <span className="text-xs font-bold" style={{ color: 'rgba(255,255,255,0.3)' }}>{p.elo}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-5 p-3 rounded-xl"
            style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="flex items-center gap-2 mb-1">
              <Shield size={11} color="#ff4655" />
              <span className="text-xs font-semibold" style={{ color: 'rgba(255,255,255,0.4)' }}>Matchmaking ELO</span>
            </div>
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.25)' }}>
              Les équipes sont formées par ELO similaire pour des parties équilibrées
            </p>
          </div>
        </div>
      </div>

      {/* Rank-up overlay */}
      <AnimatePresence>
        {rankUpData && (
          <RankUpModal
            from={rankUpData.from}
            to={rankUpData.to}
            onClose={() => setRankUpData(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
