import type { BroadcastDeckListCanonicalDocument } from '~~/server/modules/broadcast-deck-list-import';
import type { CreateBroadcastDeckListInput, UpdateBroadcastDeckListInput } from '~~/shared/types/broadcastDeckList';
import {
	BroadcastDeckListCardProviderError,
	createBroadcastDeckListScryfallResolver,
	importBroadcastDeckList,
} from '~~/server/modules/broadcast-deck-list-import';
import { eventDataPublicationModule } from '~~/server/modules/event-data-publication';
import {
	BroadcastDeckListNameConflict,
	broadcastDeckListService,
} from '~~/server/services/broadcastDeckList';
import { eventCardNameOverrideService } from '~~/server/services/eventCardNameOverride';
import { BROADCAST_DECK_LIST_IN_USE, BROADCAST_DECK_LIST_REVISION_CONFLICT } from '~~/shared/types/broadcastDeckList';

interface BaseWriteParams {
	eventId: number;
	originConnectionId?: string;
}

interface CreateParams extends BaseWriteParams {
	input: CreateBroadcastDeckListInput;
}

interface UpdateParams extends BaseWriteParams {
	listId: number;
	input: UpdateBroadcastDeckListInput;
}

interface DeleteParams extends BaseWriteParams {
	listId: number;
	expectedRevision: number;
}

function missingListError() {
	return createError({ statusCode: 404, message: 'Broadcast Deck List not found' });
}

function revisionConflictError(current: unknown) {
	return createError({
		statusCode: 409,
		message: 'Broadcast Deck List changed since it was loaded',
		data: { code: BROADCAST_DECK_LIST_REVISION_CONFLICT, current },
	});
}

function nameConflictError(error: BroadcastDeckListNameConflict) {
	return createError({ statusCode: 409, message: error.message, data: { code: 'BROADCAST_DECK_LIST_NAME_CONFLICT' } });
}

function inUseError(screens: Array<{ id: number; name: string }>) {
	const names = screens.map(screen => screen.name).join(', ');
	return createError({
		statusCode: 409,
		message: `Broadcast Deck List is selected by ${screens.length === 1 ? 'Screen' : 'Screens'}: ${names}`,
		data: { code: BROADCAST_DECK_LIST_IN_USE, screens },
	});
}

export function broadcastDeckListWriteModule() {
	const lists = broadcastDeckListService();
	const publication = eventDataPublicationModule();

	async function requireMtgEvent(eventId: number) {
		const game = await lists.findEventGame(eventId);
		if (game === undefined)
			throw createError({ statusCode: 404, message: 'Event not found' });
		if (game !== 'mtg') {
			throw createError({
				statusCode: 400,
				message: 'Broadcast Deck Lists are only supported for MTG Events',
			});
		}
	}

	async function resolveSource(eventId: number, sourceText: string): Promise<BroadcastDeckListCanonicalDocument> {
		const overrides = await eventCardNameOverrideService().listResolvedByEvent(eventId);
		const resolver = createBroadcastDeckListScryfallResolver({
			overrides: overrides.map(override => ({
				inputName: override.inputName,
				inputSetCode: override.inputSetCode,
				canonicalName: override.card.name,
			})),
		});
		try {
			const result = await importBroadcastDeckList(sourceText, resolver);
			if (!result.ok) {
				throw createError({
					statusCode: 422,
					message: 'Broadcast Deck List source is invalid',
					data: { code: 'BROADCAST_DECK_LIST_INVALID', errors: result.errors },
				});
			}
			return result.document;
		}
		catch (error) {
			if (error instanceof BroadcastDeckListCardProviderError) {
				throw createError({ cause: error });
			}
			throw error;
		}
	}

	async function createBroadcastDeckList({ eventId, input, originConnectionId }: CreateParams) {
		await requireMtgEvent(eventId);
		const document = await resolveSource(eventId, input.sourceText);
		try {
			const created = await lists.create(eventId, input, document);
			return await publication.broadcastDeckListCreated({
				eventId,
				entity: created,
				originConnectionId,
			});
		}
		catch (error) {
			if (error instanceof BroadcastDeckListNameConflict)
				throw nameConflictError(error);
			throw error;
		}
	}

	async function updateBroadcastDeckList({ eventId, listId, input, originConnectionId }: UpdateParams) {
		await requireMtgEvent(eventId);
		const document = input.sourceText === undefined ? undefined : await resolveSource(eventId, input.sourceText);
		let result;
		try {
			result = await lists.update(listId, eventId, input, document);
		}
		catch (error) {
			if (error instanceof BroadcastDeckListNameConflict)
				throw nameConflictError(error);
			throw error;
		}

		if (result.status === 'missing')
			throw missingListError();
		if (result.status === 'conflict')
			throw revisionConflictError(result.current);

		return await publication.broadcastDeckListUpdated({
			eventId,
			entity: result.item,
			originConnectionId,
		});
	}

	async function deleteBroadcastDeckList({ eventId, listId, expectedRevision, originConnectionId }: DeleteParams) {
		await requireMtgEvent(eventId);
		const result = await lists.remove(listId, eventId, expectedRevision);
		if (result.status === 'missing')
			throw missingListError();
		if (result.status === 'in-use')
			throw inUseError(result.screens);
		if (result.status === 'conflict')
			throw revisionConflictError(result.current);

		await publication.broadcastDeckListDeleted({ eventId, id: listId, originConnectionId });
		return { success: true as const };
	}

	return {
		createBroadcastDeckList,
		updateBroadcastDeckList,
		deleteBroadcastDeckList,
	};
}
