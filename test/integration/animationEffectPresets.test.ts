import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
	ANIMATION_EFFECT_PRESET_DOCUMENT_KIND,
	ANIMATION_EFFECT_PRESET_FORMAT_VERSION,
	MAX_ANIMATION_EFFECT_PRESET_DOCUMENT_BYTES,
} from '../../shared/animationEffectPresets';
import { $fetch, anonymousFetch, fetch } from './client';

interface AnimationEffectPresetResponse {
	id: string;
	name: string;
	revision: number;
	selection: {
		effect: string;
		params?: Record<string, unknown>;
	};
}

const library = '/api/animation-effect-presets';

describe('the installation Animation Effect Preset library', () => {
	it('stores a named host-neutral selection and lists it for another host', async () => {
		const name = `Integration fog ${randomUUID()}`;
		let presetId: string | undefined;

		try {
			const created = await $fetch<AnimationEffectPresetResponse>(library, {
				method: 'POST',
				body: {
					name,
					selection: { effect: 'fog', params: { speed: 0.4 } },
				},
			});
			presetId = created.id;

			expect(created).toMatchObject({
				name,
				revision: 1,
				selection: { effect: 'fog', params: expect.objectContaining({ speed: 0.4 }) },
			});

			const collection = await $fetch<{ presets: AnimationEffectPresetResponse[] }>(library);
			expect(collection.presets).toContainEqual(created);

			const detail = await $fetch<AnimationEffectPresetResponse>(`${library}/${presetId}`);
			expect(detail).toEqual(created);

			const updated = await $fetch<AnimationEffectPresetResponse>(`${library}/${presetId}`, {
				method: 'PATCH',
				body: {
					revision: 1,
					name: `${name} revised`,
					selection: { effect: 'caustics', params: { speed: 0.7 } },
				},
			});
			expect(updated).toMatchObject({
				id: presetId,
				name: `${name} revised`,
				revision: 2,
				selection: { effect: 'caustics', params: expect.objectContaining({ speed: 0.7 }) },
			});

			const stale = await fetch(`${library}/${presetId}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ revision: 1, name: 'Stale overwrite' }),
			});
			expect(stale.status).toBe(409);
			expect(await $fetch<AnimationEffectPresetResponse>(`${library}/${presetId}`)).toEqual(updated);
		}
		finally {
			if (presetId) {
				await $fetch(`${library}/${presetId}`, {
					method: 'DELETE',
				});
			}
		}
	});

	it('exports a portable document and imports it under a fresh identity', async () => {
		const name = `Portable caustics ${randomUUID()}`;
		const ids: string[] = [];

		try {
			const created = await $fetch<AnimationEffectPresetResponse>(library, {
				method: 'POST',
				body: { name, selection: { effect: 'caustics', params: { speed: 0.65 } } },
			});
			ids.push(created.id);

			const exported = await fetch(`${library}/${created.id}/export`);
			expect(exported.status).toBe(200);
			expect(exported.headers.get('content-type')).toContain('application/json');
			expect(exported.headers.get('content-disposition')).toContain('.skeffect');
			const document = await exported.text();
			expect(JSON.parse(document)).toMatchObject({
				kind: ANIMATION_EFFECT_PRESET_DOCUMENT_KIND,
				formatVersion: ANIMATION_EFFECT_PRESET_FORMAT_VERSION,
				name,
				selection: created.selection,
			});

			const imported = await $fetch<AnimationEffectPresetResponse>(`${library}/imports`, {
				method: 'POST',
				body: { document },
			});
			ids.push(imported.id);
			const importedAgain = await $fetch<AnimationEffectPresetResponse>(`${library}/imports`, {
				method: 'POST',
				body: { document },
			});
			ids.push(importedAgain.id);
			expect(imported).toMatchObject({
				name,
				revision: 1,
				selection: created.selection,
			});
			expect(importedAgain).toMatchObject({
				name,
				revision: 1,
				selection: created.selection,
			});
			expect(new Set([created.id, imported.id, importedAgain.id]).size).toBe(3);
		}
		finally {
			await Promise.all(ids.map(id => $fetch(`${library}/${id}`, { method: 'DELETE' })));
		}
	});

	it('refuses invalid and oversized imports without adding a library entry', async () => {
		const uniqueName = `Refused preset ${randomUUID()}`;
		const before = await $fetch<{ presets: AnimationEffectPresetResponse[] }>(library);
		const invalid = JSON.stringify({
			kind: ANIMATION_EFFECT_PRESET_DOCUMENT_KIND,
			formatVersion: ANIMATION_EFFECT_PRESET_FORMAT_VERSION,
			name: uniqueName,
			selection: { effect: 'fog', enabled: true },
		});

		const invalidResponse = await fetch(`${library}/imports`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ document: invalid }),
		});
		expect(invalidResponse.status).toBe(422);

		const oversizedResponse = await fetch(`${library}/imports`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ document: ' '.repeat(MAX_ANIMATION_EFFECT_PRESET_DOCUMENT_BYTES + 1) }),
		});
		expect(oversizedResponse.status).toBe(413);

		const after = await $fetch<{ presets: AnimationEffectPresetResponse[] }>(library);
		expect(after.presets).toEqual(before.presets);
	});

	it('requires authentication for the entire preset surface', async () => {
		const presetId = randomUUID();
		for (const [path, method] of [
			[library, 'GET'],
			[library, 'POST'],
			[`${library}/imports`, 'POST'],
			[`${library}/${presetId}`, 'GET'],
			[`${library}/${presetId}`, 'PATCH'],
			[`${library}/${presetId}`, 'DELETE'],
			[`${library}/${presetId}/export`, 'GET'],
		] as const) {
			const response = await anonymousFetch(path, {
				method,
				headers: method === 'POST' ? { 'content-type': 'application/json' } : undefined,
				body: method === 'POST' ? '{}' : undefined,
			});
			expect(response.status).toBe(401);
		}
	});
});
