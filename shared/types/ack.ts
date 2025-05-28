/**
 * Base structure for acknowledgment responses.
 * Contains the fundamental properties shared by all response types.
 */
export type BaseAckResponse = {
  /** Indicates whether the operation was successful */
  success: boolean
  /** Optional Unix timestamp when the response was generated */
  timestamp?: number
}

/**
 * Acknowledgment response for successful operations.
 * Extends BaseAckResponse with additional success-specific data.
 */
export type SuccessAckResponse<T = Record<string, never>> = BaseAckResponse & {
  success: true
} & T

/**
 * Acknowledgment response for failed operations.
 * Extends BaseAckResponse with error information and success explicitly set to false.
 */
export type ErrorAckResponse = BaseAckResponse & {
  success: false
  /** Human-readable error message describing what went wrong */
  error: string
  /** Optional error code for programmatic error handling */
  code?: string
  /** Optional additional error details (stack trace, validation errors, etc.) */
  details?: unknown
}

/**
 * Union type representing any possible acknowledgment response.
 * Can be either a success or error response.
 */
export type AckResponse = SuccessAckResponse | ErrorAckResponse

/**
 * Utility type that extracts only the success response type from a response union.
 *
 * For response types that extend AckResponse, this extracts only the success variant,
 * ensuring that error properties are not accessible in contexts where only success
 * responses are expected (like onSuccess callbacks).
 *
 * @template T - The response type to extract success variant from
 *
 * @example
 * ```typescript
 * type MyResponse = AckResponse & { userId?: string }
 * type MySuccessResponse = ExtractSuccessResponse<MyResponse>
 * // Result: SuccessAckResponse & { userId?: string }
 * // The 'error', 'code', and 'details' properties are not available
 * ```
 */
export type ExtractSuccessResponse<T> = T extends AckResponse
  ? Extract<T, { success: true }>
  : T

/**
 * Callback function type for handling acknowledgment responses.
 * Used in async operations to confirm completion status and handle both
 * success and error cases.
 *
 * @template T - Additional properties to merge with successful responses.
 *               Should be an object type. Defaults to empty object.
 * @param response - The acknowledgment response containing operation result.
 *                   Can be either success (with optional extensions) or error response.
 *
 * @example
 * ```typescript
 * // Basic usage - handles both success and error
 * const callback: AckCallback = (response) => {
 *   if (response.success) {
 *     // Handle success case
 *   } else {
 *     console.error(response.error)
 *   }
 * }
 *
 * // With additional success data
 * const extendedCallback: AckCallback<{ userId: string }> = (response) => {
 *   if (response.success) {
 *     console.log(response.userId) // Available only on success
 *   }
 * }
 * ```
 */
export type AckCallback<T = object> = (response: AckResponse | SuccessAckResponse<T>) => void

/**
 * Utility type that transforms an object type by adding an acknowledgment callback
 * parameter to function properties that don't already have one.
 *
 * For each function property in the input type T:
 * - If the function already has an AckCallback as its last parameter, leaves it unchanged
 * - Otherwise, adds an `ack` callback parameter as the last argument
 * - Preserves the original return type for all functions
 * - Non-function properties remain unchanged
 *
 * @template T - The input object type to transform
 *
 * @example
 * ```typescript
 * interface OriginalActions {
 *   sendMessage: (text: string) => void
 *   joinRoom: (roomId: string) => void
 *   alreadyHasAck: (data: string, ack: AckCallback) => void
 *   userCount: number
 * }
 *
 * type ActionsWithAck = AddAckToActions<OriginalActions>
 * // Result:
 * // {
 * //   sendMessage: (text: string, ack: AckCallback) => void
 * //   joinRoom: (roomId: string, ack: AckCallback) => void
 * //   alreadyHasAck: (data: string, ack: AckCallback) => void  // unchanged
 * //   userCount: number  // unchanged
 * // }
 * ```
 */
export type AddAckToActions<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? A extends [...infer _Rest, AckCallback<any>]
      ? T[K] // Already has ack callback, return unchanged
      : (...args: [...A, ack: AckCallback]) => R // Add ack callback
    : T[K] // Not a function, return unchanged
}
