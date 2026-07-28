import {
	STILL_IMAGE_THUMBNAIL_MAX_HEIGHT,
	STILL_IMAGE_THUMBNAIL_MAX_WIDTH,
} from '~~/shared/utils/graphicsAssetCompatibility';

export interface ThumbnailProjection {
	width: number;
	height: number;
	sourceXByTargetX: readonly number[];
	targetYBySource: ReadonlyMap<number, number>;
}

export function createThumbnailProjection(
	sourceWidth: number,
	sourceHeight: number,
): ThumbnailProjection {
	const scale = Math.min(
		1,
		STILL_IMAGE_THUMBNAIL_MAX_WIDTH / sourceWidth,
		STILL_IMAGE_THUMBNAIL_MAX_HEIGHT / sourceHeight,
	);
	const width = Math.max(1, Math.floor(sourceWidth * scale));
	const height = Math.max(1, Math.floor(sourceHeight * scale));
	const sourceXByTargetX = Array.from(
		{ length: width },
		(_, targetX) => Math.min(sourceWidth - 1, Math.floor(targetX / scale)),
	);
	const targetYBySource = new Map<number, number>();
	for (let targetY = 0; targetY < height; targetY++) {
		targetYBySource.set(
			Math.min(sourceHeight - 1, Math.floor(targetY / scale)),
			targetY,
		);
	}
	return { width, height, sourceXByTargetX, targetYBySource };
}

export function resizeRgbaThumbnail(image: ImageData) {
	const projection = createThumbnailProjection(image.width, image.height);
	const pixels = new Uint8Array(projection.width * projection.height * 4);
	for (const [sourceY, targetY] of projection.targetYBySource) {
		for (let targetX = 0; targetX < projection.width; targetX++) {
			const sourceX = projection.sourceXByTargetX[targetX]!;
			const sourceOffset = (sourceY * image.width + sourceX) * 4;
			pixels.set(
				image.data.subarray(sourceOffset, sourceOffset + 4),
				(targetY * projection.width + targetX) * 4,
			);
		}
	}
	return {
		width: projection.width,
		height: projection.height,
		pixels,
	};
}
