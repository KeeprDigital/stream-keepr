import type { Game } from '~~/shared/types/enums';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	mockEventStore,
	mockNavigateTo,
	mockResetAllEventStores,
} = vi.hoisted(() => ({
	mockEventStore: {
		event: null as { id: number; game?: Game; meleeEnabled?: boolean } | null,
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
	return { path, params, meta: {} } as any;
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

	// An OP Event models no Rounds or Matches and never runs Melee Sync
	// (ADR-0057): a direct visit to a page it does not use lands on its overview.
	// Routes resolve through the real router, so each page's own declaration counts.
	describe('pages the Event\'s Card Game does not use', () => {
		const MTG_ONLY_PAGES = [
			'/event/1/matches',
			'/event/1/rounds',
			'/event/1/sync',
			'/event/1/archetype-review',
			'/event/1/card',
			'/event/1/config/integrations',
		];
		const EVERY_CARD_GAME_PAGES = [
			'/event/1',
			'/event/1/players',
			'/event/1/metagame',
			'/event/1/metagame/cards',
			'/event/1/feature-matches',
			'/event/1/screens',
			'/event/1/config',
			'/event/1/config/features',
		];

		function visit(path: string) {
			return runMiddleware(useRouter().resolve(path) as any);
		}

		it.each(MTG_ONLY_PAGES)('sends an OP Event from %s to its overview', async (path) => {
			mockEventStore.event = { id: 1, game: 'op' };

			await visit(path);

			expect(mockNavigateTo).toHaveBeenCalledWith('/event/1');
		});

		it.each([
			...MTG_ONLY_PAGES.map(path => ['mtg', path] as const),
			...EVERY_CARD_GAME_PAGES.map(path => ['op', path] as const),
		])('lets a %s Event stay on %s', async (game, path) => {
			mockEventStore.event = { id: 1, game };

			await visit(path);

			expect(mockNavigateTo).not.toHaveBeenCalled();
		});
	});

	it.each(['abc', '0', '-1'])('redirects home without loading for the Event id %j, rather than leaving the page loading', async (eventId) => {
		await runMiddleware(createRoute(`/event/${eventId}/matches`, { eventId }));

		expect(mockNavigateTo).toHaveBeenCalledWith('/');
		expect(mockEventStore.loadEvent).not.toHaveBeenCalled();
	});
});
