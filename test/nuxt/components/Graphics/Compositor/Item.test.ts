import type { PlayerLifeAnimation } from '~~/shared/types/graphics';
import type {
	GraphicItemRenderDescriptor,
	GraphicMediaIncompatibilityNoticeDescriptor,
} from '~/modules/graphics/renderModel';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';

enableAutoUnmount(afterEach);

function lifeDescriptor(text: string, animation: PlayerLifeAnimation = 'glow'): GraphicItemRenderDescriptor {
	return {
		id: 'life',
		label: 'Life',
		kind: 'player-life',
		style: { position: 'absolute' },
		textStyle: { fontSize: '64px' },
		text,
		textSegments: [{ text }],
		lifeChange: { animation, durationMs: 420, accentColor: '#ffffff' },
	};
}

async function mountItem(render: GraphicItemRenderDescriptor) {
	const componentPath = '../../../../../app/components/Graphics/Compositor/Item.vue';
	const { default: Item } = await import(componentPath);

	return mount(Item, { props: { render } });
}

/**
 * The `<p>` is re-keyed to restart the CSS animation, so a *new element* is the
 * evidence that the animation ran — the class alone is present either way.
 */
function lifeParagraph(wrapper: Awaited<ReturnType<typeof mountItem>>) {
	return wrapper.get('p').element;
}

function lifeClasses(wrapper: Awaited<ReturnType<typeof mountItem>>) {
	return wrapper.get('p').classes();
}

describe('graphicsCompositorItem player life', () => {
	it('animates a life total changing', async () => {
		const wrapper = await mountItem(lifeDescriptor('20'));
		const before = lifeParagraph(wrapper);

		await wrapper.setProps({ render: lifeDescriptor('19') });
		await nextTick();

		// A re-keyed element is a new node, which is what restarts the CSS animation.
		expect(lifeParagraph(wrapper)).not.toBe(before);
		expect(lifeClasses(wrapper)).toContain('graphics-compositor-item--life-glow');
	});

	it('animates the second change as well as the first', async () => {
		// The whole point of the key is that a CSS animation only runs on a new
		// element. A guard that consumed the first change would make this pass while
		// the first one silently did nothing.
		const wrapper = await mountItem(lifeDescriptor('20'));

		await wrapper.setProps({ render: lifeDescriptor('19') });
		await nextTick();
		const afterFirst = lifeParagraph(wrapper);

		await wrapper.setProps({ render: lifeDescriptor('18') });
		await nextTick();

		expect(lifeParagraph(wrapper)).not.toBe(afterFirst);
	});

	it('does not animate the session"s first total arriving', async () => {
		// A Player Life renders nothing until the session holds a total. An output
		// joining mid-match must not flash every total the moment it connects.
		const wrapper = await mountItem(lifeDescriptor(''));
		const before = lifeParagraph(wrapper);

		await wrapper.setProps({ render: lifeDescriptor('20') });
		await nextTick();

		expect(lifeParagraph(wrapper)).toBe(before);
	});

	it('does not animate a total disappearing', async () => {
		const wrapper = await mountItem(lifeDescriptor('20'));
		const before = lifeParagraph(wrapper);

		await wrapper.setProps({ render: lifeDescriptor('') });
		await nextTick();

		expect(lifeParagraph(wrapper)).toBe(before);
	});

	it('never animates while the authored animation is none', async () => {
		const wrapper = await mountItem(lifeDescriptor('20', 'none'));
		const before = lifeParagraph(wrapper);

		await wrapper.setProps({ render: lifeDescriptor('19', 'none') });
		await nextTick();

		expect(lifeParagraph(wrapper)).toBe(before);
		expect(lifeClasses(wrapper).join(' ')).not.toContain('graphics-compositor-item--life');
	});
});

/**
 * What an output shows for a silent video its browser cannot play (#98).
 *
 * These mount under the test runtime's own user agent, which is not Chromium —
 * exactly the case the diagnostic exists for. Nothing here stubs the target: the
 * component asks its runtime, and that is the fact being exercised.
 */
describe('graphicsCompositorItem blocked silent video', () => {
	function videoDescriptor(
		notice?: GraphicMediaIncompatibilityNoticeDescriptor,
	): GraphicItemRenderDescriptor {
		return {
			id: 'sting',
			label: 'Sting',
			kind: 'media',
			style: { position: 'absolute', width: '480px', height: '270px' },
			media: {
				mediaKind: 'silent-video',
				src: '/api/screen-output/screens/9/assets/asset-1/revisions/revision-7/content',
				style: { display: 'block' },
				loop: true,
				playbackRate: 1,
				videoCompatibility: 'chromium-transparency',
				incompatibilityNotice: notice,
			},
		};
	}

	const notice = {
		code: 'vp9-alpha-chromium-required',
		text: 'Video needs Chromium (vp9-alpha-chromium-required)',
		style: { backgroundColor: 'rgba(0, 0, 0, 0.78)', color: '#ffffff' },
	} as const;

	it('reads as words rather than as a blank rectangle', async () => {
		const wrapper = await mountItem(videoDescriptor(notice));

		expect(wrapper.find('video').exists()).toBe(false);
		const blocked = wrapper.get('[data-video-compatibility-blocked="vp9-alpha-chromium-required"]');
		expect(blocked.text()).toBe('Video needs Chromium (vp9-alpha-chromium-required)');
		expect(blocked.attributes('style')).toContain('background-color');
	});

	it('paints nothing into the Key Output, which offers no notice to paint', async () => {
		// The Key Output renders composed opacity as the alpha matte, so a legible
		// notice there would key the message onto program.
		const wrapper = await mountItem(videoDescriptor(undefined));

		expect(wrapper.find('video').exists()).toBe(false);
		const blocked = wrapper.get('[data-video-compatibility-blocked="vp9-alpha-chromium-required"]');
		expect(blocked.text()).toBe('');
		expect(blocked.attributes('style')).toBeUndefined();
	});
});
