import type { CreateTalentInput, UpdateTalentInput } from '~~/shared/api';
import { eventDataPublicationModule } from '~~/server/modules/event-data-publication';
import { talentService } from '~~/server/services/talent';

interface CreateTalentParams {
	eventId: number;
	input: CreateTalentInput;
	originConnectionId?: string;
}

interface UpdateTalentParams {
	eventId: number;
	talentId: number;
	input: UpdateTalentInput;
	originConnectionId?: string;
}

interface DeleteTalentParams {
	eventId: number;
	talentId: number;
	originConnectionId?: string;
}

export function talentWriteModule() {
	const publication = eventDataPublicationModule();
	const talents = talentService();

	async function createTalent({ eventId, input, originConnectionId }: CreateTalentParams) {
		const newTalent = await talents.create(eventId, input);

		return await publication.talentCreated({
			eventId,
			entity: newTalent,
			originConnectionId,
		});
	}

	async function updateTalent({ eventId, talentId, input, originConnectionId }: UpdateTalentParams) {
		const updatedTalent = await talents.update(talentId, eventId, input);

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
