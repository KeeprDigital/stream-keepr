<script setup lang="ts">
import type { GraphicFillEdit } from '~~/shared/modules/graphics';
import type { GraphicFill } from '~~/shared/types/graphics';
import { applyGraphicFillEdit } from '~~/shared/modules/graphics';
import { FOUNDATION_TOKENS } from '~~/shared/modules/theme';

// A Graphic Fill token: solid or a gradient, every colour a literal. Edits go
// through the compositor's own fill rules.

const props = defineProps<{
	/** The fill as it resolves: every colour a literal. */
	modelValue: GraphicFill;
	label: string;
}>();

const emit = defineEmits<{
	commit: [value: GraphicFill];
}>();

function edit(change: GraphicFillEdit) {
	emit('commit', applyGraphicFillEdit(props.modelValue, change, {
		gradientEndColor: FOUNDATION_TOKENS['surface-raised'].default,
	}));
}
</script>

<template>
	<GraphicsFillFields
		:fill="modelValue"
		size="xs"
		:aria-label-prefix="label"
		test-id-prefix="theme-fill"
		@edit="edit"
	>
		<template #color="{ target, value, label: colorLabel, testId, update }">
			<ThemeColorField
				:value="value"
				:label="colorLabel"
				:alpha="target === 'solid'"
				:test-id="testId"
				@update="update"
			/>
		</template>
	</GraphicsFillFields>
</template>
