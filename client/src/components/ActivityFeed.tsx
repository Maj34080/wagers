import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Activity } from 'lucide-react'
import socket from '../lib/socket'
import api from '../lib/api'

interface ActivityEvent {
  type: string
  data: Record<string, unknown>
  time: number
}

function formatActivity(event: ActivityEvent): { icon: string; text: string } {
  switch (event.type) {
    case 'new_player':
      return { icon: '🎮', text: `${event.data.pseudo} a rejoint REVENGE !` }
    case 'rank_up':
      return { icon: '🚀', text: `${event.data.pseudo} → ${event.data.newRank} en ${event.data.mode}` }
    case 'milestone':
      return { icon: '🏆', text: `${event.data.pseudo} a atteint ${event.data.wins} victoires !` }
    case 'premium_granted':
      return { icon: '👑', text: `${event.data.pseudo} est maintenant Premium !` }
    default:
      return { icon: '📢', text: JSON.stringify(event.data) }
  }
}

function timeAgo(ms: number): string {
  const diff = (Date.now() - ms) / 1000
  if (diff < 60) return 'à l\'instant'
  if (diff < 3600) return `${Math.floor(diff / 60)}min`
  return `${Math.floor(diff / 3600)}h`
}

export default function ActivityFeed() {
  const [events, setEvents] = useState<ActivityEvent[]>([])

  useEffect(() => {
    api.get('/api/activity-feed').then(res => {
      setEvents(res.data.slice(-10).reverse())
    }).catch(() => {})
  }, [])

  useEffect(() => {
    const handler = (event: ActivityEvent) => {
      setEvents(prev => [event, ...prev].slice(0, 10))
    }
    socket.on('activity_feed', handler)
    return () => { socket.off('activity_feed', handler) }
  }, [])

  return (
    <div className="glass-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <Activity size={14} style={{ color: '#ff4655' }} />
        <span className="text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.7)' }}>Activité récente</span>
      </div>
      <div className="space-y-2">
        <AnimatePresence initial={false}>
          {events.length === 0 && (
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>Aucune activité récente</p>
          )}
          {events.map((event, i) => {
            const { icon, text } = formatActivity(event)
            return (
              <motion.div
                key={event.time + i}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="flex items-start gap-2"
              >
                <span className="text-sm flex-shrink-0">{icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs leading-tight" style={{ color: 'rgba(255,255,255,0.7)' }}>{text}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.3)' }}>{timeAgo(event.time)}</p>
                </div>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </div>
  )
}
