import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';

mockNuxtImport('navigateTo', () => vi.fn());

const UButtonStub = defineComponent({
	props: {
		label: { type: String, required: false },
		icon: { type: String, required: false },
	},
	emits: ['click'],
	template: '<button type="button" @click="$emit(\'click\')">{{ label }}<slot /></button>',
});

const UBadgeStub = defineComponent({
	template: '<span><slot /></span>',
});

const UIconStub = defineComponent({
	props: { name: { type: String, required: false } },
	template: '<i />',
});

const UDropdownMenuStub = defineComponent({
	template: '<div data-testid="dropdown"><slot /></div>',
});

interface RoundProps {
	id: number;
	eventId: number;
	phaseId: number;
	name: string;
	roundNumber: number;
	status?: 'upcoming' | 'active' | 'completed' | 'skipped';
	controlMode: 'default' | 'manual_override';
	externalSource: 'melee' | 'manual' | null;
	externalId: string | null;
	lastSyncedAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
}

function makeRound(overrides?: Partial<RoundProps>): RoundProps {
	return {
		id: 1,
		eventId: 1,
		phaseId: 1,
		name: 'Round 1',
		roundNumber: 1,
		controlMode: 'default',
		externalSource: null,
		externalId: null,
		lastSyncedAt: null,
		createdAt: new Date('2026-01-01'),
		updatedAt: new Date('2026-01-01'),
		...overrides,
	};
}

async function mountComponent(props: {
	round: RoundProps;
	activeRound?: RoundProps;
	isMeleeEvent?: boolean;
	isNextActionableRound?: boolean;
	eventId?: number;
}) {
	const { default: RoundListItem } = await import('~/components/Round/ListItem.vue');

	return mount(RoundListItem, {
		props: {
			round: props.round,
			activeRound: props.activeRound,
			isMeleeEvent: props.isMeleeEvent ?? false,
			isNextActionableRound: props.isNextActionableRound ?? false,
			eventId: props.eventId ?? 1,
		},
		global: {
			stubs: {
				UButton: UButtonStub,
				UBadge: UBadgeStub,
				UIcon: UIconStub,
				UDropdownMenu: UDropdownMenuStub,
			},
		},
	});
}

function findButtonByLabel(wrapper: ReturnType<typeof mount>, label: string) {
	return wrapper.findAll('button').find(b => b.text().includes(label));
}

describe('roundListItem', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('active round', () => {
		it('shows no inline lifecycle buttons', async () => {
			const round = makeRound({ status: 'active' });
			const wrapper = await mountComponent({ round, activeRound: round });

			expect(findButtonByLabel(wrapper, 'Complete')).toBeUndefined();
			expect(findButtonByLabel(wrapper, 'Sync Matches')).toBeUndefined();
			expect(findButtonByLabel(wrapper, 'Start')).toBeUndefined();
		});
	});

	describe('next actionable upcoming round (unsynced melee)', () => {
		it('shows no inline lifecycle buttons', async () => {
			const round = makeRound({
				externalSource: 'melee',
				externalId: 'ext-123',
				lastSyncedAt: null,
			});
			const wrapper = await mountComponent({
				round,
				isMeleeEvent: true,
				isNextActionableRound: true,
			});

			expect(findButtonByLabel(wrapper, 'Sync Matches')).toBeUndefined();
			expect(findButtonByLabel(wrapper, 'Start')).toBeUndefined();
			expect(findButtonByLabel(wrapper, 'Complete')).toBeUndefined();
		});
	});

	describe('next actionable upcoming round (synced/manual, no active)', () => {
		it('shows no inline lifecycle buttons', async () => {
			const round = makeRound({
				lastSyncedAt: new Date('2026-01-01'),
			});
			const wrapper = await mountComponent({
				round,
				isNextActionableRound: true,
			});

			expect(findButtonByLabel(wrapper, 'Start')).toBeUndefined();
			expect(findButtonByLabel(wrapper, 'Sync Matches')).toBeUndefined();
			expect(findButtonByLabel(wrapper, 'Complete')).toBeUndefined();
		});

		it('hides Start when there is an active round', async () => {
			const activeRound = makeRound({ id: 99, status: 'active' });
			const round = makeRound({ status: 'upcoming' });
			const wrapper = await mountComponent({
				round,
				activeRound,
				isNextActionableRound: true,
			});

			expect(findButtonByLabel(wrapper, 'Start')).toBeUndefined();
		});
	});

	describe('later upcoming round (not next actionable)', () => {
		it('shows no inline lifecycle buttons', async () => {
			const round = makeRound({ status: 'upcoming' });
			const wrapper = await mountComponent({
				round,
				isNextActionableRound: false,
			});

			expect(findButtonByLabel(wrapper, 'Start')).toBeUndefined();
			expect(findButtonByLabel(wrapper, 'Sync Matches')).toBeUndefined();
			expect(findButtonByLabel(wrapper, 'Complete')).toBeUndefined();
		});
	});

	describe('completed round', () => {
		it('shows no inline buttons and shows synced timestamp', async () => {
			const round = makeRound({
				lastSyncedAt: new Date('2026-01-01T10:00:00Z'),
			});
			const wrapper = await mountComponent({ round });

			expect(findButtonByLabel(wrapper, 'Complete')).toBeUndefined();
			expect(findButtonByLabel(wrapper, 'Start')).toBeUndefined();
			expect(findButtonByLabel(wrapper, 'Sync Matches')).toBeUndefined();
			expect(wrapper.text()).toContain('Synced');
		});
	});

	describe('skipped round', () => {
		it('shows no inline lifecycle buttons', async () => {
			const round = makeRound({ status: 'skipped' });
			const wrapper = await mountComponent({ round });

			expect(findButtonByLabel(wrapper, 'Complete')).toBeUndefined();
			expect(findButtonByLabel(wrapper, 'Start')).toBeUndefined();
			expect(findButtonByLabel(wrapper, 'Sync Matches')).toBeUndefined();
		});
	});

	describe('synced timestamp', () => {
		it('shows synced time on active rounds', async () => {
			const round = makeRound({
				lastSyncedAt: new Date('2026-01-01T10:00:00Z'),
			});
			const wrapper = await mountComponent({ round, activeRound: round });

			expect(wrapper.text()).toContain('Synced');
		});

		it('shows synced time on upcoming rounds', async () => {
			const round = makeRound({
				lastSyncedAt: new Date('2026-01-01T10:00:00Z'),
			});
			const wrapper = await mountComponent({ round });

			expect(wrapper.text()).toContain('Synced');
		});
	});
});
