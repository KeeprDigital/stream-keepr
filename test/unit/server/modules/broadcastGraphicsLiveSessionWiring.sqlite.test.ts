import type { BroadcastGraphicsCommand } from '~~/shared/types/broadcastGraphicsLiveSession';
import type { BroadcastGraphicConfig, GraphicInputDeclaration } from '~~/shared/types/graphics';
import type { BroadcastGraphicsModeConfig } from '~~/shared/types/screenConfig';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { ServiceWiringError } from '~~/server/utils/errors';
import { mapPublicNitroError } from '~~/server/utils/nitroErrorMapping';
import { createCommandIdSequence, seedBroadcastGraphicsScreen } from '~~/test/helpers/broadcastGraphicsScreen';
import { testGraphicAssetReference } from '~~/test/helpers/graphicsAssetIdentities';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * What a Broadcast Graphics Live Session answers when it was assembled without the
 * Graphics Asset Library.
 *
 * Two playout paths ask the library — a Take, which will not put a Broadcast Graphic
 * carrying an unresolvable Graphic Asset Reference on air, and a media `Set Input`,
 * which stamps the pinned revision's own facts onto the value as it is selected.
 * Both refused with a bare 503 that `mapPublicNitroError` then rewrote to 'Internal
 * Server Error', which is #243's defect in a sibling module (#246).
 *
 * The assertions run the failure through the mapper rather than reading the thrown
 * error, because the rewrite happens in the mapper and nowhere else: asserting the
 * throw on its own passes just as happily with the cause dropped.
 *
 * Driven through `applyCommand` against real rows rather than at the closure the
 * guards live in, because neither is exported and the question is what an operator
 * receives from the route.
 */

// `cause` is carried because it is the only thing that survives the 5xx sanitizer.
vi.stubGlobal('createError', (input: { statusCode: number; message?: string; statusMessage?: string; cause?: unknown }) => {
	const error = new Error(input.message ?? input.statusMessage, { cause: input.cause }) as Error & {
		statusCode: number;
		statusMessage?: string;
	};
	error.statusCode = input.statusCode;
	error.statusMessage = input.statusMessage;
	return error;
});

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

vi.doMock('hub:db', () => ({ db }));
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
 * The default is what makes the graphic carry a Graphic Asset Reference at all, and
 * so what takes a Take past the `references.length === 0` early return into the
 * guard under test.
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

const STACK: BroadcastGraphicsModeConfig = { graphics: [SLATE] };

const nextCommandId = createCommandIdSequence();

/** The module as a route would get it if the wiring were left out. */
async function unwiredLiveSession() {
	const { eventId, screenId } = await seedBroadcastGraphicsScreen(db, {
		stack: STACK,
		eventName: 'Unwired live session',
	});
	const module = broadcastGraphicsLiveSessionModule();
	const session = await module.loadSession(eventId, screenId);

	return async (type: BroadcastGraphicsCommand['type'], payload: Record<string, unknown>) =>
		await module.applyCommand({
			eventId,
			screenId,
			sessionId: session.id,
			// The payload shape belongs to each command variant; a test that names the
			// variant by its `type` supplies the matching payload itself.
			command: { commandId: nextCommandId(), type, payload } as unknown as BroadcastGraphicsCommand,
		});
}

/** What an operator actually receives: the module's error after the mapper. */
async function publicErrorFor(operation: Promise<unknown>) {
	const thrown = await operation.then(
		() => null,
		(error: unknown) => error as Error & { statusCode: number; statusMessage?: string },
	);
	if (!thrown)
		throw new Error('expected the operation to reject, and it resolved');
	mapPublicNitroError(thrown);
	return thrown;
}

afterAll(async () => await harness.close());

describe('a Broadcast Graphics Live Session assembled without the Graphics Asset Library', () => {
	it('names the missing collaborator when a Take has to prove its Graphic Assets resolve', async () => {
		const apply = await unwiredLiveSession();

		const failure = await publicErrorFor(apply('Take', { graphicId: SLATE.id, cut: true }));

		expect(failure.cause).toBeInstanceOf(ServiceWiringError);
		expect(failure).toMatchObject({
			statusCode: 503,
			statusMessage: 'Service Unavailable',
			// Both halves. The dependency alone leaves the operator knowing what is
			// missing but not from which component, which is half of what they have
			// to report — and a mutation of the component name survived the suite
			// until this asserted it.
			message: expect.stringContaining(
				'The Broadcast Graphics Live Session module was constructed without the Graphics Asset Library',
			),
		});
	});

	it('names the missing collaborator when a media selection has to record the revision\'s facts', async () => {
		const apply = await unwiredLiveSession();

		const failure = await publicErrorFor(apply('Set Input', {
			graphicId: SLATE.id,
			inputKey: CLIP,
			value: { assetId: ASSET_ID, revisionId: REVISION_ID },
		}));

		expect(failure.cause).toBeInstanceOf(ServiceWiringError);
		expect(failure).toMatchObject({
			statusCode: 503,
			statusMessage: 'Service Unavailable',
			// Both halves. The dependency alone leaves the operator knowing what is
			// missing but not from which component, which is half of what they have
			// to report — and a mutation of the component name survived the suite
			// until this asserted it.
			message: expect.stringContaining(
				'The Broadcast Graphics Live Session module was constructed without the Graphics Asset Library',
			),
		});
	});
});
