export interface Category {
  id: number;
  name: string;
  sort_order: number;
  is_default: boolean;
  source_count: number;
  created_at: string;
}

export interface Source {
  id: number;
  name: string;
  website_name: string;
  url: string;
  icon_url?: string | null;
  description: string;
  feed_type: string;
  category_id: number;
  category_name: string;
  enabled: boolean;
  sort_order: number;
  last_fetch_at?: string | null;
  last_fetch_status: 'pending' | 'success' | 'failed';
  last_error?: string | null;
  last_article_count: number;
  total_article_count: number;
  created_at: string;
  updated_at: string;
}

export interface SourceValidateResult {
  valid: boolean;
  url: string;
  website_name: string;
  website_title: string;
  icon_url?: string | null;
  feed_type: string;
  description: string;
  feed_title: string;
  article_count_preview: number;
  error?: string | null;
}

export interface Article {
  id: number;
  source_id: number;
  source_name: string;
  source_icon_url?: string | null;
  guid?: string | null;
  title: string;
  description: string;
  image_url?: string | null;
  author?: string | null;
  article_url: string;
  published_at: string;
  collected_at: string;
}

export interface FeedItem {
  id: string;
  item_type: 'hot' | 'subscription';
  title: string;
  url: string;
  source_name: string;
  source_icon_url?: string | null;
  description: string;
  image_url?: string | null;
  author?: string | null;
  published_at?: string | null;
  rank?: number | null;
  hot_value?: string | null;
  platform?: string | null;
  category_name?: string | null;
}

export interface SourceRefreshResult {
  source_id: number;
  status: string;
  fetched_count: number;
  new_count: number;
  error?: string | null;
}
