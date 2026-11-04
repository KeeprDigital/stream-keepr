import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockEventStore, mockNavigateTo } = vi.hoisted(() => ({
	mockEventStore: {
		event: null as { game?: 'mtg' | 'op'; meleeEnabled?: boolean; meleeConfigured?: boolean; initialSetupCompletedAt?: Date | null } | null,
	},
	mockNavigateTo: vi.fn(),
}));

mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('navigateTo', () => mockNavigateTo);
mockNuxtImport('defineNuxtRouteMiddleware', () => (fn: any) => fn);

const { default: middleware } = await import('~/middleware/sync');

function createRoute(eventId = '1') {
	return {
		params: { eventId },
	} as any;
}

describe('sync middleware', () => {
	beforeEach(() => {
		mockEventStore.event = null;
		vi.clearAllMocks();
	});

	it.each([
		[
			'melee is disabled',
			{ game: 'mtg', meleeEnabled: false, meleeConfigured: false },
		],
		[
			'melee is not configured',
			{ game: 'mtg', meleeEnabled: true, meleeConfigured: false },
		],
	] as const)('sends a Magic Event to integrations when %s', async (_label, event) => {
		mockEventStore.event = { ...event, initialSetupCompletedAt: null };

		await middleware(createRoute(), {} as any);

		expect(mockNavigateTo).toHaveBeenCalledWith('/event/1/config/integrations');
	});

	// Its Sync is the TCG+ Import (ADR-0074).
	it('lets a One Piece Event without Melee stay', async () => {
		mockEventStore.event = {
			game: 'op',
			meleeEnabled: false,
			meleeConfigured: false,
			initialSetupCompletedAt: null,
		};

		await middleware(createRoute(), {} as any);

		expect(mockNavigateTo).not.toHaveBeenCalled();
	});
});
