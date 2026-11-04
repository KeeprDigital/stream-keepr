import type { TalentModeConfig } from '~~/shared/types/screenConfig';
import type { ScreenOutputTalentResponse } from '~~/shared/types/screenOutputReads';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '~~/server/db';
import { eventTalents } from '~~/server/db/schema';
import { mapTalentToResponse } from '~~/server/mappers/talent';
import { talentScreenTalentIds } from '~~/shared/screenModeConfigs/talent';
import { socialProfileValues } from '~~/shared/socialProfiles';

/**
 * The Talents a Talent Screen shows (#782), in its order, each with only what
 * the Screen shows of it: its Social Profiles on the chosen networks, and its
 * photo only while the Screen shows photos, so the answer names no revision the
 * Screen Output Asset Capability refuses (ADR-0070).
 */
export async function findTalentScreen(eventId: number, config: TalentModeConfig): Promise<ScreenOutputTalentResponse> {
	const ids = talentScreenTalentIds(config);
	if (ids.length === 0)
		return { talents: [] };

	const rows = await db
		.select()
		.from(eventTalents)
		.where(and(eq(eventTalents.eventId, eventId), inArray(eventTalents.id, ids)));
	const byId = new Map(rows.map(row => [
		row.id,
		mapTalentToResponse(row),
	]));

	return {
		talents: ids.flatMap((id) => {
			const talent = byId.get(id);
			return talent
				? [
						{
							id: talent.id,
							name: talent.name,
							role: talent.role,
							photo: config.showPhoto
								? talent.photo
								: null,
							socialProfiles: socialProfileValues(talent.socialProfiles, config.socialNetworks),
						},
					]
				: [];
		}),
	};
}
