<script setup lang="ts">
import type { GraphicFillEdit } from '~~/shared/modules/graphics';
import type { ThemeFill } from '~~/shared/modules/theme';
import type { GraphicFill } from '~~/shared/types/graphics';
import { applyGraphicFillEdit } from '~~/shared/modules/graphics';
import { decodeThemeFill, encodeThemeColor, encodeThemeFill } from '~/modules/theme-editor/themeColor';

// A Graphic Fill token: solid or a gradient, each colour following a colour
// token or holding its own. Edits go through the compositor's own fill rules.

const props = defineProps<{
	modelValue: ThemeFill;
	label: string;
}>();

const emit = defineEmits<{
	commit: [value: ThemeFill];
}>();

const encoded = computed(() => encodeThemeFill(props.modelValue) as GraphicFill);

function edit(change: GraphicFillEdit) {
	emit('commit', decodeThemeFill(applyGraphicFillEdit(encoded.value, change, {
		gradientEndColor: encodeThemeColor({ token: 'surface-raised' }),
	})));
}
</script>

<template>
	<GraphicsFillFields
		:fill="encoded"
		size="xs"
		:aria-label-prefix="label"
		test-id-prefix="theme-fill"
		@edit="edit"
	>
		<template #color="{ value, label: colorLabel, testId, update }">
			<ThemeColorSourceField
				:value="value"
				:label="colorLabel"
				:test-id="testId"
				@update="update"
			/>
		</template>
	</GraphicsFillFields>
</template>
