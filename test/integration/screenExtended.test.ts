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
		const square = { treatment: 'square', size: 0 };
		const rectangle = {
			topLeft: square,
			topRight: square,
			bottomRight: square,
			bottomLeft: square,
			leftSlant: 0,
			rightSlant: 0,
		};
		const typography = {
			fontId: 'inter',
			fontSize: 64,
			fontWeight: 700,
			fontStyle: 'normal',
			textTransform: 'none',
			letterSpacing: 0,
			lineHeight: 1.15,
			textAlign: 'left',
			color: '#ffffff',
		};

		// The whole static vocabulary in one stack: per-corner geometry and an edge
		// slant, a gradient Graphic Fill with an outline and a glow, Graphic
		// Rotation, and a Graphic Group with a local style default its child overrides.
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
						rotation: -2,
						x: 120,
						y: 820,
						width: 900,
						height: 120,
						geometry: {
							...rectangle,
							topRight: { treatment: 'cut', size: 24 },
							bottomLeft: { treatment: 'rounded', size: 12 },
							rightSlant: 60,
						},
						surfaceStyle: {
							fill: {
								type: 'linear-gradient',
								angle: 90,
								stops: [
									{ color: '#080d12', position: 0, opacity: 0.97 },
									{ color: '#1c272d', position: 1, opacity: 0.9 },
								],
							},
							fillOpacity: 1,
							outline: { color: '#00d9ff', width: 3 },
							glow: { color: '#00d9ff', size: 24, opacity: 0.6 },
						},
					},
					{
						type: 'group',
						id: 'name-block',
						label: 'Group 1',
						visible: true,
						anchor: 'top-left',
						x: 150,
						y: 840,
						width: 800,
						height: 80,
						arrangement: 'row',
						padding: 8,
						gap: 12,
						align: 'stretch',
						justify: 'start',
						clip: true,
						geometry: rectangle,
						defaultChildSurfaceStyle: {
							fill: { type: 'solid', color: '#0077a3' },
							fillOpacity: 0.5,
						},
						children: [
							{
								type: 'shape',
								id: 'rule',
								label: 'Shape 2',
								visible: true,
								anchor: 'top-left',
								x: 0,
								y: 0,
								width: 4,
								height: 80,
								sizing: { mode: 'fixed', size: 4, weight: 1 },
								geometry: rectangle,
							},
							{
								type: 'text',
								id: 'name',
								label: 'Text 1',
								visible: true,
								anchor: 'left',
								x: 0,
								y: 0,
								width: 700,
								height: 80,
								sizing: { mode: 'fill', size: 0, weight: 1 },
								text: 'Commentator',
								typography,
								overflowPolicy: 'shrink',
								minFontSize: 32,
								surfaceStyle: {
									fill: { type: 'solid', color: '#ffffff' },
									fillOpacity: 0.08,
								},
							},
						],
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

	it('refuses a Broadcast Graphics stack over the whole-Screen Graphic Item cap', async () => {
		// The named cap is reached before the mode-configuration byte limit, so an
		// operator reads which limit they hit rather than an opaque byte count.
		const item = (id: string) => ({
			type: 'shape',
			id,
			label: id,
			visible: true,
			anchor: 'top-left',
			x: 0,
			y: 0,
			width: 10,
			height: 10,
			geometry: {
				topLeft: { treatment: 'square', size: 0 },
				topRight: { treatment: 'square', size: 0 },
				bottomRight: { treatment: 'square', size: 0 },
				bottomLeft: { treatment: 'square', size: 0 },
				leftSlant: 0,
				rightSlant: 0,
			},
		});
		const graphics = Array.from({ length: 6 }, (_, graphic) => ({
			id: `graphic-${graphic}`,
			name: `Graphic ${graphic}`,
			items: Array.from({ length: 40 }, (_, index) => item(`item-${graphic}-${index}`)),
		}));

		// Assert which limit fired, and that it reaches the operator. A bare rejection
		// would be satisfied by any 400, including the opaque byte-limit failure this
		// cap exists to prevent, and the named message travels in the response body
		// rather than in the thrown error's own message.
		const failure = await $fetch(`/api/events/${eventId}/screens/${screenId}/config/broadcast-graphics`, {
			method: 'PATCH',
			body: { graphics },
		}).then(() => null).catch((error: { data?: { statusCode?: number; message?: string } }) => error);

		expect(failure?.data?.statusCode).toBe(400);
		expect(failure?.data?.message)
			.toContain('A Broadcast Graphics Screen must not carry more than 110 Graphic Items in total');
	});

	it('round-trips declared Graphic Inputs and Graphic Placeholder Styles through the editor patch path', async () => {
		// The only path the editors write through, and the one an object-level
		// refinement would silently never reach.
		const typography = {
			fontId: 'inter',
			fontSize: 48,
			fontWeight: 700,
			fontStyle: 'normal',
			textTransform: 'none',
			letterSpacing: 0,
			lineHeight: 1.2,
			textAlign: 'left',
			color: '#ffffff',
		};
		const graphics = [{
			id: 'lower-third',
			name: 'Lower Third',
			inputs: [
				{ type: 'text', key: 'name', label: 'Name', required: true, updatePolicy: 'staged', default: 'Unnamed', maxLength: 40 },
				{ type: 'choice', key: 'side', label: 'Side', required: false, updatePolicy: 'live', default: 'left', options: [{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }] },
			],
			sources: [{ key: 'player', label: 'Player', kind: 'player' }],
			// A Graphic Input Binding names a field from the binding catalog, so this is a
			// catalog field id rather than an arbitrary property path.
			bindings: [{ inputKey: 'name', sourceKey: 'player', fieldId: 'player.name' }],
			items: [{
				type: 'text',
				id: 'name-line',
				label: 'Name line',
				visible: true,
				anchor: 'top-left',
				x: 0,
				y: 0,
				width: 600,
				height: 120,
				text: '{name} — {side}',
				typography,
				overflowPolicy: 'ellipsis',
				minFontSize: 24,
				placeholderStyles: { side: { fontWeight: 300, color: '#00d9ff' } },
			}],
		}];

		const updated = await $fetch(`/api/events/${eventId}/screens/${screenId}/config/broadcast-graphics`, {
			method: 'PATCH',
			body: { graphics },
		});

		expect(updated.modeConfigs['broadcast-graphics']).toEqual({ graphics });
	});

	it('refuses two Graphic Inputs sharing one key on the editor patch path', async () => {
		const input = { type: 'text', key: 'name', label: 'Name', required: false, updatePolicy: 'staged', default: '', maxLength: 40 };
		const graphics = [{ id: 'lower-third', name: 'Lower Third', items: [], inputs: [input, input] }];

		const failure = await $fetch(`/api/events/${eventId}/screens/${screenId}/config/broadcast-graphics`, {
			method: 'PATCH',
			body: { graphics },
		}).then(() => null).catch((error: { data?: { statusCode?: number; message?: string } }) => error);

		expect(failure?.data?.statusCode).toBe(400);
		expect(failure?.data?.message).toContain('Graphic Input keys must be unique within one Broadcast Graphic');
	});

	it('refuses to delete the authored Broadcast Graphics stack with a null patch', async () => {
		const graphics = [{ id: 'keep-me', name: 'Keep Me', items: [] }];
		await $fetch(`/api/events/${eventId}/screens/${screenId}/config/broadcast-graphics`, {
			method: 'PATCH',
			body: { graphics },
		});

		await expect($fetch(`/api/events/${eventId}/screens/${screenId}/config/broadcast-graphics`, {
			method: 'PATCH',
			body: { graphics: null },
		})).rejects.toThrow();

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
