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
				currentMode: 'idle',
			},
		});

		expect(res.status).toBe(201);
		expect(res._data).toMatchObject({
			name: 'Main Overlay',
			slug: testSlug,
			currentMode: 'idle',
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

	it('gets a screen by slug', async () => {
		const screen = await $fetch(`/api/events/${eventId}/screens/slug/${testSlug}`);

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

	it('deletes a screen', async () => {
		// Create a throwaway screen
		const screen = await $fetch(`/api/events/${eventId}/screens`, {
			method: 'POST',
			body: {
				name: 'Delete Me Screen',
				slug: 'integration-delete-me',
				currentMode: 'idle',
			},
		});

		const result = await $fetch(`/api/events/${eventId}/screens/${screen.id}`, {
			method: 'DELETE',
		});

		expect(result).toEqual({ success: true });

		// Verify it's gone via slug
		const res = await $fetchRaw(`/api/events/${eventId}/screens/slug/integration-delete-me`);
		expect(res.status).toBe(404);
	});
});
