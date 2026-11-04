import type { GraphicsAssetLibrary } from '~~/server/modules/graphics-asset-library';
import type { CreateTalentInput, UpdateTalentInput } from '~~/shared/api';
import type { GraphicAssetReference } from '~~/shared/types/graphicsAsset';
import { eventDataPublicationModule } from '~~/server/modules/event-data-publication';
import { TalentPhotoReferenceConflict, talentService } from '~~/server/services/talent';
import { assertGraphicsTemplateReferencesSelectable } from '~~/server/utils/graphicsTemplateReferences';
import { TALENT_PHOTO_SLOT } from '~~/shared/utils/graphicsAssetReferences';

/** The library a photo write asks whether its image is selectable. */
type GraphicsAssets = () => Pick<GraphicsAssetLibrary, 'inspectGraphicAssetRevisions'>;

interface CreateTalentParams {
	eventId: number;
	input: CreateTalentInput;
	originConnectionId?: string;
	graphicsAssets: GraphicsAssets;
}

interface UpdateTalentParams {
	eventId: number;
	talentId: number;
	input: UpdateTalentInput;
	originConnectionId?: string;
	graphicsAssets: GraphicsAssets;
}

/**
 * A photo must be an image an author could select now (ADR-0034, ADR-0067):
 * asked of the library first so the refusal names the slot, and again by the
 * statement that commits it.
 */
async function assertPhotoSelectable(photo: GraphicAssetReference | null | undefined, graphicsAssets: GraphicsAssets) {
	if (!photo)
		return;
	await assertGraphicsTemplateReferencesSelectable(graphicsAssets(), [
		{ reference: photo, ownerSlot: TALENT_PHOTO_SLOT, kind: 'image' },
	], 'Talent');
}

async function refusingStalePhoto<T>(write: () => Promise<T>): Promise<T> {
	try {
		return await write();
	}
	catch (error) {
		if (!(error instanceof TalentPhotoReferenceConflict))
			throw error;
		throw createError({
			statusCode: 409,
			statusMessage: 'Conflict',
			message: 'The Graphic Asset Revision this photo names stopped being selectable while it was being saved. Choose another, or restore the asset.',
		});
	}
}

interface DeleteTalentParams {
	eventId: number;
	talentId: number;
	originConnectionId?: string;
}

export function talentWriteModule() {
	const publication = eventDataPublicationModule();
	const talents = talentService();

	async function createTalent({ eventId, input, originConnectionId, graphicsAssets }: CreateTalentParams) {
		await assertPhotoSelectable(input.photo, graphicsAssets);
		const newTalent = await refusingStalePhoto(() => talents.create(eventId, input));

		return await publication.talentCreated({
			eventId,
			entity: newTalent,
			originConnectionId,
		});
	}

	async function updateTalent({ eventId, talentId, input, originConnectionId, graphicsAssets }: UpdateTalentParams) {
		await assertPhotoSelectable(input.photo, graphicsAssets);
		const updatedTalent = await refusingStalePhoto(() => talents.update(talentId, eventId, input));

		if (!updatedTalent) {
			throw createError({
				statusCode: 404,
				message: 'Talent not found',
			});
		}

		return await publication.talentUpdated({
			eventId,
			entity: updatedTalent,
			originConnectionId,
		});
	}

	async function deleteTalent({ eventId, talentId, originConnectionId }: DeleteTalentParams) {
		const deleted = await talents.remove(talentId, eventId);

		if (!deleted) {
			throw createError({
				statusCode: 404,
				message: 'Talent not found',
			});
		}

		await publication.talentDeleted({
			eventId,
			id: talentId,
			originConnectionId,
		});

		return { success: true };
	}

	return {
		createTalent,
		updateTalent,
		deleteTalent,
	};
}
