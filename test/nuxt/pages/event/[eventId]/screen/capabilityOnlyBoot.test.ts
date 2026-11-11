import type { MtgCard } from '~/types/card/mtg';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';
import { deferred } from '~~/test/helpers/deferred';
import { createMockFeatureMatchState, createWireMockFeatureMatch } from '~~/test/helpers/fixtures';
import { settleUntil, settleUntilStill } from '~~/test/helpers/settle';
import { useRouter } from '#app';
import { tryUseRealtime } from '~/composables/core/useRealtime';
import { screenModeSampleConfigs, useSampleScreenOutputReadRepository } from '~/modules/screen-mode/sampleDataset';
import { SCREEN_OUTPUT_LOAD_RETRY_MS } from '~/modules/screen/displaySession';
import ScreenOutputPage from '~/pages/event/[eventId]/screen/[screenSlug].vue';
import { useBroadcastGraphicsLiveSessionStore } from '~/stores/broadcastGraphicsLiveSession';
import { useCardStore } from '~/stores/card';
import { useFeatureMatchStore } from '~/stores/featureMatch';
import { useFeatureMatchStateStore } from '~/stores/featureMatchState';
import { usePlayerStore } from '~/stores/player';
import { resetAllEventStores } from '~/utils/eventStores';
// The page loads each Screen Mode's Display on first use; loaded here, no
// test's own time pays for transforming one.
import '~/components/Screen/Modes/BroadcastGraphics/Display.vue';
import '~/components/Screen/Modes/Card/Display.vue';
import '~/components/Screen/Modes/Metagame/Display.vue';
import '~/components/Screen/Modes/PlayerHistory/Display.vue';
import '~/components/Screen/Modes/Standings/Display.vue';
import '~/components/Screen/Modes/TopCards/Display.vue';

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
	// Answered on a later task, as the network would: a read that re-issues
	// itself on its own answer then shows as a count, not a starved event loop.
	await new Promise(resolve => setTimeout(resolve, 0));
	const answer = api.answers.get(path);
	if (!path.startsWith('/api/screen-output/') || authorization !== `Bearer ${capability}` || !answer)
		throw unauthorized(path);
	const value = answer();
	return value instanceof Promise
		? value
		: structuredClone(value);
});

vi.mock('~/composables/core/useRealtime', async () => {
	const { reactive } = await import('vue');
	const { createAttachSignal, createContinuitySignal } = await import('~~/test/helpers/realtime-mock');
	const continuity = createContinuitySignal();
	const attaches = createAttachSignal();
	type Handler = (message: Record<string, unknown>) => void;
	const handlers = new Map<string, Set<Handler>>();
	const transport = reactive({
		connectionId: 'connection-1',
		connectionState: 'connected',
		tokenError: null,
		/** The Event room the Realtime Event Session joined, or `null` while it is in none. */
		room: null as string | null,
		onRoom: () => {},
		offRoom: () => {},
		setRoom: (room: string | null) => {
			transport.room = room;
		},
		onContinuityLost: continuity.onContinuityLost,
		onceAttached: attaches.onceAttached,
		onChannel: (channel: string, type: string, handler: Handler) => {
			const key = `${channel}|${type}`;
			if (!handlers.has(key))
				handlers.set(key, new Set());
			handlers.get(key)!.add(handler);
			return () => handlers.get(key)!.delete(handler);
		},
		watchPresence: () => () => {},
		/** Signal a channel attached again having lost continuity. */
		reattach: continuity.reattach,
		/** Signal a channel's attach; `detach` returns it to not yet attached. */
		attach: attaches.attach,
		detach: attaches.detach,
		/** The channels something listens on now: a message handler, or a wait on its attach or continuity. */
		listenedChannels: () => [
			...new Set([
				...[...handlers].filter(([, listening]) => listening.size > 0).map(([key]) => key.split('|')[0]!),
				...continuity.watched(),
				...attaches.awaited(),
			]),
		].sort(),
		/** Deliver one message to whoever listens on its channel, as the transport would. */
		deliver: (channel: string, type: string, message: Record<string, unknown>) => {
			for (const handler of handlers.get(`${channel}|${type}`) ?? [])
				handler(message);
		},
	});
	return {
		useRealtime: () => transport,
		tryUseRealtime: () => transport,
	};
});

/**
 * The Feature Match Overlay's own rendering (Frame, compositor) re-patches
 * styles without end under happy-dom and starves the timers these tests settle
 * on. A probe stands in for it, rendering what the real mode data composable
 * answers: the Session's life total and the Round the Slot follows.
 */
vi.mock('~/components/Screen/Modes/FeatureMatchOverlay/Display.vue', async () => {
	const { defineComponent, h } = await import('vue');
	const { useFeatureMatchOverlayModeData } = await import('~/composables/screen/useFeatureMatchOverlayModeData');
	const { useScreenContext } = await import('~/composables/screen/useScreenContext');
	return {
		// `defineAsyncComponent` takes `default` only from a module it recognises as one.
		__esModule: true,
		default: defineComponent({
			setup() {
				const { matchState, round } = useFeatureMatchOverlayModeData(useScreenContext());
				return () => h('div', `Life ${matchState.value?.player1.lifeTotal ?? '-'} · ${round.value?.name ?? '-'}`);
			},
		}),
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
		modeConfigs: {
			'player-history': { playerId: 11 },
		},
		stateVersion: 1,
		...overrides,
	};
}

function history(name: string, result: Record<string, unknown> = {}) {
	return {
		player: {
			id: 11,
			eventId: 42,
			name,
			updatedAt: '2026-10-17T00:00:00.000Z',
		},
		history: [
			{
				id: 1,
				roundId: 31,
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
				...result,
			},
		],
	};
}

function topCards(name: string) {
	return {
		entries: [
			{
				id: 1,
				name,
				inclusionRate: 80,
				avgCopies: 4,
				totalCopies: 16,
				deckCount: 4,
				mainboardCount: 16,
				sideboardCount: 0,
				mainboardDeckCount: 4,
				sideboardDeckCount: 0,
				cardType: 'Instant',
				scryfallId: null,
				colors: 'R',
				cmc: 1,
				manaCost: '{R}',
			},
		],
		totalDecks: 5,
		scope: 'all',
	};
}

function metagame(archetype: string) {
	return {
		viewMode: 'archetype',
		breakdown: {
			entries: [
				{
					name: archetype,
					count: 2,
					metaShare: 100,
					colors: 'R',
				},
			],
			totalPlayers: 2,
			scope: 'all',
		},
	};
}

const pendingResult = {
	outcome: 'pending',
	hasResult: false,
	playerGameWins: null,
	opponentGameWins: null,
};
const recordedLoss = {
	outcome: 'loss',
	hasResult: true,
	playerGameWins: 1,
	opponentGameWins: 2,
};

/** The channel a live rendering of the Screen follows: the Screen's own, and no other. */
const SCREEN_CHANNEL = 'screen:42:7';
/** Its Event's channel, which only an operator page or a preview hears. */
const EVENT_CHANNEL = 'event:42';

/** The output's stand-in transport, with a hand to deliver a channel's messages and signal a reattach. */
function realtime() {
	return tryUseRealtime() as unknown as {
		connectionState: string;
		room: string | null;
		listenedChannels: () => string[];
		reattach: (channel: string) => void;
		attach: (channel: string) => void;
		detach: (channel: string) => void;
		deliver: (channel: string, type: string, message: Record<string, unknown>) => void;
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

/** A Screen Card as the Card read and `card:updated` carry it. */
function spotlightCard(id: string, timeoutData: Record<string, unknown> | null = null) {
	return {
		id,
		name: 'Lightning Bolt',
		set: 'lea',
		layout: 'normal',
		imageData: {
			front: { small: 'https://example.com/s.jpg', normal: 'https://example.com/n.jpg' },
			back: null,
		},
		orientationData: {
			flipable: false,
			turnable: false,
			rotateable: false,
			counterRotateable: false,
		},
		displayData: {
			flipped: false,
			rotated: false,
			counterRotated: false,
			turnedOver: false,
		},
		timeoutData,
	};
}

/** A Broadcast Graphics Live Session with nothing taken. */
const nothingOnAir = {
	id: 3,
	eventId: 42,
	screenId: 7,
	status: 'active',
	currentState: { playout: {}, inputs: {}, sources: {} },
	recoveryFault: null,
	sequence: 1,
	endedAt: null,
	createdAt: '2026-10-17T00:00:00.000Z',
	updatedAt: '2026-10-17T00:00:00.000Z',
};

const mounted: { unmount: () => void; html: () => string }[] = [];

/**
 * Waits until the output stops reading and re-rendering, for asserting what
 * it never does.
 */
function settleOutput() {
	return settleUntilStill(() => [
		api.requests.length,
		mounted.map(wrapper => wrapper.html()),
	]);
}

async function mountOutput(route: string, ready: (text: string) => boolean) {
	const wrapper = await mountSuspended(ScreenOutputPage, { route });
	mounted.push(wrapper);
	await settleUntil(() => ready(wrapper.text()));
	return wrapper;
}

describe('a capability-only Screen Output', () => {
	beforeEach(() => {
		api.requests = [];
		api.screen = screen();
		api.answers = new Map<string, () => unknown>([
			[
				'/api/screen-output/events/42/screens/slug/main',
				() => api.screen,
			],
			[
				'/api/screen-output/events/42/screens/7',
				() => api.screen,
			],
			[
				'/api/screen-output/events/42/screens/7/event',
				() => outputEvent,
			],
			[
				'/api/screen-output/events/42/screens/7/player-history',
				() => history('First Player'),
			],
		]);
		resetAllEventStores();
		realtime().connectionState = 'connected';
		realtime().detach(SCREEN_CHANNEL);
	});

	afterEach(() => {
		for (const wrapper of mounted.splice(0))
			wrapper.unmount();
		vi.useRealTimers();
	});

	it('shows a mode change published before its Screen channel first attached, without a reload', async () => {
		// Its Screen's channel attaches only once the Screen lookup names it, after
		// that read answered; a change published in between reached no listener (#727).
		const wrapper = await mountOutput(
			`/event/42/screen/main#asset-capability=${capability}`,
			text => text.includes('First Player'),
		);

		api.screen = screen({
			stateVersion: 2,
			modeConfigs: {
				'player-history': { playerId: 11, headerText: 'Changed Header' },
			},
		});
		realtime().attach(SCREEN_CHANNEL);
		await settleUntil(() => wrapper.text().includes('Changed Header'));

		expect(wrapper.text()).toContain('Changed Header');
		expect(api.requests.filter(request => !request.path.startsWith('/api/screen-output/'))).toEqual([]);
	});

	// A live rendering follows its Screen's own channel and nothing of its Event's; a
	// preview renders configuration the server has not been given, and stays in its Event's room.
	it.each([
		{
			rendering: 'a Screen Output',
			query: '',
			room: null,
			listens: [SCREEN_CHANNEL],
		},
		{
			rendering: 'a Program monitor',
			query: '?embed=monitor',
			room: null,
			listens: [SCREEN_CHANNEL],
		},
		{
			rendering: 'an editor preview',
			query: '?embed=preview',
			room: EVENT_CHANNEL,
			listens: [EVENT_CHANNEL],
		},
	])('$rendering joins the room $room and listens on $listens alone', async ({ query, room, listens }) => {
		await mountOutput(
			`/event/42/screen/main${query}#asset-capability=${capability}`,
			text => text.includes('First Player'),
		);
		await settleOutput();

		expect(realtime().room).toBe(room);
		expect(realtime().listenedChannels()).toEqual(listens);
	});

	it('hears nothing its Event channel carries', async () => {
		api.answers.set('/api/screen-output/events/42/screens/7/player-history', () => history('First Player', pendingResult));
		const wrapper = await mountOutput(
			`/event/42/screen/main#asset-capability=${capability}`,
			text => text.includes('Pending'),
		);
		const reads = api.requests.length;

		api.answers.set('/api/screen-output/events/42/screens/7/player-history', () => history('First Player', recordedLoss));
		realtime().deliver(EVENT_CHANNEL, 'match:updated', {
			eventId: 42,
			match: {
				id: 1,
				eventId: 42,
				roundId: 31,
				player1Id: 12,
				player2Id: 11,
				hasResult: true,
			},
		});
		realtime().deliver(EVENT_CHANNEL, 'screen:updated', { eventId: 42, screenId: 7 });
		realtime().deliver(EVENT_CHANNEL, 'event:deleted', { eventId: 42 });
		await settleOutput();

		expect(wrapper.text()).toContain('Pending');
		expect(api.requests).toHaveLength(reads);
		expect(useRouter().currentRoute.value.path).toBe('/event/42/screen/main');
	});

	it('keeps what it shows while a re-read its Screen channel asked for is in flight', async () => {
		api.answers.set('/api/screen-output/events/42/screens/7/player-history', () => history('First Player', pendingResult));
		const wrapper = await mountOutput(
			`/event/42/screen/main#asset-capability=${capability}`,
			text => text.includes('Pending'),
		);
		const read = deferred<unknown>();
		api.answers.set('/api/screen-output/events/42/screens/7/player-history', () => read.promise);
		const reads = () => api.requests.filter(request => request.path.endsWith('/player-history')).length;
		const before = reads();

		realtime().deliver(SCREEN_CHANNEL, 'output:modeDataChanged', {
			eventId: 42,
			screenId: 7,
			causes: ['match'],
		});
		await settleUntil(() => reads() === before + 1);
		expect(wrapper.text()).toContain('First Player');
		expect(wrapper.text()).toContain('Pending');

		read.resolve(history('First Player', recordedLoss));
		await settleUntil(() => wrapper.text().includes('LOSS'));
		expect(wrapper.text()).toContain('LOSS');
	});

	it('reads nothing for a cause its mode does not follow', async () => {
		await mountOutput(
			`/event/42/screen/main#asset-capability=${capability}`,
			text => text.includes('First Player'),
		);
		const reads = api.requests.length;

		realtime().deliver(SCREEN_CHANNEL, 'output:modeDataChanged', {
			eventId: 42,
			screenId: 7,
			causes: ['talent'],
		});
		await settleOutput();

		expect(api.requests).toHaveLength(reads);
	});

	// A mode change is announced as `screen:updated` alone: the Screen re-read mounts the new mode, which reads.
	it('shows the new mode\'s data after a mode change its Screen channel announced', async () => {
		const wrapper = await mountOutput(
			`/event/42/screen/main#asset-capability=${capability}`,
			text => text.includes('First Player'),
		);

		api.screen = screen({
			stateVersion: 2,
			currentMode: 'top-cards',
			modeConfigs: {
				'top-cards': { showRankBadges: true },
			},
		});
		api.answers.set('/api/screen-output/events/42/screens/7/top-cards', () => topCards('Lightning Bolt'));
		realtime().deliver(SCREEN_CHANNEL, 'screen:updated', { eventId: 42, screenId: 7 });
		await settleUntil(() => wrapper.text().includes('Lightning Bolt'));

		expect(wrapper.text()).toContain('Lightning Bolt');
		expect(wrapper.text()).not.toContain('First Player');
	});

	it('goes blank where it is when its Screen is deleted, and stops listening', async () => {
		const wrapper = await mountOutput(
			`/event/42/screen/main#asset-capability=${capability}`,
			text => text.includes('First Player'),
		);

		realtime().deliver(SCREEN_CHANNEL, 'screen:deleted', { eventId: 42, screenId: 7 });
		await settleUntil(() => !wrapper.text().includes('First Player'));

		expect(wrapper.text()).toBe('');
		expect(useRouter().currentRoute.value.path).toBe('/event/42/screen/main');
		expect(realtime().listenedChannels().filter(channel => channel === EVENT_CHANNEL)).toEqual([]);
	});

	// A deleted Event's Screens are gone with it, so nothing tells the output: it holds
	// what it shows through every read that now answers nothing.
	it('holds what it shows where it is once its Event is gone', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const wrapper = await mountOutput(
			`/event/42/screen/main#asset-capability=${capability}`,
			text => text.includes('First Player'),
		);

		api.answers.clear();
		realtime().deliver(SCREEN_CHANNEL, 'output:eventContextChanged', { eventId: 42 });
		realtime().reattach(SCREEN_CHANNEL);
		await settleOutput();

		expect(wrapper.text()).toContain('First Player');
		expect(useRouter().currentRoute.value.path).toBe('/event/42/screen/main');
	});

	it('shows the Card its Screen channel carries, and hides it when cleared', async () => {
		api.screen = screen({ currentMode: 'card', modeConfigs: {} });
		api.answers.set('/api/screen-output/events/42/screens/7/card', () => ({ card: null, revision: 1 }));
		const cardReads = () => api.requests.filter(request => request.path.endsWith('/screens/7/card')).length;
		await mountOutput(`/event/42/screen/main#asset-capability=${capability}`, () => cardReads() > 0);
		await settleOutput();
		const reads = cardReads();

		realtime().deliver(SCREEN_CHANNEL, 'card:updated', {
			eventId: 42,
			screenId: 7,
			revision: 2,
			card: spotlightCard('announced-card'),
		});
		await settleUntil(() => useCardStore().activeCard !== null);
		expect(useCardStore().activeCard?.id).toBe('announced-card');

		realtime().deliver(SCREEN_CHANNEL, 'card:cleared', { eventId: 42, screenId: 7, revision: 3 });
		await settleUntil(() => useCardStore().activeCard === null);

		expect(useCardStore().activeCard).toBeNull();
		expect(cardReads()).toBe(reads);
	});

	it('applies a Broadcast Graphics command its Screen channel forwards, and reloads on one ahead of the sequence it holds', async () => {
		api.screen = screen({ currentMode: 'broadcast-graphics', modeConfigs: {} });
		const liveSessionPath = '/api/screen-output/events/42/screens/7/broadcast-graphics/live-session';
		api.answers.set(liveSessionPath, () => nothingOnAir);
		const held = () => useBroadcastGraphicsLiveSessionStore().sessions.get(7)?.sequence;
		const reads = () => api.requests.filter(request => request.path === liveSessionPath).length;
		await mountOutput(`/event/42/screen/main#asset-capability=${capability}`, () => held() === 1);
		await settleOutput();
		const before = reads();

		// The next sequence, carrying what it changed: applied with no read.
		realtime().deliver(SCREEN_CHANNEL, 'broadcastGraphicsLiveSession:commandApplied', {
			eventId: 42,
			screenId: 7,
			sessionId: 3,
			sequence: 2,
			commandType: 'Out',
			change: {},
		});
		await settleUntil(() => held() === 2);
		expect(reads()).toBe(before);

		// Sequence 3 never arrived: 4 is a gap, which only the snapshot can close.
		api.answers.set(liveSessionPath, () => ({ ...nothingOnAir, sequence: 4 }));
		realtime().deliver(SCREEN_CHANNEL, 'broadcastGraphicsLiveSession:commandApplied', {
			eventId: 42,
			screenId: 7,
			sessionId: 3,
			sequence: 4,
			commandType: 'Out',
			change: {},
		});
		await settleUntil(() => held() === 4);

		expect(reads()).toBe(before + 1);
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

		api.screen = screen({
			stateVersion: 2,
			modeConfigs: {
				'player-history': { playerId: 11, headerText: 'Changed Header' },
			},
		});
		api.answers.set('/api/screen-output/events/42/screens/7/player-history', () => history('Second Name'));
		realtime().deliver(SCREEN_CHANNEL, 'screen:updated', { eventId: 42, screenId: 7 });
		await settleUntil(() => wrapper.text().includes('Changed Header'));

		expect(wrapper.text()).toContain('Changed Header');
		expect(api.requests.filter(request => !request.path.startsWith('/api/screen-output/'))).toEqual([]);
	});

	it('follows a Match result recorded elsewhere, with no operator surface open', async () => {
		api.answers.set('/api/screen-output/events/42/screens/7/player-history', () => history('First Player', pendingResult));
		const wrapper = await mountOutput(
			`/event/42/screen/main#asset-capability=${capability}`,
			text => text.includes('Pending'),
		);
		const screenReads = api.requests.filter(request => request.path === '/api/screen-output/events/42/screens/7').length;

		// Another browser records the result: Event, Player and Screen configuration
		// are unchanged, so nothing but its Screen channel naming the cause says to re-read.
		api.answers.set('/api/screen-output/events/42/screens/7/player-history', () => history('First Player', recordedLoss));
		realtime().deliver(SCREEN_CHANNEL, 'output:modeDataChanged', {
			eventId: 42,
			screenId: 7,
			causes: ['match'],
		});
		await settleUntil(() => wrapper.text().includes('LOSS'));

		expect(wrapper.text()).toContain('LOSS');
		expect(api.requests.filter(request => request.path === '/api/screen-output/events/42/screens/7')).toHaveLength(screenReads);
		expect(api.requests.filter(request => !request.path.startsWith('/api/screen-output/'))).toEqual([]);
	});

	it('shows a result missed while disconnected once its Screen channel is attached again', async () => {
		api.answers.set('/api/screen-output/events/42/screens/7/player-history', () => history('First Player', pendingResult));
		const wrapper = await mountOutput(
			`/event/42/screen/main#asset-capability=${capability}`,
			text => text.includes('Pending'),
		);

		realtime().connectionState = 'suspended';
		await flushPromises();
		// Published while suspended, so never delivered. The page's own Screen
		// re-read is held back, so no configuration replacement can stand in for
		// the mode's resync.
		api.answers.set('/api/screen-output/events/42/screens/7/player-history', () => history('First Player', recordedLoss));
		api.answers.set('/api/screen-output/events/42/screens/slug/main', () => new Promise(() => {}));
		realtime().connectionState = 'connected';
		realtime().reattach(SCREEN_CHANNEL);
		await settleUntil(() => wrapper.text().includes('LOSS'));

		expect(wrapper.text()).toContain('LOSS');
		expect(api.requests.filter(request => !request.path.startsWith('/api/screen-output/'))).toEqual([]);
	});

	it('follows a deck review on a Most Played Cards output, with no roster or settings panel loaded', async () => {
		api.screen = screen({
			currentMode: 'top-cards',
			modeConfigs: {
				'top-cards': { showRankBadges: true },
			},
		});
		api.answers.set('/api/screen-output/events/42/screens/7/top-cards', () => topCards('Lightning Bolt'));
		const wrapper = await mountOutput(
			`/event/42/screen/main#asset-capability=${capability}`,
			text => text.includes('Lightning Bolt'),
		);

		// Reviewed in another browser: no Player record, Screen configuration or
		// roster changes, so only the aggregate's own invalidation says to re-read.
		api.answers.set('/api/screen-output/events/42/screens/7/top-cards', () => topCards('Counterspell'));
		realtime().deliver(SCREEN_CHANNEL, 'output:modeDataChanged', {
			eventId: 42,
			screenId: 7,
			causes: ['playerDeck'],
		});
		await settleUntil(() => wrapper.text().includes('Counterspell'));

		expect(wrapper.text()).toContain('Counterspell');
		expect(usePlayerStore().dataVersion).toBe(0);
		expect(api.requests.filter(request => !request.path.startsWith('/api/screen-output/'))).toEqual([]);
	});

	it('follows membership of the Player List driving a Metagame output, with no roster or settings panel loaded', async () => {
		api.screen = screen({
			currentMode: 'metagame',
			modeConfigs: {
				metagame: { scope: 'playerList', playerListId: 5 },
			},
		});
		api.answers.set('/api/screen-output/events/42/screens/7/metagame', () => metagame('Mono Red'));
		const wrapper = await mountOutput(
			`/event/42/screen/main#asset-capability=${capability}`,
			text => text.includes('Mono Red'),
		);

		api.answers.set('/api/screen-output/events/42/screens/7/metagame', () => metagame('Azorius Control'));
		realtime().deliver(SCREEN_CHANNEL, 'output:modeDataChanged', {
			eventId: 42,
			screenId: 7,
			causes: ['playerList'],
		});
		await settleUntil(() => wrapper.text().includes('Azorius Control'));

		expect(wrapper.text()).toContain('Azorius Control');
		expect(usePlayerStore().dataVersion).toBe(0);
		expect(api.requests.filter(request => !request.path.startsWith('/api/screen-output/'))).toEqual([]);
	});

	it('shows a Metagame change missed while disconnected once its Screen channel is attached again', async () => {
		api.screen = screen({
			currentMode: 'metagame',
			modeConfigs: { metagame: {} },
		});
		api.answers.set('/api/screen-output/events/42/screens/7/metagame', () => metagame('Mono Red'));
		const wrapper = await mountOutput(
			`/event/42/screen/main#asset-capability=${capability}`,
			text => text.includes('Mono Red'),
		);

		realtime().connectionState = 'suspended';
		await flushPromises();
		api.answers.set('/api/screen-output/events/42/screens/7/metagame', () => metagame('Azorius Control'));
		api.answers.set('/api/screen-output/events/42/screens/slug/main', () => new Promise(() => {}));
		realtime().connectionState = 'connected';
		realtime().reattach(SCREEN_CHANNEL);
		await settleUntil(() => wrapper.text().includes('Azorius Control'));

		expect(wrapper.text()).toContain('Azorius Control');
		expect(api.requests.filter(request => !request.path.startsWith('/api/screen-output/'))).toEqual([]);
	});

	it('hides an expired Card itself rather than clearing it on the server', async () => {
		// The Card Timeout runs out on a fake clock that otherwise keeps real time.
		const cardTimeoutMs = 2000;
		vi.useFakeTimers({
			toFake: ['setTimeout', 'clearTimeout'],
			shouldAdvanceTime: true,
		});
		api.screen = screen({ currentMode: 'card', modeConfigs: {} });
		// The Card read answers the Card with its Card revision (#734).
		api.answers.set('/api/screen-output/events/42/screens/7/card', () => ({
			card: spotlightCard('expiring-card', {
				timeoutStartTimestamp: Date.now(),
				timeoutDuration: cardTimeoutMs,
			}),
			revision: 1,
		}));

		await mountOutput(`/event/42/screen/main#asset-capability=${capability}`, () => useCardStore().activeCard !== null);
		expect(api.requests.map(request => request.path)).toContain('/api/screen-output/events/42/screens/7/card');
		expect(useCardStore().activeCard?.id).toBe('expiring-card');

		await vi.advanceTimersByTimeAsync(cardTimeoutMs);
		await flushPromises();

		expect(useCardStore().activeCard).toBeNull();
		expect(api.requests.filter(request => !request.path.startsWith('/api/screen-output/'))).toEqual([]);
	});

	// The Screen Mode Sample Dataset is a Theme preview's alone: an output with
	// nothing to show renders nothing, never the sample.
	it.each([
		[
			'answers no Players',
			() => ({
				players: [],
				round: null,
				roundStandings: null,
				watchlist: null,
				previousRoundPositions: null,
			}),
		],
		[
			'fails',
			() => Promise.reject(new Error('unavailable')),
		],
	])('shows no sample Player when its Standings read %s', async (_case, answer) => {
		api.screen = screen({ currentMode: 'standings', modeConfigs: {} });
		api.answers.set('/api/screen-output/events/42/screens/7/standings', answer);
		const standingsRead = () => api.requests.some(request => request.path.endsWith('/screens/7/standings'));

		const wrapper = await mountOutput(`/event/42/screen/main#asset-capability=${capability}`, standingsRead);
		// Nothing appears to wait on, so the read's answer settles to render.
		await settleOutput();

		const { players } = await useSampleScreenOutputReadRepository('mtg').standings({ eventId: 42, screenId: 7 });
		expect(standingsRead()).toBe(true);
		expect(players.map(({ name }) => name).filter(name => wrapper.text().includes(name))).toEqual([]);
	});

	/** What a rendering of the sample Screen Card or sample Broadcast Graphic would put on air. */
	async function sampleOnAirMarks() {
		const { card } = await useSampleScreenOutputReadRepository('mtg').card({ eventId: 42, screenId: 7 });
		const [lowerThird] = screenModeSampleConfigs('broadcast-graphics', 'mtg')['broadcast-graphics']!.graphics!;
		return [
			(card as MtgCard).imageData.front!.normal,
			...lowerThird!.items.flatMap(item => item.type === 'text'
				? [item.text]
				: []),
		];
	}

	it.each([
		[
			'card',
			'card',
			'answers no Card',
			() => ({ card: null, revision: 1 }),
		],
		[
			'card',
			'card',
			'fails',
			() => Promise.reject(new Error('unavailable')),
		],
		[
			'broadcast-graphics',
			'broadcast-graphics/live-session',
			'has nothing on air',
			() => nothingOnAir,
		],
		[
			'broadcast-graphics',
			'broadcast-graphics/live-session',
			'fails',
			() => Promise.reject(new Error('unavailable')),
		],
	])('shows no sample Card or Broadcast Graphic when a %s output\'s %s read %s', async (mode, resource, _case, answer) => {
		// No config of its own: the mode's defaults, never the sample's, fill it.
		api.screen = screen({ currentMode: mode, modeConfigs: {} });
		api.answers.set(`/api/screen-output/events/42/screens/7/${resource}`, answer);
		const read = () => api.requests.some(request => request.path.endsWith(`/screens/7/${resource}`));

		const wrapper = await mountOutput(`/event/42/screen/main#asset-capability=${capability}`, read);
		await settleOutput();

		expect(read()).toBe(true);
		expect((await sampleOnAirMarks()).filter(mark => wrapper.html().includes(mark))).toEqual([]);
	});
});

/**
 * A capability-only Feature Match Overlay follows its Slot's Feature Match
 * Session through the Live State Follower (#592): the operator surface's
 * ordering guarantees, with no operator Session to read through.
 */
describe('a capability-only Feature Match Overlay output', () => {
	const slotPath = '/api/screen-output/events/42/screens/7/feature-match-slots/11';

	function overlayScreen() {
		const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		config.featureMatchId = 11;
		return screen({
			currentMode: 'feature-match-overlay',
			modeConfigs: { 'feature-match-overlay': config },
		});
	}

	function session(id: number, sequence: number, lifeTotal: number, matchId = 300) {
		const currentState = createMockFeatureMatchState();
		currentState.player1 = { ...currentState.player1, lifeTotal };
		return {
			id,
			eventId: 42,
			slotId: 11,
			status: 'active',
			sourceSnapshot: {
				eventId: 42,
				slotId: 11,
				matchId,
				player1: { name: 'Alice' },
				player2: { name: 'Bob' },
			},
			currentState,
			sequence,
			closedAt: null,
			createdAt: '2026-10-17T00:00:00.000Z',
			updatedAt: '2026-10-17T00:00:00.000Z',
		};
	}

	/** The Round each Match the Slot can follow is played in. */
	const roundOfMatch: Record<number, { id: number; name: string }> = {
		300: { id: 20, name: 'Round 3' },
		301: { id: 21, name: 'Round 4' },
	};

	/** What the Screen's Slot read answers: the Slot, its Session, and the Match, Round and Phase it follows. */
	function slotRead(activeSession: ReturnType<typeof session>, matchId = 300) {
		const round = roundOfMatch[matchId]!;
		return {
			slot: {
				...createWireMockFeatureMatch({
					id: 11,
					eventId: 42,
					matchId,
					activeSessionId: activeSession.id,
				}),
				activeSession,
			},
			match: { id: matchId, eventId: 42, roundId: round.id },
			round: { ...round, eventId: 42, phaseId: 5 },
			phase: { id: 5, eventId: 42, name: 'Swiss' },
		};
	}

	/** One `featureMatchSession:eventApplied`, as the Screen's channel forwards it at the Event's sequence. */
	function sessionEvent(announced: ReturnType<typeof session>) {
		realtime().deliver(SCREEN_CHANNEL, 'featureMatchSession:eventApplied', {
			eventId: 42,
			slotId: 11,
			sessionId: announced.id,
			sequence: announced.sequence,
			eventType: 'LifeAdjusted',
			sourceSnapshot: announced.sourceSnapshot,
			currentState: announced.currentState,
			timestamp: Date.now(),
		});
	}

	/** The Session state the Overlay renders from. */
	function held() {
		const store = useFeatureMatchStateStore();
		return {
			sessionId: store.sessionIdBySlotId.get(11),
			sequence: store.sessionSequenceBySlotId.get(11),
			lifeTotal: store.featureMatchStates.get(11)?.player1.lifeTotal,
		};
	}

	function privateRequests() {
		return api.requests.filter(request => !request.path.startsWith('/api/screen-output/'));
	}

	/** Lose continuity and come back, with the Slot read answering what `answer` gives. */
	async function reconnectReading(answer: () => unknown) {
		realtime().connectionState = 'suspended';
		await flushPromises();
		api.answers.set(slotPath, answer);
		// The page's own Screen re-read is held back, so only the mode's resync can
		// find out what was missed.
		api.answers.set('/api/screen-output/events/42/screens/slug/main', () => new Promise(() => {}));
		realtime().connectionState = 'connected';
		realtime().reattach(SCREEN_CHANNEL);
	}

	/** A Slot read held open until the test answers it. */
	function heldOpenRead() {
		const read = { answer: null as ((value: unknown) => void) | null };
		return {
			read,
			answer: () => new Promise((resolve) => {
				read.answer = resolve;
			}),
		};
	}

	beforeEach(() => {
		api.requests = [];
		api.screen = overlayScreen();
		api.answers = new Map<string, () => unknown>([
			[
				'/api/screen-output/events/42/screens/slug/main',
				() => api.screen,
			],
			[
				'/api/screen-output/events/42/screens/7',
				() => api.screen,
			],
			[
				'/api/screen-output/events/42/screens/7/event',
				() => outputEvent,
			],
			[
				slotPath,
				() => slotRead(session(90, 3, 20)),
			],
		]);
		resetAllEventStores();
		realtime().connectionState = 'connected';
		realtime().detach(SCREEN_CHANNEL);
	});

	afterEach(() => {
		for (const wrapper of mounted.splice(0))
			wrapper.unmount();
	});

	async function mountOverlay() {
		const wrapper = await mountOutput(`/event/42/screen/main#asset-capability=${capability}`, text => text.includes('Life 20 · Round 3'));
		expect(wrapper.text()).toContain('Life 20 · Round 3');
		expect(held()).toEqual({ sessionId: 90, sequence: 3, lifeTotal: 20 });
		return wrapper;
	}

	it('reads its Slot once, and not again for holding what it read', async () => {
		await mountOverlay();
		await settleOutput();

		expect(api.requests.filter(request => request.path === slotPath)).toHaveLength(1);
		expect(privateRequests()).toEqual([]);
	});

	it('shows the Session and Slot it missed while disconnected once its Screen channel is attached again', async () => {
		const wrapper = await mountOverlay();

		// Published while suspended, so never delivered: the Slot was promoted to
		// another Match, opening a newer Session that has since moved on.
		await reconnectReading(() => slotRead(session(91, 6, 13, 301), 301));
		await settleUntil(() => wrapper.text().includes('Life 13 · Round 4'));

		expect(wrapper.text()).toContain('Life 13 · Round 4');
		expect(held()).toEqual({ sessionId: 91, sequence: 6, lifeTotal: 13 });
		expect(useFeatureMatchStore().featureMatches.map(slot => slot.matchId)).toEqual([301]);
		expect(privateRequests()).toEqual([]);
	});

	it('applies the next Session event its Screen channel forwards, with no read', async () => {
		const wrapper = await mountOverlay();
		const slotReads = api.requests.filter(request => request.path === slotPath).length;

		sessionEvent(session(90, 4, 18));
		await settleUntil(() => wrapper.text().includes('Life 18'));

		expect(held()).toEqual({ sessionId: 90, sequence: 4, lifeTotal: 18 });
		expect(api.requests.filter(request => request.path === slotPath)).toHaveLength(slotReads);
	});

	// A Slot or seated Player change reaches the Screen as a cause: the Slot is read again through the Screen.
	it.each([
		{ cause: 'featureMatchSlot' },
		{ cause: 'player' },
	])('shows the Slot as re-read after a $cause change, holding what it shows until the read answers', async ({ cause }) => {
		const wrapper = await mountOverlay();
		const { read, answer } = heldOpenRead();
		api.answers.set(slotPath, answer);

		realtime().deliver(SCREEN_CHANNEL, 'output:modeDataChanged', {
			eventId: 42,
			screenId: 7,
			causes: [cause],
		});
		await settleUntil(() => read.answer !== null);
		expect(wrapper.text()).toContain('Life 20 · Round 3');

		// Promoted to another Match meanwhile, opening a newer Session.
		read.answer!(slotRead(session(91, 2, 14, 301), 301));
		await settleUntil(() => wrapper.text().includes('Life 14 · Round 4'));

		expect(wrapper.text()).toContain('Life 14 · Round 4');
		expect(useFeatureMatchStore().featureMatches.map(slot => slot.matchId)).toEqual([301]);
		expect(privateRequests()).toEqual([]);
	});

	it('reloads a gap in the Session\'s notifications through its Screen, never starting a Session', async () => {
		const wrapper = await mountOverlay();
		const slotReads = api.requests.filter(request => request.path === slotPath).length;

		// Sequence 4 was missed: 5 is a gap, which only a read can close.
		api.answers.set(slotPath, () => slotRead(session(90, 5, 16)));
		await sessionEvent(session(90, 5, 16));
		await settleUntil(() => wrapper.text().includes('Life 16'));

		expect(wrapper.text()).toContain('Life 16 · Round 3');
		expect(held()).toEqual({ sessionId: 90, sequence: 5, lifeTotal: 16 });
		expect(api.requests.filter(request => request.path === slotPath)).toHaveLength(slotReads + 1);
		expect(privateRequests()).toEqual([]);
	});

	it('never applies an older sequence after a newer one', async () => {
		const wrapper = await mountOverlay();

		// A resync read issued at sequence 3 answers only after sequence 4 was announced.
		const { read, answer } = heldOpenRead();
		await reconnectReading(answer);
		await settleUntil(() => read.answer !== null);
		await sessionEvent(session(90, 4, 18));
		read.answer!(slotRead(session(90, 3, 20)));
		await settleOutput();

		expect(wrapper.text()).toContain('Life 18 · Round 3');
		expect(held()).toEqual({ sessionId: 90, sequence: 4, lifeTotal: 18 });
		expect(privateRequests()).toEqual([]);
	});

	it('never applies an older epoch after a newer one', async () => {
		const wrapper = await mountOverlay();

		// The Slot is promoted while a resync read is in flight: a newer Session opens.
		const { read, answer } = heldOpenRead();
		await reconnectReading(answer);
		await settleUntil(() => read.answer !== null);
		await sessionEvent(session(91, 1, 17, 301));
		read.answer!(slotRead(session(90, 9, 7)));
		await settleOutput();

		expect(wrapper.text()).toContain('Life 17');
		expect(held()).toEqual({ sessionId: 91, sequence: 1, lifeTotal: 17 });
		expect(privateRequests()).toEqual([]);
	});
});

/**
 * A Standings output renders its Event's Theme, and follows every change to it
 * without a reload: a token write, a Theme switch, and one missed while away.
 */
describe('a capability-only output\'s Theme', () => {
	const eventPath = '/api/screen-output/events/42/screens/7/event';
	const TITLE = '--theme-standings-title-text';

	function theme(id: string, revision: number, titleText: string) {
		return {
			id,
			revision,
			tokens: { 'standings.title-text': titleText },
		};
	}

	function themedEvent(selected: ReturnType<typeof theme> | null) {
		return { ...outputEvent, themeId: selected?.id ?? null, theme: selected };
	}

	/** The title colour the Screen host resolved for the Standings display. */
	function titleColour(wrapper: { findAll: (selector: string) => Array<{ element: Element }> }) {
		return wrapper.findAll('div')
			.map(({ element }) => (element as HTMLElement).style.getPropertyValue(TITLE))
			.find(Boolean);
	}

	/** Its Screen's channel says the Event context changed: the Event, or its Theme's tokens. */
	function announceContextChanged() {
		realtime().deliver(SCREEN_CHANNEL, 'output:eventContextChanged', { eventId: 42 });
	}

	function eventReads() {
		return api.requests.filter(request => request.path === eventPath).length;
	}

	beforeEach(() => {
		api.requests = [];
		api.screen = screen({
			currentMode: 'standings',
			modeConfigs: { standings: {} },
		});
		api.answers = new Map<string, () => unknown>([
			[
				'/api/screen-output/events/42/screens/slug/main',
				() => api.screen,
			],
			[
				'/api/screen-output/events/42/screens/7',
				() => api.screen,
			],
			[
				eventPath,
				() => themedEvent(theme('brand', 3, 'rgb(1, 1, 1)')),
			],
			[
				'/api/screen-output/events/42/screens/7/standings',
				() => ({
					players: [],
					round: null,
					roundStandings: null,
					watchlist: null,
					previousRoundPositions: null,
				}),
			],
		]);
		resetAllEventStores();
		realtime().connectionState = 'connected';
		realtime().detach(SCREEN_CHANNEL);
	});

	afterEach(() => {
		for (const wrapper of mounted.splice(0))
			wrapper.unmount();
	});

	async function mountThemed() {
		const wrapper = await mountOutput(`/event/42/screen/main#asset-capability=${capability}`, () => true);
		await settleUntil(() => titleColour(wrapper) === 'rgb(1, 1, 1)');
		expect(titleColour(wrapper)).toBe('rgb(1, 1, 1)');
		return wrapper;
	}

	it('renders the Default Theme for an Event with none', async () => {
		api.answers.set(eventPath, () => themedEvent(null));
		const wrapper = await mountOutput(`/event/42/screen/main#asset-capability=${capability}`, () => true);
		await settleUntil(() => !!titleColour(wrapper));

		expect(titleColour(wrapper)).toBe('#ffffff');
	});

	it('re-reads its Event context on a token write, holding the Theme it shows until the read answers', async () => {
		const wrapper = await mountThemed();
		const reads = eventReads();
		const read = deferred<unknown>();
		api.answers.set(eventPath, () => read.promise);

		announceContextChanged();
		await settleUntil(() => eventReads() === reads + 1);
		expect(titleColour(wrapper)).toBe('rgb(1, 1, 1)');

		read.resolve(themedEvent(theme('brand', 4, 'rgb(2, 2, 2)')));
		await settleUntil(() => titleColour(wrapper) === 'rgb(2, 2, 2)');

		expect(titleColour(wrapper)).toBe('rgb(2, 2, 2)');
		expect(api.requests.filter(request => !request.path.startsWith('/api/screen-output/'))).toEqual([]);
	});

	it('re-reads its Event context when its Event switches Theme, and renders the new one', async () => {
		const wrapper = await mountThemed();

		api.answers.set(eventPath, () => themedEvent(theme('switched', 1, 'rgb(3, 3, 3)')));
		announceContextChanged();
		await settleUntil(() => titleColour(wrapper) === 'rgb(3, 3, 3)');

		expect(titleColour(wrapper)).toBe('rgb(3, 3, 3)');
	});

	it('keeps the Theme it shows when the re-read fails, and reads again by itself', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const wrapper = await mountThemed();
		vi.useFakeTimers({
			toFake: ['setTimeout', 'clearTimeout'],
			shouldAdvanceTime: true,
		});
		const reads = eventReads();
		api.answers.set(eventPath, () => Promise.reject(new Error('unavailable')));

		announceContextChanged();
		await settleUntil(() => eventReads() === reads + 1);
		await settleOutput();
		expect(titleColour(wrapper)).toBe('rgb(1, 1, 1)');

		api.answers.set(eventPath, () => themedEvent(theme('switched', 1, 'rgb(3, 3, 3)')));
		await vi.advanceTimersByTimeAsync(SCREEN_OUTPUT_LOAD_RETRY_MS);
		await settleUntil(() => titleColour(wrapper) === 'rgb(3, 3, 3)');

		expect(titleColour(wrapper)).toBe('rgb(3, 3, 3)');
	});

	it('hears nothing its Event channel carries', async () => {
		const wrapper = await mountThemed();
		const reads = eventReads();

		realtime().deliver(EVENT_CHANNEL, 'theme:updated', {
			eventId: 42,
			theme: theme('brand', 9, 'rgb(9, 9, 9)'),
		});
		realtime().deliver(EVENT_CHANNEL, 'event:updated', {
			eventId: 42,
			event: { id: 42, themeId: 'switched' },
		});
		await settleOutput();

		expect(titleColour(wrapper)).toBe('rgb(1, 1, 1)');
		expect(eventReads()).toBe(reads);
	});

	it('shows a token write missed while disconnected once its Screen channel is attached again', async () => {
		const wrapper = await mountThemed();

		realtime().connectionState = 'suspended';
		await flushPromises();
		api.answers.set(eventPath, () => themedEvent(theme('brand', 5, 'rgb(4, 4, 4)')));
		realtime().connectionState = 'connected';
		realtime().reattach(SCREEN_CHANNEL);
		await settleUntil(() => titleColour(wrapper) === 'rgb(4, 4, 4)');

		expect(titleColour(wrapper)).toBe('rgb(4, 4, 4)');
		expect(api.requests.filter(request => !request.path.startsWith('/api/screen-output/'))).toEqual([]);
	});
});
