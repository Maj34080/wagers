import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ShoppingBag, Crown, Sparkles, Star, Zap,
  CheckCircle, ChevronRight, Tag, Gift, Shield, TrendingUp, Package
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import api from '../lib/api'
import toast from 'react-hot-toast'
import UserAvatar from '../components/UserAvatar'

type ShopTab = 'featured' | 'premium' | 'avatars' | 'effects' | 'boosts' | 'inventory'

interface ShopItem {
  id: string
  name: string
  description: string
  price: number
  currency: 'coins' | 'real'
  category: ShopTab
  tag?: string
  color: string
  icon: string
  owned?: boolean
  limited?: boolean
}

const ITEMS: ShopItem[] = [
  // Premium
  {
    id: 'premium_1m',
    name: 'Premium 1 Mois',
    description: 'Badge doré, avatar animé, accès aux tournois premium, +10% ELO bonus',
    price: 4.99,
    currency: 'real',
    category: 'premium',
    tag: 'POPULAIRE',
    color: '#f59e0b',
    icon: '👑',
  },
  {
    id: 'premium_3m',
    name: 'Premium 3 Mois',
    description: 'Tout le contenu Premium pour 3 mois — économisez 15%',
    price: 12.99,
    currency: 'real',
    category: 'premium',
    tag: '-15%',
    color: '#f59e0b',
    icon: '👑',
  },
  {
    id: 'premium_6m',
    name: 'Premium 6 Mois',
    description: 'Tout le contenu Premium pour 6 mois — économisez 25%',
    price: 22.99,
    currency: 'real',
    category: 'premium',
    tag: 'MEILLEUR PRIX',
    color: '#f59e0b',
    icon: '👑',
  },

  // Avatars
  {
    id: 'avatar_radiant',
    name: 'Avatar Radiant',
    description: 'Cadre exclusif Radiant avec effet lumineux pulsant',
    price: 500,
    currency: 'coins',
    category: 'avatars',
    color: '#ff4655',
    icon: '⚡',
    limited: true,
  },
  {
    id: 'avatar_phantom',
    name: 'Avatar Phantom',
    description: 'Cadre Phantom avec ombre violette animée',
    price: 350,
    currency: 'coins',
    category: 'avatars',
    color: '#8b5cf6',
    icon: '👻',
  },
  {
    id: 'avatar_agent',
    name: 'Avatar Agent',
    description: 'Cadre Agent elite avec bordure animée multi-couleurs',
    price: 400,
    currency: 'coins',
    category: 'avatars',
    color: '#06b6d4',
    icon: '🕵️',
  },
  {
    id: 'avatar_vandal',
    name: 'Avatar Vandal',
    description: 'Cadre Vandal avec inscription gravée',
    price: 300,
    currency: 'coins',
    category: 'avatars',
    color: '#f97316',
    icon: '🔫',
  },

  // Effects
  {
    id: 'effect_fire',
    name: 'Effet Feu',
    description: 'Flammes animées autour de ton profil en jeu',
    price: 600,
    currency: 'coins',
    category: 'effects',
    tag: 'NOUVEAU',
    color: '#ef4444',
    icon: '🔥',
    limited: true,
  },
  {
    id: 'effect_ice',
    name: 'Effet Glace',
    description: 'Cristaux de glace animés autour de ton profil',
    price: 600,
    currency: 'coins',
    category: 'effects',
    color: '#06b6d4',
    icon: '❄️',
  },
  {
    id: 'effect_lightning',
    name: 'Effet Foudre',
    description: 'Éclairs électriques animés sur ton profil',
    price: 750,
    currency: 'coins',
    category: 'effects',
    tag: 'PREMIUM',
    color: '#f59e0b',
    icon: '⚡',
  },
]

const FEATURED_IDS = ['premium_1m', 'avatar_radiant', 'effect_fire']

const BOOST_ITEMS = [
  {
    id: 'boost_x15',
    name: 'Boost ELO ×1.5',
    description: '×1.5 ELO gagné sur tes 5 prochaines victoires. Stack avec ton ELO actuel.',
    price: 800,
    color: '#06b6d4',
    icon: '⚡',
    tag: 'POPULAIRE',
  },
  {
    id: 'boost_x2',
    name: 'Boost ELO ×2',
    description: '×2 ELO gagné sur tes 3 prochaines victoires. Maximum de gains garantis.',
    price: 1800,
    color: '#8b5cf6',
    icon: '🚀',
    tag: 'PUISSANT',
  },
  {
    id: 'shield',
    name: 'Bouclier ELO',
    description: 'Protège ton ELO lors de ta prochaine défaite. Aucune perte garantie.',
    price: 600,
    color: '#10b981',
    icon: '🛡️',
    tag: 'DÉFENSE',
  },
  {
    id: 'streak_protect',
    name: 'Protection de Streak',
    description: 'Garde ton streak de victoires même si tu perds une seule fois.',
    price: 400,
    color: '#f97316',
    icon: '🔥',
    tag: 'STREAK',
  },
]

interface InventoryData {
  ownedItems: { id: string; name: string; price: number; frame: string; frameDef: { label: string; emoji: string } }[]
  unlockedFrames: { frame: string; label: string; emoji: string }[]
  equippedFrame: string | null
  coins: number
}

export default function ShopPage() {
  const { user } = useAuth()
  const [tab, setTab] = useState<ShopTab>('featured')
  const [hoveredItem, setHoveredItem] = useState<string | null>(null)
  const [buyingBoost, setBuyingBoost] = useState<string | null>(null)
  const [buyingItem, setBuyingItem] = useState<string | null>(null)
  const [ownedItems, setOwnedItems] = useState<string[]>(user?.ownedItems || [])
  const [inventory, setInventory] = useState<InventoryData | null>(null)
  const [equippingFrame, setEquippingFrame] = useState<string | null>(null)
  const [hidePremiumBadge, setHidePremiumBadge] = useState<boolean>(user?.hidePremiumBadge ?? false)
  const [togglingBadge, setTogglingBadge] = useState(false)

  const featured = ITEMS.filter(i => FEATURED_IDS.includes(i.id))
  const displayed = tab === 'featured' ? featured : ITEMS.filter(i => i.category === tab)

  const fetchInventory = async () => {
    try {
      const token = localStorage.getItem('token')
      const res = await api.get('/api/shop/inventory', { headers: { Authorization: `Bearer ${token}` } })
      setInventory(res.data)
      setOwnedItems(res.data.ownedItems.map((i: { id: string }) => i.id))
    } catch { /* ignore */ }
  }

  useEffect(() => { fetchInventory() }, [])

  const handleBuy = async (item: ShopItem) => {
    if (item.currency === 'real') {
      toast('💳 Paiement en ligne bientôt disponible !', { icon: '🔔' })
      return
    }
    if (ownedItems.includes(item.id)) {
      toast('✅ Article déjà possédé !', { icon: '📦' })
      return
    }
    if ((user?.coins ?? 0) < item.price) {
      toast.error(`Coins insuffisants — ${item.price} requis (tu as ${user?.coins ?? 0})`)
      return
    }
    setBuyingItem(item.id)
    try {
      const token = localStorage.getItem('token')
      await api.post('/api/shop/buy-item', { itemId: item.id }, { headers: { Authorization: `Bearer ${token}` } })
      toast.success(`🎁 ${item.name} acheté ! Bordure débloquée.`)
      setOwnedItems(prev => [...prev, item.id])
      fetchInventory()
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Erreur lors de l\'achat')
    } finally {
      setBuyingItem(null)
    }
  }

  const handleEquipFrame = async (frame: string) => {
    setEquippingFrame(frame)
    try {
      const token = localStorage.getItem('token')
      await api.post('/api/battle-pass/equip-frame', { frame }, { headers: { Authorization: `Bearer ${token}` } })
      toast.success('Bordure équipée !')
      fetchInventory()
    } catch { toast.error('Erreur') } finally { setEquippingFrame(null) }
  }

  const handleTogglePremiumBadge = async () => {
    setTogglingBadge(true)
    try {
      const token = localStorage.getItem('token')
      const res = await api.post('/api/profile/toggle-premium-badge', {}, { headers: { Authorization: `Bearer ${token}` } })
      setHidePremiumBadge(res.data.hidePremiumBadge)
      toast.success(res.data.hidePremiumBadge ? '👑 Icône premium masquée' : '👑 Icône premium affichée')
    } catch { toast.error('Erreur') } finally { setTogglingBadge(false) }
  }

  const handleBuyBoost = async (boostId: string, price: number) => {
    if ((user?.coins ?? 0) < price) {
      toast.error(`Coins insuffisants (${price} requis)`)
      return
    }
    setBuyingBoost(boostId)
    try {
      const token = localStorage.getItem('token')
      await api.post('/api/shop/buy-boost', { boostId }, {
        headers: { Authorization: `Bearer ${token}` }
      })
      toast.success(`✅ Boost acheté ! Il sera activé lors de ta prochaine partie.`)
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Erreur lors de l\'achat')
    } finally {
      setBuyingBoost(null)
    }
  }

  const tabs: { key: ShopTab; label: string; icon: typeof ShoppingBag }[] = [
    { key: 'featured', label: 'À la une', icon: Star },
    { key: 'premium', label: 'Premium', icon: Crown },
    { key: 'avatars', label: 'Avatars', icon: Shield },
    { key: 'effects', label: 'Effets', icon: Sparkles },
    { key: 'boosts', label: 'Boosts ELO', icon: TrendingUp },
    { key: 'inventory', label: 'Inventaire', icon: Package },
  ]

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'rgba(255,70,85,0.15)', border: '1px solid rgba(255,70,85,0.3)' }}>
            <ShoppingBag size={20} style={{ color: '#ff4655' }} />
          </div>
          <div>
            <h1 className="font-display font-bold text-3xl gradient-text">Boutique</h1>
            <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
              Personnalise ton profil et soutiens la plateforme
            </p>
          </div>
        </div>

        {/* Coins balance */}
        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 px-4 py-2 rounded-xl"
            style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
            <span className="text-lg">🪙</span>
            <span className="font-bold text-sm" style={{ color: '#f59e0b' }}>{user?.coins ?? 0} Coins</span>
          </div>
          {user?.isPremium && (
            <div className="flex items-center gap-2 px-4 py-2 rounded-xl"
              style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)' }}>
              <Crown size={14} style={{ color: '#f59e0b' }} />
              <span className="font-bold text-sm" style={{ color: '#f59e0b' }}>Premium actif</span>
              <CheckCircle size={13} style={{ color: '#10b981' }} />
            </div>
          )}
        </div>
      </motion.div>

      {/* Banner */}
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.05 }}
        className="rounded-2xl p-6 mb-8 relative overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, rgba(255,70,85,0.15) 0%, rgba(139,92,246,0.15) 50%, rgba(245,158,11,0.15) 100%)',
          border: '1px solid rgba(255,70,85,0.25)',
        }}
      >
        <div className="absolute inset-0 opacity-5"
          style={{ background: 'radial-gradient(circle at 80% 50%, #ff4655 0%, transparent 60%)' }} />
        <div className="relative flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Gift size={16} style={{ color: '#f59e0b' }} />
              <span className="text-xs font-bold uppercase tracking-widest" style={{ color: '#f59e0b' }}>
                Offre de lancement
              </span>
            </div>
            <h2 className="font-display font-bold text-2xl mb-1">
              Passe à Premium 👑
            </h2>
            <p className="text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
              Badges exclusifs, tournois privés, bonus ELO et bien plus
            </p>
          </div>
          <button
            onClick={() => setTab('premium')}
            className="flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-sm transition-all"
            style={{
              background: 'linear-gradient(135deg, #f59e0b, #d97706)',
              color: '#000',
              boxShadow: '0 0 20px rgba(245,158,11,0.3)',
            }}
          >
            <Crown size={15} />
            Voir les offres
            <ChevronRight size={14} />
          </button>
        </div>
      </motion.div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-sm transition-all"
            style={{
              background: tab === t.key ? 'rgba(255,70,85,0.15)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${tab === t.key ? 'rgba(255,70,85,0.4)' : 'rgba(255,255,255,0.08)'}`,
              color: tab === t.key ? '#ff4655' : 'rgba(255,255,255,0.5)',
            }}
          >
            <t.icon size={13} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Items grid */}
      {tab !== 'inventory' && tab !== 'boosts' && <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.15 }}
          className={`grid gap-4 ${tab === 'premium' ? 'grid-cols-1 md:grid-cols-3' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'}`}
        >
          {displayed.map((item, i) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              onMouseEnter={() => setHoveredItem(item.id)}
              onMouseLeave={() => setHoveredItem(null)}
              className="relative rounded-2xl overflow-hidden transition-all"
              style={{
                background: hoveredItem === item.id
                  ? `linear-gradient(135deg, ${item.color}18 0%, rgba(14,14,23,1) 60%)`
                  : 'rgba(255,255,255,0.03)',
                border: `1px solid ${hoveredItem === item.id ? item.color + '40' : 'rgba(255,255,255,0.07)'}`,
                transform: hoveredItem === item.id ? 'translateY(-2px)' : 'translateY(0)',
                boxShadow: hoveredItem === item.id ? `0 8px 32px ${item.color}20` : 'none',
                transition: 'all 0.2s ease',
              }}
            >
              {/* Tags */}
              <div className="absolute top-3 right-3 flex gap-1.5 z-10">
                {item.tag && (
                  <span className="px-2 py-0.5 rounded-md text-xs font-black"
                    style={{
                      background: item.tag === 'PREMIUM' ? 'rgba(245,158,11,0.2)' : item.tag.includes('%') ? 'rgba(16,185,129,0.2)' : 'rgba(255,70,85,0.2)',
                      color: item.tag === 'PREMIUM' ? '#f59e0b' : item.tag.includes('%') ? '#10b981' : '#ff4655',
                      border: `1px solid ${item.tag === 'PREMIUM' ? 'rgba(245,158,11,0.3)' : item.tag.includes('%') ? 'rgba(16,185,129,0.3)' : 'rgba(255,70,85,0.3)'}`,
                    }}>
                    {item.tag}
                  </span>
                )}
                {item.limited && (
                  <span className="px-2 py-0.5 rounded-md text-xs font-black"
                    style={{ background: 'rgba(139,92,246,0.2)', color: '#8b5cf6', border: '1px solid rgba(139,92,246,0.3)' }}>
                    LIMITÉ
                  </span>
                )}
              </div>

              <div className="p-5">
                {/* Icon */}
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl mb-4"
                  style={{
                    background: `${item.color}18`,
                    border: `1px solid ${item.color}30`,
                  }}>
                  {item.icon}
                </div>

                {/* Info */}
                <h3 className="font-display font-bold text-lg mb-1.5">{item.name}</h3>
                <p className="text-xs mb-5 leading-relaxed" style={{ color: 'rgba(255,255,255,0.45)' }}>
                  {item.description}
                </p>

                {/* Price + Buy */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    {item.currency === 'real' ? (
                      <>
                        <Tag size={13} style={{ color: item.color }} />
                        <span className="font-black text-xl" style={{ color: item.color }}>
                          {item.price}€
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="text-lg">🪙</span>
                        <span className="font-black text-xl" style={{ color: item.color }}>
                          {item.price}
                        </span>
                        <span className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>coins</span>
                      </>
                    )}
                  </div>
                  {ownedItems.includes(item.id) ? (
                    <div className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold"
                      style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)' }}>
                      <CheckCircle size={12} />
                      Possédé
                    </div>
                  ) : (
                    <button
                      onClick={() => handleBuy(item)}
                      disabled={buyingItem === item.id}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition-all"
                      style={{
                        background: `${item.color}20`,
                        border: `1px solid ${item.color}40`,
                        color: item.color,
                        opacity: buyingItem === item.id ? 0.6 : 1,
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.background = item.color
                        e.currentTarget.style.color = '#000'
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = `${item.color}20`
                        e.currentTarget.style.color = item.color
                      }}
                    >
                      <Zap size={12} />
                      {buyingItem === item.id ? '…' : 'Acheter'}
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </AnimatePresence>}

      {/* Boosts tab content */}
      {tab === 'boosts' && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid gap-4 grid-cols-1 md:grid-cols-2"
        >
          {BOOST_ITEMS.map((item, i) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              className="relative rounded-2xl overflow-hidden p-5"
              style={{
                background: `linear-gradient(135deg, ${item.color}10 0%, rgba(14,14,23,1) 70%)`,
                border: `1px solid ${item.color}30`,
              }}
            >
              {item.tag && (
                <span className="absolute top-3 right-3 px-2 py-0.5 rounded-md text-xs font-black"
                  style={{ background: `${item.color}20`, color: item.color, border: `1px solid ${item.color}40` }}>
                  {item.tag}
                </span>
              )}
              <div className="text-3xl mb-3">{item.icon}</div>
              <h3 className="font-display font-bold text-lg mb-1" style={{ color: item.color }}>{item.name}</h3>
              <p className="text-xs mb-4 leading-relaxed" style={{ color: 'rgba(255,255,255,0.5)' }}>{item.description}</p>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="text-lg">🪙</span>
                  <span className="font-black text-xl" style={{ color: item.color }}>{item.price}</span>
                  <span className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>coins</span>
                </div>
                <button
                  onClick={() => handleBuyBoost(item.id, item.price)}
                  disabled={buyingBoost === item.id}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition-all"
                  style={{ background: item.color, color: '#000', opacity: buyingBoost === item.id ? 0.6 : 1 }}
                >
                  {buyingBoost === item.id ? '…' : 'Acheter'}
                </button>
              </div>
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* Inventory tab */}
      {tab === 'inventory' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          {/* Equipped frame preview */}
          <div className="glass-card p-5">
            <h3 className="font-display font-bold text-base mb-4">🎭 Aperçu de ton avatar</h3>
            <div className="flex items-center gap-5">
              <UserAvatar pseudo={user?.pseudo || '?'} avatar={user?.avatar} size="xl"
                isPremium={user?.isPremium} frame={inventory?.equippedFrame || undefined}
                noBadge={hidePremiumBadge} />
              <div className="space-y-3">
                <div>
                  <p className="font-semibold mb-1">Bordure équipée</p>
                  {inventory?.equippedFrame ? (
                    <p className="text-sm" style={{ color: '#f59e0b' }}>
                      {inventory.unlockedFrames.find(f => f.frame === inventory.equippedFrame)?.emoji}{' '}
                      {inventory.unlockedFrames.find(f => f.frame === inventory.equippedFrame)?.label || inventory.equippedFrame}
                    </p>
                  ) : (
                    <p className="text-sm" style={{ color: 'rgba(255,255,255,0.3)' }}>Aucune bordure</p>
                  )}
                  {inventory?.equippedFrame && (
                    <button onClick={() => handleEquipFrame('none')} className="mt-2 text-xs px-3 py-1 rounded-lg"
                      style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
                      Retirer la bordure
                    </button>
                  )}
                </div>
                {user?.isPremium && (
                  <div>
                    <p className="text-xs font-semibold mb-1.5" style={{ color: 'rgba(255,255,255,0.5)' }}>Options</p>
                    <button
                      onClick={handleTogglePremiumBadge}
                      disabled={togglingBadge}
                      className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg transition-all"
                      style={{
                        background: hidePremiumBadge ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.06)',
                        border: `1px solid ${hidePremiumBadge ? 'rgba(245,158,11,0.4)' : 'rgba(255,255,255,0.1)'}`,
                        color: hidePremiumBadge ? '#f59e0b' : 'rgba(255,255,255,0.5)',
                      }}
                    >
                      <span>{hidePremiumBadge ? '👑' : '🚫'}</span>
                      {hidePremiumBadge ? 'Icône premium masquée' : 'Masquer l\'icône premium 👑'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Unlocked frames */}
          {inventory && inventory.unlockedFrames.length > 0 ? (
            <div className="glass-card p-5">
              <h3 className="font-display font-bold text-base mb-4">🖼️ Mes bordures ({inventory.unlockedFrames.length})</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {inventory.unlockedFrames.map(f => (
                  <motion.button
                    key={f.frame}
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => handleEquipFrame(f.frame)}
                    disabled={equippingFrame === f.frame}
                    className="flex flex-col items-center gap-3 p-4 rounded-xl transition-all"
                    style={{
                      background: inventory.equippedFrame === f.frame ? 'rgba(255,70,85,0.1)' : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${inventory.equippedFrame === f.frame ? 'rgba(255,70,85,0.4)' : 'rgba(255,255,255,0.08)'}`,
                    }}
                  >
                    <UserAvatar pseudo={user?.pseudo || '?'} avatar={user?.avatar} size="lg" frame={f.frame} />
                    <div className="text-center">
                      <p className="text-xs font-bold" style={{ color: inventory.equippedFrame === f.frame ? '#ff4655' : '#e8e8f0' }}>
                        {f.emoji} {f.label}
                      </p>
                      {inventory.equippedFrame === f.frame ? (
                        <span className="text-xs" style={{ color: '#10b981' }}>✓ Équipée</span>
                      ) : (
                        <span className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
                          {equippingFrame === f.frame ? 'En cours…' : 'Équiper'}
                        </span>
                      )}
                    </div>
                  </motion.button>
                ))}
              </div>
            </div>
          ) : (
            <div className="glass-card p-8 text-center">
              <div className="text-4xl mb-3">📦</div>
              <p className="font-semibold mb-1">Inventaire vide</p>
              <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
                Achète des articles dans la boutique ou gagne des récompenses dans le Passe de Combat !
              </p>
            </div>
          )}

          {/* Owned shop items */}
          {inventory && inventory.ownedItems.length > 0 && (
            <div className="glass-card p-5">
              <h3 className="font-display font-bold text-base mb-4">🛍️ Articles achetés ({inventory.ownedItems.length})</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {inventory.ownedItems.map(item => (
                  <div key={item.id} className="flex items-center gap-3 p-3 rounded-xl"
                    style={{ background: 'rgba(16,185,129,0.05)', border: '1px solid rgba(16,185,129,0.15)' }}>
                    <span className="text-xl">{item.frameDef?.emoji}</span>
                    <div>
                      <p className="text-sm font-semibold">{item.name}</p>
                      <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{item.frameDef?.label}</p>
                    </div>
                    <CheckCircle size={14} style={{ color: '#10b981', marginLeft: 'auto' }} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      )}
    </div>
  )
}
