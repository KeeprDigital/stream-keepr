import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubH3Event } from '~~/test/helpers/h3Event';

const mockFindScreenById = vi.fn();
const mockFindBroadcastDeckListById = vi.fn();
const mockSourceIsSelectable = vi.fn();
const mockOptionalUserSession = vi.fn();
const mockGetRequestHeader = vi.fn();
const mockGetValidatedRouterParams = vi.fn();

vi.mock('~~/server/services/screen', () => ({
	screenService: () => ({ findById: mockFindScreenById }),
}));

vi.mock('~~/server/services/broadcastDeckList', () => ({
	broadcastDeckListService: () => ({
		findById: mockFindBroadcastDeckListById,
		sourceIsSelectable: mockSourceIsSelectable,
	}),
}));

vi.mock('~~/server/utils/auth', () => ({
	optionalUserSession: mockOptionalUserSession,
}));

vi.stubGlobal('defineEventHandler', vi.fn(handler => handler));
vi.stubGlobal('getRequestHeader', mockGetRequestHeader);
vi.stubGlobal('getValidatedRouterParams', mockGetValidatedRouterParams);
vi.stubGlobal('setResponseHeader', vi.fn());
vi.stubGlobal('createError', (input: { statusCode: number; message: string }) =>
	Object.assign(new Error(input.message), input));

const CAPABILITY = 'a-screen-output-capability-token';

async function capabilityDigest(capability: string): Promise<string> {
	const { screenOutputAssetCapabilityDigest } = await import(
		'~~/server/modules/screen-output-assets/capability',
	);
	return await screenOutputAssetCapabilityDigest(capability);
}

async function broadcastDeckListRoute() {
	return (await import(
		'../../../../../server/api/screen-output/events/[id]/screens/[screenId]/broadcast-deck-list.get',
	)).default;
}

function screenRow(overrides: Record<string, unknown> = {}) {
	return {
		id: 7,
		eventId: 5,
		name: 'Programme',
		slug: 'programme',
		assetCapabilityDigest: 'some-other-digest',
		currentMode: 'deck',
		modeConfigs: {
			deck: { deckSource: { type: 'broadcast', broadcastDeckListId: 23 } },
		},
		stateVersion: 1,
		createdAt: new Date(0),
		updatedAt: new Date(0),
		...overrides,
	};
}

function selectedList() {
	return {
		id: 23,
		eventId: 5,
		name: 'Feature Table',
		archetypeLabel: 'Jeskai Control',
		colors: 'WUR',
		revision: 4,
		mainboardQuantity: 60,
		sideboardQuantity: 15,
		hasCompanion: false,
		sourceText: '4 Lightning Bolt',
		entries: [],
		createdAt: new Date(0),
		updatedAt: new Date(0),
	};
}

describe('the selected Broadcast Deck List Screen Output read', () => {
	beforeEach(() => {
		vi.resetModules();
		mockFindScreenById.mockReset().mockResolvedValue(screenRow());
		mockFindBroadcastDeckListById.mockReset().mockResolvedValue(selectedList());
		mockSourceIsSelectable.mockReset().mockResolvedValue(true);
		mockOptionalUserSession.mockReset().mockResolvedValue(null);
		mockGetRequestHeader.mockReset().mockReturnValue(undefined);
		mockGetValidatedRouterParams.mockReset().mockImplementation(async (_event, parse) =>
			parse({ id: 5, screenId: 7 }));
	});

	it('returns only the list selected by the authoritative Screen to its capability bearer', async () => {
		mockFindScreenById.mockResolvedValue(screenRow({
			assetCapabilityDigest: await capabilityDigest(CAPABILITY),
		}));
		mockGetRequestHeader.mockReturnValue(`Bearer ${CAPABILITY}`);
		const handler = await broadcastDeckListRoute();

		await expect(handler(stubH3Event())).resolves.toMatchObject({ id: 23, revision: 4 });
		expect(mockFindScreenById).toHaveBeenCalledWith(7, 5);
		expect(mockFindBroadcastDeckListById).toHaveBeenCalledWith(23, 5);
		expect(mockOptionalUserSession).not.toHaveBeenCalled();
	});

	it('also answers a session-bearing operator embed', async () => {
		mockOptionalUserSession.mockResolvedValue({ user: { id: 'user-1' }, session: { id: 'session-1' } });
		const handler = await broadcastDeckListRoute();

		await expect(handler(stubH3Event())).resolves.toMatchObject({ id: 23 });
	});

	it.each([
		['no credential', undefined],
		['another Screen\'s capability', `Bearer ${CAPABILITY}`],
	] as const)('refuses %s with the non-enumerating 404', async (_case, authorization) => {
		mockGetRequestHeader.mockReturnValue(authorization);
		const handler = await broadcastDeckListRoute();

		await expect(handler(stubH3Event())).rejects.toMatchObject({
			statusCode: 404,
			message: 'Broadcast Deck List not found',
		});
		expect(mockFindBroadcastDeckListById).not.toHaveBeenCalled();
	});

	it('refuses a Screen from another Event with the same 404', async () => {
		mockFindScreenById.mockResolvedValue(undefined);
		mockOptionalUserSession.mockResolvedValue({ user: { id: 'user-1' }, session: { id: 'session-1' } });
		const handler = await broadcastDeckListRoute();

		await expect(handler(stubH3Event())).rejects.toMatchObject({ statusCode: 404 });
		expect(mockFindBroadcastDeckListById).not.toHaveBeenCalled();
	});

	it('refuses a Player source without exposing whether the Event has lists', async () => {
		mockFindScreenById.mockResolvedValue(screenRow({
			modeConfigs: { deck: { deckSource: { type: 'player', playerId: 11 } } },
		}));
		mockOptionalUserSession.mockResolvedValue({ user: { id: 'user-1' }, session: { id: 'session-1' } });
		const handler = await broadcastDeckListRoute();

		await expect(handler(stubH3Event())).rejects.toMatchObject({ statusCode: 404 });
		expect(mockFindBroadcastDeckListById).not.toHaveBeenCalled();
	});

	it('refuses a stale disabled or cross-Event source and a missing selected list alike', async () => {
		mockOptionalUserSession.mockResolvedValue({ user: { id: 'user-1' }, session: { id: 'session-1' } });
		const handler = await broadcastDeckListRoute();

		mockSourceIsSelectable.mockResolvedValueOnce(false);
		await expect(handler(stubH3Event())).rejects.toMatchObject({ statusCode: 404 });

		mockSourceIsSelectable.mockResolvedValueOnce(true);
		mockFindBroadcastDeckListById.mockResolvedValueOnce(undefined);
		await expect(handler(stubH3Event())).rejects.toMatchObject({ statusCode: 404 });
	});
});
