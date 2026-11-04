import type { DbEventTalent } from '~~/server/db/schema';
import type { CreateTalentInput, UpdateTalentInput } from '~~/shared/api';
import type { SocialProfiles } from '~~/shared/socialProfiles';
import type { GraphicAssetReference } from '~~/shared/types/graphicsAsset';
import { and, eq } from 'drizzle-orm';
import { db } from '~~/server/db';
import { eventTalents } from '~~/server/db/schema';
import {
	boundGraphicAssetReferenceFacts,
	jsonElementGraphicAssetRevisionResolution,
	REQUIRED_GRAPHIC_ASSET_REFERENCES_RESOLVE,
} from '~~/server/modules/graphic-asset-reference-resolution';
import { TALENT_PHOTO_SLOT, TALENT_REFERENCE_OWNER_KIND } from '~~/shared/utils/graphicsAssetReferences';

/**
 * A photo write refused because the image revision it names stopped being
 * selectable before the commit (ADR-0034's fence, ADR-0067).
 */
export class TalentPhotoReferenceConflict extends Error {
	constructor() {
		super('The Graphic Asset Revision this photo names is not selectable');
		this.name = 'TalentPhotoReferenceConflict';
	}
}

/** The columns a photo write may set beside the photo, by their stored names. */
type TalentColumnValues = Record<string, string | null>;

function boundPhotoFacts(photo: GraphicAssetReference): string {
	return boundGraphicAssetReferenceFacts([
		{
			id: crypto.randomUUID(),
			ownerSlot: TALENT_PHOTO_SLOT,
			reference: { assetId: photo.assetId, revisionId: photo.revisionId },
			kind: 'image',
			allowRetired: false,
		},
	]);
}

/** Index the photo of the Talent row the write stamped with `version`, if it committed. */
const INSERT_PHOTO_REFERENCE = `
	INSERT INTO graphic_asset_references (
		id, asset_id, revision_id, owner_kind, owner_id, owner_slot,
		event_id, created_at, updated_at
	)
	SELECT
		json_extract(item.value, '$.id'),
		json_extract(item.value, '$.assetId'),
		json_extract(item.value, '$.revisionId'),
		'${TALENT_REFERENCE_OWNER_KIND}', CAST(talent.id AS TEXT), json_extract(item.value, '$.ownerSlot'),
		talent.event_id, ?, ?
	FROM json_each(?) AS item
	JOIN event_talents talent ON talent.graphic_asset_reference_version = ?
	WHERE EXISTS (
		SELECT 1
		${jsonElementGraphicAssetRevisionResolution('item')}
	)
`;

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

	/** The same columns by their stored names, for the photo write's own statements. */
	const storedColumns = (fields: { name?: string; socialProfiles?: SocialProfiles }): TalentColumnValues => {
		const values = {
			...(fields.name === undefined
				? {}
				: { name: fields.name }),
			...(fields.socialProfiles === undefined
				? {}
				: socialProfileColumns(fields.socialProfiles)),
		};
		return Object.fromEntries(Object.entries(values).map(([key, value]) => [
			eventTalents[key as keyof typeof values].name,
			value,
		]));
	};

	const findByReferenceVersion = async (version: string) => {
		return await db.query.eventTalents.findFirst({
			where: eq(eventTalents.graphicAssetReferenceVersion, version),
		});
	};

	/**
	 * Create a Talent with a photo and index it, in one commit: the row is
	 * inserted only while the photo resolves, and the reference only beside it.
	 */
	const createWithPhoto = async (
		eventId: number,
		data: CreateTalentInput,
		photo: GraphicAssetReference,
	): Promise<DbEventTalent> => {
		const version = crypto.randomUUID();
		const now = Date.now();
		const facts = boundPhotoFacts(photo);
		const columns = {
			...storedColumns(data),
			event_id: eventId,
			photo: JSON.stringify(photo),
			graphic_asset_reference_version: version,
			created_at: now,
			updated_at: now,
		};
		const names = Object.keys(columns);
		const client = db.$client;
		await client.batch([
			client.prepare(`
				INSERT INTO event_talents (${names.join(', ')})
				SELECT ${names.map(() => '?').join(', ')}
				WHERE 1 = 1
					${REQUIRED_GRAPHIC_ASSET_REFERENCES_RESOLVE}
			`).bind(...Object.values(columns), facts),
			client.prepare(INSERT_PHOTO_REFERENCE).bind(now, now, facts, version),
		]);
		const created = await findByReferenceVersion(version);
		if (!created)
			throw new TalentPhotoReferenceConflict();
		return created;
	};

	/**
	 * Write a Talent's photo, with any other edited fields, and replace its
	 * `photo` slot in the same commit. A photo is written only while it resolves;
	 * `null` clears it and releases the reference.
	 */
	const updateWithPhoto = async (
		id: number,
		eventId: number,
		data: UpdateTalentInput,
		photo: GraphicAssetReference | null,
	): Promise<DbEventTalent | undefined> => {
		const version = crypto.randomUUID();
		const now = Date.now();
		const facts = photo && boundPhotoFacts(photo);
		const columns = {
			...storedColumns(data),
			photo: photo && JSON.stringify(photo),
			graphic_asset_reference_version: version,
			updated_at: now,
		};
		const client = db.$client;
		const [written] = await client.batch([
			client.prepare(`
				UPDATE event_talents
				SET ${Object.keys(columns).map(name => `${name} = ?`).join(', ')}
				WHERE id = ? AND event_id = ?
					${facts ? REQUIRED_GRAPHIC_ASSET_REFERENCES_RESOLVE : ''}
			`).bind(...Object.values(columns), id, eventId, ...(facts
				? [facts]
				: [])),
			client.prepare(`
				DELETE FROM graphic_asset_references
				WHERE owner_kind = '${TALENT_REFERENCE_OWNER_KIND}' AND owner_id = ? AND owner_slot = '${TALENT_PHOTO_SLOT}'
					AND EXISTS (
						SELECT 1 FROM event_talents WHERE id = ? AND graphic_asset_reference_version = ?
					)
			`).bind(String(id), id, version),
			...(facts
				? [
						client.prepare(INSERT_PHOTO_REFERENCE).bind(now, now, facts, version),
					]
				: []),
		]);
		const talent = await findById(id, eventId);
		if (talent && written?.meta.changes !== 1)
			throw new TalentPhotoReferenceConflict();
		return talent;
	};

	const create = async (
		eventId: number,
		data: CreateTalentInput,
	): Promise<DbEventTalent> => {
		if (data.photo)
			return await createWithPhoto(eventId, data, data.photo);
		const { socialProfiles, photo: _none, ...fields } = data;
		const [newTalent] = await db
			.insert(eventTalents)
			.values({
				...fields,
				...(socialProfiles === undefined
					? {}
					: socialProfileColumns(socialProfiles)),
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
		if (data.photo !== undefined)
			return await updateWithPhoto(id, eventId, data, data.photo);
		const { socialProfiles, photo: _unchanged, ...fields } = data;
		const [updatedTalent] = await db
			.update(eventTalents)
			.set({
				...fields,
				...(socialProfiles === undefined
					? {}
					: socialProfileColumns(socialProfiles)),
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

	/** Delete a Talent and release its photo in the same commit. */
	const remove = async (id: number, eventId: number): Promise<boolean> => {
		const client = db.$client;
		const [, deleted] = await client.batch([
			client.prepare(`
				DELETE FROM graphic_asset_references
				WHERE owner_kind = '${TALENT_REFERENCE_OWNER_KIND}' AND owner_id = ? AND event_id = ?
			`).bind(String(id), eventId),
			client.prepare('DELETE FROM event_talents WHERE id = ? AND event_id = ?').bind(id, eventId),
		]);

		return (deleted?.meta.changes ?? 0) > 0;
	};

	return {
		findById,
		findByEventId,
		create,
		update,
		remove,
	};
}
