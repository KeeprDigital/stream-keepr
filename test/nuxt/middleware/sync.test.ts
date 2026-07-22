import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockEventStore, mockNavigateTo } = vi.hoisted(() => ({
	mockEventStore: {
		event: null as { meleeEnabled?: boolean; meleeConfigured?: boolean; initialSetupCompletedAt?: Date | null } | null,
	},
	mockNavigateTo: vi.fn(),
}));

mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('navigateTo', () => mockNavigateTo);
mockNuxtImport('defineNuxtRouteMiddleware', () => (fn: any) => fn);

const { default: middleware } = await import('~/middleware/sync');

function createRoute(eventId = '1') {
	return { params: { eventId } } as any;
}

describe('sync middleware', () => {
	beforeEach(() => {
		mockEventStore.event = null;
		vi.clearAllMocks();
	});

	it('redirects to integrations when melee is disabled', async () => {
		mockEventStore.event = { meleeEnabled: false, meleeConfigured: false, initialSetupCompletedAt: null };

		await middleware(createRoute(), {} as any);

		expect(mockNavigateTo).toHaveBeenCalledWith('/event/1/config/integrations');
	});

	it('redirects to integrations when melee is not configured', async () => {
		mockEventStore.event = { meleeEnabled: true, meleeConfigured: false, initialSetupCompletedAt: null };

		await middleware(createRoute(), {} as any);

		expect(mockNavigateTo).toHaveBeenCalledWith('/event/1/config/integrations');
	});
});
