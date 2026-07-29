import { describe, expect, it, vi } from 'vitest';
import { waitForPostSeekPresentedVideoFrame } from '~/utils/verifySilentVideoBrowserPlayback';

function videoFixture() {
	const target = new EventTarget() as HTMLVideoElement;
	Object.defineProperties(target, {
		currentTime: { value: 0.1, writable: true },
		readyState: { value: 2, writable: true },
	});
	return target;
}

describe('silent-video deterministic poster frame ordering', () => {
	it('does not settle until requestVideoFrameCallback presents the post-seek frame', async () => {
		const video = videoFixture();
		let callback: VideoFrameRequestCallback | undefined;
		video.requestVideoFrameCallback = vi.fn((next) => {
			callback = next;
			return 1;
		});
		let settled = false;
		const waiting = waitForPostSeekPresentedVideoFrame(video, 0.1, 1000)
			.then(() => {
				settled = true;
			});

		await Promise.resolve();
		expect(settled).toBe(false);
		callback!(0, {
			mediaTime: 0.1,
			presentationTime: 0,
			expectedDisplayTime: 0,
			presentedFrames: 1,
			processingDuration: 0,
			width: 16,
			height: 16,
		});
		await waiting;
		expect(settled).toBe(true);
	});

	it('times out deterministically when no post-seek frame is presented', async () => {
		vi.useFakeTimers();
		const video = videoFixture();
		video.requestVideoFrameCallback = vi.fn(() => 1);
		const waiting = waitForPostSeekPresentedVideoFrame(video, 0.1, 25);
		const rejected = expect(waiting).rejects.toThrow('post-seek frame presentation timed out');

		await vi.advanceTimersByTimeAsync(25);
		await rejected;
		vi.useRealTimers();
	});
});
