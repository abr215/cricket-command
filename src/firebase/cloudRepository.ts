import type { MatchState } from '../game/matchEngine'
import type { Tournament } from '../game/tournamentEngine'

export type CloudProfile = {
  id: string
  displayName: string
  createdAt: string
}

export type CloudGameData = {
  profile: CloudProfile
  tournament: Tournament | null
  activeMatch: MatchState | null
}

export type CloudRepository = {
  saveGame: (data: CloudGameData) => Promise<void>
  loadGame: (userId: string) => Promise<CloudGameData | null>
}

export const firebaseCollections = {
  profiles: 'profiles',
  games: 'games',
  matches: 'matches',
  tournaments: 'tournaments',
} as const
