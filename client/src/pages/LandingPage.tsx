import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import CountUp from 'react-countup'
import { Trophy, Sword, Shield, Zap, ChevronRight, Star } from 'lucide-react'
import api from '../lib/api'
import { useAuth } from '../context/AuthContext'

interface Stats {
  totalPlayers: number
  onlinePlayers: number
  totalMatches: number
}

const particles = Array.from({ length: 30 }, (_, i) => ({
  id: i,
  x: `${Math.random() * 100}%`,
  duration: `${8 + Math.random() * 12}s`,
  delay: `${Math.random() * 10}s`,
  d: (Math.random() - 0.5) * 2,
}))

export default function LandingPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const { isAuthenticated } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (isAuthenticated) navigate('/app')
  }, [isAuthenticated, navigate])

  useEffect(() => {
    api.get('/api/stats').then(res => setStats(res.data)).catch(() => {})
  }, [])

  return (
    <div style={{ background: '#08080e', minHeight: '100vh', color: '#e8e8f0' }}>
      {/* Particles */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        {particles.map(p => (
          <div
            key={p.id}
            className="particle"
            style={{
              '--x': p.x,
              '--duration': p.duration,
              '--delay': p.delay,
              '--d': p.d,
            } as React.CSSProperties}
          />
        ))}
        {/* Gradient orbs */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full blur-3xl opacity-10"
          style={{ background: '#ff4655' }} />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 rounded-full blur-3xl opacity-10"
          style={{ background: '#7c3aed' }} />
      </div>

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-8 py-5">
        <div className="flex items-center gap-2">
          <Zap size={24} style={{ color: '#ff4655' }} />
          <span className="font-display font-bold text-2xl gradient-text">REVENGE</span>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/login" className="btn-ghost text-sm py-2 px-4">Se connecter</Link>
          <Link to="/register" className="btn-primary text-sm py-2 px-4">Jouer maintenant</Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative z-10 flex flex-col items-center justify-center text-center px-4 pt-20 pb-24">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
        >
          <div className="mb-4 inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold"
            style={{ background: 'rgba(255,70,85,0.1)', border: '1px solid rgba(255,70,85,0.2)', color: '#ff4655' }}>
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            Nouvelle saison disponible
          </div>
          <h1 className="font-display font-bold text-8xl md:text-9xl mb-4 leading-none gradient-text">
            REVENGE
          </h1>
          <p className="text-xl mb-2" style={{ color: 'rgba(255,255,255,0.6)' }}>
            La plateforme compétitive FiveM
          </p>
          <p className="text-base mb-10" style={{ color: 'rgba(255,255,255,0.35)' }}>
            ELO Ranked • Classements • Clans & Tournois
          </p>

          <div className="flex items-center justify-center gap-4 flex-wrap">
            <Link to="/register">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.97 }}
                className="btn-primary text-base px-8 py-3"
              >
                Jouer maintenant <ChevronRight size={18} />
              </motion.button>
            </Link>
            <Link to="/login">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.97 }}
                className="btn-ghost text-base px-8 py-3"
              >
                Se connecter
              </motion.button>
            </Link>
          </div>
        </motion.div>

        {/* Live stats */}
        {stats && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.6 }}
            className="mt-16 flex items-center gap-8 flex-wrap justify-center"
          >
            {[
              { label: 'Joueurs', value: stats.totalPlayers },
              { label: 'En ligne', value: stats.onlinePlayers },
              { label: 'Parties jouées', value: stats.totalMatches },
            ].map(item => (
              <div key={item.label} className="text-center">
                <p className="font-display font-bold text-3xl" style={{ color: '#ff4655' }}>
                  <CountUp end={item.value} duration={2} />
                </p>
                <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>{item.label}</p>
              </div>
            ))}
          </motion.div>
        )}
      </section>

      {/* Features */}
      <section className="relative z-10 px-8 py-20 max-w-6xl mx-auto">
        <motion.h2
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          className="font-display font-bold text-3xl text-center mb-12"
        >
          Pourquoi REVENGE ?
        </motion.h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            {
              icon: Trophy,
              title: 'Classement ELO',
              desc: 'Système ELO complet avec rangs de Iron à Radiant. Grimpez les échelons et prouvez votre valeur.',
            },
            {
              icon: Sword,
              title: 'Matchmaking',
              desc: 'Trouvez des adversaires de votre niveau en 1v1, 2v2, 3v3 ou 5v5. File solo ou en groupe.',
            },
            {
              icon: Shield,
              title: 'Clans & Tournois',
              desc: 'Rejoignez ou créez un clan. Défiez d\'autres clans en BO3 et participez aux tournois.',
            },
          ].map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className="glass-card p-6"
            >
              <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-4"
                style={{ background: 'rgba(255,70,85,0.1)' }}>
                <f.icon size={24} style={{ color: '#ff4655' }} />
              </div>
              <h3 className="font-display font-bold text-xl mb-2">{f.title}</h3>
              <p className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.5)' }}>{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="relative z-10 px-8 py-20" style={{ background: 'rgba(14,14,23,0.5)' }}>
        <div className="max-w-4xl mx-auto">
          <motion.h2
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            className="font-display font-bold text-3xl text-center mb-12"
          >
            Comment ça marche ?
          </motion.h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {[
              { num: '01', title: 'Crée ton compte', desc: 'Inscription gratuite en 30 secondes' },
              { num: '02', title: 'Rejoins une file', desc: 'Choisis ton mode et lance la recherche' },
              { num: '03', title: 'Joue la partie', desc: 'Affrontez vos adversaires sur FiveM' },
              { num: '04', title: 'Grimpe les rangs', desc: 'Gagnez de l\'ELO et montez en rang' },
            ].map((step, i) => (
              <motion.div
                key={step.num}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                className="text-center"
              >
                <div className="font-display font-bold text-5xl mb-3 gradient-text">{step.num}</div>
                <h3 className="font-semibold text-base mb-1">{step.title}</h3>
                <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>{step.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Premium section */}
      <section className="relative z-10 px-8 py-20 max-w-3xl mx-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          className="gradient-border p-8 text-center"
        >
          <Star size={32} style={{ color: '#f59e0b', margin: '0 auto 12px' }} />
          <h2 className="font-display font-bold text-3xl mb-3">Premium REVENGE</h2>
          <p className="mb-6" style={{ color: 'rgba(255,255,255,0.6)' }}>
            Débloquez des avantages exclusifs : sélection d'arme prioritaire, bannière de profil personnalisée, badge Premium doré, et bien plus encore.
          </p>
          <Link to="/register">
            <motion.button whileHover={{ scale: 1.05 }} className="btn-primary px-8 py-3">
              Rejoindre maintenant
            </motion.button>
          </Link>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t py-8 text-center" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <div className="flex items-center justify-center gap-2 mb-2">
          <Zap size={16} style={{ color: '#ff4655' }} />
          <span className="font-display font-bold gradient-text">REVENGE</span>
        </div>
        <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>REVENGE © 2024 — La plateforme compétitive FiveM</p>
      </footer>
    </div>
  )
}
