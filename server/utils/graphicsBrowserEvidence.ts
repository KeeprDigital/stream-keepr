import { z } from 'zod';

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);

const glyphProofSchema = z.object({
	codePoint: z.number().int().min(0).max(0x10FFFF),
	exactWithSansDigest: digestSchema,
	exactWithMonoDigest: digestSchema,
	sansFallbackDigest: digestSchema,
	monoFallbackDigest: digestSchema,
}).strict();

export const stillImageBrowserEvidenceSchemas = [
	z.object({
		outcome: z.literal('decoded'),
		sourceDigest: digestSchema,
		width: z.number().int().positive(),
		height: z.number().int().positive(),
	}).strict(),
	z.object({
		outcome: z.literal('rejected'),
		sourceDigest: digestSchema,
	}).strict(),
] as const;

export const staticFontBrowserEvidenceSchemas = [
	z.object({
		outcome: z.literal('font-loaded'),
		sourceDigest: digestSchema,
		challengeDigest: digestSchema,
		glyphProofs: z.array(glyphProofSchema).min(1).max(8),
	}).strict(),
	z.object({
		outcome: z.literal('font-rejected'),
		sourceDigest: digestSchema,
		challengeDigest: digestSchema,
		stage: z.enum(['load', 'render']),
	}).strict(),
] as const;

/** Font challenge answers only. */
export const staticFontBrowserEvidenceSchema = z.discriminatedUnion(
	'outcome',
	[...staticFontBrowserEvidenceSchemas],
);

/** Any browser validation evidence; the library checks it against the report. */
export const graphicAssetBrowserEvidenceSchema = z.discriminatedUnion('outcome', [
	...stillImageBrowserEvidenceSchemas,
	...staticFontBrowserEvidenceSchemas,
]);
