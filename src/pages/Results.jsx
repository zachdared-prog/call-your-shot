import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../supabaseClient.js'

export default function Results() {
  const { gameId } = useParams()
  const [game, setGame] = useState(null)
  const [picks, setPicks] = useState([])
  const [homeRuns, setHomeRuns] = useState([])
  const [scores, setScores] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadAll() }, [gameId])

  async function loadAll() {
    const [g, p, hr, s, u] = await Promise.all([
      supabase.from('games').select('*').eq('id', gameId).single(),
      supabase.from('picks').select('*').eq('game_id', gameId),
      supabase.from('home_runs').select('*').eq('game_id', gameId).order('hr_number_in_game'),
      supabase.from('scores').select('*').eq('game_id', gameId).order('points_earned', { ascending: false }),
      supabase.from('users').select('id, nickname'),
    ])
    setGame(g.data)
    setPicks(p.data || [])
    setHomeRuns(hr.data || [])
    setScores(s.data || [])
    setUsers(u.data || [])
    setLoading(false)
  }

  if (loading) {
    return <div className="page"><div className="loading-state"><div className="spinner" /><p>Loading results…</p></div></div>
  }

  if (!game) return <div className="page"><div className="error-banner">Game not found.</div></div>

  const userMap = {}
  users.forEach(u => { userMap[u.id] = u.nickname })

  const pickMap = {}
  picks.forEach(p => { pickMap[p.user_id] = p })

  const firstHR = homeRuns.find(hr => hr.is_first_of_game)
  const myId = localStorage.getItem('cys_user_id')

  return (
    <div className="page page--results">
      <div className="results-header">
        <h1 className="page-title">Game Results</h1>
        <div className="results-matchup">
          LAD {game.home_away === 'home' ? 'vs' : '@'} {game.opponent}
          <span className="results-status">Final</span>
        </div>
      </div>

      {firstHR ? (
        <div className="first-hr-banner">
          <div className="first-hr-label">First Home Run</div>
          <div className="first-hr-player">{firstHR.player_name}</div>
          <div className="first-hr-inning">Inning {firstHR.inning}</div>
        </div>
      ) : (
        <div className="no-hr-banner">No home runs in this game — everyone scores 0</div>
      )}

      {homeRuns.length > 1 && (
        <div className="all-hrs">
          <h3>All Home Runs</h3>
          <div className="hr-chips">
            {homeRuns.map(hr => (
              <div key={hr.id} className="hr-chip">
                <strong>{hr.player_name}</strong> — Inning {hr.inning}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="results-scoreboard">
        <h2 className="scoreboard-title">Scoreboard</h2>
        <div className="scoreboard-list">
          {scores.length === 0 && picks.length === 0 && (
            <p className="board-empty">No picks were submitted for this game.</p>
          )}
          {scores.map((score, i) => {
            const pick = pickMap[score.user_id]
            const isMe = score.user_id === myId
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : null
            return (
              <div key={score.id} className={`score-row ${isMe ? 'score-row--me' : ''}`}>
                <div className="score-rank">{medal || `#${i + 1}`}</div>
                <div className="score-info">
                  <span className="score-nickname">
                    {userMap[score.user_id] || '?'}
                    {isMe && <span className="you-badge">YOU</span>}
                  </span>
                  <span className="score-pick">Picked: {pick?.player_name || '—'}</span>
                </div>
                <div className="score-pts">{score.points_earned} pts</div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="results-footer">
        <Link to="/" className="btn btn--outline">Back to Home</Link>
        <Link to="/leaderboard" className="btn btn--primary">Season Leaderboard</Link>
      </div>
    </div>
  )
}
