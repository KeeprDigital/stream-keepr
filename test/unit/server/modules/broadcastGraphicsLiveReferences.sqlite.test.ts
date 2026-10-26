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
 * The Live Session reference index under a moving sequence. Every reconciliation write is
 * guarded on the sequence it derived from, so a superseded one applies nothing (#170).
 * `beforeReferenceWrite` commits real commands in the read-to-write window, and each
 * assertion asks the real authorizer whether a Screen Output can resolve a revision now.
 */

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

vi.doMock('~~/server/db', () => ({ db }));
// Realtime notification is not what this file is about, and a Live Session command
// publishes one on every acceptance.
vi.doMock('~~/server/utils/ably', () => ({
	publishMessage: async () => {},
	publishMessageStrict: async () => {},
	publishScreenCommand: async () => {},
	getOriginConnectionId: () => undefined,
}));

/** Commits in the read-to-write window; fired once, and not re-entered by its own commands. */
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
	return {
		assetId: testGraphicAssetId(ASSET_ID),
		revisionId: testGraphicAssetRevisionId(revisionId),
	};
}

/** A revision that exists but whose bytes the library cannot currently reach. */
const UNREACHABLE_REVISION = 'revision-unreachable';

/** Revisions whose content stopped resolving after acceptance, so the playout path meets a refusal. */
const graphicsAssetLibraryOutage = new Set<string>();

/** The library `Set Input` asks for a pinned revision's facts, answering for the revisions seeded below. */
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

/** A media Graphic Input on a live On-air Update Policy, so one `Set Input` moves the accepted set. */
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
	inputs: [
		mediaInput(CLIP_A),
		mediaInput(CLIP_B),
	],
};

const STACK: BroadcastGraphicsModeConfig = {
	graphics: [SLATE],
};

const nextCommandId = createCommandIdSequence();

function command(type: BroadcastGraphicsCommand['type'], payload: Record<string, unknown>): BroadcastGraphicsCommand {
	// The payload shape belongs to each command variant; a test that names the
	// variant by its `type` supplies the matching payload itself.
	return {
		commandId: nextCommandId(),
		type,
		payload,
	} as unknown as BroadcastGraphicsCommand;
}

interface LiveSession {
	take: () => Promise<void>;
	out: () => Promise<void>;
	setInput: (key: string, value: MediaGraphicInputValue | null) => Promise<void>;
	republish: () => Promise<void>;
	/** An epoch ended by failure, its published references left behind (#305): the state orphan repair is for. */
	strandReferencesOfEndedEpoch: () => Promise<void>;
	/** Whether this Screen's output may fetch this exact revision now. */
	canResolve: (revisionId: string) => Promise<boolean>;
}

/** One Event, one Broadcast Graphics Screen, and its open playout epoch, per test. */
async function liveSession(): Promise<LiveSession> {
	const { eventId, screenId, assetCapabilityDigest } = await seedBroadcastGraphicsScreen(db, {
		stack: STACK,
		eventName: 'Live session',
	});

	const module = broadcastGraphicsLiveSessionModule();
	const session = await module.loadSession(eventId, screenId);
	const authorizer = createD1ScreenOutputAssetAuthorizer(harness.database);

	const apply = async (issued: BroadcastGraphicsCommand) => {
		await module.applyCommand({
			eventId,
			screenId,
			sessionId: session.id,
			command: issued,
			graphicsAssets: () => graphicsAssetLibrary,
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
			});
			return outcome.outcome === 'authorized';
		},
	};
}

/** Every revision, in one answer, so a scenario states the whole index it left. */
async function resolvable(live: LiveSession): Promise<Revision[]> {
	const answers = await Promise.all(REVISIONS.map(async revisionId =>
		await live.canResolve(revisionId)
			? revisionId
			: undefined));
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
		// Two commands land while a clip swap is still reconciling: the index must describe the
		// latest acceptance, not whichever write finished last.
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
		// The overtaking commands emptied the accepted set, so only the guard keeps the old clip unpublished.
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

/** A revision the library refuses is not published, and the refusal carries a code so it is not read as an ended epoch (#203). */
describe('a media selection the Graphics Asset Library refuses', () => {
	it('names a revision that does not exist as a Missing Graphic Asset Reference', async () => {
		const live = await liveSession();
		await live.take();

		await expect(live.setInput(CLIP_A, clip('no-such-revision'))).rejects.toMatchObject({
			statusCode: 409,
			data: {
				code: 'missing-asset-reference',
				inputKeys: [CLIP_A],
			},
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
			data: {
				code: 'unavailable-asset-content',
				inputKeys: [CLIP_A],
			},
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
		// Two consecutive lost races exhaust the retry, and that outcome is reported.
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
		// With no running epoch every surviving row is debris, and the repair must actually run (#320).
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
