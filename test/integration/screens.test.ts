import type { ScreenResponse } from '~~/shared/api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { $fetch } from './client';
import { $fetchRaw } from './helpers';

describe('screens API', () => {
	let eventId: number;
	let screenId: number;
	let screenStateVersion: number;
	const testSlug = 'integration-test-screen';

	beforeAll(async () => {
		const event = await $fetch('/api/events', {
			method: 'POST',
			body: { name: 'Integration Screens Event', game: 'mtg', featureMatchOrientation: 'horizontal' },
		});
		eventId = event.id;
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	it('creates a screen and returns 201', async () => {
		const res = await $fetchRaw(`/api/events/${eventId}/screens`, {
			method: 'POST',
			body: {
				name: 'Main Overlay',
				slug: testSlug,
				currentMode: 'background',
			},
		});

		expect(res.status).toBe(201);
		expect(res._data).toMatchObject({
			name: 'Main Overlay',
			slug: testSlug,
			currentMode: 'background',
			eventId,
		});
		expect(res._data.id).toBeTypeOf('number');
		screenId = res._data.id;
		screenStateVersion = res._data.stateVersion;
	});

	it('lists screens for the event', async () => {
		const data = await $fetch(`/api/events/${eventId}/screens`);

		expect(data.screens).toBeInstanceOf(Array);
		expect(data.total).toBeGreaterThanOrEqual(1);

		const found = data.screens.find((s: { id: number }) => s.id === screenId);
		expect(found).toBeDefined();
		expect(found!.name).toBe('Main Overlay');
	});

	// On the capability surface since #397, and admitted here by the suite's own
	// session — the arm the operator's `embed=preview` surfaces use. The bearer arm,
	// and the refusals, are `apiBoundary.test.ts`' business.
	it('gets a screen by slug', async () => {
		const screen = await $fetch(`/api/screen-output/events/${eventId}/screens/slug/${testSlug}`);

		expect(screen.id).toBe(screenId);
		expect(screen.slug).toBe(testSlug);
		expect(screen.name).toBe('Main Overlay');
	});

	it('updates a screen name and mode', async () => {
		const updated = await $fetch(`/api/events/${eventId}/screens/${screenId}`, {
			method: 'PATCH',
			body: {
				name: 'Updated Overlay',
				currentMode: 'card',
				stateVersion: screenStateVersion,
			},
		});

		expect(updated.id).toBe(screenId);
		expect(updated.name).toBe('Updated Overlay');
		expect(updated.currentMode).toBe('card');
		screenStateVersion = updated.stateVersion;
	});

	it('renames a Screen whose stored mode configs are PATCH fragments, sending them back as the Edit Screen dialog does', async () => {
		// Every fragment but Card Spotlight's and Top Cut Bracket's lacks a field the mode's complete
		// config requires, which the old form's full write refused (#588, #589); Card Spotlight
		// and Top Cut Bracket never required one. A full write of a mode on its config
		// contract accepts what storage holds. An empty PATCH leaves the Background
		// fragment empty, which is also what a display reset leaves.
		const fragments = {
			'background': {},
			'card': { scale: 1.5 },
			'deck': { showDeckName: false },
			'standings': { viewMode: 'all' },
			'top-cut': { showHeader: false },
			'feature-match': { showClock: false },
			'feature-match-overlay': { presetId: 'full-table' },
			'broadcast-graphics': { channels: [{ id: 'lower-thirds', name: 'Lower Thirds' }] },
			'metagame': { topN: 16 },
			'top-cards': { limit: 12 },
			'player-history': { rowsPerPage: 5 },
		};
		const screen = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens`, {
			method: 'POST',
			body: { name: 'Fragment Screen', slug: 'integration-fragment-screen', currentMode: 'standings' },
		});

		let stored = screen;
		for (const [mode, fragment] of Object.entries(fragments)) {
			stored = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens/${screen.id}/config/${mode}`, {
				method: 'PATCH',
				body: fragment,
			});
		}
		expect(stored.modeConfigs).toEqual(fragments);

		const res = await $fetchRaw(`/api/events/${eventId}/screens/${screen.id}`, {
			method: 'PATCH',
			body: {
				name: 'Renamed Fragment Screen',
				slug: stored.slug,
				currentMode: stored.currentMode,
				modeConfigs: stored.modeConfigs,
				stateVersion: stored.stateVersion,
			},
		});

		expect(res.status).toBe(200);
		expect(res._data.name).toBe('Renamed Fragment Screen');
		expect(res._data.modeConfigs).toEqual(fragments);
	});

	it('deletes a screen', async () => {
		// Create a throwaway screen
		const screen = await $fetch(`/api/events/${eventId}/screens`, {
			method: 'POST',
			body: {
				name: 'Delete Me Screen',
				slug: 'integration-delete-me',
				currentMode: 'background',
			},
		});

		const result = await $fetch(`/api/events/${eventId}/screens/${screen.id}`, {
			method: 'DELETE',
		});

		expect(result).toEqual({ success: true });

		// Verify it's gone via slug
		const res = await $fetchRaw(`/api/screen-output/events/${eventId}/screens/slug/integration-delete-me`);
		expect(res.status).toBe(404);
	});
});
