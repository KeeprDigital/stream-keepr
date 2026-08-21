import type { FeatureMatchState } from '~~/shared/types/featureMatchState';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import { createMockFeatureMatchState } from '~~/test/helpers/fixtures';

const UModalStub = defineComponent({
	props: {
		open: { type: Boolean, required: false },
	},
	template: '<div v-if="open"><slot name="body" /><slot name="footer" /></div>',
});

const UButtonStub = defineComponent({
	props: {
		label: String,
		disabled: Boolean,
		loading: Boolean,
	},
	emits: ['click'],
	template: '<button type="button" :disabled="disabled" @click="$emit(\'click\')"><slot>{{ label }}</slot></button>',
});

const UInputStub = defineComponent({
	props: { modelValue: [String, Number] },
	emits: ['update:modelValue'],
	template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)">',
});

const USelectStub = defineComponent({
	props: {
		modelValue: String,
		items: { type: Array, default: () => [] },
	},
	emits: ['update:modelValue'],
	template: `<select :value="modelValue" @change="$emit('update:modelValue', $event.target.value)">
		<option v-for="item in items" :key="item.value" :value="item.value">{{ item.label }}</option>
	</select>`,
});

const UFormFieldStub = defineComponent({
	props: { label: String },
	template: '<label>{{ label }}<slot /></label>',
});

async function mountModal(props: Record<string, unknown> = {}, state?: Partial<FeatureMatchState>) {
	const { default: EditStateModal } = await import('~/components/FeatureMatch/State/EditStateModal.vue');
	return mount(EditStateModal, {
		props: {
			open: true,
			state: createMockFeatureMatchState({
				turnNumber: 3,
				firstPlayer: 'player1',
				activePlayer: 'player2',
				// A paused clock so the display prefill is deterministic:
				// countdown 50:00 with 10:00 elapsed shows 40:00.
				clock: {
					type: 'countdown',
					durationMs: 50 * 60 * 1000,
					elapsedMs: 10 * 60 * 1000,
					isRunning: false,
					lastStartedAt: null,
					countUpAfterCountdown: false,
				},
				...state,
			}),
			player1Name: 'Alice',
			player2Name: 'Bob',
			showTurnNumber: true,
			showPlayerTracking: true,
			showCardsKept: true,
			...props,
		},
		global: {
			stubs: {
				UModal: UModalStub,
				UButton: UButtonStub,
				UInput: UInputStub,
				USelect: USelectStub,
				UFormField: UFormFieldStub,
			},
		},
	});
}

function lastSave(wrapper: Awaited<ReturnType<typeof mountModal>>) {
	const events = wrapper.emitted('save');
	return events?.[events.length - 1]?.[0];
}

describe('feature match edit state modal', () => {
	it('prefills every field from the state it opened on', async () => {
		const wrapper = await mountModal();

		expect((wrapper.get('[data-testid="state-life-player1"]').element as HTMLInputElement).value).toBe('20');
		expect((wrapper.get('[data-testid="state-life-player2"]').element as HTMLInputElement).value).toBe('20');
		expect((wrapper.get('[data-testid="state-turn-number"]').element as HTMLInputElement).value).toBe('3');
		expect((wrapper.get('[data-testid="state-first-player"]').element as unknown as HTMLSelectElement).value).toBe('player1');
		expect((wrapper.get('[data-testid="state-active-player"]').element as unknown as HTMLSelectElement).value).toBe('player2');
		expect((wrapper.get('[data-testid="state-clock"]').element as HTMLInputElement).value).toBe('40:00');
	});

	it('emits only the fields that changed, as one save', async () => {
		const wrapper = await mountModal();

		await wrapper.get('[data-testid="state-life-player1"]').setValue('12');
		await wrapper.get('[data-testid="state-turn-number"]').setValue('7');
		await wrapper.get('[data-testid="state-save"]').trigger('click');

		expect(lastSave(wrapper)).toEqual({
			player1: { lifeTotal: 12 },
			turnNumber: 7,
		});
	});

	it('maps the clock field to a display-time set and the None active player to null', async () => {
		const wrapper = await mountModal();

		await wrapper.get('[data-testid="state-clock"]').setValue('10:00');
		await wrapper.get('[data-testid="state-active-player"]').setValue('none');
		await wrapper.get('[data-testid="state-save"]').trigger('click');

		expect(lastSave(wrapper)).toEqual({
			clock: { targetDisplayMs: 10 * 60 * 1000 },
			activePlayer: null,
		});
	});

	it('includes cards kept only when set, and never claims an untouched field', async () => {
		const wrapper = await mountModal({}, {
			player2: { lifeTotal: 20, gameWins: 0, counters: [], cardsKept: 6 },
		});

		await wrapper.get('[data-testid="state-cards-player1"]').setValue('5');
		await wrapper.get('[data-testid="state-save"]').trigger('click');

		expect(lastSave(wrapper)).toEqual({
			player1: { cardsKept: 5 },
		});
	});

	it('closes without saving when nothing changed', async () => {
		const wrapper = await mountModal();

		await wrapper.get('[data-testid="state-save"]').trigger('click');

		expect(wrapper.emitted('save')).toBeUndefined();
		expect(wrapper.emitted('update:open')).toEqual([[false]]);
	});

	it('disables Save while the clock input cannot be parsed', async () => {
		const wrapper = await mountModal();

		await wrapper.get('[data-testid="state-clock"]').setValue('nonsense');

		expect(wrapper.get('[data-testid="state-save"]').attributes('disabled')).toBeDefined();
	});

	it('disables Save while a touched numeric field is invalid, instead of discarding the edit', async () => {
		const wrapper = await mountModal();

		// A number input admits decimals and out-of-range negatives even though
		// the fields are whole, non-negative counts.
		await wrapper.get('[data-testid="state-life-player1"]').setValue('12.5');
		expect(wrapper.get('[data-testid="state-save"]').attributes('disabled')).toBeDefined();

		await wrapper.get('[data-testid="state-life-player1"]').setValue('12');
		await wrapper.get('[data-testid="state-cards-player2"]').setValue('-3');
		expect(wrapper.get('[data-testid="state-save"]').attributes('disabled')).toBeDefined();

		await wrapper.get('[data-testid="state-cards-player2"]').setValue('4');
		expect(wrapper.get('[data-testid="state-save"]').attributes('disabled')).toBeUndefined();
	});

	it('hides the flag-gated fields when their tracking is off', async () => {
		const wrapper = await mountModal({
			showTurnNumber: false,
			showPlayerTracking: false,
			showCardsKept: false,
		});

		expect(wrapper.find('[data-testid="state-turn-number"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="state-first-player"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="state-active-player"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="state-cards-player1"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="state-cards-player2"]').exists()).toBe(false);
	});
});
