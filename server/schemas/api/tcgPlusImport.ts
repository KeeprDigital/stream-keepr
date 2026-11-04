import { z } from 'zod';
import { TCGPLUS_IMPORT_MAX_BODY_BYTES } from '~~/shared/utils/requestBodyLimits';

/** A Bandai TCG+ deck list export, read as text by the browser and sent whole (ADR-0074). */
export const tcgPlusImportSchema = z.object({
	csv: z.string().min(1).max(TCGPLUS_IMPORT_MAX_BODY_BYTES),
}).strict();
