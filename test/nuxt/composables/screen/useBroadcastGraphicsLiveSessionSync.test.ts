import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { createAttachSignal, createContinuitySignal } from '~~/test/helpers/realtime-mock';

const mockLoadSession = vi.fn(async () => null);
let continuity = createContinuitySignal();
let attachment = createAttachSignal();
const mockRealtime = reactive({
	connectionState: 'connected',
	onContinuityLost: (channel: string, handler: () => void) => continuity.onContinuityLost(channel, handler),
	onceAttached: (channel: string, handler: () => void) => attachment.onceAttached(channel, handler),
});

mockNuxtImport('tryUseRealtime', () => () => mockRealtime);
mockNuxtImport('useBroadcastGraphicsLiveSessionStore', () => () => ({ loadSession: mockLoadSession }));

/**
 * The Live Session's own reasons to read its snapshot again: the Screen or
 * Event it follows changing, losing continuity, and its Event channel's first
 * attach after the first read went out.
 */
describe('useBroadcastGraphicsLiveSessionSync', () => {
	const scopes: Array<ReturnType<typeof effectScope>> = [];

	function follow(eventId = ref<number | undefined>(7), screenId = ref<number | undefined>(3)) {
		const scope = effectScope();
		scopes.push(scope);
		scope.run(() => useBroadcastGraphicsLiveSessionSync(eventId, screenId));
		return { eventId, screenId, scope };
	}

	beforeEach(() => {
		mockLoadSession.mockClear();
		continuity = createContinuitySignal();
		attachment = createAttachSignal();
	});

	afterEach(() => {
		scopes.splice(0).forEach(scope => scope.stop());
	});

	it('loads the snapshot of the Screen it follows', async () => {
		follow();
		await flushPromises();

		expect(mockLoadSession).toHaveBeenCalledExactlyOnceWith(7, 3);
	});

	it('reloads once its Event channel first attaches, because a command applied before then was heard by nothing (#733)', async () => {
		follow();
		await flushPromises();

		attachment.attach('event:7');
		await flushPromises();
		attachment.attach('event:7');
		await flushPromises();

		expect(mockLoadSession).toHaveBeenCalledTimes(2);
		expect(mockLoadSession).toHaveBeenLastCalledWith(7, 3);
	});

	it('does not reload when its Event channel was already attached before it loaded', async () => {
		attachment.attach('event:7');
		follow();
		await flushPromises();

		attachment.attach('event:7');
		await flushPromises();

		expect(mockLoadSession).toHaveBeenCalledTimes(1);
	});

	it('reloads once its Event channel is attached again having lost continuity', async () => {
		follow();
		await flushPromises();

		continuity.reattach('event:7');
		await flushPromises();

		expect(mockLoadSession).toHaveBeenCalledTimes(2);
	});

	it('stops waiting on the first attach once disposed', async () => {
		const { scope } = follow();
		await flushPromises();

		scope.stop();
		attachment.attach('event:7');
		await flushPromises();

		expect(mockLoadSession).toHaveBeenCalledTimes(1);
	});
});
