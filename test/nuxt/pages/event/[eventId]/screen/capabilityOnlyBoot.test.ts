import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRouter } from '#app';
import { useCardStore } from '~/stores/card';
import { useScreenStore } from '~/stores/screen';
import { resetAllEventStores } from '~/utils/eventStores';

/**
 * A Screen Output boots on its capability alone (#604).
 *
 * The machine showing program has no operator and no cookie. So nothing here
 * mocks a signed-in Event loader: the real page, middleware and stores run, and
 * the API answers only what a capability-only browser would be answered — the
 * `/api/screen-output/**` reads, with the bearer — and refuses everything else
 * with the boundary's 401.
 */

const capability = 'HG7fQ2mS4kLp9xRt0ZbNvCyE1JdWqUoA3hMi5nTgKrs';

const api = vi.hoisted(() => ({
	screen: null as Record<string, unknown> | null,
	requests: [] as { path: string; authorization: string | undefined }[],
	answers: new Map<string, () => unknown>(),
}));

function unauthorized(path: string) {
	return Object.assign(new Error(`[GET] "${path}": 401 Unauthorized`), { statusCode: 401, status: 401 });
}

mockNuxtImport('$fetch', () => async (path: string, options: { headers?: Record<string, string> } = {}) => {
	const authorization = options.headers?.authorization;
	api.requests.push({ path, authorization });
	const answer = api.answers.get(path);
	if (!path.startsWith('/api/screen-output/') || authorization !== `Bearer ${capability}` || !answer)
		throw unauthorized(path);
	return structuredClone(answer());
});

vi.mock('~/composables/core/useRealtime', () => {
	const transport = {
		connectionId: 'connection-1',
		connectionState: 'connected',
		onRoom: () => {},
		offRoom: () => {},
		setRoom: () => {},
		onChannel: () => () => {},
		watchPresence: () => () => {},
	};
	return {
		useRealtime: () => transport,
		tryUseRealtime: () => transport,
	};
});

vi.mock('~/composables/screen/useScreenRealtimeSession', () => ({
	useScreenRealtimeSession: () => ({
		start: async () => {},
		stop: async () => {},
		updatePresenceData: async () => {},
	}),
}));

function screen(overrides: Record<string, unknown> = {}) {
	return {
		id: 7,
		eventId: 42,
		slug: 'main',
		name: 'Program',
		currentMode: 'player-history',
		screenConfig: { width: 1920, height: 1080 },
		modeConfigs: { 'player-history': { playerId: 11 } },
		stateVersion: 1,
		...overrides,
	};
}

function history(name: string) {
	return {
		player: { id: 11, eventId: 42, name, updatedAt: '2026-10-17T00:00:00.000Z' },
		history: [{
			id: 1,
			roundName: 'Round 1',
			roundNumber: 1,
			phaseName: 'Swiss',
			tableNumber: 4,
			opponentId: 12,
			opponentName: 'Opponent Name',
			opponentDeckName: null,
			opponentDeckColors: null,
			outcome: 'win',
			playerGameWins: 2,
			opponentGameWins: 0,
			gameDraws: 0,
			hasResult: true,
			resultString: null,
		}],
	};
}

const outputEvent = {
	id: 42,
	name: 'Capability Event',
	game: 'mtg',
	featureMatchOrientation: 'horizontal',
	displayRecordSeparator: '-',
	displayHideZeroDraws: true,
	displayPositionFormat: 'ordinal',
};

const mounted: { unmount: () => void }[] = [];

async function mountOutput(route: string, ready: (text: string) => boolean) {
	const pagePath = '../../../../../../app/pages/event/[eventId]/screen/[screenSlug].vue';
	const { default: ScreenOutputPage } = await import(pagePath);
	const wrapper = await mountSuspended(ScreenOutputPage, { route });
	mounted.push(wrapper);
	for (let round = 0; round < 200 && !ready(wrapper.text()); round++) {
		await flushPromises();
		await new Promise(resolve => setTimeout(resolve, 5));
	}
	return wrapper;
}

describe('a capability-only Screen Output', () => {
	beforeEach(() => {
		api.requests = [];
		api.screen = screen();
		api.answers = new Map<string, () => unknown>([
			['/api/screen-output/events/42/screens/slug/main', () => api.screen],
			['/api/screen-output/events/42/screens/7', () => api.screen],
			['/api/screen-output/events/42/screens/7/event', () => outputEvent],
			['/api/screen-output/events/42/screens/7/player-history', () => history('First Player')],
		]);
		resetAllEventStores();
	});

	afterEach(() => {
		for (const wrapper of mounted.splice(0))
			wrapper.unmount();
	});

	it('boots, loads its mode data and stays off the sign-in page with no session', async () => {
		const wrapper = await mountOutput(
			`/event/42/screen/main#asset-capability=${capability}`,
			text => text.includes('Opponent Name'),
		);

		expect(wrapper.text()).toContain('First Player');
		expect(wrapper.text()).toContain('Opponent Name');
		expect(useRouter().currentRoute.value.path).toBe('/event/42/screen/main');
		expect(api.requests.filter(request => !request.path.startsWith('/api/screen-output/'))).toEqual([]);
	});

	it('follows an operator\'s change of mode configuration through the capability lookup', async () => {
		const wrapper = await mountOutput(
			`/event/42/screen/main#asset-capability=${capability}`,
			text => text.includes('First Player'),
		);

		api.screen = screen({ stateVersion: 2, modeConfigs: { 'player-history': { playerId: 11, headerText: 'Changed Header' } } });
		api.answers.set('/api/screen-output/events/42/screens/7/player-history', () => history('Second Name'));
		await useScreenStore().applyRemoteUpdated({ eventId: 42, screenId: 7 } as never);
		for (let round = 0; round < 100 && !wrapper.text().includes('Changed Header'); round++) {
			await flushPromises();
			await new Promise(resolve => setTimeout(resolve, 5));
		}

		expect(wrapper.text()).toContain('Changed Header');
		expect(api.requests.filter(request => !request.path.startsWith('/api/screen-output/'))).toEqual([]);
	});

	it('hides an expired Card itself rather than clearing it on the server', async () => {
		api.screen = screen({ currentMode: 'card', modeConfigs: {} });
		api.answers.set('/api/screen-output/events/42/screens/7/card', () => ({
			id: 'expiring-card',
			name: 'Lightning Bolt',
			set: 'lea',
			layout: 'normal',
			imageData: { front: { small: 'https://example.com/s.jpg', normal: 'https://example.com/n.jpg' }, back: null },
			orientationData: { flipable: false, turnable: false, rotateable: false, counterRotateable: false },
			displayData: { flipped: false, rotated: false, counterRotated: false, turnedOver: false },
			timeoutData: { timeoutStartTimestamp: Date.now(), timeoutDuration: 2000 },
		}));

		await mountOutput(`/event/42/screen/main#asset-capability=${capability}`, () => useCardStore().activeCard !== null);
		expect(api.requests.map(request => request.path)).toContain('/api/screen-output/events/42/screens/7/card');
		expect(useCardStore().activeCard?.id).toBe('expiring-card');

		for (let round = 0; round < 400 && useCardStore().activeCard !== null; round++)
			await new Promise(resolve => setTimeout(resolve, 10));

		expect(useCardStore().activeCard).toBeNull();
		expect(api.requests.filter(request => !request.path.startsWith('/api/screen-output/'))).toEqual([]);
	});
});
