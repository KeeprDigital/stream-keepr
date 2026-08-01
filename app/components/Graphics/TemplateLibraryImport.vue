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
 * The kind is a `TemplatePackageKind` rather than any importable artifact, so a Graphic
 * Style Set Package cannot arrive here. Its first import *preserves* the packaged
 * identity and revision, and this path yields an unlinked copy — the distinction the
 * separation of `useGraphicsTemplateLibrary` and `useReusableLibraryReading` exists to
 * keep, stated once more where a `kind` prop could otherwise have quietly crossed it.
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
