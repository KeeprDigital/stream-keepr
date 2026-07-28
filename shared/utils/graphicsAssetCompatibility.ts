export const STILL_IMAGE_COMPATIBILITY_PROFILE = 'still-image-v1' as const;
export const MAX_STILL_IMAGE_INGESTION_BYTES = 25 * 1024 * 1024;

/** @deprecated Use the complete still-image compatibility profile. */
export const PNG_COMPATIBILITY_PROFILE = STILL_IMAGE_COMPATIBILITY_PROFILE;
/** @deprecated Use the complete still-image ingestion bound. */
export const MAX_PNG_INGESTION_BYTES = MAX_STILL_IMAGE_INGESTION_BYTES;
