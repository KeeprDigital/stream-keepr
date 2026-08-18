import type { DbEventTalent } from '~~/server/db/schema';
import type { TalentResponse } from '~~/shared/api';
import { mapTimestamps } from '~~/server/utils/mapTimestamps';

export function mapTalentToResponse(talent: DbEventTalent): TalentResponse {
	const {
		twitchHandle,
		youtubeHandle,
		xHandle,
		instagramHandle,
		tiktokHandle,
		blueskyHandle,
		...fields
	} = talent;

	return {
		...mapTimestamps(fields),
		socialProfiles: Object.fromEntries([
			['twitch', twitchHandle],
			['youtube', youtubeHandle],
			['x', xHandle],
			['instagram', instagramHandle],
			['tiktok', tiktokHandle],
			['bluesky', blueskyHandle],
		].filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0)),
	};
}
