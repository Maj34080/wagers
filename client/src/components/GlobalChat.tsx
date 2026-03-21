import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { MessageCircle, X, Send } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import api from '../lib/api'
import socket from '../lib/socket'
import { ChatMessage } from '../types'
import UserAvatar from './UserAvatar'

export default function GlobalChat() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.get('/api/global-chat').then(res => setMessages(res.data)).catch(() => {})
  }, [])

  useEffect(() => {
    const handler = (msg: ChatMessage) => {
      setMessages(prev => [...prev, msg].slice(-100))
    }
    socket.on('global_chat_msg', handler)
    return () => { socket.off('global_chat_msg', handler) }
  }, [])

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, open])

  const send = async () => {
    if (!input.trim() || !user) return
    setSending(true)
    try {
      await api.post('/api/global-chat', { userId: user.id, pseudo: user.pseudo, text: input.trim() })
      setInput('')
    } catch {
      // ignore
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      {/* Toggle button */}
      <motion.button
        onClick={() => setOpen(o => !o)}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        className="fixed bottom-6 right-6 w-12 h-12 rounded-full flex items-center justify-center shadow-lg z-50"
        style={{ background: 'linear-gradient(135deg, #ff4655, #c41a26)' }}
      >
        {open ? <X size={18} /> : <MessageCircle size={18} />}
        {!open && messages.length > 0 && (
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full text-xs flex items-center justify-center text-white font-bold">
            {Math.min(99, messages.length)}
          </span>
        )}
      </motion.button>

      {/* Panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed bottom-20 right-6 w-80 z-50 glass-card overflow-hidden"
            style={{ height: 400 }}
          >
            {/* Header */}
            <div className="p-3 border-b flex items-center justify-between" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
              <div className="flex items-center gap-2">
                <MessageCircle size={14} style={{ color: '#ff4655' }} />
                <span className="font-semibold text-sm">Chat global</span>
              </div>
              <button onClick={() => setOpen(false)} style={{ color: 'rgba(255,255,255,0.4)' }}>
                <X size={14} />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2 scrollbar-thin" style={{ height: 300 }}>
              {messages.map((msg, i) => (
                <div key={i} className="flex items-start gap-2">
                  <UserAvatar pseudo={msg.pseudo || msg.author || '?'} avatar={msg.avatar} size="sm" isPremium={msg.isPremium} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="text-xs font-semibold">{msg.pseudo || msg.author}</span>
                      {msg.role === 'admin' && (
                        <span className="text-xs font-bold px-1 rounded" style={{ background: 'rgba(255,70,85,0.2)', color: '#ff4655', fontSize: '10px' }}>ADMIN</span>
                      )}
                      {msg.role === 'content' && (
                        <span className="text-xs font-bold px-1 rounded" style={{ background: 'rgba(124,58,237,0.2)', color: '#7c3aed', fontSize: '10px' }}>CONTENT</span>
                      )}
                    </div>
                    <p className="text-xs mt-0.5 break-words" style={{ color: 'rgba(255,255,255,0.7)' }}>{msg.text}</p>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            {user && (
              <div className="p-2 border-t" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
                <div className="flex gap-2">
                  <input
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && send()}
                    placeholder="Message…"
                    maxLength={120}
                    className="flex-1 text-xs rounded-lg px-3 py-2 outline-none"
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', color: '#e8e8f0' }}
                  />
                  <button
                    onClick={send}
                    disabled={sending || !input.trim()}
                    className="p-2 rounded-lg"
                    style={{ background: 'rgba(255,70,85,0.2)', color: '#ff4655', opacity: sending || !input.trim() ? 0.5 : 1 }}
                  >
                    <Send size={14} />
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
