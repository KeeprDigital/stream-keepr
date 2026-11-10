import type { Game } from '~~/shared/types/enums';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';

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
/** The operator's answer to the unsaved-changes confirmation: true discards. */
const confirmOpen = vi.fn(() => ({
	result: Promise.resolve(false),
}));

vi.mock('~/utils/eventStores', () => ({
	resetAllEventStores: mockResetAllEventStores,
}));

mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('navigateTo', () => mockNavigateTo);
mockNuxtImport('useOverlay', () => () => ({
	create: () => ({ open: confirmOpen }),
}));
mockNuxtImport('defineNuxtRouteMiddleware', () => (fn: any) => fn);

const { default: middleware } = await import('~/middleware/event.global');

function createRoute(path: string, params: Record<string, string> = {}) {
	return { path, params, meta: {} } as any;
}

const fromRoute = createRoute('/');

function runMiddleware(to: ReturnType<typeof createRoute>) {
	return middleware(to, fromRoute);
}

/** An overlay modal holding a form, open over the page being left. */
function openGuardedModal(dirty: boolean) {
	return mount(defineComponent({
		setup() {
			useModalUnsavedChanges(ref(dirty));
			return () => null;
		},
	}));
}

enableAutoUnmount(afterEach);

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

	// An open modal's unsaved edit is asked about before any Event store is
	// reset: "Keep editing" must leave the Event the edit saves against.
	describe('leaving the Event with an unsaved edit in an open modal', () => {
		const DESTINATIONS = [
			['/', {}],
			[
				'/event/2/matches',
				{ eventId: '2' },
			],
		] as const;

		beforeEach(() => {
			mockEventStore.event = { id: 1 };
			mockEventStore.loadEvent.mockImplementation(async (id: number) => {
				mockEventStore.event = { id };
			});
		});

		it.each(DESTINATIONS)('refuses %s and resets nothing when the operator keeps editing', async (path, params) => {
			confirmOpen.mockReturnValue({
				result: Promise.resolve(false),
			});
			openGuardedModal(true);

			const result = await runMiddleware(createRoute(path, params));

			expect(mockResetAllEventStores).not.toHaveBeenCalled();
			expect(mockEventStore.loadEvent).not.toHaveBeenCalled();
			expect(result).toBe(false);
		});

		it.each(DESTINATIONS)('goes on to %s once the operator discards the edit', async (path, params) => {
			confirmOpen.mockReturnValue({
				result: Promise.resolve(true),
			});
			openGuardedModal(true);

			const result = await runMiddleware(createRoute(path, params));

			expect(confirmOpen).toHaveBeenCalledOnce();
			expect(mockResetAllEventStores).toHaveBeenCalledOnce();
			expect(result).toBeUndefined();
		});

		it('does not ask for a modal with nothing unsaved, or one already closed', async () => {
			openGuardedModal(false);
			openGuardedModal(true).unmount();

			await runMiddleware(createRoute('/'));

			expect(confirmOpen).not.toHaveBeenCalled();
			expect(mockResetAllEventStores).toHaveBeenCalledOnce();
		});
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
			'/event/1/archetype-review',
			'/event/1/config/integrations',
		];
		const EVERY_CARD_GAME_PAGES = [
			'/event/1',
			'/event/1/players',
			'/event/1/metagame',
			'/event/1/metagame/cards',
			'/event/1/sync',
			'/event/1/card',
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
