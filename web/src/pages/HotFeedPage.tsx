import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Flame, RefreshCw, Rss, Clock } from 'lucide-react';
import { api } from '../api';
import type { Category, FeedItem } from '../types';

function formatTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin}分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}小时前`;
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

export function HotFeedPage() {
  const [tab, setTab] = useState<'all' | 'hot' | 'subscription'>('all');
  const [platform, setPlatform] = useState<string>('');
  const [categoryId, setCategoryId] = useState<number | undefined>(undefined);
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadCategories = useCallback(async () => {
    try {
      const data = await api.listCategories();
      setCategories(data);
    } catch {
      // ignore
    }
  }, []);

  const loadFeed = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getFeed({
        tab,
        platform: tab !== 'subscription' && platform ? platform : undefined,
        category_id: tab === 'subscription' ? categoryId : undefined,
      });
      setItems(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [tab, platform, categoryId]);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  return (
    <div className="pb-20">
      <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-slate-200 px-4 pt-3 pb-2.5">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-orange-500 to-rose-500 flex items-center justify-center text-white">
              <Flame className="w-4 h-4" />
            </div>
            <h1 className="text-lg font-bold tracking-tight text-slate-900">全网热点</h1>
          </div>
          <button
            onClick={loadFeed}
            disabled={loading}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>

        {/* 主内容筛选：全部 / 平台热榜 / 我的订阅 */}
        <div className="flex gap-1.5 bg-slate-100 p-1 rounded-xl">
          {(
            [
              { key: 'all', label: '全部' },
              { key: 'hot', label: '平台热榜' },
              { key: 'subscription', label: '我的订阅' },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition ${
                tab === t.key
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* 次级筛选 */}
        {tab !== 'subscription' && (
          <div className="flex gap-1.5 mt-2 overflow-x-auto no-scrollbar">
            {[
              { key: '', label: '全部平台' },
              { key: 'weibo', label: '微博' },
              { key: 'zhihu', label: '知乎' },
              { key: 'bilibili', label: 'B站' },
            ].map((p) => (
              <button
                key={p.key}
                onClick={() => setPlatform(p.key)}
                className={`px-2.5 py-1 rounded-full text-xs whitespace-nowrap transition ${
                  platform === p.key
                    ? 'bg-orange-50 text-orange-600 font-medium border border-orange-200'
                    : 'bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}

        {tab === 'subscription' && categories.length > 0 && (
          <div className="flex gap-1.5 mt-2 overflow-x-auto no-scrollbar">
            <button
              onClick={() => setCategoryId(undefined)}
              className={`px-2.5 py-1 rounded-full text-xs whitespace-nowrap transition ${
                categoryId === undefined
                  ? 'bg-indigo-50 text-indigo-600 font-medium border border-indigo-200'
                  : 'bg-slate-50 text-slate-600 border border-slate-200'
              }`}
            >
              全部分类
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setCategoryId(cat.id)}
                className={`px-2.5 py-1 rounded-full text-xs whitespace-nowrap transition ${
                  categoryId === cat.id
                    ? 'bg-indigo-50 text-indigo-600 font-medium border border-indigo-200'
                    : 'bg-slate-50 text-slate-600 border border-slate-200'
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>
        )}
      </header>

      <main className="max-w-3xl mx-auto px-3 pt-3 space-y-2.5">
        {error && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">
            {error}
          </div>
        )}

        {!loading && items.length === 0 && (
          <div className="text-center py-14 px-4 bg-white rounded-2xl border border-slate-200">
            <Rss className="w-9 h-9 text-slate-300 mx-auto mb-2" />
            <p className="text-sm font-medium text-slate-700">暂无内容</p>
            <p className="text-xs text-slate-500 mt-1">
              {tab === 'subscription'
                ? '还没有启用的订阅文章，请前往「订阅源」添加或刷新订阅源'
                : '暂时没有可展示的数据，请稍后刷新'}
            </p>
          </div>
        )}

        {items.map((item) => (
          <a
            key={item.id}
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block bg-white rounded-2xl border border-slate-200/80 p-3.5 hover:border-slate-300 hover:shadow-sm transition group"
          >
            <div className="flex items-start gap-3">
              {/* 平台热榜保留排名，订阅文章不伪装热搜 */}
              {item.item_type === 'hot' ? (
                <span
                  className={`w-6 h-6 rounded-lg text-xs font-bold flex items-center justify-center shrink-0 mt-0.5 ${
                    (item.rank ?? 99) <= 3
                      ? 'bg-gradient-to-br from-orange-500 to-rose-500 text-white'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {item.rank ?? '-'}
                </span>
              ) : (
                <div className="w-6 h-6 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0 mt-0.5 overflow-hidden">
                  {item.source_icon_url ? (
                    <img
                      src={item.source_icon_url}
                      alt=""
                      className="w-4 h-4 object-contain"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  ) : (
                    <Rss className="w-3.5 h-3.5 text-indigo-500" />
                  )}
                </div>
              )}

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap mb-1">
                  {item.item_type === 'hot' ? (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-50 text-orange-600 border border-orange-200/80">
                      热榜 · {item.source_name}
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-600 border border-indigo-200/80">
                      订阅 · {item.source_name}
                    </span>
                  )}

                  {item.item_type === 'hot' && item.hot_value && (
                    <span className="text-[11px] text-rose-500 font-medium">{item.hot_value}</span>
                  )}

                  {item.item_type === 'subscription' && item.category_name && (
                    <span className="text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                      {item.category_name}
                    </span>
                  )}

                  {item.item_type === 'subscription' && item.published_at && (
                    <span className="inline-flex items-center gap-0.5 text-[11px] text-slate-400 ml-auto">
                      <Clock className="w-3 h-3" />
                      {formatTime(item.published_at)}
                    </span>
                  )}
                </div>

                <h2 className="text-sm font-semibold text-slate-900 group-hover:text-indigo-600 leading-snug line-clamp-2">
                  {item.title}
                </h2>

                {item.description && (
                  <p className="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed">
                    {item.description}
                  </p>
                )}

                <div className="flex items-center justify-between mt-2 text-[11px] text-slate-400">
                  <span className="truncate">
                    {item.author ? `作者：${item.author}` : item.source_name}
                  </span>
                  <span className="inline-flex items-center gap-0.5 text-slate-400 group-hover:text-indigo-500 shrink-0">
                    查看原文 <ExternalLink className="w-3 h-3" />
                  </span>
                </div>
              </div>

              {item.image_url && (
                <img
                  src={item.image_url}
                  alt=""
                  loading="lazy"
                  className="w-20 h-16 rounded-xl object-cover shrink-0 bg-slate-100 border border-slate-100"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              )}
            </div>
          </a>
        ))}
      </main>
    </div>
  );
}
