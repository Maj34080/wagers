import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import api from '../lib/api'
import socket from '../lib/socket'
import { User, ModeStats, Mode } from '../types'

interface AuthContextType {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  token: string | null
  login: (pseudo: string, password: string) => Promise<void>
  register: (pseudo: string, password: string, referralCode?: string) => Promise<void>
  logout: () => void
  updateUser: (partial: Partial<User>) => void
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const connectSocket = useCallback((tok: string) => {
    if (!socket.connected) {
      socket.connect()
    }
    socket.emit('auth_with_token', { token: tok })
  }, [])

  const updateUser = useCallback((partial: Partial<User>) => {
    setUser(prev => prev ? { ...prev, ...partial } : prev)
  }, [])

  // Listen for socket auth_ok to keep user in sync
  useEffect(() => {
    const onAuthOk = (data: {
      pseudo: string; stats: Record<Mode, ModeStats>; avatar: string | null
      banner: string | null; isAdmin: boolean; isContent: boolean; isPremium: boolean
      premiumUntil: number | null; userId: string; referralCode: string | null
      matchHistory: User['matchHistory']; isFondateur: boolean; fondateurDate: string | null
    }) => {
      setUser(prev => prev ? {
        ...prev,
        stats: data.stats,
        avatar: data.avatar,
        banner: data.banner,
        isAdmin: data.isAdmin,
        isContent: data.isContent,
        isPremium: data.isPremium,
        premiumUntil: data.premiumUntil,
        referralCode: data.referralCode,
        matchHistory: data.matchHistory,
        isFondateur: data.isFondateur,
        fondateurDate: data.fondateurDate,
      } : prev)
    }

    const onEloUpdate = ({ mode, newElo }: { mode: Mode; newElo: number; change: number }) => {
      setUser(prev => {
        if (!prev) return prev
        return {
          ...prev,
          stats: {
            ...prev.stats,
            [mode]: { ...prev.stats[mode], elo: newElo }
          }
        }
      })
    }

    socket.on('auth_ok', onAuthOk)
    socket.on('elo_update', onEloUpdate)

    return () => {
      socket.off('auth_ok', onAuthOk)
      socket.off('elo_update', onEloUpdate)
    }
  }, [])

  // Load user on mount
  useEffect(() => {
    const savedToken = localStorage.getItem('rv_token')
    if (!savedToken) {
      setIsLoading(false)
      return
    }

    setToken(savedToken)
    api.get('/api/auth/me')
      .then(res => {
        setUser(res.data.user)
        connectSocket(savedToken)
      })
      .catch(() => {
        localStorage.removeItem('rv_token')
        setToken(null)
      })
      .finally(() => setIsLoading(false))
  }, [connectSocket])

  const login = async (pseudo: string, password: string) => {
    const res = await api.post('/api/auth/login', { pseudo, password })
    const { token: tok, user: userData } = res.data
    localStorage.setItem('rv_token', tok)
    setToken(tok)
    setUser(userData)
    connectSocket(tok)
  }

  const register = async (pseudo: string, password: string, referralCode?: string) => {
    const res = await api.post('/api/auth/register', { pseudo, password, referralCode })
    const { token: tok, user: userData } = res.data
    localStorage.setItem('rv_token', tok)
    setToken(tok)
    setUser(userData)
    connectSocket(tok)
  }

  const logout = () => {
    localStorage.removeItem('rv_token')
    setToken(null)
    setUser(null)
    socket.disconnect()
  }

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated: !!user,
      isLoading,
      token,
      login,
      register,
      logout,
      updateUser,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
