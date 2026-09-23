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
	modeConfigPatchSchemaMap,
	modeConfigsMapSchema,
} from '~~/server/schemas/api/screen';
import { addGraphicItem, graphicBindingFieldIds } from '~~/shared/modules/graphics';
import {
	GRAPHIC_ANIMATION_EASING_VALUES,
	GRAPHIC_ANIMATION_ORIGIN_VALUES,
	GRAPHIC_REVEAL_EDGE_VALUES,
	GRAPHIC_SLIDE_DIRECTION_VALUES,
	MAX_GRAPHIC_ANIMATION_DELAY_MS,
	MAX_GRAPHIC_ANIMATION_DURATION_MS,
	MAX_GRAPHIC_ANIMATION_SCALE,
	MAX_GRAPHIC_ANIMATION_STAGGER_STEP_MS,
	MAX_GRAPHIC_INPUT_CHOICE_LENGTH,
	MAX_GRAPHIC_INPUT_CHOICE_OPTIONS,
	MAX_GRAPHIC_INPUT_KEY_LENGTH,
	MAX_GRAPHIC_INPUT_LABEL_LENGTH,
	MAX_GRAPHIC_TEXT_LENGTH,
	MIN_GRAPHIC_ANIMATION_DURATION_MS,
} from '~~/shared/types/graphics';
import { getDefaultConfigForMode } from '~~/shared/types/screenConfig';
import { randomUuid } from '~~/shared/utils/uuid';

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

function socialNetworkIconItem(id: string, overrides: Record<string, unknown> = {}) {
	return {
		type: 'social-network-icon' as const,
		id,
		label: id,
		visible: true,
		anchor: 'top-left' as const,
		x: 0,
		y: 0,
		width: 64,
		height: 64,
		network: 'twitch' as const,
		color: '#9146ff',
		opacity: 0.8,
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

/**
 * The most expensive Graphic Font Selection the schema accepts.
 *
 * The library arm, at its maximal identity and revision lengths. An application
 * font is 46 bytes and this is 266, so a worst case built from application fonts
 * would understate what the caps admit by 220 bytes on every typography and every
 * Graphic Placeholder Style — which is exactly the kind of quiet understatement
 * measuring is supposed to prevent.
 */
const WORST_FONT = {
	kind: 'asset' as const,
	reference: { assetId: 'a'.repeat(100), revisionId: 'r'.repeat(100) },
};

const WORST_TYPOGRAPHY = {
	font: WORST_FONT,
	fontSize: 599.5,
	fontWeight: 900,
	fontStyle: 'italic' as const,
	textTransform: 'uppercase' as const,
	letterSpacing: -19.5,
	lineHeight: 1.15,
	textAlign: 'center' as const,
	color: '#0077a3',
};

/** A Graphic Style Set entry identity, at its own maximum. */
const WORST_STYLE_ENTRY_ID = 'e'.repeat(100);

/**
 * Every Graphic Style Set slot a Graphic Item may reference, each with the largest
 * override its own property group admits.
 *
 * The whole block was absent from this fixture until #99, which is the same class of
 * omission #69 found in the unanimated shells: a construct the schema admits, missing
 * from the measurement, so the number looked measured and was not. It is the single
 * most expensive thing one Graphic Item can carry — larger than the item's own
 * properties — because an override is a partial of the property group it deviates
 * from, and a maximal one restates that whole group beside a 100-character entry id.
 *
 * The slots are not gated by item kind: `graphicItemStyleRefsSchema` is one strict
 * object of optional slots shared by every kind, so a Text Graphic Item may carry a
 * `boxSurfaceStyle` reference it will never apply. The worst case populates what the
 * schema accepts rather than what a renderer reads.
 */
const WORST_ITEM_STYLE_REFS = {
	'typography': {
		entryId: WORST_STYLE_ENTRY_ID,
		// `textAlign` is omitted from the typography override slot: it lays out the
		// whole block rather than one run, so the schema refuses the key.
		overrides: {
			font: WORST_FONT,
			fontSize: 599.5,
			fontWeight: 900,
			fontStyle: 'italic' as const,
			textTransform: 'uppercase' as const,
			letterSpacing: -19.5,
			lineHeight: 1.15,
			color: '#0077a3',
		},
	},
	'surfaceStyle': { entryId: WORST_STYLE_ENTRY_ID, overrides: WORST_SURFACE_STYLE },
	// A Graphic Fill is a discriminated union, so it has no meaningful partial and
	// this slot takes no overrides at all.
	'surfaceStyle.fill': { entryId: WORST_STYLE_ENTRY_ID },
	'defaultChildSurfaceStyle': { entryId: WORST_STYLE_ENTRY_ID, overrides: WORST_SURFACE_STYLE },
	'boxSurfaceStyle': { entryId: WORST_STYLE_ENTRY_ID, overrides: WORST_SURFACE_STYLE },
	'wonBoxSurfaceStyle': { entryId: WORST_STYLE_ENTRY_ID, overrides: WORST_SURFACE_STYLE },
	'geometry': { entryId: WORST_STYLE_ENTRY_ID, overrides: WORST_GEOMETRY },
	'clipGeometry': { entryId: WORST_STYLE_ENTRY_ID, overrides: WORST_GEOMETRY },
	'boxGeometry': { entryId: WORST_STYLE_ENTRY_ID, overrides: WORST_GEOMETRY },
	'media': {
		entryId: WORST_STYLE_ENTRY_ID,
		overrides: {
			fit: 'cover' as const,
			focalPosition: { horizontal: 0.5, vertical: 0.5 },
			opacity: 0.85,
			clipGeometry: WORST_GEOMETRY,
			playbackRate: 3.75,
			loop: true,
		},
	},
	'animation.enter': { entryId: WORST_STYLE_ENTRY_ID, overrides: WORST_RECIPE },
	'animation.on-screen': { entryId: WORST_STYLE_ENTRY_ID, overrides: { ...WORST_RECIPE, pause: 59999.5, repeat: 100 } },
	'animation.update': { entryId: WORST_STYLE_ENTRY_ID, overrides: WORST_RECIPE },
	'animation.exit': { entryId: WORST_STYLE_ENTRY_ID, overrides: WORST_RECIPE },
};

/** A container references whole-composition motion and nothing else. */
const WORST_CONTAINER_STYLE_REFS = {
	'animation.enter': WORST_ITEM_STYLE_REFS['animation.enter'],
	'animation.on-screen': WORST_ITEM_STYLE_REFS['animation.on-screen'],
	'animation.update': WORST_ITEM_STYLE_REFS['animation.update'],
	'animation.exit': WORST_ITEM_STYLE_REFS['animation.exit'],
};

/** A Graphic Item id at the length the schema admits, which is what a stagger names. */
function worstCaseItemId(index: number) {
	return `i${index}`.padEnd(MAX_GRAPHIC_ITEM_ID_LENGTH, 'i');
}

/** The most expensive Graphic Item the schema accepts, used for the byte budget. */
function worstCaseItem(id: string) {
	return {
		placeholderStyles: Object.fromEntries(
			Array.from({ length: MAX_GRAPHIC_PLACEHOLDER_STYLES_PER_TEXT_ITEM }, (_, index) => [
				`k${index}`.padEnd(MAX_GRAPHIC_INPUT_KEY_LENGTH, 'k'),
				{
					font: WORST_FONT,
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
		typography: WORST_TYPOGRAPHY,
		overflowPolicy: 'shrink' as const,
		// Its own maximum rather than a plausible one: the schema bounds it at 600 and
		// does not tie it to `fontSize`, so a worst case takes the longest legal value.
		minFontSize: 599.5,
		surfaceStyle: WORST_SURFACE_STYLE,
		animation: WORST_ANIMATION,
		styleRefs: WORST_ITEM_STYLE_REFS,
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

function jsonBytes(value: unknown) {
	return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

/**
 * The most expensive Graphic Group the schema accepts, holding maximal children.
 *
 * A Graphic Group is the seventh member of `graphicItemConfigSchema` and it was
 * absent from the worst case until #99's review: it carries a Shape Geometry, two
 * Graphic Surface Styles, six layout properties, and a *container* animation whose
 * stagger names its own children — and its children may each carry a `sizing` block
 * that no top-level Graphic Item can.
 */
function worstCaseGroup(id: string, childIds: string[]) {
	const children = childIds.map(childId => ({
		...worstCaseItem(childId),
		// `fixed` rather than `fill`: the two are interchangeable here and it is the
		// longer of the two enum members.
		sizing: { mode: 'fixed' as const, size: 9999.5, weight: 99.5 },
	}));
	return {
		type: 'group' as const,
		id,
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
		animation: worstContainerAnimation(childIds),
		styleRefs: WORST_ITEM_STYLE_REFS,
		children,
	};
}

/**
 * The Graphic Item budget spent one way or the other, as a list of top-level items.
 *
 * `grouped` spends it on the fewest Graphic Groups that can hold it — a group and
 * its children are one shared allowance, so fewer groups means more children, and a
 * child costs more than the group shell it needs. `flat` spends it entirely on
 * top-level Graphic Items. Which is dearer is measured rather than assumed.
 */
function worstCaseItems(total: number, arrangement: 'flat' | 'grouped') {
	if (arrangement === 'flat')
		return Array.from({ length: total }, (_, index) => worstCaseItem(worstCaseItemId(index)));

	const groupCount = Math.ceil(total / (MAX_GRAPHIC_GROUP_CHILDREN + 1));
	const items: Array<ReturnType<typeof worstCaseItem> | ReturnType<typeof worstCaseGroup>> = [];
	let placed = 0;
	for (let group = 0; group < groupCount; group += 1) {
		// One slot for the group itself, and the rest shared out among its children.
		const share = Math.floor((total - placed) / (groupCount - group)) - 1;
		const childIds = Array.from({ length: share }, (_, child) => worstCaseItemId(placed + 1 + child));
		items.push(worstCaseGroup(worstCaseItemId(placed), childIds));
		placed += share + 1;
	}
	expect(placed).toBe(total);
	return items;
}

function countScreenGraphicItems(config: { graphics: Array<{ items: Array<{ type: string; children?: unknown[] }> }> }) {
	return config.graphics.reduce(
		(total, graphic) => total + graphic.items.reduce(
			(count, item) => count + 1 + (item.type === 'group' ? (item.children?.length ?? 0) : 0),
			0,
		),
		0,
	);
}

/**
 * The worst Broadcast Graphics Screen every cap together admits.
 *
 * Every Graphic Item slot filled with a maximal Text Graphic Item carrying maximal
 * Graphic Placeholder Styles and a maximal Graphic Style Set reference in every
 * slot; maximal-length ids, because a stagger names them; every Graphic Input slot
 * filled with a maximal choice input; and every binding, Graphic Source Selection,
 * Graphic Channel, Graphic Style Set link and animated Broadcast Graphic shell
 * present.
 */
function worstCaseScreen(arrangement: 'flat' | 'grouped') {
	const graphics = Array.from({ length: MAX_BROADCAST_GRAPHICS_PER_SCREEN }, (_, index) => ({
		id: `g${index}`.padEnd(MAX_GRAPHIC_ITEM_ID_LENGTH, 'g'),
		name: 'N'.repeat(100),
		items: [] as ReturnType<typeof worstCaseItems>,
		inputs: [] as ReturnType<typeof worstCaseChoiceInput>[],
		bindings: [] as ReturnType<typeof worstCaseBinding>[],
		sources: [] as ReturnType<typeof worstCaseSource>[],
		animation: undefined as ReturnType<typeof worstContainerAnimation> | undefined,
		// The one field in this fixture with no schema maximum to populate — see the
		// named exception on the test below.
		styleSet: { styleSetId: 's'.repeat(100), revision: 999999 },
		styleRefs: WORST_CONTAINER_STYLE_REFS,
		channelId: undefined as string | undefined,
	}));

	function fill<T>(items: T[], perGraphic: number, add: (graphic: typeof graphics[number], item: T) => void) {
		let index = 0;
		for (const graphic of graphics) {
			for (let taken = 0; taken < perGraphic && index < items.length; taken += 1, index += 1)
				add(graphic, items[index]!);
		}
		expect(index).toBe(items.length);
	}

	fill(
		worstCaseItems(MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN, arrangement),
		MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHIC,
		(graphic, item) => graphic.items.push(item),
	);
	fill(
		Array.from({ length: MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHICS_SCREEN }, (_, index) => index),
		MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHIC,
		(graphic, index) => {
			graphic.inputs.push(worstCaseChoiceInput(`k${index}`));
			graphic.bindings.push(worstCaseBinding(`k${index}`));
		},
	);
	fill(
		Array.from({ length: MAX_GRAPHIC_SOURCE_SELECTIONS_PER_BROADCAST_GRAPHICS_SCREEN }, (_, index) => index),
		MAX_GRAPHIC_SOURCE_SELECTIONS_PER_BROADCAST_GRAPHIC,
		(graphic, index) => graphic.sources.push(worstCaseSource(`s${index}`, graphic.sources.length > 0)),
	);

	// A Broadcast Graphic owns whole-graphic motion as well as its items' own, and
	// staggers its direct items per phase. Leaving the shells unanimated would
	// understate the worst case by the most expensive thing a shell can carry.
	for (const graphic of graphics)
		graphic.animation = worstContainerAnimation(graphic.items.map(item => item.id));

	// Every Graphic Channel slot filled, and every Broadcast Graphic in one. Channel
	// membership costs on both sides — the declaration and the id each graphic joins
	// it by — so leaving either out would understate what the caps together admit.
	const channels = Array.from({ length: MAX_GRAPHIC_CHANNELS_PER_SCREEN }, (_, index) => ({
		id: `${'c'.repeat(98)}${String(index).padStart(2, '0')}`,
		name: 'N'.repeat(100),
		handoff: 'out-then-in' as const,
	}));
	graphics.forEach((graphic, index) => {
		graphic.channelId = channels[index % channels.length]!.id;
	});

	return { graphics, channels };
}

/** The same budget laid out flat, measured so the choice of shape stays checked. */
const WORST_CASE_FLAT_BYTES = 3_711_076;

/** A realistic Screen filled to the Graphic Item cap. See ADR-0007. */
const REALISTIC_SCREEN_AT_CAP_BYTES = 248_734;

/**
 * The shared `modeConfigs` budget, restated here because the schema keeps it
 * private. It is one number for all ten Screen Modes, which is what makes the
 * Broadcast Graphics contribution below a share rather than a total.
 */
const MAX_MODE_CONFIGS_BYTES = 512 * 1024;

/**
 * A Broadcast Graphic as the fidelity acceptance set describes one, rather than as
 * the caps admit one.
 *
 * Six Graphic Items, counted from the reconstruction inventory reproduced in
 * `DECISIONS.md` (ADR-0007): the split angular lower third
 * is "two shape beds, two accent rules, two text items", which is the richest of
 * the four and the shape the Graphic Item cap is derived from. The others are a
 * full-width lower third of about six, a four-item slate, and a two-to-three item
 * bug — nineteen Graphic Items across the whole acceptance set. The prototype
 * document those were originally read off is no longer in the repository, so the
 * ADR is the record that has to stay in step with this fixture.
 *
 * With uuid ids, an application font, one enter and one exit recipe, and — on as
 * many graphics as `MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHICS_SCREEN` allows — two
 * Graphic Inputs with a bound Graphic Source Selection.
 */
const REALISTIC_ITEMS_PER_GRAPHIC = 6;
const REALISTIC_INPUTS_PER_GRAPHIC = 2;

function realisticId(graphic: number, item: number) {
	return `3f2a9c1e-7b4d-4e2a-9f10-${String(graphic).padStart(6, '0')}${String(item).padStart(6, '0')}`;
}

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
			enter: { duration: 400, easing: 'ease-out' as const, delay: 120, fade: { opacity: 0 }, slide: { direction: 'west' as const, distanceMode: 'fixed' as const, distance: 60 } },
			exit: { duration: 300, easing: 'ease-in' as const, delay: 0, fade: { opacity: 0 } },
		},
	};
}

function realisticShape(id: string) {
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
			topLeft: { treatment: 'square' as const, size: 0 },
			topRight: { treatment: 'cut' as const, size: 24 },
			bottomRight: { treatment: 'square' as const, size: 0 },
			bottomLeft: { treatment: 'square' as const, size: 0 },
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
			enter: { duration: 500, easing: 'ease-out' as const, delay: 0, reveal: { edge: 'left' as const } },
			exit: { duration: 400, easing: 'ease-in' as const, delay: 0, reveal: { edge: 'left' as const } },
		},
	};
}

function realisticStack(totalItems: number, perGraphic = REALISTIC_ITEMS_PER_GRAPHIC) {
	let remaining = totalItems;
	// Graphic Inputs run out before Graphic Items do, and by design: a whole Screen
	// declares 60, so at two per graphic only the first thirty carry Live Control.
	// The rest are slates, bugs and brand furniture, which declare none.
	let remainingInputs = MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHICS_SCREEN;

	return Array.from({ length: Math.ceil(totalItems / perGraphic) }, (_, index) => {
		const take = Math.min(perGraphic, remaining);
		remaining -= take;
		const items = Array.from({ length: take }, (_, item) => (
			item % 3 === 0 ? realisticText(realisticId(index, item)) : realisticShape(realisticId(index, item))
		));
		const withInputs = remainingInputs >= REALISTIC_INPUTS_PER_GRAPHIC;
		if (withInputs)
			remainingInputs -= REALISTIC_INPUTS_PER_GRAPHIC;

		return {
			id: realisticId(index, 999),
			name: `Lower third ${index}`,
			items,
			...(withInputs
				? {
						inputs: [
							{ type: 'text' as const, key: 'name', label: 'Name', required: true, updatePolicy: 'staged' as const, default: '', maxLength: 60 },
							{ type: 'text' as const, key: 'role', label: 'Role', required: false, updatePolicy: 'staged' as const, default: '', maxLength: 60 },
						],
						sources: [{ key: 'player', label: 'Player', kind: 'player' as const }],
						bindings: [{ inputKey: 'name', sourceKey: 'player', fieldId: 'player.name' }],
					}
				: {}),
			animation: {
				enter: { duration: 500, easing: 'ease-out' as const, delay: 0, fade: { opacity: 0 } },
				exit: { duration: 400, easing: 'ease-in' as const, delay: 0, fade: { opacity: 0 } },
				stagger: { enter: { order: 'list' as const, step: 80, itemIds: items.map(item => item.id) } },
			},
		};
	});
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

	it('accepts one Broadcast Graphic filled to the per-graphic Graphic Item cap', () => {
		const graphics = [graphic('lower-third', MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHIC)];

		expect(broadcastGraphicsModeConfigSchema.safeParse({ graphics }).success).toBe(true);
	});

	it('accepts a Broadcast Graphic joining a declared Graphic Channel', () => {
		const config = {
			graphics: [{ ...graphic('lower-third-a'), channelId: 'thirds' }, { ...graphic('lower-third-b'), channelId: 'thirds' }],
			channels: [{ id: 'thirds', name: 'Lower thirds', handoff: 'out-then-in' as const }],
		};

		expect(broadcastGraphicsModeConfigSchema.safeParse(config).success).toBe(true);
	});

	it('accepts a Graphic Channel that states no Handoff Policy, because it defaults to Overlap', () => {
		const config = { graphics: [], channels: [{ id: 'thirds', name: 'Lower thirds' }] };

		expect(broadcastGraphicsModeConfigSchema.safeParse(config).success).toBe(true);
	});

	it('refuses an unknown Graphic Channel Handoff Policy', () => {
		const config = { graphics: [], channels: [{ id: 'thirds', name: 'Lower thirds', handoff: 'queue' }] };

		expect(broadcastGraphicsModeConfigSchema.safeParse(config).success).toBe(false);
	});

	it('refuses two Graphic Channels sharing one id', () => {
		const config = {
			graphics: [],
			channels: [{ id: 'thirds', name: 'Lower thirds' }, { id: 'thirds', name: 'Also lower thirds' }],
		};
		const result = broadcastGraphicsModeConfigSchema.safeParse(config);

		expect(result.success).toBe(false);
		expect(messages(result)).toContain('Graphic Channel ids must be unique within one Broadcast Graphics Screen');
	});

	it('names the Graphic Channel cap rather than reporting a byte count', () => {
		const channels = Array.from(
			{ length: MAX_GRAPHIC_CHANNELS_PER_SCREEN + 1 },
			(_, index) => ({ id: `channel-${index}`, name: `Channel ${index}` }),
		);
		const result = broadcastGraphicsModeConfigSchema.safeParse({ graphics: [], channels });

		expect(result.success).toBe(false);
		expect(messages(result)).toContain(
			`A Broadcast Graphics Screen must not declare more than ${MAX_GRAPHIC_CHANNELS_PER_SCREEN} Graphic Channels`,
		);
	});

	it('accepts a Broadcast Graphic naming a Graphic Channel the Screen does not declare', () => {
		// Tolerated rather than refused: a cross-field rule is an object-level refinement,
		// which the mode-configuration patch schema drops, so refusing here would hold on
		// one write path and not the other. Membership that resolves to nothing is the
		// uniform answer instead, and it is what a graphic left behind by a deleted
		// channel needs in order to keep running concurrently.
		const config = { graphics: [{ ...graphic('bug'), channelId: 'deleted' }] };

		expect(broadcastGraphicsModeConfigSchema.safeParse(config).success).toBe(true);
	});

	it('accepts a Broadcast Graphics background naming an Animation Effect this build ships', () => {
		const config = {
			graphics: [],
			background: { enabled: true, effect: 'fog' as const, opacity: 0.6, params: { speed: 2 } },
		};

		expect(broadcastGraphicsModeConfigSchema.safeParse(config).success).toBe(true);
	});

	it('refuses a background naming an Animation Effect outside the closed vocabulary', () => {
		// The vocabulary refusal, at the write path: an effect this installation does
		// not implement is a capability it lacks, not a value it can approximate.
		const config = { graphics: [], background: { enabled: true, effect: 'vanta-birds', opacity: 0.6 } };

		expect(broadcastGraphicsModeConfigSchema.safeParse(config).success).toBe(false);
	});

	it('refuses a background carrying params the named effect does not declare', () => {
		const config = {
			graphics: [],
			background: { enabled: true, effect: 'fog' as const, opacity: 0.6, params: { lightColor: '#7dd3fc' } },
		};

		expect(broadcastGraphicsModeConfigSchema.safeParse(config).success).toBe(false);
	});

	it('accepts a Screen with no background at all, which is what every Screen ships as', () => {
		expect(broadcastGraphicsModeConfigSchema.safeParse({ graphics: [] }).success).toBe(true);
	});

	it('carries the background through the mode-configuration patch path', () => {
		// The path the editor writes through rebuilds each mode from its field schemas,
		// so a background that only validates in the whole-config schema never reaches it.
		const patch = modeConfigPatchSchemaMap['broadcast-graphics'].safeParse({
			background: { enabled: true, effect: 'caustics', opacity: 0.35 },
		});

		expect(patch.success).toBe(true);
		expect(modeConfigPatchSchemaMap['broadcast-graphics'].safeParse({
			background: { enabled: true, effect: 'vanta-birds', opacity: 0.35 },
		}).success).toBe(false);
	});

	it('carries Graphic Channels through the mode-configuration patch path', () => {
		// The path the editors write through rebuilds each mode from its field schemas,
		// so a field that only validates in the whole-config schema never reaches it.
		const patch = modeConfigPatchSchemaMap['broadcast-graphics'].safeParse({
			channels: [{ id: 'thirds', name: 'Lower thirds', handoff: 'out-then-in' }],
		});

		expect(patch.success).toBe(true);
		expect(modeConfigPatchSchemaMap['broadcast-graphics'].safeParse({
			channels: [{ id: 'thirds', name: 'A' }, { id: 'thirds', name: 'B' }],
		}).success).toBe(false);
	});

	it('measures the worst Broadcast Graphics Screen every cap together admits', () => {
		// The one owned measurement of what the caps admit, rather than any one
		// ticket's arithmetic. It carries every construct the schema accepts, each
		// populated at its own maximum, **with one named exception**:
		//
		// - `styleSet.revision` is `int().nonnegative()` with no upper bound, so there
		//   is no longest legal value to write. The builder uses a six-digit revision.
		//
		// The exception is named rather than the claim being made absolute, because an
		// absolute claim is what has been wrong four times here. A construct the schema
		// admits and this builder omits produces a number that looks measured and is
		// not: that hid animated shells until #69 asked why an unchanged figure had not
		// moved, hid the whole `styleRefs` block until #99 asked the same question of
		// the rest, and hid the Graphic Group — the seventh member of
		// `graphicItemConfigSchema` — until #99's review asked it a third time.
		//
		// Which arrangement is the worst one is measured rather than assumed — see the
		// flat contrast below.
		const config = worstCaseScreen('grouped');
		const bytes = jsonBytes(config);

		// Every named cap admits it — that is what makes it the worst case the caps
		// allow rather than an arbitrary large Screen.
		expect(broadcastGraphicsModeConfigSchema.safeParse(config).success).toBe(true);

		// The one figure, pinned exactly, so the schema's own arithmetic is checked
		// rather than described. Moving any cap, or adding to the vocabulary, has to
		// move this number deliberately.
		expect(bytes).toBe(MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN_WORST_CASE_BYTES);

		// And the mode-configuration byte total refuses it. That the worst case is
		// allowed not to fit is a decision with its own record: `DECISIONS.md` (ADR-0007).
		expect(modeConfigsMapSchema.safeParse({ 'broadcast-graphics': config }).success).toBe(false);
		expect(bytes).toBeGreaterThan(MAX_MODE_CONFIGS_BYTES);
	});

	it('measures more with Graphic Groups than with the same items laid out flat', () => {
		// The contrast that makes "which worst case" a checked choice rather than an
		// assumption, and it is checked between two *equally rich* Screens: the same
		// 50 maximal Broadcast Graphic shells, the same Graphic Inputs, bindings,
		// Graphic Source Selections, Graphic Channels, Graphic Style Set link and
		// container references, differing only in whether the Graphic Item budget is
		// spent on flat top-level items or on Graphic Groups holding children.
		//
		// The earlier version of this comparison put a rich flat Screen against an
		// impoverished grouped one — grouped shells carried no inputs, bindings,
		// sources, channels or style references — and concluded that grouping was
		// cheaper. It is not: a Graphic Group child may carry a `sizing` block that a
		// top-level Graphic Item cannot, and the group shell carries a Shape Geometry,
		// two Graphic Surface Styles and a container animation of its own. Gathering
		// items into groups buys back some of the Broadcast Graphic's own stagger,
		// because the shell then staggers a handful of groups instead of every item,
		// and the children still cost more than that saves.
		const grouped = worstCaseScreen('grouped');
		const flat = worstCaseScreen('flat');

		expect(broadcastGraphicsModeConfigSchema.safeParse(flat).success).toBe(true);
		expect(countScreenGraphicItems(grouped)).toBe(MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN);
		expect(countScreenGraphicItems(flat)).toBe(MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN);

		expect(jsonBytes(flat)).toBe(WORST_CASE_FLAT_BYTES);
		expect(jsonBytes(flat)).toBeLessThan(jsonBytes(grouped));
		// Both shapes exceed the budget, so the choice between them changes the pinned
		// figure and not the conclusion.
		expect(jsonBytes(flat)).toBeGreaterThan(MAX_MODE_CONFIGS_BYTES);
	});

	it('pins a realistic Screen at the Graphic Item cap, which is what the cap is set from', () => {
		// The cap is derived from what a show needs — 50 Broadcast Graphics at the six
		// Graphic Items of the richest reconstruction in the fidelity prototype — and
		// this is the check that the derivation is affordable rather than the
		// derivation itself. See `DECISIONS.md` (ADR-0007).
		//
		// Pinned exactly rather than bracketed: a window wide enough to be comfortable
		// is a window wide enough for a vocabulary change to move the figure without
		// anyone noticing, which is the habit this ticket exists to end.
		const config = { graphics: realisticStack(MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN) };
		const bytes = jsonBytes(config);

		expect(broadcastGraphicsModeConfigSchema.safeParse(config).success).toBe(true);
		expect(bytes).toBe(REALISTIC_SCREEN_AT_CAP_BYTES);
		// Under half the shared budget, so the other nine Screen Modes still have room
		// on the same Screen. If this ratio stops holding, the cap is the thing to
		// re-derive rather than this assertion the thing to relax.
		expect(bytes / MAX_MODE_CONFIGS_BYTES).toBeLessThan(0.5);
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
				sources: [worstCaseSource('player', false)],
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

	describe('social network icon Graphic Items', () => {
		function withItems(items: Array<Record<string, unknown>>) {
			return broadcastGraphicsModeConfigSchema.safeParse({
				graphics: [{ id: 'a', name: 'A', items }],
			});
		}

		it('accepts every statically selected Supported Social Network and rejects invented keys', () => {
			for (const network of ['twitch', 'youtube', 'x', 'instagram', 'tiktok', 'bluesky'])
				expect(withItems([socialNetworkIconItem(`icon-${network}`, { network })]).success).toBe(true);

			expect(withItems([socialNetworkIconItem('icon-mastodon', { network: 'mastodon' })]).success).toBe(false);
		});

		it('bounds opacity and rejects unread configuration fields', () => {
			expect(withItems([socialNetworkIconItem('icon', { opacity: 0 })]).success).toBe(true);
			expect(withItems([socialNetworkIconItem('icon', { opacity: 1 })]).success).toBe(true);
			expect(withItems([socialNetworkIconItem('icon', { opacity: -0.1 })]).success).toBe(false);
			expect(withItems([socialNetworkIconItem('icon', { opacity: 1.1 })]).success).toBe(false);
			expect(withItems([socialNetworkIconItem('icon', { asset: { assetId: 'icon', revisionId: '1' } })]).success).toBe(false);
		});

		it('accepts the icon in every ordinary Graphic Group arrangement', () => {
			for (const arrangement of ['row', 'column', 'canvas']) {
				const result = withItems([{
					type: 'group',
					id: `group-${arrangement}`,
					label: arrangement,
					visible: true,
					anchor: 'top-left',
					x: 0,
					y: 0,
					width: 100,
					height: 50,
					arrangement,
					padding: 0,
					gap: 0,
					align: 'stretch',
					justify: 'start',
					clip: true,
					geometry: GEOMETRY,
					children: [socialNetworkIconItem(`icon-${arrangement}`, {
						sizing: { mode: 'fill', size: 0, weight: 1 },
					})],
				}]);

				expect(result.success).toBe(true);
			}
		});

		it('keeps Social Network Icons out of Feature Match Overlay documents', () => {
			const config = structuredClone(getDefaultConfigForMode('feature-match-overlay'));
			config.layout.composition.items = [socialNetworkIconItem('social-icon')];

			expect(modeConfigsMapSchema.safeParse({ 'feature-match-overlay': config }).success).toBe(false);
		});

		it('keeps dynamic Social Profile Projection icons and declarations out of Feature Match documents', () => {
			const config = structuredClone(getDefaultConfigForMode('feature-match-overlay')) as unknown as Record<string, any>;
			config.layout.composition.items = [socialNetworkIconItem('social-icon', {
				network: { projectionKey: 'profile' },
			})];
			config.layout.composition.socialProfileProjections = [{
				key: 'profile',
				label: 'Profile',
				sourceKey: 'talent',
				presentationGroupId: 'profile-group',
				dwellMs: 8_000,
				transition: 'crossfade',
				transitionDurationMs: 250,
			}];

			expect(modeConfigsMapSchema.safeParse({ 'feature-match-overlay': config }).success).toBe(false);
		});

		it('keeps Social Profile Projection placeholder styles out of Feature Match documents', () => {
			const config = structuredClone(getDefaultConfigForMode('feature-match-overlay')) as unknown as Record<string, any>;
			const authored = addGraphicItem(
				{ id: 'feature-match', name: 'Feature Match', items: [] },
				{ kind: 'text', id: 'player-name', canvasWidth: 1920, canvasHeight: 1080 },
			).graphic.items[0];
			if (authored?.type !== 'text')
				throw new Error('expected a Feature Match Text Graphic Item');
			authored.placeholderStyles = { 'profile.handle': { color: '#ffffff' } };
			config.layout.composition.items = [authored];

			expect(modeConfigsMapSchema.safeParse({ 'feature-match-overlay': config }).success).toBe(false);
		});
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

		it('clips with the canonical Shape Geometry, and rejects the discarded media-clip encoding', () => {
			// Shape Geometry states a flat treatment and size per corner and a signed
			// slant per edge. The media-clip fork that #89 discarded encoded a corner as
			// a tagged union and a slant as an optional unsigned inset. Its declaration
			// is gone, so this is what keeps its wire shape from creeping back.
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
						font: { kind: 'application', fontId: 'inter' },
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

	it('bounds a Graphic Item id to the identity length this application writes', () => {
		// Every id the editor generates is a 36-character uuid, and every path that
		// copies a document — placing a Broadcast Graphic Template, installing a
		// Template Package — mints fresh ones. The bound was 100, which nothing wrote
		// and which the worst case paid for on every id and every stagger entry.
		//
		// It is an import constraint as well as a write one, deliberately: a Template
		// Package's document is proved against this same schema, so a document that
		// installs is one the Screen write path accepts, and the two cannot come apart.
		const withId = (length: number) => broadcastGraphicsModeConfigSchema.safeParse({
			graphics: [{ id: 'a', name: 'A', items: [shapeItem('i'.repeat(length))] }],
		}).success;

		expect(MAX_GRAPHIC_ITEM_ID_LENGTH).toBe(64);
		expect(MAX_GRAPHIC_ITEM_ID_LENGTH).toBeGreaterThan(randomUuid().length);
		expect(withId(MAX_GRAPHIC_ITEM_ID_LENGTH)).toBe(true);
		expect(withId(MAX_GRAPHIC_ITEM_ID_LENGTH + 1)).toBe(false);
	});

	it('bounds a staggered id to the same length, because it names a Graphic Item', () => {
		// A stagger entry that could be longer than any id it can name would be a
		// bound on nothing — and it is the entry, not the item, that the worst case
		// pays for four times per container.
		const withStaggeredId = (length: number) => broadcastGraphicsModeConfigSchema.safeParse({
			graphics: [{
				id: 'a',
				name: 'A',
				items: [shapeItem('bar')],
				animation: { stagger: { enter: { order: 'list', step: 100, itemIds: ['s'.repeat(length)] } } },
			}],
		}).success;

		expect(withStaggeredId(MAX_GRAPHIC_ITEM_ID_LENGTH)).toBe(true);
		expect(withStaggeredId(MAX_GRAPHIC_ITEM_ID_LENGTH + 1)).toBe(false);
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

describe('graphic Animation bounds', () => {
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
		// `CONTEXT.md:574` and `:418` settle *nine* Graphic Animation Origins. Two of them
		// were exercised and the count was nowhere, so removing an origin left the title
		// claiming nine while the schema accepted eight.
		expect(GRAPHIC_ANIMATION_ORIGIN_VALUES).toHaveLength(9);

		for (const origin of GRAPHIC_ANIMATION_ORIGIN_VALUES)
			expect(withItemAnimation({ enter: { ...recipe, scale: { factor: 1, origin } } }).success).toBe(true);

		expect(withItemAnimation({ enter: { ...recipe, scale: { factor: 0, origin: 'center' } } }).success).toBe(true);
		expect(withItemAnimation({ enter: { ...recipe, scale: { factor: MAX_GRAPHIC_ANIMATION_SCALE, origin: 'top-left' } } }).success).toBe(true);
		expect(withItemAnimation({ enter: { ...recipe, scale: { factor: MAX_GRAPHIC_ANIMATION_SCALE + 0.01, origin: 'center' } } }).success).toBe(false);
		expect(withItemAnimation({ enter: { ...recipe, scale: { factor: 1, origin: 'middle' } } }).success).toBe(false);
	});

	it('accepts a slide channel on any of eight compass directions, fixed or clearing its parent', () => {
		// Counted, not just iterated: `CONTEXT.md:575` settles *eight* compass
		// directions, and a loop over a shortened enum accepts every direction it is
		// given while silently testing fewer. The count is the glossary's, so this fails
		// when the vocabulary and the code disagree rather than restating the code.
		expect(GRAPHIC_SLIDE_DIRECTION_VALUES).toHaveLength(8);

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
		// `CONTEXT.md:577` names left, right, top, and bottom — four. One edge was
		// exercised, so the title's "four" rested on nothing and dropping an edge passed.
		expect(GRAPHIC_REVEAL_EDGE_VALUES).toHaveLength(4);

		for (const edge of GRAPHIC_REVEAL_EDGE_VALUES)
			expect(withItemAnimation({ enter: { ...recipe, reveal: { edge } } }).success).toBe(true);

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

	it('bounds a stagger to the number of Graphic Items its container holds', () => {
		// A stagger names a *subset* of one container's direct Graphic Items, so a
		// list longer than the container's own item count names no subset of
		// anything. Until this bound existed the length was capped at 100
		// independently of the container, which let a Broadcast Graphic holding one
		// item carry four staggers of 100 ids each — about 41 KiB per container, on
		// every one of the 50 shells a Screen may hold. That is the largest single
		// contributor to the worst case and no Graphic Item cap can reach it. See #99.
		const staggerOf = (items: number, ids: number) => broadcastGraphicsModeConfigSchema.safeParse({
			graphics: [{
				id: 'a',
				name: 'A',
				items: Array.from({ length: items }, (_, index) => shapeItem(`bar-${index}`)),
				animation: {
					stagger: {
						enter: {
							order: 'list' as const,
							step: 100,
							itemIds: Array.from({ length: ids }, (_, index) => `bar-${index}`),
						},
					},
				},
			}],
		});

		expect(staggerOf(3, 3).success).toBe(true);
		expect(staggerOf(3, 2).success).toBe(true);
		expect(staggerOf(3, 4).success).toBe(false);
		expect(messages(staggerOf(3, 4))).toContain(
			'A Graphic Animation Stagger must not name more Graphic Items than its container holds',
		);
	});

	it('counts a Graphic Group\'s own children rather than the whole graphic', () => {
		// A group staggers its children; the Broadcast Graphic staggers its top-level
		// items, of which the group is one. Bounding either by the other's count would
		// refuse an ordinary composition.
		const groupWith = (children: number, ids: number) => broadcastGraphicsModeConfigSchema.safeParse({
			graphics: [{
				id: 'a',
				name: 'A',
				items: [{
					type: 'group' as const,
					id: 'cluster',
					label: 'Cluster',
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
					children: Array.from({ length: children }, (_, index) => shapeItem(`child-${index}`)),
					animation: {
						stagger: {
							exit: {
								order: 'list' as const,
								step: 100,
								itemIds: Array.from({ length: ids }, (_, index) => `child-${index}`),
							},
						},
					},
				}],
				animation: { stagger: { exit: { order: 'list' as const, step: 100, itemIds: ['cluster'] } } },
			}],
		});

		expect(groupWith(4, 4).success).toBe(true);
		expect(groupWith(4, 5).success).toBe(false);
	});

	it('bounds a stagger on the patch path the editor writes through', () => {
		// The bound lives on the Broadcast Graphic, which is a field of the mode
		// config rather than the mode config itself, so the patch rebuild keeps it.
		const patch = modeConfigPatchSchemaMap['broadcast-graphics'].safeParse({
			graphics: [{
				id: 'a',
				name: 'A',
				items: [shapeItem('bar')],
				animation: { stagger: { enter: { order: 'list', step: 100, itemIds: ['bar', 'gone'] } } },
			}],
		});

		expect(patch.success).toBe(false);
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
