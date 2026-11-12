<script setup lang="ts">
import { useRememberedOpenState } from '~/composables/ui/useRememberedOpenState';

/**
 * The one collapsible section of a settings surface: a title, and a body its
 * header hides, showing `summary` there instead. It draws in two densities:
 *
 * - `card`, one card of a settings page. It starts open, and a closed card
 *   unmounts its body.
 * - `row`, one row of a property panel (a graphics inspector). It starts closed,
 *   its whole header toggles it, and a closed row keeps its body mounted, hidden.
 *
 * With an `id`, whether it is open is remembered per browser, each density under
 * its own storage key; `defaultOpen` applies until the operator toggles it. A
 * card's id is scoped `mode:card`; a row's names the section rather than the
 * item, so a section an author works in stays open on every item that follows.
 */
const props = withDefaults(defineProps<{
	title: string;
	density?: 'card' | 'row';
	/** A card's second line, under its title. */
	subtitle?: string;
	/** A row's leading icon. */
	icon?: string;
	/** `false` draws a card that is always open, with no toggle. */
	collapsible?: boolean;
	/** Absent, a card starts open and a row closed. */
	defaultOpen?: boolean;
	/** Remembers the open state per browser. */
	id?: string;
	/** One line shown in the header while closed. */
	summary?: string;
}>(), {
	density: 'card',
	collapsible: true,
	// Absent is the density's own default, not a boolean prop's `false`.
	defaultOpen: undefined,
});

defineSlots<{
	default?: () => unknown;
	actions?: (props: { open: boolean }) => unknown;
	summary?: () => unknown;
}>();

/**
 * Versioned: a change to which sections start open takes a new key, so state
 * remembered under the old defaults is not carried over.
 */
const STORAGE_KEYS = {
	card: 'screen-settingsCards',
	row: 'editor-inspectorSections:v2',
} as const;

// A density is fixed for a section's life, so its storage is chosen once.
const remembered = useRememberedOpenState(STORAGE_KEYS[props.density]);
const startsOpen = computed(() => props.defaultOpen ?? props.density === 'card');
const localOpen = ref(startsOpen.value);

const open = computed({
	get: () => !props.collapsible || (props.id
		? remembered.isOpen(props.id, startsOpen.value)
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
	<section
		v-if="density === 'row'"
		class="border-b border-default/70 last:border-b-0"
		:data-inspector-section="id"
	>
		<button
			type="button"
			class="flex w-full items-center gap-2 py-2.5 text-left"
			:aria-expanded="open"
			:data-testid="id ? `inspector-section-${id}-toggle` : undefined"
			@click="toggleOpen"
		>
			<UIcon v-if="icon" :name="icon" class="size-4 shrink-0 text-muted" />
			<span class="min-w-0 flex-1">
				<span class="block text-sm font-medium">{{ title }}</span>
				<span
					v-if="!open && (summary || $slots.summary)"
					class="block truncate text-xs text-muted"
				>
					<slot name="summary">{{ summary }}</slot>
				</span>
			</span>
			<slot name="actions" :open="open" />
			<UIcon
				v-if="collapsible"
				name="i-lucide-chevron-down"
				class="size-4 shrink-0 text-muted transition-transform"
				:class="{ 'rotate-180': open }"
			/>
		</button>
		<div v-show="open" class="space-y-3 pb-4" :data-testid="id ? `inspector-section-${id}` : undefined">
			<slot />
		</div>
	</section>

	<UCard v-else variant="subtle">
		<template #header>
			<div class="flex flex-wrap items-start justify-between gap-3">
				<div class="min-w-0 flex-1">
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
						:aria-controls="open ? bodyId : undefined"
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
