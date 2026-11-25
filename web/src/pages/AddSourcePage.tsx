import { useState } from 'react';
import { ArrowLeft, CheckCircle2, Globe, Loader2, Rss, ShieldAlert } from 'lucide-react';
import { api } from '../api';
import type { Category, Source, SourceValidateResult } from '../types';

interface AddSourcePageProps {
  categories: Category[];
  onBack: () => void;
  onCreated: (source: Source) => void;
}

const FEED_TYPE_LABELS: Record<string, string> = {
  rss2: 'RSS 2.0',
  rss1: 'RSS 1.0',
  atom: 'Atom',
  json_feed: 'JSON Feed',
};

export function AddSourcePage({ categories, onBack, onCreated }: AddSourcePageProps) {
  const [url, setUrl] = useState('');
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validated, setValidated] = useState<SourceValidateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Editable fields populated after validation
  const [name, setName] = useState('');
  const [websiteName, setWebsiteName] = useState('');
  const [iconUrl, setIconUrl] = useState('');
  const [description, setDescription] = useState('');
  const [feedType, setFeedType] = useState('rss2');
  const [categoryId, setCategoryId] = useState<number>(categories[0]?.id ?? 1);
  const [enabled, setEnabled] = useState(true);

  const handleValidate = async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      setError('请输入订阅源 URL');
      return;
    }
    setValidating(true);
    setError(null);
    setValidated(null);
    try {
      const res = await api.validateSource(trimmed);
      if (!res.valid) {
        setError(res.error || '订阅源验证失败，请检查 URL 是否可访问且格式正确');
        return;
      }
      setValidated(res);
      setName(res.feed_title || res.website_title || res.website_name || '');
      setWebsiteName(res.website_name || '');
      setIconUrl(res.icon_url || '');
      setDescription(res.description || '');
      setFeedType(res.feed_type || 'rss2');
    } catch (err) {
      setError(err instanceof Error ? err.message : '验证请求失败');
    } finally {
      setValidating(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validated?.valid) {
      setError('请先验证订阅源 URL');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await api.createSource({
        url: validated.url,
        name: name.trim() || validated.feed_title,
        website_name: websiteName.trim() || validated.website_name,
        icon_url: iconUrl.trim() || null,
        description: description.trim(),
        feed_type: feedType,
        category_id: categoryId,
        enabled,
      });
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pb-24 min-h-screen bg-slate-50">
      <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-slate-200 px-4 py-3 flex items-center gap-3">
        <button
          onClick={onBack}
          className="p-1.5 -ml-1.5 rounded-lg hover:bg-slate-100 text-slate-700"
          aria-label="返回"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-base font-bold text-slate-900">添加订阅源</h1>
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-4 space-y-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              订阅源 URL <span className="text-rose-500">*</span>
            </label>
            <div className="flex gap-2">
              <input
                type="url"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setValidated(null);
                }}
                placeholder="https://example.com/feed.xml"
                className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                type="button"
                onClick={handleValidate}
                disabled={validating}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 shrink-0"
              >
                {validating ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    识别中
                  </>
                ) : (
                  '识别并验证'
                )}
              </button>
            </div>
            <p className="text-[11px] text-slate-400 mt-1.5">
              支持 RSS 2.0、RSS 1.0、Atom、JSON Feed，仅支持公网 HTTP/HTTPS 地址。
            </p>
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {validated?.valid && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>
                验证通过！识别为 <strong>{FEED_TYPE_LABELS[validated.feed_type] || validated.feed_type}</strong>，
                共解析到 {validated.article_count_preview} 篇文章，可修改下方信息后保存。
              </span>
            </div>
          )}
        </div>

        {validated?.valid && (
          <form onSubmit={handleSave} className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3.5">
            <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
              <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center overflow-hidden shrink-0">
                {iconUrl ? (
                  <img src={iconUrl} alt="" className="w-6 h-6 object-contain" />
                ) : (
                  <Globe className="w-5 h-5 text-slate-400" />
                )}
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-800 truncate">
                  {validated.website_title || validated.feed_title}
                </div>
                <div className="text-[11px] text-slate-400 truncate">{validated.url}</div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">订阅源名称</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">网站名称</label>
                <input
                  type="text"
                  value={websiteName}
                  onChange={(e) => setWebsiteName(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">所属分类</label>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">订阅类型</label>
                <select
                  value={feedType}
                  onChange={(e) => setFeedType(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="rss2">RSS 2.0</option>
                  <option value="rss1">RSS 1.0</option>
                  <option value="atom">Atom</option>
                  <option value="json_feed">JSON Feed</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">网站图标 URL</label>
              <input
                type="url"
                value={iconUrl}
                onChange={(e) => setIconUrl(e.target.value)}
                placeholder="https://example.com/favicon.ico"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">网站描述</label>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              添加后立即启用采集
            </label>

            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={onBack}
                className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Rss className="w-3.5 h-3.5" />}
                保存订阅源
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
