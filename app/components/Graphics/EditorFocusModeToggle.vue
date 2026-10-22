<script setup lang="ts">
import { useEditorFocusModeHost } from '~/modules/graphics/editorFocusMode';

/**
 * The one way into and out of Editor Focus Mode (#744). An editor shows it in
 * its own toolbar, and showing it is what makes Focus Mode apply there: the
 * page's chrome yields only while a toggle is on the page to bring it back.
 * Escape never exits, since the editors use it to cancel their own gestures.
 */
const { active, toggle } = useEditorFocusModeHost();
</script>

<template>
	<UButton
		size="sm"
		:variant="active ? 'subtle' : 'soft'"
		:color="active ? 'primary' : 'neutral'"
		:icon="active ? 'i-lucide-minimize-2' : 'i-lucide-maximize-2'"
		:aria-pressed="active"
		:title="active
			? 'Bring back the app sidebar and Screen settings'
			: 'Hide the app sidebar and Screen settings so the editor fills the page'"
		data-testid="editor-focus-mode-toggle"
		@click="toggle"
	>
		{{ active ? 'Exit focus' : 'Focus' }}
	</UButton>
</template>
