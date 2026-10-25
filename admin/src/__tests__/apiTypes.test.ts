// Unit tests for the shared API-error triage helpers used by every admin
// page's catch block. Real AxiosError instances are used so isAxiosError()
// behaves exactly as in production.
import { describe, it, expect } from 'vitest';
import axios, { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import {
  getApiErrorMessage,
  getAxiosErrorResponse,
  isNetworkError,
} from '../apiTypes';

const config = {} as InternalAxiosRequestConfig;

const responseOf = (status: number, data: unknown): AxiosResponse =>
  ({ status, statusText: '', data, headers: {}, config }) as AxiosResponse;

const axiosErrorWithResponse = (status: number, data: unknown) =>
  new AxiosError('Request failed', AxiosError.ERR_BAD_REQUEST, config, undefined, responseOf(status, data));

describe('getApiErrorMessage', () => {
  it('prefers the backend message from an axios error response', () => {
    const error = axiosErrorWithResponse(401, { success: false, message: 'Invalid admin credentials' });
    expect(getApiErrorMessage(error, 'fallback')).toBe('Invalid admin credentials');
  });

  it('falls back to the axios error message when the payload has none', () => {
    const error = axiosErrorWithResponse(500, {});
    expect(getApiErrorMessage(error, 'fallback')).toBe('Request failed');
  });

  it('returns an Error message for non-axios errors', () => {
    expect(getApiErrorMessage(new Error('boom'), 'fallback')).toBe('boom');
  });

  it('returns the fallback for unknown error shapes', () => {
    expect(getApiErrorMessage('weird', 'fallback')).toBe('fallback');
  });
});

describe('getAxiosErrorResponse', () => {
  it('extracts status/data from an axios error with a response', () => {
    const error = axiosErrorWithResponse(403, { message: 'forbidden' });
    expect(getAxiosErrorResponse(error)).toEqual({ status: 403, data: { message: 'forbidden' } });
  });

  it('returns null when the axios error never received a response', () => {
    const error = new AxiosError('Network Error', 'ERR_NETWORK', config, {} as never);
    expect(getAxiosErrorResponse(error)).toBeNull();
  });

  it('returns null for non-axios errors', () => {
    expect(getAxiosErrorResponse(new Error('boom'))).toBeNull();
  });
});

describe('isNetworkError', () => {
  it('is true for axios errors that never reached the server (request set, no response)', () => {
    const error = new AxiosError('Network Error', 'ERR_NETWORK', config, {} as never);
    expect(isNetworkError(error)).toBe(true);
  });

  it('is false when a response did arrive', () => {
    const error = axiosErrorWithResponse(500, {});
    expect(isNetworkError(error)).toBe(false);
  });

  it('is false for non-axios errors', () => {
    expect(isNetworkError(new Error('boom'))).toBe(false);
  });
});

describe('axios.isAxiosError sanity (the check the helpers rely on)', () => {
  it('recognizes AxiosError instances', () => {
    expect(axios.isAxiosError(axiosErrorWithResponse(400, {}))).toBe(true);
    expect(axios.isAxiosError(new Error('plain'))).toBe(false);
  });
});
