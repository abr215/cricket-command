import { initializeApp, getApps, getApp } from 'firebase/app'
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  linkWithCredential,
  type User,
} from 'firebase/auth'
import {
  getDatabase,
  ref,
  set,
  update,
  onValue,
  onDisconnect,
  push,
  remove,
  serverTimestamp,
  runTransaction,
  get,
} from 'firebase/database'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const app = getApps().length ? getApp() : initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const database = getDatabase(app)

export type TeamData = {
  name: string
  shortName: string
  logo: string
  primary: string
  secondary?: string
  pattern?: string
}

export type OnlinePlayer = {
  uid: string
  playerId: string
  name: string
  teamName: string
  teamShortName: string
  logo: string
  primary: string
  secondary?: string
  online: boolean
  lastSeen: number
}

export type FriendInvite = {
  id: string
  fromUid: string
  fromPlayerId: string
  fromName: string
  fromTeamName: string
  fromTeamShortName: string
  tournamentId: string
  tournamentName: string
  createdAt: number
  status: 'pending' | 'accepted' | 'declined'
}

export type TournamentSummary = {
  id: string
  name: string
  teamCount: number
  format: string
  overs: number
  auctionEnabled: boolean
  purse: number
  status: string
  ownerUid: string
  createdAt: number
}

export type TournamentMember = {
  uid: string
  playerId: string
  role: 'owner' | 'player' | 'bot'
  team: TeamData
  joinedAt: number
  ready?: boolean
  online?: boolean
}

export type AuctionPlayer = {
  id: string
  name: string
  role: 'BAT' | 'AR' | 'BOWL' | 'WK'
  rating: number
  base: number
}

export type AuctionState = {
  status: 'readying' | 'running' | 'sold' | 'complete' | 'cancelled' | 'aborted'
  playerIndex: number
  currentBid: number
  highestBidderUid: string | null
  highestBidderName: string
  phase: 'thinking' | 'bidding' | 'going-once' | 'going-twice' | 'sold'
  thinkingText: string
  soldTeamUid: string | null
  soldTeamName: string | null
  soldPrice: number | null
  ready: Record<string, boolean>
  updatedAt: number
  lastActionAt?: number
  players: AuctionPlayer[]
  sales?: Record<string, { player: string; team: string; price: number; winnerUid: string | null }>
  reason?: string
}

export const PLAYERS: AuctionPlayer[] = [
  { id: 'p1', name: 'Arjun Mehta', role: 'BAT', rating: 88, base: 2 },
  { id: 'p2', name: 'Rohan Das', role: 'BAT', rating: 84, base: 1.5 },
  { id: 'p3', name: 'Vikram Shah', role: 'AR', rating: 86, base: 2 },
  { id: 'p4', name: 'Aditya Rao', role: 'BOWL', rating: 82, base: 1 },
  { id: 'p5', name: 'Karan Iyer', role: 'WK', rating: 80, base: 1 },
  { id: 'p6', name: 'Sameer Khan', role: 'BOWL', rating: 85, base: 1.5 },
  { id: 'p7', name: 'Nikhil Verma', role: 'BAT', rating: 79, base: 0.75 },
  { id: 'p8', name: 'Dev Patel', role: 'AR', rating: 83, base: 1 },
  { id: 'p9', name: 'Ritesh Singh', role: 'BOWL', rating: 77, base: 0.75 },
  { id: 'p10', name: 'Aman Kapoor', role: 'BAT', rating: 75, base: 0.5 },
]

export function getAuctionPlayers() { return PLAYERS }
export function createPlayerId(uid: string) { return `CC-${uid.slice(0, 6).toUpperCase()}` }

export async function loginOnline(): Promise<User> {
  await setPersistence(auth, browserLocalPersistence)
  if (auth.currentUser) return auth.currentUser
  return (await signInAnonymously(auth)).user
}

export function watchAuth(callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, callback)
}

export async function registerEmailAccount(email: string, password: string, team?: TeamData | null) {
  await setPersistence(auth, browserLocalPersistence)
  const credential = EmailAuthProvider.credential(email, password)
  let user: User

  if (auth.currentUser?.isAnonymous) {
    const linked = await linkWithCredential(auth.currentUser, credential)
    user = linked.user
  } else {
    user = (await createUserWithEmailAndPassword(auth, email, password)).user
  }

  if (team) {
    await savePlayerProfile(team)
  } else {
    const existing = await loadPlayerProfile(user.uid)
    if (!existing) {
      await set(ref(database, `profiles/${user.uid}`), {
        uid: user.uid,
        playerId: createPlayerId(user.uid),
        managerName: 'Manager',
        team: null,
        email: user.email || email,
        updatedAt: serverTimestamp(),
      })
    }
  }

  return user
}

export async function loginEmailAccount(email: string, password: string) {
  await setPersistence(auth, browserLocalPersistence)
  const result = await signInWithEmailAndPassword(auth, email, password)
  return result.user
}

export async function migrateGuestAccount(previousUid: string, team?: TeamData | null) {
  const currentUser = auth.currentUser
  if (!currentUser || !previousUid || previousUid === currentUser.uid) return
  const oldProfile = await loadPlayerProfile(previousUid)
  const currentProfile = await loadPlayerProfile(currentUser.uid)
  const mergedTeam = team || oldProfile?.team || null
  await set(ref(database, `profiles/${currentUser.uid}`), {
    ...(currentProfile || {}),
    uid: currentUser.uid,
    playerId: createPlayerId(currentUser.uid),
    managerName: oldProfile?.managerName || mergedTeam?.name || 'Manager',
    team: mergedTeam,
    email: currentUser.email || null,
    updatedAt: serverTimestamp(),
  })
  const tournaments = await readOnce(`tournaments`) || {}
  for (const tournament of Object.values(tournaments) as any[]) {
    if (!tournament?.members?.[previousUid]) continue
    const oldMember = tournament.members[previousUid]
    await set(ref(database, `tournaments/${tournament.id}/members/${currentUser.uid}`), {
      ...oldMember, uid: currentUser.uid, playerId: createPlayerId(currentUser.uid), team: mergedTeam || oldMember.team,
    })
    await remove(ref(database, `tournaments/${tournament.id}/members/${previousUid}`))
    if (tournament.ownerUid === previousUid) {
      await update(ref(database, `tournaments/${tournament.id}`), { ownerUid: currentUser.uid, updatedAt: serverTimestamp() })
    }
    await set(ref(database, `profiles/${currentUser.uid}/tournaments/${tournament.id}`), {
      id: tournament.id, name: tournament.name, role: tournament.ownerUid === previousUid ? 'owner' : 'player', createdAt: tournament.createdAt || Date.now(),
    })
  }
  await remove(ref(database, `profiles/${previousUid}`))
  await remove(ref(database, `players/${previousUid}`))
}

export function isEmailUser() {
  return Boolean(auth.currentUser?.email && !auth.currentUser?.isAnonymous)
}

export async function signOutOnline() {
  const { signOut } = await import('firebase/auth')
  await signOut(auth)
}

export async function savePlayerProfile(data: TeamData & { managerName?: string }) {
  const user = await loginOnline()
  const profile = {
    uid: user.uid,
    playerId: createPlayerId(user.uid),
    managerName: data.managerName || data.name,
    team: data,
    email: user.email || null,
    updatedAt: serverTimestamp(),
  }
  await set(ref(database, `profiles/${user.uid}`), profile)
  return user.uid
}

export async function loadPlayerProfile(uid?: string) {
  const id = uid || (await loginOnline()).uid
  const snapshot = await get(ref(database, `profiles/${id}`))
  return snapshot.exists() ? snapshot.val() : null
}

export async function publishPlayerPresence(data: TeamData & { name: string; teamName: string; teamShortName: string }) {
  const user = await loginOnline()
  const playerId = createPlayerId(user.uid)
  const playerRef = ref(database, `players/${user.uid}`)
  const playerData: OnlinePlayer = {
    uid: user.uid,
    playerId,
    name: data.name || 'New Manager',
    teamName: data.teamName || data.name || '',
    teamShortName: data.teamShortName || data.shortName || '',
    logo: data.logo || '⚡',
    primary: data.primary || '#E7B93C',
    secondary: data.secondary,
    online: true,
    lastSeen: Date.now(),
  }
  await set(playerRef, playerData)
  await onDisconnect(playerRef).update({ online: false, lastSeen: serverTimestamp() })
  return playerData
}

export function updatePlayerPresence(data: Partial<TeamData> & { name?: string; teamName?: string; teamShortName?: string }) {
  const user = auth.currentUser
  if (!user) return Promise.resolve()
  return update(ref(database, `players/${user.uid}`), { ...data, online: true, lastSeen: Date.now() })
}

export function setPlayerOffline() {
  const user = auth.currentUser
  if (!user) return Promise.resolve()
  return update(ref(database, `players/${user.uid}`), { online: false, lastSeen: Date.now() })
}

export function watchOnlinePlayers(callback: (players: OnlinePlayer[]) => void) {
  return onValue(ref(database, 'players'), snapshot => {
    const value = snapshot.val() || {}
    const players = Object.values(value) as OnlinePlayer[]
    players.sort((a, b) => a.online === b.online ? (b.lastSeen || 0) - (a.lastSeen || 0) : a.online ? -1 : 1)
    callback(players)
  })
}

export async function sendFriendInvite(data: {
  receiverUid: string
  tournamentId: string
  tournamentName: string
  fromName: string
  fromTeamName: string
  fromTeamShortName: string
}) {
  const user = await loginOnline()
  const inviteRef = push(ref(database, `invites/${data.receiverUid}`))
  const invite: FriendInvite = {
    id: inviteRef.key || '',
    fromUid: user.uid,
    fromPlayerId: createPlayerId(user.uid),
    fromName: data.fromName,
    fromTeamName: data.fromTeamName,
    fromTeamShortName: data.fromTeamShortName,
    tournamentId: data.tournamentId,
    tournamentName: data.tournamentName,
    createdAt: Date.now(),
    status: 'pending',
  }
  await set(inviteRef, invite)
  return invite
}

export function watchMyInvites(callback: (invites: FriendInvite[]) => void) {
  const user = auth.currentUser
  if (!user) { callback([]); return () => {} }
  return onValue(ref(database, `invites/${user.uid}`), snapshot => {
    const value = snapshot.val() || {}
    const invites = Object.values(value) as FriendInvite[]
    invites.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    callback(invites)
  })
}

export async function acceptFriendInvite(invite: FriendInvite, team: TeamData) {
  const user = auth.currentUser || await loginOnline()
  const tournament = await readOnce(`tournaments/${invite.tournamentId}`)
  if (!tournament) throw new Error('Tournament no longer exists.')
  if (tournament.members?.[user.uid]) return true
  await set(ref(database, `tournaments/${invite.tournamentId}/members/${user.uid}`), {
    uid: user.uid,
    playerId: createPlayerId(user.uid),
    role: 'player',
    team,
    joinedAt: serverTimestamp(),
    ready: false,
  })
  await update(ref(database, `invites/${user.uid}/${invite.id}`), { status: 'accepted' })
  await set(ref(database, `profiles/${user.uid}/tournaments/${invite.tournamentId}`), {
    id: invite.tournamentId, name: invite.tournamentName, role: 'player', createdAt: serverTimestamp(),
  })
  await update(ref(database, `tournaments/${invite.tournamentId}`), { updatedAt: serverTimestamp() })
  return true
}

export function declineFriendInvite(invite: FriendInvite) {
  const user = auth.currentUser
  if (!user) return Promise.resolve()
  return update(ref(database, `invites/${user.uid}/${invite.id}`), { status: 'declined' })
}

export async function createOnlineTournament(data: {
  name: string; teamCount: number; format: string; overs: number; auctionEnabled: boolean; purse: number; team: TeamData
}) {
  const user = await loginOnline()
  const tournamentRef = push(ref(database, 'tournaments'))
  if (!tournamentRef.key) throw new Error('Could not create tournament.')
  const id = tournamentRef.key
  const now = serverTimestamp()
  await set(tournamentRef, {
    id, name: data.name, teamCount: data.teamCount, format: data.format, overs: data.overs,
    auctionEnabled: data.auctionEnabled, purse: data.purse, status: 'lobby', ownerUid: user.uid,
    createdAt: now, updatedAt: now,
  })
  await set(ref(database, `tournaments/${id}/members/${user.uid}`), {
    uid: user.uid, playerId: createPlayerId(user.uid), role: 'owner', team: data.team, joinedAt: now, ready: false,
  })
  await set(ref(database, `profiles/${user.uid}/tournaments/${id}`), {
    id, name: data.name, role: 'owner', createdAt: now,
  })
  return id
}

export function watchTournament(tournamentId: string, callback: (tournament: any) => void) {
  return onValue(ref(database, `tournaments/${tournamentId}`), snapshot => callback(snapshot.val()))
}

export function watchTournamentMembers(tournamentId: string, callback: (members: TournamentMember[]) => void) {
  return onValue(ref(database, `tournaments/${tournamentId}/members`), snapshot => {
    callback(Object.values(snapshot.val() || {}) as TournamentMember[])
  })
}

export function watchMyTournaments(callback: (tournaments: TournamentSummary[]) => void) {
  const user = auth.currentUser
  if (!user) { callback([]); return () => {} }
  return onValue(ref(database, 'tournaments'), snapshot => {
    const all = Object.values(snapshot.val() || {}) as any[]
    const mine = all.filter(t => t?.members?.[user.uid]).map(t => ({
      id: t.id, name: t.name, teamCount: Number(t.teamCount || 0), format: t.format || '', overs: Number(t.overs || 0),
      auctionEnabled: !!t.auctionEnabled, purse: Number(t.purse || 0), status: t.status || 'lobby', ownerUid: t.ownerUid || '',
      createdAt: typeof t.createdAt === 'number' ? t.createdAt : 0,
    })).sort((a, b) => b.createdAt - a.createdAt)
    callback(mine)
  })
}

export async function addBotTeam(tournamentId: string, team: TeamData) {
  const id = `bot-${team.shortName.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}`
  const bot = { uid: id, playerId: id.toUpperCase(), role: 'bot', team, joinedAt: serverTimestamp(), ready: true, online: true }
  await set(ref(database, `tournaments/${tournamentId}/bots/${id}`), bot)
  await set(ref(database, `tournaments/${tournamentId}/members/${id}`), bot)
  await update(ref(database, `tournaments/${tournamentId}`), { updatedAt: serverTimestamp() })
}

export async function addBotTeamsToTournament(tournamentId: string, teams: TeamData[]) {
  const tournament = await readOnce(`tournaments/${tournamentId}`)
  const existing = Object.values(tournament?.members || {}) as any[]
  const names = new Set(existing.map(m => m?.team?.name))
  for (const team of teams) if (!names.has(team.name)) await addBotTeam(tournamentId, team)
}

export async function requestAuctionReady(tournamentId: string) {
  const user = await loginOnline()
  const tournament = await readOnce(`tournaments/${tournamentId}`)
  if (!tournament) throw new Error('Tournament not found.')
  if (tournament.ownerUid !== user.uid) throw new Error('Only the tournament creator can start the auction.')
  const members = tournament.members || {}
  const ready: Record<string, boolean> = {}
  Object.values(members).forEach((member: any) => { ready[member.uid] = member.role === 'bot' || member.uid === user.uid })
  await update(ref(database, `tournaments/${tournamentId}`), { status: 'readying', updatedAt: serverTimestamp() })
  await set(ref(database, `tournaments/${tournamentId}/auction`), {
    status: 'readying', playerIndex: 0, currentBid: PLAYERS[0].base, highestBidderUid: null, highestBidderName: 'Base price',
    phase: 'thinking', thinkingText: 'Waiting for every manager to press READY…', soldTeamUid: null, soldTeamName: null, soldPrice: null,
    ready, lastActionAt: Date.now(), updatedAt: serverTimestamp(), players: PLAYERS, sales: {},
  })
}

export async function setAuctionReady(tournamentId: string, ready: boolean) {
  const user = auth.currentUser || await loginOnline()
  const tournament = await readOnce(`tournaments/${tournamentId}`)
  if (!tournament?.auction) throw new Error('Auction ready check is not active.')
  await update(ref(database, `tournaments/${tournamentId}/auction/ready`), { [user.uid]: ready })
  await update(ref(database, `tournaments/${tournamentId}/members/${user.uid}`), { ready })
  await evaluateAuctionReadiness(tournamentId)
}

export async function evaluateAuctionReadiness(tournamentId: string) {
  const tournament = await readOnce(`tournaments/${tournamentId}`)
  if (!tournament || tournament.status !== 'readying') return false
  const members = Object.values(tournament.members || {}) as any[]
  const humans = members.filter(m => m.role !== 'bot')
  const players = await readOnce('players') || {}
  const allOnline = humans.length > 0 && humans.every(m => players[m.uid]?.online === true)
  if (!allOnline) {
    const offline = humans.find(m => players[m.uid]?.online !== true)
    await update(ref(database, `tournaments/${tournamentId}`), { status: 'cancelled', cancelReason: `${offline?.team?.name || 'A manager'} went offline.`, updatedAt: serverTimestamp() })
    await update(ref(database, `tournaments/${tournamentId}/auction`), { status: 'aborted', reason: 'A manager went offline. Auction stopped.', updatedAt: serverTimestamp(), lastActionAt: Date.now() })
    return false
  }
  const ready = tournament.auction?.ready || {}
  const allReady = humans.every(m => ready[m.uid] === true)
  if (allReady) {
    await update(ref(database, `tournaments/${tournamentId}`), { status: 'auction', updatedAt: serverTimestamp() })
    await update(ref(database, `tournaments/${tournamentId}/auction`), { status: 'running', phase: 'thinking', thinkingText: 'All managers are ready. Auction is live.', updatedAt: serverTimestamp(), lastActionAt: Date.now() })
    return true
  }
  return false
}

export function watchAuction(tournamentId: string, callback: (auction: AuctionState | null) => void) {
  return onValue(ref(database, `tournaments/${tournamentId}/auction`), snapshot => callback(snapshot.val()))
}

export async function placeAuctionBid(tournamentId: string, bid: number, bidderName: string) {
  const user = auth.currentUser || await loginOnline()
  const tournament = await readOnce(`tournaments/${tournamentId}`)
  if (!tournament || tournament.status !== 'auction' || tournament.auction?.status !== 'running') throw new Error('Auction is not live.')
  const member = tournament.members?.[user.uid]
  if (!member || member.role === 'bot') throw new Error('You are not a tournament manager.')
  const purse = Number(tournament.purses?.[user.uid] ?? tournament.purse ?? 0)
  if (bid > purse) throw new Error('Insufficient purse.')
  await runTransaction(ref(database, `tournaments/${tournamentId}/auction`), current => {
    if (!current || current.status !== 'running') return current
    if (Number(bid) <= Number(current.currentBid || 0)) return current
    return { ...current, currentBid: Number(bid), highestBidderUid: user.uid, highestBidderName: bidderName, phase: 'thinking', thinkingText: `${bidderName} raised to ₹${Number(bid).toFixed(2)} Cr.`, lastActionAt: Date.now(), updatedAt: Date.now() }
  })
}

export async function setAuctionStage(tournamentId: string, stage: string) {
  const user = auth.currentUser
  const tournament = await readOnce(`tournaments/${tournamentId}`)
  if (!user || tournament?.ownerUid !== user.uid) throw new Error('Only the host can control the auction stage.')
  await update(ref(database, `tournaments/${tournamentId}/auction`), { phase: stage, status: stage, lastActionAt: Date.now(), updatedAt: serverTimestamp() })
}

export async function sellAuctionPlayer(tournamentId: string, playerIndex: number, playerName: string, winnerName: string, price: number, winnerUid: string | null) {
  const tournament = await readOnce(`tournaments/${tournamentId}`)
  const auction = tournament?.auction
  if (!auction) return
  const sale = { player: playerName, team: winnerName, price, winnerUid, createdAt: Date.now() }
  await set(ref(database, `tournaments/${tournamentId}/auction/sales/sale-${playerIndex}`), sale)
  await update(ref(database, `tournaments/${tournamentId}/auction`), { status: 'sold', phase: 'sold', soldTeamUid: winnerUid, soldTeamName: winnerName, soldPrice: price, updatedAt: serverTimestamp(), lastActionAt: Date.now() })
}

export async function advanceAuctionPlayer(tournamentId: string, nextIndex: number, basePrice: number) {
  const tournament = await readOnce(`tournaments/${tournamentId}`)
  if (!tournament) return
  const players = tournament.auction?.players || PLAYERS
  if (nextIndex >= players.length) {
    await update(ref(database, `tournaments/${tournamentId}`), { status: 'completed', updatedAt: serverTimestamp() })
    await update(ref(database, `tournaments/${tournamentId}/auction`), { status: 'complete', updatedAt: serverTimestamp() })
    return
  }
  await update(ref(database, `tournaments/${tournamentId}/auction`), {
    playerIndex: nextIndex, currentBid: basePrice, highestBidderUid: null, highestBidderName: 'Base price', phase: 'thinking', status: 'running',
    thinkingText: 'New player on the block. Managers are assessing…', soldTeamUid: null, soldTeamName: null, soldPrice: null, updatedAt: serverTimestamp(), lastActionAt: Date.now(),
  })
}

export async function cancelAuction(tournamentId: string, reason = 'A manager went offline.') {
  await update(ref(database, `tournaments/${tournamentId}`), { status: 'cancelled', cancelReason: reason, updatedAt: serverTimestamp() })
  await update(ref(database, `tournaments/${tournamentId}/auction`), { status: 'cancelled', reason, updatedAt: serverTimestamp() })
}

export async function leaveTournament(tournamentId: string) {
  const user = auth.currentUser
  if (!user) return
  const tournament = await readOnce(`tournaments/${tournamentId}`)
  if (!tournament) return
  if (tournament.ownerUid === user.uid) {
    await update(ref(database, `tournaments/${tournamentId}`), { status: 'cancelled', updatedAt: serverTimestamp() })
  } else {
    await remove(ref(database, `tournaments/${tournamentId}/members/${user.uid}`))
    await remove(ref(database, `profiles/${user.uid}/tournaments/${tournamentId}`))
  }
}

export async function readOnce(path: string) {
  const snapshot = await get(ref(database, path))
  return snapshot.exists() ? snapshot.val() : null
}

export function getCurrentUserUid() { return auth.currentUser?.uid || null }
export function stopListening(unsubscribe?: (() => void) | null) { unsubscribe?.() }

export type { User } from 'firebase/auth'
export type { TournamentSummary as OnlineTournamentSummary }