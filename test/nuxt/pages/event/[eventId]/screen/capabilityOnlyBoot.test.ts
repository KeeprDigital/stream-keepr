import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';
import { createMockFeatureMatchState, createWireMockFeatureMatch } from '~~/test/helpers/fixtures';
import { useRouter } from '#app';
import { tryUseRealtime } from '~/composables/core/useRealtime';
import { useCardStore } from '~/stores/card';
import { useFeatureMatchStore } from '~/stores/featureMatch';
import { useFeatureMatchStateStore } from '~/stores/featureMatchState';
import { usePlayerStore } from '~/stores/player';
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
	// Answered on a later task, as the network would: a read that re-issues
	// itself on its own answer then shows as a count, not a starved event loop.
	await new Promise(resolve => setTimeout(resolve, 0));
	const answer = api.answers.get(path);
	if (!path.startsWith('/api/screen-output/') || authorization !== `Bearer ${capability}` || !answer)
		throw unauthorized(path);
	const value = answer();
	return value instanceof Promise ? value : structuredClone(value);
});

vi.mock('~/composables/core/useRealtime', async () => {
	const { reactive } = await import('vue');
	const { createContinuitySignal } = await import('~~/test/helpers/realtime-mock');
	const continuity = createContinuitySignal();
	type Handler = (message: Record<string, unknown>) => void;
	const handlers = new Map<string, Set<Handler>>();
	const transport = reactive({
		connectionId: 'connection-1',
		connectionState: 'connected',
		tokenError: null,
		onRoom: () => {},
		offRoom: () => {},
		setRoom: () => {},
		onContinuityLost: continuity.onContinuityLost,
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
	return {
		// `defineAsyncComponent` takes `default` only from a module it recognises as one.
		__esModule: true,
		default: defineComponent({
			setup() {
				const { matchState, round } = useFeatureMatchOverlayModeData();
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
		screenConfig: { width: 1920, height: 1080 },
		modeConfigs: { 'player-history': { playerId: 11 } },
		stateVersion: 1,
		...overrides,
	};
}

function history(name: string, result: Record<string, unknown> = {}) {
	return {
		player: { id: 11, eventId: 42, name, updatedAt: '2026-10-17T00:00:00.000Z' },
		history: [{
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
			resultString: null,
			...result,
		}],
	};
}

function topCards(name: string) {
	return {
		entries: [{ id: 1, name, inclusionRate: 80, avgCopies: 4, totalCopies: 16, deckCount: 4, mainboardCount: 16, sideboardCount: 0, mainboardDeckCount: 4, sideboardDeckCount: 0, cardType: 'Instant', scryfallId: null, colors: 'R', cmc: 1, manaCost: '{R}' }],
		totalDecks: 5,
		scope: 'all',
	};
}

function metagame(archetype: string) {
	return {
		viewMode: 'archetype',
		breakdown: { entries: [{ name: archetype, count: 2, metaShare: 100, colors: 'R' }], totalPlayers: 2, scope: 'all' },
	};
}

const pendingResult = { outcome: 'pending', hasResult: false, playerGameWins: null, opponentGameWins: null };
const recordedLoss = { outcome: 'loss', hasResult: true, playerGameWins: 1, opponentGameWins: 2 };

/** The output's stand-in transport, with a hand to deliver Event messages and signal a reattach. */
function realtime() {
	return tryUseRealtime() as unknown as {
		connectionState: string;
		reattach: (channel: string) => void;
		deliver: (channel: string, type: string, message: Record<string, unknown>) => void;
	};
}

async function settleUntil(ready: () => boolean) {
	for (let round = 0; round < 100 && !ready(); round++) {
		await flushPromises();
		await new Promise(resolve => setTimeout(resolve, 5));
	}
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
		realtime().connectionState = 'connected';
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

	it('follows a Match result recorded elsewhere, with no operator surface open', async () => {
		api.answers.set('/api/screen-output/events/42/screens/7/player-history', () => history('First Player', pendingResult));
		const wrapper = await mountOutput(
			`/event/42/screen/main#asset-capability=${capability}`,
			text => text.includes('Pending'),
		);
		const screenReads = api.requests.filter(request => request.path === '/api/screen-output/events/42/screens/7').length;

		// Another browser records the result: Event, Player and Screen configuration
		// are unchanged, so nothing but the Match notification says to re-read.
		api.answers.set('/api/screen-output/events/42/screens/7/player-history', () => history('First Player', recordedLoss));
		realtime().deliver('event:42', 'match:updated', {
			eventId: 42,
			match: { id: 1, eventId: 42, roundId: 31, player1Id: 12, player2Id: 11, hasResult: true },
		});
		await settleUntil(() => wrapper.text().includes('LOSS'));

		expect(wrapper.text()).toContain('LOSS');
		expect(api.requests.filter(request => request.path === '/api/screen-output/events/42/screens/7')).toHaveLength(screenReads);
		expect(api.requests.filter(request => !request.path.startsWith('/api/screen-output/'))).toEqual([]);
	});

	it('shows a result missed while disconnected once its Event channel is attached again', async () => {
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
		realtime().reattach('event:42');
		await settleUntil(() => wrapper.text().includes('LOSS'));

		expect(wrapper.text()).toContain('LOSS');
		expect(api.requests.filter(request => !request.path.startsWith('/api/screen-output/'))).toEqual([]);
	});

	it('follows a deck review on a Top Cards output, with no roster or settings panel loaded', async () => {
		api.screen = screen({ currentMode: 'top-cards', modeConfigs: { 'top-cards': { showCardNames: true } } });
		api.answers.set('/api/screen-output/events/42/screens/7/top-cards', () => topCards('Lightning Bolt'));
		const wrapper = await mountOutput(
			`/event/42/screen/main#asset-capability=${capability}`,
			text => text.includes('Lightning Bolt'),
		);

		// Reviewed in another browser: no Player record, Screen configuration or
		// roster changes, so only the aggregate's own invalidation says to re-read.
		api.answers.set('/api/screen-output/events/42/screens/7/top-cards', () => topCards('Counterspell'));
		realtime().deliver('event:42', 'playerDeck:reviewed', { eventId: 42, deck: { id: 3, playerId: 11 } });
		await settleUntil(() => wrapper.text().includes('Counterspell'));

		expect(wrapper.text()).toContain('Counterspell');
		expect(usePlayerStore().dataVersion).toBe(0);
		expect(api.requests.filter(request => !request.path.startsWith('/api/screen-output/'))).toEqual([]);
	});

	it('follows membership of the Player List driving a Metagame output, with no roster or settings panel loaded', async () => {
		api.screen = screen({ currentMode: 'metagame', modeConfigs: { metagame: { scope: 'playerList', playerListId: 5 } } });
		api.answers.set('/api/screen-output/events/42/screens/7/metagame', () => metagame('Mono Red'));
		const wrapper = await mountOutput(
			`/event/42/screen/main#asset-capability=${capability}`,
			text => text.includes('Mono Red'),
		);

		api.answers.set('/api/screen-output/events/42/screens/7/metagame', () => metagame('Azorius Control'));
		realtime().deliver('event:42', 'playerList:membersChanged', { eventId: 42, listId: 5, playerIds: [12], action: 'added', memberCount: 2 });
		await settleUntil(() => wrapper.text().includes('Azorius Control'));

		expect(wrapper.text()).toContain('Azorius Control');
		expect(usePlayerStore().dataVersion).toBe(0);
		expect(api.requests.filter(request => !request.path.startsWith('/api/screen-output/'))).toEqual([]);
	});

	it('shows a Metagame change missed while disconnected once its Event channel is attached again', async () => {
		api.screen = screen({ currentMode: 'metagame', modeConfigs: { metagame: {} } });
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
		realtime().reattach('event:42');
		await settleUntil(() => wrapper.text().includes('Azorius Control'));

		expect(wrapper.text()).toContain('Azorius Control');
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
		return screen({ currentMode: 'feature-match-overlay', modeConfigs: { 'feature-match-overlay': config } });
	}

	function session(id: number, sequence: number, lifeTotal: number, matchId = 300) {
		const currentState = createMockFeatureMatchState();
		currentState.player1 = { ...currentState.player1, lifeTotal };
		return {
			id,
			eventId: 42,
			slotId: 11,
			status: 'active',
			sourceSnapshot: { eventId: 42, slotId: 11, matchId, player1: { name: 'Alice' }, player2: { name: 'Bob' } },
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
			slot: { ...createWireMockFeatureMatch({ id: 11, eventId: 42, matchId, activeSessionId: activeSession.id }), activeSession },
			match: { id: matchId, eventId: 42, roundId: round.id },
			round: { ...round, eventId: 42, phaseId: 5 },
			phase: { id: 5, eventId: 42, name: 'Swiss' },
		};
	}

	/** One `featureMatchSession:eventApplied`, handed to the store as the Event room would. */
	function sessionEvent(announced: ReturnType<typeof session>) {
		return useFeatureMatchStateStore().applyRemoteSessionEvent({
			eventId: 42,
			slotId: 11,
			sessionId: announced.id,
			sequence: announced.sequence,
			eventType: 'LifeAdjusted',
			sourceSnapshot: announced.sourceSnapshot,
			currentState: announced.currentState,
			timestamp: Date.now(),
		} as never);
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
		realtime().reattach('event:42');
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
			['/api/screen-output/events/42/screens/slug/main', () => api.screen],
			['/api/screen-output/events/42/screens/7', () => api.screen],
			['/api/screen-output/events/42/screens/7/event', () => outputEvent],
			[slotPath, () => slotRead(session(90, 3, 20))],
		]);
		resetAllEventStores();
		realtime().connectionState = 'connected';
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
		await settleUntil(() => false);

		expect(api.requests.filter(request => request.path === slotPath)).toHaveLength(1);
		expect(privateRequests()).toEqual([]);
	});

	it('shows the Session and Slot it missed while disconnected once its Event channel is attached again', async () => {
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
		await settleUntil(() => false);

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
		await settleUntil(() => false);

		expect(wrapper.text()).toContain('Life 17');
		expect(held()).toEqual({ sessionId: 91, sequence: 1, lifeTotal: 17 });
		expect(privateRequests()).toEqual([]);
	});
});
