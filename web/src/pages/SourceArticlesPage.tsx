import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Clock, ExternalLink, RefreshCw, Rss } from 'lucide-react';
import { api } from '../api';
import type { Article, Source } from '../types';

interface SourceArticlesPageProps {
  source: Source;
  onBack: () => void;
  onRefreshed: () => void;
}

export function SourceArticlesPage({ source, onBack, onRefreshed }: SourceArticlesPageProps) {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadArticles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getSourceArticles(source.id);
      setArticles(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载文章失败');
    } finally {
      setLoading(false);
    }
  }, [source.id]);

  useEffect(() => {
    loadArticles();
  }, [loadArticles]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await api.refreshSource(source.id);
      if (res.status === 'failed' && res.error) {
        setError(`采集失败（已保留历史文章）：${res.error}`);
      }
      await loadArticles();
      onRefreshed();
    } catch (err) {
      setError(err instanceof Error ? err.message : '刷新失败');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="pb-24 min-h-screen bg-slate-50">
      <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-slate-200 px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            onClick={onBack}
            className="p-1.5 -ml-1.5 rounded-lg hover:bg-slate-100 text-slate-700 shrink-0"
            aria-label="返回"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <h1 className="text-base font-bold text-slate-900 truncate">{source.name}</h1>
            <p className="text-[11px] text-slate-400 truncate">{source.url}</p>
          </div>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-50 text-indigo-600 hover:bg-indigo-100 text-xs font-semibold shrink-0 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </header>

      <main className="max-w-3xl mx-auto px-3 pt-3 space-y-2.5">
        {error && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">
            {error}
          </div>
        )}

        {!loading && articles.length === 0 && (
          <div className="text-center py-14 bg-white rounded-2xl border border-slate-200">
            <Rss className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-sm text-slate-600">暂无已采集的文章</p>
          </div>
        )}

        {articles.map((art) => (
          <a
            key={art.id}
            href={art.article_url}
            target="_blank"
            rel="noopener noreferrer"
            className="block bg-white rounded-2xl border border-slate-200 p-3.5 hover:border-indigo-300 transition group"
          >
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <h2 className="text-sm font-semibold text-slate-900 group-hover:text-indigo-600 leading-snug">
                  {art.title}
                </h2>
                {art.description && (
                  <p className="text-xs text-slate-500 mt-1.5 line-clamp-2 leading-relaxed">
                    {art.description}
                  </p>
                )}
                <div className="flex items-center gap-3 mt-2 text-[11px] text-slate-400">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {new Date(art.published_at).toLocaleString('zh-CN')}
                  </span>
                  {art.author && <span>作者：{art.author}</span>}
                  <span className="ml-auto inline-flex items-center gap-0.5 group-hover:text-indigo-500">
                    原文 <ExternalLink className="w-3 h-3" />
                  </span>
                </div>
              </div>
              {art.image_url && (
                <img
                  src={art.image_url}
                  alt=""
                  loading="lazy"
                  className="w-20 h-16 rounded-xl object-cover shrink-0 bg-slate-100"
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
