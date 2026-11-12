import type { ScreenResponse } from '~~/shared/api';
import type { FeatureMatchLayoutTemplateResponse } from '~~/shared/types/featureMatchLayoutTemplate';
import type { FeatureMatchLayoutConfig } from '~~/shared/types/screenConfig';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '../../shared/types/screenConfig';
import { $fetch, fetch, operatorSessionCookie } from './client';

/**
 * The Feature Match Layout Template library through the real API: one wiring pass
 * of the round trip an author takes, and the export only a server answers.
 *
 * The library's rules are proved over real SQL in
 * `test/unit/server/api/featureMatchLayoutTemplateLibrary.sqlite.test.ts`.
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
		body: options.body === undefined
			? undefined
			: JSON.stringify(options.body),
	});
	const text = await response.text();
	return {
		status: response.status,
		data: text
			? JSON.parse(text)
			: null,
	};
}

describe('feature Match Layout Template library', () => {
	let sourceEventId: number;
	let sourceScreenId: number;
	let otherEventId: number;
	let otherScreenId: number;
	let authorCookie: string;
	let templateId: string;

	async function createEventWithOverlayScreen(name: string, slug: string) {
		const event = await $fetch('/api/events', {
			method: 'POST',
			body: { name, game: 'mtg', featureMatchOrientation: 'horizontal' },
		});
		const screen = await $fetch<ScreenResponse>(`/api/events/${event.id}/screens`, {
			method: 'POST',
			body: { name, slug, currentMode: 'feature-match-overlay' },
		});
		return { eventId: event.id as number, screenId: screen.id };
	}

	async function storedScreen(eventId: number, screenId: number) {
		return await $fetch<ScreenResponse>(`/api/events/${eventId}/screens/${screenId}`);
	}

	async function storedLayout(eventId: number, screenId: number): Promise<FeatureMatchLayoutConfig> {
		return (await storedScreen(eventId, screenId)).modeConfigs!['feature-match-overlay']!.layout as FeatureMatchLayoutConfig;
	}

	beforeAll(async () => {
		authorCookie = await operatorSessionCookie();

		const source = await createEventWithOverlayScreen(`Layout Source Event ${runId}`, `layout-source-${runId}`);
		sourceEventId = source.eventId;
		sourceScreenId = source.screenId;
		const other = await createEventWithOverlayScreen(`Layout Target Event ${runId}`, `layout-target-${runId}`);
		otherEventId = other.eventId;
		otherScreenId = other.screenId;

		// Distinguishable from the default the target Screen is seeded with below.
		const authored = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG.layout);
		authored.frame.opacity = 0.33;
		const patched = await request(
			`/api/events/${sourceEventId}/screens/${sourceScreenId}/config/feature-match-overlay`,
			{
				method: 'PATCH',
				body: { layout: authored },
			},
		);
		expect(patched.status).toBe(200);

		// A stored default, so "placing replaced the layout" compares against a
		// layout that really is there rather than against the absence of one.
		const seeded = await request(
			`/api/events/${otherEventId}/screens/${otherScreenId}/config/feature-match-overlay`,
			{
				method: 'PATCH',
				body: { layout: DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG.layout },
			},
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

	/*
	 * The refusal for a caller with no session at all is the API boundary's since
	 * #398, composed around every `/api/**` route before any handler runs, and it
	 * is proved against a genuinely anonymous client in `apiBoundary.test.ts`.
	 */

	it('saves a Screen\'s layout into the library and places it on a Screen in another Event', async () => {
		const savedLayout = await storedLayout(sourceEventId, sourceScreenId);
		expect(await storedLayout(otherEventId, otherScreenId)).not.toEqual(savedLayout);

		const saved = await request(LIBRARY_PATH, {
			method: 'POST',
			cookie: authorCookie,
			body: {
				source: { eventId: sourceEventId, screenId: sourceScreenId },
				name: `Authored layout ${runId}`,
			},
		});

		expect(saved.status).toBe(201);
		const template = saved.data as FeatureMatchLayoutTemplateResponse;
		templateId = template.id;
		expect(template.revision).toBe(1);
		expect(template.document).toEqual(savedLayout);

		const target = await storedScreen(otherEventId, otherScreenId);
		const placed = await request(
			`/api/events/${otherEventId}/screens/${otherScreenId}/feature-match-overlay/layout-placements`,
			{
				method: 'POST',
				cookie: authorCookie,
				body: { templateId, stateVersion: target.stateVersion },
			},
		);

		expect(placed.status).toBe(201);
		expect(await storedLayout(otherEventId, otherScreenId)).toEqual(savedLayout);
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
});
