export type Intent = 'defend' | 'rotate' | 'attack'

export type Delivery = { id: number; label: string; runs: number; wicket: boolean; commentary: string }
export type Batter = { name: string; rating: number; runs: number; balls: number; out: boolean }
type InningsSummary = { team: string; runs: number; wickets: number; legalBalls: number; batters: Batter[] }

export type MatchState = {
  battingTeam: string; bowlingTeam: string; overs: number; runs: number; wickets: number; legalBalls: number
  deliveries: Delivery[]; batters: Batter[]; striker: number; innings: 1 | 2; target: number | null
  firstInnings: InningsSummary | null; status: 'in-progress' | 'innings-break' | 'completed'; result: string | null
}

const squads = {
  'Abraham CC': [{ name: 'Arjun Mehta', rating: 88 }, { name: 'Rohan Das', rating: 84 }, { name: 'Vikram Shah', rating: 81 }, { name: 'Aditya Rao', rating: 79 }, { name: 'Karan Iyer', rating: 76 }],
  default: [{ name: 'Samir Khan', rating: 83 }, { name: 'Nikhil Verma', rating: 80 }, { name: 'Dev Patel', rating: 78 }, { name: 'Ritesh Singh', rating: 75 }, { name: 'Aman Kapoor', rating: 73 }],
}

const outcomeSets: Record<Intent, Omit<Delivery, 'id'>[]> = {
  defend: [
    { label: '•', runs: 0, wicket: false, commentary: 'Defended calmly into the off side.' }, { label: '•', runs: 0, wicket: false, commentary: 'Good bowling; the batter leaves it alone.' }, { label: '1', runs: 1, wicket: false, commentary: 'Worked away for a single.' }, { label: '1', runs: 1, wicket: false, commentary: 'A quiet single keeps the innings moving.' }, { label: 'W', runs: 0, wicket: true, commentary: 'Wicket! The defensive stroke finds the fielder.' },
  ],
  rotate: [
    { label: '•', runs: 0, wicket: false, commentary: 'Stopped by a sharp fielder in the ring.' }, { label: '1', runs: 1, wicket: false, commentary: 'A quick single keeps the strike moving.' }, { label: '1', runs: 1, wicket: false, commentary: 'Neatly guided for one.' }, { label: '2', runs: 2, wicket: false, commentary: 'Placed into the gap for two.' }, { label: '2', runs: 2, wicket: false, commentary: 'Excellent running between the wickets.' }, { label: 'W', runs: 0, wicket: true, commentary: 'Run out! A risky call costs a wicket.' },
  ],
  attack: [
    { label: '•', runs: 0, wicket: false, commentary: 'The big swing misses its target.' }, { label: '1', runs: 1, wicket: false, commentary: 'Not timed perfectly, but they get one.' }, { label: '2', runs: 2, wicket: false, commentary: 'A powerful shot earns two.' }, { label: '4', runs: 4, wicket: false, commentary: 'Beautiful timing — four runs.' }, { label: '4', runs: 4, wicket: false, commentary: 'Driven firmly through the covers.' }, { label: '6', runs: 6, wicket: false, commentary: 'That has sailed over the ropes!' }, { label: 'W', runs: 0, wicket: true, commentary: 'Wicket! The aggressive shot finds a safe pair of hands.' }, { label: 'W', runs: 0, wicket: true, commentary: 'Cleaned up! The bowler wins the contest.' },
  ],
}

function createBatters(team: string): Batter[] {
  const squad = squads[team as keyof typeof squads] ?? squads.default
  return squad.map((player) => ({ ...player, runs: 0, balls: 0, out: false }))
}

export function createMatch(opponent: string, overs = 5, battingTeam = 'Abraham CC'): MatchState {
  return { battingTeam, bowlingTeam: opponent, overs, runs: 0, wickets: 0, legalBalls: 0, deliveries: [], batters: createBatters(battingTeam), striker: 0, innings: 1, target: null, firstInnings: null, status: 'in-progress', result: null }
}

export function bowlDelivery(match: MatchState, intent: Intent): MatchState {
  if (match.status !== 'in-progress') return match
  const selected = pickOutcome(outcomeSets[intent], match.batters[match.striker].rating)
  const legalBalls = match.legalBalls + 1; const wickets = match.wickets + Number(selected.wicket); const runs = match.runs + selected.runs
  const batters = match.batters.map((batter, index) => index === match.striker ? { ...batter, runs: batter.runs + selected.runs, balls: batter.balls + 1, out: batter.out || selected.wicket } : batter)
  const nextStriker = selected.wicket ? wickets : selected.runs % 2 ? 1 - match.striker : match.striker
  const striker = legalBalls % 6 === 0 ? 1 - nextStriker : nextStriker
  const targetReached = match.target !== null && runs >= match.target; const inningsFinished = legalBalls === match.overs * 6 || wickets === 5 || targetReached
  const delivery = { ...selected, id: legalBalls, commentary: `${formatOvers(legalBalls)} — ${selected.commentary}` }
  if (!inningsFinished) return { ...match, runs, wickets, legalBalls, batters, striker, deliveries: [...match.deliveries, delivery] }
  if (match.innings === 1) return { ...match, runs, wickets, legalBalls, batters, striker, deliveries: [...match.deliveries, delivery], status: 'innings-break', result: `${match.battingTeam} post ${runs}/${wickets}.` }
  const firstScore = match.firstInnings!.runs
  const result = targetReached ? `${match.battingTeam} win by ${5 - wickets} wickets.` : runs === firstScore ? 'The match is tied.' : `${match.bowlingTeam} win by ${firstScore - runs} runs.`
  return { ...match, runs, wickets, legalBalls, batters, striker, deliveries: [...match.deliveries, delivery], status: 'completed', result }
}

export function startChase(match: MatchState): MatchState {
  if (match.status !== 'innings-break') return match
  const firstInnings = { team: match.battingTeam, runs: match.runs, wickets: match.wickets, legalBalls: match.legalBalls, batters: match.batters }
  return { ...match, battingTeam: match.bowlingTeam, bowlingTeam: match.battingTeam, runs: 0, wickets: 0, legalBalls: 0, deliveries: [], batters: createBatters(match.bowlingTeam), striker: 0, innings: 2, target: firstInnings.runs + 1, firstInnings, status: 'in-progress', result: null }
}

function pickOutcome(outcomes: Omit<Delivery, 'id'>[], rating: number) {
  const skillBoost = rating >= 84 && Math.random() > 0.72 ? 1 : 0
  return outcomes[Math.min(outcomes.length - 1, Math.floor(Math.random() * outcomes.length) + skillBoost)]
}

export function formatOvers(legalBalls: number) { return `${Math.floor(legalBalls / 6)}.${legalBalls % 6}` }
