import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const MLB_BASE = 'https://statsapi.mlb.com/api'
const DODGERS_ID = 119

// Runs every 2 minutes
export const config = {
  schedule: '*/2 * * * *',
}

export default async function handler(req, context) {
  const today = new Date().toISOString().slice(0, 10)

  // First, upsert today's games from MLB API
  try {
    const schedRes = await fetch(
      `${MLB_BASE}/v1/schedule?teamId=${DODGERS_ID}&sportId=1&date=${today}&gameType=R&hydrate=team`
    )
    const schedData = await schedRes.json()

    for (const date of (schedData.dates || [])) {
      for (const game of (date.games || [])) {
        const isHome = game.teams.home.team.id === DODGERS_ID
        const opponent = isHome
          ? game.teams.away.team.abbreviation
          : game.teams.home.team.abbreviation

        const status = mapStatus(game.status.abstractGameState, game.status.detailedState)

        await supabase.from('games').upsert({
          game_pk: game.gamePk,
          game_date: today,
          opponent,
          home_away: isHome ? 'home' : 'away',
          status,
          first_pitch_time: game.gameDate || null,
          game_number: game.gameNumber || 1,
        }, { onConflict: 'game_pk' })
      }
    }
  } catch (e) {
    console.error('Schedule fetch error:', e.message)
  }

  // Get all scheduled or active games today
  const { data: games } = await supabase
    .from('games')
    .select('*')
    .eq('game_date', today)
    .in('status', ['scheduled', 'active'])

  if (!games?.length) {
    console.log('No active/scheduled games today')
    return new Response('No games', { status: 200 })
  }

  for (const game of games) {
    try {
      await pollGame(game)
    } catch (e) {
      console.error(`Error polling game ${game.game_pk}:`, e.message)
    }
  }

  return new Response('Polled ' + games.length + ' game(s)', { status: 200 })
}

async function pollGame(game) {
  const res = await fetch(`${MLB_BASE}/v1.1/game/${game.game_pk}/feed/live`)
  const feed = await res.json()

  const abstract = feed?.gameData?.status?.abstractGameState
  const detailed = feed?.gameData?.status?.detailedState || ''

  let newStatus = game.status
  if (abstract === 'Live') newStatus = 'active'
  else if (abstract === 'Final') newStatus = 'final'
  else if (detailed.toLowerCase().includes('postpone')) newStatus = 'postponed'

  // Update status + reveal picks if newly active
  if (newStatus !== game.status) {
    const updates = { status: newStatus }
    if (newStatus === 'active') {
      updates.lineup_locked = true
      await supabase.from('picks').update({ is_visible: true }).eq('game_id', game.id)
    }
    if (newStatus === 'postponed') {
      await supabase.from('picks').delete().eq('game_id', game.id)
    }
    await supabase.from('games').update(updates).eq('id', game.id)
    console.log(`Game ${game.game_pk} status: ${game.status} → ${newStatus}`)
  }

  // Only scan for HRs if game is active or just went final
  if (newStatus !== 'active' && newStatus !== 'final') return

  const gameData = feed?.gameData
  const homeId = gameData?.teams?.home?.id
  const awayId = gameData?.teams?.away?.id

  const allPlays = feed?.liveData?.plays?.allPlays || []

  const { data: existingHRs } = await supabase
    .from('home_runs')
    .select('player_id, inning, hr_number_in_game')
    .eq('game_id', game.id)

  const existingKeys = new Set(
    (existingHRs || []).map(hr => `${hr.player_id}-${hr.inning}-${hr.hr_number_in_game}`)
  )

  const newHRs = []
  let dodgerHRCount = (existingHRs || []).length

  for (const play of allPlays) {
    if (play.result?.eventType !== 'home_run') continue

    const battingTeamId = play.about?.halfInning === 'top' ? awayId : homeId
    if (battingTeamId !== DODGERS_ID) continue

    const playerId = play.matchup?.batter?.id
    const playerName = play.matchup?.batter?.fullName || 'Unknown'
    const inning = play.about?.inning || 0

    // Count this HR's position among all Dodger HRs
    const thisHRNumber = allPlays
      .filter(p => {
        if (p.result?.eventType !== 'home_run') return false
        const bt = p.about?.halfInning === 'top' ? awayId : homeId
        return bt === DODGERS_ID
      })
      .indexOf(play) + 1

    const key = `${playerId}-${inning}-${thisHRNumber}`
    if (existingKeys.has(key)) continue

    newHRs.push({
      game_id: game.id,
      player_id: playerId,
      player_name: playerName,
      inning,
      hr_number_in_game: thisHRNumber,
      is_first_of_game: thisHRNumber === 1,
      detected_at: new Date().toISOString(),
    })
  }

  if (newHRs.length > 0) {
    await supabase.from('home_runs').insert(newHRs)
    console.log(`Inserted ${newHRs.length} new HR(s) for game ${game.game_pk}`)
    await calculateScores(game.id)
  }

  if (newStatus === 'final') {
    await calculateScores(game.id)
  }
}

async function calculateScores(gameId) {
  const [{ data: homeRuns }, { data: picks }] = await Promise.all([
    supabase.from('home_runs').select('*').eq('game_id', gameId).order('hr_number_in_game'),
    supabase.from('picks').select('*').eq('game_id', gameId),
  ])

  if (!picks?.length) return

  const firstHR = (homeRuns || []).find(hr => hr.is_first_of_game)

  const scoreRows = picks.map(pick => {
    let points = 0
    const breakdown = {}

    if (firstHR && pick.player_id === firstHR.player_id) {
      points += 5
      breakdown.first_hr = 5
    }

    const additionalHRs = (homeRuns || []).filter(
      hr => !hr.is_first_of_game && hr.player_id === pick.player_id
    )
    if (additionalHRs.length > 0) {
      points += additionalHRs.length
      breakdown.additional_hrs = additionalHRs.length
    }

    return {
      user_id: pick.user_id,
      game_id: gameId,
      points_earned: points,
      breakdown,
      calculated_at: new Date().toISOString(),
    }
  })

  await supabase.from('scores').upsert(scoreRows, { onConflict: 'user_id,game_id' })
}

function mapStatus(abstract, detailed) {
  if (abstract === 'Final') return 'final'
  if (abstract === 'Live') return 'active'
  if (detailed?.toLowerCase().includes('postpone')) return 'postponed'
  return 'scheduled'
}
