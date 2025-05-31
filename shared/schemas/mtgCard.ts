import type { ScryfallCardFields, ScryfallImageUris } from '@scryfall/api-types'
import { z } from 'zod/v4'

export const mtgCardDisplayDataSchema = z.object({
  flipped: z.boolean(),
  rotated: z.boolean(),
  counterRotated: z.boolean(),
  turnedOver: z.boolean(),
  timeoutStartTimestamp: z.number().optional(),
  timeoutDuration: z.number().optional(),
})

export const mtgCardImageDataSchema = z.object({
  front: z.custom<ScryfallImageUris>().nullable(),
  back: z.custom<ScryfallImageUris>().nullable(),
})

export const mtgCardOrientationDataSchema = z.object({
  flipable: z.boolean(),
  turnable: z.boolean(),
  rotateable: z.boolean(),
  counterRotateable: z.boolean(),
})

export const mtgCardMeldDataSchema = z.object({
  meldPartOne: z.string().nullable(),
  meldPartTwo: z.string().nullable(),
  meldResult: z.string().nullable(),
})

export const mtgCardDataSchema = z.object({
  name: z.string(),
  set: z.string(),
  layout: z.custom<ScryfallCardFields.Core.All['layout']>(),
  points: z.number(),
  imageData: mtgCardImageDataSchema,
  orientationData: mtgCardOrientationDataSchema,
  displayData: mtgCardDisplayDataSchema,
  meldData: mtgCardMeldDataSchema.optional(),
})
