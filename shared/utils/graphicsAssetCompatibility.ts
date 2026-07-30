export const STILL_IMAGE_COMPATIBILITY_PROFILE = 'still-image-v1' as const;
export const MAX_STILL_IMAGE_INGESTION_BYTES = 25 * 1024 * 1024;
export const GRAPHICS_MULTIPART_PART_BYTES = 16 * 1024 * 1024;
export const GRAPHICS_MULTIPART_MAXIMUM_CONCURRENT_PARTS = 3;
export const GRAPHICS_MULTIPART_MAXIMUM_PART_ATTEMPTS = 3;
export const GRAPHICS_MULTIPART_PART_TRANSFER_TIMEOUT_MILLISECONDS = 2 * 60 * 1000;
export const MAX_STILL_IMAGE_AXIS = 8192;
export const MAX_STILL_IMAGE_PIXELS = 16_777_216;
export const STILL_IMAGE_THUMBNAIL_MAX_WIDTH = 640;
export const STILL_IMAGE_THUMBNAIL_MAX_HEIGHT = 360;
export const STATIC_FONT_COMPATIBILITY_PROFILE = 'static-font-v1' as const;
/**
 * What a font that passed every server-side check but was never put in front of
 * a browser has actually satisfied.
 *
 * `static-font-v1` includes `FontFace.load()` and representative glyph
 * rendering, which an interactive upload collects from the author's own browser.
 * A Template Package has no such client: its fonts arrive as bytes inside an
 * archive. Rather than claim a profile the content did not fully satisfy, a
 * packaged font records this explicitly weaker one until evidence collection
 * exists for the packaged path.
 */
export const STATIC_FONT_UNATTESTED_COMPATIBILITY_PROFILE = 'static-font-v1-unattested' as const;
export const MAX_STATIC_FONT_INGESTION_BYTES = 10 * 1024 * 1024;
export const MAX_STATIC_FONT_EXPANDED_BYTES = 32 * 1024 * 1024;
export const SILENT_VIDEO_COMPATIBILITY_PROFILE = 'silent-video-v1' as const;
export const MAX_SILENT_VIDEO_INGESTION_BYTES = 250 * 1024 * 1024;
export const MAX_SILENT_VIDEO_WIDTH = 3840;
export const MAX_SILENT_VIDEO_HEIGHT = 2160;
export const MAX_SILENT_VIDEO_DURATION_SECONDS = 120;
export const MAX_SILENT_VIDEO_FRAME_RATE = 60;
export const SILENT_VIDEO_POSTER_MAX_WIDTH = 640;
export const SILENT_VIDEO_POSTER_MAX_HEIGHT = 360;
export const MAX_SILENT_VIDEO_POSTER_BYTES = 2 * 1024 * 1024;
