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
import {
	GRAPHIC_ANIMATION_EASING_VALUES,
	GRAPHIC_SLIDE_DIRECTION_VALUES,
	MAX_GRAPHIC_ANIMATION_DELAY_MS,
	MAX_GRAPHIC_ANIMATION_DURATION_MS,
	MAX_GRAPHIC_ANIMATION_SCALE,
	MAX_GRAPHIC_ANIMATION_STAGGER_STEP_MS,
	MAX_GRAPHIC_TEXT_LENGTH,
	MIN_GRAPHIC_ANIMATION_DURATION_MS,
} from '~~/shared/types/graphics';
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
/** The most expensive Graphic Animation Recipe the schema accepts. */
const WORST_RECIPE = {
	duration: 9999.5,
	easing: 'ease-in-out' as const,
	delay: 9999.5,
	fade: { opacity: 0.85 },
	slide: { direction: 'north-east' as const, distanceMode: 'clear-parent' as const, distance: 9999.5 },
	scale: { factor: 1.95, origin: 'bottom-right' as const },
	reveal: { edge: 'bottom' as const },
};

/** Every lifecycle phase animated, which is the most an owner may carry. */
const WORST_ANIMATION = {
	'enter': WORST_RECIPE,
	'on-screen': { ...WORST_RECIPE, pause: 59999.5, repeat: 100 },
	'update': WORST_RECIPE,
	'exit': WORST_RECIPE,
};

/** A container's stagger, naming every direct item it could name. */
function worstStagger(itemIds: string[]) {
	return { order: 'reverse-list' as const, step: 9999.5, itemIds };
}

function worstContainerAnimation(itemIds: string[]) {
	return {
		...WORST_ANIMATION,
		stagger: {
			'enter': worstStagger(itemIds),
			'on-screen': worstStagger(itemIds),
			'update': worstStagger(itemIds),
			'exit': worstStagger(itemIds),
		},
	};
}

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
		animation: WORST_ANIMATION,
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
		// One Broadcast Graphic may fill the whole Screen's Graphic Item budget, so
		// these two caps coincide and overrunning the per-graphic one reports both.
		// Either way the operator reads a named limit rather than a byte count.
		expect(messages(result)).toContain(
			`A Broadcast Graphic must not contain more than ${MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHIC} Graphic Items`,
		);
		expect(messages(result).every(message => !message.includes('bytes'))).toBe(true);
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

		// A full Graphic Group is 51 Graphic Items: the group and its children.
		const withinCap = [groupOf('g0', MAX_GRAPHIC_GROUP_CHILDREN)];
		const overCap = Array.from({ length: 2 }, (_, index) => groupOf(`g${index}`, MAX_GRAPHIC_GROUP_CHILDREN));

		expect(broadcastGraphicsModeConfigSchema.safeParse({ graphics: withinCap }).success).toBe(true);
		expect(broadcastGraphicsModeConfigSchema.safeParse({ graphics: overCap }).success).toBe(false);
	});

	it('accepts a stack at the whole-Screen Graphic Item cap', () => {
		const perGraphic = MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN / MAX_BROADCAST_GRAPHICS_PER_SCREEN;
		const graphics = Array.from(
			{ length: MAX_BROADCAST_GRAPHICS_PER_SCREEN },
			(_, index) => graphic(`graphic-${index}`, perGraphic),
		);

		expect(broadcastGraphicsModeConfigSchema.safeParse({ graphics }).success).toBe(true);
	});

	it('accepts one Broadcast Graphic filled to the per-graphic Graphic Item cap', () => {
		const graphics = [graphic('lower-third', MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHIC)];

		expect(broadcastGraphicsModeConfigSchema.safeParse({ graphics }).success).toBe(true);
	});

	it('keeps a worst-case authored Screen inside the mode-configuration byte limit', () => {
		// The named Graphic Item cap has to bind before the byte limit, or an
		// operator reads an opaque byte count instead of the limit they reached.
		//
		// The worst case spends its Graphic Item budget across as many Broadcast
		// Graphics as the Screen allows, because a Broadcast Graphic shell now carries
		// a whole-graphic Graphic Animation and a four-phase stagger of its own — so
		// maximising shells costs more than concentrating items in fewer graphics.
		// Every item is a top-level worst-case Text Graphic Item with all four
		// lifecycle phases animated, and every graphic staggers all of them.
		const perGraphic = MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN / MAX_BROADCAST_GRAPHICS_PER_SCREEN;
		const graphics = Array.from(
			{ length: MAX_BROADCAST_GRAPHICS_PER_SCREEN },
			(_, index) => {
				const items = Array.from({ length: perGraphic }, (_, item) => {
					const { sizing: _sizing, ...topLevel } = worstCaseItem(`item-${index}-${item}`);
					return topLevel;
				});
				return {
					id: `graphic-${index}`,
					name: 'N'.repeat(100),
					items,
					animation: worstContainerAnimation(items.map(item => item.id)),
				};
			},
		);

		const config = { graphics };
		const bytes = new TextEncoder().encode(JSON.stringify(config)).byteLength;

		expect(broadcastGraphicsModeConfigSchema.safeParse(config).success).toBe(true);
		expect(modeConfigsMapSchema.safeParse({ 'broadcast-graphics': config }).success).toBe(true);
		// The figure the cap is justified by, so the schema's own arithmetic is checked.
		expect(bytes).toBeLessThan(410 * 1024);
	});

	it('costs no more with a Graphic Group holding the same animated Graphic Items', () => {
		// The other shape the cap has to survive: fewer Broadcast Graphics, each
		// spending its items on a Graphic Group and animated children. It measures
		// smaller than the maximal-shell case above, which is why that one is the
		// figure the cap is justified by.
		const perGroup = 4;
		const graphics = Array.from(
			{ length: MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN / (perGroup + 1) },
			(_, index) => {
				const children = Array.from({ length: perGroup }, (_, item) => worstCaseItem(`item-${index}-${item}`));
				return {
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
						animation: worstContainerAnimation(children.map(child => child.id)),
						children,
					}],
					animation: worstContainerAnimation([`group-${index}`]),
				};
			},
		);

		const config = { graphics };
		const bytes = new TextEncoder().encode(JSON.stringify(config)).byteLength;

		expect(broadcastGraphicsModeConfigSchema.safeParse(config).success).toBe(true);
		expect(modeConfigsMapSchema.safeParse({ 'broadcast-graphics': config }).success).toBe(true);
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

describe('Graphic Animation bounds', () => {
	function withItemAnimation(animation: unknown) {
		return broadcastGraphicsModeConfigSchema.safeParse({
			graphics: [{ id: 'a', name: 'A', items: [shapeItem('bar', { animation })] }],
		});
	}

	function withGraphicAnimation(animation: unknown) {
		return broadcastGraphicsModeConfigSchema.safeParse({
			graphics: [{ id: 'a', name: 'A', items: [shapeItem('bar')], animation }],
		});
	}

	const recipe = { duration: 400, easing: 'ease-out' as const, delay: 0 };

	it('accepts a Broadcast Graphic and a Graphic Item with no Graphic Animation at all', () => {
		// A newly authored graphic or item has no recipes until its author enables them.
		expect(withItemAnimation(undefined).success).toBe(true);
		expect(withGraphicAnimation(undefined).success).toBe(true);
	});

	it('bounds a recipe duration to the settled 50ms to 10s range', () => {
		expect(withItemAnimation({ enter: { ...recipe, duration: MIN_GRAPHIC_ANIMATION_DURATION_MS } }).success).toBe(true);
		expect(withItemAnimation({ enter: { ...recipe, duration: MAX_GRAPHIC_ANIMATION_DURATION_MS } }).success).toBe(true);
		expect(withItemAnimation({ enter: { ...recipe, duration: MIN_GRAPHIC_ANIMATION_DURATION_MS - 1 } }).success).toBe(false);
		expect(withItemAnimation({ enter: { ...recipe, duration: MAX_GRAPHIC_ANIMATION_DURATION_MS + 1 } }).success).toBe(false);
	});

	it('bounds a delay to ten seconds and refuses a negative one', () => {
		expect(withItemAnimation({ enter: { ...recipe, delay: MAX_GRAPHIC_ANIMATION_DELAY_MS } }).success).toBe(true);
		expect(withItemAnimation({ enter: { ...recipe, delay: MAX_GRAPHIC_ANIMATION_DELAY_MS + 1 } }).success).toBe(false);
		expect(withItemAnimation({ enter: { ...recipe, delay: -1 } }).success).toBe(false);
	});

	it('accepts only the seven bounded easings', () => {
		for (const easing of GRAPHIC_ANIMATION_EASING_VALUES)
			expect(withItemAnimation({ enter: { ...recipe, easing } }).success).toBe(true);

		expect(withItemAnimation({ enter: { ...recipe, easing: 'cubic-bezier(0,0,1,1)' } }).success).toBe(false);
		expect(GRAPHIC_ANIMATION_EASING_VALUES).toHaveLength(7);
	});

	it('bounds a fade channel to a zero-to-one reduction', () => {
		expect(withItemAnimation({ enter: { ...recipe, fade: { opacity: 0 } } }).success).toBe(true);
		expect(withItemAnimation({ enter: { ...recipe, fade: { opacity: 1 } } }).success).toBe(true);
		expect(withItemAnimation({ enter: { ...recipe, fade: { opacity: -0.1 } } }).success).toBe(false);
		expect(withItemAnimation({ enter: { ...recipe, fade: { opacity: 1.1 } } }).success).toBe(false);
	});

	it('bounds a scale channel to zero through twice the resting size, about one of nine origins', () => {
		expect(withItemAnimation({ enter: { ...recipe, scale: { factor: 0, origin: 'center' } } }).success).toBe(true);
		expect(withItemAnimation({ enter: { ...recipe, scale: { factor: MAX_GRAPHIC_ANIMATION_SCALE, origin: 'top-left' } } }).success).toBe(true);
		expect(withItemAnimation({ enter: { ...recipe, scale: { factor: MAX_GRAPHIC_ANIMATION_SCALE + 0.01, origin: 'center' } } }).success).toBe(false);
		expect(withItemAnimation({ enter: { ...recipe, scale: { factor: 1, origin: 'middle' } } }).success).toBe(false);
	});

	it('accepts a slide channel on any of eight compass directions, fixed or clearing its parent', () => {
		for (const direction of GRAPHIC_SLIDE_DIRECTION_VALUES) {
			expect(withItemAnimation({
				enter: { ...recipe, slide: { direction, distanceMode: 'fixed', distance: 100 } },
			}).success).toBe(true);
		}

		expect(withItemAnimation({
			enter: { ...recipe, slide: { direction: 'north', distanceMode: 'clear-parent', distance: 0 } },
		}).success).toBe(true);
		expect(withItemAnimation({
			enter: { ...recipe, slide: { direction: 'north', distanceMode: 'fixed', distance: -1 } },
		}).success).toBe(false);
		expect(withItemAnimation({
			enter: { ...recipe, slide: { direction: 'inward', distanceMode: 'fixed', distance: 1 } },
		}).success).toBe(false);
	});

	it('wipes a reveal channel from one of four edges', () => {
		expect(withItemAnimation({ enter: { ...recipe, reveal: { edge: 'bottom' } } }).success).toBe(true);
		expect(withItemAnimation({ enter: { ...recipe, reveal: { edge: 'diagonal' } } }).success).toBe(false);
	});

	it('bounds on-screen repetition to one through 100 cycles or indefinitely, with a pause up to a minute', () => {
		const onScreen = (patch: Record<string, unknown>) =>
			withItemAnimation({ 'on-screen': { ...recipe, pause: 0, repeat: 1, ...patch } }).success;

		expect(onScreen({})).toBe(true);
		expect(onScreen({ repeat: 100 })).toBe(true);
		expect(onScreen({ repeat: 'indefinite' })).toBe(true);
		expect(onScreen({ repeat: 0 })).toBe(false);
		expect(onScreen({ repeat: 101 })).toBe(false);
		expect(onScreen({ repeat: 1.5 })).toBe(false);
		expect(onScreen({ repeat: 'forever' })).toBe(false);
		expect(onScreen({ pause: 60000 })).toBe(true);
		expect(onScreen({ pause: 60001 })).toBe(false);
	});

	it('refuses on-screen repetition and pause on a phase that does not cycle', () => {
		expect(withItemAnimation({ enter: { ...recipe, pause: 0, repeat: 2 } }).success).toBe(false);
	});

	it('holds at most one recipe per lifecycle phase, and refuses an unknown phase', () => {
		expect(withItemAnimation({
			'enter': recipe,
			'on-screen': { ...recipe, pause: 0, repeat: 1 },
			'update': recipe,
			'exit': recipe,
		}).success).toBe(true);
		expect(withItemAnimation({ hover: recipe }).success).toBe(false);
	});

	it('refuses arbitrary transforms the vocabulary does not include', () => {
		// Rotation, skew, perspective, filters, and shape morphing are outside
		// Graphic Animation, which the strict recipe schema states by rejecting them.
		expect(withItemAnimation({ enter: { ...recipe, rotate: { degrees: 90 } } }).success).toBe(false);
		expect(withItemAnimation({ enter: { ...recipe, skew: { x: 10 } } }).success).toBe(false);
		expect(withItemAnimation({ enter: { ...recipe, blur: { radius: 4 } } }).success).toBe(false);
		expect(withItemAnimation({ enter: { ...recipe, keyframes: [] } }).success).toBe(false);
	});

	it('lets a Broadcast Graphic and a Graphic Group stagger their direct items, and nothing else', () => {
		const stagger = { order: 'reverse-list' as const, step: 120, itemIds: ['bar'] };

		expect(withGraphicAnimation({ stagger: { exit: stagger } }).success).toBe(true);
		// A Text or Shape Graphic Item has no direct items to order.
		expect(withItemAnimation({ stagger: { exit: stagger } }).success).toBe(false);
	});

	it('bounds a stagger step to ten seconds', () => {
		const stagger = (step: number) => withGraphicAnimation({
			stagger: { enter: { order: 'list', step, itemIds: ['bar'] } },
		}).success;

		expect(stagger(MAX_GRAPHIC_ANIMATION_STAGGER_STEP_MS)).toBe(true);
		expect(stagger(MAX_GRAPHIC_ANIMATION_STAGGER_STEP_MS + 1)).toBe(false);
		expect(stagger(-1)).toBe(false);
	});

	it('accepts a stagger naming an item that is no longer in the composition', () => {
		// An author who deletes a staggered Graphic Item must not have their next
		// write refused; a stale id is ignored when the phase is projected instead.
		expect(withGraphicAnimation({
			stagger: { enter: { order: 'list', step: 100, itemIds: ['deleted'] } },
		}).success).toBe(true);
	});

	it('applies every animation bound on the patch path the editor writes through', () => {
		// The patch schema rebuilds each mode from its field schemas, so a bound that
		// only held on a full-config write would never reach a real edit.
		const patch = modeConfigPatchSchemaMap['broadcast-graphics'];
		const withDuration = (duration: number) => patch.safeParse({
			graphics: [{ id: 'a', name: 'A', items: [shapeItem('bar', { animation: { enter: { ...recipe, duration } } })] }],
		}).success;

		expect(withDuration(400)).toBe(true);
		expect(withDuration(MAX_GRAPHIC_ANIMATION_DURATION_MS + 1)).toBe(false);
		expect(withDuration(MIN_GRAPHIC_ANIMATION_DURATION_MS - 1)).toBe(false);
	});
});
