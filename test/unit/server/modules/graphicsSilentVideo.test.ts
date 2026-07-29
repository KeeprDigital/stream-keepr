import type { GraphicAssetValidationError } from '~~/server/modules/graphics-asset-library/validation';
import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { processSilentVideo } from '~~/server/modules/graphics-asset-library/silent-video';

const vp9Webm = Uint8Array.from(Buffer.from(
	'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAIMEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggElTbuMU6uEHFO7a1OsggH27AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjIuMTIuMTAyV0GNTGF2ZjYyLjEyLjEwMkSJiECPQAAAAAAAFlSua8iuAQAAAAAAAD/XgQFzxYhkRqj8GKbqBJyBACK1nIN1bmSIgQCGhVZfVlA5g4EBI+ODhB3NZQDgkLCBELqBEJqBAlWwhFW5gQESVMNnQIBzc6BjwIBnyJpFo4dFTkNPREVSRIeNTGF2ZjYyLjEyLjEwMnNz2mPAi2PFiGRGqPwYpuoEZ8ilRaOHRU5DT0RFUkSHmExhdmM2Mi4yOC4xMDIgbGlidnB4LXZwOWfIoUWjiERVUkFUSU9ORIeTMDA6MDA6MDEuMDAwMDAwMDAwAB9DtnXG54EAo6yBAACAgkmDQgAA8AD2ADgkHBhCAAAwcAAASqf/+5CBv///CAg////7iYcAAKOTgQH0AIYAQJKcAElAAAMgAABCQBxTu2uRu4+zgQC3iveBAfGCAavwgQM=',
	'base64',
));
const h264Mp4 = Uint8Array.from(Buffer.from(
	'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMNbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAjd0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAHTbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAAAQABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABfm1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAT5zdGJsAAAAvnN0c2QAAAAAAAAAAQAAAK5hdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABFUxhdmM2Mi4yOC4xMDIgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAANGF2Y0MBZAAK/+EAF2dkAAqs2V7ARAAAAwAEAAADABA8SJZYAQAGaOvjyyLA/fj4AAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAABa4AAAAAAAAABhzdHRzAAAAAAAAAAEAAAACAAAgAAAAABRzdHNzAAAAAAAAAAEAAAABAAAAHHN0c2MAAAAAAAAAAQAAAAEAAAACAAAAAQAAABxzdHN6AAAAAAAAAAAAAAACAAACywAAAAwAAAAUc3RjbwAAAAAAAAABAAADPQAAAGJ1ZHRhAAAAWm1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAALWlsc3QAAAAlqXRvbwAAAB1kYXRhAAAAAQAAAABMYXZmNjIuMTIuMTAyAAAACGZyZWUAAALfbWRhdAAAAq0GBf//qdxF6b3m2Ui3lizYINkj7u94MjY0IC0gY29yZSAxNjUgcjMyMjIgYjM1NjA1YSAtIEguMjY0L01QRUctNCBBVkMgY29kZWMgLSBDb3B5bGVmdCAyMDAzLTIwMjUgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRpb25zOiBjYWJhYz0xIHJlZj0zIGRlYmxvY2s9MTowOjAgYW5hbHlzZT0weDM6MHgxMTMgbWU9aGV4IHN1Ym1lPTcgcHN5PTEgcHN5X3JkPTEuMDA6MC4wMCBtaXhlZF9yZWY9MSBtZV9yYW5nZT0xNiBjaHJvbWFfbWU9MSB0cmVsbGlzPTEgOHg4ZGN0PTEgY3FtPTAgZGVhZHpvbmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9tYV9xcF9vZmZzZXQ9LTIgdGhyZWFkcz0xIGxvb2thaGVhZF90aHJlYWRzPTEgc2xpY2VkX3RocmVhZHM9MCBucj0wIGRlY2ltYXRlPTEgaW50ZXJsYWNlZD0wIGJsdXJheV9jb21wYXQ9MCBjb25zdHJhaW5lZF9pbnRyYT0wIGJmcmFtZXM9MyBiX3B5cmFtaWQ9MiBiX2FkYXB0PTEgYl9iaWFzPTAgZGlyZWN0PTEgd2VpZ2h0Yj0xIG9wZW5fZ29wPTAgd2VpZ2h0cD0yIGtleWludD0yNTAga2V5aW50X21pbj0yIHNjZW5lY3V0PTQwIGludHJhX3JlZnJlc2g9MCByY19sb29rYWhlYWQ9NDAgcmM9Y3JmIG1idHJlZT0xIGNyZj0yMy4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTE6MS4wMACAAAAAFmWIhAAU//7s2n4FNj3X58U0N7WUtoEAAAAIQZohbEEv/uA=',
	'base64',
));

function topLevelMp4Boxes(bytes: Uint8Array) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const boxes: { type: string; bytes: Uint8Array }[] = [];
	for (let offset = 0; offset < bytes.byteLength;) {
		const size = view.getUint32(offset);
		const type = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8));
		boxes.push({ type, bytes: bytes.subarray(offset, offset + size) });
		offset += size;
	}
	return boxes;
}

function concatenate(parts: readonly Uint8Array[]) {
	const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
	let offset = 0;
	for (const part of parts) {
		result.set(part, offset);
		offset += part.byteLength;
	}
	return result;
}

function isoBox(type: string, payload = new Uint8Array()) {
	const bytes = new Uint8Array(8 + payload.byteLength);
	const view = new DataView(bytes.buffer);
	view.setUint32(0, bytes.byteLength);
	bytes.set(new TextEncoder().encode(type), 4);
	bytes.set(payload, 8);
	return bytes;
}

function withMp4CompositionOffsets(
	bytes: Uint8Array,
	entries: readonly { sampleCount: number; sampleOffset: number }[],
) {
	const payload = new Uint8Array(8 + entries.length * 8);
	const payloadView = new DataView(payload.buffer);
	payloadView.setUint32(4, entries.length);
	entries.forEach((entry, index) => {
		payloadView.setUint32(8 + index * 8, entry.sampleCount);
		payloadView.setUint32(12 + index * 8, entry.sampleOffset);
	});
	const compositionOffsets = isoBox('ctts', payload);
	const insertionOffset = asciiOffset(bytes, 'stss') - 4;
	const result = concatenate([
		bytes.subarray(0, insertionOffset),
		compositionOffsets,
		bytes.subarray(insertionOffset),
	]);
	const originalView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const resultView = new DataView(result.buffer);
	for (const ancestor of ['stbl', 'minf', 'mdia', 'trak', 'moov']) {
		const ancestorOffset = asciiOffset(bytes, ancestor) - 4;
		resultView.setUint32(
			ancestorOffset,
			originalView.getUint32(ancestorOffset) + compositionOffsets.byteLength,
		);
	}
	const chunkOffsetEntry = asciiOffset(result, 'stco') + 12;
	resultView.setUint32(
		chunkOffsetEntry,
		resultView.getUint32(chunkOffsetEntry) + compositionOffsets.byteLength,
	);
	return result;
}

function replaceAscii(bytes: Uint8Array, from: string, to: string) {
	const result = bytes.slice();
	const needle = new TextEncoder().encode(from);
	const replacement = new TextEncoder().encode(to);
	expect(replacement.byteLength).toBe(needle.byteLength);
	let replacements = 0;
	for (let offset = 0; offset <= result.byteLength - needle.byteLength; offset++) {
		if (!needle.every((byte, byteIndex) => result[offset + byteIndex] === byte))
			continue;
		result.set(replacement, offset);
		replacements++;
	}
	expect(replacements).toBeGreaterThan(0);
	return result;
}

function asciiOffset(bytes: Uint8Array, value: string) {
	const needle = new TextEncoder().encode(value);
	const offset = bytes.findIndex((_, candidate) =>
		needle.every((byte, index) => bytes[candidate + index] === byte),
	);
	expect(offset).toBeGreaterThanOrEqual(0);
	return offset;
}

function setSpsRbspBits(bytes: Uint8Array, bitOffset: number, bitCount: number, value: number) {
	const avcConfiguration = asciiOffset(bytes, 'avcC') + 4;
	const spsStart = avcConfiguration + 8;
	const spsLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(avcConfiguration + 6);
	const physicalOffsets: number[] = [];
	for (let offset = spsStart + 1; offset < spsStart + spsLength; offset++) {
		if (
			offset >= spsStart + 3
			&& bytes[offset - 2] === 0
			&& bytes[offset - 1] === 0
			&& bytes[offset] === 3
		) {
			continue;
		}
		physicalOffsets.push(offset);
	}
	for (let index = 0; index < bitCount; index++) {
		const targetBit = bitOffset + index;
		const byteOffset = physicalOffsets[Math.floor(targetBit / 8)]!;
		const mask = 1 << (7 - (targetBit % 8));
		if ((value >>> (bitCount - index - 1)) & 1)
			bytes[byteOffset] |= mask;
		else
			bytes[byteOffset] &= ~mask;
	}
}

async function expectIssue(
	work: Promise<unknown>,
	code: GraphicAssetValidationError['issue']['code'],
) {
	await expect(work).rejects.toMatchObject({
		issue: { code },
	});
}

describe('silent-video bounded inspection', () => {
	it('accepts a fast-start silent H.264 MP4 with authoritative media facts', async () => {
		const processed = await processSilentVideo(h264Mp4, {
			sourceFileName: 'loop.mp4',
			declaredMime: 'video/mp4',
		});

		expect(processed.report).toMatchObject({
			outcome: 'accepted',
			compatibilityProfile: 'silent-video-v1',
			facts: {
				kind: 'silent-video',
				format: 'mp4',
				codec: 'h264',
				canonicalMime: 'video/mp4',
				width: 16,
				height: 16,
				frameCount: 2,
				bitDepth: 8,
				colorSpace: 'sdr',
				chromaSubsampling: '4:2:0',
				hasAlpha: false,
				fastStart: true,
				seekable: true,
				targetCompatibility: 'all-supported',
			},
		});
		expect(processed.report.facts.durationSeconds).toBeCloseTo(1, 3);
		expect(processed.report.facts.frameRate).toBeCloseTo(2, 2);
		expect(processed.report.facts.posterTimeSeconds).toBeCloseTo(0.1, 3);
	});

	it('accepts a seekable VP9 WebM and selects ten-percent duration for its poster', async () => {
		const processed = await processSilentVideo(vp9Webm, {
			sourceFileName: 'ident.webm',
			declaredMime: 'video/webm',
		});

		expect(processed.report).toMatchObject({
			outcome: 'accepted',
			facts: {
				format: 'webm',
				codec: 'vp9',
				width: 16,
				height: 16,
				frameCount: 2,
				hasAlpha: false,
				fastStart: null,
				seekable: true,
				targetCompatibility: 'all-supported',
			},
		});
		expect(processed.report.facts.durationSeconds).toBeCloseTo(1, 5);
		expect(processed.report.facts.frameRate).toBeCloseTo(2, 5);
		expect(processed.report.facts.posterTimeSeconds).toBeCloseTo(0.1, 5);
	});

	it('rejects MP4 without fast-start ordering', async () => {
		const boxes = topLevelMp4Boxes(h264Mp4);
		const reordered = concatenate([
			...boxes.filter(box => box.type === 'ftyp').map(box => box.bytes),
			...boxes.filter(box => box.type === 'mdat').map(box => box.bytes),
			...boxes.filter(box => box.type !== 'ftyp' && box.type !== 'mdat').map(box => box.bytes),
		]);

		await expectIssue(processSilentVideo(reordered), 'mp4-fast-start-required');
	});

	it('rejects ISO-BMFF files that do not declare an MP4-compatible brand', async () => {
		const quickTime = h264Mp4.slice();
		const quickTimeBrand = new TextEncoder().encode('qt  ');
		quickTime.set(quickTimeBrand, 8);

		await expectIssue(processSilentVideo(quickTime), 'unsupported-video-format');
	});

	it('rejects a movie-level presentation transform', async () => {
		const transformed = h264Mp4.slice();
		const movieHeader = asciiOffset(transformed, 'mvhd') + 4;
		new DataView(transformed.buffer).setUint32(movieHeader + 36, 0x0000FFFF);

		await expectIssue(processSilentVideo(transformed), 'unsupported-video-transform');
	});

	it('rejects HDR transfer characteristics signalled only in the H.264 SPS VUI', async () => {
		const hdr = h264Mp4.slice();
		// This fixture's VUI starts at RBSP bit 48. Enable video-signal colour
		// description and signal BT.709 primaries, PQ transfer, BT.709 matrix.
		setSpsRbspBits(hdr, 59, 1, 1);
		setSpsRbspBits(hdr, 60, 3, 5);
		setSpsRbspBits(hdr, 63, 1, 0);
		setSpsRbspBits(hdr, 64, 1, 1);
		setSpsRbspBits(hdr, 65, 8, 1);
		setSpsRbspBits(hdr, 73, 8, 16);
		setSpsRbspBits(hdr, 81, 8, 1);

		await expectIssue(processSilentVideo(hdr), 'unsupported-video-profile');
	});

	it('rejects conflicting declarations and incomplete WebM indexes', async () => {
		await expectIssue(processSilentVideo(vp9Webm, {
			sourceFileName: 'wrong.mp4',
			declaredMime: 'video/webm',
		}), 'conflicting-video-extension');
		await expectIssue(
			processSilentVideo(vp9Webm.subarray(0, vp9Webm.byteLength - 12)),
			'video-index-incomplete',
		);
	});

	it('rejects unsupported codecs even when their containers remain structurally valid', async () => {
		await expectIssue(
			processSilentVideo(replaceAscii(h264Mp4, 'avc1', 'mp4v')),
			'unsupported-video-codec',
		);
		await expectIssue(
			processSilentVideo(replaceAscii(vp9Webm, 'V_VP9', 'V_VP8')),
			'unsupported-video-codec',
		);
	});

	it('classifies undersized nested MP4 structures as malformed video', async () => {
		const malformed = concatenate([
			isoBox('ftyp'),
			isoBox('moov', isoBox('trak', isoBox('tkhd'))),
			isoBox('mdat'),
		]);

		await expectIssue(processSilentVideo(malformed), 'malformed-video');
	});

	it('rejects MP4 sample indexes whose declared bytes exceed media data', async () => {
		const malformed = h264Mp4.slice();
		const sampleSizeTable = asciiOffset(malformed, 'stsz') + 4;
		new DataView(malformed.buffer).setUint32(sampleSizeTable + 12, 0x7FFF_FFFF);

		await expectIssue(processSilentVideo(malformed), 'video-index-incomplete');
	});

	it('rejects individual MP4 frame intervals above 60 fps', async () => {
		const malformed = h264Mp4.slice();
		const timingTable = asciiOffset(malformed, 'stts') + 4;
		new DataView(malformed.buffer).setUint32(timingTable + 12, 1);

		await expectIssue(processSilentVideo(malformed), 'video-frame-rate-exceeded');
	});

	it('rejects MP4 composition offsets that overlap the presentation timeline', async () => {
		const malformed = withMp4CompositionOffsets(h264Mp4, [
			{ sampleCount: 1, sampleOffset: 32 },
			{ sampleCount: 1, sampleOffset: 0 },
		]);

		await expectIssue(processSilentVideo(malformed), 'malformed-video-timeline');
	});

	it('rejects movie and media headers whose scaled presentation durations disagree', async () => {
		const malformed = h264Mp4.slice();
		const movieHeader = asciiOffset(malformed, 'mvhd') + 4;
		new DataView(malformed.buffer).setUint32(movieHeader + 12, 2000);

		await expectIssue(processSilentVideo(malformed), 'malformed-video-timeline');
	});

	it('rejects an MP4 sample count before it can drive an unbounded allocation', async () => {
		const malformed = h264Mp4.slice();
		const timingTable = asciiOffset(malformed, 'stts') + 4;
		new DataView(malformed.buffer).setUint32(timingTable + 8, 0xFFFF_FFFF);

		await expectIssue(processSilentVideo(malformed), 'video-frame-rate-exceeded');
	});

	it('rejects an MP4 chunk count larger than its bounded sample timeline', async () => {
		const malformed = h264Mp4.slice();
		const chunkTable = asciiOffset(malformed, 'stco') + 4;
		new DataView(malformed.buffer).setUint32(chunkTable + 4, 3);

		await expectIssue(processSilentVideo(malformed), 'video-index-incomplete');
	});

	it('rejects WebM Cues that do not match their cluster timeline', async () => {
		const malformed = vp9Webm.slice();
		const cueTime = malformed.findIndex((byte, index) =>
			byte === 0xB3 && malformed[index + 1] === 0x81,
		);
		expect(cueTime).toBeGreaterThanOrEqual(0);
		malformed[cueTime + 2] = 1;

		await expectIssue(processSilentVideo(malformed), 'video-index-incomplete');
	});

	it('rejects a WebM media timeline that does not start at zero', async () => {
		const malformed = vp9Webm.slice();
		const clusterTime = malformed.findIndex((byte, index) =>
			byte === 0xE7 && malformed[index + 1] === 0x81,
		);
		expect(clusterTime).toBeGreaterThanOrEqual(0);
		malformed[clusterTime + 2] = 1;

		await expectIssue(processSilentVideo(malformed), 'malformed-video-timeline');
	});

	it('rejects HDR transfer signalling from the WebM Colour element', async () => {
		const hdr = vp9Webm.slice();
		const rangeElement = hdr.findIndex((byte, index) => byte === 0x55 && hdr[index + 1] === 0xB9);
		expect(rangeElement).toBeGreaterThanOrEqual(0);
		hdr[rangeElement + 1] = 0xBA;
		hdr[rangeElement + 3] = 16;

		await expectIssue(processSilentVideo(hdr), 'unsupported-video-profile');
	});

	it('rejects a later WebM random-access cluster omitted from Cues', async () => {
		const clusterStart = vp9Webm.findIndex((byte, index) =>
			byte === 0x1F && vp9Webm[index + 1] === 0x43 && vp9Webm[index + 2] === 0xB6 && vp9Webm[index + 3] === 0x75,
		);
		const cuesStart = vp9Webm.findIndex((byte, index) =>
			byte === 0x1C && vp9Webm[index + 1] === 0x53 && vp9Webm[index + 2] === 0xBB && vp9Webm[index + 3] === 0x6B && index > clusterStart,
		);
		expect(cuesStart).toBeGreaterThan(clusterStart);
		const duplicate = vp9Webm.slice(clusterStart, cuesStart);
		const clusterTime = duplicate.findIndex((byte, index) => byte === 0xE7 && duplicate[index + 1] === 0x81);
		duplicate[clusterTime + 2] = 200;
		const secondBlock = duplicate.findIndex((byte, index) => byte === 0xA3 && duplicate[index + 1] === 0x93);
		duplicate[secondBlock + 3] = 0;
		duplicate[secondBlock + 4] = 100;
		const malformed = concatenate([
			vp9Webm.slice(0, cuesStart),
			duplicate,
			vp9Webm.slice(cuesStart),
		]);
		malformed[clusterStart + secondBlock + 3] = 0;
		malformed[clusterStart + secondBlock + 4] = 100;
		new DataView(malformed.buffer).setBigUint64(40, (1n << 56n) | BigInt(malformed.byteLength - 48));
		const duration = malformed.findIndex((byte, index) => byte === 0x44 && malformed[index + 1] === 0x89 && malformed[index + 2] === 0x88);
		new DataView(malformed.buffer).setFloat64(duration + 3, 2000);

		await expectIssue(processSilentVideo(malformed), 'video-index-incomplete');
	});
});
