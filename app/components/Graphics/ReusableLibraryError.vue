<script setup lang="ts">
/**
 * The one refusal an author browsing a library in the reusable-library scope is
 * looking at, or nothing.
 *
 * All three of those libraries report the same way: one refusal at a time, held until
 * the author has seen it, stated where they are already reading rather than as a toast
 * that leaves. The title is the library's, because "Template library action failed" and
 * "Graphic Style Set action failed" are different pieces of news; everything else about
 * how a refusal is presented is not.
 *
 * Named for the scope, not for the libraries in it. `CONTEXT.md` defines the
 * **Graphics Asset Library** — the module owning image, silent video and font bytes —
 * and a name like "graphics library error" would read as belonging to that, which is a
 * different thing entirely: this reports on reading and writing authoring artifacts and
 * knows nothing about assets. The glossary has no collective term for the three
 * libraries themselves, so this names the scope they share rather than inventing one.
 */
defineProps<{
	title: string;
	/** The refusal an author is looking at, or none — which renders nothing at all. */
	message: string | null;
	/**
	 * Whether that refusal was this browser's session ending, which is the one
	 * refusal carrying an action rather than only an explanation. Signing in again
	 * is the only thing that helps and it is not obvious, so it is offered rather
	 * than described.
	 */
	signedOut?: boolean;
	testId: string;
}>();

// The action holds no state of its own, so taking it from a fresh call is the
// same trip the Library Workspace's own button makes.
const { signIn } = useGraphicsAuthorship();
</script>

<template>
	<UAlert
		v-if="message"
		color="error"
		variant="soft"
		icon="i-lucide-triangle-alert"
		:title="title"
		:description="message"
		:data-testid="testId"
	>
		<UButton
			v-if="signedOut"
			class="mt-3"
			data-testid="reusable-library-sign-in"
			icon="i-lucide-log-in"
			label="Sign in again"
			@click="signIn"
		/>
	</UAlert>
</template>
