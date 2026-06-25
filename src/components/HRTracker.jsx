export default function HRTracker({ homeRuns, picks, users }) {
  const firstHR = homeRuns.find(hr => hr.is_first_of_game)

  const userMap = {}
  users?.forEach(u => { userMap[u.id] = u.nickname })

  const picksByPlayer = {}
  picks?.forEach(p => {
    if (!picksByPlayer[p.player_id]) picksByPlayer[p.player_id] = []
    picksByPlayer[p.player_id].push(p)
  })

  return (
    <div className="hr-tracker">
      <div className="hr-tracker-header">
        <span className="scoreboard-label">HOME RUN TRACKER</span>
      </div>

      {homeRuns.length === 0 ? (
        <div className="hr-tracker-empty">
          <span className="hr-waiting">⚾ Waiting for first home run…</span>
        </div>
      ) : (
        <div className="hr-list">
          {homeRuns.map((hr, i) => {
            const isFirst = hr.is_first_of_game
            const winners = picksByPlayer[hr.player_id] || []
            return (
              <div key={hr.id} className={`hr-item ${isFirst ? 'hr-item--first' : ''}`}>
                <div className="hr-item-inner">
                  <div className="hr-badge">{isFirst ? '💥 FIRST HR' : `HR #${hr.hr_number_in_game}`}</div>
                  <div className="hr-player">{hr.player_name}</div>
                  <div className="hr-inning">Inning {hr.inning}</div>
                  {winners.length > 0 && (
                    <div className="hr-winners">
                      🎉 {winners.map(p => userMap[p.user_id] || 'Unknown').join(', ')} picked this!
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
