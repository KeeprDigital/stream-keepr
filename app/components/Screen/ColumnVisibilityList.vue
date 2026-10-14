<script setup lang="ts" generic="Column extends { key: string; visible: boolean }">
import { VueDraggable } from 'vue-draggable-plus';

/**
 * A Screen Mode's table columns as a draggable list: drag to reorder, switch to
 * show or hide.
 *
 * It keeps its own copy, cloned column by column, because the drag reorders the
 * list it is bound to before the drop is final. Every reorder or toggle hands the
 * whole list back through `update`; persisting it, and any setting that depends
 * on a column, stay with the host.
 */
const props = defineProps<{
	columns: readonly Column[];
	labels: Partial<Record<Column['key'], string>>;
}>();

const emit = defineEmits<{ update: [columns: Column[]] }>();

const localColumns = ref<Column[]>([]) as Ref<Column[]>;

watch(() => props.columns, (columns) => {
	localColumns.value = columns.map(column => ({ ...column }));
}, { immediate: true, deep: true });

function columnLabel(column: Column) {
	// The cast is needed: inside the generic, `column.key` widens to `string`.
	return props.labels[column.key as Column['key']] ?? column.key;
}

function onDragEnd() {
	emit('update', [...localColumns.value]);
}

function toggleVisibility(index: number) {
	const columns = [...localColumns.value];
	columns[index] = { ...columns[index]!, visible: !columns[index]!.visible };
	localColumns.value = columns;
	emit('update', columns);
}
</script>

<template>
	<VueDraggable
		v-model="localColumns"
		:animation="150"
		handle=".drag-handle"
		ghost-class="opacity-30"
		class="flex flex-col gap-1"
		@end="onDragEnd"
	>
		<div
			v-for="(column, index) in localColumns"
			:key="column.key"
			class="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-elevated/50 border border-default"
			data-testid="column-row"
		>
			<UIcon
				name="i-lucide-grip-vertical"
				class="drag-handle cursor-grab active:cursor-grabbing text-muted shrink-0"
			/>
			<span class="flex-1 text-sm" :class="{ 'text-muted': !column.visible }" data-testid="column-label">
				{{ columnLabel(column) }}
			</span>
			<USwitch
				:model-value="column.visible"
				size="sm"
				:aria-label="`Show ${columnLabel(column)} column`"
				@update:model-value="toggleVisibility(index)"
			/>
		</div>
	</VueDraggable>
</template>
