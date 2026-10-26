import { describe, expect, it } from 'vitest';
import {
	broadcastGraphicsModeConfigSchema,
	MAX_BROADCAST_GRAPHICS_PER_SCREEN,
	MAX_GRAPHIC_CHANNELS_PER_SCREEN,
	MAX_GRAPHIC_GROUP_CHILDREN,
	MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHIC,
	MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHICS_SCREEN,
	MAX_GRAPHIC_ITEM_ID_LENGTH,
	MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHIC,
	MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN,
	MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN_WORST_CASE_BYTES,
	MAX_GRAPHIC_PLACEHOLDER_STYLES_PER_TEXT_ITEM,
	MAX_GRAPHIC_SOURCE_SELECTIONS_PER_BROADCAST_GRAPHIC,
	MAX_GRAPHIC_SOURCE_SELECTIONS_PER_BROADCAST_GRAPHICS_SCREEN,
	modeConfigsMapSchema,
} from '~~/server/schemas/api/screen';
import { graphicBindingFieldIds } from '~~/shared/modules/graphics';
import {
	MAX_GRAPHIC_INPUT_CHOICE_LENGTH,
	MAX_GRAPHIC_INPUT_CHOICE_OPTIONS,
	MAX_GRAPHIC_INPUT_KEY_LENGTH,
	MAX_GRAPHIC_INPUT_LABEL_LENGTH,
	MAX_GRAPHIC_TEXT_LENGTH,
} from '~~/shared/types/graphics';

// The Broadcast Graphics byte measurements ADR-0007 records, pinned with `toBe` so
// that a vocabulary or cap change moves a figure visibly rather than quietly. The
// worst case populates every construct `broadcastGraphicsModeConfigSchema` admits at
// its own maximum, with the one exception the ADR names: a Style Set link's unbounded
// `revision`, written as six digits. A construct the schema admits and this builder
// omits would make the figures look measured when they are not.

const MAX_MODE_CONFIGS_BYTES = 512 * 1024;
const WORST_CASE_FLAT_BYTES = 3_712_876;
const REALISTIC_SCREEN_AT_CAP_BYTES = 248_734;

const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

// ── the worst case every cap together admits ──

const CORNER = { treatment: 'rounded' as const, size: 9999.5 };
const GEOMETRY = {
	topLeft: CORNER,
	topRight: CORNER,
	bottomRight: CORNER,
	bottomLeft: CORNER,
	leftSlant: -9999.5,
	rightSlant: 9999.5,
};
const RECIPE = {
	duration: 9999.5,
	easing: 'ease-in-out' as const,
	delay: 9999.5,
	fade: { opacity: 0.85 },
	slide: { direction: 'north-east' as const, distanceMode: 'clear-parent' as const, distance: 9999.5 },
	scale: { factor: 1.95, origin: 'bottom-right' as const },
	reveal: { edge: 'bottom' as const },
};
const ON_SCREEN = { ...RECIPE, pause: 59999.5, repeat: 100 };
const ANIMATION = {
	'enter': RECIPE,
	'on-screen': ON_SCREEN,
	'update': RECIPE,
	'exit': RECIPE,
};
const SURFACE_STYLE = {
	fill: {
		type: 'linear-gradient' as const,
		angle: -359.99,
		stops: Array.from({ length: 4 }, (_, index) => ({ color: '#0077a3', position: index / 3, opacity: 0.85 })),
	},
	fillOpacity: 0.85,
	outline: { color: '#ffffff', width: 12.5 },
	glow: { color: '#00d9ff', size: 48.5, opacity: 0.75 },
};
// The library font arm at maximal identity lengths: 220 bytes dearer than an application font.
const FONT = {
	kind: 'asset' as const,
	reference: {
		assetId: 'a'.repeat(100),
		revisionId: 'r'.repeat(100),
	},
};
const RUN_STYLE = {
	font: FONT,
	fontSize: 599.5,
	fontWeight: 1000,
	fontStyle: 'italic' as const,
	textTransform: 'uppercase' as const,
	letterSpacing: -19.5,
};
const TYPOGRAPHY = {
	...RUN_STYLE,
	lineHeight: 1.15,
	textAlign: 'center' as const,
	color: '#0077a3',
};
const ENTRY = 'e'.repeat(100);

// Every style slot, each with its largest override; slots are not gated by item kind.
const ITEM_STYLE_REFS = {
	'typography': {
		entryId: ENTRY,
		overrides: { ...RUN_STYLE, lineHeight: 1.15, color: '#0077a3' },
	},
	'surfaceStyle': { entryId: ENTRY, overrides: SURFACE_STYLE },
	'surfaceStyle.fill': { entryId: ENTRY },
	'defaultChildSurfaceStyle': { entryId: ENTRY, overrides: SURFACE_STYLE },
	'boxSurfaceStyle': { entryId: ENTRY, overrides: SURFACE_STYLE },
	'wonBoxSurfaceStyle': { entryId: ENTRY, overrides: SURFACE_STYLE },
	'geometry': { entryId: ENTRY, overrides: GEOMETRY },
	'clipGeometry': { entryId: ENTRY, overrides: GEOMETRY },
	'boxGeometry': { entryId: ENTRY, overrides: GEOMETRY },
	'media': {
		entryId: ENTRY,
		overrides: {
			fit: 'cover' as const,
			focalPosition: { horizontal: 0.5, vertical: 0.5 },
			opacity: 0.85,
			clipGeometry: GEOMETRY,
			playbackRate: 3.75,
			loop: true,
		},
	},
	'animation.enter': { entryId: ENTRY, overrides: RECIPE },
	'animation.on-screen': { entryId: ENTRY, overrides: ON_SCREEN },
	'animation.update': { entryId: ENTRY, overrides: RECIPE },
	'animation.exit': { entryId: ENTRY, overrides: RECIPE },
};
const CONTAINER_STYLE_REFS = {
	'animation.enter': ITEM_STYLE_REFS['animation.enter'],
	'animation.on-screen': ITEM_STYLE_REFS['animation.on-screen'],
	'animation.update': ITEM_STYLE_REFS['animation.update'],
	'animation.exit': ITEM_STYLE_REFS['animation.exit'],
};
const LONGEST_FIELD_ID = graphicBindingFieldIds().reduce((longest, id) => (id.length > longest.length
	? id
	: longest), '');
const PARENT_SOURCE_KEY = 'p'.repeat(MAX_GRAPHIC_INPUT_KEY_LENGTH);
const BOX = {
	anchor: 'bottom-right' as const,
	rotation: -359.99,
	x: -9999.5,
	y: -9999.5,
	width: 9999.5,
	height: 9999.5,
};

function containerAnimation(itemIds: string[]) {
	const stagger = { order: 'reverse-list' as const, step: 9999.5, itemIds };
	return {
		...ANIMATION,
		stagger: {
			'enter': stagger,
			'on-screen': stagger,
			'update': stagger,
			'exit': stagger,
		},
	};
}

const itemId = (index: number) => `i${index}`.padEnd(MAX_GRAPHIC_ITEM_ID_LENGTH, 'i');

function item(id: string) {
	return {
		placeholderStyles: Object.fromEntries(Array.from(
			{ length: MAX_GRAPHIC_PLACEHOLDER_STYLES_PER_TEXT_ITEM },
			(_, index) => [
				`k${index}`.padEnd(MAX_GRAPHIC_INPUT_KEY_LENGTH, 'k'),
				{ ...RUN_STYLE, color: '#0077a3' },
			],
		)),
		type: 'text' as const,
		id,
		label: 'L'.repeat(100),
		visible: true,
		...BOX,
		text: 'T'.repeat(MAX_GRAPHIC_TEXT_LENGTH),
		typography: TYPOGRAPHY,
		overflowPolicy: 'shrink' as const,
		minFontSize: 599.5,
		surfaceStyle: SURFACE_STYLE,
		animation: ANIMATION,
		styleRefs: ITEM_STYLE_REFS,
	};
}

function group(id: string, childIds: string[]) {
	return {
		type: 'group' as const,
		id,
		label: 'L'.repeat(100),
		visible: true,
		...BOX,
		arrangement: 'column' as const,
		padding: 9999.5,
		gap: 9999.5,
		align: 'stretch' as const,
		justify: 'space-between' as const,
		clip: true,
		geometry: GEOMETRY,
		surfaceStyle: SURFACE_STYLE,
		defaultChildSurfaceStyle: SURFACE_STYLE,
		animation: containerAnimation(childIds),
		styleRefs: ITEM_STYLE_REFS,
		children: childIds.map(childId => ({
			...item(childId),
			sizing: { mode: 'fixed' as const, size: 9999.5, weight: 99.5 },
		})),
	};
}

/** The Graphic Item budget as top-level items, or in the fewest Graphic Groups that hold it. */
function items(total: number, arrangement: 'flat' | 'grouped') {
	if (arrangement === 'flat')
		return Array.from({ length: total }, (_, index) => item(itemId(index)));

	const groupCount = Math.ceil(total / (MAX_GRAPHIC_GROUP_CHILDREN + 1));
	const result: Array<ReturnType<typeof item> | ReturnType<typeof group>> = [];
	let placed = 0;
	for (let index = 0; index < groupCount; index += 1) {
		const share = Math.floor((total - placed) / (groupCount - index)) - 1;
		result.push(group(itemId(placed), Array.from({ length: share }, (_, child) => itemId(placed + 1 + child))));
		placed += share + 1;
	}
	expect(placed).toBe(total);
	return result;
}

function worstCaseScreen(arrangement: 'flat' | 'grouped') {
	const channels = Array.from({ length: MAX_GRAPHIC_CHANNELS_PER_SCREEN }, (_, index) => ({
		id: `${'c'.repeat(98)}${String(index).padStart(2, '0')}`,
		name: 'N'.repeat(100),
		handoff: 'out-then-in' as const,
	}));
	const graphics = Array.from({ length: MAX_BROADCAST_GRAPHICS_PER_SCREEN }, (_, index) => ({
		id: `g${index}`.padEnd(MAX_GRAPHIC_ITEM_ID_LENGTH, 'g'),
		name: 'N'.repeat(100),
		items: [] as ReturnType<typeof items>,
		inputs: [] as unknown[],
		bindings: [] as unknown[],
		sources: [] as unknown[],
		animation: undefined as ReturnType<typeof containerAnimation> | undefined,
		styleSet: {
			styleSetId: 's'.repeat(100),
			revision: 999999,
		},
		styleRefs: CONTAINER_STYLE_REFS,
		channelId: channels[index % channels.length]!.id,
	}));

	function fill<T>(values: T[], perGraphic: number, add: (graphic: typeof graphics[number], value: T) => void) {
		let index = 0;
		for (const graphic of graphics) {
			for (let taken = 0; taken < perGraphic && index < values.length; taken += 1, index += 1)
				add(graphic, values[index]!);
		}
		expect(index).toBe(values.length);
	}
	const indices = (count: number) => Array.from({ length: count }, (_, index) => index);

	fill(items(MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN, arrangement), MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHIC, (graphic, value) => graphic.items.push(value));
	fill(indices(MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHICS_SCREEN), MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHIC, (graphic, index) => {
		const key = `k${index}`.padEnd(MAX_GRAPHIC_INPUT_KEY_LENGTH, 'k');
		graphic.inputs.push({
			type: 'choice',
			key,
			label: 'L'.repeat(MAX_GRAPHIC_INPUT_LABEL_LENGTH),
			required: true,
			updatePolicy: 'staged',
			default: 'd'.repeat(MAX_GRAPHIC_INPUT_CHOICE_LENGTH),
			options: Array.from({ length: MAX_GRAPHIC_INPUT_CHOICE_OPTIONS }, () => ({
				value: 'v'.repeat(MAX_GRAPHIC_INPUT_CHOICE_LENGTH),
				label: 'L'.repeat(MAX_GRAPHIC_INPUT_CHOICE_LENGTH),
			})),
		});
		graphic.bindings.push({ inputKey: key, sourceKey: PARENT_SOURCE_KEY, fieldId: LONGEST_FIELD_ID });
	});
	// The first selection is the Feature Match Slot; the dearer derived ones follow it.
	fill(indices(MAX_GRAPHIC_SOURCE_SELECTIONS_PER_BROADCAST_GRAPHICS_SCREEN), MAX_GRAPHIC_SOURCE_SELECTIONS_PER_BROADCAST_GRAPHIC, (graphic, index) => {
		const label = 'L'.repeat(MAX_GRAPHIC_INPUT_LABEL_LENGTH);
		graphic.sources.push(graphic.sources.length > 0
			? {
					key: `s${index}`.padEnd(MAX_GRAPHIC_INPUT_KEY_LENGTH, 's'),
					label,
					kind: 'player',
					from: { sourceKey: PARENT_SOURCE_KEY, relation: 'player1' },
				}
			: { key: PARENT_SOURCE_KEY, label, kind: 'feature-match-slot' });
	});
	for (const graphic of graphics)
		graphic.animation = containerAnimation(graphic.items.map(value => value.id));

	return { graphics, channels };
}

function countGraphicItems(config: ReturnType<typeof worstCaseScreen>) {
	return config.graphics.reduce((total, graphic) => total + graphic.items.reduce(
		(count, value) => count + 1 + ('children' in value
			? value.children.length
			: 0),
		0,
	), 0);
}

// ── a realistic Screen at the cap: ADR-0007's richest reconstructed graphic ──

const REALISTIC_ITEMS_PER_GRAPHIC = 6;
const REALISTIC_INPUTS_PER_GRAPHIC = 2;

const realisticId = (graphic: number, index: number) => `3f2a9c1e-7b4d-4e2a-9f10-${String(graphic).padStart(6, '0')}${String(index).padStart(6, '0')}`;

function realisticText(id: string) {
	return {
		type: 'text' as const,
		id,
		label: 'Commentator name',
		visible: true,
		anchor: 'top-left' as const,
		x: 120,
		y: 880,
		width: 640,
		height: 72,
		text: '{name}',
		typography: {
			font: { kind: 'application' as const, fontId: 'inter' as const },
			fontSize: 48,
			fontWeight: 700,
			fontStyle: 'normal' as const,
			textTransform: 'uppercase' as const,
			letterSpacing: 0.5,
			lineHeight: 1.15,
			textAlign: 'left' as const,
			color: '#ffffff',
		},
		overflowPolicy: 'shrink' as const,
		minFontSize: 24,
		animation: {
			enter: {
				duration: 400,
				easing: 'ease-out' as const,
				delay: 120,
				fade: { opacity: 0 },
				slide: { direction: 'west' as const, distanceMode: 'fixed' as const, distance: 60 },
			},
			exit: {
				duration: 300,
				easing: 'ease-in' as const,
				delay: 0,
				fade: { opacity: 0 },
			},
		},
	};
}

function realisticShape(id: string) {
	const square = { treatment: 'square' as const, size: 0 };
	const reveal = { edge: 'left' as const };
	return {
		type: 'shape' as const,
		id,
		label: 'Bed',
		visible: true,
		anchor: 'top-left' as const,
		x: 100,
		y: 860,
		width: 900,
		height: 120,
		geometry: {
			topLeft: square,
			topRight: { treatment: 'cut' as const, size: 24 },
			bottomRight: square,
			bottomLeft: square,
			leftSlant: 0,
			rightSlant: 18,
		},
		surfaceStyle: {
			fill: {
				type: 'linear-gradient' as const,
				angle: 90,
				stops: [
					{ color: '#0b1e2d', position: 0, opacity: 1 },
					{ color: '#123c5a', position: 1, opacity: 1 },
				],
			},
			fillOpacity: 1,
		},
		animation: {
			enter: {
				duration: 500,
				easing: 'ease-out' as const,
				delay: 0,
				reveal,
			},
			exit: {
				duration: 400,
				easing: 'ease-in' as const,
				delay: 0,
				reveal,
			},
		},
	};
}

function realisticStack(totalItems: number) {
	let remaining = totalItems;
	// A Screen declares 60 Graphic Inputs, so only the first thirty graphics carry Live Control.
	let remainingInputs = MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHICS_SCREEN;
	const textInput = (key: string, label: string, required: boolean) => ({
		type: 'text' as const,
		key,
		label,
		required,
		updatePolicy: 'staged' as const,
		default: '',
		maxLength: 60,
	});

	return Array.from({
		length: Math.ceil(totalItems / REALISTIC_ITEMS_PER_GRAPHIC),
	}, (_, index) => {
		const take = Math.min(REALISTIC_ITEMS_PER_GRAPHIC, remaining);
		remaining -= take;
		const graphicItems = Array.from({ length: take }, (_, position) => (position % 3 === 0
			? realisticText(realisticId(index, position))
			: realisticShape(realisticId(index, position))));
		const withInputs = remainingInputs >= REALISTIC_INPUTS_PER_GRAPHIC;
		if (withInputs)
			remainingInputs -= REALISTIC_INPUTS_PER_GRAPHIC;

		return {
			id: realisticId(index, 999),
			name: `Lower third ${index}`,
			items: graphicItems,
			...(withInputs
				? {
						inputs: [
							textInput('name', 'Name', true),
							textInput('role', 'Role', false),
						],
						sources: [
							{ key: 'player', label: 'Player', kind: 'player' as const },
						],
						bindings: [
							{ inputKey: 'name', sourceKey: 'player', fieldId: 'player.name' },
						],
					}
				: {}),
			animation: {
				enter: {
					duration: 500,
					easing: 'ease-out' as const,
					delay: 0,
					fade: { opacity: 0 },
				},
				exit: {
					duration: 400,
					easing: 'ease-in' as const,
					delay: 0,
					fade: { opacity: 0 },
				},
				stagger: {
					enter: {
						order: 'list' as const,
						step: 80,
						itemIds: graphicItems.map(value => value.id),
					},
				},
			},
		};
	});
}

describe('broadcast Graphics byte measurements (ADR-0007)', () => {
	it('measures the worst Screen every cap together admits, which the shared budget refuses', () => {
		const config = worstCaseScreen('grouped');

		expect(broadcastGraphicsModeConfigSchema.safeParse(config).success).toBe(true);
		expect(countGraphicItems(config)).toBe(MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN);
		expect(jsonBytes(config)).toBe(MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN_WORST_CASE_BYTES);
		expect(modeConfigsMapSchema.safeParse({ 'broadcast-graphics': config }).success).toBe(false);
	});

	it('measures less with the same budget laid out flat, so the grouped worst case is the dearer', () => {
		const flat = worstCaseScreen('flat');

		expect(broadcastGraphicsModeConfigSchema.safeParse(flat).success).toBe(true);
		expect(countGraphicItems(flat)).toBe(MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN);
		expect(jsonBytes(flat)).toBe(WORST_CASE_FLAT_BYTES);
		expect(jsonBytes(flat)).toBeLessThan(jsonBytes(worstCaseScreen('grouped')));
		expect(jsonBytes(flat)).toBeGreaterThan(MAX_MODE_CONFIGS_BYTES);
	});

	it('measures a realistic Screen at the Graphic Item cap, under half the shared budget', () => {
		// If the ratio stops holding, re-derive the cap rather than relax this.
		const config = {
			graphics: realisticStack(MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN),
		};

		expect(broadcastGraphicsModeConfigSchema.safeParse(config).success).toBe(true);
		expect(jsonBytes(config)).toBe(REALISTIC_SCREEN_AT_CAP_BYTES);
		expect(jsonBytes(config) / MAX_MODE_CONFIGS_BYTES).toBeLessThan(0.5);
	});
});
