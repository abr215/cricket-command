import { useEffect, useState } from 'react'
import { bowlDelivery, createMatch, formatOvers, startChase, type Intent, type MatchState } from './game/matchEngine'
import {
  acceptFriendInvite,
  declineFriendInvite,
  loginOnline,
  publishPlayerPresence,
  sendFriendInvite,
  watchMyInvites,
  watchOnlinePlayers,
  createOnlineTournament,
  watchTournamentMembers,
  watchTournament,
  watchMyTournaments,
  loadPlayerProfile,
  savePlayerProfile,
  getCurrentUserUid,
  requestAuctionReady,
  setAuctionReady,
  evaluateAuctionReadiness,
  placeAuctionBid,
  setAuctionStage,
  sellAuctionPlayer,
  advanceAuctionPlayer,
  addBotTeamsToTournament,
  watchAuth,
  beginPhoneLogin,
  confirmPhoneLogin,
  migrateGuestAccount,
  signOutOnline,
  type FriendInvite,
  type OnlinePlayer,
  type OnlineTournamentSummary,
  type User,
} from './firebase/online'
type View = 'home' | 'matches' | 'tournaments' | 'squad' | 'live-match' | 'create-team' | 'tournament-setup' | 'auction'

type Team = {
  name: string
  shortName: string
  primary: string
  secondary: string
  logo: string
}

const navItems: { id: View; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: '⌂' },
  { id: 'matches', label: 'Matches', icon: '◉' },
  { id: 'tournaments', label: 'Tournaments', icon: '♜' },
  { id: 'squad', label: 'Squad', icon: '♙' },
]

const logos = ['⚡', '★', '♛', '◆', '✦', '◈', '●', '▲']

type TournamentSettings = {
  name: string
  teamCount: number
  format: string
  overs: number
  auctionEnabled: boolean
  purse: number
}

const colours = [
  '#E7B93C',
  '#E56B35',
  '#3B82F6',
  '#22A06B',
  '#8B5CF6',
  '#EF4444',
  '#14B8A6',
  '#F97316',
]

function App() {
  const [view, setView] = useState<View>('home')
  const [matchMode, setMatchMode] = useState<'friend' | 'bot'>('friend')
  const [match, setMatch] = useState<MatchState | null>(null)
  const [onlinePlayers, setOnlinePlayers] = useState<OnlinePlayer[]>([])
  const [invites, setInvites] = useState<FriendInvite[]>([])
  const [showNotifications, setShowNotifications] = useState(false)
  const [activeTournamentId, setActiveTournamentId] = useState<string | null>(() => localStorage.getItem('cc_active_tournament_id'))
  const [onlineTournament, setOnlineTournament] = useState<any | null>(null)
  const [myTournaments, setMyTournaments] = useState<OnlineTournamentSummary[]>([])
  const [profileLoading, setProfileLoading] = useState(true)
  const [authUser, setAuthUser] = useState<User | null>(null)
  const [showAuthGate, setShowAuthGate] = useState<boolean>(() => !localStorage.getItem('cc_auth_choice'))

  const [team, setTeam] = useState<Team>({
    name: '',
    shortName: '',
    primary: '#E7B93C',
    secondary: '#14283B',
    logo: '⚡',
  })

  const [myTeam, setMyTeam] = useState<Team | null>(() => {
    try {
      const saved = localStorage.getItem('cc_my_team')
      return saved ? (JSON.parse(saved) as Team) : null
    } catch {
      return null
    }
  })

  const [tournament, setTournament] = useState<TournamentSettings>(() => {
    try {
      const saved = localStorage.getItem('cc_tournament_settings')
      return saved
        ? JSON.parse(saved)
        : {
            name: '',
            teamCount: 8,
            format: 'League + Playoffs',
            overs: 20,
            auctionEnabled: true,
            purse: 100,
          }
    } catch {
      return {
        name: '',
        teamCount: 8,
        format: 'League + Playoffs',
        overs: 20,
        auctionEnabled: true,
        purse: 100,
      }
    }
  })

  const [auctionPurse, setAuctionPurse] = useState(tournament.purse)

  useEffect(() => {
    if (myTeam) {
      localStorage.setItem('cc_my_team', JSON.stringify(myTeam))
      setTeam(myTeam)
    }
  }, [myTeam])

  useEffect(() => {
    localStorage.setItem('cc_tournament_settings', JSON.stringify(tournament))
  }, [tournament])

  useEffect(() => {
    if (activeTournamentId) {
      localStorage.setItem('cc_active_tournament_id', activeTournamentId)
    } else {
      localStorage.removeItem('cc_active_tournament_id')
    }
  }, [activeTournamentId])

  // Starts an anonymous session immediately (so the app is usable before the
  // manager decides), and keeps authUser in sync whenever the signed-in
  // identity changes -- including the switch from anonymous to phone auth.
  useEffect(() => {
    const unsubscribeAuth = watchAuth(user => setAuthUser(user))
    loginOnline().catch(error => console.error('Initial sign-in failed:', error))
    return unsubscribeAuth
  }, [])

  // Re-syncs the manager profile and all live subscriptions whenever the
  // authenticated uid changes. This is what makes phone login actually
  // restore (or hand over) the club, instead of only running once at boot.
  useEffect(() => {
    if (!authUser) return
    let unsubscribePlayers: (() => void) | undefined
    let unsubscribeInvites: (() => void) | undefined
    let unsubscribeTournaments: (() => void) | undefined
    let cancelled = false

    const syncProfile = async () => {
      try {
        localStorage.setItem('cc_uid', authUser.uid)

        // Firebase is the permanent source of truth for the manager profile.
        // localStorage is only a fast cache, so refreshing the browser -- or
        // the dev server picking a different port -- never forces the
        // manager to create the club again, and signing in with a phone
        // number on a new device restores the same club.
        const profile = await loadPlayerProfile(authUser.uid)
        if (!cancelled && !myTeam && profile?.team?.name) {
          const restoredTeam: Team = {
            name: profile.team.name,
            shortName: profile.team.shortName || '',
            primary: profile.team.primary || '#E7B93C',
            secondary: profile.team.secondary || '#14283B',
            logo: profile.team.logo || '⚡',
          }
          setMyTeam(restoredTeam)
          setTeam(restoredTeam)
          localStorage.setItem('cc_my_team', JSON.stringify(restoredTeam))
        }

        const currentTeam = myTeam || (profile?.team?.name ? {
          name: profile.team.name,
          shortName: profile.team.shortName || '',
          primary: profile.team.primary || '#E7B93C',
          secondary: profile.team.secondary || '#14283B',
          logo: profile.team.logo || '⚡',
        } : null)

        if (currentTeam) {
          await publishPlayerPresence({
            name: currentTeam.name,
            teamName: currentTeam.name,
            teamShortName: currentTeam.shortName,
            shortName: currentTeam.shortName,
            logo: currentTeam.logo,
            primary: currentTeam.primary,
            secondary: currentTeam.secondary,
          })
        }

        unsubscribePlayers = watchOnlinePlayers(players => {
          if (!cancelled) setOnlinePlayers(players)
        })

        unsubscribeInvites = watchMyInvites(incomingInvites => {
          if (!cancelled) setInvites(incomingInvites)
        })

        unsubscribeTournaments = watchMyTournaments(tournaments => {
          if (!cancelled) setMyTournaments(tournaments)
        })

        if (!cancelled) setProfileLoading(false)
      } catch (error) {
        console.error('Firebase connection failed:', error)
        if (!cancelled) setProfileLoading(false)
      }
    }

    syncProfile()

    return () => {
      cancelled = true
      unsubscribePlayers?.()
      unsubscribeInvites?.()
      unsubscribeTournaments?.()
    }
  }, [authUser?.uid])


  useEffect(() => {
    if (!activeTournamentId) {
      setOnlineTournament(null)
      return
    }

    return watchTournament(activeTournamentId, data => {
      if (!data) {
        setOnlineTournament(null)
        return
      }

      const synced = data as any
      setOnlineTournament(synced)
      setMyTournaments(current => {
        const summary: OnlineTournamentSummary = {
          id: synced.id || activeTournamentId,
          name: synced.name || 'Untitled tournament',
          teamCount: synced.teamCount || 0,
          format: synced.format || '',
          overs: synced.overs || 0,
          auctionEnabled: Boolean(synced.auctionEnabled),
          purse: synced.purse || 0,
          status: synced.status || 'lobby',
          ownerUid: synced.ownerUid || '',
          createdAt: typeof synced.createdAt === 'number' ? synced.createdAt : 0,
        }
        const exists = current.some(item => item.id === summary.id)
        return exists
          ? current.map(item => item.id === summary.id ? summary : item)
          : [...current, summary]
      })
      setTournament(current => ({
        ...current,
        name: synced.name ?? current.name,
        teamCount: synced.teamCount ?? current.teamCount,
        format: synced.format ?? current.format,
        overs: synced.overs ?? current.overs,
        auctionEnabled: synced.auctionEnabled ?? current.auctionEnabled,
        purse: synced.purse ?? current.purse,
      }))
      if (typeof synced.purse === 'number') setAuctionPurse(synced.purse)
    })
  }, [activeTournamentId])

  useEffect(() => {
    if (!activeTournamentId || !onlineTournament?.auction) return
    const auctionStatus = onlineTournament.auction.status
    if (auctionStatus !== 'readying' && auctionStatus !== 'running') return
    evaluateAuctionReadiness(activeTournamentId).catch(error => {
      console.error('Auction readiness check failed:', error)
    })
  }, [activeTournamentId, onlineTournament?.auction?.status, onlineTournament?.auction?.lastActionAt, onlinePlayers])

  useEffect(() => {
    if (myTeam && activeTournamentId) {
      setView('tournaments')
    }
  }, [myTeam, activeTournamentId])

  if (showAuthGate) {
    return (
      <AuthGate
        guestTeam={myTeam}
        onDone={mode => {
          localStorage.setItem('cc_auth_choice', mode)
          setShowAuthGate(false)
        }}
      />
    )
  }

  if (profileLoading) {
    return (
      <main className="app-shell">
        <section className="content">
          <section className="setup-card" style={{ marginTop: '40vh', textAlign: 'center' }}>
            <p className="eyebrow">CRICKET COMMAND</p>
            <h2>Restoring manager profile…</h2>
            <p>Your team and tournaments are being loaded.</p>
          </section>
        </section>
      </main>
    )
  }

  const startMatch = (opponent: string) => {
    setMatch(createMatch(opponent, 5, myTeam?.name || 'Abraham CC'))
    setView('live-match')
  }

  const createMyTeam = async () => {
    if (!team.name.trim() || !team.shortName.trim()) return

    const savedTeam = { ...team, name: team.name.trim(), shortName: team.shortName.trim().toUpperCase() }
    setMyTeam(savedTeam)
    setTeam(savedTeam)
    localStorage.setItem('cc_my_team', JSON.stringify(savedTeam))

    try {
      await savePlayerProfile(savedTeam)
      await publishPlayerPresence({
        name: savedTeam.name,
        teamName: savedTeam.name,
        teamShortName: savedTeam.shortName,
        shortName: savedTeam.shortName,
        logo: savedTeam.logo,
        primary: savedTeam.primary,
        secondary: savedTeam.secondary,
      })
    } catch (error) {
      console.error('Could not publish player presence:', error)
    }

    setView('tournaments')
  }

  return (
    <main className="app-shell">

      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">CC</span>
          <span>CRICKET COMMAND</span>
        </div>

        <div className="profile">
          <span className="online-dot" />
          <span>{myTeam?.name || 'New Manager'}</span>
          <small style={{ opacity: 0.6, marginRight: '4px' }}>
            {authUser?.phoneNumber ? 'Verified' : 'Guest'}
          </small>
          <button
            type="button"
            aria-label="Notifications"
            onClick={() => setShowNotifications(true)}
          >
            ♢
            {invites.filter(invite => invite.status === 'pending').length > 0 && (
              <b className="notification-count">
                {invites.filter(invite => invite.status === 'pending').length}
              </b>
            )}
          </button>
          <button
            type="button"
            aria-label="Sign out"
            onClick={async () => {
              if (!confirm('Sign out? This clears your saved club on this device.')) return
              try {
                await signOutOnline()
              } catch (error) {
                console.error('Sign out failed:', error)
              }
              localStorage.removeItem('cc_auth_choice')
              localStorage.removeItem('cc_my_team')
              localStorage.removeItem('cc_active_tournament_id')
              window.location.reload()
            }}
          >
            ⎋
          </button>
        </div>
      </header>

      <section className="content">

        {view === 'home' && (
          <Home
            setView={setView}
            myTeam={myTeam}
            matchMode={matchMode}
            onlinePlayers={onlinePlayers}
          />
        )}

        {view === 'create-team' && (
          <CreateTeam
            team={team}
            setTeam={setTeam}
            onCreate={createMyTeam}
            onBack={() => setView('home')}
          />
        )}

        {view === 'matches' && (
          <Matches
            matchMode={matchMode}
            setMatchMode={setMatchMode}
            startMatch={startMatch}
            myTeam={myTeam}
          />
        )}

        {view === 'tournaments' && (
          <TournamentLobby
            myTeam={myTeam}
            setView={setView}
            onlinePlayers={onlinePlayers}
            activeTournamentId={activeTournamentId}
            tournamentName={onlineTournament?.name || tournament.name}
            tournamentData={onlineTournament}
            myTournaments={myTournaments}
            currentUid={getCurrentUserUid()}
            onSelectTournament={setActiveTournamentId}
          />
        )}

        {view === 'tournament-setup' && (
          <TournamentSetup
            tournament={tournament}
            setTournament={setTournament}
            myTeam={myTeam}
            onBack={() => setView('tournaments')}
            onCreate={async () => {
              if (!myTeam) return

              try {
                const tournamentId = await createOnlineTournament({
                  name: tournament.name.trim(),
                  teamCount: tournament.teamCount,
                  format: tournament.format,
                  overs: tournament.overs,
                  auctionEnabled: tournament.auctionEnabled,
                  purse: tournament.purse,
                  team: {
                    name: myTeam.name,
                    shortName: myTeam.shortName,
                    logo: myTeam.logo,
                    primary: myTeam.primary,
                  },
                })

                setActiveTournamentId(tournamentId)
                setAuctionPurse(tournament.purse)
                setView('tournaments')
              } catch (error) {
                console.error('Could not create online tournament:', error)
              }
            }}
          />
        )}

        {view === 'auction' && (
          <AuctionRoom
            myTeam={myTeam}
            purse={auctionPurse}
            setPurse={setAuctionPurse}
            teamCount={onlineTournament?.teamCount || tournament.teamCount}
            tournamentId={activeTournamentId}
            tournamentData={onlineTournament}
            onExit={() => setView('tournaments')}
          />
        )}

        {view === 'squad' && (
          <Squad myTeam={myTeam} />
        )}

        {view === 'live-match' && match && (
          <LiveMatch
            match={match}
            onBowl={(intent) =>
              setMatch(current =>
                current ? bowlDelivery(current, intent) : current
              )
            }
            onStartChase={() =>
              setMatch(current =>
                current ? startChase(current) : current
              )
            }
            onExit={() => setView('matches')}
          />
        )}

      </section>

      {showNotifications && (
        <div className="modal-overlay" onClick={() => setShowNotifications(false)}>
          <div className="team-modal" onClick={event => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">INBOX</p>
                <h2>Notifications</h2>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setShowNotifications(false)}
              >
                ×
              </button>
            </div>

            {invites.filter(invite => invite.status === 'pending').length === 0 ? (
              <p className="empty-state">No pending invitations.</p>
            ) : (
              invites
                .filter(invite => invite.status === 'pending')
                .map(invite => (
                  <div className="selected-team-row" key={invite.id}>
                    <div>
                      <strong>{invite.fromTeamName || invite.fromName}</strong>
                      <small>{invite.fromName} invited you to {invite.tournamentName}</small>
                    </div>

                    <div className="invite-buttons">
                      <button
                        type="button"
                        className="secondary"
                        onClick={async () => {
                          try {
                            await declineFriendInvite(invite)
                          } catch (error) {
                            console.error('Could not decline invite:', error)
                          }
                        }}
                      >
                        Decline
                      </button>

                      <button
                        type="button"
                        className="primary"
                        onClick={async () => {
                          try {
                            if (!myTeam) {
                              throw new Error('Create your team before accepting a tournament invitation.')
                            }

                            await acceptFriendInvite(invite, {
                              name: myTeam.name,
                              shortName: myTeam.shortName,
                              logo: myTeam.logo,
                              primary: myTeam.primary,
                            })

                            setActiveTournamentId(invite.tournamentId)
                            setTournament(current => ({
                              ...current,
                              name: invite.tournamentName,
                            }))
                            setShowNotifications(false)
                            setView('tournaments')
                          } catch (error) {
                            console.error('Could not accept invite:', error)
                          }
                        }}
                      >
                        Accept
                      </button>
                    </div>
                  </div>
                ))
            )}
          </div>
        </div>
      )}

      {view !== 'create-team' && view !== 'live-match' && (
        <nav className="bottom-nav" aria-label="Main navigation">
          {navItems.map(item => (
            <button
              key={item.id}
              className={view === item.id ? 'active' : ''}
              onClick={() => setView(item.id)}
            >
              <span>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
      )}

    </main>
  )
}


/* ---------------- AUTH GATE (phone login) ---------------- */

function AuthGate({
  guestTeam,
  onDone,
}: {
  guestTeam: Team | null
  onDone: (mode: 'guest' | 'phone') => void
}) {
  const [step, setStep] = useState<'phone' | 'code'>('phone')
  const [digits, setDigits] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const fullPhone = `+91${digits.replace(/\D/g, '')}`

  const sendCode = async () => {
    const clean = digits.replace(/\D/g, '')
    if (clean.length < 10) {
      setError('Enter a valid 10-digit phone number.')
      return
    }
    setLoading(true)
    setError('')
    try {
      await beginPhoneLogin(fullPhone)
      setStep('code')
    } catch (err) {
      console.error('Phone sign-in failed:', err)
      setError('Could not send the code. Check the number and try again.')
    } finally {
      setLoading(false)
    }
  }

  const verifyCode = async () => {
    if (code.trim().length < 6) {
      setError('Enter the 6-digit code.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const previousUid = getCurrentUserUid()
      await confirmPhoneLogin(code.trim())
      if (previousUid) {
        try {
          await migrateGuestAccount(previousUid, guestTeam)
        } catch (migrationError) {
          console.error('Guest data migration failed:', migrationError)
        }
      }
      onDone('phone')
    } catch (err) {
      console.error('Code verification failed:', err)
      setError('Incorrect code. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="app-shell">
      <section className="content">
        <section className="setup-card" style={{ marginTop: '18vh' }}>
          <p className="eyebrow">CRICKET COMMAND</p>
          <h1>{step === 'phone' ? 'Sign in to save your progress' : 'Enter verification code'}</h1>
          <p>
            {step === 'phone'
              ? 'Your club, squads and tournaments will be tied to this number, and follow you to any device.'
              : `We sent a 6-digit code to +91 ${digits}.`}
          </p>

          {step === 'phone' ? (
            <label>
              Phone number
              <div style={{ display: 'flex', gap: '8px' }}>
                <span style={{ padding: '12px 14px', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px' }}>+91</span>
                <input
                  type="tel"
                  placeholder="98765 43210"
                  value={digits}
                  maxLength={10}
                  onChange={e => setDigits(e.target.value.replace(/\D/g, ''))}
                  style={{ flex: 1 }}
                />
              </div>
            </label>
          ) : (
            <label>
              6-digit code
              <input
                type="text"
                inputMode="numeric"
                placeholder="123456"
                value={code}
                maxLength={6}
                onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
              />
            </label>
          )}

          {error && <p className="empty-state">{error}</p>}

          <button
            type="button"
            className="primary full"
            disabled={loading}
            onClick={step === 'phone' ? sendCode : verifyCode}
          >
            {loading ? 'Please wait…' : step === 'phone' ? 'Send code →' : 'Verify & continue →'}
          </button>

          {step === 'code' && (
            <button
              type="button"
              className="secondary"
              onClick={() => { setStep('phone'); setCode(''); setError('') }}
            >
              ← Change number
            </button>
          )}

          <button
            type="button"
            className="text-button"
            onClick={() => onDone('guest')}
          >
            Continue as guest instead
          </button>

          <div id="phone-recaptcha"></div>
        </section>
      </section>
    </main>
  )
}


/* ---------------- HOME ---------------- */

function Home({
  setView,
  myTeam,
  matchMode,
  onlinePlayers,
}: {
  setView: (view: View) => void
  myTeam: Team | null
  matchMode: 'friend' | 'bot'
  onlinePlayers: OnlinePlayer[]
}) {
  return (
    <>
      <section className="hero-panel">

        <p className="eyebrow">MANAGER DASHBOARD</p>

        <h1>
          {myTeam ? `Welcome to ${myTeam.name}.` : <>Lead your club.<br /><em>Own every ball.</em></>}
        </h1>

        <p className="hero-copy">
          Build your squad, challenge friends live, and create competitions on your terms.
        </p>

        <div className="hero-actions">

          {!myTeam && (
            <button
              className="primary"
              onClick={() => setView('create-team')}
            >
              Create your team <span>→</span>
            </button>
          )}

          {myTeam && (
            <button
              className="primary"
              onClick={() => setView('matches')}
            >
              Play a match <span>→</span>
            </button>
          )}

          <button
            className="secondary"
            onClick={() =>
              myTeam ? setView('tournaments') : setView('create-team')
            }
          >
            {myTeam ? 'Create tournament' : 'Start your club'}
          </button>

        </div>

        <div className="stadium-lines" />
      </section>


      <section className="section-heading">
        <div>
          <p className="eyebrow">NEXT UP</p>
          <h2>Quick Match</h2>
        </div>

        <button
          className="text-button"
          onClick={() => setView('matches')}
        >
          View all →
        </button>
      </section>


      <section className="match-card">

        <div className="team">

          <div
            className="crest"
            style={{
              background: myTeam?.primary || '#E56B35',
              color: myTeam?.secondary || '#fff',
            }}
          >
            {myTeam?.logo || 'CC'}
          </div>

          <strong>{myTeam?.name || 'Your Club'}</strong>
          <small>Home</small>

        </div>


        <div className="versus">
          <span>VS</span>
          <small>Ready to play</small>
        </div>


        <div className="team">

          <div className="crest blue">?</div>

          <strong>Opponent</strong>

          <small>
            {matchMode === 'friend'
              ? 'Friend online'
              : 'Computer'}
          </small>

        </div>


        <div className="match-card-action">

          <button
            className="primary"
            onClick={() => setView('matches')}
          >
            Set up match
          </button>

        </div>

      </section>


      <section className="stats-grid">
        <Stat value="86" label="Club rating" />
        <Stat value="0" label="Matches played" />
        <Stat value="0" label="Wins" />
      </section>

      <section className="setup-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">ONLINE MANAGERS</p>
            <h2>Players online</h2>
          </div>
          <strong>{onlinePlayers.filter(player => player.online).length}</strong>
        </div>

        {onlinePlayers.length === 0 ? (
          <p className="empty-state">No other managers are online.</p>
        ) : (
          onlinePlayers.slice(0, 10).map(player => (
            <div
              key={player.uid}
              className="selected-team-row"
            >
              <span
                className="mini-crest"
                style={{ background: player.primary }}
              >
                {player.logo}
              </span>

              <div>
                <strong>{player.name}</strong>
                <small>{player.playerId} · {player.online ? 'ONLINE' : 'OFFLINE'}</small>
              </div>
            </div>
          ))
        )}
      </section>
    </>
  )
}


/* ---------------- CREATE TEAM ---------------- */

function CreateTeam({
  team,
  setTeam,
  onCreate,
  onBack,
}: {
  team: Team
  setTeam: (team: Team) => void
  onCreate: () => void
  onBack: () => void
}) {
  const valid = team.name.trim().length > 0 &&
    team.shortName.trim().length > 0

  return (
    <>
      <section className="page-title">

        <button
          className="back-button"
          onClick={onBack}
        >
          ← Back
        </button>

        <p className="eyebrow">CLUB CREATION</p>

        <h1>Create your team</h1>

        <p>
          This will be your club throughout matches and tournaments.
        </p>

      </section>


      <section className="setup-card">

        <div className="team-preview">

          <div
            className="large-crest"
            style={{
              background: team.primary,
              color: team.secondary,
            }}
          >
            {team.logo}
          </div>

          <div>
            <p className="eyebrow">YOUR CLUB</p>
            <h2>
              {team.name || 'Your Team'}
            </h2>

            <small>
              {team.shortName || 'TEAM'}
            </small>
          </div>

        </div>


        <label>
          Team name

          <input
            type="text"
            placeholder="e.g. Gladiators"
            value={team.name}
            maxLength={24}
            onChange={e =>
              setTeam({
                ...team,
                name: e.target.value,
              })
            }
          />
        </label>


        <label>
          Short name

          <input
            type="text"
            placeholder="e.g. GLD"
            value={team.shortName}
            maxLength={4}
            onChange={e =>
              setTeam({
                ...team,
                shortName: e.target.value.toUpperCase(),
              })
            }
          />
        </label>


        <div className="team-builder-section">

          <p className="eyebrow">CHOOSE CREST</p>

          <div className="logo-grid">

            {logos.map(logo => (
              <button
                key={logo}
                className={
                  team.logo === logo
                    ? 'logo-option selected'
                    : 'logo-option'
                }
                onClick={() =>
                  setTeam({
                    ...team,
                    logo,
                  })
                }
              >
                {logo}
              </button>
            ))}

          </div>

        </div>


        <div className="team-builder-section">

          <p className="eyebrow">PRIMARY COLOUR</p>

          <div className="colour-grid">

            {colours.map(colour => (
              <button
                key={colour}
                className={
                  team.primary === colour
                    ? 'colour-option selected'
                    : 'colour-option'
                }
                style={{ background: colour }}
                onClick={() =>
                  setTeam({
                    ...team,
                    primary: colour,
                  })
                }
                aria-label={`Select ${colour}`}
              />

            ))}

          </div>

        </div>


        <button
          className="primary full"
          disabled={!valid}
          onClick={onCreate}
        >
          Create club <span>→</span>
        </button>

      </section>
    </>
  )
}


/* ---------------- TOURNAMENT LOBBY ---------------- */

function TournamentLobby({
  myTeam,
  setView,
  onlinePlayers,
  activeTournamentId,
  tournamentName,
  tournamentData,
  myTournaments,
  currentUid,
  onSelectTournament,
}: {
  myTeam: Team | null
  setView: (view: View) => void
  onlinePlayers: OnlinePlayer[]
  activeTournamentId: string | null
  tournamentName: string
  tournamentData: any | null
  myTournaments: OnlineTournamentSummary[]
  currentUid: string | null
  onSelectTournament: (tournamentId: string) => void
}) {
  const [showTeams, setShowTeams] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  const [inviteNumber, setInviteNumber] = useState('')
  const [inviteSent, setInviteSent] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [selectedTeams, setSelectedTeams] = useState<string[]>([])
  const [tournamentMembers, setTournamentMembers] = useState<Record<string, any>[]>([])

  useEffect(() => {
    if (!activeTournamentId) {
      setTournamentMembers([])
      return
    }

    return watchTournamentMembers(activeTournamentId, members => {
      setTournamentMembers(members)
    })
  }, [activeTournamentId])

  const availableTeams = [
    { name: 'Thunderbolts', shortName: 'THB', logo: '⚡', primary: '#3B82F6' },
    { name: 'Royals', shortName: 'RYL', logo: '♛', primary: '#8B5CF6' },
    { name: 'Leopards', shortName: 'LEP', logo: '◆', primary: '#E7B93C' },
    { name: 'Gladiators', shortName: 'GLD', logo: '★', primary: '#E56B35' },
    { name: 'Falcons', shortName: 'FLC', logo: '▲', primary: '#22A06B' },
    { name: 'Scorpions', shortName: 'SCP', logo: '◈', primary: '#EF4444' },
  ]

  const toggleTeam = (teamName: string) => {
    setSelectedTeams(current => {
      if (current.includes(teamName)) {
        return current.filter(name => name !== teamName)
      }
      if (current.length >= 19) return current
      return [...current, teamName]
    })
  }

  const addBots = async () => {
    const remainingSlots = 19 - selectedTeams.length
    if (remainingSlots <= 0) return

    const available = availableTeams.filter(
      team => !selectedTeams.includes(team.name)
    )

    const shuffled = [...available].sort(() => Math.random() - 0.5)
    const botsToAdd = shuffled.slice(0, Math.min(remainingSlots, available.length))

    setSelectedTeams(current => [...current, ...botsToAdd.map(team => team.name)])

    if (activeTournamentId) {
      try {
        await addBotTeamsToTournament(activeTournamentId, botsToAdd)
      } catch (error) {
        setInviteError('Could not add bot teams.')
        console.error(error)
      }
    }
  }

  const sendInvite = async () => {
    if (!activeTournamentId || !myTeam) {
      setInviteError('Create the tournament first.')
      return
    }

    const playerId = inviteNumber.trim().toUpperCase()
    const receiver = onlinePlayers.find(
      player => player.playerId.toUpperCase() === playerId && player.online
    )

    if (!receiver) {
      setInviteError('Player ID not found or player is offline.')
      return
    }

    try {
      await sendFriendInvite({
        receiverUid: receiver.uid,
        tournamentId: activeTournamentId,
        tournamentName: tournamentName || 'Cricket Command Tournament',
        fromName: myTeam.name,
        fromTeamName: myTeam.name,
        fromTeamShortName: myTeam.shortName,
      })

      setInviteSent(true)
      setInviteError('')
      setInviteNumber('')
    } catch (error) {
      console.error('Could not send friend invite:', error)
      setInviteError('Could not send the invitation.')
    }
  }

  return (
    <>
      <section className="page-title">
        <p className="eyebrow">CUSTOM COMPETITIONS</p>
        <h1>{activeTournamentId ? (tournamentName || 'Tournament lobby') : 'Create tournament'}</h1>
        <p>{activeTournamentId ? 'Enter your tournament lobby and manage your competition.' : 'Build your own competition with friends and bot teams.'}</p>
      </section>

      {myTournaments.length > 0 && (
        <section className="setup-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">MY TOURNAMENTS</p>
              <h2>Choose competition</h2>
            </div>
            <strong>{myTournaments.length}</strong>
          </div>

          {myTournaments.map(item => (
            <button
              key={item.id}
              type="button"
              className={activeTournamentId === item.id ? 'selected-team-row selected' : 'selected-team-row'}
              onClick={() => onSelectTournament(item.id)}
            >
              <span className="mini-crest" style={{ background: '#E7B93C' }}>♜</span>
              <div>
                <strong>{item.name}</strong>
                <small>{item.teamCount} teams · {item.format || 'Not set'} · {item.status}</small>
              </div>
              <b>{activeTournamentId === item.id ? 'OPEN' : 'ENTER →'}</b>
            </button>
          ))}
        </section>
      )}

      <section className="setup-card">
        <div className="tournament-team">
          <div
            className="crest"
            style={{
              background: myTeam?.primary || '#E7B93C',
              color: myTeam?.secondary || '#14283B',
            }}
          >
            {myTeam?.logo || '⚡'}
          </div>
          <div>
            <small>YOUR TEAM</small>
            <h2>{myTeam?.name || 'Create a team first'}</h2>
          </div>
        </div>

        <div className="lobby-actions">
          {activeTournamentId && (
            <button
              type="button"
              className="secondary"
              onClick={() => onSelectTournament('')}
            >
              New tournament <span>+</span>
            </button>
          )}
          <button
            type="button"
            className="secondary"
            disabled={!activeTournamentId}
            onClick={() => {
              setInviteSent(false)
              setInviteError('')
              setInviteNumber('')
              setShowInvite(true)
            }}
          >
            Invite friend <span>→</span>
          </button>

          <button
            type="button"
            className="secondary"
            onClick={() => setShowTeams(true)}
          >
            Add teams <span>→</span>
          </button>

          <button
            type="button"
            className="secondary"
            onClick={addBots}
            disabled={selectedTeams.length >= 19}
          >
            Add teams by bot <span>→</span>
          </button>
        </div>

        {selectedTeams.length > 0 && (
          <div className="selected-teams">
            <p className="eyebrow">TEAMS IN TOURNAMENT</p>

            {selectedTeams.map(teamName => {
              const selectedTeam = availableTeams.find(team => team.name === teamName)
              if (!selectedTeam) return null

              return (
                <div className="selected-team-row" key={selectedTeam.name}>
                  <span
                    className="mini-crest"
                    style={{ background: selectedTeam.primary }}
                  >
                    {selectedTeam.logo}
                  </span>

                  <strong>{selectedTeam.name}</strong>
                  <small>{selectedTeam.shortName}</small>

                  <button
                    type="button"
                    onClick={() => toggleTeam(selectedTeam.name)}
                    className="remove-team"
                    aria-label={`Remove ${selectedTeam.name}`}
                  >
                    ×
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {tournamentMembers.filter(member => member.uid !== undefined && member.team).length > 1 && (
          <div className="selected-teams">
            <p className="eyebrow">MANAGERS IN TOURNAMENT</p>

            {tournamentMembers
              .filter(member => member.team)
              .map(member => (
                <div className="selected-team-row" key={member.uid}>
                  <span
                    className="mini-crest"
                    style={{ background: member.team.primary || '#E7B93C' }}
                  >
                    {member.team.logo || '⚡'}
                  </span>
                  <strong>{member.team.name}</strong>
                  <small>{member.team.shortName || 'TEAM'}</small>
                  {member.role === 'owner' && <small>HOST</small>}
                </div>
              ))}
          </div>
        )}

        {activeTournamentId && (
          <div className="invite-status">
            <strong>{tournamentName || 'Tournament'} is live</strong>
            <p>Invite online managers before starting the auction.</p>
          </div>
        )}

        {inviteSent && (
          <div className="invite-status">
            <strong>Invite sent</strong>
            <p>Waiting for your friend to accept the tournament invitation.</p>
          </div>
        )}

        {tournamentData?.auction?.status === 'readying' && (
          <div className="selected-teams">
            <p className="eyebrow">AUCTION READY CHECK</p>
            {tournamentMembers.filter(member => member.team).map(member => {
              const isBot = member.role === 'bot'
              const ready = isBot || tournamentData.auction.ready?.[member.uid] === true
              const online = isBot || onlinePlayers.some(player => player.uid === member.uid && player.online)
              const isMe = member.uid === currentUid
              return (
                <div className="selected-team-row" key={member.uid}>
                  <span className="mini-crest" style={{ background: member.team.primary || '#E7B93C' }}>{member.team.logo || '⚡'}</span>
                  <div>
                    <strong>{member.team.name}</strong>
                    <small>{isBot ? 'BOT · READY' : `${online ? 'ONLINE' : 'OFFLINE'} · ${ready ? 'READY' : 'WAITING'}`}</small>
                  </div>
                  {isMe && !ready && online && (
                    <button type="button" className="primary" onClick={() => setAuctionReady(activeTournamentId!, true)}>READY</button>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <div className="config-summary">
          <div>
            <small>TEAMS</small>
            <strong>{Math.max(1, tournamentMembers.length) + selectedTeams.length} / {tournamentData?.teamCount || 20}</strong>
          </div>
          <div>
            <small>FORMAT</small>
            <strong>{tournamentData?.format || 'Not set'}</strong>
          </div>
          <div>
            <small>STATUS</small>
            <strong>{tournamentData?.status ? String(tournamentData.status).toUpperCase() : 'LOBBY'}</strong>
          </div>
        </div>

        {!activeTournamentId ? (
          <button
            type="button"
            className="primary full"
            onClick={() => setView('tournament-setup')}
          >
            Tournament setup <span>→</span>
          </button>
        ) : ['running', 'going-once', 'going-twice', 'sold'].includes(tournamentData?.auction?.status) ? (
          <button type="button" className="primary full" onClick={() => setView('auction')}>
            Enter live auction <span>→</span>
          </button>
        ) : tournamentData?.auction?.status === 'readying' ? (
          <div className="invite-status">
            <strong>AUCTION READY CHECK</strong>
            <p>Everyone must be online and press Ready.</p>
          </div>
        ) : currentUid === tournamentData?.ownerUid ? (
          <button
            type="button"
            className="primary full"
            onClick={async () => {
              try {
                await requestAuctionReady(activeTournamentId)
              } catch (error) {
                console.error('Could not start auction ready check:', error)
                setInviteError(error instanceof Error ? error.message : 'Could not start auction.')
              }
            }}
          >
            Start auction <span>→</span>
          </button>
        ) : (
          <div className="invite-status">
            <strong>WAITING FOR HOST</strong>
            <p>Only the tournament creator can start the auction.</p>
          </div>
        )}
      </section>

      {showTeams && (
        <div className="modal-overlay" onClick={() => setShowTeams(false)}>
          <div className="team-modal" onClick={event => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">TOURNAMENT TEAMS</p>
                <h2>Add teams</h2>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setShowTeams(false)}
              >
                ×
              </button>
            </div>

            <p className="modal-description">
              Select the teams you want in this tournament.
            </p>

            <div className="available-teams">
              {availableTeams.map(team => {
                const selected = selectedTeams.includes(team.name)

                return (
                  <button
                    type="button"
                    key={team.name}
                    className={`available-team ${selected ? 'selected' : ''}`}
                    onClick={() => toggleTeam(team.name)}
                  >
                    <span
                      className="mini-crest"
                      style={{ background: team.primary }}
                    >
                      {team.logo}
                    </span>

                    <span>
                      <strong>{team.name}</strong>
                      <small>{team.shortName}</small>
                    </span>

                    <b>{selected ? '✓' : '+'}</b>
                  </button>
                )
              })}
            </div>

            <button
              type="button"
              className="primary full"
              onClick={() => setShowTeams(false)}
            >
              Add selected teams <span>→</span>
            </button>
          </div>
        </div>
      )}

      {showInvite && (
        <div className="modal-overlay" onClick={() => setShowInvite(false)}>
          <div className="team-modal invite-modal" onClick={event => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">FRIEND INVITATION</p>
                <h2>Invite a friend</h2>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setShowInvite(false)}
              >
                ×
              </button>
            </div>

            <p className="modal-description">
              Enter your friend's Player ID from the Players Online list.
            </p>

            <input
              autoFocus
              className="invite-input"
              type="text"
              placeholder="e.g. CC-EEUDCK"
              value={inviteNumber}
              onChange={event => {
                setInviteNumber(event.target.value)
                setInviteError('')
                setInviteSent(false)
              }}
            />

            {onlinePlayers.filter(player => player.online).length > 0 && (
              <div className="available-teams">
                {onlinePlayers
                  .filter(player => player.online)
                  .slice(0, 10)
                  .map(player => (
                    <button
                      type="button"
                      key={player.uid}
                      className="available-team"
                      onClick={() => setInviteNumber(player.playerId)}
                    >
                      <span
                        className="mini-crest"
                        style={{ background: player.primary }}
                      >
                        {player.logo}
                      </span>
                      <span>
                        <strong>{player.name}</strong>
                        <small>{player.playerId}</small>
                      </span>
                      <b>+</b>
                    </button>
                  ))}
              </div>
            )}

            {inviteError && (
              <p className="empty-state">{inviteError}</p>
            )}

            <div className="invite-buttons">
              <button
                type="button"
                className="secondary"
                onClick={() => setShowInvite(false)}
              >
                Cancel
              </button>

              <button
                type="button"
                className="primary"
                disabled={!inviteNumber.trim()}
                onClick={sendInvite}
              >
                Send invite →
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}


/* ---------------- TOURNAMENT SETUP ---------------- */

function TournamentSetup({
  tournament,
  setTournament,
  myTeam,
  onBack,
  onCreate,
}: {
  tournament: {
    name: string
    teamCount: number
    format: string
    overs: number
    auctionEnabled: boolean
    purse: number
  }
  setTournament: (value: {
    name: string
    teamCount: number
    format: string
    overs: number
    auctionEnabled: boolean
    purse: number
  }) => void
  myTeam: Team | null
  onBack: () => void
  onCreate: () => void | Promise<void>
}) {
  const update = (changes: Partial<typeof tournament>) => {
    setTournament({ ...tournament, ...changes })
  }

  const canCreate =
    tournament.name.trim().length >= 3 &&
    tournament.teamCount >= 4

  return (
    <>
      <section className="page-title">
        <button className="back-button" onClick={onBack}>
          ← Lobby
        </button>

        <p className="eyebrow">TOURNAMENT SETUP</p>
        <h1>Competition settings</h1>
        <p>Configure the tournament before the auction begins.</p>
      </section>

      <section className="setup-card tournament-setup-card">

        <div className="setup-section">
          <p className="setup-label">TOURNAMENT NAME</p>

          <input
            className="setup-input"
            type="text"
            maxLength={30}
            placeholder="e.g. Champions League"
            value={tournament.name}
            onChange={event =>
              update({ name: event.target.value })
            }
          />
        </div>

        <div className="setup-section">
          <p className="setup-label">NUMBER OF TEAMS</p>

          <div className="option-grid team-count-grid">
            {[4, 6, 8, 10, 12, 16, 18, 20].map(count => (
              <button
                type="button"
                key={count}
                className={
                  tournament.teamCount === count
                    ? 'option-card selected'
                    : 'option-card'
                }
                onClick={() => update({ teamCount: count })}
              >
                <strong>{count}</strong>
                <small>Teams</small>
              </button>
            ))}
          </div>
        </div>

        <div className="setup-section">
          <p className="setup-label">TOURNAMENT FORMAT</p>

          <div className="vertical-options">
            {[
              {
                title: 'League',
                description: 'Every team competes in the league.',
              },
              {
                title: 'League + Playoffs',
                description: 'League stage followed by playoffs and final.',
              },
              {
                title: 'Knockout',
                description: 'Straight knockout competition.',
              },
            ].map(option => (
              <button
                type="button"
                key={option.title}
                className={
                  tournament.format === option.title
                    ? 'wide-option selected'
                    : 'wide-option'
                }
                onClick={() => update({ format: option.title })}
              >
                <span>
                  <strong>{option.title}</strong>
                  <small>{option.description}</small>
                </span>

                <b>
                  {tournament.format === option.title ? '✓' : '○'}
                </b>
              </button>
            ))}
          </div>
        </div>

        <div className="setup-section">
          <p className="setup-label">MATCH FORMAT</p>

          <div className="option-grid">
            {[5, 10, 20, 50].map(overs => (
              <button
                type="button"
                key={overs}
                className={
                  tournament.overs === overs
                    ? 'option-card selected'
                    : 'option-card'
                }
                onClick={() => update({ overs })}
              >
                <strong>{overs}</strong>
                <small>Overs</small>
              </button>
            ))}
          </div>
        </div>

        <div className="setup-section">
          <div className="auction-header">
            <div>
              <p className="setup-label">PLAYER AUCTION</p>
              <small>Build every squad through an auction.</small>
            </div>

            <button
              type="button"
              className={
                tournament.auctionEnabled
                  ? 'switch on'
                  : 'switch'
              }
              onClick={() =>
                update({
                  auctionEnabled: !tournament.auctionEnabled,
                })
              }
              aria-label="Toggle auction"
            >
              <span />
            </button>
          </div>

          {tournament.auctionEnabled && (
            <div className="purse-box">
              <div>
                <small>STARTING PURSE</small>
                <strong>₹{tournament.purse} Cr</strong>
              </div>

              <div className="purse-controls">
                {[50, 75, 100, 125].map(purse => (
                  <button
                    type="button"
                    key={purse}
                    className={
                      tournament.purse === purse
                        ? 'purse-option selected'
                        : 'purse-option'
                    }
                    onClick={() => update({ purse })}
                  >
                    ₹{purse} Cr
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="setup-summary">
          <div>
            <small>YOUR TEAM</small>
            <strong>{myTeam?.name || 'Not created'}</strong>
          </div>

          <div>
            <small>TEAMS</small>
            <strong>{tournament.teamCount}</strong>
          </div>

          <div>
            <small>FORMAT</small>
            <strong>{tournament.format}</strong>
          </div>

          <div>
            <small>AUCTION</small>
            <strong>{tournament.auctionEnabled ? 'ON' : 'OFF'}</strong>
          </div>
        </div>

        <button
          type="button"
          className="primary full"
          disabled={!canCreate}
          onClick={onCreate}
        >
          Create tournament <span>→</span>
        </button>

      </section>
    </>
  )
}


/* ---------------- AUCTION ---------------- */

type AuctionPlayer = {
  name: string
  role: string
  rating: number
  base: number
}

const AUCTION_PLAYERS: AuctionPlayer[] = [
  { name: 'Arjun Mehta', role: 'BAT', rating: 88, base: 2 },
  { name: 'Rohan Das', role: 'BAT', rating: 84, base: 1.5 },
  { name: 'Vikram Shah', role: 'AR', rating: 86, base: 2 },
  { name: 'Aditya Rao', role: 'BOWL', rating: 82, base: 1 },
  { name: 'Karan Iyer', role: 'WK', rating: 80, base: 1 },
  { name: 'Sameer Khan', role: 'BOWL', rating: 85, base: 1.5 },
  { name: 'Nikhil Verma', role: 'BAT', rating: 79, base: 0.75 },
  { name: 'Dev Patel', role: 'AR', rating: 83, base: 1 },
  { name: 'Ritesh Singh', role: 'BOWL', rating: 77, base: 0.75 },
  { name: 'Aman Kapoor', role: 'BAT', rating: 75, base: 0.5 },
]

function AuctionRoom({
  myTeam,
  purse,
  setPurse,
  teamCount,
  tournamentId,
  tournamentData,
  onExit,
}: {
  myTeam: Team | null
  purse: number
  setPurse: (value: number) => void
  teamCount: number
  tournamentId: string | null
  tournamentData: any | null
  onExit: () => void
}) {
  const [auction, setAuction] = useState<any | null>(tournamentData?.auction || null)
  const [error, setError] = useState('')
  const uid = getCurrentUserUid()
  const myName = myTeam?.name || 'Your Team'
  const playerIndex = Number(auction?.playerIndex || 0)
  const player = AUCTION_PLAYERS[Math.min(playerIndex, AUCTION_PLAYERS.length - 1)]
  const currentBid = Number(auction?.currentBid || player.base)
  const highestBidder = auction?.highestBidderName || 'Base price'
  const status = auction?.status || 'readying'
  const bidStep = currentBid >= 10 ? 1 : currentBid >= 5 ? 0.5 : 0.25
  const nextBid = Number((currentBid + bidStep).toFixed(2))
  const isHost = uid === tournamentData?.ownerUid
  const members = Object.values<any>(tournamentData?.members || {})
  const humans = members.filter(member => member.role !== 'bot')
  const bots = members.filter(member => member.role === 'bot')
  const allReady = humans.length > 0 && humans.every(member => auction?.ready?.[member.uid] === true)

  useEffect(() => {
    setAuction(tournamentData?.auction || null)
  }, [tournamentData?.auction])

  useEffect(() => {
    if (!tournamentId) return
    return watchTournament(tournamentId, data => setAuction((data as any)?.auction || null))
  }, [tournamentId])

  useEffect(() => {
    if (!tournamentId || !auction || !isHost || status !== 'running' || highestBidder !== 'Base price' || !bots.length) return
    const timer = window.setTimeout(async () => {
      const bot = bots[Math.floor(Math.random() * bots.length)]
      try { await placeAuctionBid(tournamentId, nextBid, bot.team.name) } catch {}
    }, 2200 + Math.floor(Math.random() * 1800))
    return () => window.clearTimeout(timer)
  }, [tournamentId, auction?.lastActionAt, status, highestBidder, nextBid, isHost, bots.length])

  useEffect(() => {
    if (!tournamentId || !auction || !isHost || status !== 'running' || highestBidder === 'Base price') return
    const last = Number(auction.lastActionAt || 0)
    const timer = window.setTimeout(() => { setAuctionStage(tournamentId, 'going-once').catch(() => {}) }, Math.max(500, 4500 - (Date.now() - last)))
    return () => window.clearTimeout(timer)
  }, [tournamentId, auction?.lastActionAt, status, highestBidder, isHost])

  useEffect(() => {
    if (!tournamentId || !isHost || status !== 'going-once') return
    const timer = window.setTimeout(() => { setAuctionStage(tournamentId, 'going-twice').catch(() => {}) }, 1800)
    return () => window.clearTimeout(timer)
  }, [tournamentId, status, isHost])

  useEffect(() => {
    if (!tournamentId || !auction || !isHost || status !== 'going-twice') return
    const timer = window.setTimeout(() => {
      sellAuctionPlayer(tournamentId, playerIndex, player.name, highestBidder, currentBid, auction.highestBidderUid || null).catch(() => {})
    }, 1800)
    return () => window.clearTimeout(timer)
  }, [tournamentId, auction, status, isHost, playerIndex, player.name, highestBidder, currentBid])

  useEffect(() => {
    if (!tournamentId || !isHost || status !== 'sold') return
    if (playerIndex >= AUCTION_PLAYERS.length - 1) {
      setAuctionStage(tournamentId, 'complete').catch(() => {})
      return
    }
    const timer = window.setTimeout(() => {
      advanceAuctionPlayer(tournamentId, playerIndex + 1, AUCTION_PLAYERS[playerIndex + 1].base).catch(() => {})
    }, 2200)
    return () => window.clearTimeout(timer)
  }, [tournamentId, status, isHost, playerIndex])

  useEffect(() => {
    if (status === 'aborted') setError(auction?.reason || 'Auction closed because a manager went offline.')
  }, [status, auction?.reason])

  const handleBid = async () => {
    if (!tournamentId || status !== 'running' || !uid || nextBid > purse || highestBidder === myName) return
    try {
      await placeAuctionBid(tournamentId, nextBid, myName)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bid rejected.')
    }
  }

  if (status === 'aborted') return (
    <section className="setup-card">
      <p className="eyebrow">AUCTION CLOSED</p>
      <h1>Manager offline</h1>
      <p>{error || 'Every manager must remain online. The auction has been stopped.'}</p>
      <button className="primary full" onClick={onExit}>Return to tournament →</button>
    </section>
  )

  if (status === 'readying') return (
    <>
      <section className="page-title">
        <button className="back-button" onClick={onExit}>← Tournament</button>
        <p className="eyebrow">AUCTION · READY CHECK</p>
        <h1>Everyone Ready?</h1>
        <p>The auction starts only when every manager is online and ready.</p>
      </section>
      <section className="setup-card">
        {members.map(member => {
          const ready = member.role === 'bot' || auction?.ready?.[member.uid] === true
          return (
            <div className="selected-team-row" key={member.uid}>
              <span className="mini-crest" style={{ background: member.team?.primary || '#E7B93C' }}>{member.team?.logo || '⚡'}</span>
              <div><strong>{member.team?.name || member.uid}</strong><small>{member.role === 'bot' ? 'BOT · READY' : ready ? 'READY' : 'WAITING'}</small></div>
              {member.uid === uid && !ready && <button className="primary" onClick={() => setAuctionReady(tournamentId!, true)}>READY</button>}
            </div>
          )
        })}
        <div className="invite-status"><strong>{allReady ? 'Starting auction…' : 'Waiting for all managers'}</strong><p>{humans.filter(member => auction?.ready?.[member.uid] === true).length} / {humans.length} managers ready.</p></div>
      </section>
    </>
  )

  return (
    <>
      <section className="page-title">
        <button className="back-button" onClick={onExit}>← Tournament</button>
        <p className="eyebrow">PLAYER AUCTION · LIVE ROOM</p>
        <h1>Player Auction</h1>
        <p>{myName} · {teamCount} teams · purse ₹{purse.toFixed(2)} Cr</p>
      </section>
      <section className="auction-card">
        <div className="auction-topbar"><span>PLAYER {playerIndex + 1} / {AUCTION_PLAYERS.length}</span><strong>YOUR PURSE ₹{purse.toFixed(2)} Cr</strong></div>
        <div className="auction-player"><div className="auction-rating">{player.rating}<small>OVR</small></div><div className="auction-player-info"><p className="eyebrow">{player.role}</p><h2>{player.name}</h2><span>Base Price ₹{player.base} Cr</span></div></div>
        <div className="auction-bid"><small>CURRENT BID</small><strong>₹{currentBid.toFixed(2)} Cr</strong><span>{highestBidder === 'Base price' ? 'Opening price' : `Leading: ${highestBidder}`}</span></div>
        <div className="auction-thinking-panel"><div className="thinking-spinner" /><div><strong>{status === 'going-once' ? 'GOING ONCE…' : status === 'going-twice' ? 'GOING TWICE…' : status === 'sold' ? 'SOLD' : 'LIVE BIDDING'}</strong><span>{status === 'running' ? 'All managers are connected. Bids are synchronized live.' : status === 'sold' ? `Sold to ${highestBidder}.` : 'Auctioneer is closing the sale.'}</span></div></div>
        {status === 'sold' ? <div className="sold-banner"><p>SOLD</p><h2>SOLD TO {highestBidder}</h2><strong>₹{currentBid.toFixed(2)} Cr</strong></div> : <div className="auction-actions auction-actions-real"><button className="primary" disabled={status !== 'running' || highestBidder === myName || nextBid > purse} onClick={handleBid}>BID ₹{nextBid.toFixed(2)} Cr</button></div>}
      </section>
      {error && <section className="invite-status"><strong>{error}</strong></section>}
      <section className="auction-teams-panel"><div className="section-heading"><div><p className="eyebrow">LIVE MANAGERS</p><h2>Teams</h2></div></div>{members.map(member => <div className={`auction-team-row ${member.team?.name === highestBidder ? 'leading' : ''}`} key={member.uid}><span className="team-status-dot" /><strong>{member.team?.name}</strong><small>{member.role === 'bot' ? 'BOT' : 'MANAGER'}</small><b>{member.uid === uid ? `₹${purse.toFixed(2)} Cr` : `₹${tournamentData?.purse || 100} Cr`}</b></div>)}</section>
    </>
  )
}


/* ---------------- MATCHES ---------------- */

function Matches({
  matchMode,
  setMatchMode,
  startMatch,
  myTeam,
}: {
  matchMode: 'friend' | 'bot'
  setMatchMode: (mode: 'friend' | 'bot') => void
  startMatch: (opponent: string) => void
  myTeam: Team | null
}) {
  return (
    <>
      <section className="page-title">

        <p className="eyebrow">MATCH CENTRE</p>

        <h1>Set up a live match</h1>

        <p>
          Invite a friend for a real-time contest,
          or practise against a computer manager.
        </p>

      </section>


      <section className="mode-toggle">

        <button
          className={matchMode === 'friend' ? 'selected' : ''}
          onClick={() => setMatchMode('friend')}
        >
          Friendly match
        </button>

        <button
          className={matchMode === 'bot' ? 'selected' : ''}
          onClick={() => setMatchMode('bot')}
        >
          Play a bot
        </button>

      </section>


      <section className="setup-card">

        <h2>
          {matchMode === 'friend'
            ? 'Invite a friend'
            : 'Choose your opposition'}
        </h2>

        <p>
          {matchMode === 'friend'
            ? 'A friendly request becomes a real-time match when both managers accept.'
            : 'Select a computer-managed side to start immediately.'}
        </p>


        <div className="choices">

          <button>
            <span>Overs</span>
            <strong>5 Overs</strong>
            <i>⌄</i>
          </button>

          <button>
            <span>Venue</span>
            <strong>Wankhede</strong>
            <i>⌄</i>
          </button>

          <button>
            <span>Pitch</span>
            <strong>Balanced</strong>
            <i>⌄</i>
          </button>

        </div>


        <button
          className="primary full"
          onClick={() =>
            startMatch(
              matchMode === 'friend'
                ? 'Rohan CC'
                : 'Coastal Kings'
            )
          }
        >
          {matchMode === 'friend'
            ? `Challenge friend`
            : `Start against bot`}
          <span>→</span>
        </button>

      </section>
    </>
  )
}


/* ---------------- LIVE MATCH ---------------- */

function LiveMatch({
  match,
  onBowl,
  onStartChase,
  onExit,
}: {
  match: MatchState
  onBowl: (intent: Intent) => void
  onStartChase: () => void
  onExit: () => void
}) {
  const latestDelivery = match.deliveries.at(-1)
  const ballsInOver = match.legalBalls % 6
  const emptyBalls =
    ballsInOver === 0 && match.legalBalls > 0
      ? 0
      : 6 - ballsInOver

  return (
    <>
      <section className="live-header">

        <button
          className="back-button"
          onClick={onExit}
        >
          ← Matches
        </button>

        <p className="eyebrow">
          LIVE MATCH ·{' '}
          {match.status === 'in-progress'
            ? 'IN PROGRESS'
            : 'INNINGS COMPLETE'}
        </p>

      </section>


      <section className="scoreboard">

        <div className="score-teams">

          <span className="crest orange">CC</span>

          <div>
            <p>{match.battingTeam}</p>
            <h1>
              {match.runs}
              <small>/{match.wickets}</small>
            </h1>

            <strong>
              {formatOvers(match.legalBalls)}
              {' / '}
              {match.overs} overs
            </strong>
          </div>

          <span className="vs-mark">v</span>

          <div className="bowling-team">

            <p>{match.bowlingTeam}</p>

            <strong>
              {match.target
                ? `Target ${match.target}`
                : 'Bowling'}
            </strong>

          </div>

        </div>


        <div className="run-rate">

          <span>
            CRR{' '}
            <strong>
              {match.legalBalls
                ? (
                    match.runs /
                    (match.legalBalls / 6)
                  ).toFixed(1)
                : '0.0'}
            </strong>
          </span>

          <span>
            {match.target ? 'Need ' : 'Wkts '}
            <strong>
              {match.target
                ? Math.max(
                    0,
                    match.target - match.runs
                  )
                : 5 - match.wickets}
            </strong>
          </span>

        </div>

      </section>


      <section className="delivery-panel">

        <p className="eyebrow">CURRENT OVER</p>

        <h2>
          {latestDelivery
            ? latestDelivery.commentary
            : 'The opening ball is ready.'}
        </h2>

        <div className="ball-track">

          {match.deliveries
            .slice(-6)
            .map(delivery => (
              <span
                key={delivery.id}
                className={
                  delivery.wicket
                    ? 'wicket'
                    : delivery.runs >= 4
                      ? 'boundary'
                      : ''
                }
              >
                {delivery.label}
              </span>
            ))}

          {Array.from(
            { length: emptyBalls },
            (_, index) => (
              <i key={index} />
            )
          )}

        </div>

      </section>


      {match.status === 'in-progress' ? (

        <section className="action-panel">

          <p>
            {match.innings === 1
              ? 'Your batting instruction'
              : 'Chase simulation instruction'}
          </p>

          <div>

            <button
              onClick={() => onBowl('defend')}
            >
              Defend
            </button>

            <button
              onClick={() => onBowl('rotate')}
            >
              Rotate strike
            </button>

            <button
              className="attack"
              onClick={() => onBowl('attack')}
            >
              Attack
            </button>

          </div>

        </section>

      ) : (

        <section className="result-panel">

          <p className="eyebrow">
            {match.status === 'innings-break'
              ? 'INNINGS BREAK'
              : 'MATCH RESULT'}
          </p>

          <h2>{match.result}</h2>

          {match.status === 'innings-break' ? (

            <button
              className="primary"
              onClick={onStartChase}
            >
              Start chase <span>→</span>
            </button>

          ) : (

            <button
              className="primary"
              onClick={onExit}
            >
              Back to match centre
            </button>

          )}

        </section>

      )}


      <section className="commentary-list">

        <p className="eyebrow">BALL-BY-BALL</p>

        {match.deliveries.length ? (

          [...match.deliveries]
            .reverse()
            .map(delivery => (
              <div key={delivery.id}>

                <strong>
                  {formatOvers(delivery.id)}
                </strong>

                <span>
                  {delivery.commentary.split(' — ')[1]}
                </span>

                <b
                  className={
                    delivery.wicket
                      ? 'wicket-text'
                      : ''
                  }
                >
                  {delivery.label}
                </b>

              </div>
            ))

        ) : (

          <p className="empty-state">
            Choose an instruction to face the first delivery.
          </p>

        )}

      </section>

    </>
  )
}


/* ---------------- SQUAD ---------------- */

function Squad({
  myTeam,
}: {
  myTeam: Team | null
}) {
  const players = [
    ['Arjun Mehta', 88, 'Captain'],
    ['Rohan Das', 84, 'Opening batter'],
    ['Vikram Shah', 81, 'All-rounder'],
    ['Aditya Rao', 79, 'Fast bowler'],
  ]

  return (
    <>
      <section className="page-title">

        <p className="eyebrow">
          {myTeam?.name || 'YOUR CLUB'}
        </p>

        <h1>First XI</h1>

        <p>
          Squad management will connect to player
          ratings and form next.
        </p>

      </section>


      <section className="squad-list">

        {players.map(
          ([player, rating, role], index) => (

            <div key={player as string}>

              <span className="player-number">
                {index + 1}
              </span>

              <strong>
                {player} — {role}
              </strong>

              <small>
                {rating} OVR
              </small>

            </div>

          )
        )}

      </section>
    </>
  )
}


/* ---------------- STAT ---------------- */

function Stat({
  value,
  label,
}: {
  value: string
  label: string
}) {
  return (
    <div className="stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}


export default App