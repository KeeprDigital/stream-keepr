import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '~~/test/helpers/deferred';
import { createMockUiArchetype } from '~~/test/helpers/fixtures';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import ArchetypeChartSeriesField from '~/components/Metagame/ArchetypeChartSeriesField.vue';

const mockRepo = vi.hoisted(() => ({
	list: vi.fn(),
	getById: vi.fn(),
	create: vi.fn(),
	update: vi.fn(),
	remove: vi.fn(),
}));

vi.mock('~/modules/event-data/client', async importOriginal => ({
	...(await importOriginal<typeof import('~~/app/modules/event-data/client')>()),
	useEventDataResource: () => mockRepo,
}));

mockNuxtImport('useMetagameStore', () => () => ({
	applyRemoteInvalidated: vi.fn(),
	$reset: vi.fn(),
}));
mockNuxtImport('usePlayerDeckStore', () => () => ({
	applyArchetypeUpdated: vi.fn(),
	applyArchetypeDeleted: vi.fn(),
}));
mockNuxtImport('useFeatureMatchStore', () => () => ({
	loadFeatureMatchesByEventId: vi.fn(),
}));

const BOROS = createMockUiArchetype({
	id: 4,
	eventId: 99,
	name: 'Boros Energy',
	chartSeries: 3,
});
const ZOO = createMockUiArchetype({
	id: 7,
	eventId: 99,
	name: 'Domain Zoo',
	chartSeries: null,
});

async function mountField(archetypeId = ZOO.id) {
	const store = useArchetypeStore();
	store.$reset();
	mockRepo.list.mockResolvedValue([
		{ ...BOROS },
		{ ...ZOO },
	]);
	const wrapper = mount(ArchetypeChartSeriesField, {
		props: { eventId: 99, archetypeId },
		global: { stubs: nuxtUiStubs },
	});
	await flushPromises();
	return { wrapper, store };
}

function select(wrapper: Awaited<ReturnType<typeof mountField>>['wrapper']) {
	return wrapper.get<HTMLSelectElement>('select[aria-label="Chart series"]');
}

describe('metagame ArchetypeChartSeriesField', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it.each([
		[
			'pins a series',
			ZOO.id,
			'Series 5',
			{ chartSeries: 5 },
			5,
		],
		[
			'clears a pin',
			BOROS.id,
			'None',
			{ chartSeries: null },
			null,
		],
	] as const)('%s through the Archetype write, showing it while the save is pending', async (_case, archetypeId, option, sent, shown) => {
		const save = deferred<unknown>();
		mockRepo.update.mockReturnValue(save.promise);
		const { wrapper, store } = await mountField(archetypeId);

		const value = [
			...select(wrapper).element.options,
		].find(item => item.text.startsWith(option))!.value;
		await select(wrapper).setValue(value);

		expect(mockRepo.update).toHaveBeenCalledWith(99, archetypeId, sent);
		expect(store.archetypes.find(archetype => archetype.id === archetypeId)?.chartSeries).toBe(shown);
		expect(select(wrapper).element.selectedOptions[0]!.text).toMatch(new RegExp(`^${option}`));

		save.resolve({
			...store.archetypes.find(archetype => archetype.id === archetypeId),
			chartSeries: shown,
		});
		await flushPromises();
	});

	it('names the Archetype already pinning a series beside it', async () => {
		const { wrapper } = await mountField();

		expect([
			...select(wrapper).element.options,
		].map(option => option.text)).toContain('Series 3 (pinned by Boros Energy)');
	});

	it.each([
		['warns when the pin is already taken', 3, 'Boros Energy'],
		['stays quiet for a series no other Archetype pins', 5, null],
	] as const)('%s', async (_case, chartSeries, warnedAbout) => {
		mockRepo.update.mockImplementation(async (_eventId: number, id: number, input: object) => ({
			...ZOO,
			id,
			...input,
		}));
		const { wrapper } = await mountField();

		await select(wrapper).setValue([
			...select(wrapper).element.options,
		].find(option => option.text.startsWith(`Series ${chartSeries}`))!.value);
		await flushPromises();

		const warning = wrapper.find('[data-testid="chart-series-taken"]');
		expect(warning.exists()).toBe(warnedAbout != null);
		if (warnedAbout)
			expect(warning.text()).toContain(warnedAbout);
	});
});
