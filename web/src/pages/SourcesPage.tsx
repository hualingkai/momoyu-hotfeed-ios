import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  CheckSquare,
  Clock,
  Edit2,
  FolderCog,
  Plus,
  RefreshCw,
  Rss,
  Search,
  Settings,
  Square,
  Trash2,
} from 'lucide-react';
import { api } from '../api';
import { CategoryManagerModal } from '../components/CategoryManagerModal';
import { EditSourceModal } from '../components/EditSourceModal';
import type { Category, Source } from '../types';

interface SourcesPageProps {
  onOpenAdd: () => void;
  onOpenArticles: (source: Source) => void;
}

const FEED_TYPE_BADGE: Record<string, string> = {
  rss2: 'RSS 2.0',
  rss1: 'RSS 1.0',
  atom: 'Atom',
  json_feed: 'JSON Feed',
};

export function SourcesPage({ onOpenAdd, onOpenArticles }: SourcesPageProps) {
  const [sources, setSources] = useState<Source[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<number | undefined>(undefined);
  const [enabledFilter, setEnabledFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'failed' | 'pending'>('all');

  // Batch mode
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  // Modals
  const [showCatModal, setShowCatModal] = useState(false);
  const [editingSource, setEditingSource] = useState<Source | null>(null);
  const [showIntervalModal, setShowIntervalModal] = useState(false);
  const [intervalMinutes, setIntervalMinutes] = useState(10);

  const showNotice = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cats, srcs] = await Promise.all([
        api.listCategories(),
        api.listSources({
          category_id: categoryFilter,
          enabled: enabledFilter === 'all' ? undefined : enabledFilter === 'enabled',
          status: statusFilter,
          search: search.trim() || undefined,
        }),
      ]);
      setCategories(cats);
      setSources(srcs);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载订阅源失败');
    } finally {
      setLoading(false);
    }
  }, [categoryFilter, enabledFilter, statusFilter, search]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleToggleEnabled = async (src: Source) => {
    try {
      await api.toggleSourceStatus(src.id, !src.enabled);
      await loadData();
    } catch (err) {
      showNotice(err instanceof Error ? err.message : '操作失败');
    }
  };

  const handleRefreshOne = async (src: Source) => {
    try {
      const res = await api.refreshSource(src.id);
      if (res.status === 'success') {
        showNotice(`已刷新「${src.name}」，新增 ${res.new_count} 篇文章`);
      } else {
        showNotice(`「${src.name}」刷新失败：${res.error || '未知错误'}`);
      }
      await loadData();
    } catch (err) {
      showNotice(err instanceof Error ? err.message : '刷新失败');
    }
  };

  const handleDeleteOne = async (src: Source) => {
    if (!window.confirm(`确认删除订阅源「${src.name}」及其所有已采集文章？`)) return;
    try {
      await api.deleteSource(src.id);
      showNotice(`已删除「${src.name}」`);
      await loadData();
    } catch (err) {
      showNotice(err instanceof Error ? err.message : '删除失败');
    }
  };

  const handleMove = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= sources.length) return;
    const copy = [...sources];
    const [moved] = copy.splice(index, 1);
    copy.splice(target, 0, moved);
    setSources(copy);
    await api.reorderSources(copy.map((s) => s.id));
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleBatch = async (action: 'enable' | 'disable' | 'delete' | 'refresh') => {
    if (selectedIds.length === 0) return;
    if (action === 'delete' && !window.confirm(`确认批量删除选中的 ${selectedIds.length} 个订阅源？`)) {
      return;
    }
    try {
      const res = await api.batchSources(selectedIds, action);
      showNotice(`批量操作完成（处理 ${res.processed} 个）`);
      setSelectedIds([]);
      setBatchMode(false);
      await loadData();
    } catch (err) {
      showNotice(err instanceof Error ? err.message : '批量操作失败');
    }
  };

  const openIntervalSettings = async () => {
    try {
      const cfg = await api.getSchedulerConfig();
      setIntervalMinutes(Math.max(1, Math.round(cfg.refresh_interval_seconds / 60)));
      setShowIntervalModal(true);
    } catch {
      setShowIntervalModal(true);
    }
  };

  const saveIntervalSettings = async () => {
    try {
      await api.updateSchedulerConfig(intervalMinutes * 60);
      setShowIntervalModal(false);
      showNotice(`全局采集频率已更新为每 ${intervalMinutes} 分钟`);
    } catch (err) {
      showNotice(err instanceof Error ? err.message : '保存失败');
    }
  };

  return (
    <div className="pb-24">
      <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-slate-200 px-4 pt-3 pb-3 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-white">
              <Rss className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-slate-900 leading-none">订阅源</h1>
              <p className="text-[11px] text-slate-400 mt-0.5">共 {sources.length} 个订阅源</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={openIntervalSettings}
              className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700"
              title="采集频率设置"
            >
              <Settings className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowCatModal(true)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium"
            >
              <FolderCog className="w-3.5 h-3.5" />
              分类
            </button>
            <button
              onClick={() => {
                setBatchMode(!batchMode);
                setSelectedIds([]);
              }}
              className={`px-2.5 py-1.5 rounded-xl text-xs font-medium transition ${
                batchMode
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
            >
              {batchMode ? '退出批量' : '批量'}
            </button>
            <button
              onClick={onOpenAdd}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold"
            >
              <Plus className="w-3.5 h-3.5" />
              添加
            </button>
          </div>
        </div>

        {/* Search & Filters */}
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[160px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索名称、网站或 URL..."
              className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs focus:outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <select
            value={categoryFilter ?? ''}
            onChange={(e) => setCategoryFilter(e.target.value ? Number(e.target.value) : undefined)}
            className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700"
          >
            <option value="">全部分类</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <select
            value={enabledFilter}
            onChange={(e) => setEnabledFilter(e.target.value as 'all' | 'enabled' | 'disabled')}
            className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700"
          >
            <option value="all">全部状态</option>
            <option value="enabled">已启用</option>
            <option value="disabled">已停用</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'success' | 'failed' | 'pending')}
            className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700"
          >
            <option value="all">全部采集</option>
            <option value="success">采集成功</option>
            <option value="failed">采集失败</option>
            <option value="pending">待采集</option>
          </select>
        </div>

        {batchMode && (
          <div className="flex items-center justify-between gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            <button
              onClick={() =>
                setSelectedIds(
                  selectedIds.length === sources.length ? [] : sources.map((s) => s.id)
                )
              }
              className="text-xs font-medium text-amber-900"
            >
              {selectedIds.length === sources.length ? '取消全选' : '全选'} ({selectedIds.length})
            </button>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => handleBatch('enable')}
                className="px-2 py-1 rounded-lg bg-white border border-amber-200 text-[11px] font-medium text-slate-700"
              >
                启用
              </button>
              <button
                onClick={() => handleBatch('disable')}
                className="px-2 py-1 rounded-lg bg-white border border-amber-200 text-[11px] font-medium text-slate-700"
              >
                停用
              </button>
              <button
                onClick={() => handleBatch('refresh')}
                className="px-2 py-1 rounded-lg bg-white border border-amber-200 text-[11px] font-medium text-indigo-600"
              >
                刷新
              </button>
              <button
                onClick={() => handleBatch('delete')}
                className="px-2 py-1 rounded-lg bg-rose-600 text-[11px] font-medium text-white"
              >
                删除
              </button>
            </div>
          </div>
        )}
      </header>

      {toast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white text-xs px-4 py-2 rounded-full shadow-lg">
          {toast}
        </div>
      )}

      <main className="max-w-3xl mx-auto px-3 pt-3 space-y-2.5">
        {error && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">
            {error}
          </div>
        )}

        {!loading && sources.length === 0 && (
          <div className="text-center py-14 px-4 bg-white rounded-2xl border border-slate-200">
            <Rss className="w-9 h-9 text-slate-300 mx-auto mb-2" />
            <p className="text-sm font-medium text-slate-700">暂无符合条件的订阅源</p>
            <p className="text-xs text-slate-400 mt-1 mb-4">
              点击右上角「添加」按钮，输入 RSS / Atom / JSON Feed 地址即可订阅
            </p>
            <button
              onClick={onOpenAdd}
              className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold inline-flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              添加第一个订阅源
            </button>
          </div>
        )}

        {sources.map((src, idx) => (
          <div
            key={src.id}
            className={`bg-white rounded-2xl border p-3.5 transition ${
              src.enabled ? 'border-slate-200' : 'border-slate-200/60 opacity-75'
            }`}
          >
            <div className="flex items-start gap-3">
              {batchMode && (
                <button
                  onClick={() => toggleSelect(src.id)}
                  className="mt-1 text-indigo-600 shrink-0"
                >
                  {selectedIds.includes(src.id) ? (
                    <CheckSquare className="w-5 h-5" />
                  ) : (
                    <Square className="w-5 h-5 text-slate-300" />
                  )}
                </button>
              )}

              <button
                onClick={() => onOpenArticles(src)}
                className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0 overflow-hidden"
              >
                {src.icon_url ? (
                  <img
                    src={src.icon_url}
                    alt=""
                    className="w-6 h-6 object-contain"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                ) : (
                  <Rss className="w-5 h-5 text-indigo-500" />
                )}
              </button>

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <button
                    onClick={() => onOpenArticles(src)}
                    className="text-sm font-bold text-slate-900 hover:text-indigo-600 truncate text-left"
                  >
                    {src.name}
                  </button>

                  {/* Enable / Disable switch */}
                  <button
                    onClick={() => handleToggleEnabled(src)}
                    aria-label={src.enabled ? '停用' : '启用'}
                    className={`w-10 h-5.5 rounded-full transition relative shrink-0 ${
                      src.enabled ? 'bg-indigo-600' : 'bg-slate-300'
                    }`}
                  >
                    <span
                      className={`block w-4 h-4 rounded-full bg-white shadow transition-transform ${
                        src.enabled ? 'translate-x-5' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                <div className="flex items-center gap-1.5 flex-wrap mt-1 text-[11px] text-slate-500">
                  {src.website_name && <span className="font-medium text-slate-700">{src.website_name}</span>}
                  <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                    {src.category_name}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 font-medium">
                    {FEED_TYPE_BADGE[src.feed_type] || src.feed_type}
                  </span>
                </div>

                <p className="text-[11px] text-slate-400 truncate mt-1">{src.url}</p>

                <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-2 text-[11px]">
                  {src.last_fetch_status === 'success' ? (
                    <span className="inline-flex items-center gap-1 text-emerald-600 font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      采集正常
                    </span>
                  ) : src.last_fetch_status === 'failed' ? (
                    <span
                      className="inline-flex items-center gap-1 text-rose-600 font-medium"
                      title={src.last_error || ''}
                    >
                      <AlertCircle className="w-3.5 h-3.5" />
                      采集失败
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-slate-400">
                      <Clock className="w-3.5 h-3.5" />
                      待采集
                    </span>
                  )}

                  <span className="text-slate-500">
                    最近获取 {src.last_article_count} 篇 · 累计 {src.total_article_count} 篇
                  </span>

                  {src.last_fetch_at && (
                    <span className="text-slate-400">
                      更新于 {new Date(src.last_fetch_at).toLocaleString('zh-CN')}
                    </span>
                  )}
                </div>

                {src.last_fetch_status === 'failed' && src.last_error && (
                  <p className="text-[11px] text-rose-500 mt-1 line-clamp-1">
                    错误：{src.last_error}
                  </p>
                )}

                <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-slate-100">
                  <button
                    onClick={() => onOpenArticles(src)}
                    className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
                  >
                    查看文章 ({src.total_article_count})
                  </button>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleMove(idx, -1)}
                      disabled={idx === 0}
                      className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 disabled:opacity-30"
                      title="上移"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleMove(idx, 1)}
                      disabled={idx === sources.length - 1}
                      className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 disabled:opacity-30"
                      title="下移"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleRefreshOne(src)}
                      className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600"
                      title="手动刷新"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setEditingSource(src)}
                      className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600"
                      title="编辑"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteOne(src)}
                      className="p-1.5 rounded-lg hover:bg-rose-50 text-rose-500"
                      title="删除"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </main>

      {showCatModal && (
        <CategoryManagerModal
          categories={categories}
          onClose={() => setShowCatModal(false)}
          onChanged={loadData}
        />
      )}

      {editingSource && (
        <EditSourceModal
          source={editingSource}
          categories={categories}
          onClose={() => setEditingSource(null)}
          onSaved={() => {
            setEditingSource(null);
            loadData();
          }}
        />
      )}

      {showIntervalModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-4 space-y-3 shadow-xl">
            <h3 className="text-sm font-bold text-slate-900">全局自动采集频率</h3>
            <p className="text-xs text-slate-500">默认每 10 分钟检查一次已启用的订阅源。</p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={1440}
                value={intervalMinutes}
                onChange={(e) => setIntervalMinutes(Math.max(1, Number(e.target.value)))}
                className="w-24 rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
              <span className="text-xs text-slate-600">分钟 / 次</span>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowIntervalModal(false)}
                className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs text-slate-600"
              >
                取消
              </button>
              <button
                onClick={saveIntervalSettings}
                className="px-4 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-semibold"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
