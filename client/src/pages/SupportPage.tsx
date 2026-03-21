import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Headphones, Plus, ChevronRight, MessageCircle } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import api from '../lib/api'
import toast from 'react-hot-toast'

interface Ticket {
  id: string
  subject: string
  status: 'open' | 'closed'
  createdAt: string
  messages: { author: string; text: string; time: number }[]
}

export default function SupportPage() {
  const { user } = useAuth()
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null)
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!user) return
    api.get(`/api/tickets/user/${user.id}`)
      .then(res => setTickets(res.data || []))
      .catch(() => setTickets([]))
      .finally(() => setLoading(false))
  }, [user])

  const handleCreate = async () => {
    if (!subject.trim() || !message.trim() || !user) return
    const openCount = tickets.filter(t => t.status === 'open').length
    if (openCount >= 2) {
      toast.error('Tu as déjà 2 tickets ouverts. Attends qu\'ils soient résolus.')
      return
    }
    setCreating(true)
    try {
      const res = await api.post('/api/tickets', {
        userId: user.id,
        pseudo: user.pseudo,
        subject: subject.trim(),
        message: message.trim(),
      })
      setTickets(prev => [res.data, ...prev])
      setSubject('')
      setMessage('')
      setShowCreate(false)
      toast.success('Ticket créé ! Notre équipe te répondra bientôt.')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Erreur lors de la création'
      toast.error(msg)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6 flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display font-bold text-3xl flex items-center gap-3">
            <Headphones size={28} style={{ color: '#ff4655' }} /> Support
          </h1>
          <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>Ouvre un ticket pour contacter notre équipe</p>
        </div>
        <button
          onClick={() => setShowCreate(v => !v)}
          className="btn-primary text-sm px-4 py-2.5"
        >
          <Plus size={14} /> Nouveau ticket
        </button>
      </div>

      {/* Create form */}
      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="glass-card p-5 mb-6 overflow-hidden"
          >
            <h2 className="font-semibold mb-4">Créer un ticket</h2>
            <div className="space-y-3">
              <input
                className="input-field"
                placeholder="Sujet"
                value={subject}
                onChange={e => setSubject(e.target.value)}
              />
              <textarea
                className="input-field resize-none"
                placeholder="Décris ton problème…"
                value={message}
                onChange={e => setMessage(e.target.value)}
                rows={4}
              />
              <div className="flex gap-3">
                <button onClick={handleCreate} disabled={creating} className="btn-primary text-sm px-5 py-2.5">
                  {creating ? 'Envoi…' : 'Envoyer'}
                </button>
                <button onClick={() => setShowCreate(false)} className="btn-ghost text-sm px-5 py-2.5">
                  Annuler
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tickets list */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      ) : tickets.length === 0 ? (
        <div className="glass-card p-8 text-center">
          <MessageCircle size={32} className="mx-auto mb-3" style={{ color: 'rgba(255,255,255,0.2)' }} />
          <p style={{ color: 'rgba(255,255,255,0.4)' }}>Aucun ticket créé</p>
          <button onClick={() => setShowCreate(true)} className="btn-primary mt-4 text-sm px-5 py-2.5">
            Ouvrir mon premier ticket
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {tickets.map(ticket => (
            <motion.div
              key={ticket.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="glass-card p-4 cursor-pointer hover:bg-white/5 transition-colors"
              onClick={() => setSelectedTicket(selectedTicket?.id === ticket.id ? null : ticket)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span
                    className="px-2 py-0.5 rounded text-xs font-bold"
                    style={{
                      background: ticket.status === 'open' ? 'rgba(16,185,129,0.15)' : 'rgba(107,114,128,0.15)',
                      color: ticket.status === 'open' ? '#10b981' : '#6b7280',
                    }}
                  >
                    {ticket.status === 'open' ? 'OUVERT' : 'FERMÉ'}
                  </span>
                  <span className="font-medium">{ticket.subject}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
                    {new Date(ticket.createdAt).toLocaleDateString('fr-FR')}
                  </span>
                  <ChevronRight size={14} style={{
                    color: 'rgba(255,255,255,0.3)',
                    transform: selectedTicket?.id === ticket.id ? 'rotate(90deg)' : 'none',
                    transition: 'transform 0.2s',
                  }} />
                </div>
              </div>

              <AnimatePresence>
                {selectedTicket?.id === ticket.id && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mt-4 space-y-2 overflow-hidden"
                    onClick={e => e.stopPropagation()}
                  >
                    {ticket.messages?.map((msg, i) => (
                      <div key={i} className="p-3 rounded-xl text-sm"
                        style={{ background: 'rgba(255,255,255,0.03)', borderLeft: `2px solid ${msg.author === 'Staff' ? '#ff4655' : 'rgba(255,255,255,0.1)'}` }}>
                        <div className="flex justify-between items-center mb-1">
                          <span className="font-semibold text-xs" style={{ color: msg.author === 'Staff' ? '#ff4655' : 'rgba(255,255,255,0.7)' }}>
                            {msg.author}
                          </span>
                          <span className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
                            {new Date(msg.time).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <p style={{ color: 'rgba(255,255,255,0.7)' }}>{msg.text}</p>
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}
