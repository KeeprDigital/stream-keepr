<script setup lang="ts">
/**
 * What this client's realtime link is doing, where an operator can see it.
 *
 * Two faults are worth separating, because the second used to have no surface at
 * all. A dropped connection is loud and self-healing: Ably reconnects, and every
 * realtime-fed surface re-reads authoritative state on the way back
 * (`useReconnectResync`). A token this client cannot mint is neither. The socket
 * stays connected, the page looks healthy, and every channel for the Event the
 * operator just switched to is silently unsubscribable — which before #307 was
 * reported by a single `console.warn` and recovered only by a page reload.
 *
 * Sits beside the server-time indicator in the sidebar footer, for the same
 * reason that one does: it is a standing fact about this client's health rather
 * than an event, so it belongs somewhere an operator can look rather than
 * somewhere that interrupts them.
 */
const realtime = tryUseRealtime();

const connectionState = computed(() => realtime?.connectionState ?? 'initialized');
const tokenError = computed(() => realtime?.tokenError ?? null);

const isConnected = computed(() => realtime?.isConnected ?? false);

const status = computed(() => {
	if (tokenError.value)
		return 'unauthorized' as const;
	if (isConnected.value)
		return 'connected' as const;
	// Standing by, not a fault: the client does not connect until an Event is
	// known (#474), so an event-less page sits in `initialized` indefinitely.
	// Named `standby` rather than `idle` — Idle is a Screen Mode in the glossary.
	if (connectionState.value === 'initialized')
		return 'standby' as const;
	// Settling is not a fault either: a page load is not a lost connection.
	return connectionState.value === 'connecting' ? 'settling' as const : 'disconnected' as const;
});

const statusIcon = computed(() => {
	switch (status.value) {
		case 'connected': return 'i-lucide-radio';
		case 'unauthorized': return 'i-lucide-shield-alert';
		default: return 'i-lucide-radio-tower';
	}
});

const statusTone = computed(() => {
	switch (status.value) {
		case 'connected': return { text: 'text-success', dot: 'bg-success' };
		case 'unauthorized': return { text: 'text-error', dot: 'bg-error' };
		case 'standby': return { text: 'text-dimmed', dot: 'bg-accented' };
		default: return { text: 'text-warning', dot: 'bg-warning' };
	}
});

const statusLabel = computed(() => {
	switch (status.value) {
		case 'connected': return 'Live Updates Connected';
		case 'unauthorized': return 'Live Updates Unauthorized';
		case 'standby': return 'Live Updates Standing By';
		case 'settling': return 'Connecting Live Updates';
		default: return 'Live Updates Disconnected';
	}
});
</script>

<template>
	<UPopover
		mode="hover"
		:open-delay="300"
		:close-delay="150"
		:content="{ side: 'right', align: 'end' }"
	>
		<button
			type="button"
			class="flex items-center justify-center rounded-md p-1.5 transition-colors hover:bg-elevated"
			aria-label="Live updates status"
		>
			<UIcon
				:name="statusIcon"
				class="size-4"
				:class="statusTone.text"
			/>
		</button>

		<template #content>
			<div class="flex flex-col gap-2 p-3 min-w-56">
				<div class="flex items-center gap-2">
					<span
						class="size-2 rounded-full shrink-0"
						:class="statusTone.dot"
					/>
					<span class="text-sm font-medium text-highlighted">{{ statusLabel }}</span>
				</div>

				<div class="flex flex-col gap-1 text-xs text-muted">
					<div class="flex justify-between gap-4">
						<span>Connection</span>
						<span class="text-dimmed">{{ connectionState }}</span>
					</div>
					<p v-if="status === 'unauthorized'">
						This browser could not get permission for this Event's live updates, so
						nothing on this page is updating by itself. Reload the page; if it keeps
						happening, the realtime service or its credentials need attention.
					</p>
					<p v-else-if="status === 'disconnected'">
						Reconnecting automatically. Everything on screen holds what it last
						received, and is re-read as soon as the connection returns.
					</p>
					<p v-else-if="status === 'standby'">
						No Event is open here, so there is nothing to stream. Live updates
						connect when an Event is open.
					</p>
				</div>
			</div>
		</template>
	</UPopover>
</template>
