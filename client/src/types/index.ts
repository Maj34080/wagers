export type Mode = '1v1' | '2v2' | '3v3' | '5v5'

export interface ModeStats {
  wins: number
  losses: number
  elo: number
  currentStreak?: number
  bestStreak?: number
}

export interface User {
  id: string
  pseudo: string
  stats: Record<Mode, ModeStats>
  avatar: string | null
  banner: string | null
  isPremium: boolean
  premiumUntil: number | null
  isAdmin: boolean
  isContent: boolean
  isFondateur: boolean
  fondateurDate: string | null
  referralCode: string | null
  matchHistory: MatchRecord[]
  clanId: string | null
  friends: string[]
  muted: boolean
  muteUntil: number | null
  coins?: number
  xp?: number
  battlePassLevel?: number
  battlePassPremium?: boolean
  claimedBPRewards?: string[]
  eloBoosts?: { type: string; remainingWins: number; multiplier: number }[]
  eloShields?: number
  streakProtects?: number
  avatarFrame?: string | null
  unlockedFrames?: string[]
  ownedItems?: string[]
  hidePremiumBadge?: boolean
}

export interface MatchRecord {
  date: string
  mode: Mode
  result: 'win' | 'loss' | 'draw'
  eloChange: number
  eloBefore: number
  eloAfter: number
  opponents: string[]
  teammates: string[]
}

export interface LeaderboardEntry {
  id: string
  pseudo: string
  elo: number
  wins: number
  losses: number
  avatar: string | null
  isPremium: boolean
  isContent: boolean
  avatarFrame?: string | null
}

export interface Room {
  roomId: string
  mode: Mode
  team1: PlayerInfo[]
  team2: PlayerInfo[]
  captains: [string | null, string | null]
  waiting?: boolean
}

export interface PlayerInfo {
  pseudo: string
  elo: number
  avatar: string | null
  stats: Record<Mode, ModeStats> | null
  isPremium?: boolean
  isContent?: boolean
  avatarFrame?: string | null
}

export interface Clan {
  id: string
  name: string
  tag: string
  description: string
  leaderId: string
  members: string[]
  weeklyPoints: number
  bo3Wins: number
  bo3Losses: number
}

export interface ChatMessage {
  pseudo?: string
  author?: string
  text: string
  time: number
  avatar?: string | null
  isPremium?: boolean
  role?: 'admin' | 'content' | null
  team?: string
  img?: string
}
