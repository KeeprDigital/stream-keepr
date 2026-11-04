import type { RoundResponse } from '~~/shared/api';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { toWire } from '~~/test/helpers/fixtures';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import RoundListItem from '~/components/Round/ListItem.vue';

mockNuxtImport('navigateTo', () => vi.fn());

function makeRound(overrides: Partial<RoundResponse> = {}): RoundResponse {
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
		startedAt: null,
		durationMinutes: null,
		createdAt: new Date('2026-01-01'),
		updatedAt: new Date('2026-01-01'),
		...overrides,
	} as RoundResponse;
}

function mountRow(round: RoundResponse, isMeleeEvent = false) {
	return mount(RoundListItem, {
		props: { round, isMeleeEvent, eventId: 1 },
		global: { stubs: nuxtUiStubs },
	});
}

async function menuLabels(wrapper: ReturnType<typeof mountRow>) {
	await wrapper.get('[data-icon="i-lucide-ellipsis"]').trigger('click');
	return wrapper.findAll('[role="menuitem"]').map(item => item.text());
}

const syncedAt = new Date('2026-01-01T10:00:00Z');
const meleeRound = { externalSource: 'melee', externalId: 'ext-123' } as const;

describe('roundListItem', () => {
	// Only the Melee condition changes the menu; a Round's status never does.
	it.each([
		[
			'a manual Round',
			{},
			false,
			['Review Matches', 'Edit Round', 'Delete Round'],
		],
		[
			'an unsynced Melee Round',
			meleeRound,
			true,
			[
				'Review Matches',
				'Edit Round',
				'Switch to Manual Override',
				'Delete Round',
			],
		],
		[
			'a synced Melee Round',
			{ ...meleeRound, lastSyncedAt: syncedAt },
			true,
			[
				'Review Matches',
				'Edit Round',
				'Re-sync Matches',
				'Switch to Manual Override',
				'Delete Round',
			],
		],
		[
			'a Melee Round under manual override',
			{ ...meleeRound, lastSyncedAt: syncedAt, controlMode: 'manual_override' },
			true,
			['Review Matches', 'Edit Round', 'Delete Round'],
		],
	] as const)('offers %s its actions', async (_, overrides, isMeleeEvent, menu) => {
		const wrapper = mountRow(makeRound(overrides as Partial<RoundResponse>), isMeleeEvent);

		expect(await menuLabels(wrapper)).toEqual(menu);
	});

	// "Start now" is one click until the Round starts; after, restarting its clock waits in the menu (ADR-0066).
	it.each([
		[
			'an unstarted Round',
			{ durationMinutes: 50 },
			true,
			false,
			'50 min',
		],
		[
			'a started Round',
			{ durationMinutes: 50, startedAt: '2026-11-04T10:00:00.000Z' },
			false,
			true,
			'50 min · started',
		],
		[
			'an untimed Round',
			{},
			true,
			false,
			null,
		],
	] as const)('offers %s "Start now" and shows its timing', async (_, overrides, button, inMenu, timing) => {
		const wrapper = mountRow(makeRound(overrides as unknown as Partial<RoundResponse>));

		const startButton = wrapper.findAll('button').find(candidate => candidate.text() === 'Start now');
		expect(!!startButton).toBe(button);
		expect((await menuLabels(wrapper)).includes('Start now')).toBe(inMenu);
		const badge = wrapper.find('[data-testid="round-timing"]');
		expect(badge.exists()
			? badge.text()
			: null).toEqual(timing
			? expect.stringContaining(timing)
			: null);
	});

	it('asks to start the Round from its "Start now"', async () => {
		const round = makeRound();
		const wrapper = mountRow(round);

		await wrapper.findAll('button').find(candidate => candidate.text() === 'Start now')!.trigger('click');

		expect(wrapper.emitted('startRound')).toEqual([
			[round],
		]);
	});

	it('renders no sync badge until the Round has been synced', () => {
		expect(mountRow(makeRound()).text()).not.toContain('Synced');
	});

	// The client reads Rounds with `$fetch`, so `lastSyncedAt` arrives as an ISO string (#272).
	it('formats the sync time as the wire delivers it', () => {
		const round = toWire(makeRound({
			lastSyncedAt: new Date(Date.now() - 125 * 60 * 1000),
		}));
		expect(typeof round.lastSyncedAt).toBe('string');

		const wrapper = mountRow(round as unknown as RoundResponse);

		expect(wrapper.text()).toContain('Synced 2h ago');
	});
});
