import { useEffect, useRef } from 'react';
import { getLang } from '../i18n';
import type { LiveEvent, Paged } from '../types/api';

export type { Paged };

/** Typed fetch error: status preserved so UI can branch (409 correction, 429, 422…). */
export class ApiError extends Error {
  status: number;
  detail: string;
  constructor(status: number, detail: string) {
    super(detail);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

/** Human message from any catch site (replaces `catch (e: any) … e.message`). */
export function errMsg(e: unknown, fallback = 'Error'): string {
  if (e instanceof ApiError) return e.detail || `Error ${e.status}`;
  if (e instanceof Error) return e.message;
  return fallback;
}

const DEFAULT_TIMEOUT = 15_000;

type ApiOpts = RequestInit & { timeout?: number };

export async function api<T = unknown>(path: string, opts: ApiOpts = {}): Promise<T> {
  const { timeout = DEFAULT_TIMEOUT, headers, ...rest } = opts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: 'include',
      ...rest,
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'Accept-Language': getLang(), ...(headers ?? {}) },
    });
  } catch (e: unknown) {
    clearTimeout(timer);
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new ApiError(0, 'Request timeout');
    }
    throw new ApiError(0, 'Network error');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    // Expired/revoked session: tell AuthProvider to re-read /me so the UI
    // falls back to the login form instead of showing stale Cabinet data.
    // Auth endpoints themselves are excluded to avoid a refetch loop.
    if (res.status === 401 && !path.startsWith('/api/auth/') && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('kwf-unauthorized'));
    }
    const text = await res.text();
    let detail = text.slice(0, 200) || `Error ${res.status}`;
    try {
      const j: unknown = JSON.parse(text);
      if (typeof j === 'object' && j !== null && 'detail' in j && typeof (j as { detail: unknown }).detail === 'string') {
        detail = (j as { detail: string }).detail;
      }
    } catch { /* keep raw text */ }
    throw new ApiError(res.status, detail);
  }
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('json')) return undefined as T;
  return (await res.json()) as T;
}

/** Unwrap the P1 pagination envelope; tolerates a bare array (legacy shape). */
export function pageItems<T>(data: Paged<T> | readonly T[] | undefined | null): T[] {
  if (!data) return [];
  if (Array.isArray(data)) return [...data];
  return [...((data as Paged<T>).items ?? [])];
}

const SSE_BASE_DELAY = 1000;
const SSE_MAX_DELAY = 30_000;

/** Single EventSource per mount with exponential-backoff reconnect.
 *  Handler goes through a ref (no stale closure, no resubscribe churn).
 *  No Last-Event-ID: backend bus is fire-and-forget (missed events during
 *  reconnect are reconciled by refetching the live/queue snapshot).
 */
export function useLiveSSE(
  tid: number | string | null,
  onEvent: (e: LiveEvent) => void,
  enabled = true,
  onStatus?: (connected: boolean) => void,
) {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const status = useRef(onStatus);
  status.current = onStatus;
  useEffect(() => {
    if (!tid || !enabled) return;
    let es: EventSource | null = null;
    let delay = SSE_BASE_DELAY;
    let closed = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const setStatus = (v: boolean) => status.current?.(v);
    const connect = () => {
      if (closed) return;
      setStatus(false);
      es = new EventSource(`/api/tournaments/${tid}/live/stream`);
      es.onopen = () => {
        delay = SSE_BASE_DELAY; // healthy stream resets backoff
        setStatus(true);
      };
      es.onmessage = (ev) => {
        setStatus(true);
        try {
          handler.current(JSON.parse(ev.data) as LiveEvent);
        } catch { /* ignore malformed */ }
      };
      es.onerror = () => {
        setStatus(false);
        es?.close();
        es = null;
        if (closed) return;
        retryTimer = setTimeout(connect, delay);
        delay = Math.min(delay * 2, SSE_MAX_DELAY);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retryTimer);
      es?.close();
    };
  }, [tid, enabled]);
}
