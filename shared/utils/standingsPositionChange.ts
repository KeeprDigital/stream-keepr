/**
 * How far a Player moved in the standings since the previous Round's Round
 * Standings (#755): derived from stored positions, never imported.
 *
 * - `up` / `down`: places climbed or dropped.
 * - `unchanged`: the same position as the previous Round.
 * - `new`: absent from the previous Round's Round Standings.
 * - `none`: nothing to compare, because there is no previous Round or a
 *   position is missing on either side.
 */
export type PositionChange
	= | { kind: 'up'; by: number }
		| { kind: 'down'; by: number }
		| { kind: 'unchanged' }
		| { kind: 'new' }
		| { kind: 'none' };

/** Each Player's position in the previous Round's Round Standings, by Player id. */
export type PreviousRoundPositionMap = ReadonlyMap<number, number | null>;

export function positionChange(
	playerId: number,
	position: number | null,
	previousRound: PreviousRoundPositionMap | null,
): PositionChange {
	if (!previousRound || position == null)
		return { kind: 'none' };
	if (!previousRound.has(playerId))
		return { kind: 'new' };

	const previous = previousRound.get(playerId);
	if (previous == null)
		return { kind: 'none' };

	const climbed = previous - position;
	if (climbed > 0)
		return { kind: 'up', by: climbed };
	if (climbed < 0)
		return { kind: 'down', by: -climbed };
	return { kind: 'unchanged' };
}

export function formatPositionChange(change: PositionChange): string {
	switch (change.kind) {
		case 'up':
			return `▲${change.by}`;
		case 'down':
			return `▼${change.by}`;
		case 'new':
			return 'new';
		case 'unchanged':
		case 'none':
			return '–';
	}
}
