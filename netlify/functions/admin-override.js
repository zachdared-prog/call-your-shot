import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { realtime: { transport: ws } }
)

async function calculateScores(gameId) {
  const [hrsResult, picksResult] = await Promise.all([
    supabase.from('home_runs').select('*').eq('game_id', gameId).order('hr_number_in_game'),
    supabase.from('picks').select('*').eq('game_id', gameId),
  ])

  const homeRuns = hrsResult.data || []
  const picks = picksResult.data || []

  if (!picks.length) return { picks: 0, hrs: homeRuns.length, scored: 0, note: 'no picks in this game' }

  const firstHR = homeRuns.find(hr => hr.is_first_of_game)

  const scoreRows = picks.map(pick => {
    let points = 0
    const breakdown = {}

    if (firstHR && pick.player_id === firstHR.player_id) {
      points += 5
      breakdown.first_hr = 5
    }

    const additionalHRs = homeRuns.filter(
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

  const { error } = await supabase
    .from('scores')
    .upsert(scoreRows, { onConflict: 'user_id,game_id' })

  if (error) return { picks: picks.length, hrs: homeRuns.length, scored: 0, error: error.message }

  const withPoints = scoreRows.filter(r => r.points_earned > 0).length
  return { picks: picks.length, hrs: homeRuns.length, scored: scoreRows.length, withPoints }
}

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
        const result = await calculateScores(game_id)
        const { data: game } = await supabase.from('games').select('*').eq('id', game_id).single()
        return Response.json({ message: `Game marked final. Scored ${result.scored} pick(s) (${result.withPoints ?? 0} with points).`, game })
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

        const result = await calculateScores(game_id)
        return Response.json({ message: `HR #${nextNumber} added for ${player_name}. Scored ${result.scored} pick(s).` })
      }

      case 'recalculate': {
        const result = await calculateScores(game_id)
        if (result.error) {
          return Response.json({ error: `Score calc failed: ${result.error}` }, { status: 500 })
        }
        return Response.json({
          message: `Recalculated: ${result.picks} pick(s), ${result.hrs} HR(s), ${result.withPoints ?? 0} pick(s) scored points. ${result.note || ''}`.trim()
        })
      }

      case 'pull_todays_hrs': {
        const { data: targetGame } = await supabase.from('games').select('*').eq('id', game_id).single()
        if (!targetGame) return Response.json({ error: 'Game not found' }, { status: 404 })

        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
        const { data: others } = await supabase
          .from('games').select('id, game_pk, game_date, status')
          .eq('opponent', targetGame.opponent)
          .neq('id', game_id)
          .gte('game_date', since)

        let hrsMoved = 0
        let newGamePk = targetGame.game_pk

        for (const other of (others || [])) {
          const { data: hrs } = await supabase.from('home_runs').select('id').eq('game_id', other.id)
          if (!hrs?.length) continue
          await supabase.from('home_runs').update({ game_id }).eq('game_id', other.id)
          hrsMoved += hrs.length
          if (other.game_date >= targetGame.game_date) newGamePk = other.game_pk
          await supabase.from('games').update({ status: 'postponed' }).eq('id', other.id)
        }

        await supabase.from('games').update({
          game_pk: newGamePk, status: 'active', lineup_locked: true,
        }).eq('id', game_id)
        await supabase.from('picks').update({ is_visible: true }).eq('game_id', game_id)

        const result = await calculateScores(game_id)
        const { data: game } = await supabase.from('games').select('*').eq('id', game_id).single()
        return Response.json({
          message: `Moved ${hrsMoved} HR(s) into this game. Scored ${result.scored} pick(s) (${result.withPoints ?? 0} with points).`,
          game
        })
      }

      case 'move_picks_here': {
        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
        const { data: otherGames } = await supabase
          .from('games').select('id').neq('id', game_id).gte('game_date', since)
        const otherIds = (otherGames || []).map(g => g.id)

        if (!otherIds.length) return Response.json({ message: 'No other recent games found.' })

        const { data: picksToMove } = await supabase
          .from('picks').select('id, user_id').in('game_id', otherIds)

        if (!picksToMove?.length) return Response.json({ message: 'No picks found in other games.' })

        // Delete any conflicting picks already in target game to avoid unique (user_id, game_id) violations
        const movingUserIds = picksToMove.map(p => p.user_id)
        await supabase.from('picks')
          .delete()
          .eq('game_id', game_id)
          .in('user_id', movingUserIds)

        const { error: updateErr } = await supabase
          .from('picks').update({ game_id, is_visible: true }).in('game_id', otherIds)

        if (updateErr) {
          return Response.json({ error: `Failed to move picks: ${updateErr.message}` }, { status: 500 })
        }

        await supabase.from('games')
          .update({ status: 'active', lineup_locked: true }).eq('id', game_id)

        const result = await calculateScores(game_id)
        const { data: game } = await supabase.from('games').select('*').eq('id', game_id).single()
        return Response.json({
          message: `Moved ${picksToMove.length} pick(s) here. Scored ${result.scored} pick(s), ${result.withPoints ?? 0} with points. ${result.note || ''}`.trim(),
          game
        })
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
