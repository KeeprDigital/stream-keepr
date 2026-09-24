import type { H3Event } from 'h3';
import type {
	BroadcastGraphicsCommand,
	BroadcastGraphicsLiveSessionResponse,
} from '~~/shared/types/broadcastGraphicsLiveSession';
import type { BroadcastGraphicsModeConfig } from '~~/shared/types/screenConfig';
import type { MessageData } from '~/types/realtime';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import * as schema from '~~/server/db/schema';
import { broadcastGraphicInputsState } from '~~/shared/modules/broadcast-graphics-live-session';
import { createCommandIdSequence, seedBroadcastGraphicsScreen } from '~~/test/helpers/broadcastGraphicsScreen';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';
import { useRealtimeMessageGate } from '~/composables/core/useRealtimeMessageGate';
import { createBroadcastGraphicsRealtimeHandlers } from '~/modules/realtime-event-session/broadcastGraphicsHandlers';

/**
 * `broadcastGraphicsLiveSession:commandApplied`, from the command route to the store
 * that merges it.
 *
 * Since #168 the notification carries **the difference a command made** rather than
 * the live state it produced, which makes the server and the client two halves of one
 * protocol: the server emits a change, the client merges it into what it already
 * holds, and they are only correct together. Both halves are covered well on their
 * own — the difference and merge functions by exhaustive unit tests and a
 * four-thousand-command fuzz, the payload builder's contract with the transport by a
 * differential test at the carrying boundary, the store's sequence-gap and reload
 * guards by the Nuxt store tests. Nothing exercised the hop between them: that the
 * thing actually published is the thing the store applies (#188).
 *
 * The failure that would catch is silent. A divergence does not throw — it leaves one
 * client rendering a state the server does not hold, until some later command produces
 * a sequence gap and forces a reload. On a live output that is a graphic showing the
 * wrong thing for an unbounded interval.
 *
 * ## What is real here, and what is not
 *
 * Everything between the HTTP handler and `channel.publish` is real, including the
 * database, the reducer, the sequenced live-state module, the payload builder, and
 * `publishMessage` itself. **The only seam faked is the Ably client**, and that is
 * deliberate: a payload written by the test would prove nothing, because the thing
 * under test is precisely whether what the server hands the transport is what the
 * store can apply. What the fake records is handed to the store exactly as it was
 * captured, through JSON, because that is what the transport does to it.
 *
 * On the client side it is handed in through the same edge production uses — the
 * Realtime Event Session's own handler map, built with the real message gate — rather
 * than to `applyRemoteCommand` directly (#207). That hop is one line of code and was
 * the only part of this path nothing exercised: everything either side of it was
 * pinned and the handoff itself was not. It is also where a client's own commands are
 * dropped, which is the second test below.
 *
 * ## Why it lives under `test/nuxt/stores/`
 *
 * It drives a real server half, which no other file here does, and `stores/` does not
 * say that. It is filed by what it drives: the store is the thing under test and the
 * server is its counterparty, the same way `screenConfigAndRealtime.test.ts` is filed
 * by the store it drives rather than by the realtime edge it comes in through. It has
 * to run under the Nuxt environment for the store and its auto-imports to exist at
 * all, so `test/unit/` is not open to it, and a directory of its own would name a
 * category with one member in it.
 *
 * The proof that the notification alone carried the client is the reload count. The
 * store answers a change it cannot use by fetching the authoritative snapshot, and
 * that fetch would converge on the right state while hiding the very disagreement
 * this exists to find — so the snapshot is fetched exactly once, at the start, and
 * every assertion after that is about what the notifications alone achieved. That
 * pairing is the rule itself, from `CONTEXT.md`'s Broadcast Graphics Live State
 * Change: *"A peer holding the sequence immediately before applies it and lands on
 * exactly the state the authoritative side committed; a peer that is offered none
 * reloads the authoritative snapshot."* Landing on the right state by reloading
 * satisfies the second clause while saying nothing about the first.
 */

// ──────────────── the transport, and nothing else, faked ────────────────

interface PublishedMessage {
	name: string;
	data: unknown;
}

const published: PublishedMessage[] = [];

vi.mock('ably', () => ({
	default: {
		Rest: class {
			channels = {
				get: () => ({
					publish: async (name: string, data: unknown) => {
						published.push({ name, data });
					},
				}),
			};
		},
	},
}));

// ──────────────── the client half ────────────────

const repository = {
	getSession: vi.fn(),
	sendCommand: vi.fn(),
	resetSession: vi.fn(),
};

vi.mock('~/composables/repositories/useBroadcastGraphicsLiveSessionRepository', () => ({
	useBroadcastGraphicsLiveSessionRepository: () => repository,
}));

/*
 * `useAsyncAction` is deliberately not mocked, as in the store's own tests: it is
 * auto-imported and does nothing a test needs to stand in for, and a hand-written
 * copy of a seam is a thing that can drift from what it copies (#241).
 */

// The installation-wide clock. Nothing in the merge path reads it; the store asks for
// it while it is being set up, so it is answered here rather than left to a real sync.
mockNuxtImport('useServerTime', () => () => ({
	serverTimeOffset: ref(0),
	isSynced: ref(true),
	lastSyncedAt: ref(null),
	getServerTime: () => Date.now(),
	sync: vi.fn(),
	startSync: vi.fn(),
	stopSync: vi.fn(),
}));

// ──────────────── the server half ────────────────

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

vi.doMock('~~/server/db', () => ({ db }));
// The Graphics Asset Library is injected by the route and reached only by a command
// naming media. Nothing here names any, so this stands in for the binding rather than
// for any behaviour.
vi.doMock('~~/server/modules/graphics-asset-library/runtime', () => ({
	graphicsAssetLibraryForEvent: () => ({
		inspectGraphicAssetRevision: async () => ({ outcome: 'missing' }),
	}),
}));

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal(
	'getValidatedRouterParams',
	async (event: FakeEvent, parse: (input: unknown) => unknown) => parse(event.context.params),
);
vi.stubGlobal(
	'readValidatedBody',
	async (event: FakeEvent, parse: (input: unknown) => unknown) => parse(event.context.body),
);
vi.stubGlobal(
	'getHeader',
	(event: FakeEvent, name: string) => event.context.headers[name.toLowerCase()],
);

interface FakeEvent {
	context: {
		params: Record<string, string>;
		body: unknown;
		headers: Record<string, string>;
	};
}

const commandRoute = (await import(
	'~~/server/api/events/[id]/screens/[screenId]/broadcast-graphics/live-sessions/[sessionId]/commands.post',
)).default as unknown as (event: H3Event) => Promise<unknown>;
const { broadcastGraphicsLiveSessionModule } = await import('~~/server/modules/broadcast-graphics-live-session');

// ──────────────── the show ────────────────

const GRAPHIC_ID = 'lower-third';
/** Accepted only by an Update Graphic, which is what puts an acceptance in play. */
const HEADLINE = 'headline';
/** Applied the moment it is edited, so one command moves what program shows. */
const TICKER = 'ticker';
/** The connection Live Control issued these commands from, as its requests carry one. */
const ORIGIN_CONNECTION_ID = 'live-control-connection';
/** The connection this client holds — another operator's browser, not the issuer's. */
const PEER_CONNECTION_ID = 'peer-connection';

const STACK: BroadcastGraphicsModeConfig = {
	graphics: [{
		id: GRAPHIC_ID,
		name: 'Lower third',
		items: [],
		inputs: [
			{ key: HEADLINE, label: 'Headline', type: 'text', required: false, updatePolicy: 'staged', default: '', maxLength: 200 },
			{ key: TICKER, label: 'Ticker', type: 'text', required: false, updatePolicy: 'live', default: '', maxLength: 200 },
		],
	}],
};

let eventId: number;
let screenId: number;
let sessionId: number;
const nextCommandId = createCommandIdSequence();

/**
 * The client edge, assembled exactly as `useEventRealtimeSession` assembles it: the
 * domain's handler map, over the real message gate, for a given connection.
 *
 * Taking a connection id is what lets a test be either the peer watching the show or
 * the client that issued the command — which is the whole of what the gate decides.
 */
function realtimeHandlersFor(connectionId: string) {
	const { accept } = useRealtimeMessageGate(ref(connectionId));
	return createBroadcastGraphicsRealtimeHandlers({ accept });
}

/**
 * A published notification, delivered the way the transport delivers one.
 *
 * `accept` answers nothing and awaits nothing — it starts the store's work and returns
 * — so the wait is for the merge to land. A handler that threw would leave that wait to
 * time out rather than surfacing, and a rejected one would only reach `console.warn`,
 * so both are asserted silent here.
 */
async function deliver(
	notification: MessageData<'broadcastGraphicsLiveSession:commandApplied'>,
): Promise<void> {
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	try {
		realtimeHandlersFor(PEER_CONNECTION_ID)['broadcastGraphicsLiveSession:commandApplied'](
			notification,
			undefined,
		);
		await vi.waitFor(() => {
			expect(useBroadcastGraphicsLiveSessionStore().sessions.get(notification.screenId)?.sequence)
				.toBe(notification.sequence);
		});
		expect(warn).not.toHaveBeenCalled();
	}
	finally {
		warn.mockRestore();
	}
}

/** The authoritative snapshot, in the shape a client reads it: through JSON. */
async function snapshot(): Promise<BroadcastGraphicsLiveSessionResponse> {
	const session = await broadcastGraphicsLiveSessionModule().loadSession(eventId, screenId);
	return JSON.parse(JSON.stringify(session)) as BroadcastGraphicsLiveSessionResponse;
}

/**
 * One command through the route, answering with what the transport was handed.
 *
 * Captured rather than constructed, and passed on without being touched — the whole
 * question is whether these are the same thing.
 */
async function issue(
	type: BroadcastGraphicsCommand['type'],
	payload: Record<string, unknown>,
): Promise<MessageData<'broadcastGraphicsLiveSession:commandApplied'>> {
	published.length = 0;

	await commandRoute({
		context: {
			params: { id: String(eventId), screenId: String(screenId), sessionId: String(sessionId) },
			body: { commandId: nextCommandId(), type, payload },
			headers: { 'x-realtime-connection-id': ORIGIN_CONNECTION_ID },
		},
	} as unknown as H3Event);

	expect(published).toHaveLength(1);
	expect(published[0]!.name).toBe('broadcastGraphicsLiveSession:commandApplied');

	return JSON.parse(JSON.stringify(published[0]!.data)) as MessageData<'broadcastGraphicsLiveSession:commandApplied'>;
}

beforeAll(async () => {
	// `publishMessage` builds its client from runtime configuration, and a Nuxt test
	// app carries no server secrets. Set on the real configuration object rather than
	// by replacing `useRuntimeConfig`, which the Nuxt test app itself needs.
	(useRuntimeConfig() as unknown as { ablyApiKey: string }).ablyApiKey = 'test.key:secret';

	({ eventId, screenId } = await seedBroadcastGraphicsScreen(db, {
		stack: STACK,
		eventName: 'Protocol',
	}));

	sessionId = (await broadcastGraphicsLiveSessionModule().loadSession(eventId, screenId)).id;
});

afterAll(async () => await harness.close());

describe('what a Broadcast Graphics Live Session publishes and what its store merges', () => {
	it('carries every accepted command to the state the snapshot reports, without a reload', async () => {
		const store = useBroadcastGraphicsLiveSessionStore();
		store.$reset();
		repository.getSession.mockImplementation(async () => await snapshot());

		// The one authoritative read this client is allowed. Everything after it is the
		// protocol's own work.
		await store.loadSession(eventId, screenId);
		expect(repository.getSession).toHaveBeenCalledTimes(1);

		/** One command, applied from the wire, checked against the authority. */
		const step = async (type: BroadcastGraphicsCommand['type'], payload: Record<string, unknown>) => {
			const notification = await issue(type, payload);
			await deliver(notification);

			const authoritative = await snapshot();
			const held = store.sessions.get(screenId);

			expect(held?.sequence, `${type} sequence`).toBe(authoritative.sequence);
			expect(held?.currentState, `${type} live state`).toEqual(authoritative.currentState);
		};

		// A whole show in miniature, so the merge is exercised against every part of live
		// state a command can move: a staged edit before air, an acceptance composed by a
		// Take, an on-air value applied the moment it was typed, a staged edit left
		// pending behind it, the acceptance that supersedes a revision, and the playout
		// record an Out writes.
		await step('Set Input', { graphicId: GRAPHIC_ID, inputKey: HEADLINE, value: 'Quarter Finals' });
		await step('Take', { graphicId: GRAPHIC_ID, cut: true });
		await step('Set Input', { graphicId: GRAPHIC_ID, inputKey: TICKER, value: 'Table 1' });
		await step('Set Input', { graphicId: GRAPHIC_ID, inputKey: HEADLINE, value: 'Semi Finals' });

		const acceptedRevision = broadcastGraphicInputsState(
			(await snapshot()).currentState,
			GRAPHIC_ID,
		).acceptedRevision;
		await step('Update Graphic', { graphicId: GRAPHIC_ID, basedOnAcceptedRevision: acceptedRevision });

		await step('Out', { graphicId: GRAPHIC_ID, cut: true });

		// Nothing the server published left this client unable to continue, so it never
		// went back to the authority. Without this the assertions above would pass on a
		// protocol whose two halves disagree about every message.
		expect(repository.getSession).toHaveBeenCalledTimes(1);
	});

	it('does not apply the notification back to the client that issued the command', async () => {
		// The other half of the same edge. Every peer on the channel receives this
		// notification, including Live Control, whose own request already moved its
		// store — so applying it there would merge one command's difference twice. The
		// notification carries the issuing connection precisely so the gate can drop it,
		// and the only thing that consults that is the wrapper this handler map is built
		// with.
		const store = useBroadcastGraphicsLiveSessionStore();
		store.$reset();
		repository.getSession.mockImplementation(async () => await snapshot());
		await store.loadSession(eventId, screenId);

		const before = store.sessions.get(screenId)!.sequence;
		const notification = await issue('Set Input', {
			graphicId: GRAPHIC_ID,
			inputKey: TICKER,
			value: 'Table 2',
		});
		expect(notification.sequence).toBeGreaterThan(before);

		realtimeHandlersFor(ORIGIN_CONNECTION_ID)['broadcastGraphicsLiveSession:commandApplied'](
			notification,
			undefined,
		);
		// A macrotask, so anything the handler had started would have run by now.
		await new Promise(resolve => setTimeout(resolve, 0));

		expect(store.sessions.get(screenId)?.sequence).toBe(before);
		// Dropped rather than deferred: a drop that reloaded instead would hide itself
		// behind the authoritative snapshot and land on the same state.
		expect(repository.getSession).toHaveBeenCalledTimes(1);
	});
});
