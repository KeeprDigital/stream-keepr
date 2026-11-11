<script setup lang="ts" generic="D, L extends GraphicsEditorLayer">
import type { DropdownMenuItem } from '@nuxt/ui';
import type { GraphicItemPlacementRefusal } from '~~/shared/modules/graphics';
import type { GraphicItemKind } from '~~/shared/types/graphics';
import type { GraphicsEditor } from '~/composables/useGraphicsEditor';
import type { GraphicsEditorLayer, GraphicsEditorTree, GraphicsLayerListSection } from '~/modules/graphics/editor/host';
import type { LayerDrop } from '~/modules/graphics/editor/layerDrag';
import {
	graphicGroupChildDefinitionsForHost,
	graphicItemDefinitionsForHost,
	graphicItemIcon,
	graphicItemKindLabel,
} from '~~/shared/modules/graphics';
import { layerConfig, layerItemLocation } from '~/modules/graphics/editor/host';
import { layerDropAt, layerGroupMoves } from '~/modules/graphics/editor/layerDrag';
import { LAYER_GROUP_REFUSAL_REASONS } from '~/modules/graphics/editor/layerGrouping';
import { isLayerSelected } from '~/modules/graphics/editor/layerSelection';
import { isSelectionToggle } from '~/modules/graphics/selection';

/**
 * The shared graphics editor's one layer list (#1100), for every host: the layers
 * of each section, front to back, each Graphic Group's children beneath it, then
 * the canvas. A host names its sections: the Feature Match Overlay's Graphic
 * Items and Source Items, or one per Broadcast Graphic, whose own row the host
 * draws in the `section` slot.
 *
 * Each section reorders within itself; nothing here moves a layer from one
 * section to another. Front at the top, so "Bring forward" moves a row up.
 *
 * Shift-click selects the run of rows from the one chosen last, and ⌘- or
 * Ctrl-click adds or takes out one row (#740). A selected row's menu duplicates
 * and deletes every selected layer; its moves move its own. Its eye and lock act
 * on every selected layer. A locked row keeps its lock in view as its badge
 * (#747).
 *
 * Each action is offered once (#1069): a row reorders by drag, its menu and
 * ⌘] / ⌘[, and duplicates, removes, hides and locks here, not in the property
 * panel, which is the one place that aligns.
 *
 * One row drags at a time, and is selected alone as it goes: within its section,
 * into a Graphic Group or out of one, as one undo step; Escape cancels, and a
 * drop that is refused says why (#741). The row menu's moves and "Move to
 * group" do the same from the keyboard. A locked row drags too: a lock keeps a
 * layer from canvas edits only.
 *
 * A selected row among several groups the selection, or says why it cannot, and
 * a group's row ungroups it, as ⌘G and ⌘⇧G do (#920).
 *
 * Without the Graphics Authoring Lease the list still selects, and offers no
 * edit at all (#738); nor does a row whose layer the host forbids now, such as
 * one of a Broadcast Graphic on air.
 */
const props = defineProps<{
	editor: GraphicsEditor<D, L>;
	tree: GraphicsEditorTree<D, L>;
	document: D;
	sections: readonly GraphicsLayerListSection<L>[];
	canvasWidth: number;
	canvasHeight: number;
	/** What the host adds besides Graphic Items, such as a Broadcast Graphic. */
	hostAddItems?: DropdownMenuItem[];
	/** Whether something the host selects itself is, such as a Broadcast Graphic, so the canvas is not. */
	hostSelected?: boolean;
}>();

const emit = defineEmits<{
	/** The canvas row was chosen: no layer selected. */
	selectCanvas: [];
}>();

defineSlots<{
	/** A section's own row; its title by default. */
	section?: (props: { section: GraphicsLayerListSection<L> }) => unknown;
}>();

interface LayerRow {
	key: string;
	target: L;
	label: string;
	kind: string;
	icon: string;
	depth: 0 | 1;
	visible: boolean;
	isGroup: boolean;
	canMoveForward: boolean;
	canMoveBackward: boolean;
}

function layerRow(layer: L): LayerRow | null {
	const config = layerConfig(props.tree, props.document, layer);
	if (!config)
		return null;
	const location = layerItemLocation(props.tree, props.document, layer);
	const siblings = location
		? (location.group?.children ?? location.composition.items).map(item => item.id)
		: props.tree.owned?.siblings(props.document, layer).map(sibling => props.tree.key(sibling)) ?? [];
	const index = siblings.indexOf(location
		? location.item.id
		: props.tree.key(layer));
	return {
		key: props.tree.key(layer),
		target: layer,
		label: config.label,
		kind: location
			? graphicItemKindLabel(location.item.type)
			: props.tree.owned?.label ?? '',
		icon: location
			? graphicItemIcon(location.item.type)
			: props.tree.owned?.icon ?? 'i-lucide-square',
		depth: location?.group
			? 1
			: 0,
		visible: config.visible !== false,
		isGroup: location?.item.type === 'group',
		canMoveForward: index >= 0 && index < siblings.length - 1,
		canMoveBackward: index > 0,
	};
}

const sectionRows = computed(() => props.sections.map(section => ({
	section,
	rows: section.layers.flatMap((layer) => {
		const row = layerRow(layer);
		return row
			? [row]
			: [];
	}),
})));

const allRows = computed(() => sectionRows.value.flatMap(({ rows }) => rows));

const writable = computed(() => props.editor.writable.value);
const severalSelected = computed(() => props.editor.layers.value.length > 1);
const canvasSelected = computed(() => props.editor.layers.value.length === 0 && !props.hostSelected);

/** Whether this session may edit a row now: it holds the lease, and the host does not forbid the layer. */
function editable(row: LayerRow) {
	return writable.value && props.editor.mayEdit(row.target);
}

function isSelected(row: LayerRow) {
	return isLayerSelected(props.tree, props.editor.layers.value, row.target);
}

/** The one selected layer's key, or none with none or several. */
const selectedKey = computed(() => props.editor.layers.value.length === 1
	? props.tree.key(props.editor.layers.value[0]!)
	: null);

/** A plain click selects the row alone; Shift selects a run, and ⌘ or Ctrl adds or takes out one. */
function clickRow(event: MouseEvent, row: LayerRow) {
	if (isSelectionToggle(event))
		props.editor.toggleSelect(row.target);
	else if (event.shiftKey)
		props.editor.extendSelect(row.target);
	else
		props.editor.select(row.target);
}

function selectCanvas() {
	props.editor.select({ type: 'canvas' });
	emit('selectCanvas');
}

/* ── Add menu ─────────────────────────────────── */

const addMenu = computed<DropdownMenuItem[][]>(() => {
	const items: DropdownMenuItem[][] = [];
	if (props.editor.canAddItem()) {
		items.push(graphicItemDefinitionsForHost(props.tree.host).map(definition => ({
			label: definition.label,
			icon: definition.icon,
			onSelect: () => props.editor.addItem(definition.kind),
		})));
	}
	const owned = props.tree.owned;
	const extras: DropdownMenuItem[] = [
		...(owned
			? [
					{
						label: owned.label,
						icon: owned.icon,
						onSelect: () => props.editor.addHostLayer(),
					},
				]
			: []),
		...(props.hostAddItems ?? []),
	];
	if (extras.length > 0)
		items.push(extras);
	const group = props.editor.selectedGroup.value;
	const current = props.editor.selection.value;
	if (group && current.type !== 'canvas' && props.editor.mayEdit(current as L)) {
		items.push([
			{ type: 'label', label: `Add to ${group.label}` },
			...graphicGroupChildDefinitionsForHost(props.tree.host).map(definition => ({
				label: definition.label,
				icon: definition.icon,
				onSelect: () => props.editor.addGroupChild(definition.kind as Exclude<GraphicItemKind, 'group'>),
			})),
		]);
	}
	return items;
});

/**
 * What a row's own controls act on: a selected row among several speaks for the
 * whole selection, as the keyboard does, and any other row for itself.
 */
function rowTarget(row: LayerRow): L | undefined {
	return severalSelected.value && isSelected(row)
		? undefined
		: row.target;
}

const REFUSALS: Record<GraphicItemPlacementRefusal, string> = {
	'rotated-into-arranged-group': 'A rotated layer can\'t go into a row or column group',
	'group-into-group': 'A group can\'t go into another group',
	'not-a-group': 'Only a group takes layers in',
};

/** "Move to group": the keyboard's way into or out of a Graphic Group (#741). */
function moveToGroupMenu(row: LayerRow): DropdownMenuItem[][] {
	const moves = layerGroupMoves(props.tree, props.document, row.target);
	if (moves.length === 0)
		return [];
	return [
		[
			{
				label: 'Move to group',
				icon: 'i-lucide-folder-input',
				children: moves.map(move => ({
					label: move.label,
					disabled: move.refusal !== null,
					description: move.refusal
						? REFUSALS[move.refusal]
						: undefined,
					onSelect: () => props.editor.place(row.target, move.place),
				})),
			},
		],
	];
}

/** Group a selected row's selection, or ungroup a group's row (#920). */
function groupingMenu(row: LayerRow): DropdownMenuItem[] {
	if (severalSelected.value && isSelected(row)) {
		const refusal = props.editor.groupRefusal.value;
		return [
			{
				label: 'Group selection',
				icon: 'i-lucide-group',
				kbds: ['meta', 'g'],
				disabled: refusal !== null,
				description: refusal
					? LAYER_GROUP_REFUSAL_REASONS[refusal]
					: undefined,
				onSelect: () => props.editor.group(),
			},
		];
	}
	return row.isGroup && row.depth === 0
		? [
				{
					label: 'Ungroup',
					icon: 'i-lucide-ungroup',
					kbds: ['meta', 'shift', 'g'],
					onSelect: () => props.editor.ungroup(row.target),
				},
			]
		: [];
}

function rowMenu(row: LayerRow): DropdownMenuItem[][] {
	const target = rowTarget(row);
	const removal = props.editor.removalRefusal(row.target);
	return [
		[
			{
				label: 'Duplicate',
				icon: 'i-lucide-copy',
				kbds: ['meta', 'd'],
				onSelect: () => props.editor.duplicate(target),
			},
			...groupingMenu(row),
		],
		[
			{
				label: 'Bring forward',
				icon: 'i-lucide-arrow-up',
				kbds: ['meta', ']'],
				disabled: !row.canMoveForward,
				onSelect: () => props.editor.move(row.target, 1),
			},
			{
				label: 'Send backward',
				icon: 'i-lucide-arrow-down',
				kbds: ['meta', '['],
				disabled: !row.canMoveBackward,
				onSelect: () => props.editor.move(row.target, -1),
			},
			{
				label: 'Bring to front',
				icon: 'i-lucide-bring-to-front',
				disabled: !row.canMoveForward,
				onSelect: () => props.editor.moveToEdge(row.target, 'front'),
			},
			{
				label: 'Send to back',
				icon: 'i-lucide-send-to-back',
				disabled: !row.canMoveBackward,
				onSelect: () => props.editor.moveToEdge(row.target, 'back'),
			},
		],
		...moveToGroupMenu(row),
		[
			{
				label: 'Delete',
				icon: 'i-lucide-trash-2',
				color: 'error',
				kbds: ['delete'],
				disabled: removal !== null,
				description: removal ?? undefined,
				onSelect: () => props.editor.remove(target),
			},
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

/** The row chosen last, or the canvas with none. */
const revealKey = computed(() => {
	const anchor = props.editor.anchor.value;
	return anchor
		? props.tree.key(anchor)
		: 'canvas';
});

/**
 * Scroll the selected row into view within the list's own scroller only.
 *
 * Not `scrollIntoView`, which scrolls every scrollable ancestor — the page
 * included — and so moved the whole editor whenever something was selected.
 */
function revealSelectedRow() {
	const row = rowElements.get(revealKey.value);
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

watch(revealKey, () => {
	void nextTick(revealSelectedRow);
});

/* ── Renaming in place ─────────────────────────── */

/** The row whose name is an input, and the name typed into it so far. */
const renaming = shallowRef<LayerRow | null>(null);
const draft = ref('');
let renameInput: HTMLInputElement | null = null;

function setRenameInput(element: unknown) {
	renameInput = element instanceof HTMLInputElement
		? element
		: null;
}

function startRename(row: LayerRow) {
	props.editor.select(row.target);
	if (!editable(row))
		return;
	renaming.value = row;
	draft.value = row.label;
	void nextTick(() => {
		renameInput?.focus();
		renameInput?.select();
	});
}

/** End the rename, the row a button again. Answers the row it ended, if any. */
function endRename(): LayerRow | null {
	const row = renaming.value;
	renaming.value = null;
	return row;
}

function refocusRow(row: LayerRow) {
	void nextTick(() => {
		rowElements.get(row.key)?.querySelector<HTMLElement>('[data-testid="layer-select"]')?.focus();
	});
}

/**
 * Write the typed name. After Enter focus goes back to the row; after a blur it
 * stays wherever the author went.
 */
function commitRename(options: { refocus: boolean }) {
	const row = endRename();
	if (!row)
		return;
	props.editor.rename(row.target, draft.value);
	if (options.refocus)
		refocusRow(row);
}

function cancelRename() {
	const row = endRename();
	if (row)
		refocusRow(row);
}

const rowKeys = computed(() => allRows.value.map(row => row.key));

/** A row that leaves the list mid-rename takes its rename with it. */
watch(rowKeys, (keys) => {
	if (renaming.value && !keys.includes(renaming.value.key))
		endRename();
});

/**
 * Rows are buttons, so Enter selects; Enter on the row already selected, or F2,
 * renames it. A held Enter repeats, and its repeats are not a second press.
 */
function rowKeydown(event: KeyboardEvent, row: LayerRow) {
	if (event.repeat)
		return;
	if (event.key === 'F2' || (event.key === 'Enter' && row.key === selectedKey.value)) {
		event.preventDefault();
		startRename(row);
	}
}

/**
 * Every key typed into the name stays there. The editor's canvas shortcuts
 * already pass over a key typed into an input, so this is belt and braces:
 * Escape here must cancel the rename, never also select the canvas.
 *
 * The Enter that confirms an input method's composition is not the author's.
 */
function renameKeydown(event: KeyboardEvent) {
	event.stopPropagation();
	if (event.isComposing)
		return;
	if (event.key === 'Enter') {
		event.preventDefault();
		commitRename({ refocus: true });
	}
	else if (event.key === 'Escape') {
		event.preventDefault();
		cancelRename();
	}
}

/* ── Dragging a row (#741) ─────────────────────── */

const LAYER_DRAG_TYPE = 'application/x-stream-keepr-layer';

/** The row being dragged, alone: v1 drags a single row. */
const dragged = shallowRef<LayerRow | null>(null);
/** Where the row would land, as the last dragover found it. */
const drop = shallowRef<LayerDrop<L> | null>(null);

function startDrag(event: DragEvent, row: LayerRow) {
	if (!editable(row) || renaming.value?.key === row.key) {
		event.preventDefault();
		return;
	}
	dragged.value = row;
	props.editor.select(row.target);
	if (event.dataTransfer) {
		event.dataTransfer.effectAllowed = 'move';
		// A type of its own, so a release over a text field types nothing into it.
		event.dataTransfer.setData(LAYER_DRAG_TYPE, row.key);
	}
}

/** Only a drop that can land is accepted, so a refused one shows the browser's no-drop cursor. */
function dragOver(event: DragEvent, row: LayerRow) {
	const from = dragged.value;
	if (!from)
		return;
	const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
	const fraction = box.height > 0
		? (event.clientY - box.top) / box.height
		: 0;
	drop.value = layerDropAt(props.tree, props.document, from.target, row.target, fraction);
	if (drop.value && !drop.value.refusal) {
		event.preventDefault();
		if (event.dataTransfer)
			event.dataTransfer.dropEffect = 'move';
	}
}

/** Escape, or a drop anywhere else, ends the drag with a dragend and no drop. */
function endDrag() {
	dragged.value = null;
	drop.value = null;
}

/** A row that leaves the list mid-drag fires no dragend, so its drag ends here. */
watch(rowKeys, (keys) => {
	if (dragged.value && !keys.includes(dragged.value.key))
		endDrag();
});

/** The gaps between rows keep the drop the last row showed, so releasing there lands it. */
function dragOverSection(event: DragEvent) {
	if (dragged.value && drop.value && !drop.value.refusal)
		event.preventDefault();
}

function dropOn(event: DragEvent) {
	const from = dragged.value;
	const landing = drop.value;
	endDrag();
	if (!from || !landing || landing.refusal)
		return;
	event.preventDefault();
	props.editor.place(from.target, landing.place);
}

/** Leaving the list for somewhere else hides the indicator. */
function leaveList(event: DragEvent) {
	const into = event.relatedTarget;
	if (!(into instanceof Node) || !(event.currentTarget as HTMLElement).contains(into))
		drop.value = null;
}

const dropRefusal = computed(() => drop.value?.refusal
	? REFUSALS[drop.value.refusal]
	: null);

/**
 * The drop indicator a row shows: a line at an edge, a ring round a group taking
 * the layer in, and a line reaching out to the group's own indent below its last
 * child. Red where the drop is refused. Whole class names, for Tailwind to find.
 */
const DROP_INDICATOR_CLASSES: Record<LayerDrop<L>['edge'], { open: string; refused: string }> = {
	'top': {
		open: 'shadow-[inset_0_2px_0_var(--ui-primary)]',
		refused: 'shadow-[inset_0_2px_0_var(--ui-error)]',
	},
	'bottom': {
		open: 'shadow-[inset_0_-2px_0_var(--ui-primary)]',
		refused: 'shadow-[inset_0_-2px_0_var(--ui-error)]',
	},
	'below-group': {
		open: 'relative after:absolute after:-left-4 after:right-0 after:bottom-0 after:h-0.5 after:bg-primary',
		refused: 'relative after:absolute after:-left-4 after:right-0 after:bottom-0 after:h-0.5 after:bg-error',
	},
	'inside': {
		open: 'ring-2 ring-primary',
		refused: 'ring-2 ring-error',
	},
};

function dropIndicatorClass(row: LayerRow) {
	const landing = drop.value;
	if (landing?.row !== row.key)
		return '';
	const classes = DROP_INDICATOR_CLASSES[landing.edge];
	return landing.refusal
		? classes.refused
		: classes.open;
}
</script>

<template>
	<div class="relative space-y-3" data-testid="layer-list" @dragleave="leaveList">
		<div class="flex items-center justify-between gap-2">
			<div>
				<p class="text-sm font-semibold">
					Layers
				</p>
				<p class="text-xs text-muted">
					Front at the top
				</p>
			</div>
			<UDropdownMenu :items="writable ? addMenu : []" :content="{ align: 'end' }">
				<UButton
					size="sm"
					variant="soft"
					icon="i-lucide-plus"
					trailing-icon="i-lucide-chevron-down"
					:disabled="!writable"
					data-testid="layer-add"
				>
					Add
				</UButton>
			</UDropdownMenu>
		</div>

		<!-- Over the header, taking no space, so it never moves the rows under the pointer. -->
		<p
			v-if="dropRefusal"
			role="status"
			class="pointer-events-none absolute inset-x-0 top-0 z-10 rounded-md bg-default px-2 py-1 text-xs text-error ring-1 ring-error/50"
			data-testid="layer-drop-refusal"
		>
			{{ dropRefusal }}
		</p>

		<template v-for="{ section, rows } in sectionRows" :key="section.key">
			<div class="space-y-0.5" :data-layer-section="section.key">
				<div :id="`layer-section-${section.key}`">
					<slot name="section" :section="section">
						<p class="px-1 text-[0.6875rem] font-medium uppercase tracking-wide text-dimmed">
							{{ section.title }}
						</p>
					</slot>
				</div>
				<p v-if="rows.length === 0" class="px-2 py-1.5 text-xs text-muted">
					{{ section.empty }}
				</p>
				<!-- A grid, so each row can say whether it is selected while holding its own controls. -->
				<div
					v-else
					role="grid"
					aria-multiselectable="true"
					:aria-labelledby="`layer-section-${section.key}`"
					class="space-y-0.5"
					@dragover="dragOverSection"
					@drop="dropOn"
				>
					<div
						v-for="row in rows"
						:key="row.key"
						:ref="element => setRowElement(row.key, element)"
						role="row"
						:aria-selected="isSelected(row)"
						class="group flex items-center gap-1 rounded-md border pr-1 transition"
						:class="[
							isSelected(row) ? 'border-primary/60 bg-primary/10' : 'border-transparent hover:bg-elevated/60',
							row.depth === 1 ? 'ml-4' : '',
							row.visible && dragged?.key !== row.key ? '' : 'opacity-60',
							dropIndicatorClass(row),
						]"
						:draggable="editable(row) && renaming?.key !== row.key"
						:data-dragging="dragged?.key === row.key || undefined"
						:data-drop-edge="drop?.row === row.key ? drop.edge : undefined"
						:data-drop-refused="drop?.row === row.key && drop.refusal ? true : undefined"
						:data-layer-key="row.key"
						:data-layer-depth="row.depth"
						data-testid="layer-row"
						@dragstart="startDrag($event, row)"
						@dragover="dragOver($event, row)"
						@dragend="endDrag"
					>
						<div role="gridcell" class="flex min-w-0 flex-1">
							<div
								v-if="renaming?.key === row.key"
								class="flex min-w-0 flex-1 items-center gap-2 py-1 pl-2"
							>
								<UIcon :name="row.icon" class="size-4 shrink-0 text-muted" />
								<input
									:ref="setRenameInput"
									v-model="draft"
									type="text"
									class="min-w-0 flex-1 rounded-sm bg-default px-1 py-0.5 text-sm outline-none ring-1 ring-primary"
									:aria-label="`Rename ${row.label}`"
									data-testid="layer-rename"
									@keydown="renameKeydown"
									@blur="commitRename({ refocus: false })"
								>
							</div>
							<button
								v-else
								type="button"
								class="flex min-w-0 flex-1 select-none items-center gap-2 py-1.5 pl-2 text-left"
								:title="editable(row) ? `${row.label} · ${row.kind} — double-click or F2 to rename` : `${row.label} · ${row.kind}`"
								data-testid="layer-select"
								@click="clickRow($event, row)"
								@dblclick="startRename(row)"
								@keydown="rowKeydown($event, row)"
							>
								<UIcon :name="row.icon" class="size-4 shrink-0 text-muted" />
								<span class="min-w-0 flex-1 truncate text-sm">{{ row.label }}</span>
							</button>
						</div>
						<div
							v-if="editable(row)"
							role="gridcell"
							class="shrink-0 items-center"
							:class="isSelected(row) ? 'flex' : 'hidden group-hover:flex group-focus-within:flex'"
						>
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
						<div
							role="gridcell"
							class="shrink-0"
							:class="editor.isLocked(row.target) || (editable(row) && isSelected(row)) ? 'flex' : 'hidden group-hover:flex group-focus-within:flex'"
						>
							<UButton
								size="xs"
								variant="ghost"
								:color="editor.isLocked(row.target) ? 'primary' : 'neutral'"
								:icon="editor.isLocked(row.target) ? 'i-lucide-lock' : 'i-lucide-lock-open'"
								:aria-label="`Lock ${row.label}`"
								:aria-pressed="editor.isLocked(row.target)"
								:disabled="!editable(row) || editor.isLockedByItsGroup(row.target)"
								:title="editor.isLockedByItsGroup(row.target) ? 'Locked with its group' : undefined"
								data-testid="layer-lock"
								@click="editor.toggleLock(rowTarget(row))"
							/>
						</div>
						<div role="gridcell" class="shrink-0">
							<UButton
								size="xs"
								variant="ghost"
								color="neutral"
								:icon="row.visible ? 'i-lucide-eye' : 'i-lucide-eye-off'"
								:aria-label="row.visible ? `Hide ${row.label}` : `Show ${row.label}`"
								:aria-pressed="!row.visible"
								:disabled="!editable(row)"
								data-testid="layer-visibility"
								@click="editor.toggleVisible(rowTarget(row))"
							/>
						</div>
					</div>
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
				:class="canvasSelected ? 'border-primary/60 bg-primary/10' : 'border-transparent hover:bg-elevated/60'"
				:aria-current="canvasSelected ? 'true' : undefined"
				data-testid="layer-canvas"
				@click="selectCanvas"
			>
				<UIcon name="i-lucide-panels-top-left" class="size-4 shrink-0 text-muted" />
				<span class="min-w-0 flex-1 truncate text-sm">Canvas</span>
				<span class="shrink-0 text-[0.6875rem] text-dimmed">{{ canvasWidth }}×{{ canvasHeight }}</span>
			</button>
		</div>
	</div>
</template>
