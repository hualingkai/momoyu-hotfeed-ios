import type {
  Article,
  Category,
  FeedItem,
  Source,
  SourceRefreshResult,
  SourceValidateResult,
} from './types';

const KEYS = {
  CATEGORIES: 'momoyu_categories_v1',
  SOURCES: 'momoyu_sources_v1',
  ARTICLES: 'momoyu_articles_v1',
  INTERVAL: 'momoyu_interval_v1',
};

const PRESET_CATEGORIES = [
  '综合资讯',
  '科技数码',
  '财经商业',
  '社会新闻',
  '娱乐影视',
  '体育赛事',
  '游戏动漫',
  '开发技术',
  '自定义分类',
];

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function ensureCategories(): Category[] {
  let cats = readJson<Category[]>(KEYS.CATEGORIES, []);
  if (cats.length === 0) {
    const now = new Date().toISOString();
    cats = PRESET_CATEGORIES.map((name, idx) => ({
      id: idx + 1,
      name,
      sort_order: idx,
      is_default: idx === 0,
      source_count: 0,
      created_at: now,
    }));
    writeJson(KEYS.CATEGORIES, cats);
  }
  return cats;
}

function stripHtml(html: string, maxLen = 300): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed').forEach((el) => el.remove());
  const text = (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text;
}

function extractFirstImg(html: string, baseUrl: string): string | null {
  if (!html) return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const src = doc.querySelector('img')?.getAttribute('src')?.trim();
  if (!src || src.startsWith('javascript:') || src.startsWith('data:')) return null;
  try {
    return new URL(src, baseUrl).toString();
  } catch {
    return null;
  }
}

function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid'].forEach((p) =>
      u.searchParams.delete(p)
    );
    u.hash = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    return raw.trim();
  }
}

function parseIsoDate(raw?: string | null): string {
  if (!raw) return new Date().toISOString();
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

interface ParsedFeedLocal {
  feed_type: string;
  feed_title: string;
  website_name: string;
  icon_url: string | null;
  description: string;
  articles: Array<{
    guid: string | null;
    title: string;
    description: string;
    image_url: string | null;
    author: string | null;
    article_url: string;
    published_at: string;
  }>;
}

async function fetchAndParseDirect(url: string): Promise<ParsedFeedLocal> {
  const parsedUrl = new URL(url.trim());
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('仅支持 HTTP/HTTPS 协议');
  }

  const resp = await fetch(parsedUrl.toString(), {
    headers: { Accept: 'application/rss+xml, application/atom+xml, application/json, text/xml, */*' },
  });
  if (!resp.ok) {
    throw new Error(`HTTP 请求失败 (${resp.status})`);
  }
  const text = await resp.text();
  const trimmed = text.trim();
  if (!trimmed) throw new Error('订阅源返回内容为空');

  const defaultIcon = `${parsedUrl.protocol}//${parsedUrl.host}/favicon.ico`;

  // JSON Feed
  if (trimmed.startsWith('{')) {
    const data = JSON.parse(trimmed);
    const home = data.home_page_url || url;
    const items = Array.isArray(data.items) ? data.items : [];
    return {
      feed_type: 'json_feed',
      feed_title: data.title || parsedUrl.hostname,
      website_name: parsedUrl.hostname.replace(/^www\./, ''),
      icon_url: data.icon || data.favicon || defaultIcon,
      description: stripHtml(data.description || ''),
      articles: items
        .filter((i: Record<string, unknown>) => i.url || i.external_url)
        .map((i: Record<string, unknown>) => {
          const link = String(i.url || i.external_url);
          const html = String(i.content_html || i.summary || i.content_text || '');
          return {
            guid: i.id ? String(i.id) : null,
            title: String(i.title || link),
            description: stripHtml(html),
            image_url: (i.image || i.banner_image ? String(i.image || i.banner_image) : null) || extractFirstImg(html, home),
            author: Array.isArray(i.authors) && i.authors[0]?.name ? String(i.authors[0].name) : null,
            article_url: link,
            published_at: parseIsoDate(String(i.date_published || i.date_modified || '')),
          };
        }),
    };
  }

  const xml = new DOMParser().parseFromString(trimmed, 'text/xml');
  if (xml.querySelector('parsererror')) {
    throw new Error('XML 解析失败，请确认 URL 为有效的 RSS/Atom 地址');
  }

  const rootTag = xml.documentElement.localName.toLowerCase();
  if (rootTag === 'feed') {
    const title = xml.querySelector('feed > title')?.textContent?.trim() || parsedUrl.hostname;
    const subtitle = xml.querySelector('feed > subtitle')?.textContent?.trim() || '';
    const icon = xml.querySelector('feed > icon, feed > logo')?.textContent?.trim() || defaultIcon;
    const entries = Array.from(xml.querySelectorAll('feed > entry'));
    return {
      feed_type: 'atom',
      feed_title: title,
      website_name: parsedUrl.hostname.replace(/^www\./, ''),
      icon_url: icon,
      description: stripHtml(subtitle),
      articles: entries
        .map((e) => {
          const link =
            e.querySelector('link[rel="alternate"]')?.getAttribute('href') ||
            e.querySelector('link')?.getAttribute('href') ||
            '';
          if (!link) return null;
          const body = e.querySelector('summary, content')?.textContent || '';
          return {
            guid: e.querySelector('id')?.textContent?.trim() || null,
            title: e.querySelector('title')?.textContent?.trim() || link,
            description: stripHtml(body),
            image_url: extractFirstImg(body, url),
            author: e.querySelector('author > name')?.textContent?.trim() || null,
            article_url: new URL(link, url).toString(),
            published_at: parseIsoDate(e.querySelector('published, updated')?.textContent),
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null),
    };
  }

  // RSS 2.0 / RSS 1.0
  const channel = xml.querySelector('channel');
  const title = channel?.querySelector('title')?.textContent?.trim() || parsedUrl.hostname;
  const desc = channel?.querySelector('description')?.textContent?.trim() || '';
  const icon = channel?.querySelector('image > url')?.textContent?.trim() || defaultIcon;
  const items = Array.from(xml.querySelectorAll('item'));
  return {
    feed_type: rootTag === 'rdf' ? 'rss1' : 'rss2',
    feed_title: title,
    website_name: parsedUrl.hostname.replace(/^www\./, ''),
    icon_url: icon,
    description: stripHtml(desc),
    articles: items
      .map((item) => {
        const link = item.querySelector('link')?.textContent?.trim() || '';
        if (!link) return null;
        const body = item.querySelector('description')?.textContent || '';
        const enc = item.querySelector('enclosure[type^="image/"]')?.getAttribute('url') || null;
        return {
          guid: item.querySelector('guid')?.textContent?.trim() || null,
          title: item.querySelector('title')?.textContent?.trim() || link,
          description: stripHtml(body),
          image_url: enc || extractFirstImg(body, url),
          author: item.querySelector('author, creator')?.textContent?.trim() || null,
          article_url: new URL(link, url).toString(),
          published_at: parseIsoDate(item.querySelector('pubDate, date')?.textContent),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null),
  };
}

function upsertLocalArticles(sourceId: number, source: Source, items: ParsedFeedLocal['articles']): number {
  const all = readJson<Article[]>(KEYS.ARTICLES, []);
  const existing = all.filter((a) => a.source_id === sourceId);
  const seenGuids = new Set(existing.map((a) => a.guid).filter(Boolean));
  const seenUrls = new Set(existing.map((a) => normalizeUrl(a.article_url)));

  let maxId = all.reduce((m, a) => Math.max(m, a.id), 0);
  let added = 0;
  const now = new Date().toISOString();

  for (const item of items) {
    const norm = normalizeUrl(item.article_url);
    if ((item.guid && seenGuids.has(item.guid)) || seenUrls.has(norm)) continue;
    if (item.guid) seenGuids.add(item.guid);
    seenUrls.add(norm);
    maxId += 1;
    all.push({
      id: maxId,
      source_id: sourceId,
      source_name: source.name,
      source_icon_url: source.icon_url,
      guid: item.guid,
      title: item.title,
      description: item.description,
      image_url: item.image_url,
      author: item.author,
      article_url: item.article_url,
      published_at: item.published_at,
      collected_at: now,
    });
    added += 1;
  }

  if (added > 0) writeJson(KEYS.ARTICLES, all);
  return added;
}

async function fetchPublicHotlist(platform?: string): Promise<FeedItem[]> {
  const results: FeedItem[] = [];
  const targets = platform ? [platform] : ['weibo', 'zhihu', 'bilibili'];
  const now = new Date().toISOString();

  const tryFetch = async (key: string) => {
    try {
      if (key === 'weibo') {
        const r = await fetch('https://weibo.com/ajax/side/hotSearch');
        const j = await r.json();
        const list = j?.data?.realtime || [];
        return list.slice(0, 15).map((e: Record<string, unknown>, idx: number) => ({
          id: `hot-weibo-${idx + 1}`,
          item_type: 'hot' as const,
          title: String(e.word || e.note || ''),
          url: `https://s.weibo.com/weibo?q=%23${encodeURIComponent(String(e.word || ''))}%23`,
          source_name: '微博热搜',
          source_icon_url: 'https://weibo.com/favicon.ico',
          description: String(e.category || '微博实时热搜'),
          published_at: now,
          rank: idx + 1,
          hot_value: e.num ? `${(Number(e.num) / 10000).toFixed(1)}万热度` : '热搜',
          platform: 'weibo',
        }));
      }
      if (key === 'zhihu') {
        const r = await fetch('https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=15');
        const j = await r.json();
        const list = j?.data || [];
        return list.slice(0, 15).map((e: { target?: Record<string, unknown>; detail_text?: string }, idx: number) => ({
          id: `hot-zhihu-${idx + 1}`,
          item_type: 'hot' as const,
          title: String(e.target?.title || ''),
          url: e.target?.id ? `https://www.zhihu.com/question/${e.target.id}` : 'https://www.zhihu.com/hot',
          source_name: '知乎热榜',
          source_icon_url: 'https://static.zhihu.com/heifetz/favicon.ico',
          description: String(e.target?.excerpt || '').slice(0, 140),
          published_at: now,
          rank: idx + 1,
          hot_value: String(e.detail_text || '热榜'),
          platform: 'zhihu',
        }));
      }
      if (key === 'bilibili') {
        const r = await fetch('https://api.bilibili.com/x/web-interface/popular?ps=15&pn=1');
        const j = await r.json();
        const list = j?.data?.list || [];
        return list.slice(0, 15).map((e: Record<string, unknown>, idx: number) => ({
          id: `hot-bili-${idx + 1}`,
          item_type: 'hot' as const,
          title: String(e.title || ''),
          url: e.bvid ? `https://www.bilibili.com/video/${e.bvid}` : 'https://www.bilibili.com',
          source_name: 'B站热门',
          source_icon_url: 'https://www.bilibili.com/favicon.ico',
          description: String(e.desc || '').slice(0, 140),
          image_url: e.pic ? String(e.pic) : null,
          published_at: now,
          rank: idx + 1,
          hot_value: '热门视频',
          platform: 'bilibili',
        }));
      }
    } catch {
      // fallback below
    }
    return [];
  };

  const fetched = await Promise.all(targets.map(tryFetch));
  fetched.forEach((arr) => results.push(...arr));
  return results;
}

export const standaloneApi = {
  async getFeed(params: { tab: 'all' | 'hot' | 'subscription'; platform?: string; category_id?: number }): Promise<FeedItem[]> {
    const items: FeedItem[] = [];
    if (params.tab === 'all' || params.tab === 'hot') {
      items.push(...(await fetchPublicHotlist(params.platform)));
    }
    if (params.tab === 'all' || params.tab === 'subscription') {
      const sources = readJson<Source[]>(KEYS.SOURCES, []);
      const enabledMap = new Map(sources.filter((s) => s.enabled).map((s) => [s.id, s]));
      const articles = readJson<Article[]>(KEYS.ARTICLES, [])
        .filter((a) => {
          const src = enabledMap.get(a.source_id);
          if (!src) return false;
          if (params.category_id !== undefined && src.category_id !== params.category_id) return false;
          return true;
        })
        .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime());

      for (const art of articles) {
        const src = enabledMap.get(art.source_id);
        items.push({
          id: `sub-${art.id}`,
          item_type: 'subscription',
          title: art.title,
          url: art.article_url,
          source_name: src?.name || art.source_name,
          source_icon_url: src?.icon_url || art.source_icon_url,
          description: art.description,
          image_url: art.image_url,
          author: art.author,
          published_at: art.published_at,
          category_name: src?.category_name,
        });
      }
    }
    return items;
  },

  async listCategories(): Promise<Category[]> {
    const cats = ensureCategories();
    const sources = readJson<Source[]>(KEYS.SOURCES, []);
    return cats
      .map((c) => ({ ...c, source_count: sources.filter((s) => s.category_id === c.id).length }))
      .sort((a, b) => a.sort_order - b.sort_order);
  },

  async createCategory(name: string): Promise<Category> {
    const cats = ensureCategories();
    const nextId = cats.reduce((m, c) => Math.max(m, c.id), 0) + 1;
    const cat: Category = {
      id: nextId,
      name: name.trim(),
      sort_order: cats.length,
      is_default: false,
      source_count: 0,
      created_at: new Date().toISOString(),
    };
    cats.push(cat);
    writeJson(KEYS.CATEGORIES, cats);
    return cat;
  },

  async updateCategory(id: number, payload: { name?: string; sort_order?: number }): Promise<Category> {
    const cats = ensureCategories();
    const target = cats.find((c) => c.id === id);
    if (!target) throw new Error('分类不存在');
    if (payload.name !== undefined) target.name = payload.name.trim();
    if (payload.sort_order !== undefined) target.sort_order = payload.sort_order;
    writeJson(KEYS.CATEGORIES, cats);
    return target;
  },

  async deleteCategory(id: number): Promise<{ ok: boolean; reassigned_sources: number }> {
    const cats = ensureCategories();
    if (cats.length <= 1) throw new Error('至少保留一个分类');
    const fallback = cats.find((c) => c.id !== id && c.is_default) || cats.find((c) => c.id !== id)!;
    const sources = readJson<Source[]>(KEYS.SOURCES, []);
    let reassigned = 0;
    sources.forEach((s) => {
      if (s.category_id === id) {
        s.category_id = fallback.id;
        s.category_name = fallback.name;
        reassigned += 1;
      }
    });
    writeJson(KEYS.SOURCES, sources);
    writeJson(
      KEYS.CATEGORIES,
      cats.filter((c) => c.id !== id)
    );
    return { ok: true, reassigned_sources: reassigned };
  },

  async reorderCategories(orderedIds: number[]): Promise<{ ok: boolean }> {
    const cats = ensureCategories();
    cats.forEach((c) => {
      const idx = orderedIds.indexOf(c.id);
      if (idx !== -1) c.sort_order = idx;
    });
    writeJson(KEYS.CATEGORIES, cats);
    return { ok: true };
  },

  async listSources(params?: { category_id?: number; enabled?: boolean; status?: string; search?: string }): Promise<Source[]> {
    const sources = readJson<Source[]>(KEYS.SOURCES, []);
    const articles = readJson<Article[]>(KEYS.ARTICLES, []);
    return sources
      .filter((s) => {
        if (params?.category_id !== undefined && s.category_id !== params.category_id) return false;
        if (params?.enabled !== undefined && s.enabled !== params.enabled) return false;
        if (params?.status && params.status !== 'all' && s.last_fetch_status !== params.status) return false;
        if (params?.search) {
          const q = params.search.toLowerCase();
          if (!s.name.toLowerCase().includes(q) && !s.url.toLowerCase().includes(q)) return false;
        }
        return true;
      })
      .map((s) => ({
        ...s,
        total_article_count: articles.filter((a) => a.source_id === s.id).length,
      }))
      .sort((a, b) => a.sort_order - b.sort_order);
  },

  async validateSource(url: string): Promise<SourceValidateResult> {
    try {
      const parsed = await fetchAndParseDirect(url);
      return {
        valid: true,
        url: url.trim(),
        website_name: parsed.website_name,
        website_title: parsed.feed_title,
        icon_url: parsed.icon_url,
        feed_type: parsed.feed_type,
        description: parsed.description,
        feed_title: parsed.feed_title,
        article_count_preview: parsed.articles.length,
      };
    } catch (err) {
      return {
        valid: false,
        url: url.trim(),
        website_name: '',
        website_title: '',
        feed_type: 'rss2',
        description: '',
        feed_title: '',
        article_count_preview: 0,
        error: err instanceof Error ? err.message : '验证失败',
      };
    }
  },

  async createSource(payload: {
    url: string;
    name?: string;
    website_name?: string;
    icon_url?: string | null;
    description?: string;
    feed_type?: string;
    category_id: number;
    enabled?: boolean;
  }): Promise<Source> {
    const sources = readJson<Source[]>(KEYS.SOURCES, []);
    if (sources.some((s) => s.url === payload.url.trim())) {
      throw new Error('该订阅源 URL 已存在');
    }
    const cats = ensureCategories();
    const cat = cats.find((c) => c.id === payload.category_id) || cats[0];
    const parsed = await fetchAndParseDirect(payload.url);
    const now = new Date().toISOString();
    const id = sources.reduce((m, s) => Math.max(m, s.id), 0) + 1;
    const src: Source = {
      id,
      name: payload.name?.trim() || parsed.feed_title,
      website_name: payload.website_name?.trim() || parsed.website_name,
      url: payload.url.trim(),
      icon_url: payload.icon_url !== undefined ? payload.icon_url : parsed.icon_url,
      description: payload.description ?? parsed.description,
      feed_type: payload.feed_type || parsed.feed_type,
      category_id: cat.id,
      category_name: cat.name,
      enabled: payload.enabled ?? true,
      sort_order: sources.length,
      last_fetch_at: now,
      last_fetch_status: 'success',
      last_error: null,
      last_article_count: parsed.articles.length,
      total_article_count: parsed.articles.length,
      created_at: now,
      updated_at: now,
    };
    sources.push(src);
    writeJson(KEYS.SOURCES, sources);
    upsertLocalArticles(id, src, parsed.articles);
    return src;
  },

  async updateSource(id: number, payload: Partial<Source>): Promise<Source> {
    const sources = readJson<Source[]>(KEYS.SOURCES, []);
    const src = sources.find((s) => s.id === id);
    if (!src) throw new Error('订阅源不存在');
    Object.assign(src, payload, { updated_at: new Date().toISOString() });
    if (payload.category_id) {
      const cat = ensureCategories().find((c) => c.id === payload.category_id);
      if (cat) src.category_name = cat.name;
    }
    writeJson(KEYS.SOURCES, sources);
    return src;
  },

  async deleteSource(id: number): Promise<void> {
    const sources = readJson<Source[]>(KEYS.SOURCES, []).filter((s) => s.id !== id);
    const articles = readJson<Article[]>(KEYS.ARTICLES, []).filter((a) => a.source_id !== id);
    writeJson(KEYS.SOURCES, sources);
    writeJson(KEYS.ARTICLES, articles);
  },

  async refreshSource(id: number): Promise<SourceRefreshResult> {
    const sources = readJson<Source[]>(KEYS.SOURCES, []);
    const src = sources.find((s) => s.id === id);
    if (!src) throw new Error('订阅源不存在');
    try {
      const parsed = await fetchAndParseDirect(src.url);
      const newCount = upsertLocalArticles(id, src, parsed.articles);
      src.last_fetch_at = new Date().toISOString();
      src.last_fetch_status = 'success';
      src.last_error = null;
      src.last_article_count = parsed.articles.length;
      writeJson(KEYS.SOURCES, sources);
      return { source_id: id, status: 'success', fetched_count: parsed.articles.length, new_count: newCount };
    } catch (err) {
      const msg = err instanceof Error ? err.message : '采集失败';
      src.last_fetch_at = new Date().toISOString();
      src.last_fetch_status = 'failed';
      src.last_error = msg;
      writeJson(KEYS.SOURCES, sources);
      return { source_id: id, status: 'failed', fetched_count: 0, new_count: 0, error: msg };
    }
  },

  async getSourceArticles(id: number): Promise<Article[]> {
    return readJson<Article[]>(KEYS.ARTICLES, [])
      .filter((a) => a.source_id === id)
      .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime());
  },
};
