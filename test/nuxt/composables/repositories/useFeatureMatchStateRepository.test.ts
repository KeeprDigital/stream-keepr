import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockFeatureMatchState } from '~~/test/helpers/fixtures';

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));
const mockApiHeaders = {
	getHeaders: vi.fn(() => ({ 'x-realtime-connection-id': 'test-connection-id' })),
};

mockNuxtImport('$fetch', () => mockFetch);
mockNuxtImport('useApiHeaders', () => () => mockApiHeaders);

function createSession(overrides: Record<string, unknown> = {}) {
	const currentState = createMockFeatureMatchState();
	return {
		id: 55,
		eventId: 1,
		slotId: 10,
		sourceSnapshot: {},
		currentState,
		sequence: 7,
		closedAt: null,
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
		updatedAt: new Date('2026-01-01T00:00:00.000Z'),
		...overrides,
	};
}

function createSlot(activeSession: ReturnType<typeof createSession> | null = createSession()) {
	return {
		id: 10,
		activeSession,
	};
}

describe('useFeatureMatchStateRepository', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('gets a Feature Match slot by path', async () => {
		const slot = createSlot();
		mockFetch.mockResolvedValueOnce(slot);

		const repo = useFeatureMatchStateRepository();
		const result = await repo.getSlot(1, 10);

		expect(result).toBe(slot);
		expect(mockFetch).toHaveBeenCalledWith('/api/events/1/feature-match-slots/10');
	});

	it('lists Feature Match slots by path', async () => {
		const slots = [createSlot()];
		mockFetch.mockResolvedValueOnce({ featureMatchSlots: slots });

		const repo = useFeatureMatchStateRepository();
		const result = await repo.listSlots(1);

		expect(result).toBe(slots);
		expect(mockFetch).toHaveBeenCalledWith('/api/events/1/feature-match-slots');
	});

	it('creates a Feature Match Session with realtime-origin headers', async () => {
		const session = createSession();
		mockFetch.mockResolvedValueOnce(session);

		const repo = useFeatureMatchStateRepository();
		const result = await repo.createSession(1, 10);

		expect(result).toBe(session);
		expect(mockFetch).toHaveBeenCalledWith('/api/events/1/feature-match-slots/10/sessions', {
			method: 'POST',
			headers: { 'x-realtime-connection-id': 'test-connection-id' },
		});
	});

	it('sends raw Feature Match Session commands with realtime-origin headers', async () => {
		const session = createSession({ sequence: 8 });
		const command = {
			commandId: 'command-1',
			type: 'SetTurnNumber' as const,
			payload: { turnNumber: 3 },
			baseSequence: 7,
		};
		const response = {
			slotId: session.slotId,
			sessionId: session.id,
			sequence: session.sequence,
			eventType: command.type,
			sourceSnapshot: session.sourceSnapshot,
			currentState: session.currentState,
			session,
		};
		mockFetch.mockResolvedValueOnce(response);

		const repo = useFeatureMatchStateRepository();
		const result = await repo.sendCommand(1, 55, command);

		expect(result).toBe(response);
		expect(mockFetch).toHaveBeenCalledWith('/api/events/1/feature-match-sessions/55/commands', {
			method: 'POST',
			body: command,
			headers: { 'x-realtime-connection-id': 'test-connection-id' },
		});
	});
});
