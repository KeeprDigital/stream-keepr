import type { Wire } from '~~/test/helpers/fixtures';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { toWire } from '~~/test/helpers/fixtures';

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

/** Mirrors `RoundResponse` as it is *declared* — Dates and all (shared/api/index.ts). */
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

/**
 * And what the same response is by the time this component sees it.
 *
 * The rounds this list renders are read by a client-side `$fetch`, which JSON
 * round-trips every field — so the `Date` the response type promises arrives as an
 * ISO string, and has for as long as the read has been client-side (#272, #284).
 * Every fixture above takes the declaration at its word, which is why the divergence
 * had never been rendered here.
 *
 * `Wire` and `toWire` are the shared helpers for that question (test/helpers/fixtures.ts,
 * #296) — this suite builds its own round rather than using `createWireMockRound`
 * because the props it needs are the component's, not a `DbRound`'s.
 */
type WireRound = Wire<RoundProps>;

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

/** The round the wire delivers: the fixture above, put through Nitro's JSON serialisation. */
function makeWireRound(overrides?: Partial<RoundProps>): WireRound {
	return toWire(makeRound(overrides));
}

async function mountComponent(props: {
	round: RoundProps | WireRound;
	activeRound?: RoundProps | WireRound;
	isMeleeEvent?: boolean;
	isNextActionableRound?: boolean;
	eventId?: number;
}) {
	const { default: RoundListItem } = await import('~/components/Round/ListItem.vue');

	return mount(RoundListItem, {
		props: {
			// The cast is the divergence, written down. This component's `round` prop is
			// typed `RoundResponse`, which declares `Date`s the wire does not carry — so
			// the shape production actually hands it cannot be expressed in the prop type,
			// and a fixture that satisfies the type is a fixture production never sends
			// (#272). Casting here rather than widening `RoundResponse` keeps the argument
			// where it belongs: the declaration is what is wrong, not the fixture.
			round: props.round as RoundProps,
			activeRound: props.activeRound as RoundProps,
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

		/**
		 * The same badge, on the shape production delivers — and asserting what it says
		 * rather than that it is there.
		 *
		 * Two holes, one row. `formatSyncTime` had only ever been handed a real `Date`,
		 * so `const d = date as Date` in place of `new Date(date)` survived every test in
		 * this file; under the ISO string the wire sends it throws `d.getTime is not a
		 * function` and the badge renders nothing at all. And the three tests above assert
		 * only the static `Synced` label beside the interpolation, so the formatted value
		 * itself was unasserted in any shape (#291, #284, #272).
		 *
		 * The hours rung on purpose: `formatSyncTime` and `formatSyncTimestamp`
		 * (app/utils/meleeSync.ts) are the same ladder written twice and differ only at
		 * 'just now'/'Just now' and ''/'Never', so pinning `2h ago` pins output both
		 * copies agree on and leaves a later consolidation free to happen.
		 */
		it('formats the sync time the wire delivers, not the Date the response type promises', async () => {
			const round = makeWireRound({ lastSyncedAt: new Date(Date.now() - 125 * 60 * 1000) });
			// The row's own control: a fixture that is still a Date proves nothing here.
			expect(typeof round.lastSyncedAt).toBe('string');

			const wrapper = await mountComponent({ round });

			expect(wrapper.text()).toContain('Synced 2h ago');
			expect(wrapper.text()).not.toContain('Invalid Date');
			expect(wrapper.text()).not.toContain('NaN');
		});
	});
});
