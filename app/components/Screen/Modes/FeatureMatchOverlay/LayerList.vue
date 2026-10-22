<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui';
import type { GraphicItemConfig, GraphicItemKind } from '~~/shared/types/graphics';
import type { FeatureMatchLayoutConfig } from '~~/shared/types/screenConfig';
import type { FeatureMatchLayoutEditor } from '~/composables/screen/useFeatureMatchLayoutEditor';
import type { FeatureMatchLayoutEditorSelection } from '~/modules/feature-match-overlay/editorSelection';
import { FEATURE_MATCH_SOURCE_ITEM_ICON } from '~~/shared/featureMatchSourceItems';
import {
	FEATURE_MATCH_OVERLAY_HOST_CONTRACT,
	graphicGroupChildDefinitionsForHost,
	graphicItemDefinitionsForHost,
	graphicItemIcon,
	graphicItemKindLabel,
} from '~~/shared/modules/graphics';
import { editorSelectionKey } from '~/modules/feature-match-overlay/editorSelection';

/**
 * The Feature Match Layout's one layer list: every Graphic Item, every Source
 * Item, and the canvas, front to back — the order they composite in.
 *
 * The composition is mounted above the Frame and the Source Items as one layer,
 * so Graphic Items always sit in front of Source Items and the canvas is always
 * at the back. Each section reorders within itself; nothing here offers to move a
 * Source Item in front of a Graphic Item, because nothing renders one there.
 *
 * Front at the top, so the arrow pointing up moves a layer toward the front.
 */
const props = defineProps<{
	layout: FeatureMatchLayoutConfig;
	editor: FeatureMatchLayoutEditor;
	canvasWidth: number;
	canvasHeight: number;
}>();

interface LayerRow {
	key: string;
	target: FeatureMatchLayoutEditorSelection;
	label: string;
	kind: string;
	icon: string;
	depth: 0 | 1;
	visible: boolean;
	canMoveForward: boolean;
	canMoveBackward: boolean;
}

function itemRow(item: GraphicItemConfig, index: number, siblingCount: number, depth: 0 | 1): LayerRow {
	const target: FeatureMatchLayoutEditorSelection = { type: 'item', itemId: item.id };
	return {
		key: editorSelectionKey(target),
		target,
		label: item.label,
		kind: graphicItemKindLabel(item.type),
		icon: graphicItemIcon(item.type),
		depth,
		visible: item.visible !== false,
		canMoveForward: index < siblingCount - 1,
		canMoveBackward: index > 0,
	};
}

/** Front to back: the last-composited item first, each group's children beneath it. */
const itemRows = computed<LayerRow[]>(() => {
	const items = props.layout.composition.items;
	const rows: LayerRow[] = [];
	for (let index = items.length - 1; index >= 0; index -= 1) {
		const item = items[index]!;
		rows.push(itemRow(item, index, items.length, 0));
		if (item.type !== 'group')
			continue;
		for (let childIndex = item.children.length - 1; childIndex >= 0; childIndex -= 1)
			rows.push(itemRow(item.children[childIndex] as GraphicItemConfig, childIndex, item.children.length, 1));
	}
	return rows;
});

const sourceRows = computed<LayerRow[]>(() => {
	const sources = props.layout.sources;
	return sources.map((item, index) => {
		const target: FeatureMatchLayoutEditorSelection = { type: 'source', itemId: item.id };
		return {
			key: editorSelectionKey(target),
			target,
			label: item.label,
			kind: 'Source',
			icon: FEATURE_MATCH_SOURCE_ITEM_ICON,
			depth: 0 as const,
			visible: item.visible !== false,
			canMoveForward: index < sources.length - 1,
			canMoveBackward: index > 0,
		};
	}).reverse();
});

const sections = computed(() => [
	{ title: 'Graphic Items', rows: itemRows.value, empty: 'No Graphic Items yet' },
	{ title: 'Sources', rows: sourceRows.value, empty: 'No Source Items yet' },
]);

const selectedKey = computed(() => editorSelectionKey(props.editor.selection.value));

/* ── Add menu ─────────────────────────────────── */

const addMenu = computed<DropdownMenuItem[][]>(() => {
	const items: DropdownMenuItem[][] = [
		graphicItemDefinitionsForHost(FEATURE_MATCH_OVERLAY_HOST_CONTRACT).map(definition => ({
			label: definition.label,
			icon: definition.icon,
			onSelect: () => props.editor.addItem(definition.kind),
		})),
		[{
			label: 'Source Item',
			icon: FEATURE_MATCH_SOURCE_ITEM_ICON,
			onSelect: () => props.editor.addSource(),
		}],
	];
	const group = props.editor.selectedGroup.value;
	if (group) {
		items.push([
			{ type: 'label', label: `Add to ${group.label}` },
			...graphicGroupChildDefinitionsForHost(FEATURE_MATCH_OVERLAY_HOST_CONTRACT).map(definition => ({
				label: definition.label,
				icon: definition.icon,
				onSelect: () => props.editor.addGroupChild(definition.kind as Exclude<GraphicItemKind, 'group'>),
			})),
		]);
	}
	return items;
});

function rowMenu(row: LayerRow): DropdownMenuItem[][] {
	return [
		[
			{ label: 'Duplicate', icon: 'i-lucide-copy', kbds: ['meta', 'd'], onSelect: () => props.editor.duplicate(row.target) },
		],
		[
			{ label: 'Bring to front', icon: 'i-lucide-bring-to-front', disabled: !row.canMoveForward, onSelect: () => props.editor.moveToEdge(row.target, 'front') },
			{ label: 'Send to back', icon: 'i-lucide-send-to-back', disabled: !row.canMoveBackward, onSelect: () => props.editor.moveToEdge(row.target, 'back') },
		],
		[
			{ label: 'Delete', icon: 'i-lucide-trash-2', color: 'error', kbds: ['delete'], onSelect: () => props.editor.remove(row.target) },
		],
	];
}

/* ── Keeping the selection in view ─────────────── */

const rowElements = new Map<string, HTMLElement>();

function setRowElement(key: string, element: unknown) {
	if (element instanceof HTMLElement)
		rowElements.set(key, element);
	else
		rowElements.delete(key);
}

/**
 * Scroll the selected row into view within the list's own scroller only.
 *
 * Not `scrollIntoView`, which scrolls every scrollable ancestor — the page
 * included — and so moved the whole editor whenever something was selected.
 */
function revealSelectedRow() {
	const row = rowElements.get(selectedKey.value);
	if (!row)
		return;
	let scroller = row.parentElement;
	while (scroller && scroller !== document.body) {
		const overflow = getComputedStyle(scroller).overflowY;
		if ((overflow === 'auto' || overflow === 'scroll') && scroller.scrollHeight > scroller.clientHeight)
			break;
		scroller = scroller.parentElement;
	}
	if (!scroller || scroller === document.body)
		return;
	const rowBox = row.getBoundingClientRect();
	const scrollerBox = scroller.getBoundingClientRect();
	if (rowBox.top < scrollerBox.top)
		scroller.scrollTop -= scrollerBox.top - rowBox.top + 8;
	else if (rowBox.bottom > scrollerBox.bottom)
		scroller.scrollTop += rowBox.bottom - scrollerBox.bottom + 8;
}

watch(selectedKey, () => {
	void nextTick(revealSelectedRow);
});
</script>

<template>
	<div class="space-y-3" data-testid="feature-match-layer-list">
		<div class="flex items-center justify-between gap-2">
			<div>
				<p class="text-sm font-semibold">
					Layers
				</p>
				<p class="text-xs text-muted">
					Front at the top
				</p>
			</div>
			<UDropdownMenu :items="addMenu" :content="{ align: 'end' }">
				<UButton
					size="sm"
					variant="soft"
					icon="i-lucide-plus"
					trailing-icon="i-lucide-chevron-down"
					data-testid="layer-add"
				>
					Add
				</UButton>
			</UDropdownMenu>
		</div>

		<template v-for="section in sections" :key="section.title">
			<div class="space-y-0.5">
				<p class="px-1 text-[0.6875rem] font-medium uppercase tracking-wide text-dimmed">
					{{ section.title }}
				</p>
				<p v-if="section.rows.length === 0" class="px-2 py-1.5 text-xs text-muted">
					{{ section.empty }}
				</p>
				<div
					v-for="row in section.rows"
					:key="row.key"
					:ref="element => setRowElement(row.key, element)"
					class="group flex items-center gap-1 rounded-md border pr-1 transition"
					:class="[
						row.key === selectedKey ? 'border-primary/60 bg-primary/10' : 'border-transparent hover:bg-elevated/60',
						row.depth === 1 ? 'ml-4' : '',
						row.visible ? '' : 'opacity-60',
					]"
					:data-layer-key="row.key"
					data-testid="layer-row"
				>
					<button
						type="button"
						class="flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-2 text-left"
						:title="`${row.label} · ${row.kind}`"
						:aria-current="row.key === selectedKey ? 'true' : undefined"
						data-testid="layer-select"
						@click="editor.select(row.target)"
					>
						<UIcon :name="row.icon" class="size-4 shrink-0 text-muted" />
						<span class="min-w-0 flex-1 truncate text-sm">{{ row.label }}</span>
					</button>
					<div
						class="shrink-0 items-center"
						:class="row.key === selectedKey ? 'flex' : 'hidden group-hover:flex group-focus-within:flex'"
					>
						<UButton
							size="xs"
							variant="ghost"
							color="neutral"
							icon="i-lucide-arrow-up"
							:disabled="!row.canMoveForward"
							:aria-label="`Move ${row.label} forward`"
							data-testid="layer-forward"
							@click="editor.move(row.target, 1)"
						/>
						<UButton
							size="xs"
							variant="ghost"
							color="neutral"
							icon="i-lucide-arrow-down"
							:disabled="!row.canMoveBackward"
							:aria-label="`Move ${row.label} backward`"
							data-testid="layer-backward"
							@click="editor.move(row.target, -1)"
						/>
						<UDropdownMenu :items="rowMenu(row)" :content="{ align: 'end' }">
							<UButton
								size="xs"
								variant="ghost"
								color="neutral"
								icon="i-lucide-ellipsis"
								:aria-label="`More actions for ${row.label}`"
								data-testid="layer-more"
							/>
						</UDropdownMenu>
					</div>
					<UButton
						size="xs"
						variant="ghost"
						color="neutral"
						:icon="row.visible ? 'i-lucide-eye' : 'i-lucide-eye-off'"
						:aria-label="row.visible ? `Hide ${row.label}` : `Show ${row.label}`"
						:aria-pressed="!row.visible"
						data-testid="layer-visibility"
						@click="editor.toggleVisible(row.target)"
					/>
				</div>
			</div>
		</template>

		<div class="space-y-0.5">
			<p class="px-1 text-[0.6875rem] font-medium uppercase tracking-wide text-dimmed">
				Background
			</p>
			<button
				:ref="element => setRowElement('canvas', element)"
				type="button"
				class="flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left transition"
				:class="selectedKey === 'canvas' ? 'border-primary/60 bg-primary/10' : 'border-transparent hover:bg-elevated/60'"
				:aria-current="selectedKey === 'canvas' ? 'true' : undefined"
				data-testid="layer-canvas"
				@click="editor.select({ type: 'canvas' })"
			>
				<UIcon name="i-lucide-panels-top-left" class="size-4 shrink-0 text-muted" />
				<span class="min-w-0 flex-1 truncate text-sm">Canvas</span>
				<span class="shrink-0 text-[0.6875rem] text-dimmed">{{ canvasWidth }}×{{ canvasHeight }}</span>
			</button>
		</div>
	</div>
</template>
