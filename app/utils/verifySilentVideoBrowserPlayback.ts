import type {
	GraphicAssetBrowserPlaybackEvidence,
	GraphicAssetSilentVideoFacts,
} from '~~/shared/types/graphicsAsset';
import { graphicsVideoTargetForUserAgent } from '~~/shared/utils/graphicAssetTargetCompatibility';

function waitForVideoEvent(
	video: HTMLVideoElement,
	eventName: 'loadedmetadata' | 'seeked',
	timeoutMilliseconds = 10_000,
) {
	return new Promise<void>((resolve, reject) => {
		let timeout: number | undefined;
		const controller = new AbortController();
		const finish = (work: () => void) => {
			window.clearTimeout(timeout);
			controller.abort();
			work();
		};
		const onReady = () => finish(resolve);
		const onError = () => finish(() => reject(new Error(`Video ${eventName} failed.`)));
		video.addEventListener(eventName, onReady, { once: true, signal: controller.signal });
		video.addEventListener('error', onError, { once: true, signal: controller.signal });
		timeout = window.setTimeout(
			() => finish(() => reject(new Error(`Video ${eventName} timed out.`))),
			timeoutMilliseconds,
		);
	});
}

async function sha256(source: Blob) {
	return Array.from(
		new Uint8Array(await crypto.subtle.digest('SHA-256', await source.arrayBuffer())),
		byte => byte.toString(16).padStart(2, '0'),
	).join('');
}

async function pngBlob(canvas: HTMLCanvasElement) {
	return await new Promise<Blob>((resolve, reject) => {
		canvas.toBlob(
			blob => blob ? resolve(blob) : reject(new Error('Video poster PNG encoding failed.')),
			'image/png',
		);
	});
}

export async function verifySilentVideoBrowserPlayback(
	source: Blob,
	facts: GraphicAssetSilentVideoFacts,
): Promise<{
	evidence: GraphicAssetBrowserPlaybackEvidence;
	poster?: Blob;
}> {
	const sourceDigest = await sha256(source);
	const family = graphicsVideoTargetForUserAgent(navigator.userAgent);
	const video = document.createElement('video');
	const objectUrl = URL.createObjectURL(source);
	video.muted = true;
	video.defaultMuted = true;
	video.playsInline = true;
	video.preload = 'auto';
	video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none';
	document.body.appendChild(video);
	let stage: Extract<GraphicAssetBrowserPlaybackEvidence, { outcome: 'video-rejected' }>['stage'] = 'metadata';
	try {
		const metadata = waitForVideoEvent(video, 'loadedmetadata');
		video.src = objectUrl;
		video.load();
		await metadata;
		if (
			video.videoWidth < 1
			|| video.videoHeight < 1
			|| !Number.isFinite(video.duration)
			|| video.duration <= 0
		) {
			throw new Error('Browser returned invalid silent video metadata.');
		}

		stage = 'playback';
		await video.play();
		await new Promise(resolve => window.setTimeout(resolve, 50));
		video.pause();

		stage = 'seek';
		const seeked = waitForVideoEvent(video, 'seeked');
		video.currentTime = facts.posterTimeSeconds;
		await seeked;

		stage = 'poster';
		const scale = Math.min(1, 640 / video.videoWidth, 360 / video.videoHeight);
		const width = Math.max(1, Math.round(video.videoWidth * scale));
		const height = Math.max(1, Math.round(video.videoHeight * scale));
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext('2d', {
			alpha: true,
			willReadFrequently: facts.hasAlpha,
		});
		if (!context)
			throw new Error('Browser could not create a video poster canvas.');
		context.clearRect(0, 0, width, height);
		context.drawImage(video, 0, 0, width, height);

		let transparencyRendered = false;
		if (facts.hasAlpha) {
			stage = 'transparency';
			if (family !== 'chromium')
				throw new Error('VP9 alpha is restricted to proven Chromium targets.');
			const pixels = context.getImageData(0, 0, width, height).data;
			for (let offset = 3; offset < pixels.length; offset += 4) {
				if (pixels[offset]! < 255) {
					transparencyRendered = true;
					break;
				}
			}
			if (!transparencyRendered)
				throw new Error('Chromium did not render VP9 transparency.');
		}

		const poster = await pngBlob(canvas);
		return {
			evidence: {
				outcome: 'video-played',
				sourceDigest,
				width: video.videoWidth,
				height: video.videoHeight,
				durationSeconds: video.duration,
				posterTimeSeconds: facts.posterTimeSeconds,
				posterDigest: await sha256(poster),
				browserFamily: family,
				transparencyRendered,
			},
			poster,
		};
	}
	catch {
		return {
			evidence: {
				outcome: 'video-rejected',
				sourceDigest,
				browserFamily: family,
				stage,
			},
		};
	}
	finally {
		video.remove();
		URL.revokeObjectURL(objectUrl);
	}
}
