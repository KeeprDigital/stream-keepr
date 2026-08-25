import type { BroadcastDeckListCanonicalDocument } from '~~/server/modules/broadcast-deck-list-import';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	class NameConflict extends Error {}
	class ProviderError extends Error {
		readonly code = 'BROADCAST_DECK_LIST_CARD_PROVIDER_UNAVAILABLE';
		readonly retryable = true;
	}
	return {
		NameConflict,
		ProviderError,
		importList: vi.fn(),
		createResolver: vi.fn(() => ({ resolve: vi.fn() })),
		listOverrides: vi.fn(async () => []),
		service: {
			findEventGame: vi.fn(async () => 'mtg'),
			create: vi.fn(),
			update: vi.fn(),
			remove: vi.fn(),
		},
		publication: {
			broadcastDeckListCreated: vi.fn(async ({ entity }) => entity),
			broadcastDeckListUpdated: vi.fn(async ({ entity }) => entity),
			broadcastDeckListDeleted: vi.fn(async () => undefined),
		},
	};
});

vi.mock('~~/server/modules/broadcast-deck-list-import', () => ({
	importBroadcastDeckList: mocks.importList,
	createBroadcastDeckListScryfallResolver: mocks.createResolver,
	BroadcastDeckListCardProviderError: mocks.ProviderError,
}));
vi.mock('~~/server/services/eventCardNameOverride', () => ({
	eventCardNameOverrideService: () => ({ listResolvedByEvent: mocks.listOverrides }),
}));
vi.mock('~~/server/services/broadcastDeckList', () => ({
	broadcastDeckListService: () => mocks.service,
	BroadcastDeckListNameConflict: mocks.NameConflict,
}));
vi.mock('~~/server/modules/event-data-publication', () => ({
	eventDataPublicationModule: () => mocks.publication,
}));

vi.stubGlobal('createError', (input: Record<string, unknown>) => Object.assign(new Error(String(input.message ?? 'error')), input));

const { broadcastDeckListWriteModule } = await import('~~/server/modules/broadcast-deck-list-write');

const document: BroadcastDeckListCanonicalDocument = {
	sourceText: '1 Island',
	mainboard: [{
		canonicalName: 'Island',
		scryfallId: 'island-printing',
		oracleId: 'island-oracle',
		setCode: 'lea',
		collectorNumber: '295',
		cardType: 'Basic Land — Island',
		colors: null,
		manaCost: null,
		manaValue: 0,
		deckCounterTypes: [],
		quantity: 1,
		sortOrder: 0,
	}],
	sideboard: [],
	companion: null,
};
const item = {
	id: 11,
	eventId: 1,
	name: 'Deck',
	revision: 1,
	sourceText: document.sourceText,
	entries: [],
};

describe('broadcastDeckListWriteModule', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.service.findEventGame.mockResolvedValue('mtg');
		mocks.importList.mockResolvedValue({ ok: true, document });
		mocks.service.create.mockResolvedValue(item);
		mocks.service.update.mockResolvedValue({ status: 'updated', item: { ...item, revision: 2 } });
		mocks.service.remove.mockResolvedValue({ status: 'deleted' });
	});

	it('returns the stable parser error array and writes nothing on invalid create', async () => {
		const errors = [{ lineNumber: 1, code: 'INVALID_CARD_LINE', message: 'Expected a card', sourceText: 'Island' }];
		mocks.importList.mockResolvedValue({ ok: false, errors });

		await expect(broadcastDeckListWriteModule().createBroadcastDeckList({
			eventId: 1,
			input: { name: 'Deck', sourceText: 'Island' },
		})).rejects.toMatchObject({
			statusCode: 422,
			data: { code: 'BROADCAST_DECK_LIST_INVALID', errors },
		});
		expect(mocks.service.create).not.toHaveBeenCalled();
		expect(mocks.publication.broadcastDeckListCreated).not.toHaveBeenCalled();
	});

	it('keeps provider outages retryable and writes nothing', async () => {
		mocks.importList.mockRejectedValue(new mocks.ProviderError());

		await expect(broadcastDeckListWriteModule().createBroadcastDeckList({
			eventId: 1,
			input: { name: 'Deck', sourceText: '1 Island' },
		})).rejects.toMatchObject({
			cause: { code: 'BROADCAST_DECK_LIST_CARD_PROVIDER_UNAVAILABLE', retryable: true },
		});
		expect(mocks.service.create).not.toHaveBeenCalled();
	});

	it('does not touch the saved item when replacement validation fails', async () => {
		const errors = [{ lineNumber: 1, code: 'UNRESOLVED_CARD', message: 'Could not resolve Nope', sourceText: '1 Nope' }];
		mocks.importList.mockResolvedValue({ ok: false, errors });

		await expect(broadcastDeckListWriteModule().updateBroadcastDeckList({
			eventId: 1,
			listId: item.id,
			input: { expectedRevision: 1, sourceText: '1 Nope' },
		})).rejects.toMatchObject({
			statusCode: 422,
			data: { code: 'BROADCAST_DECK_LIST_INVALID', errors },
		});
		expect(mocks.service.update).not.toHaveBeenCalled();
		expect(mocks.publication.broadcastDeckListUpdated).not.toHaveBeenCalled();
	});

	it('does not resolve source for a metadata-only update', async () => {
		const response = await broadcastDeckListWriteModule().updateBroadcastDeckList({
			eventId: 1,
			listId: item.id,
			input: { expectedRevision: 1, name: 'Renamed' },
			originConnectionId: 'origin-1',
		});

		expect(mocks.importList).not.toHaveBeenCalled();
		expect(mocks.service.update).toHaveBeenCalledWith(item.id, 1, { expectedRevision: 1, name: 'Renamed' }, undefined);
		expect(mocks.publication.broadcastDeckListUpdated).toHaveBeenCalledWith({
			eventId: 1,
			entity: expect.objectContaining({ revision: 2 }),
			originConnectionId: 'origin-1',
		});
		expect(response).toMatchObject({ revision: 2 });
	});

	it('returns the current authoritative item for stale update and delete', async () => {
		const current = { ...item, revision: 3 };
		mocks.service.update.mockResolvedValueOnce({ status: 'conflict', current });
		mocks.service.remove.mockResolvedValueOnce({ status: 'conflict', current });

		await expect(broadcastDeckListWriteModule().updateBroadcastDeckList({
			eventId: 1,
			listId: item.id,
			input: { expectedRevision: 1, name: 'Stale' },
		})).rejects.toMatchObject({
			statusCode: 409,
			data: { code: 'BROADCAST_DECK_LIST_REVISION_CONFLICT', current },
		});
		await expect(broadcastDeckListWriteModule().deleteBroadcastDeckList({
			eventId: 1,
			listId: item.id,
			expectedRevision: 1,
		})).rejects.toMatchObject({
			statusCode: 409,
			data: { code: 'BROADCAST_DECK_LIST_REVISION_CONFLICT', current },
		});
	});

	it('returns every affected Screen in a stable in-use conflict', async () => {
		const screens = [{ id: 3, name: 'Alpha' }, { id: 9, name: 'Studio' }];
		mocks.service.remove.mockResolvedValueOnce({ status: 'in-use', current: item, screens });

		await expect(broadcastDeckListWriteModule().deleteBroadcastDeckList({
			eventId: 1,
			listId: item.id,
			expectedRevision: 1,
		})).rejects.toMatchObject({
			statusCode: 409,
			message: 'Broadcast Deck List is selected by Screens: Alpha, Studio',
			data: { code: 'BROADCAST_DECK_LIST_IN_USE', screens },
		});
		expect(mocks.publication.broadcastDeckListDeleted).not.toHaveBeenCalled();
	});

	it('returns stable name-conflict and missing-item failures without publishing', async () => {
		mocks.service.update
			.mockRejectedValueOnce(new mocks.NameConflict('duplicate'))
			.mockResolvedValueOnce({ status: 'missing' });
		mocks.service.remove.mockResolvedValueOnce({ status: 'missing' });

		await expect(broadcastDeckListWriteModule().updateBroadcastDeckList({
			eventId: 1,
			listId: item.id,
			input: { expectedRevision: 1, name: 'Duplicate' },
		})).rejects.toMatchObject({
			statusCode: 409,
			data: { code: 'BROADCAST_DECK_LIST_NAME_CONFLICT' },
		});
		await expect(broadcastDeckListWriteModule().updateBroadcastDeckList({
			eventId: 1,
			listId: item.id,
			input: { expectedRevision: 1, name: 'Missing' },
		})).rejects.toMatchObject({ statusCode: 404 });
		await expect(broadcastDeckListWriteModule().deleteBroadcastDeckList({
			eventId: 1,
			listId: item.id,
			expectedRevision: 1,
		})).rejects.toMatchObject({ statusCode: 404 });
		expect(mocks.publication.broadcastDeckListUpdated).not.toHaveBeenCalled();
		expect(mocks.publication.broadcastDeckListDeleted).not.toHaveBeenCalled();
	});

	it('restricts all writes to MTG Events, even when a non-MTG library path is addressed', async () => {
		mocks.service.findEventGame.mockResolvedValue('op');

		await expect(broadcastDeckListWriteModule().createBroadcastDeckList({
			eventId: 1,
			input: { name: 'Deck', sourceText: '1 Island' },
		})).rejects.toMatchObject({ statusCode: 400, message: 'Broadcast Deck Lists are only supported for MTG Events' });
		expect(mocks.importList).not.toHaveBeenCalled();
		expect(mocks.service.create).not.toHaveBeenCalled();
	});
});
