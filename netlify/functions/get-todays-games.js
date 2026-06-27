import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const MLB_BASE = 'https://statsapi.mlb.com/api'
const DODGERS_ID = 119

export default async function handler(req, context) {
  const today = new Date().toISOString().slice(0, 10)

  try {
    const res = await fetch(
      `${MLB_BASE}/v1/schedule?teamId=${DODGERS_ID}&sportId=1&date=${today}&gameType=R&hydrate=team`
    )
    const data = await res.json()

    const dates = data.dates || []
    const games = []

    for (const date of dates) {
      for (const game of (date.games || [])) {
        const dodgersTeam =
          game.teams.home.team.id === DODGERS_ID ? game.teams.home :
          game.teams.away.team.id === DODGERS_ID ? game.teams.away : null

        if (!dodgersTeam) continue

        const isHome = game.teams.home.team.id === DODGERS_ID
        const opponent = isHome
          ? game.teams.away.team.abbreviation
          : game.teams.home.team.abbreviation

        const status = mapStatus(game.status.abstractGameState, game.status.detailedState)
        const gameNumber = game.gameNumber || 1

        const row = {
          game_pk: game.gamePk,
          game_date: today,
          opponent,
          home_away: isHome ? 'home' : 'away',
          status,
          first_pitch_time: game.gameDate || null,
          game_number: gameNumber,
        }

        const { data: upserted, error } = await supabase
          .from('games')
          .upsert(row, { onConflict: 'game_pk' })
          .select()
          .single()

        if (!error && upserted) games.push(upserted)
      }
    }

    // If no games found from MLB API, check DB
    if (games.length === 0) {
      const { data: dbGames } = await supabase
        .from('games')
        .select('*')
        .eq('game_date', today)
        .order('first_pitch_time')
      return Response.json({ games: dbGames || [] })
    }

    return Response.json({ games })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

function mapStatus(abstract, detailed) {
  if (abstract === 'Final') return 'final'
  if (abstract === 'Live') return 'active'
  if (detailed?.toLowerCase().includes('postpone')) return 'postponed'
  return 'scheduled'
}
