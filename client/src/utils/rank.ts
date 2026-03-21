export function getRankFromElo(elo: number): { name: string; color: string; bg: string } {
  if (elo >= 1101) return { name: 'Radiant',   color: '#ff4655', bg: 'rgba(255,70,85,0.15)' }
  if (elo >= 901)  return { name: 'Diamond',   color: '#8b5cf6', bg: 'rgba(139,92,246,0.15)' }
  if (elo >= 751)  return { name: 'Platinum',  color: '#06b6d4', bg: 'rgba(6,182,212,0.15)' }
  if (elo >= 551)  return { name: 'Gold',      color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' }
  return               { name: 'Silver',    color: '#9ca3af', bg: 'rgba(156,163,175,0.15)' }
}

export function getRankProgress(elo: number): number {
  const thresholds = [0, 551, 751, 901, 1101]
  for (let i = thresholds.length - 1; i >= 0; i--) {
    if (elo >= thresholds[i]) {
      const next = thresholds[i + 1] ?? 2200
      return Math.min(100, Math.round(((elo - thresholds[i]) / (next - thresholds[i])) * 100))
    }
  }
  return 0
}

export function formatEloChange(change: number): string {
  return change >= 0 ? `+${change}` : `${change}`
}

export function getWinRate(wins: number, losses: number): number {
  const total = wins + losses
  if (total === 0) return 0
  return Math.round((wins / total) * 100)
}
