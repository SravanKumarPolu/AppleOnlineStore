/**
 * Safe narrowing helpers for `unknown` error values.
 *
 * Fetch/PayPal/WebSocket failures arrive as `unknown` at call sites that used
 * to be typed `any`. These guards let consuming code read `.message` (and a
 * few other optional fields) without disabling the no-explicit-any rule.
 */

export const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

/** Safely extracts a `.message` string from an unknown error value. */
export const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (isRecord(error) && typeof error.message === 'string' && error.message) {
    return error.message;
  }
  return fallback;
};

/**
 * Narrows an unknown error to the subset of fields the payment error UI reads
 * (`message`, `error`, `stack`, `details`). Missing fields stay `undefined`.
 */
export const toPayPalErrorLike = (error: unknown): PayPalErrorLikeShape => {
  if (!isRecord(error)) {
    return {};
  }
  const record: Record<string, unknown> = error;
  return {
    message: typeof record.message === 'string' ? record.message : undefined,
    error: typeof record.error === 'string' ? record.error : undefined,
    stack: typeof record.stack === 'string' ? record.stack : undefined,
    details: Array.isArray(record.details)
      ? record.details.filter(isRecord) as PayPalErrorDetailShape[]
      : undefined,
  };
};

export interface PayPalErrorDetailShape {
  issue?: string;
  description?: string;
  [key: string]: unknown;
}

export interface PayPalErrorLikeShape {
  message?: string;
  error?: string;
  stack?: string;
  details?: PayPalErrorDetailShape[];
}
