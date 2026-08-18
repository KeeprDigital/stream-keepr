import type { ScreenResponse } from '~~/shared/api';
import type {
	FeatureMatchLayoutTemplateResponse,
	FeatureMatchLayoutTemplateSummary,
} from '~~/shared/types/featureMatchLayoutTemplate';
import type { FeatureMatchLayoutConfig } from '~~/shared/types/screenConfig';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '../../shared/types/screenConfig';
import { $fetch, fetch } from './client';
import { createGraphicsAuthorSessionCookie } from './graphicsAuthorSession';

/**
 * The Feature Match Layout Template library through the real API.
 *
 * The behaviour under test is the round trip an author takes: compose a layout on a
 * Screen, save it as a template, and place that template on another Screen — in
 * another Event — as a copy that is nothing to do with the template any more, and
 * that arrives without a trace of the Event it was authored in.
 */

const LIBRARY_PATH = '/api/graphics-templates/feature-match-layouts';

/** Distinguishes this run's fixtures from any a previous run left in the library. */
const runId = randomUUID().slice(0, 8);

async function request(
	path: string,
	options: { method?: string; body?: unknown; cookie?: string } = {},
): Promise<{ status: number; data: any }> {
	const headers: Record<string, string> = {};
	if (options.cookie)
		headers.cookie = options.cookie;
	if (options.body !== undefined)
		headers['content-type'] = 'application/json';

	const response = await fetch(path, {
		method: options.method ?? 'GET',
		headers,
		body: options.body === undefined ? undefined : JSON.stringify(options.body),
	});
	const text = await response.text();
	return { status: response.status, data: text ? JSON.parse(text) : null };
}

describe('feature Match Layout Template library', () => {
	let sourceEventId: number;
	let sourceScreenId: number;
	let sourceSlotId: number;
	let otherEventId: number;
	let otherScreenId: number;
	let otherSlotId: number;
	let authorCookie: string;
	let templateId: string;
	/** The layout the source Screen was authored with, as saved into the library. */
	let savedLayout: FeatureMatchLayoutConfig;

	/**
	 * An Event, a Feature Match Overlay Screen, and a Feature Match Slot to assign to
	 * it. The assignment itself happens in `beforeAll`, alongside the layout each
	 * Screen is seeded with.
	 *
	 * The Slot is what makes "a layout carries no Event identity" a claim that can
	 * fail. A Screen whose `featureMatchId` is `null` throughout satisfies every
	 * assertion about the absence of one for free, so both Screens get a real Slot
	 * before anything is saved or placed.
	 */
	async function createEventWithOverlayScreen(name: string, slug: string) {
		const event = await $fetch('/api/events', {
			method: 'POST',
			body: { name, game: 'mtg', featureMatchOrientation: 'horizontal' },
		});
		const screen = await $fetch<ScreenResponse>(`/api/events/${event.id}/screens`, {
			method: 'POST',
			body: { name, slug, currentMode: 'feature-match-overlay' },
		});
		const slot = await $fetch<{ id: number }>(`/api/events/${event.id}/feature-match-slots`, {
			method: 'POST',
			body: { bestOf: 3 },
		});
		return { eventId: event.id as number, screenId: screen.id, slotId: slot.id };
	}

	async function storedLayout(eventId: number, screenId: number): Promise<FeatureMatchLayoutConfig> {
		const screen = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens/${screenId}`);
		return screen.modeConfigs!['feature-match-overlay']!.layout as FeatureMatchLayoutConfig;
	}

	async function storedOverlayConfig(eventId: number, screenId: number) {
		const screen = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens/${screenId}`);
		return screen.modeConfigs!['feature-match-overlay']!;
	}

	async function screenStateVersion(eventId: number, screenId: number): Promise<number> {
		const screen = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens/${screenId}`);
		return screen.stateVersion;
	}

	async function place(eventId: number, screenId: number, body: { templateId: string }, cookie?: string) {
		return await request(
			`/api/events/${eventId}/screens/${screenId}/feature-match-overlay/layout-placements`,
			{
				method: 'POST',
				cookie,
				body: { ...body, stateVersion: await screenStateVersion(eventId, screenId) },
			},
		);
	}

	beforeAll(async () => {
		authorCookie = await createGraphicsAuthorSessionCookie();

		const source = await createEventWithOverlayScreen(`Layout Source Event ${runId}`, `layout-source-${runId}`);
		sourceEventId = source.eventId;
		sourceScreenId = source.screenId;
		sourceSlotId = source.slotId;
		const other = await createEventWithOverlayScreen(`Layout Target Event ${runId}`, `layout-target-${runId}`);
		otherEventId = other.eventId;
		otherScreenId = other.screenId;
		otherSlotId = other.slotId;

		// A layout distinguishable from the target Screen's default in every part an
		// author would recognise: the Frame, the Source Items, and the composition.
		const authored = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG.layout);
		authored.frame.backgroundColor = '#123456';
		authored.sources = [{
			id: 'main-source',
			label: 'Authored Main Source',
			visible: true,
			anchor: 'top-left',
			sourceRole: 'main',
			frameCutout: true,
			x: 10,
			y: 20,
			width: 800,
			height: 600,
		}];
		const patched = await request(
			`/api/events/${sourceEventId}/screens/${sourceScreenId}/config/feature-match-overlay`,
			{ method: 'PATCH', body: { layout: authored, featureMatchId: sourceSlotId } },
		);
		expect(patched.status).toBe(200);
		savedLayout = await storedLayout(sourceEventId, sourceScreenId);

		// The target Screen starts from the untouched default and its own assigned
		// Slot, so "placing replaced the layout" is a comparison against a layout that
		// really is stored rather than against the absence of one, and "the Screen's
		// own state survives" is a comparison against state that really is there.
		const seeded = await request(
			`/api/events/${otherEventId}/screens/${otherScreenId}/config/feature-match-overlay`,
			{ method: 'PATCH', body: { layout: DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG.layout, featureMatchId: otherSlotId } },
		);
		expect(seeded.status).toBe(200);
	});

	afterAll(async () => {
		if (templateId)
			await request(`${LIBRARY_PATH}/${templateId}`, { method: 'DELETE', cookie: authorCookie });
		for (const id of [sourceEventId, otherEventId]) {
			try {
				await $fetch(`/api/events/${id}`, { method: 'DELETE' });
			}
			catch {}
		}
	});

	it('saves a Screen\'s layout as a template at revision 1, leaving the Screen untouched', async () => {
		const saved = await request(LIBRARY_PATH, {
			method: 'POST',
			cookie: authorCookie,
			body: {
				source: { eventId: sourceEventId, screenId: sourceScreenId },
				name: `Authored layout ${runId}`,
				description: 'Saved from the source Screen',
			},
		});

		expect(saved.status).toBe(201);
		const template = saved.data as FeatureMatchLayoutTemplateResponse;
		templateId = template.id;
		expect(template.revision).toBe(1);
		expect(template.authored).toBe(true);
		expect(template.sourceCount).toBe(1);
		expect(template.document).toEqual(savedLayout);

		// Saving copies out of Screen configuration; it never converts the Screen's
		// layout into a reference to the template.
		expect(await storedLayout(sourceEventId, sourceScreenId)).toEqual(savedLayout);
	});

	/**
	 * A Feature Match Slot is Screen state, not layout. It is the identity that would
	 * make a saved layout belong to one Event, and there is nowhere in the stored
	 * document for it to be.
	 *
	 * The source Screen carries a real Slot assignment while this is saved, so a save
	 * that copied the Screen's whole Feature Match Overlay configuration instead of
	 * its layout would put a Slot identity from one Event into an installation-wide
	 * library — and fail here.
	 *
	 * Two assertions, because they catch different things. The field-name check names
	 * the leak an author would recognise and is the one that reads as the rule. It
	 * proves only that nothing is called `featureMatchId`, though, so a Slot travelling
	 * under some other key would walk past it; equality against the layout the Screen
	 * holds is what closes that, since a document with anything extra on it is not
	 * equal to one without.
	 */
	it('carries no Feature Match Slot assignment into the library', async () => {
		const assigned = await storedOverlayConfig(sourceEventId, sourceScreenId);
		expect(assigned.featureMatchId).toBe(sourceSlotId);

		const entry = await request(`${LIBRARY_PATH}/${templateId}`, { cookie: authorCookie });
		expect(entry.status).toBe(200);
		const document = (entry.data as FeatureMatchLayoutTemplateResponse).document;
		expect(JSON.stringify(document)).not.toContain('featureMatchId');
		expect(document).toEqual(savedLayout);
	});

	it('lists the saved template in the installation-scoped library', async () => {
		const listed = await request(LIBRARY_PATH, { cookie: authorCookie });

		expect(listed.status).toBe(200);
		const templates = (listed.data as { templates: FeatureMatchLayoutTemplateSummary[] }).templates;
		expect(templates.some(template => template.id === templateId)).toBe(true);
	});

	it('refuses the library reads without a graphics author session', async () => {
		// #206: reads ask for the same session the writes do — session-scoping,
		// not access control (ADR-0008) — so the Graphic Asset identities a
		// document embeds are not enumerable one layer over from the Asset
		// Library's own guarded routes.
		const anonymousList = await request(LIBRARY_PATH);
		expect(anonymousList.status).toBe(401);

		const anonymousEntry = await request(`${LIBRARY_PATH}/${templateId}`);
		expect(anonymousEntry.status).toBe(401);
	});

	/**
	 * The acceptance criterion stated as one operator-visible rule: placing a layout
	 * template replaces the whole layout. The target Screen is in another Event, and
	 * what arrives is the Frame, the Source Items, and the composition together —
	 * while everything that was never part of the layout stays as it was.
	 */
	it('replaces the whole layout of a Screen in another Event when a template is placed', async () => {
		const before = await storedOverlayConfig(otherEventId, otherScreenId);
		expect(before.layout).not.toEqual(savedLayout);

		const placed = await place(otherEventId, otherScreenId, { templateId }, authorCookie);

		expect(placed.status).toBe(201);
		const after = await storedOverlayConfig(otherEventId, otherScreenId);
		expect(after.layout).toEqual(savedLayout);
		// The Screen's own state survives: a placement writes the layout and nothing
		// else the Screen owns. The Slot assignment is the state worth naming, because
		// it is the one a placement carrying a whole configuration would overwrite.
		expect(before.featureMatchId).toBe(otherSlotId);
		expect(after.featureMatchId).toBe(otherSlotId);
		expect(after.presetId).toEqual(before.presetId);
	});

	/**
	 * The copy is unlinked. Revising the template afterwards must not reach the
	 * layout already placed from it, or a library edit would rewrite a Screen
	 * somebody is running a show on.
	 */
	it('leaves a placed layout untouched when the template it came from is revised', async () => {
		const current = await request(`${LIBRARY_PATH}/${templateId}`, { cookie: authorCookie });
		const revision = (current.data as FeatureMatchLayoutTemplateResponse).revision;
		const revised = structuredClone(savedLayout);
		revised.frame.backgroundColor = '#abcdef';

		const patched = await request(`${LIBRARY_PATH}/${templateId}`, {
			method: 'PATCH',
			cookie: authorCookie,
			body: { document: revised, revision },
		});

		expect(patched.status).toBe(200);
		expect((patched.data as FeatureMatchLayoutTemplateResponse).revision).toBe(revision + 1);
		const placed = await storedLayout(otherEventId, otherScreenId);
		expect(placed.frame.backgroundColor).toBe(savedLayout.frame.backgroundColor);
	});

	/**
	 * A stale revision is refused rather than applied last-write-wins: two authors
	 * with the library open must not silently overwrite one another.
	 */
	it('refuses a revision the author did not read', async () => {
		const stale = await request(`${LIBRARY_PATH}/${templateId}`, {
			method: 'PATCH',
			cookie: authorCookie,
			body: { name: 'Stale rename', revision: 1 },
		});

		expect(stale.status).toBe(409);
	});

	/**
	 * The two libraries are separate artifacts sharing only an envelope. A Broadcast
	 * Graphic Template identity is a perfectly valid identity that this library must
	 * not answer with, because the document behind it cannot be placed on a Feature
	 * Match Overlay.
	 */
	it('does not resolve a Broadcast Graphic Template identity', async () => {
		const graphicsScreen = await $fetch<ScreenResponse>(`/api/events/${sourceEventId}/screens`, {
			method: 'POST',
			body: {
				name: `Graphics Screen ${runId}`,
				slug: `graphics-screen-${runId}`,
				currentMode: 'broadcast-graphics',
			},
		});
		await request(`/api/events/${sourceEventId}/screens/${graphicsScreen.id}/config/broadcast-graphics`, {
			method: 'PATCH',
			body: { graphics: [{ id: 'a-graphic', name: 'A graphic', items: [] }] },
		});
		const savedGraphic = await request('/api/graphics-templates/broadcast-graphics', {
			method: 'POST',
			cookie: authorCookie,
			body: {
				source: { eventId: sourceEventId, screenId: graphicsScreen.id, graphicId: 'a-graphic' },
				name: `A graphic ${runId}`,
			},
		});
		expect(savedGraphic.status).toBe(201);
		const graphicTemplateId = savedGraphic.data.id as string;

		const crossRead = await request(`${LIBRARY_PATH}/${graphicTemplateId}`, { cookie: authorCookie });
		expect(crossRead.status).toBe(404);

		const crossPlace = await place(
			otherEventId,
			otherScreenId,
			{ templateId: graphicTemplateId },
			authorCookie,
		);
		expect(crossPlace.status).toBe(404);

		await request(`/api/graphics-templates/broadcast-graphics/${graphicTemplateId}`, {
			method: 'DELETE',
			cookie: authorCookie,
		});
	});

	/**
	 * Placing onto a Screen in another mode would author a layout the Screen does not
	 * render and no output would ever show.
	 */
	it('refuses to place a layout on a Screen that is not a Feature Match Overlay', async () => {
		const idleScreen = await $fetch<ScreenResponse>(`/api/events/${otherEventId}/screens`, {
			method: 'POST',
			body: { name: `Idle Screen ${runId}`, slug: `idle-screen-${runId}`, currentMode: 'idle' },
		});

		const refused = await place(otherEventId, idleScreen.id, { templateId }, authorCookie);

		expect(refused.status).toBe(409);
	});

	/**
	 * The library artifact is what travels, from wherever it was saved and without
	 * the Screen or Event it was authored on having to still exist.
	 */
	it('exports one library entry as a `.sklayout` Template Package', async () => {
		const response = await fetch(`${LIBRARY_PATH}/${templateId}/template-package`, {
			headers: { cookie: authorCookie },
		});

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type'))
			.toBe('application/vnd.streamkeepr.feature-match-layout-template+zip');
		expect(response.headers.get('content-disposition')).toContain('.sklayout');
		await response.arrayBuffer();
	});

	it('requires a graphics author session to save, revise, or export', async () => {
		const anonymousSave = await request(LIBRARY_PATH, {
			method: 'POST',
			body: { source: { eventId: sourceEventId, screenId: sourceScreenId } },
		});
		expect(anonymousSave.status).toBe(401);

		const anonymousExport = await fetch(`${LIBRARY_PATH}/${templateId}/template-package`);
		expect(anonymousExport.status).toBe(401);
	});
});
