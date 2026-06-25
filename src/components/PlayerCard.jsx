export default function PlayerCard({ player, selected, onSelect, disabled }) {
  return (
    <button
      className={`player-card ${selected ? 'player-card--selected' : ''} ${disabled ? 'player-card--disabled' : ''}`}
      onClick={() => !disabled && onSelect(player)}
      disabled={disabled}
      aria-pressed={selected}
    >
      <div className="player-card-number">#{player.jersey_number || '—'}</div>
      <div className="player-card-name">{player.player_name}</div>
      {player.position && (
        <div className="player-card-pos">{player.position}</div>
      )}
      {selected && <div className="player-card-check">✓</div>}
    </button>
  )
}
