import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { realtime: { transport: ws } }
)

const MLB_BASE = 'https://statsapi.mlb.com/api'
const DODGERS_ID = 119

function getPacificDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())
}

export default async function handler(req, context) {
  const today = getPacificDate()
  const debug = new URL(req.url).searchParams.get('debug') === '1'

  try {
    const res = await fetch(
      `${MLB_BASE}/v1/schedule?teamId=${DODGERS_ID}&sportId=1&date=${today}&gameType=R&hydrate=team`
    )
    const data = await res.json()

    const dates = data.dates || []
    const games = []
    const errors = []

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

        if (error) {
          errors.push({ game_pk: game.gamePk, error: error.message, code: error.code })
        } else if (upserted) {
          games.push(upserted)
        }
      }
    }

    if (debug && errors.length) {
      return Response.json({ games, errors, env_check: {
        has_url: !!process.env.VITE_SUPABASE_URL,
        has_service_key: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      }})
    }

    // If no games upserted, check DB
    if (games.length === 0) {
      const { data: dbGames, error: dbError } = await supabase
        .from('games')
        .select('*')
        .eq('game_date', today)
        .order('first_pitch_time')

      if (debug) {
        return Response.json({ games: dbGames || [], db_error: dbError?.message, errors, env_check: {
          has_url: !!process.env.VITE_SUPABASE_URL,
          has_service_key: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
        }})
      }

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
