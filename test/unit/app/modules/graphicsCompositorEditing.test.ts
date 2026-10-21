import type { BroadcastGraphicConfig, GraphicItemConfig } from '~~/shared/types/graphics';
import type { GraphicStyleSetEntry } from '~~/shared/types/graphicStyleSet';
import type { GraphicStyleAuthoringContext } from '~/composables/screen/useGraphicStyleSetAuthoring';
import type { CompositorEdit, CompositorEditingState } from '~/modules/graphics/compositorEditing';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ref } from 'vue';
import { applyGraphicStyleSet, resolveGraphicStyleSet } from '~~/shared/modules/graphic-style-sets';
import {
	createBroadcastGraphic,
	DEFAULT_GRAPHIC_TYPOGRAPHY,
	moveBroadcastGraphic,
	patchBroadcastGraphic,
	patchGraphicItem,
	patchGraphicTypography,
} from '~~/shared/modules/graphics';
import { editCompositorStack, useCompositorEditing } from '~/modules/graphics/compositorEditing';

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
const CANVAS = { type: 'canvas' } as const;

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

describe('editing the stack whatever is selected', () => {
	const addGraphic: CompositorEdit = {
		kind: 'stack',
		apply: graphics => createBroadcastGraphic(graphics, { id: 'scorebug', name: 'Scorebug' }).graphics,
	};

	it('applies a stack edit with anything or nothing selected', () => {
		for (const selectedTarget of [ITEM, GRAPHIC, { type: 'canvas' } as const]) {
			expect(editCompositorStack(state({ selectedTarget }), addGraphic)?.map(graphic => graphic.id))
				.toEqual(['lower-third', 'bug', 'scorebug']);
		}
	});

	it('applies a stack edit even after the selection has gone', () => {
		const gone = { type: 'graphic', graphicId: 'deleted' } as const;

		expect(editCompositorStack(state({ selectedTarget: gone }), addGraphic)).toHaveLength(3);
	});

	it('still refuses a stack edit while this Session does not hold the lease', () => {
		expect(editCompositorStack(state({ writable: false, selectedTarget: { type: 'canvas' } }), addGraphic)).toBeNull();
	});
});

describe('editing one named Broadcast Graphic whatever is selected', () => {
	function hide(graphicId: string): CompositorEdit {
		return { kind: 'graphic', graphicId, apply: graphic => ({ ...graphic, name: `${graphic.name} (hidden)` }) };
	}

	it('applies to the Broadcast Graphic it names, with anything or nothing selected', () => {
		for (const selectedTarget of [ITEM, GRAPHIC, { type: 'canvas' } as const]) {
			expect(editCompositorStack(state({ selectedTarget }), hide('bug'))?.map(graphic => graphic.name))
				.toEqual(['Lower Third', 'Bug (hidden)']);
		}
	});

	it('refuses to edit a Broadcast Graphic the stack does not carry', () => {
		expect(editCompositorStack(state(), hide('deleted'))).toBeNull();
	});

	it('still refuses while this Session does not hold the lease', () => {
		expect(editCompositorStack(state({ writable: false }), hide('bug'))).toBeNull();
	});
});

describe('replacing the stack', () => {
	it('replaces only the edited Broadcast Graphic, in place', () => {
		const before = state({ styleSet: styleSet() });
		const next = editCompositorStack(before, setFontSize);

		expect(next?.map(graphic => graphic.id)).toEqual(['lower-third', 'bug']);
		expect(next?.[1]).toBe(before.graphics[1]);
	});

	it('answers nothing to commit for an edit that changes nothing', () => {
		const frontmostForward: CompositorEdit = { kind: 'stack', apply: graphics => moveBroadcastGraphic(graphics, 'bug', 1) };
		const unchanged: CompositorEdit = { kind: 'graphic', graphicId: 'bug', apply: graphic => graphic };

		expect(editCompositorStack(state(), frontmostForward)).toBeNull();
		expect(editCompositorStack(state(), unchanged)).toBeNull();
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

	/**
	 * Every kind of edit that can change a value, each from a selection it applies to.
	 * The style-reference edits are not here: they write provenance themselves, and
	 * are pinned below under referencing an entry.
	 */
	const resize = (graphic: BroadcastGraphicConfig) => patchGraphicTypography(graphic, 'name', { fontSize: 30 });
	const everyValueEdit: Array<[string, GraphicsSelectionTarget, CompositorEdit]> = [
		['an item edit', ITEM, setFontSize],
		['a graphic edit', GRAPHIC, {
			kind: 'author',
			graphic: (graphics, graphicId) => graphics.map(graphic => graphic.id === graphicId ? resize(graphic) : graphic),
		}],
		['a stack edit', CANVAS, { kind: 'stack', apply: graphics => graphics.map(resize) }],
		['an edit to a named Broadcast Graphic', CANVAS, { kind: 'graphic', graphicId: 'lower-third', apply: resize }],
	];

	it.each(everyValueEdit)('re-captures %s, judged against the stored graphic', (_, selectedTarget, edit) => {
		const next = editCompositorStack(state({ graphics: stranded(), selectedTarget, styleSet: styleSet() }), edit);

		expect(typographyRefOf(next)).toEqual({ entryId: 'heading', overrides: { fontSize: 30 } });
	});

	it('judges a graphic against the loaded Style Set only when it is linked to that one', () => {
		const [linked] = stranded();
		const elsewhere = { ...linked!, id: 'elsewhere', styleSet: { styleSetId: 'another-style', revision: 1 } };

		const next = editCompositorStack(
			state({ graphics: [linked!, elsewhere], selectedTarget: CANVAS, styleSet: styleSet() }),
			{ kind: 'stack', apply: graphics => graphics.map(resize) },
		);

		expect(next?.[0]?.items[0]?.styleRefs?.typography).toEqual({ entryId: 'heading', overrides: { fontSize: 30 } });
		expect(next?.[1]?.items[0]?.styleRefs?.typography).toEqual({ entryId: 'heading' });
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

	it('keeps another owner\'s recorded override when it binds', () => {
		const pinned = { entryId: 'heading', overrides: { fontSize: 30 } };
		const graphics = [applyGraphicStyleSet(
			{
				id: 'lower-third',
				name: 'Lower Third',
				styleSet: { styleSetId: 'show-style', revision: PUBLISHED },
				items: [textItem, { ...textItem, id: 'role', styleRefs: { typography: pinned } }],
			},
			resolveGraphicStyleSet(entries()),
		)];

		const next = editCompositorStack(
			state({ graphics, styleSet: styleSet() }),
			{ kind: 'bind-style-ref', slot: 'typography', entryId: 'heading' },
		);

		expect(typographyRefOf(next)).toEqual({ entryId: 'heading' });
		expect(next?.[0]?.items[1]?.styleRefs?.typography).toEqual(pinned);
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

describe('a panel editing through the module', () => {
	it('commits each admitted edit, starting from the stack the panel shows now', () => {
		const current = ref(state());
		const committed: BroadcastGraphicConfig[][] = [];
		const { editItem } = useCompositorEditing(current, graphics => committed.push(graphics));

		editItem(patchGraphicTypography, { fontSize: 30 });
		current.value = { ...current.value, graphics: committed[0]! };
		editItem(patchGraphicItem, { label: 'Talent' });

		expect(committed).toHaveLength(2);
		expect(fontSizeOf(committed[1]!)).toBe(30);
		expect(committed[1]![0]!.items[0]!.label).toBe('Talent');
	});

	it('says whether it committed, so a panel moves the selection only after an admitted edit', () => {
		const writable = ref(true);
		const committed: BroadcastGraphicConfig[][] = [];
		const { edit } = useCompositorEditing(() => state({ writable: writable.value }), graphics => committed.push(graphics));
		const remove: CompositorEdit = { kind: 'stack', apply: graphics => graphics.filter(graphic => graphic.id !== 'bug') };

		expect(edit(remove)).toBe(true);
		writable.value = false;
		expect(edit(remove)).toBe(false);
		expect(committed).toHaveLength(1);
	});

	it('commits nothing for a refused edit', () => {
		const committed: BroadcastGraphicConfig[][] = [];
		const editing = useCompositorEditing(() => state({ writable: false }), graphics => committed.push(graphics));

		editing.editItem(patchGraphicTypography, { fontSize: 30 });
		editing.editGraphic(patchBroadcastGraphic, { name: 'Talent' });
		editing.unbindStyleRef('typography');

		expect(editing.canAuthor.value).toBe(false);
		expect(committed).toEqual([]);
	});
});

/**
 * #598: no compositor panel checks the Graphics Authoring Lease or replaces the stack
 * itself. A source scan, because what it guards against is a panel quietly growing a
 * second path to `update:graphics`: that path would work, so no behaviour test of the
 * panel would notice it skipping the lease guard or the re-capture.
 *
 * A panel is any compositor component that emits `update:graphics`. Its script may
 * emit it in one place only, the commit it hands `useCompositorEditing`; its template
 * may forward a child panel's commit unchanged.
 */
describe('every compositor panel', () => {
	const directory = fileURLToPath(new URL('../../../../app/components/Graphics/Compositor', import.meta.url));
	const panels = readdirSync(directory)
		.filter(name => name.endsWith('.vue'))
		.map(name => ({ name, source: readFileSync(join(directory, name), 'utf8') }))
		.filter(({ source }) => source.includes('\'update:graphics\''))
		.map(({ name, source }) => ({ name, script: source.slice(0, source.indexOf('</script>')) }));

	const COMMIT = /emit\('update:graphics'/g;
	const COMMIT_HANDED_TO_THE_MODULE = /useCompositorEditing\(\s*\(\) => props,\s*graphics => emit\('update:graphics', graphics\),\s*\)/;

	it('has every panel to scan', () => {
		expect(panels.map(panel => panel.name).sort()).toEqual([
			'Animation.vue',
			'Bindings.vue',
			'Inspector.vue',
			'SocialProfileProjections.vue',
			'StackTree.vue',
		]);
	});

	it('commits the stack only through the compositor editing module', () => {
		const offenders = panels
			.filter(({ script }) => script.match(COMMIT)?.length !== 1 || !COMMIT_HANDED_TO_THE_MODULE.test(script))
			.map(panel => panel.name);

		expect(offenders, 'emit update:graphics only as the commit handed to useCompositorEditing').toEqual([]);
	});

	it('neither checks the lease nor replaces a Broadcast Graphic in the stack itself', () => {
		const offenders = panels
			.filter(({ script }) => /writable\s*===\s*true/.test(script) || /\breplaceBroadcastGraphic\b/.test(script))
			.map(panel => panel.name);

		expect(offenders, 'the lease guard and the stack replacement belong to the compositor editing module').toEqual([]);
	});
});
