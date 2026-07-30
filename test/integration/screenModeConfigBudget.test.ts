import { $fetch } from '@nuxt/test-utils/e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The mode-configuration byte total, on both write paths.
 *
 * `MAX_MODE_CONFIGS_BYTES` is an object-level constraint on the whole mode
 * configuration map, and it is the only object-level rule the Screen schemas
 * carry — which makes it the exact victim of #85: object-level refinements were
 * silently discarded when the patch schema was rebuilt from `schema.shape`, so
 * the total held on Screen create and full update and not on
 * `PATCH .../config/:mode`, the only path the editors write through.
 *
 * Crossing the total needs two modes by construction, because a single PATCH body
 * is itself limited to the same 512 KiB. That is also the realistic failure: each
 * write looks reasonable on its own and the *accumulated* configuration is what
 * exceeds the limit, so nothing an operator does looks like the mistake.
 *
 * The limit is written as a literal because the integration project shares no
 * value imports with the schema module.
 */
const MAX_MODE_CONFIGS_BYTES = 512 * 1024;

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
			fontId: 'inter' as const,
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
					fontId: 'inter' as const,
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
				? { inputs: Array.from({ length: takeInputs }, (_, i) => fatGraphicInput(`g${g}input${i}`)) }
				: {}),
		};
	});
}

/**
 * A ~129 KiB Feature Match Overlay layout: 100 items, each legal on its own, each
 * carrying a 1,000-character gradient its own field bound allows.
 */
function fatOverlayLayout() {
	const gradient = 'G'.repeat(1000);
	return {
		frame: { backgroundColor: '#000000', opacity: 1, gradient },
		items: Array.from({ length: 100 }, (_, index) => ({
			id: `overlay-${index}`,
			type: 'source' as const,
			label: 'L'.repeat(100),
			visible: true,
			sourceRole: 'main' as const,
			frameCutout: true,
			x: 0,
			y: 0,
			width: 100,
			height: 100,
			surfaceStyle: {
				backgroundColor: '#000000',
				backgroundOpacity: 0,
				backgroundGradient: gradient,
				borderVisible: true,
				borderTopVisible: true,
				borderRightVisible: true,
				borderBottomVisible: true,
				borderLeftVisible: true,
				borderColor: '#0077a3',
				borderWidth: 4,
				borderRadius: 8,
				borderRadiusTopLeft: 8,
				borderRadiusTopRight: 8,
				borderRadiusBottomRight: 8,
				borderRadiusBottomLeft: 8,
				padding: 12,
				textColor: '#ffffff',
				fontSize: 32,
			},
		})),
	};
}

function bytes(value: unknown): number {
	return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

interface FetchFailure { data?: { statusCode?: number; message?: string } }

async function patchConfig(path: string, body: unknown) {
	return await $fetch(path, { method: 'PATCH', body }).then(
		result => ({ ok: true as const, result }),
		(error: FetchFailure) => ({ ok: false as const, error }),
	);
}

describe('mode configuration byte total', () => {
	let eventId: number;

	beforeAll(async () => {
		const event = await $fetch('/api/events', {
			method: 'POST',
			body: { name: 'Integration Mode Config Budget', game: 'mtg', featureMatchOrientation: 'horizontal' },
		});
		eventId = event.id;
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	async function createScreen(slug: string) {
		const screen = await $fetch(`/api/events/${eventId}/screens`, {
			method: 'POST',
			body: { name: `Budget ${slug}`, slug, currentMode: 'idle' },
		});
		return screen.id as number;
	}

	it('refuses a Screen whose whole mode configuration exceeds the byte total, on create', async () => {
		// The full-config path has always enforced this. It is asserted here so the
		// PATCH-path test below is a statement about parity rather than about bytes.
		const modeConfigs = {
			'broadcast-graphics': { graphics: fatGraphicsStack(110, 50, 60) },
			'feature-match-overlay': { featureMatchId: null, presetId: 'full-table', layout: fatOverlayLayout() },
		};

		expect(bytes(modeConfigs)).toBeGreaterThan(MAX_MODE_CONFIGS_BYTES);

		const failure = await $fetch(`/api/events/${eventId}/screens`, {
			method: 'POST',
			body: { name: 'Oversized', slug: 'budget-oversized', currentMode: 'idle', modeConfigs },
		}).then(() => null).catch((error: FetchFailure) => error);

		expect(failure?.data?.statusCode).toBe(400);
		expect(failure?.data?.message).toContain('Mode configuration must not exceed');
	});

	it('refuses the same configuration reached one PATCH at a time', async () => {
		// The hole #85 describes, stated as the operator would meet it: two writes,
		// each legal and each well under the body limit, accumulating past the total.
		const screenId = await createScreen('budget-accumulated');

		const first = await patchConfig(
			`/api/events/${eventId}/screens/${screenId}/config/broadcast-graphics`,
			{ graphics: fatGraphicsStack(110, 50, 60) },
		);
		expect(first.ok).toBe(true);

		const second = await patchConfig(
			`/api/events/${eventId}/screens/${screenId}/config/feature-match-overlay`,
			{ layout: fatOverlayLayout() },
		);

		expect(second.ok).toBe(false);
		expect(second.ok === false && second.error.data?.statusCode).toBe(400);
		// The operator has to be able to read which limit they reached. #65 established
		// that a cap message never reaches the thrown error's own `message` — ofetch
		// summarises that as "400 Validation Error" — so this asserts the body.
		expect(second.ok === false && second.error.data?.message)
			.toContain('Mode configuration must not exceed');
	});

	it('still accepts a configuration that stays inside the total', async () => {
		// The fix must not make ordinary authoring harder: a realistic stack is a
		// fraction of the budget and has to keep writing through cleanly.
		const screenId = await createScreen('budget-realistic');

		const first = await patchConfig(
			`/api/events/${eventId}/screens/${screenId}/config/broadcast-graphics`,
			{ graphics: fatGraphicsStack(20, 5, 6) },
		);
		const second = await patchConfig(
			`/api/events/${eventId}/screens/${screenId}/config/metagame`,
			{ topN: 12 },
		);

		expect(first.ok).toBe(true);
		expect(second.ok).toBe(true);
	});
});
