import type { ScreenVideoPlayback } from '~~/shared/types/screenConfig';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import MediaBackground from '~/components/Screen/MediaBackground.vue';

enableAutoUnmount(afterEach);

function video(url: string): ScreenVideoPlayback {
	return {
		url,
		fit: 'cover',
		opacity: 1,
		playbackRate: 1,
		loop: true,
	};
}

/** Each video's source, and whether it is still loading behind the one playing. */
function videos(wrapper: ReturnType<typeof mount>) {
	return wrapper.findAll('video').map(element => ({
		src: element.attributes('src'),
		loading: element.attributes('data-video-loading') === 'true',
	}));
}

describe('screenMediaBackground', () => {
	it.each([
		['has its first frame', 'loadeddata'],
		['fails', 'error'],
	])('keeps the playing video until a new source %s', async (_, event) => {
		const wrapper = mount(MediaBackground, {
			props: {
				video: video('/video/a.mp4'),
			},
		});

		await wrapper.setProps({
			video: video('/video/b.mp4'),
		});
		expect(videos(wrapper)).toEqual([
			{ src: '/video/a.mp4', loading: false },
			{ src: '/video/b.mp4', loading: true },
		]);

		await wrapper.findAll('video')[1]!.trigger(event);

		expect(videos(wrapper)).toEqual([
			{ src: '/video/b.mp4', loading: false },
		]);
	});

	it('drops a loading source when the playing one is chosen again', async () => {
		const wrapper = mount(MediaBackground, {
			props: {
				video: video('/video/a.mp4'),
			},
		});
		await wrapper.setProps({
			video: video('/video/b.mp4'),
		});

		await wrapper.setProps({
			video: video('/video/a.mp4'),
		});

		expect(videos(wrapper)).toEqual([
			{ src: '/video/a.mp4', loading: false },
		]);
	});
});
