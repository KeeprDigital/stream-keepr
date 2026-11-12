import type { ScreenResponse } from '~~/shared/api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { $fetch } from './client';

/**
 * The mode-configuration byte total on the PATCH path (#85).
 *
 * The total is an object-level constraint on the whole mode configuration map,
 * which the patch schema once lost when it was rebuilt from `schema.shape`.
 * Crossing it needs two modes by construction, because a single PATCH body is
 * itself limited to the same 512 KiB: each write looks reasonable on its own and
 * the *accumulated* configuration is what exceeds the limit. The rule itself, on
 * both write paths, is held in `test/unit/server/schemas/modeConfigPatchResult.test.ts`.
 */

/**
 * How many maximal Graphic Items the accumulating stack carries.
 *
 * It has to be storable on its own — the second write is the one that must be
 * refused — while still leaving the pair over the total. That is three fifths of
 * `MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN`; the whole cap no longer fits
 * alone when every Graphic Item carries a maximal Graphic Text Template, which #99
 * accepted when it set the cap from what a show needs rather than from a byte
 * figure. A literal because the integration project shares no value imports with
 * the schema module, with the derivation held in that unit test, which can import
 * the cap and would fail if the two came apart.
 */
const STORABLE_STACK_ITEMS = 120;

/**
 * The most expensive Graphic Item the current vocabulary accepts: a maximal Graphic
 * Text Template, a four-stop gradient, an outline, a glow, and the four Graphic
 * Placeholder Styles a Text Graphic Item may define.
 */
function fatGraphicItem(id: string) {
	return {
		type: 'text' as const,
		id,
		label: 'L'.repeat(100),
		visible: true,
		anchor: 'bottom-right' as const,
		rotation: -359.99,
		x: -9999.5,
		y: -9999.5,
		width: 9999.5,
		height: 9999.5,
		text: 'T'.repeat(1000),
		typography: {
			font: { kind: 'application', fontId: 'inter' } as const,
			fontSize: 599.5,
			fontWeight: 900,
			fontStyle: 'italic' as const,
			textTransform: 'uppercase' as const,
			letterSpacing: -19.5,
			lineHeight: 1.15,
			textAlign: 'center' as const,
			color: '#0077a3',
		},
		overflowPolicy: 'shrink' as const,
		minFontSize: 24.5,
		surfaceStyle: {
			fill: {
				type: 'linear-gradient' as const,
				angle: -359.99,
				stops: Array.from({ length: 4 }, (_, index) => ({
					color: '#0077a3',
					position: index / 3,
					opacity: 0.85,
				})),
			},
			fillOpacity: 0.85,
			outline: { color: '#ffffff', width: 12.5 },
			glow: { color: '#00d9ff', size: 48.5, opacity: 0.75 },
		},
		placeholderStyles: Object.fromEntries(
			Array.from({ length: 4 }, (_, index) => [
				`placeholder${index}`,
				{
					font: { kind: 'application', fontId: 'inter' } as const,
					fontSize: 599.5,
					fontWeight: 900,
					fontStyle: 'italic' as const,
					textTransform: 'uppercase' as const,
					letterSpacing: -19.5,
					color: '#0077a3',
				},
			]),
		),
	};
}

/**
 * A Graphic Input declaration at its own maxima. Inputs carry the other large axis
 * of the whole-Screen budget, and are capped per Screen rather than per graphic.
 */
function fatGraphicInput(key: string) {
	return {
		key,
		label: 'L'.repeat(60),
		required: true,
		updatePolicy: 'staged' as const,
		type: 'text' as const,
		default: 'D'.repeat(1000),
		maxLength: 1000,
	};
}

/**
 * A Broadcast Graphics stack built to the current named caps rather than to a byte
 * figure, so it stays the pathological case as the vocabulary changes: the Graphic
 * Item axis and the whole-Screen Graphic Input budget are both filled to their limits.
 */
function fatGraphicsStack(totalItems: number, graphics: number, totalInputs = 0) {
	const perGraphic = Math.ceil(totalItems / graphics);
	const perGraphicInputs = Math.ceil(totalInputs / graphics);
	let items = 0;
	let inputs = 0;

	return Array.from({ length: graphics }, (_, g) => {
		const take = Math.max(0, Math.min(perGraphic, totalItems - items));
		const takeInputs = Math.max(0, Math.min(perGraphicInputs, totalInputs - inputs));
		items += take;
		inputs += takeInputs;

		return {
			id: `graphic-${g}`,
			name: 'N'.repeat(100),
			items: Array.from({ length: take }, (_, i) => fatGraphicItem(`item-${g}-${i}`)),
			...(takeInputs > 0
				? {
						inputs: Array.from({ length: takeInputs }, (_, i) => fatGraphicInput(`g${g}input${i}`)),
					}
				: {}),
		};
	});
}

/** One Text Graphic Item at its own field bounds: a 1,000-character template. */
function fatTextGraphicItem(id: string) {
	return {
		id,
		type: 'text' as const,
		label: 'L'.repeat(100),
		visible: true,
		anchor: 'top-left' as const,
		x: 0,
		y: 0,
		width: 100,
		height: 100,
		text: 'T'.repeat(1000),
		typography: {
			font: { kind: 'application', fontId: 'inter' } as const,
			fontSize: 32,
			fontWeight: 700,
			fontStyle: 'normal' as const,
			textTransform: 'none' as const,
			letterSpacing: 0,
			lineHeight: 1.15,
			textAlign: 'left' as const,
			color: '#ffffff',
		},
		overflowPolicy: 'ellipsis' as const,
		minFontSize: 16,
	};
}

/**
 * An oversized Feature Match Layout: a composition at its Graphic Item cap, each
 * item legal on its own and each carrying a 1,000-character Graphic Text Template
 * its own field bound allows, with one Graphic Group at its own child cap.
 */
function fatOverlayLayout() {
	const gradient = 'G'.repeat(1000);
	return {
		frame: { backgroundColor: '#000000', opacity: 1, gradient },
		sources: [
			{
				id: 'overlay-source',
				label: 'L'.repeat(100),
				visible: true,
				sourceRole: 'main' as const,
				frameCutout: true,
				x: 0,
				y: 0,
				width: 100,
				height: 100,
			},
		],
		composition: {
			id: 'feature-match-layout',
			name: 'Feature Match Layout',
			// 49 top-level items plus a Graphic Group of 50 children is 100 Graphic
			// Items counting the group itself, which is what a Feature Match Layout may
			// carry in total since #99 — its cap used to bound only the top-level list,
			// so this fixture used to hold 150. It is built to the cap deliberately: the
			// property under test is the byte total, and a fixture the *named* cap
			// refuses would report which limit it hit and never reach the byte one.
			items: [
				...Array.from({ length: 49 }, (_, index) => fatTextGraphicItem(`overlay-${index}`)),
				{
					id: 'overlay-group',
					type: 'group' as const,
					label: 'L'.repeat(100),
					visible: true,
					anchor: 'top-left' as const,
					x: 0,
					y: 0,
					width: 1920,
					height: 200,
					arrangement: 'canvas' as const,
					padding: 0,
					gap: 0,
					align: 'stretch' as const,
					justify: 'start' as const,
					clip: true,
					geometry: {
						topLeft: { treatment: 'square' as const, size: 0 },
						topRight: { treatment: 'square' as const, size: 0 },
						bottomRight: { treatment: 'square' as const, size: 0 },
						bottomLeft: { treatment: 'square' as const, size: 0 },
						leftSlant: 0,
						rightSlant: 0,
					},
					children: Array.from({ length: 50 }, (_, index) => fatTextGraphicItem(`overlay-child-${index}`)),
				},
			],
		},
	};
}

interface FetchFailure { data?: { statusCode?: number; message?: string } }

async function patchConfig(path: string, body: Record<string, unknown>) {
	return await $fetch(path, { method: 'PATCH', body }).then(
		result => ({ ok: true as const, result }),
		(error: FetchFailure) => ({ ok: false as const, error }),
	);
}

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
				currentMode: 'background',
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

	// The Card's rules are held in `test/unit/server/api/cardExpiry.sqlite.test.ts`;
	// this is one pass through its three routes on a real server.
	it('sets, reads and clears the Card on the screen, answering each Card revision', async () => {
		const saved = await $fetch(`/api/events/${eventId}/screens/${screenId}/card`, {
			method: 'PUT',
			body: sampleCard,
		});
		expect(saved).toEqual({ success: true, revision: 1 });

		const { card, revision } = await $fetch(`/api/events/${eventId}/screens/${screenId}/card`);

		expect(revision).toBe(1);

		expect(card).toMatchObject({
			id: 'test-card-id',
			name: 'Lightning Bolt',
			set: 'lea',
			layout: 'normal',
		});
		expect(card).toMatchObject({
			imageData: {
				front: { normal: 'https://example.com/front.jpg' },
				back: null,
			},
		});
		expect(card!.savedAt).toBeTypeOf('number');

		const cleared = await $fetch(`/api/events/${eventId}/screens/${screenId}/card`, {
			method: 'DELETE',
		});
		expect(cleared).toEqual({ success: true, revision: 2 });

		const read = await $fetch(`/api/events/${eventId}/screens/${screenId}/card`);
		expect(read).toEqual({ card: null, revision: 2 });
	});

	// ── Mode config endpoint ──────────────────────────────────────────

	it('merges mode config with existing values', async () => {
		// First set some values
		await $fetch(`/api/events/${eventId}/screens/${screenId}/config/deck`, {
			method: 'PATCH',
			body: { showDeckName: false, showQuantities: false },
		});

		// Update only one field — the other should be preserved
		const updated = await $fetch(`/api/events/${eventId}/screens/${screenId}/config/deck`, {
			method: 'PATCH',
			body: { showDeckName: true },
		});

		expect(updated!.modeConfigs!.deck).toMatchObject({
			showQuantities: false,
			showDeckName: true,
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
			font: { kind: 'application', fontId: 'inter' },
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

		expect(updated!.modeConfigs!['broadcast-graphics']).toEqual({ graphics });

		const reloaded = await $fetch(`/api/events/${eventId}/screens/${screenId}`);
		expect(reloaded!.modeConfigs!['broadcast-graphics']).toEqual({ graphics });
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
		// Over the whole-Screen cap without exceeding the per-graphic one. The cap's
		// own value is asserted as a literal because the integration project shares no
		// value imports with the schema module.
		const graphics = Array.from({ length: 16 }, (_, graphic) => ({
			id: `graphic-${graphic}`,
			name: `Graphic ${graphic}`,
			items: Array.from({ length: 20 }, (_, index) => item(`item-${graphic}-${index}`)),
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
			.toContain('A Broadcast Graphics Screen must not carry more than 300 Graphic Items in total');
	});

	// ── Mode configuration byte total ─────────────────────────────────

	it('refuses a mode configuration whose byte total is reached one PATCH at a time', async () => {
		// The hole #85 describes, stated as the operator would meet it: two writes,
		// each legal and each well under the body limit, accumulating past the total.
		const budgetScreen = await $fetch(`/api/events/${eventId}/screens`, {
			method: 'POST',
			body: { name: 'Budget Screen', slug: 'integration-budget-accumulated', currentMode: 'background' },
		});

		const first = await patchConfig(
			`/api/events/${eventId}/screens/${budgetScreen.id}/config/broadcast-graphics`,
			{
				graphics: fatGraphicsStack(STORABLE_STACK_ITEMS, 50, 60),
			},
		);
		expect(first.ok).toBe(true);

		const second = await patchConfig(
			`/api/events/${eventId}/screens/${budgetScreen.id}/config/feature-match-overlay`,
			{
				layout: fatOverlayLayout(),
			},
		);

		expect(second.ok).toBe(false);
		expect(second.ok === false && second.error.data?.statusCode).toBe(400);
		// The operator has to be able to read which limit they reached. #65 established
		// that a cap message never reaches the thrown error's own `message` — ofetch
		// summarises that as "400 Validation Error" — so this asserts the body.
		expect(second.ok === false && second.error.data?.message)
			.toContain('Mode configuration must not exceed');
	});

	// ── A Screen's look ───────────────────────────────────────────────

	// ADR-0051: a Screen holds no look of its own, nor a canvas; it takes its Event's Theme and Event Canvas.
	it('refuses a Screen a look or a canvas of its own', async () => {
		const screen = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens/${screenId}`);

		await expect($fetch(`/api/events/${eventId}/screens/${screenId}`, {
			method: 'PATCH',
			body: {
				stateVersion: screen.stateVersion,
				screenConfig: {
					background: '#000000',
					paddingX: 12,
					colorMode: 'dark',
					width: 1920,
					height: 1080,
				},
			},
		})).rejects.toMatchObject({ statusCode: 400 });
		expect(screen).not.toHaveProperty('screenConfig');
	});

	// ── Screen Theme Overrides ────────────────────────────────────────

	it('stores a Screen Theme Override on the Screen it names', async () => {
		const standings = await $fetch(`/api/events/${eventId}/screens`, {
			method: 'POST',
			body: { name: 'Overridden Screen', slug: 'integration-overridden-screen', currentMode: 'standings' },
		});

		const updated = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens/${standings.id}/theme-overrides`, {
			method: 'PATCH',
			body: {
				tokens: { 'standings.rise': '#ff0000' },
			},
		});

		expect(updated.themeOverrides).toEqual({ 'standings.rise': '#ff0000' });
	});
});
