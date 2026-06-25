import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../supabaseClient.js'

export default function Leaderboard() {
  const [season, setSeason] = useState([])
  const [recentGames, setRecentGames] = useState([])
  const [loading, setLoading] = useState(true)
  const myId = localStorage.getItem('cys_user_id')

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    const [s, g, u] = await Promise.all([
      supabase.from('scores').select('user_id, points_earned, game_id'),
      supabase.from('games').select('id, game_date, opponent, home_away, status').eq('status', 'final').order('game_date', { ascending: false }).limit(10),
      supabase.from('users').select('id, nickname'),
    ])

    const users = u.data || []
    const userMap = {}
    users.forEach(u => { userMap[u.id] = u.nickname })

    // Aggregate season totals
    const totals = {}
    ;(s.data || []).forEach(row => {
      if (!totals[row.user_id]) totals[row.user_id] = { user_id: row.user_id, total: 0, games: 0 }
      totals[row.user_id].total += row.points_earned
      totals[row.user_id].games += 1
    })

    const sorted = Object.values(totals)
      .sort((a, b) => b.total - a.total)
      .map(row => ({ ...row, nickname: userMap[row.user_id] || 'Unknown' }))

    setSeason(sorted)
    setRecentGames(g.data || [])
    setLoading(false)
  }

  if (loading) {
    return <div className="page"><div className="loading-state"><div className="spinner" /><p>Loading leaderboard…</p></div></div>
  }

  return (
    <div className="page page--leaderboard">
      <div className="lb-header">
        <h1 className="page-title">Season Leaderboard</h1>
        <p className="lb-sub">2025 Dodgers Regular Season</p>
      </div>

      <div className="lb-table-wrap">
        {season.length === 0 ? (
          <div className="board-empty">No scores yet this season. Make some picks!</div>
        ) : (
          <table className="lb-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Player</th>
                <th>Games</th>
                <th>Total Pts</th>
                <th>Avg</th>
              </tr>
            </thead>
            <tbody>
              {season.map((row, i) => {
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : null
                const isMe = row.user_id === myId
                return (
                  <tr key={row.user_id} className={`lb-row ${isMe ? 'lb-row--me' : ''} ${i < 3 ? `lb-row--top${i + 1}` : ''}`}>
                    <td className="lb-rank">{medal || `#${i + 1}`}</td>
                    <td className="lb-name">
                      {row.nickname}
                      {isMe && <span className="you-badge">YOU</span>}
                    </td>
                    <td className="lb-games">{row.games}</td>
                    <td className="lb-pts">{row.total}</td>
                    <td className="lb-avg">{(row.total / row.games).toFixed(1)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {recentGames.length > 0 && (
        <div className="recent-games">
          <h2 className="section-title">Recent Games</h2>
          <div className="recent-list">
            {recentGames.map(game => (
              <Link key={game.id} to={`/results/${game.id}`} className="recent-game-link">
                <span className="recent-date">{game.game_date}</span>
                <span className="recent-matchup">
                  LAD {game.home_away === 'home' ? 'vs' : '@'} {game.opponent}
                </span>
                <span className="recent-arrow">→</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
