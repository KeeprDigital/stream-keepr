<script setup lang="ts">
import type { Component } from 'vue';
import type { FoundationTokenName, ThemeTokenType, ThemeTokenValue } from '~~/shared/modules/theme';
import type { ThemeTokenDefinitionOf } from '~~/shared/themeTokens';
import { FOUNDATION_TOKENS } from '~~/shared/modules/theme';
import { themeTokenDefinition } from '~~/shared/themeTokens';
import { THEME_TOKEN_INPUTS, themeTokenValueText } from '~/modules/theme-editor/tokenInputs';

// One Theme Token in the Theme editor, or in a Screen's token section: its
// control, what it inherits when left unset, and a reset that clears it. A Mode
// Token may also follow any Foundation Token of its type instead of holding its
// own value.

const props = defineProps<{
	name: string;
	token: ThemeTokenDefinitionOf;
	/** What the Theme stores for this token, if anything. */
	stored: unknown;
	/** The token's value as it resolves under this Theme now. */
	resolved: ThemeTokenValue;
	disabled?: boolean;
	/**
	 * Where it is set: in a Theme, inheriting its default (the default), or as
	 * a Screen Theme Override, inheriting `inherited` from the Event's Theme.
	 */
	scope?: 'theme' | 'screen';
	/** What it reads when unset, as stored: a literal, or a Foundation Token it follows. */
	inherited?: unknown;
	/** The Event whose adopted library assets a picker offers first; a Theme has none. */
	eventId?: number;
}>();

const emit = defineEmits<{
	set: [value: unknown];
	clear: [];
}>();

const OWN_VALUE = '__own__';

const definition = computed(() => props.token.definition);
const isSet = computed(() => props.stored !== undefined);
// Each input takes the props and emits the commit `THEME_TOKEN_INPUTS` documents.
const input = computed<Component>(() => THEME_TOKEN_INPUTS[definition.value.type]);

function referenceOf(value: unknown): FoundationTokenName | undefined {
	if (typeof value !== 'object' || value === null || !('token' in value))
		return undefined;
	const named = themeTokenDefinition(String(value.token));
	return named?.tier === 'foundation'
		? value.token as FoundationTokenName
		: undefined;
}

function valueText(value: unknown): string {
	const reference = referenceOf(value);
	return reference
		? `follows ${FOUNDATION_TOKENS[reference].label}`
		: themeTokenValueText(definition.value.type as ThemeTokenType, value as never);
}

const SCOPE_TEXT = {
	theme: {
		inherited: 'Default',
		set: 'Set in this Theme',
		reset: 'Reset',
		resetLabel: (label: string) => `Reset ${label} to its default`,
	},
	screen: {
		inherited: 'Theme',
		set: 'Overridden on this Screen',
		reset: 'Clear',
		resetLabel: (label: string) => `Clear the ${label} override`,
	},
} as const;
const text = computed(() => SCOPE_TEXT[props.scope ?? 'theme']);
const inheritedValue = computed(() => props.inherited ?? definition.value.default);
const inherited = computed(() => `${text.value.inherited}: ${valueText(inheritedValue.value)}`);

/** The Foundation Tokens of this token's type, which a Mode Token may follow. */
const sourceItems = computed(() => [
	...Object.entries(FOUNDATION_TOKENS)
		.filter(([, foundation]) => foundation.type === definition.value.type)
		.map(([foundationName, foundation]) => ({ label: `Follow ${foundation.label}`, value: foundationName })),
	{ label: 'Own value', value: OWN_VALUE },
]);

const source = computed(() => {
	if (isSet.value)
		return referenceOf(props.stored) ?? OWN_VALUE;
	return referenceOf(inheritedValue.value) ?? OWN_VALUE;
});

function chooseSource(value: string) {
	if (value === source.value)
		return;
	emit('set', value === OWN_VALUE
		? props.resolved
		: { token: value });
}
</script>

<template>
	<div
		class="flex flex-col gap-3 border-b border-default py-4 last:border-b-0"
		:data-token="name"
		:data-token-state="isSet ? 'set' : 'inherited'"
	>
		<div class="flex flex-wrap items-start justify-between gap-2">
			<div>
				<p class="font-medium text-highlighted">
					{{ definition.label }}
				</p>
				<p class="text-xs text-muted" data-token-inherited>
					{{ inherited }}
				</p>
			</div>
			<div class="flex items-center gap-2">
				<UBadge
					:color="isSet ? 'primary' : 'neutral'"
					variant="subtle"
					size="sm"
					:label="isSet ? text.set : 'Inherited'"
				/>
				<UButton
					v-if="isSet"
					size="xs"
					color="neutral"
					variant="ghost"
					icon="i-lucide-rotate-ccw"
					:disabled="disabled"
					:aria-label="text.resetLabel(definition.label)"
					@click="emit('clear')"
				>
					{{ text.reset }}
				</UButton>
			</div>
		</div>
		<USelect
			v-if="token.tier === 'mode'"
			:model-value="source"
			:items="sourceItems"
			size="sm"
			class="w-64"
			:disabled="disabled"
			:aria-label="`${definition.label} source`"
			data-token-part="source"
			@update:model-value="chooseSource"
		/>
		<component
			:is="input"
			:model-value="resolved"
			:label="definition.label"
			:bounds="definition.type === 'dimension' ? definition.bounds : undefined"
			:asset-kinds="definition.type === 'asset' ? definition.assetKinds : undefined"
			:event-id="eventId"
			:class="{ 'pointer-events-none opacity-50': disabled }"
			@commit="(value: unknown) => emit('set', value)"
		/>
	</div>
</template>
