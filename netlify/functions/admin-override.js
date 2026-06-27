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
        // Calculate final scores
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
