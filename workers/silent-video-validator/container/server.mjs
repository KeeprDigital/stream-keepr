import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

/**
 * Pinned native validation tooling for silent-video Graphic Asset Revisions.
 *
 * One validation request carries the exact staged source bytes plus the
 * inspected facts to verify. The server proves, in order: byte identity
 * (SHA-256 and length), container/codec identity (ffprobe), complete decode
 * (ffmpeg), muted inline playback with deterministic seeks and VP9-alpha
 * transparency (headless Chromium over CDP), and finally produces the
 * deterministic transparent PNG poster (ffmpeg). Responses are JSON facts with
 * the poster as base64; binary payloads never persist beyond the request.
 */

const PORT = 8080;
const CHROMIUM_BINARY = process.env.CHROMIUM_BIN ?? '/usr/bin/chromium';
const PAGE_DEADLINE_MILLISECONDS = 90_000;
const DURATION_TOLERANCE_SECONDS = 0.05;

let activeSession;

function rejection(stage, detail) {
	return { outcome: 'rejected', stage, detail };
}

function run(command, args, { collectStdout = true } = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
		let stdout = '';
		let stderr = '';
		if (collectStdout)
			child.stdout.setEncoding('utf8').on('data', chunk => stdout += chunk);
		child.stderr.setEncoding('utf8').on('data', chunk => stderr += chunk);
		child.once('error', reject);
		child.once('exit', code => resolve({ code, stdout, stderr }));
	});
}

async function receiveSource(request, sourcePath, expected) {
	const hash = createHash('sha256');
	let byteLength = 0;
	const file = createWriteStream(sourcePath);
	await new Promise((resolve, reject) => {
		request.on('data', (chunk) => {
			byteLength += chunk.byteLength;
			if (byteLength > expected.sourceByteLength) {
				request.destroy();
				reject(new Error('oversized'));
				return;
			}
			hash.update(chunk);
			if (!file.write(chunk))
				request.pause();
		});
		file.on('drain', () => request.resume());
		request.once('end', () => file.end(resolve));
		request.once('error', reject);
		file.once('error', reject);
	});
	return { byteLength, sha256: hash.digest('hex') };
}

function decoderArguments(expected) {
	// Chromium's native VP9 pipeline and ffmpeg's libvpx-vp9 both decode the
	// alpha plane; ffmpeg's built-in vp9 decoder silently drops it.
	return expected.codec === 'vp9' ? ['-c:v', 'libvpx-vp9'] : [];
}

async function verifyContainerIdentity(sourcePath, expected) {
	const probe = await run('ffprobe', [
		'-v',
		'error',
		'-of',
		'json',
		'-show_format',
		'-show_streams',
		sourcePath,
	]);
	if (probe.code !== 0)
		return rejection('metadata', `ffprobe failed: ${probe.stderr.trim()}`);
	let parsed;
	try {
		parsed = JSON.parse(probe.stdout);
	}
	catch {
		return rejection('metadata', 'ffprobe output was not JSON');
	}
	const formatName = parsed.format?.format_name ?? '';
	const expectedFormat = expected.format === 'mp4'
		? formatName.split(',').includes('mp4')
		: formatName.split(',').includes('webm') || formatName.split(',').includes('matroska');
	if (!expectedFormat)
		return rejection('metadata', `Container format ${formatName} does not match ${expected.format}`);
	const streams = parsed.streams ?? [];
	const videoStreams = streams.filter(stream => stream.codec_type === 'video');
	if (videoStreams.length !== 1 || streams.length !== 1)
		return rejection('metadata', 'Source must contain exactly one video stream');
	const video = videoStreams[0];
	const expectedCodec = expected.codec === 'h264' ? 'h264' : 'vp9';
	if (video.codec_name !== expectedCodec)
		return rejection('metadata', `Codec ${video.codec_name} does not match ${expectedCodec}`);
	if (video.width !== expected.width || video.height !== expected.height)
		return rejection('metadata', `Dimensions ${video.width}x${video.height} do not match inspection`);
	const duration = Number(video.duration ?? parsed.format?.duration);
	if (
		!Number.isFinite(duration)
		|| Math.abs(duration - expected.durationSeconds) > DURATION_TOLERANCE_SECONDS
	) {
		return rejection('metadata', `Duration ${duration} does not match inspection`);
	}
	return { duration };
}

async function verifyCompleteDecode(sourcePath, expected) {
	const decode = await run('ffmpeg', [
		'-v',
		'error',
		...decoderArguments(expected),
		'-i',
		sourcePath,
		'-map',
		'0:v:0',
		'-f',
		'null',
		'-nostats',
		'-progress',
		'pipe:1',
		'-',
	]);
	if (decode.code !== 0)
		return rejection('metadata', `Complete decode failed: ${decode.stderr.trim()}`);
	if (decode.stderr.trim().length > 0)
		return rejection('metadata', `Decode reported errors: ${decode.stderr.trim()}`);
	const frames = [...decode.stdout.matchAll(/^frame=(\d+)$/gm)].at(-1);
	const decodedFrameCount = frames ? Number(frames[1]) : Number.NaN;
	if (decodedFrameCount !== expected.frameCount)
		return rejection('metadata', `Decoded ${decodedFrameCount} frames but inspection recorded ${expected.frameCount}`);
	return { decodedFrameCount };
}

function proofPage(expected, sessionToken) {
	const parameters = JSON.stringify({
		sourceUrl: `/media/${sessionToken}/source`,
		width: expected.width,
		height: expected.height,
		durationSeconds: expected.durationSeconds,
		durationTolerance: DURATION_TOLERANCE_SECONDS,
		posterTimeSeconds: expected.posterTimeSeconds,
		hasAlpha: expected.hasAlpha,
	});
	return `<!doctype html>
<html lang="en">
	<head><meta charset="utf-8"><title>silent-video validation</title></head>
	<body data-result="">
		<script type="module">
			const expected = ${parameters};
			function fail(stage, detail) {
				document.body.dataset.result = JSON.stringify({ ok: false, stage, detail });
			}
			window.addEventListener('error', event =>
				fail('playback', 'page error: ' + (event.message ?? 'unknown')));
			window.addEventListener('unhandledrejection', event =>
				fail('playback', 'page rejection: ' + String(event.reason?.message ?? event.reason)));
			async function seekTo(video, time) {
				await new Promise((resolve, reject) => {
					const timeout = setTimeout(() => reject(new Error('seek to ' + time + ' timed out')), 15000);
					video.addEventListener('seeked', () => { clearTimeout(timeout); resolve(); }, { once: true });
					video.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('seek to ' + time + ' failed')); }, { once: true });
					video.currentTime = time;
				});
			}
			await (async () => {
			try {
				const video = document.createElement('video');
				video.muted = true;
				video.playsInline = true;
				video.preload = 'auto';
				document.body.appendChild(video);
				video.src = expected.sourceUrl;
				await new Promise((resolve, reject) => {
					const timeout = setTimeout(() => reject(new Error('metadata timed out')), 20000);
					video.addEventListener('loadedmetadata', () => { clearTimeout(timeout); resolve(); }, { once: true });
					video.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('metadata failed')); }, { once: true });
				});
				if (video.videoWidth !== expected.width || video.videoHeight !== expected.height) {
					fail('metadata', 'browser decoded ' + video.videoWidth + 'x' + video.videoHeight);
					return;
				}
				if (!Number.isFinite(video.duration)
					|| Math.abs(video.duration - expected.durationSeconds) > expected.durationTolerance) {
					fail('metadata', 'browser measured duration ' + video.duration);
					return;
				}
				const measuredDuration = video.duration;
				try {
					await video.play();
					await new Promise((resolve, reject) => {
						const timeout = setTimeout(() => reject(new Error('playback did not advance')), 15000);
						const check = () => {
							if (video.currentTime > 0) { clearTimeout(timeout); resolve(); }
							else { video.requestVideoFrameCallback(check); }
						};
						video.requestVideoFrameCallback(check);
					});
					video.pause();
				}
				catch (error) {
					fail('playback', String(error?.message ?? error));
					return;
				}
				const seekTargets = [
					0,
					Math.min(measuredDuration / 2, Math.max(0, measuredDuration - 0.1)),
					Math.max(0, measuredDuration - 0.1),
					expected.posterTimeSeconds,
				];
				try {
					for (const target of seekTargets)
						await seekTo(video, target);
				}
				catch (error) {
					fail('seek', String(error?.message ?? error));
					return;
				}
				let transparencyRendered = false;
				if (expected.hasAlpha) {
					const canvas = document.createElement('canvas');
					canvas.width = expected.width;
					canvas.height = expected.height;
					const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true });
					context.clearRect(0, 0, expected.width, expected.height);
					context.drawImage(video, 0, 0);
					const pixels = context.getImageData(0, 0, expected.width, expected.height).data;
					for (let index = 3; index < pixels.length; index += 4) {
						if (pixels[index] < 255) {
							transparencyRendered = true;
							break;
						}
					}
					if (!transparencyRendered) {
						fail('transparency', 'no transparent pixel rendered at the poster time');
						return;
					}
				}
				document.body.dataset.result = JSON.stringify({
					ok: true,
					durationSeconds: measuredDuration,
					transparencyRendered,
				});
			}
			catch (error) {
				fail('playback', String(error?.message ?? error));
			}
			})();
		</script>
	</body>
</html>`;
}

async function chromiumProof(expected, sessionToken) {
	const profile = await mkdtemp(join(tmpdir(), 'silent-video-profile-'));
	const child = spawn(CHROMIUM_BINARY, [
		'--headless=new',
		'--no-sandbox',
		'--disable-gpu',
		'--disable-dev-shm-usage',
		'--autoplay-policy=no-user-gesture-required',
		'--disable-background-media-suspend',
		'--remote-debugging-port=0',
		'--remote-allow-origins=*',
		'--no-first-run',
		`--user-data-dir=${profile}`,
	], { stdio: ['ignore', 'ignore', 'pipe'] });
	let socket;
	try {
		const browserWebSocket = await new Promise((resolve, reject) => {
			let errorOutput = '';
			const timeout = setTimeout(() => reject(new Error('Chromium DevTools endpoint timed out')), 20_000);
			child.stderr.setEncoding('utf8').on('data', (chunk) => {
				errorOutput += chunk;
				const match = errorOutput.match(/DevTools listening on (ws:\/\/\S+)/);
				if (match) {
					clearTimeout(timeout);
					resolve(match[1]);
				}
			});
			child.once('error', (error) => {
				clearTimeout(timeout);
				reject(error);
			});
			child.once('exit', (code) => {
				clearTimeout(timeout);
				reject(new Error(`Chromium exited with ${code}: ${errorOutput.trim()}`));
			});
		});
		const browserUrl = new URL(browserWebSocket);
		const pageUrl = `http://127.0.0.1:${PORT}/media/${sessionToken}/page`;
		const target = await fetch(
			`http://${browserUrl.host}/json/new?${encodeURIComponent(pageUrl)}`,
			{ method: 'PUT' },
		).then(response => response.json());
		socket = new WebSocket(target.webSocketDebuggerUrl);
		await new Promise((resolve, reject) => {
			socket.addEventListener('open', resolve, { once: true });
			socket.addEventListener('error', () => reject(new Error('CDP socket failed')), { once: true });
		});
		let nextId = 0;
		const pending = new Map();
		const pageEvents = [];
		socket.addEventListener('message', (message) => {
			const payload = JSON.parse(message.data);
			if (!payload.id) {
				if (payload.method === 'Runtime.exceptionThrown') {
					pageEvents.push(`exception: ${payload.params?.exceptionDetails?.exception?.description
					?? payload.params?.exceptionDetails?.text}`);
				}
				if (payload.method === 'Runtime.consoleAPICalled') {
					pageEvents.push(`console.${payload.params?.type}: ${payload.params?.args
						?.map(argument => argument.value ?? argument.description)
						.join(' ')}`);
				}
				return;
			}
			const handler = pending.get(payload.id);
			pending.delete(payload.id);
			handler?.(payload);
		});
		const command = (method, params = {}) => new Promise((resolve, reject) => {
			const id = ++nextId;
			pending.set(id, payload => payload.error
				? reject(new Error(payload.error.message))
				: resolve(payload.result));
			socket.send(JSON.stringify({ id, method, params }));
		});
		await command('Runtime.enable');
		const deadline = Date.now() + PAGE_DEADLINE_MILLISECONDS;
		while (Date.now() < deadline) {
			const evaluated = await command('Runtime.evaluate', {
				expression: 'document.body?.dataset.result ?? ""',
				returnByValue: true,
			});
			const raw = evaluated.result?.value;
			if (raw) {
				const result = JSON.parse(raw);
				if (!result.ok)
					return rejection(result.stage, result.detail);
				return {
					durationSeconds: result.durationSeconds,
					transparencyRendered: result.transparencyRendered,
				};
			}
			await new Promise(resolve => setTimeout(resolve, 200));
		}
		const diagnostics = await command('Runtime.evaluate', {
			expression: `JSON.stringify({
				url: location.href,
				documentState: document.readyState,
				video: !!document.querySelector('video'),
				readyState: document.querySelector('video')?.readyState,
				mediaError: document.querySelector('video')?.error?.code,
				currentTime: document.querySelector('video')?.currentTime,
			})`,
			returnByValue: true,
		}).catch(() => undefined);
		return rejection(
			'playback',
			`Chromium playback proof timed out: ${diagnostics?.result?.value ?? 'no page state'}${
				pageEvents.length ? ` events: ${pageEvents.slice(0, 5).join(' | ')}` : ''}`,
		);
	}
	finally {
		try {
			socket?.close();
		}
		catch {}
		const exited = new Promise(resolve => child.once('exit', resolve));
		child.kill('SIGTERM');
		await Promise.race([
			exited,
			new Promise(resolve => setTimeout(resolve, 5_000).unref?.()),
		]);
		child.kill('SIGKILL');
		await rm(profile, { recursive: true, force: true }).catch(() => undefined);
	}
}

async function generatePoster(sourcePath, posterPath, expected) {
	const poster = await run('ffmpeg', [
		'-v',
		'error',
		...decoderArguments(expected),
		'-i',
		sourcePath,
		'-ss',
		String(expected.posterTimeSeconds),
		'-frames:v',
		'1',
		'-vf',
		`scale=${expected.posterWidth}:${expected.posterHeight}:flags=bicubic,format=rgba`,
		'-map_metadata',
		'-1',
		'-y',
		posterPath,
	], { collectStdout: false });
	if (poster.code !== 0)
		return rejection('poster', `Poster generation failed: ${poster.stderr.trim()}`);
	let posterBytes;
	try {
		posterBytes = await readFile(posterPath);
	}
	catch {
		return rejection('poster', 'Poster frame was not produced');
	}
	if (posterBytes.byteLength <= 0 || posterBytes.byteLength > expected.maxPosterBytes)
		return rejection('poster', `Poster is ${posterBytes.byteLength} bytes`);
	return { posterBytes };
}

async function validate(request, expected) {
	const workspace = await mkdtemp(join(tmpdir(), 'silent-video-validation-'));
	const sourcePath = join(workspace, expected.format === 'mp4' ? 'source.mp4' : 'source.webm');
	const sessionToken = createHash('sha256')
		.update(`${expected.sourceDigest}:${Date.now()}`)
		.digest('hex')
		.slice(0, 32);
	activeSession = { token: sessionToken, sourcePath, expected };
	try {
		let received;
		try {
			received = await receiveSource(request, sourcePath, expected);
		}
		catch {
			return rejection('metadata', 'Source transfer exceeded the declared byte length');
		}
		if (
			received.byteLength !== expected.sourceByteLength
			|| received.sha256 !== expected.sourceDigest
		) {
			return rejection('metadata', 'Source bytes do not match the declared digest and length');
		}
		const identity = await verifyContainerIdentity(sourcePath, expected);
		if (identity.outcome === 'rejected')
			return identity;
		const decode = await verifyCompleteDecode(sourcePath, expected);
		if (decode.outcome === 'rejected')
			return decode;
		const playback = await chromiumProof(expected, sessionToken);
		if (playback.outcome === 'rejected')
			return playback;
		if (expected.hasAlpha && !playback.transparencyRendered)
			return rejection('transparency', 'Chromium did not prove VP9 transparency');
		const posterPath = join(workspace, 'poster.png');
		const poster = await generatePoster(sourcePath, posterPath, expected);
		if (poster.outcome === 'rejected')
			return poster;
		return {
			outcome: 'accepted',
			width: expected.width,
			height: expected.height,
			durationSeconds: playback.durationSeconds,
			mutedInlinePlayback: true,
			seeked: true,
			transparencyRendered: playback.transparencyRendered,
			posterBase64: poster.posterBytes.toString('base64'),
			posterDigest: createHash('sha256').update(poster.posterBytes).digest('hex'),
		};
	}
	finally {
		activeSession = undefined;
		await rm(workspace, { recursive: true, force: true });
	}
}

async function serveSource(request, response, sourcePath) {
	const { size } = await stat(sourcePath);
	const range = request.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
	if (range && (range[1] !== '' || range[2] !== '')) {
		const start = range[1] === '' ? Math.max(0, size - Number(range[2])) : Number(range[1]);
		const end = range[1] !== '' && range[2] !== ''
			? Math.min(Number(range[2]), size - 1)
			: size - 1;
		if (start > end || start >= size) {
			response.writeHead(416, { 'content-range': `bytes */${size}` }).end();
			return;
		}
		response.writeHead(206, {
			'content-type': activeSession.expected.sourceContentType,
			'content-length': end - start + 1,
			'content-range': `bytes ${start}-${end}/${size}`,
			'accept-ranges': 'bytes',
		});
		createReadStream(sourcePath, { start, end }).pipe(response);
		return;
	}
	response.writeHead(200, {
		'content-type': activeSession.expected.sourceContentType,
		'content-length': size,
		'accept-ranges': 'bytes',
	});
	createReadStream(sourcePath).pipe(response);
}

const server = createServer(async (request, response) => {
	try {
		if (request.method === 'GET' && request.url === '/healthz') {
			response.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
			return;
		}
		const media = request.url?.match(/^\/media\/([a-f0-9]{32})\/(page|source)$/);
		if (request.method === 'GET' && media && activeSession?.token === media[1]) {
			if (media[2] === 'page') {
				response.writeHead(200, {
					'content-type': 'text/html; charset=utf-8',
					'cache-control': 'no-store',
				}).end(proofPage(activeSession.expected, activeSession.token));
				return;
			}
			await serveSource(request, response, activeSession.sourcePath);
			return;
		}
		if (request.method === 'POST' && request.url === '/validate') {
			if (activeSession) {
				response.writeHead(409, { 'content-type': 'application/json' })
					.end(JSON.stringify({ error: 'validation already in progress' }));
				return;
			}
			let expected;
			try {
				expected = JSON.parse(Buffer.from(
					request.headers['x-validation-request'] ?? '',
					'base64',
				).toString('utf8'));
			}
			catch {
				response.writeHead(400, { 'content-type': 'application/json' })
					.end(JSON.stringify({ error: 'invalid validation request' }));
				return;
			}
			const result = await validate(request, expected);
			response.writeHead(200, { 'content-type': 'application/json' })
				.end(JSON.stringify(result));
			return;
		}
		response.writeHead(404).end();
	}
	catch (error) {
		activeSession = undefined;
		response.writeHead(500, { 'content-type': 'application/json' })
			.end(JSON.stringify({ error: String(error?.message ?? error) }));
	}
});

server.listen(PORT, () => {
	process.stdout.write(`silent-video validation container listening on ${PORT}\n`);
});
