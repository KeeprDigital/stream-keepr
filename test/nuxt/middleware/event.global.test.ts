import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const { default: middleware } = await import('~/middleware/event.global');

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

	it.each(['/', '/settings'])('resets every Event store on leaving for the non-Event path %s', async (path) => {
		await runMiddleware(createRoute(path));

		expect(mockResetAllEventStores).toHaveBeenCalledOnce();
	});

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

	it('redirects home when the Event does not exist', async () => {
		mockEventStore.loadEvent.mockResolvedValue(null);

		await runMiddleware(createRoute('/event/999/matches', { eventId: '999' }));

		expect(mockNavigateTo).toHaveBeenCalledWith('/');
	});

	// ── The Screen Output page (#604) ──

	describe('the Screen Output page', () => {
		/**
		 * The output holds no Session, so the operator's Event read would refuse it
		 * and the redirect would take program to the home page and on to sign-in.
		 * Its display session loads the Event context its capability admits.
		 */
		it('leaves the output alone: no Event load, no reset, no redirect', async () => {
			await runMiddleware(createRoute('/event/999/screen/main', { eventId: '999' }));

			expect(mockEventStore.loadEvent).not.toHaveBeenCalled();
			expect(mockResetAllEventStores).not.toHaveBeenCalled();
			expect(mockNavigateTo).not.toHaveBeenCalled();
		});

		it('still loads the Event for the operator\'s Screen control surface', async () => {
			mockEventStore.loadEvent.mockResolvedValue(null);

			await runMiddleware(createRoute('/event/999/screens/3', { eventId: '999' }));

			expect(mockEventStore.loadEvent).toHaveBeenCalledWith(999);
			expect(mockNavigateTo).toHaveBeenCalledWith('/');
		});
	});

	it.each(['abc', '0', '-1'])('redirects home without loading for the Event id %j, rather than leaving the page loading', async (eventId) => {
		await runMiddleware(createRoute(`/event/${eventId}/matches`, { eventId }));

		expect(mockNavigateTo).toHaveBeenCalledWith('/');
		expect(mockEventStore.loadEvent).not.toHaveBeenCalled();
	});
});
