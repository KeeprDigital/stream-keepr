import type { DbEventTalent } from '~~/server/db/schema';
import type { CreateTalentInput, UpdateTalentInput } from '~~/shared/api';
import type { SocialProfiles } from '~~/shared/socialProfiles';
import { and, eq } from 'drizzle-orm';
import { db } from 'hub:db';
import { eventTalents } from '~~/server/db/schema';

export function talentService() {
	const socialProfileColumns = (socialProfiles: SocialProfiles) => ({
		twitchHandle: socialProfiles.twitch ?? null,
		youtubeHandle: socialProfiles.youtube ?? null,
		xHandle: socialProfiles.x ?? null,
		instagramHandle: socialProfiles.instagram ?? null,
		tiktokHandle: socialProfiles.tiktok ?? null,
		blueskyHandle: socialProfiles.bluesky ?? null,
	});

	const findById = async (id: number, eventId: number) => {
		return await db.query.eventTalents.findFirst({
			where: and(
				eq(eventTalents.id, id),
				eq(eventTalents.eventId, eventId),
			),
		});
	};

	const findByEventId = async (eventId: number) => {
		return await db
			.select()
			.from(eventTalents)
			.where(eq(eventTalents.eventId, eventId));
	};

	const create = async (
		eventId: number,
		data: CreateTalentInput,
	): Promise<DbEventTalent> => {
		const { socialProfiles, ...fields } = data;
		const [newTalent] = await db
			.insert(eventTalents)
			.values({
				...fields,
				...(socialProfiles === undefined ? {} : socialProfileColumns(socialProfiles)),
				eventId,
			})
			.returning();

		if (!newTalent) {
			throw new Error('Failed to create talent');
		}

		return newTalent;
	};

	const update = async (
		id: number,
		eventId: number,
		data: UpdateTalentInput,
	): Promise<DbEventTalent | undefined> => {
		const { socialProfiles, ...fields } = data;
		const [updatedTalent] = await db
			.update(eventTalents)
			.set({
				...fields,
				...(socialProfiles === undefined ? {} : socialProfileColumns(socialProfiles)),
			})
			.where(
				and(
					eq(eventTalents.id, id),
					eq(eventTalents.eventId, eventId),
				),
			)
			.returning();

		return updatedTalent;
	};

	const remove = async (id: number, eventId: number): Promise<boolean> => {
		const result = await db
			.delete(eventTalents)
			.where(
				and(
					eq(eventTalents.id, id),
					eq(eventTalents.eventId, eventId),
				),
			)
			.returning();

		return result.length > 0;
	};

	return {
		findById,
		findByEventId,
		create,
		update,
		remove,
	};
}
