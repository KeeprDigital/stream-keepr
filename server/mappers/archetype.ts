import type { DbArchetype } from '~~/server/db/schema';
import { mapTimestamps } from '~~/server/utils/mapTimestamps';

export function mapArchetypeToResponse(archetype: DbArchetype) {
	return mapTimestamps(archetype);
}
