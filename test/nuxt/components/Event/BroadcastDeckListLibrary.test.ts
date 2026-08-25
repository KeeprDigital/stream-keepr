import type { BroadcastDeckListResponse, BroadcastDeckListSummaryResponse } from '~~/shared/types/broadcastDeckList';
import type { Event } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, reactive } from 'vue';
import { createMockEvent } from '~~/test/helpers/fixtures';
import { transportFailure } from '~~/test/helpers/transportFailure';

function detail(overrides: Partial<BroadcastDeckListResponse> = {}): BroadcastDeckListResponse {
	return {
		id: 11,
		eventId: 1,
		name: 'Azorius',
		archetypeLabel: 'Control',
		colors: 'WU',
		revision: 1,
		mainboardQuantity: 60,
		sideboardQuantity: 15,
		hasCompanion: true,
		createdAt: new Date('2026-08-01T00:00:00Z'),
		updatedAt: new Date('2026-08-01T00:00:00Z'),
		sourceText: '4 Counterspell\n56 Island\nSideboard\n15 Disenchant',
		entries: [],
		...overrides,
	};
}

function summary(item: BroadcastDeckListResponse): BroadcastDeckListSummaryResponse {
	const { sourceText: _sourceText, entries: _entries, ...value } = item;
	return value;
}

const first = detail();
const store = reactive({
	summaries: [summary(first)] as BroadcastDeckListSummaryResponse[],
	loading: false,
	error: null as string | null,
	details: new Map([[first.id, first]]) as Map<number, BroadcastDeckListResponse>,
	loadCollection: vi.fn(),
	loadDetail: vi.fn(async (_eventId: number, listId: number) => store.details.get(listId) ?? null),
	consumeDetail: vi.fn(() => vi.fn()),
	createList: vi.fn(),
	updateList: vi.fn(),
	removeList: vi.fn(),
	detailById: (listId: number) => store.details.get(listId) ?? null,
});
const eventStore = reactive({
	event: null as Event | null,
	updateEvent: vi.fn(),
});

mockNuxtImport('useBroadcastDeckListStore', () => () => store);
mockNuxtImport('useEventStore', () => () => eventStore);

const UButtonStub = defineComponent({
	props: {
		label: { type: String, required: false },
		disabled: { type: Boolean, required: false },
		loading: { type: Boolean, required: false },
	},
	emits: ['click'],
	template: '<button type="button" :data-label="label" :disabled="disabled" :data-loading="loading" @click="$emit(\'click\')"><slot>{{ label }}</slot></button>',
});
const UInputStub = defineComponent({
	props: { modelValue: { type: String, required: false }, name: { type: String, required: false } },
	emits: ['update:modelValue'],
	template: '<input :data-name="name" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)">',
});
const UTextareaStub = defineComponent({
	props: { modelValue: { type: String, required: false }, name: { type: String, required: false } },
	emits: ['update:modelValue'],
	template: '<textarea :data-name="name" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
});
const USwitchStub = defineComponent({
	props: { modelValue: { type: Boolean, required: false }, disabled: { type: Boolean, required: false } },
	emits: ['update:modelValue'],
	template: '<button type="button" data-testid="feature-switch" :data-value="String(modelValue)" :disabled="disabled" @click="$emit(\'update:modelValue\', !modelValue)" />',
});
const UCheckboxStub = defineComponent({
	props: { modelValue: { type: Boolean, required: false }, label: { type: String, required: false } },
	emits: ['update:modelValue'],
	template: '<button type="button" :data-color="label" :data-value="String(modelValue)" @click="$emit(\'update:modelValue\', !modelValue)" />',
});
const UModalStub = defineComponent({
	props: { open: { type: Boolean, required: false } },
	emits: ['update:open'],
	template: '<div v-if="open" data-testid="modal"><slot name="body" /><slot name="footer" :close="() => $emit(\'update:open\', false)" /></div>',
});
const UAlertStub = defineComponent({
	props: {
		title: { type: String, required: false },
		description: { type: String, required: false },
	},
	template: '<div><slot name="title">{{ title }}</slot><slot name="description">{{ description }}</slot><slot /></div>',
});
const passthrough = defineComponent({ template: '<div><slot name="header" /><slot /><slot name="body" /><slot name="footer" /></div>' });

const stubs = {
	UButton: UButtonStub,
	UInput: UInputStub,
	UTextarea: UTextareaStub,
	USwitch: USwitchStub,
	UCheckbox: UCheckboxStub,
	UModal: UModalStub,
	UCard: passthrough,
	UForm: passthrough,
	UFormField: passthrough,
	UAlert: UAlertStub,
	UBadge: passthrough,
	UIcon: true,
};

function event(overrides: Partial<Event> = {}): Event {
	return createMockEvent({ broadcastDeckListsEnabled: false, ...overrides }) as unknown as Event;
}

async function mountComponent(value: Event = event()) {
	eventStore.event = value;
	const { default: Component } = await import('../../../../app/components/Event/BroadcastDeckListLibrary.vue');
	return mount(Component, { props: { event: value }, global: { stubs } });
}

function button(wrapper: Awaited<ReturnType<typeof mountComponent>>, label: string) {
	return wrapper.get(`[data-label="${label}"]`);
}

describe('event Broadcast Deck List library', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		store.summaries = [summary(first)];
		store.details = new Map([[first.id, first]]);
		store.error = null;
		store.loadCollection.mockResolvedValue(store.summaries);
		store.createList.mockResolvedValue(first);
		store.updateList.mockResolvedValue(detail({ revision: 2 }));
		store.removeList.mockResolvedValue({ success: true });
		eventStore.updateEvent.mockImplementation(async (updates: Partial<Event>) => {
			eventStore.event = { ...eventStore.event!, ...updates };
			return eventStore.event;
		});
	});

	it('is MTG-only while keeping the disabled library visible and manageable', async () => {
		const wrapper = await mountComponent();
		await flushPromises();

		expect(store.loadCollection).toHaveBeenCalledWith(1);
		expect(wrapper.get('[data-testid="feature-switch"]').attributes('data-value')).toBe('false');
		expect(wrapper.text()).toContain('Azorius');
		expect(wrapper.text()).toContain('60 mainboard');
		expect(wrapper.text()).toContain('15 sideboard');
		expect(wrapper.text()).toContain('Companion');
		expect(wrapper.find('[data-label="Add Deck List"]').exists()).toBe(true);

		const nonMtg = await mountComponent(event({ game: 'op' }));
		expect(nonMtg.html()).toBe('<!--v-if-->');
	});

	it('creates from one plaintext draft, normalizing blank optional metadata and preventing double-submit', async () => {
		let resolveCreate!: (value: BroadcastDeckListResponse) => void;
		store.createList.mockReturnValue(new Promise(resolve => resolveCreate = resolve));
		const wrapper = await mountComponent();
		await flushPromises();
		await button(wrapper, 'Add Deck List').trigger('click');
		await wrapper.get('[data-name="name"]').setValue('  Burn  ');
		await wrapper.get('[data-name="archetypeLabel"]').setValue('   ');
		await wrapper.get('[data-name="sourceText"]').setValue('4 Lightning Bolt');

		await button(wrapper, 'Save Deck List').trigger('click');
		await button(wrapper, 'Save Deck List').trigger('click');
		expect(store.createList).toHaveBeenCalledOnce();
		expect(store.createList).toHaveBeenCalledWith(1, {
			name: 'Burn',
			archetypeLabel: null,
			colors: null,
			sourceText: '4 Lightning Bolt',
		});

		resolveCreate(first);
		await flushPromises();
		expect(wrapper.find('[data-name="sourceText"]').exists()).toBe(false);
	});

	it('shows every line error with its physical line and offending text while retaining the draft', async () => {
		const failure = transportFailure({
			status: 422,
			body: {
				message: 'Broadcast Deck List source is invalid',
				data: { code: 'BROADCAST_DECK_LIST_INVALID', errors: [
					{ lineNumber: 2, code: 'INVALID_CARD_LINE', message: 'Expected a quantity', sourceText: 'Island' },
					{ lineNumber: 4, code: 'UNRESOLVED_CARD', message: 'Could not resolve card', sourceText: '1 Nope' },
				] },
			},
		});
		store.createList.mockRejectedValue(new Error('Broadcast Deck List source is invalid', { cause: failure }));
		const wrapper = await mountComponent();
		await flushPromises();
		await button(wrapper, 'Add Deck List').trigger('click');
		await wrapper.get('[data-name="name"]').setValue('Draft');
		await wrapper.get('[data-name="sourceText"]').setValue('Deck\nIsland\nSideboard\n1 Nope');
		await button(wrapper, 'Save Deck List').trigger('click');
		await flushPromises();

		expect(wrapper.text()).toContain('Line 2: Expected a quantity — Island');
		expect(wrapper.text()).toContain('Line 4: Could not resolve card — 1 Nope');
		expect(wrapper.get('[data-name="sourceText"]').element).toHaveProperty('value', 'Deck\nIsland\nSideboard\n1 Nope');
	});

	it('keeps an edit draft across a revision conflict and retries against the newer authority', async () => {
		const current = detail({ revision: 2, name: 'Peer name', sourceText: '60 Plains' });
		store.updateList.mockRejectedValueOnce(new Error('Broadcast Deck List changed since it was loaded', {
			cause: transportFailure({
				status: 409,
				body: { message: 'Broadcast Deck List changed since it was loaded', data: { code: 'BROADCAST_DECK_LIST_REVISION_CONFLICT', current } },
			}),
		}));
		const wrapper = await mountComponent();
		await flushPromises();
		await button(wrapper, 'Edit Azorius').trigger('click');
		await flushPromises();
		await wrapper.get('[data-name="name"]').setValue('My draft');
		await button(wrapper, 'Save Changes').trigger('click');
		await flushPromises();

		expect(wrapper.text()).toContain('newer revision 2');
		expect(wrapper.get('[data-name="name"]').element).toHaveProperty('value', 'My draft');
		store.updateList.mockResolvedValueOnce(detail({ revision: 3, name: 'My draft' }));
		await button(wrapper, 'Retry Save').trigger('click');
		await flushPromises();
		expect(store.updateList).toHaveBeenLastCalledWith(1, 11, expect.objectContaining({
			expectedRevision: 2,
			name: 'My draft',
		}));
	});

	it('presents provider outages as retryable instead of invalid text', async () => {
		store.createList.mockRejectedValue(new Error('Card data provider is temporarily unavailable', {
			cause: transportFailure({
				status: 503,
				body: { message: 'Card data provider is temporarily unavailable', data: { code: 'BROADCAST_DECK_LIST_CARD_PROVIDER_UNAVAILABLE', retryable: true } },
			}),
		}));
		const wrapper = await mountComponent();
		await flushPromises();
		await button(wrapper, 'Add Deck List').trigger('click');
		await wrapper.get('[data-name="name"]').setValue('Retry me');
		await wrapper.get('[data-name="sourceText"]').setValue('1 Island');
		await button(wrapper, 'Save Deck List').trigger('click');
		await flushPromises();

		expect(wrapper.text()).toContain('Card data provider is temporarily unavailable');
		expect(wrapper.find('[data-label="Retry Save"]').exists()).toBe(true);
		expect(wrapper.text()).not.toContain('invalid text');
	});

	it('confirms deletion and surfaces affected Screen names without removing the list', async () => {
		store.removeList.mockRejectedValue(new Error('Broadcast Deck List is selected by Screens: Alpha, Studio', {
			cause: transportFailure({
				status: 409,
				body: {
					message: 'Broadcast Deck List is selected by Screens: Alpha, Studio',
					data: {
						code: 'BROADCAST_DECK_LIST_IN_USE',
						screens: [{ id: 2, name: 'Alpha' }, { id: 4, name: 'Studio' }],
					},
				},
			}),
		}));
		const wrapper = await mountComponent();
		await flushPromises();
		await button(wrapper, 'Delete Azorius').trigger('click');
		expect(wrapper.find('[data-testid="modal"]').exists()).toBe(true);
		await button(wrapper, 'Delete Deck List').trigger('click');
		await flushPromises();

		expect(store.removeList).toHaveBeenCalledWith(1, 11, 1);
		expect(wrapper.text()).toContain('Alpha, Studio');
		expect(wrapper.text()).toContain('Azorius');
	});

	it('surfaces affected Screens when disabling is refused and reflects remote collection updates once', async () => {
		eventStore.updateEvent.mockRejectedValueOnce(new Error('Broadcast Deck Lists cannot be disabled while selected by Screen: Program', {
			cause: transportFailure({
				status: 409,
				body: {
					message: 'Broadcast Deck Lists cannot be disabled while selected by Screen: Program',
					data: {
						code: 'BROADCAST_DECK_LISTS_IN_USE',
						screens: [{ id: 8, name: 'Program' }],
					},
				},
			}),
		}));
		const wrapper = await mountComponent(event({ broadcastDeckListsEnabled: true }));
		await flushPromises();
		await wrapper.get('[data-testid="feature-switch"]').trigger('click');
		await flushPromises();

		expect(wrapper.text()).toContain('Broadcast Deck Lists cannot be disabled while selected by Screen: Program');
		expect(wrapper.get('[data-testid="feature-switch"]').attributes('data-value')).toBe('true');

		store.summaries = [summary(detail({ id: 22, name: 'Remote Deck', revision: 3 }))];
		await flushPromises();
		expect(wrapper.findAll('li').filter(item => item.text().includes('Remote Deck'))).toHaveLength(1);
		expect(wrapper.text()).not.toContain('Azorius');
	});
});
