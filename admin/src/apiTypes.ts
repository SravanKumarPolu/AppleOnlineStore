import { isAxiosError } from 'axios';

/** Field-level validation error payload returned by the backend. */
export interface AdminValidationError {
  field: string;
  message: string;
}

/** Extracts a human-readable message from an unknown axios/fetch error. */
export const getApiErrorMessage = (error: unknown, fallback: string): string => {
  if (isAxiosError(error)) {
    const data = error.response?.data as { message?: string } | undefined;
    if (data?.message) {
      return data.message;
    }
    if (error.message) {
      return error.message;
    }
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
};

/**
 * Typed accessor for axios error branches: returns the response status/data
 * pair when present, otherwise null. Lets pages keep their original
 * `error.response / error.request / other` triage without `any`.
 */
export const getAxiosErrorResponse = (
  error: unknown,
): { status: number; data: { message?: string } } | null => {
  if (isAxiosError(error) && error.response) {
    return {
      status: error.response.status,
      data: error.response.data as { message?: string },
    };
  }
  return null;
};

/** True when the error is an axios error that never reached the server. */
export const isNetworkError = (error: unknown): boolean => {
  return isAxiosError(error) && !!error.request && !error.response;
};
