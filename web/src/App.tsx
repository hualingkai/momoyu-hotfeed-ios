import { useEffect, useState } from 'react';
import { Flame, Rss } from 'lucide-react';
import { api } from './api';
import { AddSourcePage } from './pages/AddSourcePage';
import { HotFeedPage } from './pages/HotFeedPage';
import { SourceArticlesPage } from './pages/SourceArticlesPage';
import { SourcesPage } from './pages/SourcesPage';
import type { Category, Source } from './types';

type BottomTab = 'hot' | 'sources';
type SubView =
  | { type: 'none' }
  | { type: 'add' }
  | { type: 'articles'; source: Source };

export function App() {
  const [activeTab, setActiveTab] = useState<BottomTab>('hot');
  const [subView, setSubView] = useState<SubView>({ type: 'none' });
  const [categories, setCategories] = useState<Category[]>([]);
  const [sourcesRefreshKey, setSourcesRefreshKey] = useState(0);

  useEffect(() => {
    api.listCategories().then(setCategories).catch(() => {});
  }, [sourcesRefreshKey]);

  const renderContent = () => {
    if (activeTab === 'sources') {
      if (subView.type === 'add') {
        return (
          <AddSourcePage
            categories={categories}
            onBack={() => setSubView({ type: 'none' })}
            onCreated={() => {
              setSourcesRefreshKey((k) => k + 1);
              setSubView({ type: 'none' });
            }}
          />
        );
      }
      if (subView.type === 'articles') {
        return (
          <SourceArticlesPage
            source={subView.source}
            onBack={() => setSubView({ type: 'none' })}
            onRefreshed={() => setSourcesRefreshKey((k) => k + 1)}
          />
        );
      }
      return (
        <SourcesPage
          key={sourcesRefreshKey}
          onOpenAdd={() => setSubView({ type: 'add' })}
          onOpenArticles={(source) => setSubView({ type: 'articles', source })}
        />
      );
    }

    return <HotFeedPage />;
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {renderContent()}

      {/* App 底部导航只保留两个栏目：全网热点 / 订阅源 */}
      <nav className="fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-slate-200 safe-bottom">
        <div className="max-w-3xl mx-auto grid grid-cols-2 h-14">
          <button
            onClick={() => {
              setActiveTab('hot');
              setSubView({ type: 'none' });
            }}
            className={`flex flex-col items-center justify-center gap-0.5 transition ${
              activeTab === 'hot' ? 'text-orange-600 font-semibold' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Flame className="w-5 h-5" />
            <span className="text-[11px]">全网热点</span>
          </button>

          <button
            onClick={() => {
              setActiveTab('sources');
              setSubView({ type: 'none' });
            }}
            className={`flex flex-col items-center justify-center gap-0.5 transition ${
              activeTab === 'sources' ? 'text-indigo-600 font-semibold' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Rss className="w-5 h-5" />
            <span className="text-[11px]">订阅源</span>
          </button>
        </div>
      </nav>
    </div>
  );
}

export default App;
