import { describe, expect, it } from 'vitest';
import {
	broadcastGraphicsModeConfigSchema,
	MAX_BROADCAST_GRAPHICS_PER_SCREEN,
	MAX_GRAPHIC_GROUP_CHILDREN,
	MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHIC,
	MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHICS_SCREEN,
	MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHIC,
	MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN,
	MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN_WORST_CASE_BYTES,
	MAX_GRAPHIC_PLACEHOLDER_STYLES_PER_TEXT_ITEM,
	MAX_GRAPHIC_SOURCE_SELECTIONS_PER_BROADCAST_GRAPHIC,
	MAX_GRAPHIC_SOURCE_SELECTIONS_PER_BROADCAST_GRAPHICS_SCREEN,
	modeConfigPatchSchemaMap,
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

function mediaItem(id: string, overrides: Record<string, unknown> = {}) {
	return {
		type: 'media' as const,
		id,
		label: id,
		visible: true,
		anchor: 'top-left' as const,
		x: 0,
		y: 0,
		width: 10,
		height: 10,
		asset: { assetId: 'asset-1', revisionId: 'revision-1' },
		mediaKind: 'image' as const,
		fit: 'cover' as const,
		focalPosition: { horizontal: 0.5, vertical: 0.5 },
		opacity: 1,
		playbackRate: 1,
		loop: true,
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
		placeholderStyles: Object.fromEntries(
			Array.from({ length: MAX_GRAPHIC_PLACEHOLDER_STYLES_PER_TEXT_ITEM }, (_, index) => [
				`k${index}`.padEnd(MAX_GRAPHIC_INPUT_KEY_LENGTH, 'k'),
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

/** The most expensive Graphic Input the schema accepts: a full choice list. */
function worstCaseChoiceInput(key: string) {
	return {
		type: 'choice' as const,
		key: key.padEnd(MAX_GRAPHIC_INPUT_KEY_LENGTH, 'k'),
		label: 'L'.repeat(MAX_GRAPHIC_INPUT_LABEL_LENGTH),
		required: true,
		updatePolicy: 'staged' as const,
		default: 'd'.repeat(MAX_GRAPHIC_INPUT_CHOICE_LENGTH),
		options: Array.from({ length: MAX_GRAPHIC_INPUT_CHOICE_OPTIONS }, () => ({
			value: 'v'.repeat(MAX_GRAPHIC_INPUT_CHOICE_LENGTH),
			label: 'L'.repeat(MAX_GRAPHIC_INPUT_CHOICE_LENGTH),
		})),
	};
}

/**
 * The most expensive field id the binding catalog actually offers.
 *
 * Derived from the catalog rather than written out, because a `fieldId` must now name
 * a catalog field: the schema refuses an invented 100-character id, so the honest
 * worst case is the longest real name, and it moves with the catalog.
 */
const LONGEST_BINDING_FIELD_ID = graphicBindingFieldIds()
	.reduce((longest, id) => (id.length > longest.length ? id : longest), '');

const WORST_CASE_PARENT_SOURCE_KEY = 'p'.repeat(MAX_GRAPHIC_INPUT_KEY_LENGTH);

function worstCaseBinding(inputKey: string) {
	return {
		inputKey: inputKey.padEnd(MAX_GRAPHIC_INPUT_KEY_LENGTH, 'k'),
		sourceKey: WORST_CASE_PARENT_SOURCE_KEY,
		fieldId: LONGEST_BINDING_FIELD_ID,
	};
}

/**
 * One operator-selected Graphic Source Selection per Broadcast Graphic and derived
 * ones after it.
 *
 * Derived is the expensive shape — it carries a `from` naming a maximal sibling key
 * — and it has to be reachable, so the first selection is the Feature Match Slot the
 * rest follow. Several derived selections sharing one parent is exactly the intended
 * use: an operator picks the slot once and both Players resolve.
 */
function worstCaseSource(key: string, derived: boolean) {
	const base = {
		key: derived ? key.padEnd(MAX_GRAPHIC_INPUT_KEY_LENGTH, 's') : WORST_CASE_PARENT_SOURCE_KEY,
		label: 'L'.repeat(MAX_GRAPHIC_INPUT_LABEL_LENGTH),
	};
	return derived
		? {
				...base,
				kind: 'player' as const,
				from: { sourceKey: WORST_CASE_PARENT_SOURCE_KEY, relation: 'player1' as const },
			}
		: { ...base, kind: 'feature-match-slot' as const };
}

function textInput(key: string) {
	return {
		type: 'text' as const,
		key,
		label: key,
		required: false,
		updatePolicy: 'staged' as const,
		default: '',
		maxLength: MAX_GRAPHIC_TEXT_LENGTH,
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

		const perGroup = MAX_GRAPHIC_GROUP_CHILDREN + 1;
		const withinCap = Array.from(
			{ length: Math.floor(MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN / perGroup) },
			(_, index) => groupOf(`g${index}`, MAX_GRAPHIC_GROUP_CHILDREN),
		);
		const overCap = Array.from(
			{ length: Math.ceil((MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN + 1) / perGroup) },
			(_, index) => groupOf(`g${index}`, MAX_GRAPHIC_GROUP_CHILDREN),
		);

		expect(broadcastGraphicsModeConfigSchema.safeParse({ graphics: withinCap }).success).toBe(true);
		expect(broadcastGraphicsModeConfigSchema.safeParse({ graphics: overCap }).success).toBe(false);
	});

	it('accepts a stack at the whole-Screen Graphic Item cap', () => {
		// One Broadcast Graphic filled to its own cap, and the rest sharing whatever
		// the whole-Screen cap has left.
		const spare = MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN - MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHIC;
		const graphics = Array.from(
			{ length: MAX_BROADCAST_GRAPHICS_PER_SCREEN },
			(_, index) => graphic(
				`graphic-${index}`,
				index === 0 ? MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHIC : (index <= spare ? 1 : 0),
			),
		);

		expect(broadcastGraphicsModeConfigSchema.safeParse({ graphics }).success).toBe(true);
	});

	it('keeps a worst-case authored Screen inside the mode-configuration byte limit', () => {
		// The named caps have to bind before the byte limit, or an operator reads an
		// opaque byte count instead of the limit they reached. This is the most
		// expensive Screen every cap together still admits: every Graphic Item slot
		// filled with a maximal Text Graphic Item carrying maximal Graphic Placeholder
		// Styles, every Graphic Input slot filled with a maximal choice input, and
		// every binding, Graphic Source Selection, and Broadcast Graphic shell present.
		const graphics = Array.from({ length: MAX_BROADCAST_GRAPHICS_PER_SCREEN }, (_, index) => ({
			id: `graphic-${index}`,
			name: 'N'.repeat(100),
			items: [] as ReturnType<typeof worstCaseItem>[],
			inputs: [] as ReturnType<typeof worstCaseChoiceInput>[],
			bindings: [] as ReturnType<typeof worstCaseBinding>[],
			sources: [] as ReturnType<typeof worstCaseSource>[],
		}));

		function fill(total: number, perGraphic: number, add: (graphic: typeof graphics[number], index: number) => void) {
			let remaining = total;
			for (const graphic of graphics) {
				for (let index = 0; index < perGraphic && remaining > 0; index += 1, remaining -= 1)
					add(graphic, total - remaining);
			}
			expect(remaining).toBe(0);
		}

		fill(
			MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN,
			MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHIC,
			(graphic, index) => graphic.items.push(worstCaseItem(`item-${index}`)),
		);
		fill(
			MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHICS_SCREEN,
			MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHIC,
			(graphic, index) => {
				graphic.inputs.push(worstCaseChoiceInput(`k${index}`));
				graphic.bindings.push(worstCaseBinding(`k${index}`));
			},
		);
		fill(
			MAX_GRAPHIC_SOURCE_SELECTIONS_PER_BROADCAST_GRAPHICS_SCREEN,
			MAX_GRAPHIC_SOURCE_SELECTIONS_PER_BROADCAST_GRAPHIC,
			(graphic, index) => graphic.sources.push(
				worstCaseSource(`s${index}`, graphic.sources.length > 0),
			),
		);

		const config = { graphics };
		const bytes = new TextEncoder().encode(JSON.stringify(config)).byteLength;

		expect(broadcastGraphicsModeConfigSchema.safeParse(config).success).toBe(true);
		expect(modeConfigsMapSchema.safeParse({ 'broadcast-graphics': config }).success).toBe(true);
		// The figure the caps are justified by, so the schema's own arithmetic is
		// checked rather than described. Lowering a cap without measuring, or raising
		// one, has to move this number.
		expect(bytes).toBe(MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN_WORST_CASE_BYTES);
		expect(bytes).toBeLessThan(410 * 1024);
	});

	it('names the whole-Screen Graphic Input cap rather than reporting a byte count', () => {
		const perGraphic = MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHIC;
		const graphics = Array.from(
			{ length: Math.ceil((MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHICS_SCREEN + 1) / perGraphic) },
			(_, index) => ({
				...graphic(`graphic-${index}`),
				inputs: Array.from({ length: perGraphic }, (_, entry) => textInput(`k${index}x${entry}`)),
			}),
		);

		const result = broadcastGraphicsModeConfigSchema.safeParse({ graphics });

		expect(result.success).toBe(false);
		expect(messages(result)).toContain(
			`A Broadcast Graphics Screen must not declare more than ${MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHICS_SCREEN} Graphic Inputs in total`,
		);
	});

	it('applies the whole-Screen Graphic Input cap on the patch path the editor writes through', () => {
		// Same reason the Graphic Item cap lives on the array: the patch schema rebuilds
		// each mode from its field schemas and drops object-level refinements.
		const perGraphic = MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHIC;
		const graphics = Array.from(
			{ length: Math.ceil((MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHICS_SCREEN + 1) / perGraphic) },
			(_, index) => ({
				...graphic(`graphic-${index}`),
				inputs: Array.from({ length: perGraphic }, (_, entry) => textInput(`k${index}x${entry}`)),
			}),
		);

		const result = modeConfigPatchSchemaMap['broadcast-graphics'].safeParse({ graphics });

		expect(result.success).toBe(false);
		expect(messages(result)).toContain(
			`A Broadcast Graphics Screen must not declare more than ${MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHICS_SCREEN} Graphic Inputs in total`,
		);
	});

	it('rejects two Graphic Inputs sharing one key, and two bindings for one input', () => {
		// Every placeholder, binding, and Live Control edit addresses an input by key
		// alone, so a duplicate would render, bind, and edit whichever came first.
		const duplicateKeys = broadcastGraphicsModeConfigSchema.safeParse({
			graphics: [{ ...graphic('lower-third'), inputs: [textInput('name'), textInput('name')] }],
		});
		const duplicateBindings = broadcastGraphicsModeConfigSchema.safeParse({
			graphics: [{
				...graphic('lower-third'),
				inputs: [textInput('name')],
				sources: [worstCaseSource('player')],
				bindings: [worstCaseBinding('name'), worstCaseBinding('name')],
			}],
		});

		expect(messages(duplicateKeys)).toContain('Graphic Input keys must be unique within one Broadcast Graphic');
		expect(messages(duplicateBindings)).toContain('A Graphic Input may have at most one Graphic Input Binding');
	});

	it('rejects a Graphic Input key a Graphic Text Template could not name', () => {
		const result = broadcastGraphicsModeConfigSchema.safeParse({
			graphics: [{ ...graphic('lower-third'), inputs: [textInput('2 names')] }],
		});

		expect(result.success).toBe(false);
	});

	it('caps the Graphic Placeholder Styles one Text Graphic Item may define', () => {
		const styles = (count: number) => Object.fromEntries(
			Array.from({ length: count }, (_, index) => [`k${index}`, { fontWeight: 700 }]),
		);
		const withStyles = (count: number) => ({
			graphics: [{
				...graphic('lower-third'),
				items: [{ ...worstCaseItem('t'), placeholderStyles: styles(count) }],
			}],
		});

		expect(broadcastGraphicsModeConfigSchema.safeParse(
			withStyles(MAX_GRAPHIC_PLACEHOLDER_STYLES_PER_TEXT_ITEM),
		).success).toBe(true);
		expect(broadcastGraphicsModeConfigSchema.safeParse(
			withStyles(MAX_GRAPHIC_PLACEHOLDER_STYLES_PER_TEXT_ITEM + 1),
		).success).toBe(false);
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
				items: [{ type: 'gauge', id: 'meter', label: 'Meter', visible: true, anchor: 'top-left', x: 0, y: 0, width: 10, height: 10 }],
			}],
		});

		expect(result.success).toBe(false);
	});

	describe('media Graphic Items', () => {
		function withItems(items: Array<Record<string, unknown>>) {
			return broadcastGraphicsModeConfigSchema.safeParse({
				graphics: [{ id: 'a', name: 'A', items }],
			});
		}

		it('accepts a Media Graphic Item pinning one exact identity and revision', () => {
			const result = withItems([mediaItem('logo')]);

			expect(result.success).toBe(true);
			const item = result.data?.graphics[0]?.items[0];
			expect(item?.type === 'media' && item.asset).toEqual({ assetId: 'asset-1', revisionId: 'revision-1' });
		});

		it('accepts one with no asset pinned, and none with a partial reference', () => {
			// An author places the rectangle before choosing content, so an absent asset
			// is a complete item. Half a reference is not: it pins no exact revision.
			expect(withItems([mediaItem('logo', { asset: undefined })]).success).toBe(true);
			expect(withItems([mediaItem('logo', { asset: { assetId: 'asset-1' } })]).success).toBe(false);
			expect(withItems([mediaItem('logo', { asset: { revisionId: 'revision-1' } })]).success).toBe(false);
			expect(withItems([mediaItem('logo', { asset: { assetId: 'asset-1', revisionId: 'revision-1', latest: true } })]).success).toBe(false);
		});

		it('bounds fitting, focal position, opacity, and playback rate', () => {
			expect(withItems([mediaItem('logo', { fit: 'stretch' })]).success).toBe(false);
			expect(withItems([mediaItem('logo', { mediaKind: 'audio' })]).success).toBe(false);
			expect(withItems([mediaItem('logo', { focalPosition: { horizontal: 1.5, vertical: 0.5 } })]).success).toBe(false);
			expect(withItems([mediaItem('logo', { focalPosition: { horizontal: 0.5 } })]).success).toBe(false);
			expect(withItems([mediaItem('logo', { opacity: -0.1 })]).success).toBe(false);
			expect(withItems([mediaItem('logo', { playbackRate: 0 })]).success).toBe(false);
			expect(withItems([mediaItem('logo', { playbackRate: 8 })]).success).toBe(false);
			expect(withItems([mediaItem('logo', { playbackRate: 0.25 })]).success).toBe(true);
			expect(withItems([mediaItem('logo', { playbackRate: 4 })]).success).toBe(true);
		});

		it('clips with the canonical Shape Geometry, and rejects the media-clip encoding', () => {
			// The canonical Shape Geometry states a flat treatment and size per corner
			// and a signed slant per edge. The Feature Match Overlay media fork encodes
			// a corner as a tagged union and a slant as an optional unsigned inset, and
			// must not be accepted here.
			expect(withItems([mediaItem('logo', { clipGeometry: GEOMETRY })]).success).toBe(true);
			expect(withItems([mediaItem('logo', { clipGeometry: undefined })]).success).toBe(true);
			expect(withItems([mediaItem('logo', {
				clipGeometry: {
					topLeft: { kind: 'rounded', size: 8 },
					topRight: { kind: 'square' },
					bottomRight: { kind: 'square' },
					bottomLeft: { kind: 'square' },
					leftEdgeSlant: 4,
				},
			})]).success).toBe(false);
		});

		it('rejects a Graphic Surface Style on a Media Graphic Item', () => {
			// It paints an asset, not a surface, so a fill would be an unread field the
			// compositor silently ignores.
			expect(withItems([mediaItem('logo', {
				surfaceStyle: { fill: { type: 'solid', color: '#ffffff' }, fillOpacity: 1 },
			})]).success).toBe(false);
		});

		it('accepts a Media Graphic Item as a Graphic Group child with main-axis sizing', () => {
			const result = withItems([{
				type: 'group',
				id: 'cluster',
				label: 'Cluster',
				visible: true,
				anchor: 'top-left',
				x: 0,
				y: 0,
				width: 100,
				height: 50,
				arrangement: 'row',
				padding: 0,
				gap: 0,
				align: 'stretch',
				justify: 'start',
				clip: false,
				geometry: GEOMETRY,
				children: [mediaItem('badge', { sizing: { mode: 'fill', size: 0, weight: 2 } })],
			}]);

			expect(result.success).toBe(true);
		});

		it('rejects main-axis sizing on a top-level Media Graphic Item', () => {
			// Only a Graphic Group child has a group to be sized inside.
			expect(withItems([mediaItem('logo', { sizing: { mode: 'fill', size: 0, weight: 2 } })]).success).toBe(false);
		});

		it('counts a Media Graphic Item towards the whole-Screen Graphic Item cap', () => {
			const overCap = Array.from(
				{ length: MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN + 1 },
				(_, index) => mediaItem(`logo-${index}`),
			);

			expect(withItems(overCap).success).toBe(false);
		});
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
