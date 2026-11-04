<script setup lang="ts">
import type { FeatureMatchLayoutEditor } from '~/composables/screen/useFeatureMatchLayoutEditor';
import { ALIGN_COMMANDS, DISTRIBUTE_COMMANDS } from '~/modules/feature-match-overlay/layerAlignment';

/**
 * The property panel's align and distribute buttons for the selected layers
 * (#919). Several align to the bounds they cover and one to the canvas, or a
 * group child to its group; distributing needs three. Disabled without the
 * Graphics Authoring Lease (#738).
 */
const props = defineProps<{
	editor: FeatureMatchLayoutEditor;
}>();

const writable = computed(() => props.editor.writable.value);
const canAlign = computed(() => writable.value && props.editor.canAlign());
const canDistribute = computed(() => writable.value && props.editor.canDistribute());
const alignsTo = computed(() => props.editor.layers.value.length > 1
	? 'the selection'
	: 'its container');
</script>

<template>
	<div
		class="flex flex-wrap items-center gap-x-2 gap-y-1"
		role="toolbar"
		aria-label="Align and distribute"
		data-testid="layer-align-controls"
	>
		<div class="flex items-center">
			<UButton
				v-for="command in ALIGN_COMMANDS"
				:key="command.edge"
				size="xs"
				variant="ghost"
				color="neutral"
				:icon="command.icon"
				:disabled="!canAlign"
				:aria-label="`Align ${command.label.toLowerCase()}`"
				:title="`Align ${command.label.toLowerCase()} to ${alignsTo}`"
				@click="editor.align(command.edge)"
			/>
		</div>
		<div class="flex items-center">
			<UButton
				v-for="command in DISTRIBUTE_COMMANDS"
				:key="command.axis"
				size="xs"
				variant="ghost"
				color="neutral"
				:icon="command.icon"
				:disabled="!canDistribute"
				:aria-label="`Distribute ${command.label.toLowerCase()}`"
				:title="`Distribute ${command.label.toLowerCase()}`"
				@click="editor.distribute(command.axis)"
			/>
		</div>
	</div>
</template>
