import type { BroadcastGraphicsCommand } from '~~/shared/types/broadcastGraphicsLiveSession';
import type {
	BroadcastGraphicConfig,
	GraphicInputDeclaration,
	MediaGraphicInputValue,
} from '~~/shared/types/graphics';
import type { GraphicAssetReferenceStatus } from '~~/shared/types/graphicsAsset';
import type { BroadcastGraphicsModeConfig } from '~~/shared/types/screenConfig';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import {
	graphicAssetContents,
	graphicAssetRevisions,
	graphicAssets,
} from '~~/server/db/schema/graphicsAsset';
import { createCommandIdSequence, seedBroadcastGraphicsScreen } from '~~/test/helpers/broadcastGraphicsScreen';
import { testGraphicAssetId, testGraphicAssetRevisionId } from '~~/test/helpers/graphicsAssetIdentities';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * The Broadcast Graphics Live Session reference index under a moving sequence.
 *
 * Every statement both reconciliation paths write is guarded on the Live Session
 * sequence the reference set was derived from:
 *
 * ```sql
 * AND EXISTS (SELECT 1 FROM broadcast_graphics_live_sessions
 *             WHERE id = ? AND screen_id = ? AND sequence = ? AND status = 'active')
 * ```
 *
 * That guard is the whole reason a superseded reconciliation applies **nothing**
 * rather than reinstating an older reference set over a newer one. Removing the
 * `sequence = ?` term left the entire integration suite green (#170), and PR #169
 * then built a bounded retry on top of the behaviour nothing was checking.
 *
 * ## Why this is a harness rather than a sequence of requests
 *
 * The guard only does anything in the window between a reconciliation deriving its
 * reference set and writing it. Nothing observable happens in that window, so it
 * cannot be reached by issuing commands one after another — the interleaving has to
 * be constructed. `beforeReferenceWrite` is that construction: it commits real
 * commands, through the real module, in exactly that window. Everything else is
 * genuine, including the SQL, which is why this runs against libSQL rather than
 * against a catalogue double — what a statement writes when its own condition is
 * false is precisely what is under test.
 *
 * ## What is asserted, and why it is not the rows
 *
 * The index exists so a Screen Output can fetch the media its Screen is publishing,
 * so every assertion here is that question, asked of the real authorizer: can this
 * Screen Output resolve this exact Graphic Asset Revision now? A test that read the
 * rows would pass just as happily with the index describing a show nobody is
 * watching.
 *
 * That is also the rule being pinned, stated in `CONTEXT.md`: *"A Broadcast Graphics
 * Screen publishes the exact Graphic Asset Revisions its authored configuration pins
 * and the media Graphic Input values its Broadcast Graphics Live Session has
 * accepted, and a value the Live Session no longer accepts stops being published in
 * the same moment it leaves air."* A superseded reconcile that wrote would break both
 * halves at once — publishing a value the Live Session has stopped accepting, and
 * unpublishing one it has.
 */

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

vi.doMock('hub:db', () => ({ db }));
// Realtime notification is not what this file is about, and a Live Session command
// publishes one on every acceptance.
vi.doMock('~~/server/utils/ably', () => ({
	publishMessage: async () => {},
	publishMessageStrict: async () => {},
	publishScreenCommand: async () => {},
	getOriginConnectionId: () => undefined,
}));

/**
 * What commits in the window between a reconciliation's read and its write.
 *
 * Set by a test, fired once, and deliberately suppressed while it is running: the
 * commands it commits reconcile too, and a hook that re-entered on those would be
 * racing itself rather than the reconciliation under test.
 */
let beforeReferenceWrite: (() => Promise<void>) | undefined;
let interleaving = false;

vi.doMock('~~/server/modules/screen-graphic-asset-references', async (importOriginal) => {
	const actual = await importOriginal<typeof import('~~/server/modules/screen-graphic-asset-references')>();
	return {
		...actual,
		async updateBroadcastGraphicsLiveSessionGraphicAssetReferences(
			input: Parameters<typeof actual.updateBroadcastGraphicsLiveSessionGraphicAssetReferences>[0],
		) {
			const hook = beforeReferenceWrite;
			if (hook && !interleaving) {
				beforeReferenceWrite = undefined;
				interleaving = true;
				try {
					await hook();
				}
				finally {
					interleaving = false;
				}
			}
			return await actual.updateBroadcastGraphicsLiveSessionGraphicAssetReferences(input);
		},
	};
});

const { broadcastGraphicsLiveSessionModule } = await import('~~/server/modules/broadcast-graphics-live-session');
const { createD1ScreenOutputAssetAuthorizer } = await import('~~/server/modules/screen-output-assets/authorizer');

// ──────────────── the Graphics Asset Library these values name ────────────────

const ASSET_ID = 'asset-clip';
const REVISIONS = ['revision-one', 'revision-two', 'revision-three'] as const;
type Revision = typeof REVISIONS[number];
const CONTENT_DIGEST = 'd'.repeat(64);

/** A media Graphic Input value, as an operator's selection stores one. */
function clip(revisionId: string): MediaGraphicInputValue {
	return { assetId: testGraphicAssetId(ASSET_ID), revisionId: testGraphicAssetRevisionId(revisionId) };
}

/**
 * The Graphics Asset Library, answering for exactly the revisions seeded below.
 *
 * Injected rather than faked at a lower seam because it is a declared dependency of
 * the module under test: `Set Input` records the pinned revision's own facts on a
 * media value at the moment of selection, and that is the authority it asks.
 */
/** A revision that exists but whose bytes the library cannot currently reach. */
const UNREACHABLE_REVISION = 'revision-unreachable';

/**
 * Revisions whose content has stopped being reachable since it was accepted.
 *
 * Emptied between tests. It exists so a scenario can reach the refusal on the playout
 * path, which is about a value the show is already carrying rather than one being
 * chosen — there is no way to select an already-accepted revision a second time.
 */
const graphicsAssetLibraryOutage = new Set<string>();

const graphicsAssetLibrary = {
	async inspectGraphicAssetRevision(input: { assetId: string; revisionId: string }): Promise<GraphicAssetReferenceStatus> {
		if (input.revisionId === UNREACHABLE_REVISION || graphicsAssetLibraryOutage.has(input.revisionId))
			return { outcome: 'unavailable', retryable: true };
		return input.assetId === ASSET_ID && (REVISIONS as readonly string[]).includes(input.revisionId)
			? { outcome: 'available', lifecycleState: 'active', kind: 'image' }
			: { outcome: 'missing' };
	},
};

// ──────────────── the Screen these commands address ────────────────

const CLIP_A = 'clipA';
const CLIP_B = 'clipB';

/**
 * A media Graphic Input applied immediately.
 *
 * A live On-air Update Policy is what makes one `Set Input` move the accepted media
 * set, which is the only thing reconciliation follows — with a staged policy every
 * scenario here would need an `Update Graphic` behind it saying nothing extra.
 */
function mediaInput(key: string): GraphicInputDeclaration {
	return {
		key,
		label: key,
		type: 'media',
		required: false,
		updatePolicy: 'live',
		default: null,
		mediaKind: 'image',
	};
}

const SLATE: BroadcastGraphicConfig = {
	id: 'slate',
	name: 'Slate',
	items: [],
	inputs: [mediaInput(CLIP_A), mediaInput(CLIP_B)],
};

const STACK: BroadcastGraphicsModeConfig = { graphics: [SLATE] };

const nextCommandId = createCommandIdSequence();

function command(type: BroadcastGraphicsCommand['type'], payload: Record<string, unknown>): BroadcastGraphicsCommand {
	// The payload shape belongs to each command variant; a test that names the
	// variant by its `type` supplies the matching payload itself.
	return { commandId: nextCommandId(), type, payload } as unknown as BroadcastGraphicsCommand;
}

interface LiveSession {
	take: () => Promise<void>;
	out: () => Promise<void>;
	setInput: (key: string, value: MediaGraphicInputValue | null) => Promise<void>;
	republish: () => Promise<void>;
	/**
	 * The epoch ended the way only a failure ends one: the session marked ended and
	 * the references it published left behind.
	 *
	 * Constructed rather than driven, for the same reason `beforeReferenceWrite` is.
	 * Every path that ends an epoch clears the namespace in the commit that ends it
	 * (#305), so a Screen holding orphaned rows is by definition a state no ordinary
	 * sequence of commands reaches — and it is the only state the orphan repair
	 * exists for.
	 */
	strandReferencesOfEndedEpoch: () => Promise<void>;
	/** Whether this Screen's output may fetch this exact revision now. */
	canResolve: (revisionId: string) => Promise<boolean>;
}

/**
 * One Event, one Broadcast Graphics Screen, and its open playout epoch.
 *
 * Built per test rather than shared, because each scenario drives the accepted media
 * set to a different place and the assertions are about which set survived.
 */
async function liveSession(): Promise<LiveSession> {
	const { eventId, screenId, assetCapabilityDigest } = await seedBroadcastGraphicsScreen(db, {
		stack: STACK,
		eventName: 'Live session',
	});

	const module = broadcastGraphicsLiveSessionModule({ graphicsAssets: graphicsAssetLibrary });
	const session = await module.loadSession(eventId, screenId);
	const authorizer = createD1ScreenOutputAssetAuthorizer(harness.database);

	const apply = async (issued: BroadcastGraphicsCommand) => {
		await module.applyCommand({
			eventId,
			screenId,
			sessionId: session.id,
			command: issued,
		});
	};

	return {
		take: () => apply(command('Take', { graphicId: SLATE.id, cut: true })),
		out: () => apply(command('Out', { graphicId: SLATE.id, cut: true })),
		setInput: (key, value) => apply(command('Set Input', { graphicId: SLATE.id, inputKey: key, value })),
		republish: () => module.republishLiveSessionReferences({ eventId, screenId }),
		strandReferencesOfEndedEpoch: async () => {
			await db.update(schema.broadcastGraphicsLiveSessions)
				.set({ status: 'ended' })
				.where(and(
					eq(schema.broadcastGraphicsLiveSessions.screenId, screenId),
					eq(schema.broadcastGraphicsLiveSessions.status, 'active'),
				));
		},
		canResolve: async (revisionId) => {
			const outcome = await authorizer.authorize({
				screenId,
				capabilityDigest: assetCapabilityDigest,
				assetId: ASSET_ID,
				revisionId,
				actualVideoTarget: 'chromium',
			});
			return outcome.outcome === 'authorized';
		},
	};
}

/** Every revision, in one answer, so a scenario states the whole index it left. */
async function resolvable(live: LiveSession): Promise<Revision[]> {
	const answers = await Promise.all(REVISIONS.map(async revisionId =>
		await live.canResolve(revisionId) ? revisionId : undefined));
	return answers.filter((revisionId): revisionId is Revision => revisionId !== undefined);
}

/** Three revisions of one Graphic Asset, which every scenario chooses between. */
beforeAll(async () => {
	await db.insert(graphicAssetContents).values({
		digest: CONTENT_DIGEST,
		byteLength: 70,
		canonicalMime: 'image/png',
	} as never);
	await db.insert(graphicAssets).values({
		id: ASSET_ID,
		name: 'Clip',
		kind: 'image',
	} as never);
	for (const [index, id] of REVISIONS.entries()) {
		await db.insert(graphicAssetRevisions).values({
			id,
			assetId: ASSET_ID,
			revisionNumber: index + 1,
			contentDigest: CONTENT_DIGEST,
			compatibilityProfile: 'still-image-v1',
			technicalFacts: {},
		} as never);
	}
});

beforeEach(() => {
	beforeReferenceWrite = undefined;
	interleaving = false;
	graphicsAssetLibraryOutage.clear();
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(async () => await harness.close());

describe('a Broadcast Graphics Live Session reconcile whose sequence moved underneath it', () => {
	it('reinstates nothing over the reference set the commands that overtook it published', async () => {
		// The defect stated as a show: an operator swaps a clip, two more commands land
		// while that acceptance is still following itself into the index, and the index
		// must describe the *latest* acceptance rather than whichever write happened to
		// finish last. Without the sequence term, the superseded reconciliation deletes
		// the whole namespace and reinstates the set it derived — so the Screen Output
		// loses the clip that is actually on air and gains one that is not.
		const live = await liveSession();
		await live.take();
		await live.setInput(CLIP_A, clip(REVISIONS[0]));

		expect(await resolvable(live)).toEqual([REVISIONS[0]]);

		beforeReferenceWrite = async () => {
			await live.setInput(CLIP_B, clip(REVISIONS[2]));
			await live.setInput(CLIP_A, clip(REVISIONS[0]));
		};
		await live.setInput(CLIP_A, clip(REVISIONS[1]));

		expect(await resolvable(live)).toEqual([REVISIONS[0], REVISIONS[2]]);
	});

	it('does not publish media the Live Session has since stopped accepting', async () => {
		// The other half, and the worse one. Here the commands that overtook the
		// reconciliation left the accepted media set *empty*, so the guard is the only
		// thing standing between an ended selection and a Screen Output that can still
		// fetch it. The slot is free, so an unguarded insert does not even collide —
		// it simply republishes content the show has moved on from.
		const live = await liveSession();
		await live.take();
		await live.setInput(CLIP_A, clip(REVISIONS[0]));

		beforeReferenceWrite = async () => {
			// A Take composes its accepted values afresh, so clearing the working value
			// and taking the graphic again is what actually drops the media.
			await live.setInput(CLIP_A, null);
			await live.out();
			await live.take();
		};
		await live.setInput(CLIP_A, clip(REVISIONS[1]));

		expect(await resolvable(live)).toEqual([]);
	});
});

/**
 * The other way a media selection reaches the index: it does not.
 *
 * A revision that stops resolving between the picker's question and the operator's
 * click is refused here, at the authority, and nothing is published for it. What the
 * refusal *says* is load-bearing rather than cosmetic: it travels as a bare 409 unless
 * it carries a code, and a bare 409 is exactly what an ended epoch looks like — so the
 * client reloads the session and restates the very command that was just refused,
 * then reports "playout action failed" (#203).
 */
describe('a media selection the Graphics Asset Library refuses', () => {
	it('names a revision that does not exist as a Missing Graphic Asset Reference', async () => {
		const live = await liveSession();
		await live.take();

		await expect(live.setInput(CLIP_A, clip('no-such-revision'))).rejects.toMatchObject({
			statusCode: 409,
			data: { code: 'missing-asset-reference', inputKeys: [CLIP_A] },
		});

		// Refused outright: the value is not accepted, so the index publishes nothing
		// for it and no Screen Output can fetch it.
		expect(await resolvable(live)).toEqual([]);
	});

	it('distinguishes content that is only temporarily out of reach', async () => {
		// The two prescribe opposite next moves — choose something else, or retry the
		// same thing — so one code for both would tell the operator the wrong one half
		// the time.
		const live = await liveSession();
		await live.take();

		await expect(live.setInput(CLIP_A, clip(UNREACHABLE_REVISION))).rejects.toMatchObject({
			statusCode: 409,
			data: { code: 'unavailable-asset-content', inputKeys: [CLIP_A] },
		});
	});

	it('names a Take blocked by a pinned revision that has gone, rather than refusing bare', async () => {
		// The same defect on the playout path: an unnamed refusal here is a Take the
		// client reloads and sends again, against a library that refuses it again.
		const live = await liveSession();
		await live.take();
		await live.setInput(CLIP_A, clip(REVISIONS[0]));
		graphicsAssetLibraryOutage.add(REVISIONS[0]);

		await expect(live.take()).rejects.toMatchObject({
			statusCode: 409,
			data: { code: 'unavailable-asset-content' },
		});
	});
});

describe('re-deriving what a Broadcast Graphics Live Session publishes after an authored write', () => {
	it('retries once and lands on the state that overtook it', async () => {
		// PR #169's bounded retry, and the behaviour it rests on: the first pass loses
		// the race and therefore applies nothing, and the second re-reads and publishes
		// what the Live Session has actually accepted.
		const live = await liveSession();
		await live.take();
		await live.setInput(CLIP_A, clip(REVISIONS[0]));

		beforeReferenceWrite = async () => {
			await live.setInput(CLIP_A, clip(REVISIONS[1]));
		};
		await live.republish();

		expect(await resolvable(live)).toEqual([REVISIONS[1]]);
		expect(console.error).not.toHaveBeenCalledWith(
			expect.stringContaining('broadcast_graphics_live_reference_republish_incomplete'),
		);
	});

	it('says so when both passes lose the race, having applied nothing', async () => {
		// The residual the module documents rather than claims to have closed. Two
		// consecutive lost races exhaust the retry, and the one outcome where this
		// demonstrably did not take is the one it reports — which is the only way an
		// operator ever learns that what a Screen publishes and what it declares have
		// come apart.
		const live = await liveSession();
		await live.take();
		await live.setInput(CLIP_A, clip(REVISIONS[0]));

		let races = 0;
		const race = async () => {
			races += 1;
			// Re-armed for the second pass, so both passes lose rather than one.
			if (races < 2)
				beforeReferenceWrite = race;
			await live.setInput(CLIP_A, clip(REVISIONS[races]!));
		};

		beforeReferenceWrite = race;
		await live.republish();

		expect(races).toBe(2);
		// Neither pass wrote, so the index is what the racing commands' own
		// reconciliations left — not the older set either pass was holding.
		expect(await resolvable(live)).toEqual([REVISIONS[2]]);
		expect(console.error).toHaveBeenCalledWith(
			expect.stringContaining('broadcast_graphics_live_reference_republish_incomplete'),
		);
	});

	it('drops what a Screen with no epoch is still publishing', async () => {
		// The repair rather than the reconcile, and the branch a reconcile reaches
		// when it finds no running epoch: a Screen with no Live Session accepts
		// nothing and therefore publishes nothing, so every surviving row is debris
		// from an end that did not complete.
		//
		// It is a scenario rather than a row count because the failure it guards
		// against is invisible in the module's shape. The repair executes a Drizzle
		// statement builder by awaiting it, and a builder that is awaited and one
		// that is merely built are the same expression to a reader — so a refactor
		// that dropped the `await` would turn this into a silent no-op, leaving an
		// ended show's media fetchable through the Screen's outputs for as long as
		// the Screen stays in the mode. #320.
		const live = await liveSession();
		await live.take();
		await live.setInput(CLIP_A, clip(REVISIONS[0]));
		await live.strandReferencesOfEndedEpoch();

		// The control: the debris is real, and it is on air. Without this the
		// assertion below would be satisfied by a Screen that never published.
		expect(await resolvable(live)).toEqual([REVISIONS[0]]);

		await live.republish();

		expect(await resolvable(live)).toEqual([]);
	});
});
