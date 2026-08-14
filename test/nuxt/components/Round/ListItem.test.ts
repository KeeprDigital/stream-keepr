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

/**
 * The dropdown is where every action this row offers lives (`menuItems`,
 * ListItem.vue:20-46), so the stub surfaces the labels it was handed rather than
 * discarding them. Without them a test can see only the row's two icon-only
 * controls — which is how nineteen assertions about actions came to be written
 * against a button-text search that could never match anything (#333).
 */
const UDropdownMenuStub = defineComponent({
	props: { items: { type: Array, required: false, default: () => [] } },
	computed: {
		labels(): string[] {
			return (this.items as { label: string }[][]).flat().map(item => item.label);
		},
	},
	template: '<div data-testid="dropdown"><span v-for="label in labels" :key="label" data-testid="menu-item">{{ label }}</span><slot /></div>',
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
	isMeleeEvent?: boolean;
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
			isMeleeEvent: props.isMeleeEvent ?? false,
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

/** The text on every control the row renders itself — both of which are icon-only. */
function inlineButtonText(wrapper: ReturnType<typeof mount>) {
	return wrapper.findAll('button').map(button => button.text());
}

/** Every action the row offers, in the order its dropdown lists them. */
function menuItemLabels(wrapper: ReturnType<typeof mount>) {
	return wrapper.findAll('[data-testid="menu-item"]').map(item => item.text());
}

/**
 * One row per round state this file used to mount, and the actions the row offers in
 * each — including two Melee states it never covered, which are what stop the
 * assertions below reading as "the menu is always the same three things".
 *
 * The `status` values are carried because the states are named after them, not
 * because the component reads one: it does not, and that is itself the claim these
 * cases make. What does change the menu is the Melee condition (`menuItems`,
 * ListItem.vue:20-46).
 */
const ROUND_STATE_CASES = [
	{
		name: 'an active round',
		overrides: { status: 'active' } as Partial<RoundProps>,
		isMeleeEvent: false,
		menu: ['Review Matches', 'Edit Round', 'Delete Round'],
		syncedBadge: false,
	},
	{
		name: 'an upcoming round',
		overrides: { status: 'upcoming' } as Partial<RoundProps>,
		isMeleeEvent: false,
		menu: ['Review Matches', 'Edit Round', 'Delete Round'],
		syncedBadge: false,
	},
	{
		name: 'a completed round that has been synced',
		overrides: { status: 'completed', lastSyncedAt: new Date('2026-01-01T10:00:00Z') } as Partial<RoundProps>,
		isMeleeEvent: false,
		menu: ['Review Matches', 'Edit Round', 'Delete Round'],
		syncedBadge: true,
	},
	{
		name: 'a skipped round',
		overrides: { status: 'skipped' } as Partial<RoundProps>,
		isMeleeEvent: false,
		menu: ['Review Matches', 'Edit Round', 'Delete Round'],
		syncedBadge: false,
	},
	{
		name: 'an unsynced Melee round in a Melee event',
		overrides: { externalSource: 'melee', externalId: 'ext-123', lastSyncedAt: null } as Partial<RoundProps>,
		isMeleeEvent: true,
		menu: ['Review Matches', 'Edit Round', 'Switch to Manual Override', 'Delete Round'],
		syncedBadge: false,
	},
	{
		name: 'a synced Melee round in a Melee event',
		overrides: {
			externalSource: 'melee',
			externalId: 'ext-123',
			lastSyncedAt: new Date('2026-01-01T10:00:00Z'),
		} as Partial<RoundProps>,
		isMeleeEvent: true,
		menu: ['Review Matches', 'Edit Round', 'Re-sync Matches', 'Switch to Manual Override', 'Delete Round'],
		syncedBadge: true,
	},
	{
		name: 'a Melee round switched to manual override',
		overrides: {
			externalSource: 'melee',
			externalId: 'ext-123',
			controlMode: 'manual_override',
			lastSyncedAt: new Date('2026-01-01T10:00:00Z'),
		} as Partial<RoundProps>,
		isMeleeEvent: true,
		menu: ['Review Matches', 'Edit Round', 'Delete Round'],
		syncedBadge: true,
	},
];

describe('roundListItem', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	/**
	 * What this file used to assert here, and why none of it bit (#333).
	 *
	 * Seven `it` blocks titled after inline lifecycle buttons made nineteen
	 * `findButtonByLabel(...)).toBeUndefined()` assertions, and every one of them was
	 * vacuous twice over. The row's only two controls are icon-only (ListItem.vue:73-86),
	 * so a `.text().includes('Start')` search could not match under *any* input; and the
	 * mount set `activeRound` and `isNextActionableRound`, props the component has never
	 * declared, so the states the titles named were not being set up either. No 'Start'
	 * or 'Complete' label exists anywhere under `app/`.
	 *
	 * Restated against what the row actually renders: two controls carrying no text, and
	 * the dropdown's own labels. A lifecycle action arriving inline or in the menu now
	 * fails these.
	 */
	it.each(ROUND_STATE_CASES)(
		'offers $name two icon-only controls and no round-lifecycle action',
		async ({ overrides, isMeleeEvent, menu, syncedBadge }) => {
			const wrapper = await mountComponent({ round: makeRound(overrides), isMeleeEvent });

			expect(inlineButtonText(wrapper)).toEqual(['', '']);
			expect(menuItemLabels(wrapper)).toEqual(menu);
			expect(wrapper.text().includes('Synced')).toBe(syncedBadge);
		},
	);

	describe('synced timestamp', () => {
		/**
		 * The `v-if` is the reason the local ladder's '' rung was never observable, and
		 * #329 rests on that: the shared `formatSyncTimestamp` answers 'Never' where the
		 * component's own copy answered '', and the badge renders only under
		 * `v-if="round.lastSyncedAt"` (ListItem.vue:63), so the falsy case never reaches
		 * the formatter. Pinned here rather than left standing as an argument — remove the
		 * `v-if` and an unsynced round starts announcing 'Synced Never'.
		 */
		it('renders no badge at all until the round has been synced', async () => {
			const wrapper = await mountComponent({ round: makeRound({ lastSyncedAt: null }) });

			expect(wrapper.text()).not.toContain('Synced');
			expect(wrapper.text()).not.toContain('Never');
		});

		/**
		 * The one observable change #329 made. The two ladders spelled every other rung
		 * identically; under a minute the component said 'just now' and the shared
		 * formatter says 'Just now'. `toContain` is case-sensitive, so restoring the local
		 * copy fails this.
		 */
		it('says Just now under a minute, in the shared formatter\'s casing', async () => {
			const round = makeWireRound({ lastSyncedAt: new Date(Date.now() - 5 * 1000) });

			const wrapper = await mountComponent({ round });

			expect(wrapper.text()).toContain('Synced Just now');
		});

		/**
		 * The same badge, on the shape production delivers — and asserting what it says
		 * rather than that it is there.
		 *
		 * Two holes, one row. The component's own `formatSyncTime` had only ever been
		 * handed a real `Date`, so `const d = date as Date` in place of `new Date(date)`
		 * survived every test in this file; under the ISO string the wire sends it threw
		 * `d.getTime is not a function` and the badge rendered nothing at all. And the
		 * tests above asserted only the static `Synced` label beside the interpolation, so
		 * the formatted value itself was unasserted in any shape (#291, #284, #272).
		 *
		 * The hours rung was chosen when there were two ladders to satisfy: `formatSyncTime`
		 * and `formatSyncTimestamp` (app/utils/meleeSync.ts) were the same ladder written
		 * twice, and `2h ago` was output both copies agreed on — so the pin left #329's
		 * consolidation free to happen. It has happened; the row stands as the wire-shape
		 * guard it always was.
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
