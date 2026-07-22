import type { CreatePhaseInput, PhaseResponse, UpdatePhaseInput } from '~~/shared/api';
import { eventDataPublicationModule } from '~~/server/modules/event-data-publication';
import { phaseService } from '~~/server/services/phase';

interface CreatePhaseParams {
	eventId: number;
	input: CreatePhaseInput;
	originConnectionId?: string;
}

interface UpdatePhaseParams {
	eventId: number;
	phaseId: number;
	input: UpdatePhaseInput;
	originConnectionId?: string;
}

interface RemovePhaseParams {
	eventId: number;
	phaseId: number;
	originConnectionId?: string;
}

export function phaseWriteModule() {
	const publication = eventDataPublicationModule();
	const phases = phaseService();

	async function create({ eventId, input, originConnectionId }: CreatePhaseParams): Promise<PhaseResponse> {
		const newPhase = await phases.create(eventId, input);

		return await publication.phaseCreated({
			eventId,
			entity: newPhase,
			originConnectionId,
		});
	}

	async function update({ eventId, phaseId, input, originConnectionId }: UpdatePhaseParams): Promise<PhaseResponse> {
		const updatedPhase = await phases.update(phaseId, eventId, input);
		if (!updatedPhase) {
			throw createError({ statusCode: 404, message: 'Phase not found' });
		}

		return await publication.phaseUpdated({
			eventId,
			entity: updatedPhase,
			originConnectionId,
		});
	}

	async function remove({ eventId, phaseId, originConnectionId }: RemovePhaseParams): Promise<void> {
		const deleted = await phases.remove(phaseId, eventId);
		if (!deleted) {
			throw createError({ statusCode: 404, message: 'Phase not found' });
		}

		await publication.phaseDeleted({
			eventId,
			id: phaseId,
			originConnectionId,
		});
	}

	return {
		create,
		update,
		remove,
	};
}
