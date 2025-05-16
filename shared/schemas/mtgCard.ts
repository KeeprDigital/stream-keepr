import type { ScryfallCardFields, ScryfallImageUris } from '@scryfall/api-types'
import { z } from 'zod'

export const mtgCardDisplayDataSchema = z.object({
  hidden: z.boolean(),
  flipped: z.boolean(),
  rotated: z.boolean(),
  counterRotated: z.boolean(),
  turnedOver: z.boolean(),
  timeoutStartTimestamp: z.number().optional(),
  timeoutDuration: z.number().optional(),
})
export type MtgCardDisplayData = z.infer<typeof mtgCardDisplayDataSchema>

export const mtgCardImageDataSchema = z.object({
  front: z.custom<ScryfallImageUris>().nullable(),
  back: z.custom<ScryfallImageUris>().nullable(),
})
export type MtgCardImageData = z.infer<typeof mtgCardImageDataSchema>

export const mtgCardOrientationDataSchema = z.object({
  flipable: z.boolean(),
  turnable: z.boolean(),
  rotateable: z.boolean(),
  counterRotateable: z.boolean(),
  defaultRotated: z.boolean(),
})
export type MtgCardOrientationData = z.infer<typeof mtgCardOrientationDataSchema>

export const mtgCardMeldDataSchema = z.object({
  meldPartOne: z.string().nullable(),
  meldPartTwo: z.string().nullable(),
  meldResult: z.string().nullable(),
})
export type MtgCardMeldData = z.infer<typeof mtgCardMeldDataSchema>

export const mtgCardDataSchema = z.object({
  name: z.string(),
  set: z.string(),
  layout: z.custom<ScryfallCardFields.Core.All['layout']>(),
  imageData: mtgCardImageDataSchema,
  orientationData: mtgCardOrientationDataSchema,
  meldData: mtgCardMeldDataSchema.optional(),
  points: z.number(),
  displayData: mtgCardDisplayDataSchema,
})
export type MtgCardData = z.infer<typeof mtgCardDataSchema>

export const mtgCardClientActionSchema = z.enum([
  'set',
  'clear',
  'hide',
  'show',
  'rotate',
  'counterRotate',
  'flip',
  'turnOver',
])
export type MtgCardClientAction = z.infer<typeof mtgCardClientActionSchema>

export const mtgCardActionMessageSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('set'),
    card: z.custom<MtgCardData>(),
  }),
  z.object({ action: z.literal('clear') }),
  z.object({ action: z.literal('hide') }),
  z.object({ action: z.literal('show'), timeOut: z.number().optional() }),
  z.object({ action: z.literal('rotate') }),
  z.object({ action: z.literal('counterRotate') }),
  z.object({ action: z.literal('flip') }),
  z.object({ action: z.literal('turnOver') }),
])
export type MtgCardActionMessage = z.infer<typeof mtgCardActionMessageSchema>

export const mtgCardApiCallSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('set'), card: z.custom<MtgCardData>() }),
  z.object({ action: z.literal('clear') }),
  z.object({ action: z.literal('hide') }),
  z.object({ action: z.literal('show'), timeOut: z.number().optional() }),
  z.object({ action: z.literal('rotate') }),
  z.object({ action: z.literal('counterRotate') }),
  z.object({ action: z.literal('flip') }),
  z.object({ action: z.literal('turnOver') }),
])
export type MtgCardApiCall = z.infer<typeof mtgCardApiCallSchema>
