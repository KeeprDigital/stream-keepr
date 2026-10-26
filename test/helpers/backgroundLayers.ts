import type { GraphicAssetId, GraphicAssetRevisionId } from '~~/shared/types/graphicsAsset';
import type { BackgroundLayer } from '~~/shared/types/screenConfig';

/** An image layer pinning `asset-1`/`revision-1` from the library. */
export function assetImageLayer(id: string, overrides: Partial<Extract<BackgroundLayer, { type: 'image' }>> = {}): BackgroundLayer {
	return {
		id,
		type: 'image',
		enabled: true,
		opacity: 1,
		source: {
			kind: 'asset',
			assetId: 'asset-1' as GraphicAssetId,
			revisionId: 'revision-1' as GraphicAssetRevisionId,
		},
		fit: 'cover',
		...overrides,
	};
}

/** A silent-video layer pinning `asset-2`/`revision-2` from the library. */
export function assetVideoLayer(id: string): BackgroundLayer {
	return {
		id,
		type: 'video',
		enabled: true,
		opacity: 1,
		source: {
			kind: 'asset',
			assetId: 'asset-2' as GraphicAssetId,
			revisionId: 'revision-2' as GraphicAssetRevisionId,
		},
		fit: 'cover',
		playbackRate: 1,
		loop: true,
	};
}

/** One of every layer kind that pins no library revision, URL sources included. */
export function layersPinningNoAsset(): BackgroundLayer[] {
	return [
		{
			id: 'wash',
			type: 'color',
			enabled: true,
			opacity: 1,
			color: '#0b1020',
		},
		{
			id: 'grad',
			type: 'gradient',
			enabled: true,
			opacity: 1,
			gradient: 'linear-gradient(#000, #123)',
		},
		{
			id: 'remote-plate',
			type: 'image',
			enabled: true,
			opacity: 1,
			source: { kind: 'url', url: 'https://example.com/plate.png' },
			fit: 'cover',
		},
		{
			id: 'remote-loop',
			type: 'video',
			enabled: true,
			opacity: 1,
			source: { kind: 'url', url: 'https://example.com/loop.webm' },
			fit: 'cover',
			playbackRate: 1,
			loop: true,
		},
		{
			id: 'anim',
			type: 'animation',
			enabled: true,
			opacity: 1,
			animation: { effect: 'fog' },
		},
	];
}
