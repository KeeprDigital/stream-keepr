import type {
	GraphicAssetSourceDeclarations,
	GraphicAssetValidationReport,
} from '~~/shared/types/graphicsAsset';
import type { GraphicAssetSourceKind } from '~~/shared/utils/graphicAssetSource';
import type { StillImageBounds } from './still-image';
import {
	MAX_SILENT_VIDEO_INGESTION_BYTES,
	MAX_STATIC_FONT_INGESTION_BYTES,
	MAX_STILL_IMAGE_INGESTION_BYTES,
	SILENT_VIDEO_COMPATIBILITY_PROFILE,
	STATIC_FONT_COMPATIBILITY_PROFILE,
	STILL_IMAGE_COMPATIBILITY_PROFILE,
} from '~~/shared/utils/graphicsAssetCompatibility';
import { processStaticFont } from './font';
import { processSilentVideo } from './silent-video';
import { processStillImage } from './still-image';

export const GRAPHIC_ASSET_SOURCE_POLICIES = {
	'image': {
		label: 'Still image',
		maximumByteLength: MAX_STILL_IMAGE_INGESTION_BYTES,
		compatibilityProfile: STILL_IMAGE_COMPATIBILITY_PROFILE,
		conflictingMimeCode: 'conflicting-image-mime',
	},
	'silent-video': {
		label: 'Silent video',
		maximumByteLength: MAX_SILENT_VIDEO_INGESTION_BYTES,
		compatibilityProfile: SILENT_VIDEO_COMPATIBILITY_PROFILE,
		conflictingMimeCode: 'conflicting-video-mime',
	},
	'font': {
		label: 'Static font',
		maximumByteLength: MAX_STATIC_FONT_INGESTION_BYTES,
		compatibilityProfile: STATIC_FONT_COMPATIBILITY_PROFILE,
		conflictingMimeCode: 'conflicting-font-mime',
	},
} as const satisfies Record<GraphicAssetSourceKind, {
	label: string;
	maximumByteLength: number;
	compatibilityProfile: GraphicAssetValidationReport['compatibilityProfile'];
	conflictingMimeCode: Extract<GraphicAssetValidationReport, { outcome: 'rejected' }>['issues'][number]['code'];
}>;

export async function processGraphicAssetSource(
	kind: GraphicAssetSourceKind,
	bytes: Uint8Array,
	declarations: Pick<GraphicAssetSourceDeclarations, 'sourceFileName' | 'declaredMime'>,
	stillImageBounds: StillImageBounds = 'ingestion',
) {
	switch (kind) {
		case 'font':
			return await processStaticFont(bytes, declarations);
		case 'silent-video':
			return await processSilentVideo(bytes, declarations);
		case 'image':
			return await processStillImage(bytes, declarations, { bounds: stillImageBounds });
	}
}
