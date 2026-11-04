import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { computed, ref } from 'vue';
import { UIconStub } from '~~/test/nuxt/helpers/nuxtUiStubs';
import Display from '~/components/Screen/Modes/Talent/Display.vue';

const config = ref<any>(null);
const error = ref<string | null>(null);
const isEmpty = ref(false);
const talents = ref<any[]>([]);
const contentUrlsSettled = ref(true);
const resolvedPhotos = ref<Array<{ assetId: string; revisionId: string }>>([]);

// The mode's data is faked, so nothing reads the Screen context it is handed.
mockNuxtImport('useScreenContext', () => () => ({}));
mockNuxtImport('useTalentModeData', () => () => ({
	config: computed(() => config.value),
	error: computed(() => error.value),
	ready: computed(() => true),
	isEmpty: computed(() => isEmpty.value),
	headerText: computed(() => 'On the Desk'),
	talents: computed(() => talents.value),
}));
mockNuxtImport('useScreenGraphicAssetContentUrls', () => (references: () => Array<{ assetId: string; revisionId: string }>) => {
	resolvedPhotos.value = references();
	return {
		contentUrl: (reference: { revisionId: string }) => `/content/${reference.revisionId}`,
		contentUrlsSettled,
	};
});

const PHOTO = { assetId: 'asset-1', revisionId: 'revision-1' };

function talent(id: number, name: string, overrides: Record<string, unknown> = {}) {
	return {
		id,
		name,
		role: null,
		photo: null,
		socialProfiles: [],
		shownProfiles: [],
		...overrides,
	};
}

function profile(network: string, handle: string) {
	return {
		network,
		networkLabel: network,
		handle,
		profileUrl: `https://example.test/${handle}`,
	};
}

function mountComponent() {
	return mount(Display, {
		global: {
			stubs: { UIcon: UIconStub },
		},
	});
}

describe('screenModesTalentDisplay', () => {
	beforeEach(() => {
		config.value = {
			layout: 'lowerThird',
			showPhoto: true,
			showRole: true,
			showHeader: false,
		};
		error.value = null;
		isEmpty.value = false;
		contentUrlsSettled.value = true;
		talents.value = [
			talent(7, 'Jordan Reyes', {
				role: 'Host',
				photo: PHOTO,
				shownProfiles: [
					profile('twitch', 'jordan'),
					profile('x', 'jordan_x'),
				],
			}),
			talent(8, 'Sam Okafor', { role: 'Commentator' }),
		];
	});

	it.each(['lowerThird', 'fullPanel'])('lays its Talents out as a %s, in order', (layout) => {
		config.value.layout = layout;
		const wrapper = mountComponent();

		expect(wrapper.get('[data-talent-layout]').attributes('data-talent-layout')).toBe(layout);
		expect(wrapper.findAll('[data-talent-name]').map(name => name.text())).toEqual(['Jordan Reyes', 'Sam Okafor']);
	});

	it('shows each Social Profile it is handed with its network icon and handle', () => {
		const wrapper = mountComponent();
		const profiles = wrapper.findAll('[data-talent-id="7"] [data-social-network]');

		expect(profiles.map(entry => [
			entry.attributes('data-social-network'),
			entry.text(),
		])).toEqual([
			['twitch', '@jordan'],
			['x', '@jordan_x'],
		]);
		expect(profiles[0]!.find('[data-icon]').attributes('data-icon')).toBe('i-simple-icons-twitch');
	});

	it.each([
		[
			true,
			['Host', 'Commentator'],
		],
		[false, []],
	])('shows each role while roles show: %s', (showRole, roles) => {
		config.value.showRole = showRole;

		expect(mountComponent().findAll('[data-talent-role]').map(role => role.text())).toEqual(roles);
	});

	it('shows a Talent\'s photo through the Screen\'s capability, and a placeholder without one', () => {
		const wrapper = mountComponent();

		expect(resolvedPhotos.value).toEqual([PHOTO]);
		expect(wrapper.get('[data-talent-id="7"] img').attributes('src')).toBe('/content/revision-1');
		expect(wrapper.get('[data-talent-id="8"] [data-talent-photo]').attributes('data-talent-photo')).toBe('none');
	});

	// The read answers no photo while photos are hidden.
	it('shows no photo, nor its placeholder, while photos are hidden', () => {
		config.value.showPhoto = false;
		talents.value = talents.value.map(talent => ({ ...talent, photo: null }));
		const wrapper = mountComponent();

		expect(resolvedPhotos.value).toEqual([]);
		expect(wrapper.find('[data-talent-photo]').exists()).toBe(false);
	});

	it('holds its rendering pending until the photos resolve', () => {
		contentUrlsSettled.value = false;

		expect(mountComponent().get('[data-talent-layout]').attributes()).toHaveProperty('data-render-pending');
	});

	it.each([
		[
			true,
			['On the Desk'],
		],
		[false, []],
	])('shows its header while the header shows: %s', (showHeader, headers) => {
		config.value.showHeader = showHeader;

		expect(mountComponent().findAll('h2').map(header => header.text())).toEqual(headers);
	});

	it('renders nothing while it shows no Talent', () => {
		isEmpty.value = true;

		expect(mountComponent().find('[data-talent-layout]').exists()).toBe(false);
	});
});
