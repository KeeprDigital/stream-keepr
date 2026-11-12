<script setup lang="ts">
import type { TemplatePackageKind } from '~~/shared/types/templatePackage';
import type { GraphicsTemplatePackageImport } from '~/composables/useGraphicsTemplateLibrary';

/**
 * The one templates surface of a graphics editor: what a Template library is for,
 * saving into it, receiving a Template Package, the one message an author is
 * looking at, and its entries or the empty state.
 *
 * Both graphics hosts mount it, each through its own library: the Broadcast
 * Graphic Template library and the Feature Match Layout Template library stay
 * sibling artifacts with their own repositories and their own placement, and
 * show an author the same surface. Where the surface sits is the host's: a
 * closed section beside the stack in Broadcast Graphics, a slideover in the
 * Feature Match Overlay editor.
 */
defineProps<{
	/** Which Template Package this library receives. */
	kind: TemplatePackageKind;
	/** This library's prefix for the surface's test ids. */
	testId: string;
	/** Whether this session may author. An observer browses, and is offered no import. */
	writable?: boolean;
	packageImport: GraphicsTemplatePackageImport;
	/** The one message an author is looking at, or none. */
	error: string | null;
	signedOut: boolean;
	errorTitle: string;
	/** Whether the library was read and holds nothing. */
	empty: boolean;
	emptyTitle: string;
	emptyDescription: string;
}>();

defineSlots<{
	/** What this library holds and what placing from it does. */
	intro: () => unknown;
	/** Saving this host's work into the library. */
	save?: () => unknown;
	/** The library's entries. */
	default: () => unknown;
}>();
</script>

<template>
	<div class="space-y-3">
		<p class="text-xs text-muted">
			<slot name="intro" />
		</p>

		<slot name="save" />

		<GraphicsTemplateLibraryImport
			:kind="kind"
			:test-id="`${testId}-import`"
			:writable="writable"
			:state="packageImport"
		/>

		<GraphicsReusableLibraryError
			:title="errorTitle"
			:message="error"
			:signed-out="signedOut"
			:test-id="`${testId}-error`"
		/>

		<UIEmptyState
			v-if="empty"
			icon="i-lucide-library"
			:title="emptyTitle"
			:description="emptyDescription"
		/>

		<div v-else class="space-y-1.5">
			<slot />
		</div>
	</div>
</template>
