import type { DbPlayer } from '~~/server/db/schema';
import type { PlayerResponse } from '~~/shared/api';
import { mapTimestamps } from '~~/server/utils/mapTimestamps';

export function mapPlayerToResponse(player: DbPlayer): PlayerResponse {
	const {
		externalStatus: _externalStatus,
		isActive: _isActive,
		lastSeenAt: _lastSeenAt,
		...publicPlayer
	} = player;
	return mapTimestamps(publicPlayer);
}
