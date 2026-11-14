import type { EffectScope } from 'vue';
import type { SocialProfileProjectionValue } from '~~/shared/types/graphics';
import type { ScreenOutputTalent } from '~~/shared/types/screenOutputReads';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeEventChannel } from '~~/test/helpers/realtime-mock';
import { screenContextOf } from '~~/test/nuxt/helpers/screenContext';

const defaultConfig = {
	selection: 'one' as 'one' | 'lineup',
	talentId: null as number | null,
	talentIds: [] as number[],
	showPhoto: true,
	socialNetworks: [
		'twitch',
		'youtube',
		'x',
		'instagram',
		'tiktok',
		'bluesky',
	] as string[],
	rotateSocialProfiles: false,
	socialProfileDwellMs: 8000,
	showHeader: false,
	headerText: undefined as string | undefined,
};

const mutableConfig = reactive({ ...defaultConfig });
const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));
const realtime = createFakeEventChannel();
const { deliver } = realtime;
const serverTime = {
	isSynced: ref(true),
	serverTimeOffset: ref(0),
};

mockNuxtImport('$fetch', () => mockFetch);
mockNuxtImport('tryUseRealtime', () => () => realtime.transport);
mockNuxtImport('useScreenModeConfig', () => () => computed(() => mutableConfig));
mockNuxtImport('useServerTime', async () => (await import('~~/test/nuxt/helpers/serverTime')).fakeServerTime(() => ({
	...serverTime,
})));
const screenContext = screenContextOf({
	screen: ref({ id: 1, name: 'Desk' }),
	eventId: ref<number | null>(1),
});

const HOST = 7;
const CASTER = 8;

function profile(network: SocialProfileProjectionValue['network']): SocialProfileProjectionValue {
	return {
		network,
		networkLabel: network,
		handle: `${network}-handle`,
		profileUrl: `https://example.test/${network}`,
	};
}

function talent(id: number, name: string, socialProfiles: SocialProfileProjectionValue[] = []): ScreenOutputTalent {
	return {
		id,
		name,
		role: null,
		photo: null,
		socialProfiles,
	};
}

const scopes: EffectScope[] = [];

function makeTalentModeData() {
	const scope = effectScope();
	const result = scope.run(() => useTalentModeData(screenContext))!;
	scopes.push(scope);
	return result;
}

describe('useTalentModeData', () => {
	beforeEach(() => {
		Object.assign(mutableConfig, defaultConfig, { talentIds: [] });
		realtime.reset();
		mockFetch.mockReset();
		serverTime.isSynced.value = true;
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		scopes.splice(0).forEach(scope => scope.stop());
		vi.useRealTimers();
	});

	it('reads the Talents it shows through the Screen, in order', async () => {
		Object.assign(mutableConfig, {
			selection: 'lineup',
			talentIds: [CASTER, HOST],
		});
		mockFetch.mockResolvedValue({
			talents: [
				talent(CASTER, 'Caster'),
				talent(HOST, 'Host'),
			],
		});

		const { talents, isEmpty } = makeTalentModeData();
		await flushPromises();

		expect(mockFetch).toHaveBeenCalledWith('/api/screen-output/events/1/screens/1/talent', expect.anything());
		expect(talents.value.map(entry => entry.name)).toEqual(['Caster', 'Host']);
		expect(isEmpty.value).toBe(false);
	});

	it.each([
		[
			'one Talent with none picked',
			{
				selection: 'one',
				talentId: null,
				talentIds: [HOST],
			},
		],
		[
			'a lineup with none picked',
			{ selection: 'lineup', talentId: HOST, talentIds: [] },
		],
	])('reads nothing and is empty while showing %s', async (_case, config) => {
		Object.assign(mutableConfig, config);

		const { isEmpty } = makeTalentModeData();
		await flushPromises();

		expect(mockFetch).not.toHaveBeenCalled();
		expect(isEmpty.value).toBe(true);
	});

	it.each([
		[
			'the Talent picked',
			{ talentId: CASTER },
		],
		[
			'the selection',
			{
				selection: 'lineup',
				talentIds: [HOST, CASTER],
			},
		],
		[
			'the networks shown',
			{
				socialNetworks: ['x'],
			},
		],
		[
			'whether photos show',
			{ showPhoto: false },
		],
	])('re-reads when %s changes', async (_case, change) => {
		mutableConfig.talentId = HOST;
		mockFetch.mockResolvedValue({
			talents: [
				talent(HOST, 'Host'),
			],
		});
		makeTalentModeData();
		await flushPromises();
		mockFetch.mockClear();

		Object.assign(mutableConfig, change);
		await flushPromises();

		expect(mockFetch).toHaveBeenCalledTimes(1);
	});

	it.each([
		[
			'an edit of a Talent it shows',
			'talent:updated',
			{
				talent: { id: HOST },
			},
			1,
		],
		[
			'an edit of another Talent',
			'talent:updated',
			{
				talent: { id: CASTER },
			},
			0,
		],
	])('re-reads on %s: %i', async (_case, type, payload, reads) => {
		mutableConfig.talentId = HOST;
		mockFetch.mockResolvedValue({
			talents: [
				talent(HOST, 'Host'),
			],
		});
		makeTalentModeData();
		await flushPromises();
		mockFetch.mockClear();

		deliver(type, payload);
		await flushPromises();

		expect(mockFetch).toHaveBeenCalledTimes(reads);
	});

	it('shows every Social Profile while not rotating', async () => {
		mutableConfig.talentId = HOST;
		mockFetch.mockResolvedValue({
			talents: [
				talent(HOST, 'Host', [
					profile('twitch'),
					profile('x'),
				]),
			],
		});

		const { talents } = makeTalentModeData();
		await flushPromises();

		expect(talents.value[0]!.shownProfiles.map(entry => entry.network)).toEqual(['twitch', 'x']);
	});

	it('rotates each Talent through its own Social Profiles in step with server time', async () => {
		vi.useFakeTimers({
			toFake: ['setTimeout', 'clearTimeout', 'Date'],
		});
		vi.setSystemTime(80_000);
		Object.assign(mutableConfig, {
			selection: 'lineup',
			talentIds: [HOST, CASTER],
			rotateSocialProfiles: true,
		});
		mockFetch.mockResolvedValue({
			talents: [
				talent(HOST, 'Host', [
					profile('twitch'),
					profile('x'),
				]),
				talent(CASTER, 'Caster', [
					profile('youtube'),
					profile('tiktok'),
					profile('bluesky'),
				]),
			],
		});

		const { talents } = makeTalentModeData();
		await flushPromises();
		const shown = () => talents.value.map(entry => entry.shownProfiles.map(shownProfile => shownProfile.network));
		// Step 10 of 8 s from epoch zero.
		expect(shown()).toEqual([
			['twitch'],
			['tiktok'],
		]);

		await vi.advanceTimersByTimeAsync(8000);
		expect(shown()).toEqual([
			['x'],
			['bluesky'],
		]);
	});

	it('holds the first Social Profile while server time is unknown', async () => {
		vi.useFakeTimers({
			toFake: ['setTimeout', 'clearTimeout', 'Date'],
		});
		vi.setSystemTime(8000);
		serverTime.isSynced.value = false;
		Object.assign(mutableConfig, { talentId: HOST, rotateSocialProfiles: true });
		mockFetch.mockResolvedValue({
			talents: [
				talent(HOST, 'Host', [
					profile('twitch'),
					profile('x'),
				]),
			],
		});

		const { talents } = makeTalentModeData();
		await flushPromises();

		expect(talents.value[0]!.shownProfiles.map(entry => entry.network)).toEqual(['twitch']);
	});

	it('falls back to a generic header', () => {
		expect(makeTalentModeData().headerText.value).toBe('On the Desk');
		mutableConfig.headerText = 'Your Casters';
		expect(makeTalentModeData().headerText.value).toBe('Your Casters');
	});
});
