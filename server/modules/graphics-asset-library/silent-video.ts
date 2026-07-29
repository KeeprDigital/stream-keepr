import type {
	GraphicAssetSilentVideoFacts,
	GraphicAssetValidationReport,
} from '~~/shared/types/graphicsAsset';
import {
	MAX_SILENT_VIDEO_DURATION_SECONDS,
	MAX_SILENT_VIDEO_FRAME_RATE,
	MAX_SILENT_VIDEO_HEIGHT,
	MAX_SILENT_VIDEO_INGESTION_BYTES,
	MAX_SILENT_VIDEO_WIDTH,
	SILENT_VIDEO_COMPATIBILITY_PROFILE,
} from '~~/shared/utils/graphicsAssetCompatibility';
import { sha256Hex } from './png';
import { validationError } from './validation';

interface SilentVideoDeclarations {
	sourceFileName?: string;
	declaredMime?: string;
}

export type SilentVideoRangeReadOutcome
	= { outcome: 'available'; bytes: Uint8Array; completeLength: number }
		| { outcome: 'missing' }
		| { outcome: 'unavailable'; retryable: true };

export interface SilentVideoRandomAccessSource {
	byteLength: number;
	sha256: string;
	read: (offset: number, length: number) => Promise<SilentVideoRangeReadOutcome>;
}

export class SilentVideoInspectionSourceError extends Error {
	constructor(
		readonly outcome: 'missing' | 'unavailable',
	) {
		super(`Silent-video inspection source is ${outcome}`);
	}
}

export interface ProcessedSilentVideo {
	report: Extract<GraphicAssetValidationReport, {
		outcome: 'accepted';
		facts: GraphicAssetSilentVideoFacts;
	}>;
}

interface IsoBox {
	type: string;
	start: number;
	end: number;
	dataStart: number;
}

const textDecoder = new TextDecoder();

function ascii(bytes: Uint8Array, start: number, length: number) {
	return textDecoder.decode(bytes.subarray(start, start + length));
}

function u32(view: DataView, offset: number) {
	if (offset < 0 || offset + 4 > view.byteLength)
		validationError('malformed-video', 'Video structure ended before a required integer.');
	return view.getUint32(offset);
}

function isoBoxes(bytes: Uint8Array, start = 0, end = bytes.byteLength): IsoBox[] {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const boxes: IsoBox[] = [];
	for (let offset = start; offset < end;) {
		if (offset + 8 > end)
			validationError('malformed-video', 'MP4 contains an incomplete box header.');
		const shortSize = u32(view, offset);
		const type = ascii(bytes, offset + 4, 4);
		let size = shortSize;
		let headerLength = 8;
		if (shortSize === 1) {
			if (offset + 16 > end)
				validationError('malformed-video', 'MP4 contains an incomplete large box header.');
			const largeSize = view.getBigUint64(offset + 8);
			if (largeSize > BigInt(Number.MAX_SAFE_INTEGER))
				validationError('malformed-video', 'MP4 box size exceeds bounded inspection.');
			size = Number(largeSize);
			headerLength = 16;
		}
		else if (shortSize === 0) {
			size = end - offset;
		}
		if (size < headerLength || offset + size > end)
			validationError('malformed-video', `MP4 ${type} box has an invalid size.`);
		boxes.push({
			type,
			start: offset,
			end: offset + size,
			dataStart: offset + headerLength,
		});
		offset += size;
	}
	return boxes;
}

function oneBox(
	boxes: readonly IsoBox[],
	type: string,
	issue: 'malformed-video' | 'video-index-incomplete' = 'malformed-video',
) {
	const matches = boxes.filter(box => box.type === type);
	if (matches.length !== 1)
		validationError(issue, `MP4 requires exactly one ${type} box.`);
	return matches[0]!;
}

function childBoxes(bytes: Uint8Array, parent: IsoBox) {
	return isoBoxes(bytes, parent.dataStart, parent.end);
}

function h264SpsFacts(nal: Uint8Array) {
	if (nal.byteLength < 4 || (nal[0]! & 0x1F) !== 7)
		validationError('unsupported-video-profile', 'AVC configuration requires a complete SPS.');
	const escaped = nal.subarray(1);
	const rbsp: number[] = [];
	for (let index = 0; index < escaped.length; index++) {
		if (
			index >= 2
			&& escaped[index - 2] === 0
			&& escaped[index - 1] === 0
			&& escaped[index] === 3
		) {
			continue;
		}
		rbsp.push(escaped[index]!);
	}
	let bitOffset = 0;
	const bit = () => {
		if (bitOffset >= rbsp.length * 8)
			validationError('unsupported-video-profile', 'AVC SPS ended before required profile facts.');
		const value = (rbsp[Math.floor(bitOffset / 8)]! >>> (7 - (bitOffset % 8))) & 1;
		bitOffset++;
		return value;
	};
	const bits = (count: number) => {
		let value = 0;
		for (let index = 0; index < count; index++)
			value = value * 2 + bit();
		return value;
	};
	const unsignedExpGolomb = () => {
		let leadingZeros = 0;
		while (bit() === 0) {
			leadingZeros++;
			if (leadingZeros > 31)
				validationError('unsupported-video-profile', 'AVC SPS exponential code is unbounded.');
		}
		return (2 ** leadingZeros - 1) + (leadingZeros ? bits(leadingZeros) : 0);
	};
	const signedExpGolomb = () => {
		const code = unsignedExpGolomb();
		return code % 2 === 0 ? -(code / 2) : (code + 1) / 2;
	};
	const profile = bits(8);
	bits(8); // constraint flags
	bits(8); // level
	unsignedExpGolomb(); // seq_parameter_set_id
	let chromaFormat = 1;
	let bitDepthLuma = 8;
	let bitDepthChroma = 8;
	if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(profile)) {
		chromaFormat = unsignedExpGolomb();
		if (chromaFormat === 3)
			bit();
		bitDepthLuma = unsignedExpGolomb() + 8;
		bitDepthChroma = unsignedExpGolomb() + 8;
		bit(); // qpprime_y_zero_transform_bypass_flag
		if (bit() === 1)
			validationError('unsupported-video-profile', 'AVC custom scaling matrices are outside the silent-video profile.');
	}
	unsignedExpGolomb(); // log2_max_frame_num_minus4
	const pictureOrderCountType = unsignedExpGolomb();
	if (pictureOrderCountType === 0) {
		unsignedExpGolomb();
	}
	else if (pictureOrderCountType === 1) {
		bit();
		signedExpGolomb();
		signedExpGolomb();
		const cycle = unsignedExpGolomb();
		if (cycle > 256)
			validationError('unsupported-video-profile', 'AVC picture-order cycle is unbounded.');
		for (let index = 0; index < cycle; index++)
			signedExpGolomb();
	}
	else if (pictureOrderCountType > 2) {
		validationError('unsupported-video-profile', 'AVC picture-order mode is invalid.');
	}
	unsignedExpGolomb(); // max_num_ref_frames
	bit(); // gaps_in_frame_num_value_allowed_flag
	const widthInMacroblocks = unsignedExpGolomb() + 1;
	const heightInMapUnits = unsignedExpGolomb() + 1;
	const frameOnly = bit() === 1;
	if (!frameOnly)
		bit();
	bit(); // direct_8x8_inference_flag
	let cropLeft = 0;
	let cropRight = 0;
	let cropTop = 0;
	let cropBottom = 0;
	if (bit() === 1) {
		cropLeft = unsignedExpGolomb();
		cropRight = unsignedExpGolomb();
		cropTop = unsignedExpGolomb();
		cropBottom = unsignedExpGolomb();
	}
	let colourDescription: { primaries: number; transfer: number; matrix: number } | undefined;
	const vuiParametersPresent = bit() === 1;
	if (vuiParametersPresent) {
		const aspectRatioInfoPresent = bit() === 1;
		if (aspectRatioInfoPresent) {
			const aspectRatioIdc = bits(8);
			if (aspectRatioIdc === 255)
				bits(32);
		}
		if (bit() === 1)
			bit(); // overscan_appropriate_flag
		const videoSignalTypePresent = bit() === 1;
		if (videoSignalTypePresent) {
			bits(3); // video_format
			bit(); // video_full_range_flag
			if (bit() === 1) {
				colourDescription = {
					primaries: bits(8),
					transfer: bits(8),
					matrix: bits(8),
				};
			}
		}
	}
	const cropUnitX = chromaFormat === 0 ? 1 : 2;
	const cropUnitY = (chromaFormat === 0 ? 1 : 2) * (frameOnly ? 1 : 2);
	return {
		profile,
		bitDepthLuma,
		bitDepthChroma,
		chromaFormat,
		colourDescription,
		width: widthInMacroblocks * 16 - (cropLeft + cropRight) * cropUnitX,
		height: heightInMapUnits * 16 * (frameOnly ? 1 : 2) - (cropTop + cropBottom) * cropUnitY,
	};
}

function validateVideoDeclarations(
	format: 'mp4' | 'webm',
	declarations: SilentVideoDeclarations,
) {
	const extension = declarations.sourceFileName?.trim().toLocaleLowerCase().match(/\.([^.]+)$/)?.[1];
	if (extension && extension !== format)
		validationError('conflicting-video-extension', `.${extension} conflicts with inspected ${format.toUpperCase()} content.`);
	const canonicalMime = format === 'mp4' ? 'video/mp4' : 'video/webm';
	if (declarations.declaredMime?.trim().toLocaleLowerCase() !== undefined
		&& declarations.declaredMime?.trim().toLocaleLowerCase() !== canonicalMime) {
		validationError('conflicting-video-mime', `${declarations.declaredMime} conflicts with inspected ${canonicalMime} content.`);
	}
}

function mp4TrackFacts(
	bytes: Uint8Array,
	trak: IsoBox,
	mediaData: readonly IsoBox[],
	movieTimeline: { timescale: number; durationUnits: number },
) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const trakChildren = childBoxes(bytes, trak);
	if (trakChildren.some(box => box.type === 'edts'))
		validationError('unsupported-video-transform', 'MP4 edit lists are not supported.');
	const tkhd = oneBox(trakChildren, 'tkhd');
	const tkhdVersion = bytes[tkhd.dataStart];
	if (tkhdVersion !== 0)
		validationError('unsupported-video-profile', 'Only bounded version-zero MP4 track headers are supported.');
	const matrixOffset = tkhd.dataStart + 40;
	const expectedMatrix = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];
	for (let index = 0; index < expectedMatrix.length; index++) {
		if (view.getInt32(matrixOffset + index * 4) !== expectedMatrix[index])
			validationError('unsupported-video-transform', 'MP4 track rotation, scaling, or translation is not supported.');
	}
	const mdia = oneBox(trakChildren, 'mdia');
	const mdiaChildren = childBoxes(bytes, mdia);
	const hdlr = oneBox(mdiaChildren, 'hdlr');
	if (ascii(bytes, hdlr.dataStart + 8, 4) !== 'vide')
		validationError('unsupported-video-tracks', 'Every MP4 track must be the single video track.');
	const mdhd = oneBox(mdiaChildren, 'mdhd');
	if (bytes[mdhd.dataStart] !== 0)
		validationError('unsupported-video-profile', 'Only bounded version-zero MP4 media headers are supported.');
	const timescale = u32(view, mdhd.dataStart + 12);
	const durationUnits = u32(view, mdhd.dataStart + 16);
	if (timescale === 0 || durationUnits === 0)
		validationError('malformed-video-timeline', 'MP4 media duration and timescale must be positive.');
	const minf = oneBox(mdiaChildren, 'minf');
	const minfChildren = childBoxes(bytes, minf);
	const dinf = oneBox(minfChildren, 'dinf');
	const dref = oneBox(childBoxes(bytes, dinf), 'dref');
	const drefEntryCount = u32(view, dref.dataStart + 4);
	const drefEntries = isoBoxes(bytes, dref.dataStart + 8, dref.end);
	if (
		drefEntryCount !== 1
		|| drefEntries.length !== 1
		|| drefEntries[0]!.type !== 'url '
		|| (u32(view, drefEntries[0]!.dataStart) & 1) !== 1
	) {
		validationError('unsupported-video-tracks', 'MP4 external media references are not supported.');
	}
	const stblParent = oneBox(minfChildren, 'stbl');
	const sampleBoxes = childBoxes(bytes, stblParent);
	const stsd = oneBox(sampleBoxes, 'stsd');
	const entryCount = u32(view, stsd.dataStart + 4);
	const entries = isoBoxes(bytes, stsd.dataStart + 8, stsd.end);
	if (entryCount !== 1 || entries.length !== 1)
		validationError('unsupported-video-codec', 'MP4 requires one AVC sample description.');
	const sampleEntry = entries[0]!;
	if (sampleEntry.type === 'encv' || childBoxes(bytes, {
		...sampleEntry,
		dataStart: Math.min(sampleEntry.end, sampleEntry.dataStart + 78),
	}).some(box => box.type === 'sinf')) {
		validationError('unsupported-video-encryption', 'Encrypted MP4 video is not supported.');
	}
	if (sampleEntry.type !== 'avc1')
		validationError('unsupported-video-codec', 'MP4 video must use H.264/AVC with an avc1 sample entry.');
	const width = view.getUint16(sampleEntry.dataStart + 24);
	const height = view.getUint16(sampleEntry.dataStart + 26);
	const visualChildren = isoBoxes(bytes, sampleEntry.dataStart + 78, sampleEntry.end);
	if (visualChildren.some(box => box.type === 'clap'))
		validationError('unsupported-video-transform', 'MP4 crop transforms are not supported.');
	const pixelAspect = visualChildren.find(box => box.type === 'pasp');
	if (
		pixelAspect
		&& (
			u32(view, pixelAspect.dataStart) !== 1
			|| u32(view, pixelAspect.dataStart + 4) !== 1
		)
	) {
		validationError('unsupported-video-transform', 'MP4 pixel-aspect transforms are not supported.');
	}
	const avcC = oneBox(visualChildren, 'avcC');
	if (bytes[avcC.dataStart] !== 1)
		validationError('unsupported-video-profile', 'MP4 AVC configuration is malformed.');
	const profile = bytes[avcC.dataStart + 1]!;
	if (![66, 77, 88, 100, 110, 122, 244].includes(profile))
		validationError('unsupported-video-profile', 'H.264 profile is outside the silent-video profile.');
	const spsCount = bytes[avcC.dataStart + 5]! & 0x1F;
	if (spsCount !== 1)
		validationError('unsupported-video-profile', 'AVC configuration requires exactly one SPS.');
	const spsLength = view.getUint16(avcC.dataStart + 6);
	const spsStart = avcC.dataStart + 8;
	if (spsLength === 0 || spsStart + spsLength > avcC.end)
		validationError('unsupported-video-profile', 'AVC SPS length exceeds its configuration.');
	const sps = h264SpsFacts(bytes.subarray(spsStart, spsStart + spsLength));
	if (
		sps.profile !== profile
		|| sps.bitDepthLuma !== 8
		|| sps.bitDepthChroma !== 8
		|| sps.chromaFormat !== 1
		|| sps.width !== width
		|| sps.height !== height
	) {
		validationError('unsupported-video-profile', 'AVC SPS must prove matching 8-bit 4:2:0 dimensions.');
	}
	if (
		sps.colourDescription
		&& (
			![1, 2].includes(sps.colourDescription.primaries)
			|| ![1, 2].includes(sps.colourDescription.transfer)
			|| ![1, 2].includes(sps.colourDescription.matrix)
		)
	) {
		validationError('unsupported-video-profile', 'AVC SPS colour signalling is outside 8-bit SDR BT.709.');
	}
	const colour = visualChildren.find(box => box.type === 'colr');
	if (colour) {
		const colourType = ascii(bytes, colour.dataStart, 4);
		if (!['nclx', 'nclc'].includes(colourType))
			validationError('unsupported-video-profile', 'MP4 colour metadata is outside 8-bit SDR BT.709.');
		const primaries = view.getUint16(colour.dataStart + 4);
		const transfer = view.getUint16(colour.dataStart + 6);
		const matrix = view.getUint16(colour.dataStart + 8);
		if (![1, 2].includes(primaries) || ![1, 2].includes(transfer) || ![1, 2].includes(matrix))
			validationError('unsupported-video-profile', 'MP4 colour metadata is outside 8-bit SDR BT.709.');
	}
	const stts = oneBox(sampleBoxes, 'stts');
	const timingCount = u32(view, stts.dataStart + 4);
	const maximumFrameCount = MAX_SILENT_VIDEO_DURATION_SECONDS * MAX_SILENT_VIDEO_FRAME_RATE;
	if (
		timingCount > maximumFrameCount
		|| stts.dataStart + 8 + timingCount * 8 !== stts.end
	) {
		validationError('malformed-video-timeline', 'MP4 sample timing exceeds bounded inspection.');
	}
	let timingOffset = stts.dataStart + 8;
	let frameCount = 0;
	let timingDuration = 0;
	const sampleDurations: number[] = [];
	for (let index = 0; index < timingCount; index++, timingOffset += 8) {
		const count = u32(view, timingOffset);
		const delta = u32(view, timingOffset + 4);
		if (count === 0 || delta === 0)
			validationError('malformed-video-timeline', 'MP4 sample timing must be complete and monotonic.');
		if (delta * MAX_SILENT_VIDEO_FRAME_RATE < timescale)
			validationError('video-frame-rate-exceeded', 'Every MP4 frame interval must remain at or below 60 fps.');
		if (count > maximumFrameCount - frameCount)
			validationError('video-frame-rate-exceeded', 'MP4 sample timing exceeds the bounded 120-second, 60-fps profile.');
		frameCount += count;
		timingDuration += count * delta;
		for (let sample = 0; sample < count; sample++)
			sampleDurations.push(delta);
	}
	const compositionOffsets = Array.from({ length: frameCount }).fill(0) as number[];
	const ctts = sampleBoxes.find(box => box.type === 'ctts');
	if (ctts) {
		const version = bytes[ctts.dataStart];
		if (
			(version !== 0 && version !== 1)
			|| (u32(view, ctts.dataStart) & 0x00FF_FFFF) !== 0
		) {
			validationError('malformed-video-timeline', 'MP4 composition timing has an unsupported header.');
		}
		const compositionEntryCount = u32(view, ctts.dataStart + 4);
		if (
			compositionEntryCount > frameCount
			|| ctts.dataStart + 8 + compositionEntryCount * 8 !== ctts.end
		) {
			validationError('malformed-video-timeline', 'MP4 composition timing exceeds bounded inspection.');
		}
		let sampleIndex = 0;
		for (let index = 0; index < compositionEntryCount; index++) {
			const offset = ctts.dataStart + 8 + index * 8;
			const count = u32(view, offset);
			const compositionOffset = version === 0
				? u32(view, offset + 4)
				: view.getInt32(offset + 4);
			if (count === 0 || count > frameCount - sampleIndex)
				validationError('malformed-video-timeline', 'MP4 composition timing does not cover the sample timeline.');
			compositionOffsets.fill(
				compositionOffset,
				sampleIndex,
				sampleIndex + count,
			);
			sampleIndex += count;
		}
		if (sampleIndex !== frameCount)
			validationError('malformed-video-timeline', 'MP4 composition timing does not cover every timed frame.');
	}
	let decodeTime = 0;
	const presentationIntervals = sampleDurations.map((sampleDuration, index) => {
		const start = decodeTime + compositionOffsets[index]!;
		const end = start + sampleDuration;
		decodeTime += sampleDuration;
		if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0)
			validationError('malformed-video-timeline', 'MP4 composition timing exceeds bounded non-negative precision.');
		return { start, end };
	}).toSorted((left, right) => left.start - right.start);
	let presentationEnd = 0;
	for (const interval of presentationIntervals) {
		if (interval.start !== presentationEnd)
			validationError('malformed-video-timeline', 'MP4 composition timing overlaps or leaves a gap in presentation.');
		presentationEnd = interval.end;
	}
	if (presentationEnd !== timingDuration)
		validationError('malformed-video-timeline', 'MP4 composition duration conflicts with its sample timeline.');
	const stsz = oneBox(sampleBoxes, 'stsz');
	const sampleSize = u32(view, stsz.dataStart + 4);
	const sizedSampleCount = u32(view, stsz.dataStart + 8);
	if (
		frameCount === 0
		|| sizedSampleCount !== frameCount
		|| (sampleSize === 0 && stsz.dataStart + 12 + frameCount * 4 !== stsz.end)
	) {
		validationError('video-index-incomplete', 'MP4 sample sizes do not cover every timed frame.');
	}
	const sampleSizes = Array.from({ length: frameCount }, (_, index) =>
		sampleSize || u32(view, stsz.dataStart + 12 + index * 4));
	if (sampleSizes.includes(0))
		validationError('video-index-incomplete', 'MP4 contains an empty indexed video sample.');
	const chunks = sampleBoxes.find(box => box.type === 'co64' || box.type === 'stco');
	const stsc = oneBox(sampleBoxes, 'stsc');
	const stss = oneBox(sampleBoxes, 'stss', 'video-index-incomplete');
	if (
		!chunks
		|| u32(view, chunks.dataStart + 4) === 0
		|| u32(view, stsc.dataStart + 4) === 0
		|| u32(view, stss.dataStart + 4) === 0
	) {
		validationError('video-index-incomplete', 'MP4 requires complete chunk and random-access indexes.');
	}
	const chunkCount = u32(view, chunks.dataStart + 4);
	if (chunkCount > frameCount)
		validationError('video-index-incomplete', 'MP4 chunk count exceeds the bounded sample timeline.');
	const chunkOffsetLength = chunks.type === 'co64' ? 8 : 4;
	if (chunks.dataStart + 8 + chunkCount * chunkOffsetLength !== chunks.end)
		validationError('video-index-incomplete', 'MP4 chunk offsets are incomplete.');
	const chunkOffsets: number[] = [];
	for (let index = 0; index < chunkCount; index++) {
		const wideOffset = chunks.type === 'co64'
			? view.getBigUint64(chunks.dataStart + 8 + index * 8)
			: BigInt(u32(view, chunks.dataStart + 8 + index * 4));
		if (wideOffset > BigInt(Number.MAX_SAFE_INTEGER))
			validationError('video-index-incomplete', 'MP4 chunk offset exceeds bounded precision.');
		const offset = Number(wideOffset);
		if (!mediaData.some(box => offset >= box.dataStart && offset < box.end))
			validationError('video-index-incomplete', 'MP4 chunk offset points outside media data.');
		chunkOffsets.push(offset);
	}
	const chunkMapCount = u32(view, stsc.dataStart + 4);
	if (stsc.dataStart + 8 + chunkMapCount * 12 !== stsc.end)
		validationError('video-index-incomplete', 'MP4 sample-to-chunk index is incomplete.');
	let mappedSamples = 0;
	let previousFirstChunk = 0;
	let previousChunkEnd = -1;
	for (let index = 0; index < chunkMapCount; index++) {
		const offset = stsc.dataStart + 8 + index * 12;
		const firstChunk = u32(view, offset);
		const samplesPerChunk = u32(view, offset + 4);
		const descriptionIndex = u32(view, offset + 8);
		const nextFirstChunk = index + 1 < chunkMapCount
			? u32(view, offset + 12)
			: chunkCount + 1;
		if (
			(index === 0 && firstChunk !== 1)
			|| firstChunk <= previousFirstChunk
			|| nextFirstChunk <= firstChunk
			|| nextFirstChunk > chunkCount + 1
			|| samplesPerChunk === 0
			|| descriptionIndex !== 1
		) {
			validationError('video-index-incomplete', 'MP4 sample-to-chunk index is malformed.');
		}
		for (let chunk = firstChunk; chunk < nextFirstChunk; chunk++) {
			const chunkOffset = chunkOffsets[chunk - 1]!;
			const chunkSampleEnd = mappedSamples + samplesPerChunk;
			if (chunkSampleEnd > sampleSizes.length)
				validationError('video-index-incomplete', 'MP4 chunk map exceeds the declared sample sizes.');
			const chunkByteLength = sampleSizes
				.slice(mappedSamples, chunkSampleEnd)
				.reduce((total, size) => total + size, 0);
			const mediaBox = mediaData.find(box =>
				chunkOffset >= box.dataStart && chunkOffset < box.end);
			if (
				!Number.isSafeInteger(chunkByteLength)
				|| chunkOffset < previousChunkEnd
				|| !mediaBox
				|| chunkOffset + chunkByteLength > mediaBox.end
			) {
				validationError('video-index-incomplete', 'MP4 indexed samples exceed or overlap media data.');
			}
			mappedSamples = chunkSampleEnd;
			previousChunkEnd = chunkOffset + chunkByteLength;
		}
		previousFirstChunk = firstChunk;
	}
	if (mappedSamples !== frameCount)
		validationError('video-index-incomplete', 'MP4 sample-to-chunk index does not cover every frame.');
	const syncCount = u32(view, stss.dataStart + 4);
	if (stss.dataStart + 8 + syncCount * 4 !== stss.end)
		validationError('video-index-incomplete', 'MP4 random-access index is incomplete.');
	let previousSyncSample = 0;
	for (let index = 0; index < syncCount; index++) {
		const sample = u32(view, stss.dataStart + 8 + index * 4);
		if ((index === 0 && sample !== 1) || sample <= previousSyncSample || sample > frameCount)
			validationError('video-index-incomplete', 'MP4 random-access sample is outside the timeline.');
		previousSyncSample = sample;
	}
	const durationSeconds = durationUnits / timescale;
	if (Math.abs(timingDuration / timescale - durationSeconds) > Math.max(0.05, durationSeconds / frameCount))
		validationError('malformed-video-timeline', 'MP4 track duration conflicts with its sample timeline.');
	const movieDurationSeconds = movieTimeline.durationUnits / movieTimeline.timescale;
	if (
		Math.abs(movieDurationSeconds - durationSeconds)
		> Math.max(1 / movieTimeline.timescale, 1 / timescale)
	) {
		validationError('malformed-video-timeline', 'MP4 movie duration conflicts with its media timeline.');
	}
	return { width, height, durationSeconds, frameCount };
}

function inspectMp4(
	bytes: Uint8Array,
	sourceLayout?: {
		moovStart: number;
		mediaData: readonly IsoBox[];
		firstMdatStart: number;
	},
) {
	const top = isoBoxes(bytes);
	const ftyp = oneBox(top, 'ftyp');
	if (ftyp.end - ftyp.dataStart < 8 || (ftyp.end - ftyp.dataStart - 8) % 4 !== 0)
		validationError('malformed-video', 'MP4 file-type declaration is malformed.');
	const mp4Brands = new Set(['isom', 'iso2', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1']);
	const majorBrand = ascii(bytes, ftyp.dataStart, 4);
	if (!mp4Brands.has(majorBrand))
		validationError('unsupported-video-format', 'ISO-BMFF file type is not an MP4-compatible brand.');
	const moov = oneBox(top, 'moov');
	const firstMdatStart = sourceLayout?.firstMdatStart
		?? top.find(box => box.type === 'mdat')?.start;
	if (firstMdatStart === undefined || (sourceLayout?.moovStart ?? moov.start) > firstMdatStart)
		validationError('mp4-fast-start-required', 'MP4 requires fast-start ordering with moov before media data.');
	const moovChildren = childBoxes(bytes, moov);
	const mvhd = oneBox(moovChildren, 'mvhd');
	if (bytes[mvhd.dataStart] !== 0)
		validationError('unsupported-video-profile', 'Only bounded version-zero MP4 movie headers are supported.');
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const movieTimescale = u32(view, mvhd.dataStart + 12);
	const movieDurationUnits = u32(view, mvhd.dataStart + 16);
	if (movieTimescale === 0 || movieDurationUnits === 0)
		validationError('malformed-video-timeline', 'MP4 movie duration and timescale must be positive.');
	const movieMatrixOffset = mvhd.dataStart + 36;
	const expectedMovieMatrix = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];
	for (let index = 0; index < expectedMovieMatrix.length; index++) {
		if (u32(view, movieMatrixOffset + index * 4) !== expectedMovieMatrix[index])
			validationError('unsupported-video-transform', 'MP4 movie transforms are not supported.');
	}
	const tracks = moovChildren.filter(box => box.type === 'trak');
	if (tracks.length !== 1)
		validationError('unsupported-video-tracks', 'Silent video requires exactly one complete video track.');
	if (moovChildren.some(box => ['iods', 'meta'].includes(box.type)))
		validationError('unsupported-video-tracks', 'MP4 ancillary presentation tracks are not supported.');
	return mp4TrackFacts(
		bytes,
		tracks[0]!,
		sourceLayout?.mediaData ?? top.filter(box => box.type === 'mdat'),
		{ timescale: movieTimescale, durationUnits: movieDurationUnits },
	);
}

interface EbmlElement {
	id: number;
	start: number;
	dataStart: number;
	end: number;
}

function ebmlVint(bytes: Uint8Array, offset: number, preserveMarker: boolean) {
	if (offset >= bytes.byteLength)
		validationError('malformed-video', 'WebM contains an incomplete variable integer.');
	let mask = 0x80;
	let length = 1;
	while (length <= 8 && (bytes[offset]! & mask) === 0) {
		mask >>>= 1;
		length++;
	}
	if (length > 8 || offset + length > bytes.byteLength)
		validationError('malformed-video', 'WebM contains an invalid variable integer.');
	let value = preserveMarker ? bytes[offset]! : bytes[offset]! & (mask - 1);
	for (let index = 1; index < length; index++)
		value = value * 256 + bytes[offset + index]!;
	const unknown = !preserveMarker && value === 2 ** (7 * length) - 1;
	return { length, value, unknown };
}

function ebmlElements(bytes: Uint8Array, start: number, end: number) {
	const elements: EbmlElement[] = [];
	for (let offset = start; offset < end;) {
		const id = ebmlVint(bytes, offset, true);
		const size = ebmlVint(bytes, offset + id.length, false);
		const dataStart = offset + id.length + size.length;
		const elementEnd = size.unknown ? end : dataStart + size.value;
		if (elementEnd > end || elementEnd < dataStart)
			validationError('video-index-incomplete', 'WebM element size exceeds the available source bytes.');
		elements.push({ id: id.value, start: offset, dataStart, end: elementEnd });
		offset = elementEnd;
	}
	return elements;
}

function ebmlChildren(bytes: Uint8Array, parent: EbmlElement) {
	return ebmlElements(bytes, parent.dataStart, parent.end);
}

function oneEbml(
	elements: readonly EbmlElement[],
	id: number,
	code: 'malformed-video' | 'video-index-incomplete' = 'malformed-video',
) {
	const matches = elements.filter(element => element.id === id);
	if (matches.length !== 1)
		validationError(code, `WebM requires exactly one 0x${id.toString(16)} element.`);
	return matches[0]!;
}

function ebmlUnsigned(bytes: Uint8Array, element: EbmlElement) {
	const length = element.end - element.dataStart;
	if (length < 1 || length > 6)
		validationError('malformed-video', 'WebM integer is outside bounded precision.');
	let value = 0;
	for (let offset = element.dataStart; offset < element.end; offset++)
		value = value * 256 + bytes[offset]!;
	return value;
}

function ebmlFloat(bytes: Uint8Array, element: EbmlElement) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const length = element.end - element.dataStart;
	if (length === 4)
		return view.getFloat32(element.dataStart);
	if (length === 8)
		return view.getFloat64(element.dataStart);
	validationError('malformed-video', 'WebM duration must be a bounded float.');
}

function ebmlString(bytes: Uint8Array, element: EbmlElement) {
	return ascii(bytes, element.dataStart, element.end - element.dataStart);
}

function webmBlockFacts(bytes: Uint8Array, block: EbmlElement) {
	const track = ebmlVint(bytes, block.dataStart, false);
	const header = block.dataStart + track.length;
	if (header + 3 > block.end)
		validationError('malformed-video-timeline', 'WebM block header is incomplete.');
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const relativeTime = view.getInt16(header);
	const flags = bytes[header + 2]!;
	const lacing = (flags >>> 1) & 0x03;
	if (lacing !== 0)
		validationError('unsupported-video-profile', 'Laced WebM video blocks are outside bounded inspection.');
	return {
		track: track.value,
		relativeTime,
		payload: bytes.subarray(header + 3, block.end),
	};
}

function validateVp9KeyFrame(payload: Uint8Array) {
	if (payload.byteLength < 10)
		validationError('malformed-video', 'VP9 key frame header is incomplete.');
	let bitOffset = 0;
	const bit = () => {
		const value = (payload[Math.floor(bitOffset / 8)]! >>> (bitOffset % 8)) & 1;
		bitOffset++;
		return value;
	};
	const bits = (count: number) => {
		let value = 0;
		for (let index = 0; index < count; index++)
			value |= bit() << index;
		return value;
	};
	if (bits(2) !== 2)
		validationError('malformed-video', 'VP9 frame marker is invalid.');
	const profile = bits(1) | (bits(1) << 1);
	if (profile === 3 && bit() !== 0)
		validationError('unsupported-video-profile', 'VP9 reserved profile bit is set.');
	// VP9 profiles are normative format constraints, not merely decoder
	// preferences: profile 0 is 8-bit 4:2:0; profile 1 is 8-bit 4:2:2/4:4:4;
	// profiles 2 and 3 are 10/12-bit. The high-bit-depth selector below
	// chooses 10 versus 12 bits and can never prove 8-bit content.
	if (profile !== 0)
		validationError('unsupported-video-profile', 'VP9 profile 0 is required to prove 8-bit 4:2:0 video.');
	if (bit() !== 0)
		validationError('video-index-incomplete', 'The first indexed VP9 frame must be a key frame.');
	const frameType = bit();
	bit(); // show_frame
	bit(); // error_resilient_mode
	if (frameType !== 0 || bits(8) !== 0x49 || bits(8) !== 0x83 || bits(8) !== 0x42)
		validationError('video-index-incomplete', 'The first indexed VP9 frame is not a complete key frame.');
	const colorSpace = bits(3);
	if (colorSpace > 2)
		validationError('unsupported-video-profile', 'VP9 video must use SDR BT.709-compatible colour.');
	bit(); // colour range
}

function inspectWebm(bytes: Uint8Array) {
	const roots = ebmlElements(bytes, 0, bytes.byteLength);
	const header = oneEbml(roots, 0x1A45DFA3);
	const docType = ebmlChildren(bytes, header).find(element => element.id === 0x4282);
	if (!docType || ebmlString(bytes, docType) !== 'webm')
		validationError('unsupported-video-format', 'EBML source is not a WebM container.');
	const segment = oneEbml(roots, 0x18538067);
	const children = ebmlChildren(bytes, segment);
	if (children.some(element => [0x1941A469, 0x1043A770].includes(element.id)))
		validationError('unsupported-video-tracks', 'WebM attachments and chapters are not supported.');
	const info = oneEbml(children, 0x1549A966);
	const infoChildren = ebmlChildren(bytes, info);
	const durationElement = oneEbml(infoChildren, 0x4489);
	const scaleElement = infoChildren.find(element => element.id === 0x2AD7B1);
	const timecodeScale = scaleElement ? ebmlUnsigned(bytes, scaleElement) : 1_000_000;
	const durationSeconds = ebmlFloat(bytes, durationElement) * timecodeScale / 1_000_000_000;
	const tracks = oneEbml(children, 0x1654AE6B);
	const trackEntries = ebmlChildren(bytes, tracks).filter(element => element.id === 0xAE);
	if (trackEntries.length !== 1)
		validationError('unsupported-video-tracks', 'Silent video requires exactly one WebM video track.');
	const track = ebmlChildren(bytes, trackEntries[0]!);
	const trackNumber = ebmlUnsigned(bytes, oneEbml(track, 0xD7));
	if (ebmlUnsigned(bytes, oneEbml(track, 0x83)) !== 1)
		validationError('unsupported-video-tracks', 'WebM audio, subtitles, and ancillary tracks are not supported.');
	if (ebmlString(bytes, oneEbml(track, 0x86)) !== 'V_VP9')
		validationError('unsupported-video-codec', 'WebM video must use VP9.');
	if (track.some(element => [0x6D80, 0xE2].includes(element.id)))
		validationError('unsupported-video-encryption', 'Encrypted or operated WebM tracks are not supported.');
	const video = ebmlChildren(bytes, oneEbml(track, 0xE0));
	const width = ebmlUnsigned(bytes, oneEbml(video, 0xB0));
	const height = ebmlUnsigned(bytes, oneEbml(video, 0xBA));
	const displayWidth = video.find(element => element.id === 0x54B0);
	const displayHeight = video.find(element => element.id === 0x54BA);
	const crop = video.some(element => [0x54AA, 0x54BB, 0x54CC, 0x54DD].includes(element.id));
	if (
		crop
		|| (displayWidth && ebmlUnsigned(bytes, displayWidth) !== width)
		|| (displayHeight && ebmlUnsigned(bytes, displayHeight) !== height)
	) {
		validationError('unsupported-video-transform', 'WebM crop and display transforms are not supported.');
	}
	const hasAlpha = video.some(element => element.id === 0x53C0 && ebmlUnsigned(bytes, element) === 1);
	const colour = video.find(element => element.id === 0x55B0);
	if (colour) {
		const colourChildren = ebmlChildren(bytes, colour);
		const bitDepth = colourChildren.find(element => element.id === 0x55B2);
		if (bitDepth && ebmlUnsigned(bytes, bitDepth) !== 8)
			validationError('unsupported-video-profile', 'VP9 video must be 8-bit.');
		for (const [id, label] of [[0x55BB, 'primaries'], [0x55BA, 'transfer'], [0x55B1, 'matrix']] as const) {
			const element = colourChildren.find(candidate => candidate.id === id);
			if (element && ![1, 2].includes(ebmlUnsigned(bytes, element)))
				validationError('unsupported-video-profile', `WebM ${label} signalling is outside 8-bit SDR BT.709.`);
		}
		if (colourChildren.some(element => [0x55BC, 0x55BD, 0x55D0].includes(element.id)))
			validationError('unsupported-video-profile', 'WebM HDR mastering and light-level metadata is not supported.');
	}
	const cues = oneEbml(children, 0x1C53BB6B, 'video-index-incomplete');
	const cuePoints = ebmlChildren(bytes, cues).filter(element => element.id === 0xBB);
	if (cuePoints.length === 0)
		validationError('video-index-incomplete', 'WebM requires a non-empty seekable Cues index.');
	const clusters = children.filter(element => element.id === 0x1F43B675);
	if (clusters.length === 0)
		validationError('video-index-incomplete', 'WebM requires indexed media clusters.');
	const cueReferences: Array<{ time: number; clusterPosition: number }> = [];
	let previousCueTime = -1;
	for (const cuePoint of cuePoints) {
		const cueChildren = ebmlChildren(bytes, cuePoint);
		const cueTime = ebmlUnsigned(bytes, oneEbml(cueChildren, 0xB3, 'video-index-incomplete'));
		if (cueTime <= previousCueTime)
			validationError('video-index-incomplete', 'WebM Cue times must be strictly increasing.');
		const positions = oneEbml(cueChildren, 0xB7, 'video-index-incomplete');
		const positionChildren = ebmlChildren(bytes, positions);
		if (ebmlUnsigned(bytes, oneEbml(positionChildren, 0xF7, 'video-index-incomplete')) !== trackNumber)
			validationError('video-index-incomplete', 'WebM Cue references the wrong track.');
		const clusterPosition = ebmlUnsigned(bytes, oneEbml(positionChildren, 0xF1, 'video-index-incomplete'));
		cueReferences.push({ time: cueTime, clusterPosition });
		previousCueTime = cueTime;
	}
	let frameCount = 0;
	let previousTime = -Infinity;
	let firstTime: number | undefined;
	let firstPayload: Uint8Array | undefined;
	const clusterIndex = new Map<number, { time: number; firstPayload: Uint8Array }>();
	for (const cluster of clusters) {
		const clusterChildren = ebmlChildren(bytes, cluster);
		const clusterTime = ebmlUnsigned(bytes, oneEbml(clusterChildren, 0xE7));
		const blocks = clusterChildren.flatMap((element) => {
			if (element.id === 0xA3)
				return [element];
			if (element.id === 0xA0)
				return ebmlChildren(bytes, element).filter(child => child.id === 0xA1);
			return [];
		});
		let clusterFirstPayload: Uint8Array | undefined;
		for (const block of blocks) {
			const facts = webmBlockFacts(bytes, block);
			if (facts.track !== trackNumber)
				validationError('unsupported-video-tracks', 'WebM block references an undeclared track.');
			const absoluteTime = clusterTime + facts.relativeTime;
			if (absoluteTime < 0 || absoluteTime <= previousTime)
				validationError('malformed-video-timeline', 'WebM frame timing must be positive and strictly monotonic.');
			if (
				Number.isFinite(previousTime)
				&& (absoluteTime - previousTime) * timecodeScale * MAX_SILENT_VIDEO_FRAME_RATE < 1_000_000_000
			) {
				validationError('video-frame-rate-exceeded', 'Every WebM frame interval must remain at or below 60 fps.');
			}
			firstTime ??= absoluteTime;
			previousTime = absoluteTime;
			firstPayload ??= facts.payload;
			clusterFirstPayload ??= facts.payload;
			frameCount++;
		}
		if (!clusterFirstPayload)
			validationError('video-index-incomplete', 'WebM cluster contains no complete video frame.');
		clusterIndex.set(
			cluster.start - segment.dataStart,
			{ time: clusterTime, firstPayload: clusterFirstPayload },
		);
	}
	if (frameCount === 0 || !firstPayload)
		validationError('video-index-incomplete', 'WebM media index contains no complete frames.');
	if (
		firstTime !== 0
		|| previousTime * timecodeScale / 1_000_000_000 > durationSeconds
	) {
		validationError('malformed-video-timeline', 'WebM media timeline must start at zero and remain within its declared duration.');
	}
	validateVp9KeyFrame(firstPayload);
	const indexedClusters = new Set<number>();
	for (const cue of cueReferences) {
		const indexed = clusterIndex.get(cue.clusterPosition);
		if (
			!indexed
			|| indexed.time !== cue.time
			|| indexedClusters.has(cue.clusterPosition)
			|| cue.time * timecodeScale / 1_000_000_000 > durationSeconds
		) {
			validationError('video-index-incomplete', 'WebM Cue does not uniquely match its key-frame cluster and timeline.');
		}
		validateVp9KeyFrame(indexed.firstPayload);
		indexedClusters.add(cue.clusterPosition);
	}
	const firstClusterPosition = Math.min(...clusterIndex.keys());
	if (cueReferences[0]!.clusterPosition !== firstClusterPosition)
		validationError('video-index-incomplete', 'WebM Cues must index the initial random-access cluster.');
	if (indexedClusters.size !== clusterIndex.size)
		validationError('video-index-incomplete', 'WebM Cues must cover every random-access cluster.');
	return { width, height, durationSeconds, frameCount, hasAlpha };
}

function validateFacts(facts: {
	width: number;
	height: number;
	durationSeconds: number;
	frameCount: number;
}) {
	if (
		!Number.isSafeInteger(facts.width)
		|| !Number.isSafeInteger(facts.height)
		|| facts.width < 1
		|| facts.height < 1
		|| facts.width > MAX_SILENT_VIDEO_WIDTH
		|| facts.height > MAX_SILENT_VIDEO_HEIGHT
	) {
		validationError('video-dimensions-exceeded', 'Silent video dimensions must not exceed 3840 × 2160.');
	}
	if (!Number.isFinite(facts.durationSeconds) || facts.durationSeconds <= 0)
		validationError('malformed-video-timeline', 'Silent video duration must be positive and finite.');
	if (facts.durationSeconds > MAX_SILENT_VIDEO_DURATION_SECONDS)
		validationError('video-duration-exceeded', 'Silent video duration must not exceed 120 seconds.');
	const frameRate = facts.frameCount / facts.durationSeconds;
	if (!Number.isFinite(frameRate) || frameRate <= 0)
		validationError('malformed-video-timeline', 'Silent video frame rate must be positive and finite.');
	if (frameRate > MAX_SILENT_VIDEO_FRAME_RATE + 0.001)
		validationError('video-frame-rate-exceeded', 'Silent video frame rate must not exceed 60 fps.');
	return frameRate;
}

const SILENT_VIDEO_INSPECTION_WINDOW_BYTES = 256 * 1024;
const SILENT_VIDEO_INSPECTION_MAX_METADATA_BYTES = 8 * 1024 * 1024;
const SILENT_VIDEO_INSPECTION_MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const SILENT_VIDEO_INSPECTION_MAX_READS = 20_000;
const SILENT_VIDEO_INSPECTION_MAX_TOP_LEVEL_BOXES = 1024;
const SILENT_VIDEO_INSPECTION_MAX_WEBM_ELEMENTS = 10_000;

function boundedRandomAccessReader(source: SilentVideoRandomAccessSource) {
	let readCount = 0;
	let totalBytes = 0;
	async function readExact(offset: number, length: number) {
		if (
			!Number.isSafeInteger(offset)
			|| !Number.isSafeInteger(length)
			|| offset < 0
			|| length <= 0
			|| length > SILENT_VIDEO_INSPECTION_WINDOW_BYTES
			|| offset + length > source.byteLength
		) {
			validationError('malformed-video', 'Video inspection requested an invalid bounded source range.');
		}
		readCount++;
		totalBytes += length;
		if (
			readCount > SILENT_VIDEO_INSPECTION_MAX_READS
			|| totalBytes > SILENT_VIDEO_INSPECTION_MAX_TOTAL_BYTES
		) {
			validationError('malformed-video', 'Video metadata exceeds bounded random-access inspection limits.');
		}
		const outcome = await source.read(offset, length);
		if (outcome.outcome !== 'available')
			throw new SilentVideoInspectionSourceError(outcome.outcome);
		if (
			outcome.completeLength !== source.byteLength
			|| outcome.bytes.byteLength !== length
		) {
			throw new SilentVideoInspectionSourceError('unavailable');
		}
		return outcome.bytes;
	}
	async function readSpan(offset: number, length: number, maximumLength: number) {
		if (
			!Number.isSafeInteger(length)
			|| length <= 0
			|| length > maximumLength
			|| offset + length > source.byteLength
		) {
			validationError('malformed-video', 'Video metadata span exceeds its explicit inspection limit.');
		}
		const result = new Uint8Array(length);
		for (let copied = 0; copied < length;) {
			const windowLength = Math.min(
				SILENT_VIDEO_INSPECTION_WINDOW_BYTES,
				length - copied,
			);
			result.set(await readExact(offset + copied, windowLength), copied);
			copied += windowLength;
		}
		return result;
	}
	return {
		readExact,
		readSpan,
		stats: () => ({ readCount, totalBytes }),
	};
}

async function inspectMp4RandomAccess(
	source: SilentVideoRandomAccessSource,
	reader: ReturnType<typeof boundedRandomAccessReader>,
) {
	const boxes: IsoBox[] = [];
	for (let offset = 0; offset < source.byteLength;) {
		if (boxes.length >= SILENT_VIDEO_INSPECTION_MAX_TOP_LEVEL_BOXES)
			validationError('malformed-video', 'MP4 exceeds the top-level box inspection limit.');
		const header = await reader.readExact(offset, Math.min(16, source.byteLength - offset));
		if (header.byteLength < 8)
			validationError('malformed-video', 'MP4 contains an incomplete box header.');
		const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
		const shortSize = view.getUint32(0);
		const type = ascii(header, 4, 4);
		let size = shortSize;
		let headerLength = 8;
		if (shortSize === 1) {
			if (header.byteLength < 16)
				validationError('malformed-video', 'MP4 contains an incomplete large box header.');
			const wide = view.getBigUint64(8);
			if (wide > BigInt(Number.MAX_SAFE_INTEGER))
				validationError('malformed-video', 'MP4 box size exceeds bounded precision.');
			size = Number(wide);
			headerLength = 16;
		}
		else if (shortSize === 0) {
			size = source.byteLength - offset;
		}
		if (size < headerLength || offset + size > source.byteLength)
			validationError('malformed-video', `MP4 ${type} box has an invalid size.`);
		boxes.push({
			type,
			start: offset,
			end: offset + size,
			dataStart: offset + headerLength,
		});
		offset += size;
	}
	const ftyp = oneBox(boxes, 'ftyp');
	const moov = oneBox(boxes, 'moov');
	const mediaData = boxes.filter(box => box.type === 'mdat');
	const firstMdat = mediaData[0];
	if (!firstMdat)
		validationError('video-index-incomplete', 'MP4 requires media data.');
	const [fileTypeBytes, movieBytes] = await Promise.all([
		reader.readSpan(ftyp.start, ftyp.end - ftyp.start, 64 * 1024),
		reader.readSpan(
			moov.start,
			moov.end - moov.start,
			SILENT_VIDEO_INSPECTION_MAX_METADATA_BYTES,
		),
	]);
	const metadata = new Uint8Array(fileTypeBytes.byteLength + movieBytes.byteLength);
	metadata.set(fileTypeBytes);
	metadata.set(movieBytes, fileTypeBytes.byteLength);
	return inspectMp4(metadata, {
		moovStart: moov.start,
		mediaData,
		firstMdatStart: firstMdat.start,
	});
}

async function readEbmlElementHeader(
	reader: ReturnType<typeof boundedRandomAccessReader>,
	offset: number,
	end: number,
): Promise<EbmlElement> {
	const header = await reader.readExact(offset, Math.min(16, end - offset));
	const id = ebmlVint(header, 0, true);
	const size = ebmlVint(header, id.length, false);
	const headerLength = id.length + size.length;
	const dataStart = offset + headerLength;
	const elementEnd = size.unknown ? end : dataStart + size.value;
	if (elementEnd > end || elementEnd < dataStart)
		validationError('video-index-incomplete', 'WebM element size exceeds the exact source length.');
	return { id: id.value, start: offset, dataStart, end: elementEnd };
}

async function scanEbmlElements(
	reader: ReturnType<typeof boundedRandomAccessReader>,
	start: number,
	end: number,
	maximumElements = SILENT_VIDEO_INSPECTION_MAX_WEBM_ELEMENTS,
) {
	const elements: EbmlElement[] = [];
	for (let offset = start; offset < end;) {
		if (elements.length >= maximumElements)
			validationError('malformed-video', 'WebM exceeds its explicit element-table inspection limit.');
		const element = await readEbmlElementHeader(reader, offset, end);
		elements.push(element);
		offset = element.end;
	}
	return elements;
}

async function readEbmlElementBytes(
	reader: ReturnType<typeof boundedRandomAccessReader>,
	element: EbmlElement,
	maximumLength: number,
) {
	return await reader.readSpan(
		element.start,
		element.end - element.start,
		maximumLength,
	);
}

function localEbmlElement(bytes: Uint8Array, id: number) {
	return oneEbml(ebmlElements(bytes, 0, bytes.byteLength), id);
}

function webmBlockPrefixFacts(bytes: Uint8Array) {
	const track = ebmlVint(bytes, 0, false);
	const header = track.length;
	if (header + 3 > bytes.byteLength)
		validationError('malformed-video-timeline', 'WebM block header is incomplete.');
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const lacing = (bytes[header + 2]! >>> 1) & 0x03;
	if (lacing !== 0)
		validationError('unsupported-video-profile', 'Laced WebM video blocks are outside bounded inspection.');
	return {
		track: track.value,
		relativeTime: view.getInt16(header),
		payload: bytes.subarray(header + 3),
	};
}

async function inspectWebmRandomAccess(
	source: SilentVideoRandomAccessSource,
	reader: ReturnType<typeof boundedRandomAccessReader>,
) {
	const roots = await scanEbmlElements(reader, 0, source.byteLength, 8);
	const header = oneEbml(roots, 0x1A45DFA3);
	const headerBytes = await readEbmlElementBytes(reader, header, 64 * 1024);
	const localHeader = localEbmlElement(headerBytes, 0x1A45DFA3);
	const docType = ebmlChildren(headerBytes, localHeader).find(element => element.id === 0x4282);
	if (!docType || ebmlString(headerBytes, docType) !== 'webm')
		validationError('unsupported-video-format', 'EBML source is not a WebM container.');
	const segment = oneEbml(roots, 0x18538067);
	const children = await scanEbmlElements(
		reader,
		segment.dataStart,
		segment.end,
		SILENT_VIDEO_INSPECTION_MAX_WEBM_ELEMENTS,
	);
	if (children.some(element => [0x1941A469, 0x1043A770].includes(element.id)))
		validationError('unsupported-video-tracks', 'WebM attachments and chapters are not supported.');

	const infoElement = oneEbml(children, 0x1549A966);
	const infoBytes = await readEbmlElementBytes(reader, infoElement, 256 * 1024);
	const info = localEbmlElement(infoBytes, 0x1549A966);
	const infoChildren = ebmlChildren(infoBytes, info);
	const durationElement = oneEbml(infoChildren, 0x4489);
	const scaleElement = infoChildren.find(element => element.id === 0x2AD7B1);
	const timecodeScale = scaleElement ? ebmlUnsigned(infoBytes, scaleElement) : 1_000_000;
	const durationSeconds = ebmlFloat(infoBytes, durationElement) * timecodeScale / 1_000_000_000;

	const tracksElement = oneEbml(children, 0x1654AE6B);
	const tracksBytes = await readEbmlElementBytes(reader, tracksElement, 1024 * 1024);
	const tracks = localEbmlElement(tracksBytes, 0x1654AE6B);
	const trackEntries = ebmlChildren(tracksBytes, tracks).filter(element => element.id === 0xAE);
	if (trackEntries.length !== 1)
		validationError('unsupported-video-tracks', 'Silent video requires exactly one WebM video track.');
	const track = ebmlChildren(tracksBytes, trackEntries[0]!);
	const trackNumber = ebmlUnsigned(tracksBytes, oneEbml(track, 0xD7));
	if (ebmlUnsigned(tracksBytes, oneEbml(track, 0x83)) !== 1)
		validationError('unsupported-video-tracks', 'WebM audio, subtitles, and ancillary tracks are not supported.');
	if (ebmlString(tracksBytes, oneEbml(track, 0x86)) !== 'V_VP9')
		validationError('unsupported-video-codec', 'WebM video must use VP9.');
	if (track.some(element => [0x6D80, 0xE2].includes(element.id)))
		validationError('unsupported-video-encryption', 'Encrypted or operated WebM tracks are not supported.');
	const video = ebmlChildren(tracksBytes, oneEbml(track, 0xE0));
	const width = ebmlUnsigned(tracksBytes, oneEbml(video, 0xB0));
	const height = ebmlUnsigned(tracksBytes, oneEbml(video, 0xBA));
	const displayWidth = video.find(element => element.id === 0x54B0);
	const displayHeight = video.find(element => element.id === 0x54BA);
	if (
		video.some(element => [0x54AA, 0x54BB, 0x54CC, 0x54DD].includes(element.id))
		|| (displayWidth && ebmlUnsigned(tracksBytes, displayWidth) !== width)
		|| (displayHeight && ebmlUnsigned(tracksBytes, displayHeight) !== height)
	) {
		validationError('unsupported-video-transform', 'WebM crop and display transforms are not supported.');
	}
	const hasAlpha = video.some(element =>
		element.id === 0x53C0 && ebmlUnsigned(tracksBytes, element) === 1);
	const colour = video.find(element => element.id === 0x55B0);
	if (colour) {
		const colourChildren = ebmlChildren(tracksBytes, colour);
		const bitDepth = colourChildren.find(element => element.id === 0x55B2);
		if (bitDepth && ebmlUnsigned(tracksBytes, bitDepth) !== 8)
			validationError('unsupported-video-profile', 'VP9 video must be 8-bit.');
		for (const [id, label] of [[0x55BB, 'primaries'], [0x55BA, 'transfer'], [0x55B1, 'matrix']] as const) {
			const element = colourChildren.find(candidate => candidate.id === id);
			if (element && ![1, 2].includes(ebmlUnsigned(tracksBytes, element)))
				validationError('unsupported-video-profile', `WebM ${label} signalling is outside 8-bit SDR BT.709.`);
		}
		if (colourChildren.some(element => [0x55BC, 0x55BD, 0x55D0].includes(element.id)))
			validationError('unsupported-video-profile', 'WebM HDR mastering and light-level metadata is not supported.');
	}

	const cuesElement = oneEbml(children, 0x1C53BB6B, 'video-index-incomplete');
	const cuesBytes = await readEbmlElementBytes(reader, cuesElement, 2 * 1024 * 1024);
	const cues = localEbmlElement(cuesBytes, 0x1C53BB6B);
	const cuePoints = ebmlChildren(cuesBytes, cues).filter(element => element.id === 0xBB);
	if (cuePoints.length === 0 || cuePoints.length > MAX_SILENT_VIDEO_DURATION_SECONDS * MAX_SILENT_VIDEO_FRAME_RATE)
		validationError('video-index-incomplete', 'WebM requires a bounded non-empty Cues index.');
	const cueReferences: Array<{ time: number; clusterPosition: number }> = [];
	let previousCueTime = -1;
	for (const cuePoint of cuePoints) {
		const cueChildren = ebmlChildren(cuesBytes, cuePoint);
		const cueTime = ebmlUnsigned(cuesBytes, oneEbml(cueChildren, 0xB3, 'video-index-incomplete'));
		if (cueTime <= previousCueTime)
			validationError('video-index-incomplete', 'WebM Cue times must be strictly increasing.');
		const positions = oneEbml(cueChildren, 0xB7, 'video-index-incomplete');
		const positionChildren = ebmlChildren(cuesBytes, positions);
		if (ebmlUnsigned(cuesBytes, oneEbml(positionChildren, 0xF7, 'video-index-incomplete')) !== trackNumber)
			validationError('video-index-incomplete', 'WebM Cue references the wrong track.');
		cueReferences.push({
			time: cueTime,
			clusterPosition: ebmlUnsigned(
				cuesBytes,
				oneEbml(positionChildren, 0xF1, 'video-index-incomplete'),
			),
		});
		previousCueTime = cueTime;
	}

	const clusters = children.filter(element => element.id === 0x1F43B675);
	if (clusters.length === 0 || clusters.length > MAX_SILENT_VIDEO_DURATION_SECONDS * MAX_SILENT_VIDEO_FRAME_RATE)
		validationError('video-index-incomplete', 'WebM requires bounded indexed media clusters.');
	let frameCount = 0;
	let previousTime = -Infinity;
	let firstTime: number | undefined;
	const clusterIndex = new Map<number, { time: number; firstPayload: Uint8Array }>();
	for (const cluster of clusters) {
		const clusterChildren = await scanEbmlElements(
			reader,
			cluster.dataStart,
			cluster.end,
			MAX_SILENT_VIDEO_DURATION_SECONDS * MAX_SILENT_VIDEO_FRAME_RATE + 1,
		);
		const timeElement = oneEbml(clusterChildren, 0xE7);
		const timeBytes = await reader.readSpan(
			timeElement.start,
			timeElement.end - timeElement.start,
			32,
		);
		const clusterTime = ebmlUnsigned(
			timeBytes,
			localEbmlElement(timeBytes, 0xE7),
		);
		const blocks: EbmlElement[] = [];
		for (const element of clusterChildren) {
			if (element.id === 0xA3) {
				blocks.push(element);
			}
			else if (element.id === 0xA0) {
				const blockGroup = await scanEbmlElements(reader, element.dataStart, element.end, 32);
				blocks.push(...blockGroup.filter(child => child.id === 0xA1));
			}
		}
		let clusterFirstPayload: Uint8Array | undefined;
		for (const block of blocks) {
			if (++frameCount > MAX_SILENT_VIDEO_DURATION_SECONDS * MAX_SILENT_VIDEO_FRAME_RATE)
				validationError('video-frame-rate-exceeded', 'WebM frame table exceeds the bounded profile.');
			const prefix = await reader.readSpan(
				block.dataStart,
				Math.min(32, block.end - block.dataStart),
				32,
			);
			const facts = webmBlockPrefixFacts(prefix);
			if (facts.track !== trackNumber)
				validationError('unsupported-video-tracks', 'WebM block references an undeclared track.');
			const absoluteTime = clusterTime + facts.relativeTime;
			if (absoluteTime < 0 || absoluteTime <= previousTime)
				validationError('malformed-video-timeline', 'WebM frame timing must be positive and strictly monotonic.');
			if (
				Number.isFinite(previousTime)
				&& (absoluteTime - previousTime) * timecodeScale * MAX_SILENT_VIDEO_FRAME_RATE < 1_000_000_000
			) {
				validationError('video-frame-rate-exceeded', 'Every WebM frame interval must remain at or below 60 fps.');
			}
			firstTime ??= absoluteTime;
			previousTime = absoluteTime;
			clusterFirstPayload ??= facts.payload.slice();
		}
		if (!clusterFirstPayload)
			validationError('video-index-incomplete', 'WebM cluster contains no complete video frame.');
		clusterIndex.set(
			cluster.start - segment.dataStart,
			{ time: clusterTime, firstPayload: clusterFirstPayload },
		);
	}
	if (
		firstTime !== 0
		|| previousTime * timecodeScale / 1_000_000_000 > durationSeconds
	) {
		validationError('malformed-video-timeline', 'WebM media timeline must start at zero and remain within its declared duration.');
	}
	const indexedClusters = new Set<number>();
	for (const cue of cueReferences) {
		const indexed = clusterIndex.get(cue.clusterPosition);
		if (
			!indexed
			|| indexed.time !== cue.time
			|| indexedClusters.has(cue.clusterPosition)
			|| cue.time * timecodeScale / 1_000_000_000 > durationSeconds
		) {
			validationError('video-index-incomplete', 'WebM Cue does not uniquely match its key-frame cluster and timeline.');
		}
		validateVp9KeyFrame(indexed.firstPayload);
		indexedClusters.add(cue.clusterPosition);
	}
	const firstClusterPosition = Math.min(...clusterIndex.keys());
	if (cueReferences[0]!.clusterPosition !== firstClusterPosition)
		validationError('video-index-incomplete', 'WebM Cues must index the initial random-access cluster.');
	if (indexedClusters.size !== clusterIndex.size)
		validationError('video-index-incomplete', 'WebM Cues must cover every random-access cluster.');
	return { width, height, durationSeconds, frameCount, hasAlpha };
}

function acceptedSilentVideo(
	input: {
		byteLength: number;
		sha256: string;
		format: 'mp4' | 'webm';
		inspected: ReturnType<typeof inspectMp4> | ReturnType<typeof inspectWebm>;
	},
): ProcessedSilentVideo {
	const frameRate = validateFacts(input.inspected);
	const isMp4 = input.format === 'mp4';
	const hasAlpha = isMp4
		? false
		: (input.inspected as ReturnType<typeof inspectWebm>).hasAlpha;
	const facts: GraphicAssetSilentVideoFacts = {
		kind: 'silent-video',
		format: input.format,
		codec: isMp4 ? 'h264' : 'vp9',
		canonicalMime: isMp4 ? 'video/mp4' : 'video/webm',
		byteLength: input.byteLength,
		sha256: input.sha256,
		width: input.inspected.width,
		height: input.inspected.height,
		durationSeconds: input.inspected.durationSeconds,
		frameRate,
		frameCount: input.inspected.frameCount,
		bitDepth: 8,
		colorSpace: 'sdr',
		chromaSubsampling: '4:2:0',
		hasAlpha,
		fastStart: isMp4 ? true : null,
		seekable: true,
		posterTimeSeconds: Math.min(1, input.inspected.durationSeconds * 0.1),
		targetCompatibility: hasAlpha ? 'chromium-transparency' : 'all-supported',
	};
	return {
		report: {
			outcome: 'accepted',
			compatibilityProfile: SILENT_VIDEO_COMPATIBILITY_PROFILE,
			issues: [],
			facts,
		},
	};
}

export async function processSilentVideoFromRandomAccess(
	source: SilentVideoRandomAccessSource,
	declarations: SilentVideoDeclarations = {},
): Promise<ProcessedSilentVideo> {
	if (source.byteLength === 0 || source.byteLength > MAX_SILENT_VIDEO_INGESTION_BYTES)
		validationError('video-source-size-exceeded', 'Silent video must be between 1 byte and 250 MiB.');
	const reader = boundedRandomAccessReader(source);
	const signature = await reader.readExact(0, Math.min(16, source.byteLength));
	const isMp4 = signature.byteLength >= 12 && ascii(signature, 4, 4) === 'ftyp';
	const isWebm = signature.byteLength >= 4
		&& signature[0] === 0x1A && signature[1] === 0x45
		&& signature[2] === 0xDF && signature[3] === 0xA3;
	if (!isMp4 && !isWebm)
		validationError('unsupported-video-format', 'Only H.264/AVC MP4 and VP9 WebM silent video is supported.');
	const format = isMp4 ? 'mp4' : 'webm';
	validateVideoDeclarations(format, declarations);
	let inspected: Awaited<ReturnType<typeof inspectMp4RandomAccess | typeof inspectWebmRandomAccess>>;
	try {
		inspected = isMp4
			? await inspectMp4RandomAccess(source, reader)
			: await inspectWebmRandomAccess(source, reader);
	}
	catch (error) {
		if (error instanceof RangeError)
			validationError('malformed-video', 'Video structure ended before its declared bounded metadata.');
		throw error;
	}
	return acceptedSilentVideo({
		byteLength: source.byteLength,
		sha256: source.sha256,
		format,
		inspected,
	});
}

export async function processSilentVideo(
	bytes: Uint8Array,
	declarations: SilentVideoDeclarations = {},
): Promise<ProcessedSilentVideo> {
	if (bytes.byteLength === 0 || bytes.byteLength > MAX_SILENT_VIDEO_INGESTION_BYTES)
		validationError('video-source-size-exceeded', 'Silent video must be between 1 byte and 250 MiB.');
	const isMp4 = bytes.byteLength >= 12 && ascii(bytes, 4, 4) === 'ftyp';
	const isWebm = bytes.byteLength >= 4
		&& bytes[0] === 0x1A && bytes[1] === 0x45 && bytes[2] === 0xDF && bytes[3] === 0xA3;
	if (!isMp4 && !isWebm)
		validationError('unsupported-video-format', 'Only H.264/AVC MP4 and VP9 WebM silent video is supported.');
	const format = isMp4 ? 'mp4' : 'webm';
	validateVideoDeclarations(format, declarations);
	let inspected: ReturnType<typeof inspectMp4> | ReturnType<typeof inspectWebm>;
	try {
		inspected = isMp4 ? inspectMp4(bytes) : inspectWebm(bytes);
	}
	catch (error) {
		if (error instanceof RangeError)
			validationError('malformed-video', 'Video structure ended before its declared bounded metadata.');
		throw error;
	}
	return acceptedSilentVideo({
		byteLength: bytes.byteLength,
		sha256: await sha256Hex(bytes),
		format,
		inspected,
	});
}
