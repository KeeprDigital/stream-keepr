import { mapAnimationEffectPreset } from '~~/server/mappers/animationEffectPreset';
import { importAnimationEffectPresetSchema } from '~~/server/schemas/api/animationEffectPreset';
import { animationEffectPresetService } from '~~/server/services/animationEffectPreset';
import { requireUserId } from '~~/server/utils/auth';
import { readJsonPayloadLimited } from '~~/server/utils/payloadLimits';
import {
	decodeAnimationEffectPresetDocument,
	MAX_ANIMATION_EFFECT_PRESET_DOCUMENT_BYTES,
} from '~~/shared/animationEffectPresets';
import { randomUuid } from '~~/shared/utils/uuid';

const IMPORT_REQUEST_BYTES = MAX_ANIMATION_EFFECT_PRESET_DOCUMENT_BYTES + 1024;

export default defineEventHandler(async (event) => {
	await requireUserId(event);
	const { document } = importAnimationEffectPresetSchema.parse(
		await readJsonPayloadLimited(event, IMPORT_REQUEST_BYTES, 'Animation Effect Preset import'),
	);
	const decoded = decodeAnimationEffectPresetDocument(document);
	if (!decoded.success) {
		if (decoded.reason === 'document-too-large') {
			throw createError({
				statusCode: 413,
				statusMessage: 'Payload Too Large',
				message: `Animation Effect Preset document must not exceed ${MAX_ANIMATION_EFFECT_PRESET_DOCUMENT_BYTES} bytes`,
			});
		}
		throw createError({
			statusCode: 422,
			statusMessage: 'Unprocessable Content',
			message: decoded.reason === 'malformed-json'
				? 'Animation Effect Preset document must be valid JSON'
				: 'Animation Effect Preset document is invalid or unsupported',
		});
	}

	const preset = await animationEffectPresetService().create({
		id: randomUuid(),
		name: decoded.data.name,
		selection: decoded.data.selection,
	});
	setResponseStatus(event, 201);
	return mapAnimationEffectPreset(preset);
});
