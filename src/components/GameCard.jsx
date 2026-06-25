import { Link } from 'react-router-dom'

function formatTime(ts) {
  if (!ts) return 'TBD'
  const d = new Date(ts)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
}

function statusLabel(status) {
  switch (status) {
    case 'scheduled': return 'Upcoming'
    case 'active': return '🔴 LIVE'
    case 'final': return 'Final'
    case 'postponed': return 'Postponed'
    default: return status
  }
}

export default function GameCard({ game, userPick, hasPick }) {
  const isLocked = game.lineup_locked
  const isActive = game.status === 'active'
  const isFinal = game.status === 'final'
  const isPostponed = game.status === 'postponed'

  const homeAway = game.home_away === 'home' ? 'vs' : '@'
  const gameLabel = game.game_number > 1 ? ` (Game ${game.game_number})` : ''

  return (
    <div className={`game-card game-card--${game.status}`}>
      <div className="game-card-header">
        <span className="game-matchup">
          LAD {homeAway} {game.opponent}{gameLabel}
        </span>
        <span className={`game-status-badge status--${game.status}`}>
          {statusLabel(game.status)}
        </span>
      </div>

      <div className="game-card-time">
        <span className="time-label">First Pitch</span>
        <span className="time-value">{formatTime(game.first_pitch_time)}</span>
      </div>

      {isPostponed && (
        <div className="game-card-message postponed">
          Game postponed. Any picks have been voided.
        </div>
      )}

      {!isPostponed && (
        <div className="game-card-actions">
          {isActive && (
            <Link to={`/live/${game.id}`} className="btn btn--live">
              Watch Live Feed
            </Link>
          )}
          {isFinal && (
            <Link to={`/results/${game.id}`} className="btn btn--results">
              View Results
            </Link>
          )}
          {game.status === 'scheduled' && (
            <>
              {hasPick ? (
                <div className="pick-submitted">
                  <span className="pick-check">✓</span>
                  Pick submitted: <strong>{userPick?.player_name}</strong>
                  {!isLocked && (
                    <Link to={`/pick/${game.id}`} className="btn btn--sm btn--outline">
                      Change
                    </Link>
                  )}
                </div>
              ) : isLocked ? (
                <div className="game-card-message locked">
                  🔒 Picks are locked
                </div>
              ) : (
                <Link to={`/pick/${game.id}`} className="btn btn--primary">
                  Make Your Pick
                </Link>
              )}
            </>
          )}
          {game.status === 'scheduled' && hasPick && isLocked && (
            <div className="game-card-message locked">
              🔒 Picks locked — good luck!
            </div>
          )}
        </div>
      )}
    </div>
  )
}
