<script setup lang="ts">
import type { TemplatePackageKind } from '~~/shared/types/templatePackage';
import type { GraphicsTemplatePackageImport } from '~/composables/useGraphicsTemplateLibrary';

/**
 * Receiving a Template Package into a graphics Template library.
 *
 * A Template Package installs as an Installed Graphics Template: an independent local
 * copy with this installation's own identity and revision, keeping the packaged
 * Template's identity as provenance only. That is the same in both Template libraries,
 * which is why they can share this and why the eight-way wiring it holds only had to be
 * written once.
 *
 * The kind is a `TemplatePackageKind` rather than any kind a reusable library can be
 * handed, so `kind="skstyle"` here is a type error. That is a labelling guard and only
 * that: what actually keeps a Graphic Style Set Package's preserve-identity import off
 * this path is the repository interface — `GraphicsTemplateLibraryRepository` requires
 * `receivePackage` and `confirmPackage`, which the Style Set repository does not have,
 * so `useGraphicsTemplateLibrary` cannot be instantiated over it at all. This prop only
 * stops a Template library mislabelling its own import button; nothing prevents a
 * caller reaching past this component to `GraphicsPackageImport` directly, which is how
 * `StyleSetLibrary.vue` legitimately uses it.
 */
defineProps<{
	/** Which Template Package this library receives. */
	kind: TemplatePackageKind;
	/** This library's prefix for its import test ids. */
	testId: string;
	/** Whether this session may author. An observer is offered no import at all. */
	writable?: boolean;
	state: GraphicsTemplatePackageImport;
}>();
</script>

<template>
	<GraphicsPackageImport
		:kind="kind"
		:test-id="testId"
		:writable="writable"
		:busy="state.busy"
		:reported="state.reported"
		:issues="state.issues"
		:rejected="state.rejected"
		:awaiting-confirmation="state.awaitingConfirmation"
		@file="state.receive"
		@confirm="state.confirm"
		@dismiss="state.dismiss"
	/>
</template>
