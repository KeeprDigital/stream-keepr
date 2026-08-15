import type { ScreenResponse } from '~~/shared/api';
import type { BroadcastGraphicTemplateResponse } from '~~/shared/types/broadcastGraphicTemplate';
import type { BroadcastGraphicConfig, TextGraphicItemConfig } from '~~/shared/types/graphics';
import type {
	GraphicStyleSetPublishResponse,
	GraphicStyleSetResponse,
	GraphicStyleUpdateReview,
} from '~~/shared/types/graphicStyleSet';
import { randomUUID } from 'node:crypto';
import { $fetch, fetch } from '@nuxt/test-utils/e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGraphicsAuthorSessionCookie } from './graphicsAuthorSession';

/**
 * Graphic Style Sets through the real API.
 *
 * The behaviour under test is the operator-visible contract of a shared style: edits
 * accumulate privately, one atomic publish makes them real, a linked template is
 * offered* an update rather than given one, applying it keeps the author's own
 * deviations, and a placed Broadcast Graphic never moves at all.
 *
 * Everything goes through command → snapshot: the composition is written through the
 * Screen's own configuration path, saved through the library route, and re-read from
 * the API. Nothing here inspects storage.
 */

const runId = randomUUID();
/** A short, slug-safe discriminator: a Screen slug is capped at 50 characters. */
const shortId = runId.slice(0, 8);

const BRAND = `brand-${runId}`;
const INK = `ink-${runId}`;
const HEADING = `heading-${runId}`;
const PANEL_FILL = `panel-fill-${runId}`;
const PANEL = `panel-${runId}`;

/** A whole, publishable draft: a palette, a typography preset, a fill, a surface. */
function soundDraft(brandColor = '#ff0044', headingSize = 64) {
	return [
		{ id: BRAND, kind: 'palette', name: 'Brand', schemaVersion: 1, value: { color: brandColor } },
		{ id: INK, kind: 'palette', name: 'Ink', schemaVersion: 1, value: { color: '#101014' } },
		{
			id: HEADING,
			kind: 'typography',
			name: 'Heading',
			schemaVersion: 1,
			value: {
				font: { kind: 'application', fontId: 'inter' },
				fontSize: headingSize,
				fontWeight: 800,
				fontStyle: 'normal',
				textTransform: 'uppercase',
				letterSpacing: 2,
				lineHeight: 1,
				colorEntryId: BRAND,
			},
		},
		{
			id: PANEL_FILL,
			kind: 'fill',
			name: 'Panel fill',
			schemaVersion: 1,
			value: { type: 'solid', colorEntryId: INK },
		},
		{
			id: PANEL,
			kind: 'surface-style',
			name: 'Panel',
			schemaVersion: 1,
			value: { fillEntryId: PANEL_FILL, fillOpacity: 0.9 },
		},
	];
}

/** The typography a heading-bound Text Graphic Item renders under `soundDraft()`. */
function headingTypography(color = '#ff0044', fontSize = 64) {
	return {
		font: { kind: 'application', fontId: 'inter' },
		fontSize,
		fontWeight: 800,
		fontStyle: 'normal' as const,
		textTransform: 'uppercase' as const,
		letterSpacing: 2,
		lineHeight: 1,
		textAlign: 'left' as const,
		color,
	};
}

function textItem(id: string, typography: object, styleRefs?: object) {
	return {
		type: 'text' as const,
		id,
		label: id,
		visible: true,
		anchor: 'top-left' as const,
		x: 24,
		y: 24,
		width: 560,
		height: 64,
		text: 'Now playing',
		typography,
		overflowPolicy: 'shrink' as const,
		minFontSize: 24,
		...(styleRefs ? { styleRefs } : {}),
	};
}

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

const STYLE_SETS = '/api/graphics-style-sets';
const TEMPLATES = '/api/graphics-templates/broadcast-graphics';

describe('graphic Style Sets', () => {
	let eventId: number;
	let screenId: number;
	let authorCookie: string;
	let styleSetId: string;
	let templateId: string;

	async function styleSet(): Promise<GraphicStyleSetResponse> {
		const current = await request(`${STYLE_SETS}/${styleSetId}`, { cookie: authorCookie });
		return current.data as GraphicStyleSetResponse;
	}

	async function saveDraft(draft: unknown[]) {
		const current = await styleSet();
		return await request(`${STYLE_SETS}/${styleSetId}`, {
			method: 'PATCH',
			cookie: authorCookie,
			body: { draft, draftRevision: current.draftRevision },
		});
	}

	async function publish() {
		const current = await styleSet();
		return await request(`${STYLE_SETS}/${styleSetId}/publish`, {
			method: 'POST',
			cookie: authorCookie,
			body: { draftRevision: current.draftRevision },
		});
	}

	async function screenStack(): Promise<BroadcastGraphicConfig[]> {
		const screen = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens/${screenId}`);
		return (screen.modeConfigs?.['broadcast-graphics']?.graphics ?? []) as BroadcastGraphicConfig[];
	}

	async function patchStack(graphics: unknown[]) {
		return await request(`/api/events/${eventId}/screens/${screenId}/config/broadcast-graphics`, {
			method: 'PATCH',
			body: { graphics },
		});
	}

	async function template(): Promise<BroadcastGraphicTemplateResponse> {
		const current = await request(`${TEMPLATES}/${templateId}`, { cookie: authorCookie });
		return current.data as BroadcastGraphicTemplateResponse;
	}

	function headlineOf(document: BroadcastGraphicConfig): TextGraphicItemConfig {
		const item = document.items.find(candidate => candidate.id === 'headline');
		if (item?.type !== 'text')
			throw new Error('expected the Text Graphic Item');
		return item;
	}

	async function styleUpdate(): Promise<GraphicStyleUpdateReview> {
		const review = await request(`${TEMPLATES}/${templateId}/style-update`, { cookie: authorCookie });
		return review.data as GraphicStyleUpdateReview;
	}

	beforeAll(async () => {
		authorCookie = await createGraphicsAuthorSessionCookie();

		const event = await $fetch('/api/events', {
			method: 'POST',
			body: { name: `Style Set Event ${runId}`, game: 'mtg', featureMatchOrientation: 'horizontal' },
		});
		eventId = event.id as number;
		const screen = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens`, {
			method: 'POST',
			body: { name: 'Graphics', slug: `style-set-screen-${shortId}`, currentMode: 'broadcast-graphics' },
		});
		screenId = screen.id;
	});

	afterAll(async () => {
		try {
			if (templateId)
				await request(`${TEMPLATES}/${templateId}`, { method: 'DELETE', cookie: authorCookie });
		}
		catch {}
		try {
			if (styleSetId) {
				const current = await styleSet();
				await request(`${STYLE_SETS}/${styleSetId}`, {
					method: 'DELETE',
					cookie: authorCookie,
					body: { draftRevision: current.draftRevision },
				});
			}
		}
		catch {}
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	it('creates a Graphic Style Set that has never been published', async () => {
		const created = await request(STYLE_SETS, {
			method: 'POST',
			cookie: authorCookie,
			body: { name: `Show style ${runId}` },
		});

		expect(created.status).toBe(201);
		const set = created.data as GraphicStyleSetResponse;
		// Revision zero is a real state: nothing can link to a Style Set that has never
		// resolved to anything.
		expect(set.revision).toBe(0);
		expect(set.published).toBeNull();
		styleSetId = set.id;
	});

	it('refuses to create a Graphic Style Set without a graphics author session', async () => {
		const anonymous = await request(STYLE_SETS, { method: 'POST', body: { name: 'Anonymous' } });

		expect(anonymous.status).toBe(401);
	});

	it('refuses the Graphic Style Set reads without a graphics author session', async () => {
		// #206: reads ask for the same session the writes do — session-scoping,
		// not access control (ADR-0008).
		const anonymousList = await request(STYLE_SETS);
		expect(anonymousList.status).toBe(401);

		const anonymousSet = await request(`${STYLE_SETS}/${styleSetId}`);
		expect(anonymousSet.status).toBe(401);
	});

	it('refuses an over-sized initial draft on create, as editing one is refused', async () => {
		// Creating a Style Set accepts the same unbounded draft array editing one does, so
		// it is bounded by the same number. Sized to land in the gap that bound exists to
		// cover: over this route's own limit, and under the general mutation ceiling that
		// would otherwise be the only thing stopping it.
		const filler = 'x'.repeat(900);
		const oversized = Array.from({ length: 640 }, (_, index) => ({
			id: `bulk-${index}-${runId}`,
			kind: 'palette',
			name: filler,
			schemaVersion: 1,
			value: { color: '#ffffff' },
		}));
		// Asserted rather than assumed: a body over the general ceiling is refused by the
		// middleware before this route is reached, which would prove nothing about it.
		expect(JSON.stringify(oversized).length).toBeGreaterThan(512 * 1024);
		expect(JSON.stringify(oversized).length).toBeLessThan(1024 * 1024);

		const refused = await request(STYLE_SETS, {
			method: 'POST',
			cookie: authorCookie,
			body: { name: `Oversized ${runId}`, draft: oversized },
		});

		expect(refused.status).toBe(413);
		expect(JSON.stringify(refused.data)).toContain('Graphic Style Set must not exceed');
	});

	it('refuses a publish whose body is bigger than the precondition it carries', async () => {
		// Publishing names the draft revision the author reviewed and nothing else, so it
		// is bounded far below the general mutation ceiling — and bounded by *bytes*,
		// before the schema that would refuse this shape ever sees it.
		const refused = await request(`${STYLE_SETS}/${styleSetId}/publish`, {
			method: 'POST',
			cookie: authorCookie,
			body: { draftRevision: 1, padding: 'x'.repeat(5000) },
		});

		expect(refused.status).toBe(413);
		expect(JSON.stringify(refused.data)).toContain('Graphic Style Set publish request must not exceed');
	});

	it('accumulates edits in a working draft that no template can see', async () => {
		// Deliberately broken: the typography preset names a palette entry that is not
		// there yet. A draft is edited into existence in pieces, so this must be storable.
		const broken = soundDraft().filter(entry => entry.id !== BRAND);

		expect((await saveDraft(broken)).status).toBe(200);
		const set = await styleSet();
		expect(set.draft).toHaveLength(4);
		expect(set.published).toBeNull();
		expect(set.hasUnpublishedChanges).toBe(true);
	});

	it('refuses one atomic publish of a draft whose references do not resolve', async () => {
		const refused = await publish();

		expect(refused.status).toBe(422);
		expect(refused.data.data.issues).toEqual(expect.arrayContaining([
			expect.objectContaining({ code: 'entry-reference-missing', entryId: HEADING }),
		]));
		// Nothing was published, so nothing could have reached a template.
		expect((await styleSet()).revision).toBe(0);
	});

	it('publishes the whole draft as one revision once it resolves', async () => {
		expect((await saveDraft(soundDraft())).status).toBe(200);

		const published = await publish();

		expect(published.status).toBe(200);
		const result = published.data as GraphicStyleSetPublishResponse;
		expect(result.styleSet.revision).toBe(1);
		expect(result.styleSet.published).toHaveLength(5);
		expect(result.styleSet.hasUnpublishedChanges).toBe(false);
		// No template is linked yet, so it reaches none.
		expect(result.affectedTemplates).toEqual([]);
	});

	it('refuses a publish built on a draft revision another session has moved past', async () => {
		const stale = (await styleSet()).draftRevision;
		expect((await saveDraft(soundDraft())).status).toBe(200);

		const refused = await request(`${STYLE_SETS}/${styleSetId}/publish`, {
			method: 'POST',
			cookie: authorCookie,
			body: { draftRevision: stale },
		});

		expect(refused.status).toBe(409);
	});

	it('saves a linked template whose properties are inherited from published entries', async () => {
		// A Broadcast Graphic authored on a Screen: it stores its own resolved values and
		// records where they came from.
		expect((await patchStack([{
			id: 'lower-third',
			name: 'Lower third',
			items: [
				textItem('headline', headingTypography(), { typography: { entryId: HEADING } }),
				textItem('subhead', headingTypography('#ff0044', 32), {
					typography: { entryId: HEADING, overrides: { fontSize: 32 } },
				}),
			],
			styleSet: { styleSetId, revision: 1 },
		}])).status).toBe(200);

		const saved = await request(TEMPLATES, {
			method: 'POST',
			cookie: authorCookie,
			body: { source: { eventId, screenId, graphicId: 'lower-third' } },
		});

		expect(saved.status).toBe(201);
		const created = saved.data as BroadcastGraphicTemplateResponse;
		expect(created.document.styleSet).toEqual({ styleSetId, revision: 1 });
		expect(headlineOf(created.document).styleRefs?.typography?.entryId).toBe(HEADING);
		templateId = created.id;
	});

	it('refuses a template whose Graphic Style Set references do not resolve', async () => {
		// Appended rather than replacing the stack: the authored Broadcast Graphic above
		// stays on the Screen, because a later test proves the Style Set never moves it.
		expect((await patchStack([...await screenStack(), {
			id: 'dangling',
			name: 'Dangling',
			items: [textItem('headline', headingTypography(), { typography: { entryId: 'never-published' } })],
			styleSet: { styleSetId, revision: 1 },
		}])).status).toBe(200);

		const refused = await request(TEMPLATES, {
			method: 'POST',
			cookie: authorCookie,
			body: { source: { eventId, screenId, graphicId: 'dangling' } },
		});

		// Storing it would put an entry in the library that no publish, review, or
		// deletion could ever act on.
		expect(refused.status).toBe(409);
		expect(refused.data.message).toContain('do not resolve');
	});

	it('offers no update while the published entries resolve to what the template renders', async () => {
		const review = await styleUpdate();

		expect(review.styleSet).toMatchObject({ id: styleSetId, linkedRevision: 1, publishedRevision: 1 });
		expect(review.available).toBe(false);
		expect(review.changes).toEqual([]);
	});

	it('refuses the style update review without a graphics author session', async () => {
		// #206: the review is a read on the author surface, so it asks for the
		// same session as its siblings — session-scoping, not access control
		// (ADR-0008).
		const anonymous = await request(`${TEMPLATES}/${templateId}/style-update`);

		expect(anonymous.status).toBe(401);
	});

	it('offers no update for a rename, because a rename changes no resolved value', async () => {
		const renamed = soundDraft().map(entry =>
			entry.id === HEADING ? { ...entry, name: 'Show heading' } : entry,
		);
		expect((await saveDraft(renamed)).status).toBe(200);

		const published = await publish();

		expect(published.status).toBe(200);
		const result = published.data as GraphicStyleSetPublishResponse;
		expect(result.affectedTemplates).toEqual([
			expect.objectContaining({ id: templateId, styleChanged: false }),
		]);
		expect((await styleUpdate()).available).toBe(false);
	});

	it('offers an update when a referenced entry\'s transitive dependency changes', async () => {
		// `heading` itself is untouched; the palette entry it links its colour to moved.
		const recoloured = soundDraft('#00ff88').map(entry =>
			entry.id === HEADING ? { ...entry, name: 'Show heading' } : entry,
		);
		expect((await saveDraft(recoloured)).status).toBe(200);

		const published = await publish();
		expect(published.status).toBe(200);
		expect((published.data as GraphicStyleSetPublishResponse).affectedTemplates).toEqual([
			expect.objectContaining({ id: templateId, styleChanged: true }),
		]);

		const review = await styleUpdate();
		expect(review.available).toBe(true);
		expect(review.changes).toEqual(expect.arrayContaining([
			expect.objectContaining({ ownerItemId: 'headline', slot: 'typography' }),
		]));
	});

	it('does not change the template until its author applies the update', async () => {
		const current = await template();

		expect(headlineOf(current.document).typography.color).toBe('#ff0044');
		expect(current.document.styleSet).toEqual({ styleSetId, revision: 1 });
	});

	it('applies the update atomically as one new template revision, preserving overrides', async () => {
		const before = await template();
		const reviewed = await styleUpdate();

		const applied = await request(`${TEMPLATES}/${templateId}/style-update`, {
			method: 'POST',
			cookie: authorCookie,
			body: { revision: before.revision, styleSetRevision: reviewed.styleSet!.publishedRevision },
		});

		expect(applied.status).toBe(200);
		const after = applied.data as BroadcastGraphicTemplateResponse;
		expect(after.revision).toBe(before.revision + 1);
		// Revision 3: the rename published one, and the recolour published another.
		expect(after.document.styleSet).toEqual({ styleSetId, revision: 3 });

		// The inherited property moved…
		expect(headlineOf(after.document).typography.color).toBe('#00ff88');
		// …and the author's own deviation did not.
		const subhead = after.document.items.find(item => item.id === 'subhead');
		expect(subhead?.type === 'text' && subhead.typography.fontSize).toBe(32);
		expect(subhead?.type === 'text' && subhead.typography.color).toBe('#00ff88');

		expect((await styleUpdate()).available).toBe(false);
	});

	it('never changes a placed Broadcast Graphic on a Screen', async () => {
		const placed = (await screenStack()).find(graphic => graphic.id === 'lower-third');

		// The Screen's own copy was authored before the Style Set was republished twice
		// and has been left exactly where it was.
		const headline = placed!.items.find(item => item.id === 'headline');
		expect(headline?.type === 'text' && headline.typography.color).toBe('#ff0044');
	});

	it('preserves a previously resolved property as a new local override when review says so', async () => {
		const larger = soundDraft('#00ff88', 96).map(entry =>
			entry.id === HEADING ? { ...entry, name: 'Show heading' } : entry,
		);
		expect((await saveDraft(larger)).status).toBe(200);
		expect((await publish()).status).toBe(200);

		const before = await template();
		const reviewed = await styleUpdate();
		const applied = await request(`${TEMPLATES}/${templateId}/style-update`, {
			method: 'POST',
			cookie: authorCookie,
			body: {
				revision: before.revision,
				styleSetRevision: reviewed.styleSet!.publishedRevision,
				decisions: { 'headline::typography': 'keep-as-override' },
			},
		});

		expect(applied.status).toBe(200);
		const after = applied.data as BroadcastGraphicTemplateResponse;
		// The property did not move…
		expect(headlineOf(after.document).typography.fontSize).toBe(64);
		// …and it is now the author's own, so a later republish cannot move it back.
		expect(headlineOf(after.document).styleRefs?.typography?.overrides)
			.toMatchObject({ fontSize: 64 });
		expect((await styleUpdate()).available).toBe(false);
	});

	/**
	 * The review is a promise about *one* Style Set revision, and this is what makes it
	 * one. An author who reviewed revision N and posts back after someone republished
	 * gets nothing applied — because their decisions say nothing about slots that only
	 * changed in N+1, and every one of those would silently inherit.
	 */
	it('refuses an apply built on a Style Set revision the author did not review', async () => {
		const reviewedRevision = (await styleUpdate()).styleSet!.publishedRevision;

		const republished = soundDraft('#2244ff', 96).map(entry =>
			entry.id === HEADING ? { ...entry, name: 'Show heading' } : entry,
		);
		expect((await saveDraft(republished)).status).toBe(200);
		expect((await publish()).status).toBe(200);

		const before = await template();
		const refused = await request(`${TEMPLATES}/${templateId}/style-update`, {
			method: 'POST',
			cookie: authorCookie,
			body: { revision: before.revision, styleSetRevision: reviewedRevision },
		});

		expect(refused.status).toBe(409);
		// And the template is exactly where it was: not half applied, not applied at all.
		const untouched = await template();
		expect(untouched.revision).toBe(before.revision);
		expect(untouched.document).toEqual(before.document);

		// Re-reviewed and applied, the same update goes through.
		const rereviewed = await styleUpdate();
		expect(rereviewed.available).toBe(true);
		const applied = await request(`${TEMPLATES}/${templateId}/style-update`, {
			method: 'POST',
			cookie: authorCookie,
			body: {
				revision: before.revision,
				styleSetRevision: rereviewed.styleSet!.publishedRevision,
			},
		});

		expect(applied.status).toBe(200);
		// The headline's whole typography group became the author's own in the test
		// above, so the subhead is the item still inheriting the palette colour.
		const after = applied.data as BroadcastGraphicTemplateResponse;
		const subhead = after.document.items.find(item => item.id === 'subhead');
		expect(subhead?.type === 'text' && subhead.typography.color).toBe('#2244ff');
		expect((await styleUpdate()).available).toBe(false);
	});

	it('refuses to detach an entry that other Graphic Style Set entries reference', async () => {
		const current = await styleSet();

		const refused = await request(`${STYLE_SETS}/${styleSetId}/entries/${INK}`, {
			method: 'DELETE',
			cookie: authorCookie,
			body: { mode: 'detach', draftRevision: current.draftRevision },
		});

		// A Graphic Fill preset has nowhere to store a colour of its own, so there is no
		// value to freeze — only a replacement is expressible.
		expect(refused.status).toBe(409);
		expect(refused.data.data.code).toBe('detach-would-break-entries');
		expect(refused.data.data.entryIds).toContain(PANEL_FILL);
	});

	it('refuses a replacement of a different kind', async () => {
		const current = await styleSet();

		const refused = await request(`${STYLE_SETS}/${styleSetId}/entries/${INK}`, {
			method: 'DELETE',
			cookie: authorCookie,
			body: {
				mode: 'replace',
				replacementEntryId: HEADING,
				draftRevision: current.draftRevision,
			},
		});

		expect(refused.status).toBe(409);
		expect(refused.data.data.code).toBe('replacement-kind-mismatch');
	});

	it('replaces every reference to a deleted entry across the Style Set and its templates', async () => {
		const beforeTemplate = await template();
		const current = await styleSet();

		const deleted = await request(`${STYLE_SETS}/${styleSetId}/entries/${HEADING}`, {
			method: 'DELETE',
			cookie: authorCookie,
			body: {
				mode: 'replace',
				replacementEntryId: `${HEADING}-alt`,
				draftRevision: current.draftRevision,
			},
		});
		expect(deleted.status).toBe(409);
		expect(deleted.data.data.code).toBe('replacement-not-found');

		// Add a second typography preset to replace it with.
		const withAlternative = [
			...current.draft,
			{
				id: `${HEADING}-alt`,
				kind: 'typography',
				name: 'Alternative heading',
				schemaVersion: 1,
				value: {
					font: { kind: 'application', fontId: 'inter' },
					fontSize: 40,
					fontWeight: 400,
					fontStyle: 'normal',
					textTransform: 'none',
					letterSpacing: 0,
					lineHeight: 1.2,
					colorEntryId: BRAND,
				},
			},
		];
		expect((await saveDraft(withAlternative)).status).toBe(200);

		// Replacing with a draft-only entry is refused. This operation repoints the
		// published entries and every affected template's document without going through
		// publish, so a replacement nothing has published yet would leave every one of
		// those templates referencing an id no linked template can resolve.
		const unpublished = await styleSet();
		const premature = await request(`${STYLE_SETS}/${styleSetId}/entries/${HEADING}`, {
			method: 'DELETE',
			cookie: authorCookie,
			body: {
				mode: 'replace',
				replacementEntryId: `${HEADING}-alt`,
				draftRevision: unpublished.draftRevision,
			},
		});
		expect(premature.status).toBe(409);
		expect(premature.data.data.code).toBe('replacement-unpublished');

		expect((await publish()).status).toBe(200);

		const beforeReplacement = await styleSet();
		const replaced = await request(`${STYLE_SETS}/${styleSetId}/entries/${HEADING}`, {
			method: 'DELETE',
			cookie: authorCookie,
			body: {
				mode: 'replace',
				replacementEntryId: `${HEADING}-alt`,
				draftRevision: beforeReplacement.draftRevision,
			},
		});

		expect(replaced.status).toBe(200);
		// The templates it rewrote are named, each already at its new revision, so an
		// author whose designs were revised under them knows which ones to look at.
		expect(replaced.data.rewrittenTemplates).toEqual([
			expect.objectContaining({ id: templateId, name: 'Lower third' }),
		]);
		const after = await template();
		// One new template revision, with the reference repointed and the author's own
		// override carried across with it.
		expect(after.revision).toBeGreaterThan(beforeTemplate.revision);
		expect(headlineOf(after.document).styleRefs?.typography?.entryId).toBe(`${HEADING}-alt`);
		const subhead = after.document.items.find(item => item.id === 'subhead');
		expect(subhead?.type === 'text' && subhead.styleRefs?.typography?.overrides)
			.toMatchObject({ fontSize: 32 });
		// The deleted entry is gone from both the draft and the published entries, so no
		// template is left resolving against something an author deleted.
		const set = await styleSet();
		expect(set.draft.map(entry => entry.id)).not.toContain(HEADING);
		expect(set.published!.map(entry => entry.id)).not.toContain(HEADING);
	});

	it('detaches every reference to a deleted entry, keeping the values it produced', async () => {
		const before = await template();
		const renderedColor = headlineOf(before.document).typography.color;
		const current = await styleSet();

		const detached = await request(`${STYLE_SETS}/${styleSetId}/entries/${HEADING}-alt`, {
			method: 'DELETE',
			cookie: authorCookie,
			body: { mode: 'detach', draftRevision: current.draftRevision },
		});

		expect(detached.status).toBe(200);
		const after = await template();
		expect(after.revision).toBe(before.revision + 1);
		// Provenance gone, value untouched: nothing any output renders has changed.
		expect(headlineOf(after.document).styleRefs).toBeUndefined();
		expect(headlineOf(after.document).typography.color).toBe(renderedColor);
	});

	it('deletes a Graphic Style Set by detaching every template linked to it', async () => {
		const before = await template();
		const current = await styleSet();

		const removed = await request(`${STYLE_SETS}/${styleSetId}`, {
			method: 'DELETE',
			cookie: authorCookie,
			body: { draftRevision: current.draftRevision },
		});

		expect(removed.status).toBe(204);
		expect((await request(`${STYLE_SETS}/${styleSetId}`, { cookie: authorCookie })).status).toBe(404);

		const after = await template();
		expect(after.revision).toBe(before.revision + 1);
		expect(after.document.styleSet).toBeUndefined();
		// And the design is intact: a shared style was removed, not the work.
		expect(after.document.items).toHaveLength(2);
		expect(headlineOf(after.document).typography.fontSize).toBe(64);

		expect((await styleUpdate()).styleSet).toBeNull();
	});
});
