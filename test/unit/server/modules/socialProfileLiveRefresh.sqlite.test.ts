import type { BroadcastGraphicsCommand } from '~~/shared/types/broadcastGraphicsLiveSession';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { addGraphicItem } from '~~/shared/modules/graphics';
import { MAX_SOCIAL_PROFILE_HANDLE_LENGTH } from '~~/shared/socialProfiles';
import { eventRealtimeChannel } from '~~/shared/utils/realtimeChannels';
import { createAblyRestFake } from '~~/test/helpers/ablyRestFake';
import { profileDeclaration } from '~~/test/helpers/broadcastGraphicsLiveState';
import { createCommandIdSequence, seedBroadcastGraphicsScreen } from '~~/test/helpers/broadcastGraphicsScreen';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// A Talent or Event write reaching the Broadcast Graphics Live Session: the refresh
// re-reads Event Data from real rows, stores what a live Social Profile Projection on
// air now shows, and announces it. Only Ably and the clock are faked; the rotation
// rules themselves are the reducers' (`test/unit/shared/socialProfile*.test.ts`).

const NOW = Date.parse('2026-11-04T12:00:00.000Z');
vi.useFakeTimers({
	toFake: ['Date'],
	now: NOW,
});

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string; data?: unknown }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', () => ({ db }));

const ably = createAblyRestFake();
vi.doMock('ably', () => ably.module);
vi.stubGlobal('useRuntimeConfig', () => ({ ablyApiKey: 'test-key' }));

const {
	broadcastGraphicsLiveSessionModule,
	refreshBroadcastGraphicsBindings,
} = await import('~~/server/modules/broadcast-graphics-live-session');
const { talentService } = await import('~~/server/services/talent');
const { eventService } = await import('~~/server/services/event');

const liveSession = broadcastGraphicsLiveSessionModule();
const nextCommandId = createCommandIdSequence();
const TRANSITION_MS = profileDeclaration.transitionDurationMs;

/** No command here pins a Graphic Asset, so none asks the library. */
function noLibrary(): never {
	throw new Error('The Graphics Asset Library was asked about a graphic pinning nothing');
}

type Policy = 'live' | 'staged';

/** A Broadcast Graphic projecting one Talent's Social Profiles, picked or derived from the Event. */
function profileGraphic(id: string, policy?: Policy, relation?: 'commentator1' | 'commentator2'): BroadcastGraphicConfig {
	const { graphic } = addGraphicItem({ id, name: id, items: [] }, {
		kind: 'group',
		id: profileDeclaration.presentationGroupId,
		canvasWidth: 1920,
		canvasHeight: 1080,
	});
	return {
		...graphic,
		sources: relation
			? [
					{ key: 'event', label: 'Event', kind: 'event' },
					{
						key: 'talent',
						label: 'Talent',
						kind: 'talent',
						from: { sourceKey: 'event', relation },
					},
				]
			: [
					{ key: 'talent', label: 'Talent', kind: 'talent' },
				],
		socialProfileProjections: [
			{
				...profileDeclaration,
				...(policy
					? { updatePolicy: policy }
					: {}),
			},
		],
	};
}

const LOWER = 'lower';

interface Stage { eventId: number; screenId: number; sessionId: number }

async function stage(graphics: BroadcastGraphicConfig[]): Promise<Stage> {
	const seeded = await seedBroadcastGraphicsScreen(db, {
		stack: { graphics },
	});
	const session = await liveSession.loadSession(seeded.eventId, seeded.screenId);
	return { eventId: seeded.eventId, screenId: seeded.screenId, sessionId: session.id };
}

async function send(on: Stage, type: BroadcastGraphicsCommand['type'], payload: Record<string, unknown> = {}) {
	return await liveSession.applyCommand({
		...on,
		command: {
			commandId: nextCommandId(),
			type,
			payload: { graphicId: LOWER, ...payload },
		} as BroadcastGraphicsCommand,
		graphicsAssets: noLibrary,
	});
}

/** The Live Session as it is stored. */
async function stored({ sessionId }: Stage) {
	return (await db.query.broadcastGraphicsLiveSessions.findFirst({
		where: eq(schema.broadcastGraphicsLiveSessions.id, sessionId),
	}))!;
}

async function storedProjection(on: Stage, graphicId = LOWER) {
	return (await stored(on)).currentState.socialProfileProjections?.[graphicId]?.profile;
}

/** The commands the Event's channel was told were applied. */
function applied({ eventId }: Stage) {
	return ably.on(eventRealtimeChannel(eventId))
		.filter(message => message.type === 'broadcastGraphicsLiveSession:commandApplied')
		.map(message => message.payload);
}

function advance(milliseconds: number) {
	vi.setSystemTime(Date.now() + milliseconds);
}

/** A Talent of the Event, on air on `LOWER` through the operator's own selection. */
async function onAirWithTalent(policy: Policy | undefined, socialProfiles: Record<string, string>) {
	const on = await stage([
		profileGraphic(LOWER, policy),
	]);
	const talent = await talentService().create(on.eventId, { name: 'Avery Quinn', socialProfiles });
	await send(on, 'Select Source', { sourceKey: 'talent', selectionId: talent.id });
	await send(on, 'Take');
	return { on, talent };
}

async function writeProfiles(on: Stage, talentId: number, socialProfiles: Record<string, string>) {
	await talentService().update(talentId, on.eventId, { socialProfiles });
	await refreshBroadcastGraphicsBindings(on.eventId);
}

beforeEach(() => {
	vi.setSystemTime(NOW);
	ably.reset();
});

afterAll(async () => {
	vi.useRealTimers();
	await harness.close();
});

describe('a Talent write under a live Social Profile Projection on air', () => {
	it('stores what program now shows from the Talent\'s row, and announces it with no origin', async () => {
		const { on, talent } = await onAirWithTalent('live', { twitch: 'BeforeLive', x: 'OnAirX' });
		await send(on, 'Select Social Profile', { projectionKey: 'profile', network: 'x' });
		const before = await stored(on);
		ably.reset();
		advance(1_000);

		await writeProfiles(on, talent.id, { twitch: 'BeforeLive', youtube: 'NewlyAdded', x: 'CorrectedX' });

		const after = await stored(on);
		const projection = after.currentState.socialProfileProjections![LOWER]!.profile!;
		expect(after.sequence).toBe(before.sequence + 1);
		expect(projection).toMatchObject({
			talent: { id: talent.id, name: 'Avery Quinn' },
			acceptedProfiles: [
				{ network: 'twitch', handle: 'BeforeLive' },
				{ network: 'youtube', handle: 'NewlyAdded' },
				{ network: 'x', handle: 'CorrectedX', profileUrl: 'https://x.com/CorrectedX' },
			],
			currentNetwork: 'x',
			manualNetwork: 'x',
			transitionAnchor: { startedAt: NOW + 1_000 },
			rotationAnchor: { network: 'x', anchoredAt: NOW + 1_000 + TRANSITION_MS },
		});
		expect(projection.transitionAnchor!.from).toEqual([
			expect.objectContaining({
				values: expect.objectContaining({ network: 'x', handle: 'OnAirX' }),
			}),
		]);
		// Whole, so an origin on it would fail: nobody issued this command.
		expect(applied(on)).toEqual([
			{
				screenId: on.screenId,
				sessionId: on.sessionId,
				sequence: after.sequence,
				commandType: 'Resolve Bindings',
				change: {
					socialProfileProjections: {
						[LOWER]: {
							profile: JSON.parse(JSON.stringify(projection)),
						},
					},
				},
			},
		]);
	});

	it('commits and announces nothing for a write program does not show', async () => {
		const { on, talent } = await onAirWithTalent('live', { twitch: 'OnAir' });
		const before = await stored(on);
		ably.reset();

		await talentService().update(talent.id, on.eventId, { role: 'Host' });
		await refreshBroadcastGraphicsBindings(on.eventId);

		expect(await stored(on)).toEqual(before);
		expect(applied(on)).toEqual([]);
	});

	it('serializes a manual choice racing the refresh, never reviving a removed profile', async () => {
		const { on, talent } = await onAirWithTalent('live', { twitch: 'RaceTwitch', x: 'RaceX' });
		const taken = await stored(on);

		await Promise.allSettled([
			writeProfiles(on, talent.id, { youtube: 'RaceWinner' }),
			send(on, 'Select Social Profile', { projectionKey: 'profile', network: 'x' }),
		]);

		const session = await liveSession.loadSession(on.eventId, on.screenId);
		const projection = session.currentState.socialProfileProjections![LOWER]!.profile!;
		expect(session.sequence).toBeGreaterThan(taken.sequence);
		expect(session.recoveryFault).toBeNull();
		expect(projection).toMatchObject({
			acceptedProfiles: [
				{ network: 'youtube', handle: 'RaceWinner' },
			],
			currentNetwork: 'youtube',
		});
		expect(projection.manualNetwork).toBeUndefined();
	});
});

describe('a change of Talent the Live Session does not apply by itself', () => {
	it.each<{ change: string; announces: string[]; run: (on: Stage, talentId: number) => Promise<unknown> }>([
		{
			change: 'a write to its Talent',
			announces: [],
			run: (on, talentId) => writeProfiles(on, talentId, { youtube: 'PendingOnly' }),
		},
		{
			change: 'the operator selecting another Talent',
			announces: ['Select Source'],
			run: async (on) => {
				const other = await talentService().create(on.eventId, {
					name: 'Replacement',
					socialProfiles: { youtube: 'PendingOnly' },
				});
				await send(on, 'Select Source', { sourceKey: 'talent', selectionId: other.id });
			},
		},
	])('keeps a staged projection as accepted, out of the picker, through $change until Update Graphic', async ({ announces, run }) => {
		const { on, talent } = await onAirWithTalent('staged', { twitch: 'AcceptedLive', x: 'AcceptedX' });
		await send(on, 'Select Social Profile', { projectionKey: 'profile', network: 'x' });
		const before = await storedProjection(on);
		ably.reset();

		await run(on, talent.id);

		expect(await storedProjection(on)).toEqual(before);
		expect(applied(on).map(message => message.commandType)).toEqual(announces);
		await expect(send(on, 'Select Social Profile', { projectionKey: 'profile', network: 'youtube' }))
			.rejects
			.toMatchObject({
				statusCode: 409,
				data: { code: 'social-profile-unavailable' },
			});

		await send(on, 'Update Graphic', {
			basedOnAcceptedRevision: (await stored(on)).currentState.inputs[LOWER]!.acceptedRevision,
		});

		const accepted = (await storedProjection(on))!;
		expect(accepted).toMatchObject({
			acceptedProfiles: [
				{ network: 'youtube', handle: 'PendingOnly' },
			],
			currentNetwork: 'youtube',
		});
		expect(accepted.manualNetwork).toBeUndefined();
		expect(accepted.transitionAnchor).toBeUndefined();
	});

	it('leaves a graphic that is off air as it was, and its next Take accepts the Talent\'s row', async () => {
		const { on, talent } = await onAirWithTalent('live', { twitch: 'BeforeTake', x: 'BeforeManual' });
		await send(on, 'Select Social Profile', { projectionKey: 'profile', network: 'x' });
		await send(on, 'Out', { cut: true });
		const before = await stored(on);
		ably.reset();

		await writeProfiles(on, talent.id, { youtube: 'LatestTake' });

		expect(await stored(on)).toEqual(before);
		expect(applied(on)).toEqual([]);

		await send(on, 'Take');

		const retaken = (await storedProjection(on))!;
		expect(retaken).toMatchObject({
			talent: { id: talent.id },
			acceptedProfiles: [
				{ network: 'youtube', handle: 'LatestTake' },
			],
			currentNetwork: 'youtube',
		});
		expect(retaken.manualNetwork).toBeUndefined();
	});
});

describe('an Event write naming its Talents', () => {
	it('moves a live projection of Talent 1 to the replacement, discarding the manual choice', async () => {
		const SECOND = 'second';
		const on = await stage([
			profileGraphic(LOWER, 'live', 'commentator1'),
			profileGraphic(SECOND, undefined, 'commentator2'),
		]);
		const first = await talentService().create(on.eventId, {
			name: 'First Caster',
			socialProfiles: { twitch: 'FirstLive', x: 'FirstCasts' },
		});
		const replacement = await talentService().create(on.eventId, {
			name: 'Replacement Caster',
			socialProfiles: { youtube: 'ReplacementLive' },
		});
		const silent = await talentService().create(on.eventId, { name: 'Casey Park', socialProfiles: {} });
		await eventService().update(on.eventId, { commentator1TalentId: first.id, commentator2TalentId: silent.id });
		await send(on, 'Take');
		await send(on, 'Take', { graphicId: SECOND });
		await send(on, 'Select Social Profile', { projectionKey: 'profile', network: 'x' });
		// A Talent with no profile is still the projection's Talent.
		expect(await storedProjection(on, SECOND)).toEqual({
			talent: { id: silent.id, name: 'Casey Park' },
			acceptedProfiles: [],
			automatic: true,
		});
		ably.reset();
		advance(1_000);

		await eventService().update(on.eventId, { commentator1TalentId: replacement.id });
		await refreshBroadcastGraphicsBindings(on.eventId);

		const projection = (await storedProjection(on))!;
		expect(projection).toMatchObject({
			talent: { id: replacement.id, name: 'Replacement Caster' },
			acceptedProfiles: [
				{ network: 'youtube', handle: 'ReplacementLive' },
			],
			currentNetwork: 'youtube',
			transitionAnchor: { startedAt: NOW + 1_000 },
			rotationAnchor: { network: 'youtube', anchoredAt: NOW + 1_000 + TRANSITION_MS },
		});
		expect(projection.manualNetwork).toBeUndefined();
		expect(applied(on).map(message => message.commandType)).toEqual(['Resolve Bindings']);
	});
});

describe('a Social Profile command against the Talent\'s stored row', () => {
	it.each([
		{
			refused: 'a network the Talent has no profile on',
			type: 'Select Social Profile',
			payload: { projectionKey: 'profile', network: 'x' },
			statusCode: 409,
			code: 'social-profile-unavailable',
		},
		{
			refused: 'a projection the graphic does not declare',
			type: 'Next Social Profile',
			payload: { projectionKey: 'missing' },
			statusCode: 404,
			code: 'unknown-social-profile-projection',
		},
	] as const)('refuses $refused as $code, changing and announcing nothing', async ({ type, payload, statusCode, code }) => {
		const { on } = await onAirWithTalent(undefined, { twitch: 'DrewLive' });
		const before = await stored(on);
		ably.reset();

		await expect(send(on, type, payload)).rejects.toMatchObject({
			statusCode,
			data: { code },
		});

		expect(await stored(on)).toEqual(before);
		expect(applied(on)).toEqual([]);
	});

	// A row written before the handle bound existed; no write could store it now.
	it('accepts no profile from a stored handle over the bound, leaving the session readable', async () => {
		const on = await stage([
			profileGraphic(LOWER),
		]);
		const talent = await talentService().create(on.eventId, {
			name: 'Legacy Long Handle',
			socialProfiles: { twitch: 'before-migration' },
		});
		await db.update(schema.eventTalents)
			.set({
				twitchHandle: 'a'.repeat(MAX_SOCIAL_PROFILE_HANDLE_LENGTH + 1),
			})
			.where(eq(schema.eventTalents.id, talent.id));
		await send(on, 'Select Source', { sourceKey: 'talent', selectionId: talent.id });

		await send(on, 'Take');

		const reloaded = await liveSession.loadSession(on.eventId, on.screenId);
		expect(reloaded.recoveryFault).toBeNull();
		expect(reloaded.currentState.socialProfileProjections?.[LOWER]?.profile).toEqual({
			talent: { id: talent.id, name: 'Legacy Long Handle' },
			acceptedProfiles: [],
			automatic: true,
		});
	});
});
