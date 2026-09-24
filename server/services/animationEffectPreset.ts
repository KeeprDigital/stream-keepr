import type { AnimationEffectSelection } from '~~/shared/animationEffects';
import { asc, eq } from 'drizzle-orm';
import { db } from '~~/server/db';
import { animationEffectPresets } from '~~/server/db/schema';

export interface SaveAnimationEffectPreset {
	id: string;
	name: string;
	selection: AnimationEffectSelection;
}

export interface AnimationEffectPresetPatch {
	revision: number;
	name?: string;
	selection?: AnimationEffectSelection;
}

export class AnimationEffectPresetRevisionConflict extends Error {
	constructor(readonly currentRevision: number) {
		super(`Animation Effect Preset is at revision ${currentRevision}`);
		this.name = 'AnimationEffectPresetRevisionConflict';
	}
}

/** Storage for the installation's host-neutral Animation Effect Preset library. */
export function animationEffectPresetService() {
	const findAll = async () => await db
		.select()
		.from(animationEffectPresets)
		.orderBy(asc(animationEffectPresets.name), asc(animationEffectPresets.id));

	const findById = async (id: string) => await db.query.animationEffectPresets.findFirst({
		where: eq(animationEffectPresets.id, id),
	});

	const create = async (input: SaveAnimationEffectPreset) => {
		const [created] = await db
			.insert(animationEffectPresets)
			.values(input)
			.returning();
		if (!created)
			throw new Error('Animation Effect Preset was not stored');
		return created;
	};

	const update = async (id: string, patch: AnimationEffectPresetPatch) => {
		const existing = await findById(id);
		if (!existing)
			return undefined;

		const result = await db.$client.prepare(`
			UPDATE animation_effect_presets
			SET name = ?, selection = ?, revision = revision + 1, updated_at = ?
			WHERE id = ? AND revision = ?
		`).bind(
			patch.name ?? existing.name,
			JSON.stringify(patch.selection ?? existing.selection),
			Date.now(),
			id,
			patch.revision,
		).run();

		if (result.meta.changes !== 1) {
			const current = await findById(id);
			if (!current)
				return undefined;
			throw new AnimationEffectPresetRevisionConflict(current.revision);
		}

		return await findById(id);
	};

	const remove = async (id: string): Promise<boolean> => {
		const removed = await db
			.delete(animationEffectPresets)
			.where(eq(animationEffectPresets.id, id))
			.returning({ id: animationEffectPresets.id });
		return removed.length === 1;
	};

	return { findAll, findById, create, update, remove };
}
