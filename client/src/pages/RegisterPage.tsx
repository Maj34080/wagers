import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Zap, Eye, EyeOff, AlertCircle } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import toast from 'react-hot-toast'

export default function RegisterPage() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [pseudo, setPseudo] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [referralCode, setReferralCode] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (password !== confirmPassword) {
      setError('Les mots de passe ne correspondent pas')
      return
    }
    if (pseudo.length < 3) {
      setError('Pseudo trop court (3 min)')
      return
    }
    if (password.length < 4) {
      setError('Mot de passe trop court (4 min)')
      return
    }
    setLoading(true)
    try {
      await register(pseudo, password, referralCode || undefined)
      toast.success('Compte créé ! Bienvenue sur REVENGE !')
      navigate('/app')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Erreur d\'inscription'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8 relative" style={{ background: '#08080e' }}>
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-96 h-96 rounded-full blur-3xl opacity-10"
          style={{ background: '#7c3aed' }} />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative z-10 w-full max-w-md"
      >
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center gap-2">
            <Zap size={28} style={{ color: '#ff4655' }} />
            <span className="font-display font-bold text-3xl gradient-text">REVENGE</span>
          </Link>
          <p className="mt-2 text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>Rejoins la compétition</p>
        </div>

        <div className="glass-card p-8">
          <h1 className="font-display font-bold text-2xl mb-6 text-center">Créer un compte</h1>

          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2 p-3 rounded-lg mb-4 text-sm"
              style={{ background: 'rgba(255,70,85,0.1)', border: '1px solid rgba(255,70,85,0.2)', color: '#ff4655' }}
            >
              <AlertCircle size={14} />
              {error}
            </motion.div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'rgba(255,255,255,0.6)' }}>
                Pseudo <span style={{ color: '#ff4655' }}>*</span>
              </label>
              <input
                className="input-field"
                type="text"
                placeholder="Choisis ton pseudo (3 min)"
                value={pseudo}
                onChange={e => setPseudo(e.target.value)}
                minLength={3}
                maxLength={20}
                required
              />
            </div>

            <div>
              <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'rgba(255,255,255,0.6)' }}>
                Mot de passe <span style={{ color: '#ff4655' }}>*</span>
              </label>
              <div className="relative">
                <input
                  className="input-field pr-10"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Choisis un mot de passe"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  minLength={4}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  style={{ color: 'rgba(255,255,255,0.3)' }}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'rgba(255,255,255,0.6)' }}>
                Confirmer le mot de passe <span style={{ color: '#ff4655' }}>*</span>
              </label>
              <input
                className="input-field"
                type={showPassword ? 'text' : 'password'}
                placeholder="Répète ton mot de passe"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="text-xs font-semibold mb-1.5 block" style={{ color: 'rgba(255,255,255,0.6)' }}>
                Code de parrainage <span style={{ color: 'rgba(255,255,255,0.3)' }}>(optionnel)</span>
              </label>
              <input
                className="input-field"
                type="text"
                placeholder="Code de ton parrain"
                value={referralCode}
                onChange={e => setReferralCode(e.target.value)}
              />
            </div>

            <motion.button
              type="submit"
              disabled={loading}
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              className="btn-primary w-full py-3 text-base"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Création…
                </span>
              ) : 'Créer mon compte'}
            </motion.button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
              Déjà un compte ?{' '}
              <Link to="/login" className="font-semibold" style={{ color: '#ff4655' }}>
                Se connecter
              </Link>
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
