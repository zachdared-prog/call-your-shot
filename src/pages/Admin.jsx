import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient.js'

const ADMIN_SECRET = import.meta.env.VITE_ADMIN_SECRET || ''

export default function Admin() {
  const [authed, setAuthed] = useState(false)
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')

  const [games, setGames] = useState([])
  const [selectedGame, setSelectedGame] = useState(null)
  const [picks, setPicks] = useState([])
  const [users, setUsers] = useState([])
  const [homeRuns, setHomeRuns] = useState([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState(null)

  // HR form
  const [hrPlayerId, setHrPlayerId] = useState('')
  const [hrPlayerName, setHrPlayerName] = useState('')
  const [hrInning, setHrInning] = useState('')

  useEffect(() => {
    const stored = sessionStorage.getItem('cys_admin')
    if (stored === 'true') setAuthed(true)
  }, [])

  function handleLogin(e) {
    e.preventDefault()
    // Compare against env var — client-side is acceptable per spec for this small trusted group
    if (password === ADMIN_SECRET) {
      setAuthed(true)
      sessionStorage.setItem('cys_admin', 'true')
    } else {
      setAuthError('Incorrect password.')
    }
  }

  useEffect(() => {
    if (authed) loadGames()
  }, [authed])

  async function loadGames() {
    setLoading(true)
    const today = new Date().toISOString().slice(0, 10)
    const { data } = await supabase
      .from('games')
      .select('*')
      .gte('game_date', today)
      .order('game_date')
      .limit(14)
    setGames(data || [])
    setLoading(false)
  }

  async function selectGame(game) {
    setSelectedGame(game)
    setMessage(null)
    const [p, u, hr] = await Promise.all([
      supabase.from('picks').select('*').eq('game_id', game.id),
      supabase.from('users').select('id, nickname'),
      supabase.from('home_runs').select('*').eq('game_id', game.id).order('hr_number_in_game'),
    ])
    setPicks(p.data || [])
    setHomeRuns(hr.data || [])
    const userMap = {}
    ;(u.data || []).forEach(u => { userMap[u.id] = u.nickname })
    setUsers(userMap)
  }

  async function callOverride(action, extra = {}) {
    setMessage(null)
    const res = await fetch('/.netlify/functions/admin-override', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-secret': ADMIN_SECRET,
      },
      body: JSON.stringify({ action, game_id: selectedGame?.id, game_pk: selectedGame?.game_pk, ...extra }),
    })
    const data = await res.json()
    if (res.ok) {
      setMessage({ type: 'success', text: data.message || 'Done.' })
      await loadGames()
      if (selectedGame) await selectGame({ ...selectedGame, ...data.game })
    } else {
      setMessage({ type: 'error', text: data.error || 'Error.' })
    }
  }

  async function handleAddHR(e) {
    e.preventDefault()
    if (!hrPlayerId || !hrPlayerName || !hrInning) return
    await callOverride('add_hr', {
      player_id: parseInt(hrPlayerId),
      player_name: hrPlayerName,
      inning: parseInt(hrInning),
    })
    setHrPlayerId('')
    setHrPlayerName('')
    setHrInning('')
  }

  if (!authed) {
    return (
      <div className="page page--admin">
        <div className="admin-login">
          <h1 className="page-title">Admin</h1>
          <form onSubmit={handleLogin} className="admin-login-form">
            <input
              type="password"
              className="form-input"
              placeholder="Admin password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoFocus
            />
            {authError && <div className="error-banner">{authError}</div>}
            <button type="submit" className="btn btn--primary">Sign In</button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="page page--admin">
      <h1 className="page-title">Admin Panel</h1>

      {message && (
        <div className={`admin-message admin-message--${message.type}`}>{message.text}</div>
      )}

      <div className="admin-grid">
        <div className="admin-games-list">
          <h2 className="section-title">Upcoming / Recent Games</h2>
          {loading ? <div className="spinner" /> : (
            <div className="admin-game-items">
              {games.map(g => (
                <button
                  key={g.id}
                  className={`admin-game-btn ${selectedGame?.id === g.id ? 'admin-game-btn--active' : ''}`}
                  onClick={() => selectGame(g)}
                >
                  <span>{g.game_date}</span>
                  <span>LAD {g.home_away === 'home' ? 'vs' : '@'} {g.opponent}</span>
                  <span className={`status-pill status--${g.status}`}>{g.status}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {selectedGame && (
          <div className="admin-game-detail">
            <h2 className="section-title">
              {selectedGame.game_date} — LAD {selectedGame.home_away === 'home' ? 'vs' : '@'} {selectedGame.opponent}
              <span className={`status-pill status--${selectedGame.status}`}>{selectedGame.status}</span>
            </h2>

            <div className="admin-actions">
              <h3>Game Controls</h3>
              <div className="admin-btn-row">
                <button className="btn btn--live" onClick={() => callOverride('start_game')}>
                  ▶ Mark as Started
                </button>
                <button className="btn btn--outline" onClick={() => callOverride('postpone_game')}>
                  🚫 Mark Postponed
                </button>
                <button className="btn btn--results" onClick={() => callOverride('finalize_game')}>
                  ✓ Mark as Final
                </button>
                <button className="btn btn--ghost" onClick={() => callOverride('recalculate')}>
                  ↻ Recalculate Scores
                </button>
                <button className="btn btn--outline" onClick={() => callOverride('reset_game')}>
                  ⏪ Reset to Scheduled
                </button>
              </div>
            </div>

            <div className="admin-add-hr">
              <h3>Add Home Run Manually</h3>
              <form onSubmit={handleAddHR} className="hr-form">
                <input className="form-input" placeholder="Player ID (MLB)" value={hrPlayerId} onChange={e => setHrPlayerId(e.target.value)} />
                <input className="form-input" placeholder="Player Name" value={hrPlayerName} onChange={e => setHrPlayerName(e.target.value)} />
                <input className="form-input" placeholder="Inning" type="number" value={hrInning} onChange={e => setHrInning(e.target.value)} />
                <button type="submit" className="btn btn--primary">Add HR</button>
              </form>
            </div>

            <div className="admin-hr-list">
              <h3>Home Runs ({homeRuns.length})</h3>
              {homeRuns.length === 0 ? <p>None recorded.</p> : (
                <div className="hr-chips">
                  {homeRuns.map(hr => (
                    <div key={hr.id} className="hr-chip">
                      {hr.is_first_of_game && '💥 '}{hr.player_name} — Inning {hr.inning}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="admin-picks-list">
              <h3>All Picks ({picks.length})</h3>
              {picks.length === 0 ? <p>No picks yet.</p> : (
                <table className="admin-picks-table">
                  <thead>
                    <tr><th>Nickname</th><th>Pick</th><th>Visible</th><th>Submitted</th></tr>
                  </thead>
                  <tbody>
                    {picks.map(p => (
                      <tr key={p.id}>
                        <td>{users[p.user_id] || p.user_id.slice(0, 8)}</td>
                        <td>{p.player_name}</td>
                        <td>{p.is_visible ? '✓' : '—'}</td>
                        <td>{new Date(p.submitted_at).toLocaleTimeString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
