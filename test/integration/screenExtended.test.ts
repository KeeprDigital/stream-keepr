import { $fetch } from '@nuxt/test-utils/e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('screens extended API', () => {
	let eventId: number;
	let screenId: number;

	beforeAll(async () => {
		const event = await $fetch('/api/events', {
			method: 'POST',
			body: { name: 'Integration ScreenExtended Event', game: 'mtg', featureMatchOrientation: 'horizontal' },
		});
		eventId = event.id;

		const screen = await $fetch(`/api/events/${eventId}/screens`, {
			method: 'POST',
			body: {
				name: 'Extended Test Screen',
				slug: 'integration-extended-screen',
				currentMode: 'idle',
			},
		});
		screenId = screen.id;
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	// ── Card endpoints ────────────────────────────────────────────────

	const sampleCard = {
		id: 'test-card-id',
		name: 'Lightning Bolt',
		set: 'lea',
		layout: 'normal' as const,
		imageData: {
			front: { small: 'https://example.com/front-small.jpg', normal: 'https://example.com/front.jpg' },
			back: null,
		},
		orientationData: {
			flipable: false,
			turnable: false,
			rotateable: false,
			counterRotateable: false,
		},
		displayData: {
			flipped: false,
			rotated: false,
			counterRotated: false,
			turnedOver: false,
		},
	};

	it('returns null/undefined when no card is set on the screen', async () => {
		const card = await $fetch(`/api/events/${eventId}/screens/${screenId}/card`);

		expect(card == null).toBe(true);
	});

	it('sets a card on the screen', async () => {
		const result = await $fetch(`/api/events/${eventId}/screens/${screenId}/card`, {
			method: 'PUT',
			body: sampleCard,
		});

		expect(result).toEqual({ success: true });
	});

	it('gets the card that was set on the screen', async () => {
		const card = await $fetch(`/api/events/${eventId}/screens/${screenId}/card`);

		expect(card).toMatchObject({
			id: 'test-card-id',
			name: 'Lightning Bolt',
			set: 'lea',
			layout: 'normal',
		});
		expect(card.imageData.front).toMatchObject({ normal: 'https://example.com/front.jpg' });
		expect(card.imageData.back).toBeNull();
		expect(card.savedAt).toBeTypeOf('number');
	});

	it('overwrites an existing card', async () => {
		const newCard = {
			...sampleCard,
			id: 'new-card-id',
			name: 'Counterspell',
			set: 'lea',
		};

		await $fetch(`/api/events/${eventId}/screens/${screenId}/card`, {
			method: 'PUT',
			body: newCard,
		});

		const card = await $fetch(`/api/events/${eventId}/screens/${screenId}/card`);
		expect(card.name).toBe('Counterspell');
		expect(card.id).toBe('new-card-id');
	});

	it('clears the card from the screen', async () => {
		const result = await $fetch(`/api/events/${eventId}/screens/${screenId}/card`, {
			method: 'DELETE',
		});

		expect(result).toEqual({ success: true });

		const card = await $fetch(`/api/events/${eventId}/screens/${screenId}/card`);
		expect(card == null).toBe(true);
	});

	// ── Mode config endpoint ──────────────────────────────────────────

	it('updates feature-match mode config', async () => {
		const updated = await $fetch(`/api/events/${eventId}/screens/${screenId}/config/feature-match`, {
			method: 'PATCH',
			body: {
				showNames: true,
				showClock: false,
			},
		});

		expect(updated.id).toBe(screenId);
		expect(updated.modeConfigs).toBeDefined();
		expect(updated.modeConfigs['feature-match']).toMatchObject({
			showNames: true,
			showClock: false,
		});
	});

	it('updates card mode config', async () => {
		const updated = await $fetch(`/api/events/${eventId}/screens/${screenId}/config/card`, {
			method: 'PATCH',
			body: {
				scale: 1.5,
				animationEnabled: true,
			},
		});

		expect(updated.modeConfigs).toBeDefined();
		expect(updated.modeConfigs.card).toMatchObject({
			scale: 1.5,
			animationEnabled: true,
		});
	});

	it('merges mode config with existing values', async () => {
		// First set some values
		await $fetch(`/api/events/${eventId}/screens/${screenId}/config/card`, {
			method: 'PATCH',
			body: { scale: 2.0, animationEnabled: true },
		});

		// Update only one field — the other should be preserved
		const updated = await $fetch(`/api/events/${eventId}/screens/${screenId}/config/card`, {
			method: 'PATCH',
			body: { animationSpeed: 'fast' },
		});

		expect(updated.modeConfigs.card).toMatchObject({
			scale: 2.0,
			animationEnabled: true,
			animationSpeed: 'fast',
		});
	});

	it('persists the authored Broadcast Graphics stack as Screen-owned mode configuration', async () => {
		const graphics = [
			{
				id: 'lower-third',
				name: 'Lower Third',
				items: [
					{
						type: 'shape',
						id: 'bar',
						label: 'Shape 1',
						visible: true,
						anchor: 'top-left',
						x: 120,
						y: 820,
						width: 900,
						height: 120,
						geometry: { cornerRadius: 8 },
						surfaceStyle: { fill: '#0077a3', fillOpacity: 1 },
					},
					{
						type: 'text',
						id: 'name',
						label: 'Text 1',
						visible: true,
						anchor: 'left',
						x: 150,
						y: 840,
						width: 800,
						height: 80,
						text: 'Commentator',
						typography: {
							fontId: 'inter',
							fontSize: 64,
							fontWeight: 700,
							fontStyle: 'normal',
							textTransform: 'none',
							letterSpacing: 0,
							lineHeight: 1.15,
							textAlign: 'left',
							color: '#ffffff',
						},
						overflowPolicy: 'shrink',
						minFontSize: 32,
					},
				],
			},
		];

		const updated = await $fetch(`/api/events/${eventId}/screens/${screenId}/config/broadcast-graphics`, {
			method: 'PATCH',
			body: { graphics },
		});

		expect(updated.modeConfigs['broadcast-graphics']).toEqual({ graphics });

		const reloaded = await $fetch(`/api/events/${eventId}/screens/${screenId}`);
		expect(reloaded.modeConfigs['broadcast-graphics']).toEqual({ graphics });
	});

	it('rejects a Broadcast Graphic carrying an unsupported Graphic Item kind', async () => {
		await expect($fetch(`/api/events/${eventId}/screens/${screenId}/config/broadcast-graphics`, {
			method: 'PATCH',
			body: {
				graphics: [{
					id: 'invalid',
					name: 'Invalid',
					items: [{ type: 'media', id: 'logo', label: 'Media 1', visible: true, anchor: 'top-left', x: 0, y: 0, width: 10, height: 10 }],
				}],
			},
		})).rejects.toThrow();
	});

	// ── Screen config endpoint ────────────────────────────────────────

	it('updates screen config', async () => {
		const updated = await $fetch(`/api/events/${eventId}/screens/${screenId}/screen-config`, {
			method: 'PATCH',
			body: {
				background: '#000000',
				colorMode: 'dark',
			},
		});

		expect(updated.id).toBe(screenId);
		expect(updated.screenConfig).toMatchObject({
			background: '#000000',
			colorMode: 'dark',
		});
	});

	it('updates screen dimensions in screen config', async () => {
		const updated = await $fetch(`/api/events/${eventId}/screens/${screenId}/screen-config`, {
			method: 'PATCH',
			body: {
				width: 1920,
				height: 1080,
			},
		});

		expect(updated.screenConfig).toMatchObject({
			width: 1920,
			height: 1080,
		});
	});
});
