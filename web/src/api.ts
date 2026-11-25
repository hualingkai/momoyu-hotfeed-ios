import { Capacitor } from '@capacitor/core';
import { standaloneApi } from './standalone';
import type {
  Article,
  Category,
  FeedItem,
  Source,
  SourceRefreshResult,
  SourceValidateResult,
} from './types';

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) || '';

function useStandalone(): boolean {
  if (API_BASE) return false;
  return Capacitor.isNativePlatform();
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  if (!resp.ok) {
    let msg = `请求失败 (${resp.status})`;
    try {
      const data = await resp.json();
      if (data?.detail) msg = String(data.detail);
    } catch {
      // ignore json parse error
    }
    throw new Error(msg);
  }
  if (resp.status === 204) {
    return undefined as T;
  }
  return resp.json() as Promise<T>;
}

async function withFallback<T>(remoteFn: () => Promise<T>, localFn: () => Promise<T>): Promise<T> {
  if (useStandalone()) {
    return localFn();
  }
  try {
    return await remoteFn();
  } catch (err) {
    // If no backend server is running locally, transparently fall back to direct open-source fetch
    if (!API_BASE && err instanceof TypeError) {
      return localFn();
    }
    throw err;
  }
}

export const api = {
  getFeed(params: { tab: 'all' | 'hot' | 'subscription'; platform?: string; category_id?: number }) {
    const qs = new URLSearchParams({ tab: params.tab });
    if (params.platform) qs.set('platform', params.platform);
    if (params.category_id !== undefined) qs.set('category_id', String(params.category_id));
    return withFallback(
      () => request<FeedItem[]>(`/api/v1/feed?${qs.toString()}`),
      () => standaloneApi.getFeed(params)
    );
  },

  listSources(params?: { category_id?: number; enabled?: boolean; status?: string; search?: string }) {
    const qs = new URLSearchParams();
    if (params?.category_id !== undefined) qs.set('category_id', String(params.category_id));
    if (params?.enabled !== undefined) qs.set('enabled', String(params.enabled));
    if (params?.status && params.status !== 'all') qs.set('status', params.status);
    if (params?.search) qs.set('search', params.search);
    const query = qs.toString();
    return withFallback(
      () => request<Source[]>(`/api/v1/sources${query ? `?${query}` : ''}`),
      () => standaloneApi.listSources(params)
    );
  },

  validateSource(url: string) {
    return withFallback(
      () =>
        request<SourceValidateResult>('/api/v1/sources/validate', {
          method: 'POST',
          body: JSON.stringify({ url }),
        }),
      () => standaloneApi.validateSource(url)
    );
  },

  createSource(payload: {
    url: string;
    name?: string;
    website_name?: string;
    icon_url?: string | null;
    description?: string;
    feed_type?: string;
    category_id: number;
    enabled?: boolean;
  }) {
    return withFallback(
      () =>
        request<Source>('/api/v1/sources', {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      () => standaloneApi.createSource(payload)
    );
  },

  updateSource(id: number, payload: Partial<Source>) {
    return withFallback(
      () =>
        request<Source>(`/api/v1/sources/${id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        }),
      () => standaloneApi.updateSource(id, payload)
    );
  },

  deleteSource(id: number) {
    return withFallback(
      () => request<void>(`/api/v1/sources/${id}`, { method: 'DELETE' }),
      () => standaloneApi.deleteSource(id)
    );
  },

  toggleSourceStatus(id: number, enabled: boolean) {
    return withFallback(
      () =>
        request<Source>(`/api/v1/sources/${id}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ enabled }),
        }),
      () => standaloneApi.updateSource(id, { enabled })
    );
  },

  refreshSource(id: number) {
    return withFallback(
      () => request<SourceRefreshResult>(`/api/v1/sources/${id}/refresh`, { method: 'POST' }),
      () => standaloneApi.refreshSource(id)
    );
  },

  reorderSources(orderedIds: number[]) {
    return withFallback(
      () =>
        request<{ ok: boolean }>('/api/v1/sources/reorder', {
          method: 'POST',
          body: JSON.stringify({ ordered_ids: orderedIds }),
        }),
      async () => {
        for (let i = 0; i < orderedIds.length; i += 1) {
          await standaloneApi.updateSource(orderedIds[i], { sort_order: i });
        }
        return { ok: true };
      }
    );
  },

  batchSources(sourceIds: number[], action: 'enable' | 'disable' | 'delete' | 'refresh') {
    return withFallback(
      () =>
        request<{ ok: boolean; processed: number; errors: Array<{ source_id: number; error?: string }> }>(
          '/api/v1/sources/batch',
          {
            method: 'POST',
            body: JSON.stringify({ source_ids: sourceIds, action }),
          }
        ),
      async () => {
        for (const id of sourceIds) {
          if (action === 'enable') await standaloneApi.updateSource(id, { enabled: true });
          else if (action === 'disable') await standaloneApi.updateSource(id, { enabled: false });
          else if (action === 'delete') await standaloneApi.deleteSource(id);
          else if (action === 'refresh') await standaloneApi.refreshSource(id);
        }
        return { ok: true, processed: sourceIds.length, errors: [] };
      }
    );
  },

  getSourceArticles(id: number) {
    return withFallback(
      () => request<Article[]>(`/api/v1/sources/${id}/articles`),
      () => standaloneApi.getSourceArticles(id)
    );
  },

  getSchedulerConfig() {
    return withFallback(
      () => request<{ refresh_interval_seconds: number }>('/api/v1/sources/config'),
      async () => ({
        refresh_interval_seconds: Number(localStorage.getItem('momoyu_interval_v1') || '600'),
      })
    );
  },

  updateSchedulerConfig(refreshIntervalSeconds: number) {
    return withFallback(
      () =>
        request<{ refresh_interval_seconds: number }>('/api/v1/sources/config', {
          method: 'PUT',
          body: JSON.stringify({ refresh_interval_seconds: refreshIntervalSeconds }),
        }),
      async () => {
        localStorage.setItem('momoyu_interval_v1', String(refreshIntervalSeconds));
        return { refresh_interval_seconds: refreshIntervalSeconds };
      }
    );
  },

  listCategories() {
    return withFallback(
      () => request<Category[]>('/api/v1/source-categories'),
      () => standaloneApi.listCategories()
    );
  },

  createCategory(name: string) {
    return withFallback(
      () =>
        request<Category>('/api/v1/source-categories', {
          method: 'POST',
          body: JSON.stringify({ name }),
        }),
      () => standaloneApi.createCategory(name)
    );
  },

  updateCategory(id: number, payload: { name?: string; sort_order?: number }) {
    return withFallback(
      () =>
        request<Category>(`/api/v1/source-categories/${id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        }),
      () => standaloneApi.updateCategory(id, payload)
    );
  },

  deleteCategory(id: number) {
    return withFallback(
      () =>
        request<{ ok: boolean; reassigned_sources: number }>(`/api/v1/source-categories/${id}`, {
          method: 'DELETE',
        }),
      () => standaloneApi.deleteCategory(id)
    );
  },

  reorderCategories(orderedIds: number[]) {
    return withFallback(
      () =>
        request<{ ok: boolean }>('/api/v1/source-categories/reorder', {
          method: 'POST',
          body: JSON.stringify({ ordered_ids: orderedIds }),
        }),
      () => standaloneApi.reorderCategories(orderedIds)
    );
  },
};
