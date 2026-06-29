import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { realtime: { transport: ws } }
)

export default async function handler(req, context) {
  if (req.method !== 'POST') {
    return Response.json({ error: 'POST only' }, { status: 405 })
  }

  const secret = req.headers.get('x-admin-secret')
  if (secret !== process.env.ADMIN_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { action, game_id, game_pk, player_id, player_name, inning } = body

  try {
    switch (action) {
      case 'start_game': {
        await supabase
          .from('games')
          .update({ status: 'active', lineup_locked: true })
          .eq('id', game_id)
        await supabase
          .from('picks')
          .update({ is_visible: true })
          .eq('game_id', game_id)
        const { data: game } = await supabase.from('games').select('*').eq('id', game_id).single()
        return Response.json({ message: 'Game started, picks revealed.', game })
      }

      case 'postpone_game': {
        await supabase.from('games').update({ status: 'postponed' }).eq('id', game_id)
        await supabase.from('picks').delete().eq('game_id', game_id)
        const { data: game } = await supabase.from('games').select('*').eq('id', game_id).single()
        return Response.json({ message: 'Game postponed. Picks voided.', game })
      }

      case 'finalize_game': {
        await supabase.from('games').update({ status: 'final' }).eq('id', game_id)
        const base = getBaseUrl(req)
        await fetch(`${base}/calculate-scores?gameId=${game_id}`)
        const { data: game } = await supabase.from('games').select('*').eq('id', game_id).single()
        return Response.json({ message: 'Game marked final. Scores calculated.', game })
      }

      case 'add_hr': {
        if (!player_id || !player_name || !inning) {
          return Response.json({ error: 'player_id, player_name, inning required' }, { status: 400 })
        }

        const { data: existing } = await supabase
          .from('home_runs')
          .select('hr_number_in_game')
          .eq('game_id', game_id)
          .order('hr_number_in_game', { ascending: false })
          .limit(1)

        const nextNumber = existing?.length ? (existing[0].hr_number_in_game + 1) : 1
        const isFirst = nextNumber === 1

        await supabase.from('home_runs').insert({
          game_id,
          player_id: parseInt(player_id),
          player_name,
          inning: parseInt(inning),
          hr_number_in_game: nextNumber,
          is_first_of_game: isFirst,
          detected_at: new Date().toISOString(),
        })

        const base = getBaseUrl(req)
        await fetch(`${base}/calculate-scores?gameId=${game_id}`)

        return Response.json({ message: `HR #${nextNumber} added for ${player_name}.` })
      }

      case 'recalculate': {
        const base = getBaseUrl(req)
        await fetch(`${base}/calculate-scores?gameId=${game_id}`)
        return Response.json({ message: 'Scores recalculated.' })
      }

      case 'reset_game': {
        await supabase
          .from('games')
          .update({ status: 'scheduled', lineup_locked: false })
          .eq('id', game_id)
        await supabase.from('picks').update({ is_visible: false }).eq('game_id', game_id)
        const { data: game } = await supabase.from('games').select('*').eq('id', game_id).single()
        return Response.json({ message: 'Game reset to scheduled. Picks hidden again.', game })
      }

      case 'sync_game': {
        const MLB_BASE = 'https://statsapi.mlb.com/api'
        const DODGERS_ID = 119
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())

        const mlbRes = await fetch(
          `${MLB_BASE}/v1/schedule?teamId=${DODGERS_ID}&sportId=1&date=${today}&gameType=R&hydrate=team`
        )
        const mlbData = await mlbRes.json()
        const dates = mlbData.dates || []
        const synced = []

        for (const d of dates) {
          for (const g of (d.games || [])) {
            const isHome = g.teams.home.team.id === DODGERS_ID
            const isDodgersGame = isHome || g.teams.away.team.id === DODGERS_ID
            if (!isDodgersGame) continue

            const opponent = isHome
              ? g.teams.away.team.abbreviation
              : g.teams.home.team.abbreviation

            const status =
              g.status.abstractGameState === 'Final' ? 'final' :
              g.status.abstractGameState === 'Live' ? 'active' :
              g.status.detailedState?.toLowerCase().includes('postpone') ? 'postponed' :
              'scheduled'

            const row = {
              game_pk: g.gamePk,
              game_date: today,
              opponent,
              home_away: isHome ? 'home' : 'away',
              status,
              first_pitch_time: g.gameDate || null,
              game_number: g.gameNumber || 1,
              lineup_locked: false,
            }

            const { data: upserted, error: upsertErr } = await supabase
              .from('games')
              .upsert(row, { onConflict: 'game_pk' })
              .select()
              .single()

            if (upsertErr) return Response.json({ error: `Supabase upsert failed: ${upsertErr.message}` }, { status: 500 })
            synced.push(upserted)
          }
        }

        if (!synced.length) return Response.json({ error: 'No Dodgers game found in MLB schedule for today.' }, { status: 404 })
        return Response.json({ message: `Synced ${synced.length} game(s).`, games: synced })
      }

      default:
        return Response.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

function getBaseUrl(req) {
  const url = new URL(req.url)
  return `${url.protocol}//${url.host}/.netlify/functions`
}
