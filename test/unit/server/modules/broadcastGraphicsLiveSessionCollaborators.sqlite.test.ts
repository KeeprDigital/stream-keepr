import type { BroadcastGraphicsCommand } from '~~/shared/types/broadcastGraphicsLiveSession';
import type { BroadcastGraphicConfig, GraphicInputDeclaration } from '~~/shared/types/graphics';
import type { GraphicAssetReferenceStatus } from '~~/shared/types/graphicsAsset';
import type { BroadcastGraphicsModeConfig } from '~~/shared/types/screenConfig';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createCommandIdSequence, seedBroadcastGraphicsScreen } from '~~/test/helpers/broadcastGraphicsScreen';
import { testGraphicAssetReference } from '~~/test/helpers/graphicsAssetIdentities';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * When `applyCommand` builds the Graphics Asset Library it was handed, and when it
 * leaves the thunk alone.
 *
 * The library is a **required** parameter of `applyCommand` rather than an optional
 * dependency of the module (#265, the shape #247 gave screen-write), so the module
 * can no longer be assembled without it and the two 503s #246 named are
 * unrepresentable — a construction site that omits it fails to compile. This file
 * supersedes `broadcastGraphicsLiveSessionWiring.sqlite.test.ts`, whose subject was
 * exactly those 503s; the wiring-fault class and mapper arm they also proved were
 * retired outright by #344, once nothing could raise them.
 *
 * What is left to prove is the half a type cannot state: that the thunk is invoked
 * only where the library is actually asked something. Two of the commands below reach
 * `state.applyCommand` having never built one, and the third is the control that shows
 * the counter can move at all — without it, a thunk that was never wired to anything
 * would satisfy both negative cases.
 *
 * Driven through `applyCommand` against real rows rather than at the closures the two
 * call sites live in, because neither is exported and the question is what a command
 * arriving at the route costs.
 */

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

vi.doMock('~~/server/db', () => ({ db }));
// Opening an epoch is not what this file is about, and it publishes.
vi.doMock('~~/server/utils/ably', () => ({
	publishMessage: async () => {},
	publishMessageStrict: async () => {},
	publishScreenCommand: async () => {},
	getOriginConnectionId: () => undefined,
}));

const { broadcastGraphicsLiveSessionModule } = await import('~~/server/modules/broadcast-graphics-live-session');

const ASSET_ID = 'asset-plate';
const REVISION_ID = 'revision-one';
const CLIP = 'clip';

/**
 * A media Graphic Input whose authored default pins a revision.
 *
 * The default is what makes the graphic carry a Graphic Asset Reference at all, and so
 * what takes a Take past `requireResolvableGraphicAssets`' `references.length === 0`
 * early return and into the library.
 */
const CLIP_INPUT: GraphicInputDeclaration = {
	key: CLIP,
	label: 'Clip',
	type: 'media',
	required: false,
	updatePolicy: 'live',
	default: testGraphicAssetReference(ASSET_ID, REVISION_ID),
	mediaKind: 'image',
};

const SLATE: BroadcastGraphicConfig = {
	id: 'slate',
	name: 'Slate',
	items: [],
	inputs: [CLIP_INPUT],
};

/** A Broadcast Graphic that pins nothing, so nothing about it needs the library. */
const BUG: BroadcastGraphicConfig = {
	id: 'bug',
	name: 'Bug',
	items: [],
	inputs: [],
};

const STACK: BroadcastGraphicsModeConfig = { graphics: [SLATE, BUG] };

const nextCommandId = createCommandIdSequence();

/** One Event, one Broadcast Graphics Screen, and a library that counts its builds. */
async function liveSession() {
	const { eventId, screenId } = await seedBroadcastGraphicsScreen(db, {
		stack: STACK,
		eventName: 'Live session collaborators',
	});
	const module = broadcastGraphicsLiveSessionModule();
	const session = await module.loadSession(eventId, screenId);

	let built = 0;
	const graphicsAssets = () => {
		built += 1;
		return {
			async inspectGraphicAssetRevision(): Promise<GraphicAssetReferenceStatus> {
				return { outcome: 'available', lifecycleState: 'active', kind: 'image' };
			},
		};
	};

	return {
		builds: () => built,
		apply: async (type: BroadcastGraphicsCommand['type'], payload: Record<string, unknown>) =>
			await module.applyCommand({
				eventId,
				screenId,
				sessionId: session.id,
				// The payload shape belongs to each command variant; a test that names the
				// variant by its `type` supplies the matching payload itself.
				command: { commandId: nextCommandId(), type, payload } as unknown as BroadcastGraphicsCommand,
				graphicsAssets,
			}),
	};
}

afterAll(async () => await harness.close());

describe('the Graphics Asset Library `applyCommand` is handed', () => {
	it('is built when a Take has to prove its Graphic Asset References resolve', async () => {
		const session = await liveSession();

		await session.apply('Take', { graphicId: SLATE.id, cut: true });

		expect(session.builds()).toBe(1);
	});

	it('is not built by a Take on a Broadcast Graphic that pins nothing', async () => {
		const session = await liveSession();

		await session.apply('Take', { graphicId: BUG.id, cut: true });

		expect(session.builds()).toBe(0);
	});

	it('is not built by a media Graphic Input that is being cleared', async () => {
		const session = await liveSession();

		await session.apply('Set Input', { graphicId: SLATE.id, inputKey: CLIP, value: null });

		expect(session.builds()).toBe(0);
	});
});
