import type { H3Event } from 'h3';
import type {
	BroadcastGraphicsCommandResult,
	BroadcastGraphicsLiveSessionResponse,
} from '~~/shared/types/broadcastGraphicsLiveSession';
import type { BroadcastGraphicConfig, GraphicInputDeclaration } from '~~/shared/types/graphics';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createCommandIdSequence, seedBroadcastGraphicsScreen } from '~~/test/helpers/broadcastGraphicsScreen';
import { stubH3Event } from '~~/test/helpers/h3Event';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// A Broadcast Graphics Live Session command through its route, over real SQL: what the
// Screen's authored configuration and its Event Data contribute to an acceptance, and
// that a reload answers it. Only the clock, Ably and the Graphics Asset Library are faked.

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));
interface StubEvent { params: Record<string, string>; body?: unknown }
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal('getValidatedRouterParams', async (event: StubEvent, parse: (value: unknown) => unknown) => parse(event.params));
vi.stubGlobal('readValidatedBody', async (event: StubEvent, parse: (value: unknown) => unknown) => parse(event.body));

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', () => ({ db }));
vi.doMock('~~/server/utils/ably', () => ({
	publishMessage: async () => {},
	publishMessageStrict: async () => {},
	publishScreenCommand: async () => {},
	getOriginConnectionId: () => undefined,
}));
// No Broadcast Graphic here pins a Graphic Asset Revision, so the library is never asked.
vi.doMock('~~/server/modules/graphics-asset-library/runtime', () => ({
	graphicsAssetLibraryForEvent: () => ({}),
}));

const sendCommand = (await import('~~/server/api/events/[id]/screens/[screenId]/broadcast-graphics/live-sessions/[sessionId]/commands.post')).default as unknown as (event: H3Event) => Promise<BroadcastGraphicsCommandResult>;
const readLiveSession = (await import('~~/server/api/events/[id]/screens/[screenId]/broadcast-graphics/live-session.get')).default as unknown as (event: H3Event) => Promise<BroadcastGraphicsLiveSessionResponse>;

const GRAPHIC = 'lower-third';
const TAKEN_AT = Date.UTC(2026, 0, 1, 12);
const PHASE_MS = 5_000;

function textInput(key: string, updatePolicy: GraphicInputDeclaration['updatePolicy']): GraphicInputDeclaration {
	return {
		type: 'text',
		key,
		label: key,
		required: false,
		updatePolicy,
		default: '',
		maxLength: 40,
	};
}

function phase(duration: number) {
	return {
		duration,
		easing: 'linear' as const,
		delay: 0,
		fade: { opacity: 0 },
	};
}

const nextCommandId = createCommandIdSequence();

/** One Screen placing `graphic`, and the route calls a Live Control makes against it. */
async function liveControl(graphic: BroadcastGraphicConfig) {
	const { eventId, screenId } = await seedBroadcastGraphicsScreen(db, {
		stack: {
			graphics: [graphic],
		},
	});
	const params = {
		id: String(eventId),
		screenId: String(screenId),
	};
	const reload = () => readLiveSession(stubH3Event({ params }));
	const session = await reload();

	return {
		eventId,
		reload,
		send: (type: string, payload: Record<string, unknown> = {}) => sendCommand(stubH3Event({
			params: {
				...params,
				sessionId: String(session.id),
			},
			body: {
				commandId: nextCommandId(),
				type,
				payload: { graphicId: GRAPHIC, ...payload },
			},
		})),
	};
}

beforeEach(() => {
	// Only the clock an acceptance is stamped on; libSQL keeps its real timers.
	vi.useFakeTimers({
		toFake: ['Date'],
	});
	vi.setSystemTime(TAKEN_AT);
});

afterEach(() => {
	vi.useRealTimers();
});

afterAll(async () => await harness.close());

describe('a Resolve Bindings command', () => {
	it('accepts what the Event Data behind a live-policy Graphic Input Binding says now', async () => {
		const live = await liveControl({
			id: GRAPHIC,
			name: 'Lower third',
			items: [],
			inputs: [
				textInput('name', 'live'),
			],
			sources: [
				{ key: 'player', label: 'Player', kind: 'player' },
			],
			bindings: [
				{ inputKey: 'name', sourceKey: 'player', fieldId: 'player.name' },
			],
		});
		const [player] = await db.insert(schema.players)
			.values({ eventId: live.eventId, name: 'Rae Okonjo' })
			.returning({ id: schema.players.id });
		await live.send('Select Source', { sourceKey: 'player', selectionId: player!.id });
		await live.send('Take');
		// Stored behind the Live Session's back, so nothing but the command re-resolves it.
		await db.update(schema.players).set({ name: 'Rae Okonjo-Bell' }).where(eq(schema.players.id, player!.id));
		expect((await live.reload()).currentState.inputs[GRAPHIC]!.accepted).toEqual({ name: 'Rae Okonjo' });

		const resolved = await live.send('Resolve Bindings');

		expect(resolved.currentState.inputs[GRAPHIC]!.accepted).toEqual({ name: 'Rae Okonjo-Bell' });
		expect((await live.reload()).currentState.inputs[GRAPHIC]!.accepted).toEqual({ name: 'Rae Okonjo-Bell' });
	});
});

describe('an Update Graphic on a Broadcast Graphic with an authored update phase', () => {
	// The update is held until the entrance settles, and carries the rendering it leaves.
	it('schedules the transition from the authored durations, and a reload answers the same schedule', async () => {
		const live = await liveControl({
			id: GRAPHIC,
			name: 'Lower third',
			items: [],
			inputs: [
				textInput('name', 'staged'),
				textInput('title', 'staged'),
			],
			animation: {
				enter: phase(PHASE_MS),
				update: phase(PHASE_MS),
			},
		});
		await live.send('Take');
		vi.setSystemTime(TAKEN_AT + 1_000);
		await live.send('Set Input', { inputKey: 'name', value: 'Reloaded' });

		const accepted = await live.send('Update Graphic', { basedOnAcceptedRevision: 1 });

		expect(accepted.currentState.playout[GRAPHIC]).toMatchObject({
			onAir: true,
			effectiveStartedAt: TAKEN_AT,
			updateStartedAt: TAKEN_AT + PHASE_MS,
		});
		expect(accepted.currentState.inputs[GRAPHIC]).toMatchObject({
			accepted: { name: 'Reloaded', title: '' },
			updateFrom: { name: '', title: '' },
		});
		const reloaded = await live.reload();
		expect(reloaded.currentState.playout[GRAPHIC]).toEqual(accepted.currentState.playout[GRAPHIC]);
		expect(reloaded.currentState.inputs[GRAPHIC]).toEqual(accepted.currentState.inputs[GRAPHIC]);
	});
});
