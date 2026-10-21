import type { BroadcastGraphicConfig, GraphicItemConfig } from '~~/shared/types/graphics';
import type { GraphicStyleSetEntry } from '~~/shared/types/graphicStyleSet';
import type { GraphicStyleAuthoringContext } from '~/composables/screen/useGraphicStyleSetAuthoring';
import type { CompositorEdit, CompositorEditingState } from '~/modules/graphics/compositorEditing';
import { describe, expect, it } from 'vitest';
import { applyGraphicStyleSet, resolveGraphicStyleSet } from '~~/shared/modules/graphic-style-sets';
import {
	DEFAULT_GRAPHIC_TYPOGRAPHY,
	patchBroadcastGraphic,
	patchGraphicTypography,
} from '~~/shared/modules/graphics';
import { editCompositorStack } from '~/modules/graphics/compositorEditing';

const textItem: GraphicItemConfig = {
	type: 'text',
	id: 'name',
	label: 'Text 1',
	visible: true,
	anchor: 'top-left',
	x: 0,
	y: 0,
	width: 400,
	height: 80,
	text: 'Commentator',
	typography: { ...DEFAULT_GRAPHIC_TYPOGRAPHY },
	overflowPolicy: 'ellipsis',
	minFontSize: 24,
};

function stack(): BroadcastGraphicConfig[] {
	return [
		{ id: 'lower-third', name: 'Lower Third', items: [textItem] },
		{ id: 'bug', name: 'Bug', items: [] },
	];
}

const ITEM = { type: 'item', graphicId: 'lower-third', itemId: 'name' } as const;
const GRAPHIC = { type: 'graphic', graphicId: 'lower-third' } as const;

function state(overrides: Partial<CompositorEditingState> = {}): CompositorEditingState {
	return { graphics: stack(), selectedTarget: ITEM, writable: true, ...overrides };
}

const setFontSize: CompositorEdit = {
	kind: 'author',
	item: (graphic, itemId) => patchGraphicTypography(graphic, itemId, { fontSize: 30 }),
};

const rename: CompositorEdit = {
	kind: 'author',
	graphic: (graphics, graphicId) => patchBroadcastGraphic(graphics, graphicId, { name: 'Talent' }),
};

function fontSizeOf(graphics: readonly BroadcastGraphicConfig[] | null) {
	const item = graphics?.[0]?.items[0];
	return item?.type === 'text' ? item.typography.fontSize : undefined;
}

function typographyRefOf(graphics: readonly BroadcastGraphicConfig[] | null) {
	return graphics?.[0]?.items[0]?.styleRefs?.typography;
}

function entries(letterSpacing = 2): GraphicStyleSetEntry[] {
	return [
		{ id: 'brand', kind: 'palette', name: 'Brand', schemaVersion: 1, value: { color: '#ff0044' } },
		{
			id: 'heading',
			kind: 'typography',
			name: 'Show heading',
			schemaVersion: 1,
			value: {
				font: { kind: 'application', fontId: 'inter' },
				fontSize: 64,
				fontWeight: 800,
				fontStyle: 'normal',
				textTransform: 'uppercase',
				letterSpacing,
				lineHeight: 1,
				colorEntryId: 'brand',
			},
		},
	];
}

const PUBLISHED = 3;

function styleSet(published: GraphicStyleSetEntry[] = entries()): GraphicStyleAuthoringContext {
	return {
		id: 'show-style',
		name: 'Show style',
		entries: published,
		resolution: resolveGraphicStyleSet(published),
		publishedRevision: PUBLISHED,
	};
}

/**
 * A composition holding exactly what `entries()` resolves to, recorded two revisions
 * behind the published one: what a publish that changed only entries it never
 * references leaves behind (#198).
 */
function stranded(): BroadcastGraphicConfig[] {
	return [applyGraphicStyleSet(
		{
			id: 'lower-third',
			name: 'Lower Third',
			styleSet: { styleSetId: 'show-style', revision: 1 },
			items: [{ ...textItem, styleRefs: { typography: { entryId: 'heading' } } }],
		},
		resolveGraphicStyleSet(entries()),
	)];
}

describe('the Graphics Authoring Lease', () => {
	it('refuses every edit while this Session does not hold it', () => {
		const refused = state({ writable: false, styleSet: styleSet() });

		expect(editCompositorStack(refused, setFontSize)).toBeNull();
		expect(editCompositorStack({ ...refused, selectedTarget: GRAPHIC }, rename)).toBeNull();
		expect(editCompositorStack(refused, { kind: 'bind-style-ref', slot: 'typography', entryId: 'heading' })).toBeNull();
		expect(editCompositorStack(refused, { kind: 'unbind-style-ref', slot: 'typography' })).toBeNull();
	});

	it('fails closed when nothing states that this Session holds it', () => {
		expect(editCompositorStack(state({ writable: undefined }), setFontSize)).toBeNull();
	});

	it('admits the edit while this Session holds it', () => {
		expect(fontSizeOf(editCompositorStack(state(), setFontSize))).toBe(30);
	});
});

describe('resolving the selection', () => {
	it('aims an item edit at the selected Graphic Item', () => {
		expect(fontSizeOf(editCompositorStack(state(), setFontSize))).toBe(30);
	});

	it('aims a graphic edit at the selected Broadcast Graphic', () => {
		expect(editCompositorStack(state({ selectedTarget: GRAPHIC }), rename)?.[0]?.name).toBe('Talent');
	});

	it('refuses an edit that has nothing to say about what is selected', () => {
		expect(editCompositorStack(state({ selectedTarget: GRAPHIC }), setFontSize)).toBeNull();
		expect(editCompositorStack(state(), rename)).toBeNull();
		expect(editCompositorStack(state({ selectedTarget: { type: 'canvas' } }), setFontSize)).toBeNull();
	});

	it('refuses an edit to a selection the stack no longer carries', () => {
		const gone = { type: 'item', graphicId: 'lower-third', itemId: 'deleted' } as const;

		expect(editCompositorStack(state({ selectedTarget: gone }), setFontSize)).toBeNull();
	});
});

describe('replacing the stack', () => {
	it('replaces only the edited Broadcast Graphic, in place', () => {
		const before = state({ styleSet: styleSet() });
		const next = editCompositorStack(before, setFontSize);

		expect(next?.map(graphic => graphic.id)).toEqual(['lower-third', 'bug']);
		expect(next?.[1]).toBe(before.graphics[1]);
	});

	it('never changes the stack it was given', () => {
		const before = state({ styleSet: styleSet() });
		editCompositorStack(before, setFontSize);

		expect(before.graphics).toEqual(stack());
	});
});

describe('re-capturing Graphic Style Set overrides', () => {
	it('records a value edit as an override, judged against the stored graphic', () => {
		const next = editCompositorStack(state({ graphics: stranded(), styleSet: styleSet() }), setFontSize);

		expect(typographyRefOf(next)).toEqual({ entryId: 'heading', overrides: { fontSize: 30 } });
	});

	it('re-captures an edit aimed at the Broadcast Graphic as well', () => {
		const resize: CompositorEdit = {
			kind: 'author',
			graphic: (graphics, graphicId) => graphics.map(graphic => graphic.id === graphicId
				? patchGraphicTypography(graphic, 'name', { fontSize: 30 })
				: graphic),
		};

		const next = editCompositorStack(
			state({ graphics: stranded(), selectedTarget: GRAPHIC, styleSet: styleSet() }),
			resize,
		);

		expect(typographyRefOf(next)).toEqual({ entryId: 'heading', overrides: { fontSize: 30 } });
	});

	it('records nothing on a slot the Style Set has a pending change in, and keeps the value', () => {
		const next = editCompositorStack(state({ graphics: stranded(), styleSet: styleSet(entries(8)) }), setFontSize);

		expect(typographyRefOf(next)).toEqual({ entryId: 'heading' });
		expect(fontSizeOf(next)).toBe(30);
	});

	it('records nothing without a loaded Style Set, leaving the reference as it was', () => {
		const next = editCompositorStack(state({ graphics: stranded() }), setFontSize);

		expect(typographyRefOf(next)).toEqual({ entryId: 'heading' });
		expect(fontSizeOf(next)).toBe(30);
	});
});

describe('referencing a Graphic Style Set entry', () => {
	it('binds the selected owner\'s slot and takes the entry\'s values, recording no override', () => {
		const next = editCompositorStack(
			state({ styleSet: styleSet() }),
			{ kind: 'bind-style-ref', slot: 'typography', entryId: 'heading' },
		);

		expect(typographyRefOf(next)).toEqual({ entryId: 'heading' });
		expect(fontSizeOf(next)).toBe(64);
	});

	it('refuses to bind without a loaded Style Set to bind to', () => {
		expect(editCompositorStack(state(), { kind: 'bind-style-ref', slot: 'typography', entryId: 'heading' })).toBeNull();
	});

	it('unbinds a slot and keeps the value it holds', () => {
		const next = editCompositorStack(
			state({ graphics: stranded(), styleSet: styleSet() }),
			{ kind: 'unbind-style-ref', slot: 'typography' },
		);

		expect(typographyRefOf(next)).toBeUndefined();
		expect(fontSizeOf(next)).toBe(64);
	});
});
