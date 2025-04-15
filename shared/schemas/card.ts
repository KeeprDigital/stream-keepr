import type { ScryfallCardFields, ScryfallImageUris } from '@scryfall/api-types'
import { z } from 'zod'

export const cardDisplayDataSchema = z.object({
  hidden: z.boolean(),
  flipped: z.boolean(),
  rotated: z.boolean(),
  counterRotated: z.boolean(),
  turnedOver: z.boolean(),
})
export type CardDisplayData = z.infer<typeof cardDisplayDataSchema>

export const cardImageDataSchema = z.object({
  front: z.custom<ScryfallImageUris>().nullable(),
  back: z.custom<ScryfallImageUris>().nullable(),
})
export type CardImageData = z.infer<typeof cardImageDataSchema>

export const cardOrientationDataSchema = z.object({
  flipable: z.boolean(),
  turnable: z.boolean(),
  rotateable: z.boolean(),
  counterRotateable: z.boolean(),
  defaultRotated: z.boolean(),
})
export type CardOrientationData = z.infer<typeof cardOrientationDataSchema>

export const cardMeldDataSchema = z.object({
  meldPartOne: z.string().nullable(),
  meldPartTwo: z.string().nullable(),
  meldResult: z.string().nullable(),
})
export type CardMeldData = z.infer<typeof cardMeldDataSchema>

export const cardDataSchema = z.object({
  name: z.string(),
  set: z.string(),
  layout: z.custom<ScryfallCardFields.Core.All['layout']>(),
  imageData: cardImageDataSchema,
  orientationData: cardOrientationDataSchema,
  meldData: cardMeldDataSchema.optional(),
  points: z.number(),
  displayData: cardDisplayDataSchema,
})
export type CardData = z.infer<typeof cardDataSchema>

export const cardClientActionSchema = z.enum([
  'set',
  'clear',
  'hide',
  'show',
  'rotate',
  'counterRotate',
  'flip',
  'turnOver',
])
export type CardClientAction = z.infer<typeof cardClientActionSchema>

// Simplified action message schema
export const cardActionMessageSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('set'),
    card: z.custom<CardData>(),
  }),
  z.object({ action: z.literal('clear') }),
  z.object({ action: z.literal('hide') }),
  z.object({ action: z.literal('show') }),
  z.object({ action: z.literal('rotate') }),
  z.object({ action: z.literal('counterRotate') }),
  z.object({ action: z.literal('flip') }),
  z.object({ action: z.literal('turnOver') }),
])
export type CardActionMessage = z.infer<typeof cardActionMessageSchema>

// Direct mapping of card actions to their payload types
export type CardActionPayloadMap = {
  set: { card: CardData }
  clear: Record<string, never>
  hide: Record<string, never>
  show: Record<string, never>
  rotate: Record<string, never>
  counterRotate: Record<string, never>
  flip: Record<string, never>
  turnOver: Record<string, never>
}
