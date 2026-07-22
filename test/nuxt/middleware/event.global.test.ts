import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock Dependencies (vi.hoisted so they're available in hoisted mockNuxtImport factories) ──

const {
	mockEventStore,
	mockNavigateTo,
	mockResetAllEventStores,
} = vi.hoisted(() => ({
	mockEventStore: {
		event: null as { id: number; meleeEnabled?: boolean } | null,
		loadEvent: vi.fn(),
		$reset: vi.fn(),
	},
	mockNavigateTo: vi.fn(),
	mockResetAllEventStores: vi.fn(),
}));

vi.mock('~/utils/eventStores', () => ({
	resetAllEventStores: mockResetAllEventStores,
}));

mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('navigateTo', () => mockNavigateTo);
mockNuxtImport('defineNuxtRouteMiddleware', () => (fn: any) => fn);

// ── Import middleware after mocks ──

const { default: middleware } = await import('~/middleware/event.global');

// ── Helpers ──

function createRoute(path: string, params: Record<string, string> = {}) {
	return { path, params } as any;
}

const fromRoute = createRoute('/');

function runMiddleware(to: ReturnType<typeof createRoute>) {
	return middleware(to, fromRoute);
}

describe('event.global middleware', () => {
	beforeEach(() => {
		mockEventStore.event = null;
		vi.clearAllMocks();
	});

	// ── Non-event routes ──

	describe('non-event routes', () => {
		it('resets all stores when navigating to root', async () => {
			await runMiddleware(createRoute('/'));

			expect(mockResetAllEventStores).toHaveBeenCalledOnce();
		});

		it('resets all stores when navigating to a non-event path', async () => {
			await runMiddleware(createRoute('/settings'));

			expect(mockResetAllEventStores).toHaveBeenCalledOnce();
		});
	});

	// ── Event routes — successful load ──

	describe('event route with successful load', () => {
		it('resets all stores before loading a new event', async () => {
			mockEventStore.loadEvent.mockImplementation(async () => {
				mockEventStore.event = { id: 1 };
			});

			await runMiddleware(createRoute('/event/1/matches', { eventId: '1' }));

			expect(mockResetAllEventStores).toHaveBeenCalledOnce();
		});

		it('reloads when switching to a different event', async () => {
			mockEventStore.event = { id: 1 };
			mockEventStore.loadEvent.mockImplementation(async () => {
				mockEventStore.event = { id: 2 };
			});

			await runMiddleware(createRoute('/event/2/matches', { eventId: '2' }));

			expect(mockEventStore.loadEvent).toHaveBeenCalledWith(2);
			expect(mockResetAllEventStores).toHaveBeenCalledOnce();
		});
	});

	// ── Event routes — failed load (404 / not found) ──

	describe('event route with non-existent event', () => {
		it('redirects to / when loadEvent resolves but event remains null', async () => {
			mockEventStore.loadEvent.mockResolvedValue(null);

			await runMiddleware(createRoute('/event/999/matches', { eventId: '999' }));

			expect(mockNavigateTo).toHaveBeenCalledWith('/');
		});

		it('redirects overlay routes for non-existent events', async () => {
			mockEventStore.loadEvent.mockResolvedValue(null);

			await runMiddleware(createRoute('/event/999/screen/main', { eventId: '999' }));

			expect(mockNavigateTo).toHaveBeenCalledWith('/');
		});

		it('redirects config routes for non-existent events', async () => {
			mockEventStore.loadEvent.mockResolvedValue(null);

			await runMiddleware(createRoute('/event/999/config', { eventId: '999' }));

			expect(mockNavigateTo).toHaveBeenCalledWith('/');
		});
	});

	// ── Edge cases ──

	describe('non-numeric eventId', () => {
		it('redirects to / instead of leaving the page stuck loading', async () => {
			await runMiddleware(createRoute('/event/abc/matches', { eventId: 'abc' }));

			expect(mockNavigateTo).toHaveBeenCalledWith('/');
			expect(mockEventStore.loadEvent).not.toHaveBeenCalled();
		});

		it('redirects for a zero eventId', async () => {
			await runMiddleware(createRoute('/event/0/matches', { eventId: '0' }));

			expect(mockNavigateTo).toHaveBeenCalledWith('/');
			expect(mockEventStore.loadEvent).not.toHaveBeenCalled();
		});

		it('redirects for a negative eventId', async () => {
			await runMiddleware(createRoute('/event/-1/matches', { eventId: '-1' }));

			expect(mockNavigateTo).toHaveBeenCalledWith('/');
			expect(mockEventStore.loadEvent).not.toHaveBeenCalled();
		});
	});
});
