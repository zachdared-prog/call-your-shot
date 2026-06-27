import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { realtime: { transport: ws } }
)

export default async function handler(req, context) {
  const url = new URL(req.url)
  const gameId = url.searchParams.get('gameId')

  if (!gameId) return Response.json({ error: 'gameId required' }, { status: 400 })

  try {
    const [hrsResult, picksResult] = await Promise.all([
      supabase.from('home_runs').select('*').eq('game_id', gameId).order('hr_number_in_game'),
      supabase.from('picks').select('*').eq('game_id', gameId),
    ])

    const homeRuns = hrsResult.data || []
    const picks = picksResult.data || []

    if (picks.length === 0) return Response.json({ message: 'No picks to score' })

    const firstHR = homeRuns.find(hr => hr.is_first_of_game)

    const scoreRows = picks.map(pick => {
      let points = 0
      const breakdown = {}

      if (firstHR && pick.player_id === firstHR.player_id) {
        points += 5
        breakdown.first_hr = 5
      }

      // Additional HRs by picked player after the first
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

    if (error) return Response.json({ error: error.message }, { status: 500 })

    return Response.json({ scored: scoreRows.length })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
