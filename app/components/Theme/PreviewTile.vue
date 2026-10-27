<script setup lang="ts">
import type { StoredThemeTokens } from '~~/shared/modules/theme';
import type { ScreenMode } from '~~/shared/types/enums';
import { useElementSize } from '@vueuse/core';
import { createScreenModeSampleContext } from '~/modules/screen-mode/sampleScreen';

const props = defineProps<{
	mode: ScreenMode;
	label: string;
	/** The Theme previewed, as stored. */
	tokens: StoredThemeTokens;
}>();

const stage = useTemplateRef<HTMLElement>('stage');
const { width, height } = useElementSize(stage);

// One Screen host per tile, showing its mode against the Screen Mode Sample
// Dataset under the Theme as it stands, so each token edit repaints it.
provideScreenContext(createScreenModeSampleContext({
	mode: props.mode,
	themeTokens: toRef(props, 'tokens'),
	viewport: computed(() => ({ width: width.value, height: height.value })),
}));
</script>

<template>
	<figure class="flex flex-col gap-2" :data-preview-mode="mode">
		<div
			ref="stage"
			class="relative aspect-video w-full overflow-hidden rounded-md bg-neutral-950 ring ring-default"
			inert
		>
			<ScreenRenderer class="absolute inset-0" />
		</div>
		<figcaption class="text-sm text-muted">
			{{ label }}
		</figcaption>
	</figure>
</template>
