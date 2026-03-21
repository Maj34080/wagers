interface UserAvatarProps {
  pseudo: string
  avatar?: string | null
  size?: 'sm' | 'md' | 'lg' | 'xl'
  isPremium?: boolean
  isFondateur?: boolean
  isContent?: boolean
  frame?: string | null
  /** Hide the premium/content/fondateur badge icon entirely */
  noBadge?: boolean
}

const sizes = {
  sm: { outer: 'w-8 h-8',   text: 'text-xs'  },
  md: { outer: 'w-10 h-10', text: 'text-sm'  },
  lg: { outer: 'w-14 h-14', text: 'text-lg'  },
  xl: { outer: 'w-20 h-20', text: 'text-2xl' },
}

const colors = ['#ff4655', '#7c3aed', '#06b6d4', '#10b981', '#f59e0b', '#f97316', '#8b5cf6']

function getColor(pseudo: string) {
  let hash = 0
  for (let i = 0; i < pseudo.length; i++) hash = pseudo.charCodeAt(i) + ((hash << 5) - hash)
  return colors[Math.abs(hash) % colors.length]
}

// Frame CSS class mapping
const FRAME_CLASSES: Record<string, string> = {
  glow_red:   'avatar-frame-glow-red',
  glow_blue:  'avatar-frame-glow-blue',
  rainbow:    'avatar-frame-rainbow',
  fire:       'avatar-frame-fire',
  diamond:    'avatar-frame-diamond',
  elite:      'avatar-frame-elite',
  gold_prem:  'avatar-frame-gold',
  neon_green: 'avatar-frame-neon-green',
  plasma:     'avatar-frame-plasma',
  void_dark:  'avatar-frame-void',
  cosmic:     'avatar-frame-cosmic',
  electric:   'avatar-frame-electric',
  sunset:     'avatar-frame-sunset',
}

export default function UserAvatar({
  pseudo, avatar, size = 'md', isPremium, isFondateur, isContent, frame, noBadge
}: UserAvatarProps) {
  const s = sizes[size]
  const color = getColor(pseudo)

  // Frame takes priority over premium/fondateur border
  const frameClass = frame && FRAME_CLASSES[frame] ? FRAME_CLASSES[frame] : null

  const borderStyle = frameClass ? {} : isPremium
    ? { border: '2px solid #f59e0b', boxShadow: '0 0 10px rgba(245,158,11,0.3)' }
    : isFondateur
    ? { border: '2px solid #7c3aed', boxShadow: '0 0 10px rgba(124,58,237,0.3)' }
    : { border: '2px solid rgba(255,255,255,0.1)' }

  // If a frame is equipped OR noBadge is set → hide the badge icon
  const showBadge = !frameClass && !noBadge

  return (
    <div className="relative inline-flex flex-shrink-0">
      <div
        className={`${s.outer} ${s.text} rounded-full flex items-center justify-center font-bold overflow-hidden ${frameClass || ''}`}
        style={borderStyle}
      >
        {avatar ? (
          <img src={avatar} alt={pseudo} className="w-full h-full object-cover" />
        ) : (
          <div
            className="w-full h-full flex items-center justify-center font-display font-bold"
            style={{ background: `${color}22`, color }}
          >
            {pseudo.charAt(0).toUpperCase()}
          </div>
        )}
      </div>
      {showBadge && isPremium && (
        <div className="absolute -top-1 -right-1 text-xs" title="Premium"
          style={{ fontSize: size === 'sm' ? '8px' : '10px' }}>👑</div>
      )}
      {showBadge && !isPremium && isContent && (
        <div className="absolute -top-1 -right-1 text-xs" title="Content Creator"
          style={{ fontSize: size === 'sm' ? '8px' : '10px' }}>🎬</div>
      )}
      {showBadge && isFondateur && !isPremium && !isContent && (
        <div className="absolute -top-1 -right-1" title="Fondateur"
          style={{ fontSize: size === 'sm' ? '8px' : '10px' }}>⭐</div>
      )}
    </div>
  )
}
