import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockUseEventRealtimeSession } = vi.hoisted(() => ({ mockUseEventRealtimeSession: vi.fn() }));

mockNuxtImport('useEventRealtimeSession', () => mockUseEventRealtimeSession);

describe('eventRealtimeSessionPlugin', () => {
	beforeEach(() => {
		mockUseEventRealtimeSession.mockReset();
	});

	it('declares it must run after the realtime plugin it consumes', async () => {
		const { default: plugin } = await import('~/plugins/event-realtime-session.client');

		expect((plugin as any).dependsOn).toEqual(['realtime']);
		expect((plugin as any)._name ?? (plugin as any).name).toBe('event-realtime-session');
	});

	it('starts the event realtime session workflow once on setup', async () => {
		const { default: plugin } = await import('~/plugins/event-realtime-session.client');

		await (plugin as any)({});

		expect(mockUseEventRealtimeSession).toHaveBeenCalledTimes(1);
	});
});
