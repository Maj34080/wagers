import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Users, UserPlus, Check, X, Search, Circle } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import socket from '../lib/socket'
import UserAvatar from '../components/UserAvatar'
import RankBadge from '../components/RankBadge'
import toast from 'react-hot-toast'

interface FriendInfo {
  id: string
  pseudo: string
  avatar: string | null
  elo: number
  online: boolean
  isPremium: boolean
}

interface FriendRequest {
  fromId: string
  fromPseudo: string
  fromAvatar: string | null
}

export default function FriendsPage() {
  const { user } = useAuth()
  const [friends, setFriends] = useState<FriendInfo[]>([])
  const [requests, setRequests] = useState<FriendRequest[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user?.id) return
    setLoading(true)
    socket.emit('get_friends', { userId: user.id })
  }, [user?.id])

  useEffect(() => {
    const onFriendsList = (data: FriendInfo[]) => {
      setFriends(data)
      setLoading(false)
    }
    const onFriendRequestReceived = (req: FriendRequest) => {
      setRequests(prev => [...prev, req])
      toast(`📨 ${req.fromPseudo} veut être ton ami !`)
    }
    const onFriendAdded = (friend: FriendInfo) => {
      setFriends(prev => [...prev, friend])
      setRequests(prev => prev.filter(r => r.fromId !== friend.id))
      toast.success(`${friend.pseudo} est maintenant ton ami !`)
    }
    const onFriendRemoved = (data: { friendId: string }) => {
      setFriends(prev => prev.filter(f => f.id !== data.friendId))
    }
    const onFriendError = (err: string) => toast.error(err)

    socket.on('friends_list', onFriendsList)
    socket.on('friend_request_received', onFriendRequestReceived)
    socket.on('friend_added', onFriendAdded)
    socket.on('friend_removed', onFriendRemoved)
    socket.on('friend_error', onFriendError)

    return () => {
      socket.off('friends_list', onFriendsList)
      socket.off('friend_request_received', onFriendRequestReceived)
      socket.off('friend_added', onFriendAdded)
      socket.off('friend_removed', onFriendRemoved)
      socket.off('friend_error', onFriendError)
    }
  }, [])

  const handleSendRequest = () => {
    if (!searchQuery.trim() || !user) return
    socket.emit('send_friend_request', { fromId: user.id, toPseudo: searchQuery.trim() })
    setSearchQuery('')
    toast('Demande envoyée !')
  }

  const handleAccept = (fromId: string) => {
    if (!user) return
    socket.emit('accept_friend_request', { userId: user.id, fromId })
  }

  const handleDeny = (fromId: string) => {
    if (!user) return
    socket.emit('deny_friend_request', { userId: user.id, fromId })
    setRequests(prev => prev.filter(r => r.fromId !== fromId))
  }

  const handleRemove = (friendId: string) => {
    if (!user) return
    socket.emit('remove_friend', { userId: user.id, friendId })
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="font-display font-bold text-3xl flex items-center gap-3">
          <Users size={28} style={{ color: '#ff4655' }} /> Amis
        </h1>
        <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>Gérer ta liste d'amis</p>
      </div>

      {/* Add friend */}
      <div className="glass-card p-5 mb-6">
        <h2 className="font-semibold mb-3 flex items-center gap-2">
          <UserPlus size={14} style={{ color: '#ff4655' }} />
          Ajouter un ami
        </h2>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'rgba(255,255,255,0.3)' }} />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSendRequest()}
              placeholder="Pseudo de ton ami…"
              className="input-field pl-9"
            />
          </div>
          <button onClick={handleSendRequest} className="btn-primary px-4 text-sm">
            Envoyer
          </button>
        </div>
      </div>

      {/* Friend requests */}
      {requests.length > 0 && (
        <div className="glass-card p-5 mb-6">
          <h2 className="font-semibold mb-3 text-sm" style={{ color: '#f59e0b' }}>
            📨 Demandes en attente ({requests.length})
          </h2>
          <div className="space-y-3">
            {requests.map(req => (
              <motion.div
                key={req.fromId}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex items-center gap-3 p-3 rounded-xl"
                style={{ background: 'rgba(255,255,255,0.03)' }}
              >
                <UserAvatar pseudo={req.fromPseudo} avatar={req.fromAvatar} size="md" />
                <span className="flex-1 font-medium">{req.fromPseudo}</span>
                <button onClick={() => handleAccept(req.fromId)} className="p-2 rounded-lg text-xs" style={{ background: 'rgba(16,185,129,0.2)', color: '#10b981' }}>
                  <Check size={14} />
                </button>
                <button onClick={() => handleDeny(req.fromId)} className="p-2 rounded-lg text-xs" style={{ background: 'rgba(239,68,68,0.2)', color: '#ef4444' }}>
                  <X size={14} />
                </button>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* Friends list */}
      <div className="glass-card p-5">
        <h2 className="font-semibold mb-4">Mes amis ({friends.length})</h2>
        {loading ? (
          <div className="text-center py-8">
            <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : friends.length === 0 ? (
          <p className="text-sm text-center py-6" style={{ color: 'rgba(255,255,255,0.3)' }}>
            Aucun ami pour l'instant. Ajoute des joueurs !
          </p>
        ) : (
          <div className="space-y-3">
            {friends.map(friend => (
              <motion.div
                key={friend.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-center gap-3 p-3 rounded-xl group"
                style={{ background: 'rgba(255,255,255,0.03)' }}
              >
                <div className="relative">
                  <UserAvatar pseudo={friend.pseudo} avatar={friend.avatar} size="md" isPremium={friend.isPremium} />
                  {friend.online && (
                    <Circle size={8} fill="#10b981" style={{ color: '#10b981', position: 'absolute', bottom: 0, right: 0 }} />
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{friend.pseudo}</span>
                    <span className="text-xs" style={{ color: friend.online ? '#10b981' : 'rgba(255,255,255,0.3)' }}>
                      {friend.online ? '● En ligne' : '○ Hors ligne'}
                    </span>
                  </div>
                  <RankBadge elo={friend.elo} size="sm" />
                </div>
                <button
                  onClick={() => handleRemove(friend.id)}
                  className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg transition-opacity text-xs"
                  style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}
                >
                  <X size={12} />
                </button>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
