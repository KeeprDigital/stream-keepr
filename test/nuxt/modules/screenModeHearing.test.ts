import type { EffectScope } from 'vue';
import type { ScreenMode } from '~~/shared/types/enums';
import type { ModeConfigTypeMap } from '~~/shared/types/screenConfig';
import type { ScreenModeFreshnessTransport } from '~/modules/screen-mode/freshness';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultConfigForMode } from '~~/shared/types/screenConfig';
import { deferred } from '~~/test/helpers/deferred';
import { createFakeEventChannel } from '~~/test/helpers/realtime-mock';
import { screenContextOf } from '~~/test/nuxt/helpers/screenContext';
import { useScreenModeFreshness } from '~/modules/screen-mode/freshness';
import { useScreenModeHearing } from '~/modules/screen-mode/hearing';

/**
 * Screen Mode Data Freshness hearing by the shared rule: a live rendering on
 * its Screen's own channel, a rendering of authored state on its Event's.
 */

const SCREEN_ID = 5;
const scopes: EffectScope[] = [];

function harness<M extends ScreenMode>(
	mode: M,
	{ live, config = {}, follows }: { live: boolean; config?: Partial<ModeConfigTypeMap[M]>; follows?: Parameters<typeof useScreenModeHearing>[3] },
) {
	const realtime = createFakeEventChannel();
	const context = screenContextOf({
		eventId: computed(() => 1),
		screen: ref({ id: SCREEN_ID }),
		followsScreenChannel: ref(live),
	});
	const resolved = {
		...getDefaultConfigForMode(mode),
		...config,
	};
	const read = vi.fn(async (): Promise<string> => `read ${read.mock.calls.length}`);
	const scope = effectScope();
	scopes.push(scope);
	const freshness = scope.run(() => useScreenModeFreshness<string>({
		hearing: useScreenModeHearing(context, mode, () => resolved, follows),
		source: () => 'selected',
		read,
		initialData: 'none',
		errorMessage: 'Failed to read',
		realtime: realtime.transport as unknown as ScreenModeFreshnessTransport,
	}))!;
	return { ...realtime, read, freshness };
}

describe('a Screen Mode\'s read hearing by the shared rule', () => {
	beforeEach(() => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		scopes.splice(0).forEach(scope => scope.stop());
	});

	describe('on a live rendering', () => {
		// The server names the kinds that changed; the mode's declaration says which it shows.
		it.each([
			{
				mode: 'standings',
				causes: ['player'],
				reads: 2,
			},
			{
				mode: 'standings',
				causes: ['talent', 'roundStandings'],
				reads: 2,
			},
			{
				mode: 'standings',
				causes: ['talent'],
				reads: 1,
			},
			{
				mode: 'talent',
				causes: ['talent'],
				reads: 2,
			},
			{
				mode: 'talent',
				causes: ['player'],
				reads: 1,
			},
			// A kind a newer server names is heard rather than risk stale data on air.
			{
				mode: 'talent',
				causes: ['a kind this build does not know'],
				reads: 2,
			},
		] as const)('a $mode Screen told of $causes has read $reads times', async ({ mode, causes, reads }) => {
			const { read, deliverToScreen } = harness(mode, { live: true });
			await flushPromises();

			deliverToScreen(SCREEN_ID, 'output:modeDataChanged', { screenId: SCREEN_ID, causes });
			await flushPromises();

			expect(read).toHaveBeenCalledTimes(reads);
		});

		it('listens on its Screen\'s channel and on no Event channel', async () => {
			const { listenedChannels } = harness('standings', { live: true });
			await flushPromises();

			expect(listenedChannels()).toEqual([`screen:1:${SCREEN_ID}`]);
		});

		it('hears nothing of its Event\'s messages', async () => {
			const { read, deliver } = harness('standings', { live: true });
			await flushPromises();

			deliver('player:updated', {
				player: { id: 3 },
			});
			await flushPromises();

			expect(read).toHaveBeenCalledTimes(1);
		});

		it('pays one follow-up read for a burst of notices heard while a read is in flight, holding what it shows', async () => {
			const { read, deliverToScreen, freshness } = harness('standings', { live: true });
			await flushPromises();
			const held = deferred<string>();
			read.mockImplementationOnce(() => held.promise);

			for (let notice = 0; notice < 4; notice++) {
				deliverToScreen(SCREEN_ID, 'output:modeDataChanged', {
					screenId: SCREEN_ID,
					causes: ['player'],
				});
			}
			await flushPromises();
			expect(read).toHaveBeenCalledTimes(2);
			expect(freshness.data.value).toBe('read 1');

			for (let notice = 0; notice < 3; notice++) {
				deliverToScreen(SCREEN_ID, 'output:modeDataChanged', {
					screenId: SCREEN_ID,
					causes: ['player'],
				});
			}
			held.resolve('held read');
			await flushPromises();

			expect(read).toHaveBeenCalledTimes(3);
			expect(freshness.data.value).toBe('read 3');
		});

		it('re-reads once its Screen\'s channel is attached again having lost continuity', async () => {
			const { read, reattachScreen, reattach } = harness('standings', { live: true });
			await flushPromises();

			reattach(1);
			await flushPromises();
			expect(read).toHaveBeenCalledTimes(1);

			reattachScreen(SCREEN_ID);
			await flushPromises();
			expect(read).toHaveBeenCalledTimes(2);
		});

		it('re-reads once its Screen\'s channel first attaches', async () => {
			const { read, attachScreen } = harness('standings', { live: true });
			await flushPromises();

			attachScreen(SCREEN_ID);
			await flushPromises();

			expect(read).toHaveBeenCalledTimes(2);
		});

		it('hears no cause when its read answers none of the mode\'s kinds', async () => {
			const { read, deliverToScreen } = harness('deck', {
				live: true,
				follows: { follows: [] },
			});
			await flushPromises();

			deliverToScreen(SCREEN_ID, 'output:modeDataChanged', {
				screenId: SCREEN_ID,
				causes: ['featureMatchSlot'],
			});
			await flushPromises();

			expect(read).toHaveBeenCalledTimes(1);
		});
	});

	describe('on a rendering of authored state', () => {
		// The same rule, applied here to the Event's messages and the configuration rendered.
		it.each([
			{
				mode: 'standings',
				config: {},
				type: 'player:updated',
				payload: {
					player: { id: 3 },
				},
				reads: 2,
			},
			{
				mode: 'standings',
				config: {},
				type: 'talent:updated',
				payload: {
					talent: { id: 3 },
				},
				reads: 1,
			},
			{
				mode: 'talent',
				config: { talentId: 3 },
				type: 'talent:updated',
				payload: {
					talent: { id: 3 },
				},
				reads: 2,
			},
			{
				mode: 'talent',
				config: { talentId: 3 },
				type: 'talent:updated',
				payload: {
					talent: { id: 4 },
				},
				reads: 1,
			},
			{
				mode: 'pairings',
				config: { roundId: 8 },
				type: 'melee:pairingsSynced',
				payload: { roundId: 8 },
				reads: 2,
			},
			// Its Screen and Event context are the display session's to re-read, not the mode's.
			{
				mode: 'standings',
				config: {},
				type: 'screen:updated',
				payload: { screenId: SCREEN_ID },
				reads: 1,
			},
			{
				mode: 'standings',
				config: {},
				type: 'event:updated',
				payload: {
					event: { id: 1 },
				},
				reads: 1,
			},
		] as const)('a $mode preview hearing $type has read $reads times', async ({ mode, config, type, payload, reads }) => {
			const { read, deliver } = harness(mode, { live: false, config: config as never });
			await flushPromises();

			deliver(type, payload);
			await flushPromises();

			expect(read).toHaveBeenCalledTimes(reads);
		});

		it('listens on its Event\'s channel and on no Screen channel', async () => {
			const { listenedChannels } = harness('standings', { live: false });
			await flushPromises();

			expect(listenedChannels()).toEqual(['event:1']);
		});

		it('hears nothing of a Screen channel\'s notices', async () => {
			const { read, deliverToScreen } = harness('standings', { live: false });
			await flushPromises();

			deliverToScreen(SCREEN_ID, 'output:modeDataChanged', {
				screenId: SCREEN_ID,
				causes: ['player'],
			});
			await flushPromises();

			expect(read).toHaveBeenCalledTimes(1);
		});
	});
});
