import { getRankFromElo } from '../utils/rank'

interface RankBadgeProps {
  elo: number
  showElo?: boolean
  size?: 'sm' | 'md'
}

// ── Sprite sheet from v1 ──────────────────────────────────────────────────────
// URL: https://i.imgur.com/F1HXEa7.png
// Base sprite size: 35×35px at background-size: 210px 139.9px
const SPRITE_URL = 'https://i.imgur.com/F1HXEa7.png'
const SPRITE_BASE_W = 210
const SPRITE_BASE_H = 139.9
const SPRITE_BASE_SIZE = 35

const SPRITE_POSITIONS: Record<string, [number, number]> = {
  Silver:   [-39.8,  -48.6],
  Gold:     [-73.1,  -48.6],
  Platinum: [-105.9, -49.0],
  Diamond:  [-139.6, -49.0],
  Radiant:  [-170.6, -48.6],
}

function RankIcon({ name, color, iconSize }: { name: string; color: string; iconSize: number }) {

  const pos = SPRITE_POSITIONS[name]
  if (!pos) return null

  const ratio = iconSize / SPRITE_BASE_SIZE
  const bgW = SPRITE_BASE_W * ratio
  const bgH = SPRITE_BASE_H * ratio
  const bpX = pos[0] * ratio
  const bpY = pos[1] * ratio

  return (
    <span
      style={{
        display: 'inline-block',
        width: iconSize,
        height: iconSize,
        backgroundImage: `url(${SPRITE_URL})`,
        backgroundRepeat: 'no-repeat',
        backgroundSize: `${bgW}px ${bgH}px`,
        backgroundPosition: `${bpX}px ${bpY}px`,
        flexShrink: 0,
      }}
    />
  )
}

// ─────────────────────────────────────────────────────────────────────────────

export default function RankBadge({ elo, showElo = true, size = 'md' }: RankBadgeProps) {
  const rank = getRankFromElo(elo)

  const iconSize = size === 'sm' ? 14 : 17
  const fontSize = size === 'sm' ? '11px' : '12px'
  const paddingX = size === 'sm' ? '6px' : '8px'
  const paddingY = size === 'sm' ? '2px' : '3px'
  const gap = size === 'sm' ? '4px' : '5px'

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap,
        background: rank.bg,
        borderRadius: '6px',
        padding: `${paddingY} ${paddingX}`,
        fontSize,
        fontWeight: 700,
        color: rank.color,
        lineHeight: 1,
        border: `1px solid ${rank.color}40`,
        letterSpacing: '0.02em',
        whiteSpace: 'nowrap',
      }}
    >
      <RankIcon name={rank.name} color={rank.color} iconSize={iconSize} />
      {rank.name}{showElo ? ` ${elo}` : ''}
    </span>
  )
}
