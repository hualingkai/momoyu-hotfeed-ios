import { useState } from 'react';
import { ArrowDown, ArrowUp, Check, Edit2, Plus, Trash2, X } from 'lucide-react';
import { api } from '../api';
import type { Category } from '../types';

interface CategoryManagerModalProps {
  categories: Category[];
  onClose: () => void;
  onChanged: () => void;
}

export function CategoryManagerModal({ categories, onClose, onChanged }: CategoryManagerModalProps) {
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setError(null);
    try {
      await api.createCategory(newName.trim());
      setNewName('');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : '新增失败');
    }
  };

  const handleSaveEdit = async (id: number) => {
    if (!editingName.trim()) return;
    setError(null);
    try {
      await api.updateCategory(id, { name: editingName.trim() });
      setEditingId(null);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新失败');
    }
  };

  const handleDelete = async (cat: Category) => {
    const msg =
      cat.source_count > 0
        ? `分类「${cat.name}」下有 ${cat.source_count} 个订阅源，删除后这些订阅源将自动转移至默认分类，不会丢失数据。确认删除？`
        : `确认删除分类「${cat.name}」？`;
    if (!window.confirm(msg)) return;
    setError(null);
    try {
      await api.deleteCategory(cat.id);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  };

  const handleMove = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= categories.length) return;
    const copy = [...categories];
    const [moved] = copy.splice(index, 1);
    copy.splice(target, 0, moved);
    await api.reorderCategories(copy.map((c) => c.id));
    onChanged();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl shadow-xl max-h-[85vh] flex flex-col">
        <div className="px-4 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900">订阅源分类管理</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 text-slate-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto space-y-3 flex-1">
          {error && (
            <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">
              {error}
            </div>
          )}

          <form onSubmit={handleAdd} className="flex gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="输入新分类名称..."
              className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              type="submit"
              className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold inline-flex items-center gap-1"
            >
              <Plus className="w-4 h-4" />
              新增
            </button>
          </form>

          <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
            {categories.map((cat, idx) => (
              <div key={cat.id} className="flex items-center justify-between px-3 py-2.5 bg-white gap-2">
                {editingId === cat.id ? (
                  <div className="flex items-center gap-1.5 flex-1">
                    <input
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      className="flex-1 rounded-lg border border-indigo-400 px-2.5 py-1 text-sm focus:outline-none"
                    />
                    <button
                      onClick={() => handleSaveEdit(cat.id)}
                      className="p-1.5 rounded-lg bg-indigo-600 text-white"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="p-1.5 rounded-lg bg-slate-100 text-slate-600"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium text-slate-800 truncate">{cat.name}</span>
                      <span className="text-[11px] text-slate-400">({cat.source_count})</span>
                      {cat.is_default && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                          默认
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
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
                        disabled={idx === categories.length - 1}
                        className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 disabled:opacity-30"
                        title="下移"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          setEditingId(cat.id);
                          setEditingName(cat.name);
                        }}
                        className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600"
                        title="编辑"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(cat)}
                        className="p-1.5 rounded-lg hover:bg-rose-50 text-rose-500"
                        title="删除"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
