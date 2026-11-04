<script setup lang="ts">
import { useRememberedOpenState } from '~/composables/ui/useRememberedOpenState';

/**
 * One card of a Screen settings page: a title, an optional subtitle, and a body
 * that a collapsible card hides behind its header, showing `summary` there instead.
 *
 * With an `id`, scoped as `mode:card`, whether it is open is remembered per
 * browser; `defaultOpen` applies until the operator toggles it.
 */
const props = withDefaults(defineProps<{
	title: string;
	subtitle?: string;
	collapsible?: boolean;
	defaultOpen?: boolean;
	/** `mode:card`, e.g. `topCards:badges`; remembers the open state per browser. */
	id?: string;
	/** One line shown in the header while closed. */
	summary?: string;
}>(), {
	collapsible: true,
	defaultOpen: true,
});

defineSlots<{
	default?: () => unknown;
	actions?: (props: { open: boolean }) => unknown;
	summary?: () => unknown;
}>();

const SETTINGS_CARDS_STORAGE_KEY = 'screen-settingsCards';

const remembered = useRememberedOpenState(SETTINGS_CARDS_STORAGE_KEY);
const localOpen = ref(props.defaultOpen);

const open = computed({
	get: () => !props.collapsible || (props.id
		? remembered.isOpen(props.id, props.defaultOpen)
		: localOpen.value),
	set: (value: boolean) => {
		if (props.id)
			remembered.setOpen(props.id, value);
		else
			localOpen.value = value;
	},
});
const bodyId = useId();

function toggleOpen() {
	if (props.collapsible)
		open.value = !open.value;
}
</script>

<template>
	<UCard variant="subtle">
		<template #header>
			<div class="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h3 class="font-semibold">
						{{ title }}
					</h3>
					<p v-if="subtitle" class="text-sm text-muted">
						{{ subtitle }}
					</p>
					<p
						v-if="!open && (summary || $slots.summary)"
						class="text-sm text-muted truncate"
						data-settings-card-summary
					>
						<slot name="summary">
							{{ summary }}
						</slot>
					</p>
				</div>
				<div class="flex flex-wrap items-center gap-2">
					<slot name="actions" :open="open" />
					<UButton
						v-if="collapsible"
						color="neutral"
						variant="ghost"
						:icon="open ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
						:aria-label="`${open ? 'Collapse' : 'Expand'} ${title}`"
						:aria-expanded="open"
						:aria-controls="bodyId"
						@click="toggleOpen"
					/>
				</div>
			</div>
		</template>

		<template v-if="open" #default>
			<div :id="bodyId" class="w-full flex flex-col gap-4">
				<slot />
			</div>
		</template>
	</UCard>
</template>
