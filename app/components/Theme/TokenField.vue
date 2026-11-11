<script setup lang="ts">
import type { Component } from 'vue';
import type { FoundationTokenName, ThemeTokenType, ThemeTokenValue } from '~~/shared/modules/theme';
import type { ThemeTokenDefinitionOf } from '~~/shared/themeTokens';
import { FOUNDATION_TOKENS } from '~~/shared/modules/theme';
import { themeTokenDefinition } from '~~/shared/themeTokens';
import { useThemeTokenDraft } from '~/modules/theme-editor/draft';
import { THEME_TOKEN_COMMITS_IN_STEPS, THEME_TOKEN_INPUTS, themeTokenValueText } from '~/modules/theme-editor/tokenInputs';

// One Theme Token in the Theme editor, or in a Screen's token section: its
// control, what it inherits when left unset, and a reset that clears it. Its
// input edits the token's resolved value, so what an edit writes names no other
// token, and edits a draft, so each edit builds on the last one made here,
// whether or not its write has answered.

const props = defineProps<{
	name: string;
	token: ThemeTokenDefinitionOf;
	/** What the Theme stores for this token, if anything. */
	stored: unknown;
	/** The token's value as it resolves under this Theme now. */
	resolved: ThemeTokenValue;
	/** A write of this token is out: its controls wait, and its draft holds until the write settles. */
	writing?: boolean;
	/**
	 * Where it is set: in a Theme, inheriting its default (the default), or as
	 * a Screen Theme Override, inheriting `inherited`: a Foundation Token's from
	 * the Event's Theme, a Mode Token's default.
	 */
	scope?: 'theme' | 'screen';
	/** What it reads when unset: a literal, or the Foundation Token its default names. */
	inherited?: unknown;
	/** The Event whose adopted library assets a picker offers first; a Theme has none. */
	eventId?: number;
	/**
	 * One row, as a Screen settings group's Look shows it (ADR-0072): label,
	 * control, state badge and reset. What it inherits is announced only.
	 */
	compact?: boolean;
}>();

const emit = defineEmits<{
	set: [value: unknown];
	clear: [];
}>();

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
		compactSet: 'Set',
		reset: 'Reset',
		resetLabel: (label: string) => `Reset ${label} to its default`,
	},
	screen: {
		inherited: 'Theme',
		set: 'Overridden on this Screen',
		compactSet: 'Overridden',
		reset: 'Clear',
		resetLabel: (label: string) => `Clear the ${label} override`,
	},
} as const;
const text = computed(() => {
	const scoped = SCOPE_TEXT[props.scope ?? 'theme'];
	// A Theme stores Foundation Tokens only, so a Mode Token inherits its default wherever it is set.
	return props.token.tier === 'mode'
		? { ...scoped, inherited: SCOPE_TEXT.theme.inherited }
		: scoped;
});
const inheritedValue = computed(() => props.inherited ?? definition.value.default);
const inherited = computed(() => `${text.value.inherited}: ${valueText(inheritedValue.value)}`);
const badge = computed(() => {
	if (!props.compact)
		return isSet.value ? text.value.set : 'Inherited';
	return isSet.value ? text.value.compactSet : text.value.inherited;
});

const { draft, edit, commitNow, cancel } = useThemeTokenDraft(
	() => props.resolved,
	value => emit('set', value),
	() => props.writing === true,
);

function take(value: ThemeTokenValue) {
	if (THEME_TOKEN_COMMITS_IN_STEPS[definition.value.type])
		edit(value);
	else
		commitNow(value);
}

/** A Reset replaces an edit still waiting to be written. */
function clear() {
	cancel();
	emit('clear');
}
</script>

<template>
	<div
		class="flex flex-col border-b border-default last:border-b-0"
		:class="compact ? 'gap-2 py-2' : 'gap-3 py-4'"
		:data-token="name"
		:data-token-state="isSet ? 'set' : 'inherited'"
	>
		<div class="flex flex-wrap items-start justify-between gap-2">
			<div>
				<p class="font-medium text-highlighted" :class="{ 'text-sm': compact }">
					{{ definition.label }}
				</p>
				<p :class="compact ? 'sr-only' : 'text-xs text-muted'" data-token-inherited>
					{{ inherited }}
				</p>
			</div>
			<div class="flex items-center gap-2">
				<UBadge
					:color="isSet ? 'primary' : 'neutral'"
					variant="subtle"
					size="sm"
					:label="badge"
					:title="compact ? inherited : undefined"
				/>
				<UButton
					v-if="isSet"
					size="xs"
					color="neutral"
					variant="ghost"
					icon="i-lucide-rotate-ccw"
					:disabled="writing"
					:aria-label="text.resetLabel(definition.label)"
					@click="clear"
				>
					{{ text.reset }}
				</UButton>
			</div>
		</div>
		<div :class="compact ? 'flex flex-wrap items-center gap-2' : 'flex flex-col gap-3'">
			<component
				:is="input"
				:model-value="draft"
				:label="definition.label"
				:bounds="definition.type === 'dimension' ? definition.bounds : undefined"
				:asset-kinds="definition.type === 'asset' ? definition.assetKinds : undefined"
				:event-id="eventId"
				:class="{ 'pointer-events-none opacity-50': writing }"
				@commit="take"
			/>
		</div>
	</div>
</template>
