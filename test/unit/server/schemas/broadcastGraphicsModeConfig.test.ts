import { describe, expect, it } from 'vitest';
import {
	broadcastGraphicsModeConfigSchema,
	MAX_BROADCAST_GRAPHICS_PER_SCREEN,
	MAX_GRAPHIC_GROUP_CHILDREN,
	MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHIC,
	MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN,
	modeConfigPatchSchemaMap,
	modeConfigsMapSchema,
} from '~~/server/schemas/api/screen';
import { MAX_GRAPHIC_TEXT_LENGTH } from '~~/shared/types/graphics';
import { getDefaultConfigForMode } from '~~/shared/types/screenConfig';

const SQUARE = { treatment: 'square' as const, size: 0 };
const GEOMETRY = {
	topLeft: SQUARE,
	topRight: SQUARE,
	bottomRight: SQUARE,
	bottomLeft: SQUARE,
	leftSlant: 0,
	rightSlant: 0,
};

function shapeItem(id: string, overrides: Record<string, unknown> = {}) {
	return {
		type: 'shape' as const,
		id,
		label: id,
		visible: true,
		anchor: 'top-left' as const,
		x: 0,
		y: 0,
		width: 10,
		height: 10,
		geometry: GEOMETRY,
		surfaceStyle: { fill: { type: 'solid', color: '#ffffff' }, fillOpacity: 1 },
		...overrides,
	};
}

function graphic(id: string, itemCount = 0) {
	return {
		id,
		name: id,
		items: Array.from({ length: itemCount }, (_, index) => shapeItem(`${id}-${index}`)),
	};
}

const WORST_CORNER = { treatment: 'rounded' as const, size: 9999.5 };
const WORST_GEOMETRY = {
	topLeft: WORST_CORNER,
	topRight: WORST_CORNER,
	bottomRight: WORST_CORNER,
	bottomLeft: WORST_CORNER,
	leftSlant: -9999.5,
	rightSlant: 9999.5,
};
const WORST_SURFACE_STYLE = {
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
};

/** The most expensive Graphic Item the schema accepts, used for the byte budget. */
function worstCaseItem(id: string) {
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
		text: 'T'.repeat(MAX_GRAPHIC_TEXT_LENGTH),
		sizing: { mode: 'fill' as const, size: 9999.5, weight: 99.5 },
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
		surfaceStyle: WORST_SURFACE_STYLE,
	};
}

function messages(result: { error?: { issues: Array<{ message: string }> } }) {
	return result.error?.issues.map(issue => issue.message) ?? [];
}

describe('broadcastGraphicsModeConfigSchema', () => {
	it('names the Broadcast Graphics cap rather than reporting a byte count', () => {
		const graphics = Array.from(
			{ length: MAX_BROADCAST_GRAPHICS_PER_SCREEN + 1 },
			(_, index) => graphic(`graphic-${index}`),
		);

		const result = broadcastGraphicsModeConfigSchema.safeParse({ graphics });

		expect(result.success).toBe(false);
		expect(messages(result)).toEqual([
			`A Broadcast Graphics Screen must not carry more than ${MAX_BROADCAST_GRAPHICS_PER_SCREEN} Broadcast Graphics`,
		]);
	});

	it('names the Graphic Item cap rather than reporting a byte count', () => {
		const result = broadcastGraphicsModeConfigSchema.safeParse({
			graphics: [graphic('lower-third', MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHIC + 1)],
		});

		expect(result.success).toBe(false);
		expect(messages(result)).toEqual([
			`A Broadcast Graphic must not contain more than ${MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHIC} Graphic Items`,
		]);
	});

	it('names the whole-Screen Graphic Item cap rather than reporting a byte count', () => {
		// Under the per-graphic and per-Screen caps, but over their product's budget.
		const perGraphic = 40;
		const graphics = Array.from(
			{ length: Math.ceil((MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN + 1) / perGraphic) },
			(_, index) => graphic(`graphic-${index}`, perGraphic),
		);

		const result = broadcastGraphicsModeConfigSchema.safeParse({ graphics });

		expect(result.success).toBe(false);
		expect(messages(result)).toEqual([
			`A Broadcast Graphics Screen must not carry more than ${MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN} Graphic Items in total`,
		]);
	});

	it('counts Graphic Group children against the whole-Screen Graphic Item cap', () => {
		const groupOf = (id: string, children: number) => ({
			id,
			name: id,
			items: [{
				type: 'group' as const,
				id: `${id}-group`,
				label: 'Block',
				visible: true,
				anchor: 'top-left' as const,
				x: 0,
				y: 0,
				width: 100,
				height: 100,
				arrangement: 'row' as const,
				padding: 0,
				gap: 0,
				align: 'stretch' as const,
				justify: 'start' as const,
				clip: false,
				geometry: GEOMETRY,
				children: Array.from({ length: children }, (_, index) => shapeItem(`${id}-child-${index}`)),
			}],
		});

		const withinCap = Array.from({ length: 3 }, (_, index) => groupOf(`g${index}`, MAX_GRAPHIC_GROUP_CHILDREN));
		const overCap = Array.from({ length: 5 }, (_, index) => groupOf(`g${index}`, MAX_GRAPHIC_GROUP_CHILDREN));

		expect(broadcastGraphicsModeConfigSchema.safeParse({ graphics: withinCap }).success).toBe(true);
		expect(broadcastGraphicsModeConfigSchema.safeParse({ graphics: overCap }).success).toBe(false);
	});

	it('accepts a stack at the whole-Screen Graphic Item cap', () => {
		const graphics = Array.from(
			{ length: MAX_BROADCAST_GRAPHICS_PER_SCREEN },
			(_, index) => graphic(`graphic-${index}`, index === 0 ? MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHIC : 2),
		);

		expect(broadcastGraphicsModeConfigSchema.safeParse({ graphics }).success).toBe(true);
	});

	it('keeps a worst-case authored Screen inside the mode-configuration byte limit', () => {
		// The named Graphic Item cap has to bind before the byte limit, or an
		// operator reads an opaque byte count instead of the limit they reached. The
		// most expensive Graphic Item the schema accepts is a Graphic Group child, so
		// this fills the cap with those.
		const perGroup = 4;
		const graphics = Array.from(
			{ length: MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN / (perGroup + 1) },
			(_, index) => ({
				id: `graphic-${index}`,
				name: 'N'.repeat(100),
				items: [{
					type: 'group' as const,
					id: `group-${index}`,
					label: 'L'.repeat(100),
					visible: true,
					anchor: 'bottom-right' as const,
					rotation: -359.99,
					x: -9999.5,
					y: -9999.5,
					width: 9999.5,
					height: 9999.5,
					arrangement: 'column' as const,
					padding: 9999.5,
					gap: 9999.5,
					align: 'stretch' as const,
					justify: 'space-between' as const,
					clip: true,
					geometry: WORST_GEOMETRY,
					surfaceStyle: WORST_SURFACE_STYLE,
					defaultChildSurfaceStyle: WORST_SURFACE_STYLE,
					children: Array.from({ length: perGroup }, (_, item) => worstCaseItem(`item-${index}-${item}`)),
				}],
			}),
		);

		const config = { graphics };
		const bytes = new TextEncoder().encode(JSON.stringify(config)).byteLength;

		expect(broadcastGraphicsModeConfigSchema.safeParse(config).success).toBe(true);
		expect(modeConfigsMapSchema.safeParse({ 'broadcast-graphics': config }).success).toBe(true);
		// The figure the cap is justified by, so the schema's own arithmetic is checked.
		expect(bytes).toBeLessThan(410 * 1024);
	});

	it('applies the whole-Screen Graphic Item cap on the patch path the editor writes through', () => {
		// The patch schema rebuilds each mode from its field schemas, so a cap that
		// lived on the mode-config object would never reach a real write.
		const perGraphic = 40;
		const graphics = Array.from(
			{ length: Math.ceil((MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN + 1) / perGraphic) },
			(_, index) => graphic(`graphic-${index}`, perGraphic),
		);

		const result = modeConfigPatchSchemaMap['broadcast-graphics'].safeParse({ graphics });

		expect(result.success).toBe(false);
		expect(messages(result)).toEqual([
			`A Broadcast Graphics Screen must not carry more than ${MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN} Graphic Items in total`,
		]);
	});

	it('rejects a null Broadcast Graphics stack, so a patch can never delete the authored stack', () => {
		// `stripNullConfigKeys` treats null as "delete this key", which would drop
		// the stack and silently fall back to the empty default. The patch schema
		// only makes optional or nullable fields nullable, and `graphics` is
		// required — this pins that, because widening the field would open the hole.
		const result = modeConfigPatchSchemaMap['broadcast-graphics'].safeParse({ graphics: null });

		expect(result.success).toBe(false);
	});

	it('accepts a patch that replaces the whole stack, and one that omits it', () => {
		const patch = modeConfigPatchSchemaMap['broadcast-graphics'];

		expect(patch.safeParse({ graphics: [graphic('bug', 1)] }).success).toBe(true);
		expect(patch.safeParse({}).success).toBe(true);
	});

	it('accepts the Broadcast Graphics config a new Screen ships with', () => {
		// The shipped default has to satisfy the wire schema, or a Screen switched
		// into Broadcast Graphics could not persist its own starting configuration.
		const result = broadcastGraphicsModeConfigSchema.safeParse(
			getDefaultConfigForMode('broadcast-graphics'),
		);

		expect(result.success).toBe(true);
		expect(result.data?.graphics).toEqual([]);
	});

	it('rejects an unknown Graphic Item kind', () => {
		const result = broadcastGraphicsModeConfigSchema.safeParse({
			graphics: [{
				id: 'a',
				name: 'A',
				items: [{ type: 'media', id: 'logo', label: 'Media 1', visible: true, anchor: 'top-left', x: 0, y: 0, width: 10, height: 10 }],
			}],
		});

		expect(result.success).toBe(false);
	});

	it('rejects a Graphic Group inside a Graphic Group', () => {
		const child = {
			type: 'group' as const,
			id: 'inner',
			label: 'Inner',
			visible: true,
			anchor: 'top-left' as const,
			x: 0,
			y: 0,
			width: 10,
			height: 10,
			arrangement: 'row' as const,
			padding: 0,
			gap: 0,
			align: 'stretch' as const,
			justify: 'start' as const,
			clip: false,
			geometry: GEOMETRY,
			children: [],
		};

		const result = broadcastGraphicsModeConfigSchema.safeParse({
			graphics: [{
				id: 'a',
				name: 'A',
				items: [{ ...child, id: 'outer', children: [child] }],
			}],
		});

		expect(result.success).toBe(false);
	});

	it('bounds a linear-gradient Graphic Fill to two to four colour stops', () => {
		const withStops = (count: number) => broadcastGraphicsModeConfigSchema.safeParse({
			graphics: [{
				id: 'a',
				name: 'A',
				items: [shapeItem('bed', {
					surfaceStyle: {
						fill: {
							type: 'linear-gradient',
							angle: 90,
							stops: Array.from({ length: count }, (_, index) => ({
								color: '#ffffff',
								position: index / Math.max(1, count - 1),
								opacity: 1,
							})),
						},
						fillOpacity: 1,
					},
				})],
			}],
		}).success;

		expect(withStops(1)).toBe(false);
		expect(withStops(2)).toBe(true);
		expect(withStops(4)).toBe(true);
		expect(withStops(5)).toBe(false);
	});

	it('accepts an item with no Graphic Surface Style of its own', () => {
		const result = broadcastGraphicsModeConfigSchema.safeParse({
			graphics: [{
				id: 'a',
				name: 'A',
				items: [shapeItem('bare', { surfaceStyle: undefined })],
			}],
		});

		expect(result.success).toBe(true);
	});

	it('bounds a Text Graphic Item to the shared text length, and no further', () => {
		const withText = (length: number) => broadcastGraphicsModeConfigSchema.safeParse({
			graphics: [{
				id: 'a',
				name: 'A',
				items: [{
					type: 'text',
					id: 'name',
					label: 'Text 1',
					visible: true,
					anchor: 'top-left',
					x: 0,
					y: 0,
					width: 10,
					height: 10,
					text: 'T'.repeat(length),
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
					overflowPolicy: 'ellipsis',
					minFontSize: 24,
				}],
			}],
		}).success;

		expect(MAX_GRAPHIC_TEXT_LENGTH).toBe(1000);
		expect(withText(MAX_GRAPHIC_TEXT_LENGTH)).toBe(true);
		expect(withText(MAX_GRAPHIC_TEXT_LENGTH + 1)).toBe(false);
	});

	it('rejects duplicate Graphic Item ids, at either level of one Broadcast Graphic', () => {
		// Every authoring operation addresses an item by id alone and resolves it
		// against the top-level list and each group's children, so a duplicate would
		// edit, move, or delete the wrong item.
		const group = (children: ReturnType<typeof shapeItem>[]) => ({
			type: 'group' as const,
			id: 'cluster',
			label: 'Block',
			visible: true,
			anchor: 'top-left' as const,
			x: 0,
			y: 0,
			width: 100,
			height: 100,
			arrangement: 'row' as const,
			padding: 0,
			gap: 0,
			align: 'stretch' as const,
			justify: 'start' as const,
			clip: false,
			geometry: GEOMETRY,
			children,
		});
		const parse = (items: unknown[]) => broadcastGraphicsModeConfigSchema.safeParse({
			graphics: [{ id: 'a', name: 'A', items }],
		});

		expect(parse([shapeItem('bar'), shapeItem('bar')]).success).toBe(false);
		expect(parse([shapeItem('bar'), group([shapeItem('bar')])]).success).toBe(false);
		expect(parse([group([shapeItem('one'), shapeItem('one')])]).success).toBe(false);
		expect(parse([shapeItem('bar'), group([shapeItem('one')])]).success).toBe(true);
		// Two Broadcast Graphics may each hold an item of the same id.
		expect(broadcastGraphicsModeConfigSchema.safeParse({
			graphics: [
				{ id: 'a', name: 'A', items: [shapeItem('bar')] },
				{ id: 'b', name: 'B', items: [shapeItem('bar')] },
			],
		}).success).toBe(true);
	});

	it('rejects main-axis sizing on a top-level Graphic Item, which no group sizes', () => {
		const result = broadcastGraphicsModeConfigSchema.safeParse({
			graphics: [{
				id: 'a',
				name: 'A',
				items: [shapeItem('bar', { sizing: { mode: 'fill', size: 0, weight: 1 } })],
			}],
		});

		expect(result.success).toBe(false);
	});
});
