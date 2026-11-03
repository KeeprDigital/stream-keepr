<script setup lang="ts">
import type { GraphicsAuthoringLeaseStatus } from '~/composables/screen/useGraphicsAuthoringLease';

/**
 * What a graphics Edit workspace tells a session that may not author it, and the
 * take-over control that lets it author instead. Shown by both Screen editors,
 * the Broadcast Graphics Edit workspace and the Feature Match Overlay editor,
 * since one Graphics Authoring Lease covers the Screen's Edit workspace.
 */
const props = defineProps<{
	/** Whether this session holds the lease; nothing shows while it does. */
	writable?: boolean;
	leaseStatus?: GraphicsAuthoringLeaseStatus;
	canTakeOver?: boolean;
	/** Who holds it, where the server could resolve their session to a person. */
	holderName?: string | null;
}>();

const emit = defineEmits<{ takeOver: [] }>();

const notice = computed(() => {
	if (props.writable === true)
		return null;
	if (props.leaseStatus === 'error')
		return 'The Graphics Authoring Lease for this Edit workspace could not be checked, so authoring stays read-only.';
	if (props.leaseStatus !== 'ready')
		return 'Checking the Graphics Authoring Lease for this Edit workspace.';
	// Named where the server could resolve the holder's session to a person
	// (#398): "another session" is true and useless — an operator wants to know
	// whether to go and ask a colleague or close their own second window, and the
	// name is what answers that. It falls back to the old sentence rather than to
	// a placeholder, because a holder whose session has since ended is still
	// holding it.
	if (props.holderName)
		return `${props.holderName} holds the Graphics Authoring Lease for this Edit workspace, in another browser. You are observing their accepted changes read-only.`;
	return 'Another session holds the Graphics Authoring Lease for this Edit workspace. You are observing its accepted changes read-only.';
});
</script>

<template>
	<div
		v-if="notice"
		class="flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3"
		data-testid="edit-lease-notice"
	>
		<UIcon name="i-lucide-eye" class="size-4 shrink-0 text-warning" />
		<p class="min-w-0 flex-1 text-sm">
			{{ notice }}
		</p>
		<UButton
			v-if="canTakeOver === true"
			size="xs"
			variant="soft"
			icon="i-lucide-pencil-ruler"
			data-testid="edit-lease-take-over"
			@click="emit('takeOver')"
		>
			Take over
		</UButton>
	</div>
</template>
