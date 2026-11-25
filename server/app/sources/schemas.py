from datetime import datetime
from typing import List, Literal, Optional
from pydantic import BaseModel, Field


class CategoryBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    sort_order: Optional[int] = None


class CategoryCreate(CategoryBase):
    pass


class CategoryUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    sort_order: Optional[int] = None


class CategoryOut(BaseModel):
    id: int
    name: str
    sort_order: int
    is_default: bool
    source_count: int = 0
    created_at: datetime

    model_config = {"from_attributes": True}


class CategoryReorderRequest(BaseModel):
    ordered_ids: List[int]


class SourceValidateRequest(BaseModel):
    url: str = Field(..., min_length=1, max_length=2048)


class SourceValidateResponse(BaseModel):
    valid: bool
    url: str
    website_name: str = ""
    website_title: str = ""
    icon_url: Optional[str] = None
    feed_type: str = "rss2"
    description: str = ""
    feed_title: str = ""
    article_count_preview: int = 0
    error: Optional[str] = None


class SourceCreate(BaseModel):
    url: str = Field(..., min_length=1, max_length=2048)
    name: Optional[str] = Field(None, max_length=200)
    website_name: Optional[str] = Field(None, max_length=200)
    icon_url: Optional[str] = Field(None, max_length=2048)
    description: Optional[str] = None
    feed_type: Optional[str] = Field(None, max_length=50)
    category_id: int
    enabled: bool = True


class SourceUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    website_name: Optional[str] = Field(None, max_length=200)
    url: Optional[str] = Field(None, min_length=1, max_length=2048)
    icon_url: Optional[str] = Field(None, max_length=2048)
    description: Optional[str] = None
    feed_type: Optional[str] = Field(None, max_length=50)
    category_id: Optional[int] = None
    enabled: Optional[bool] = None
    sort_order: Optional[int] = None


class SourceStatusPatch(BaseModel):
    enabled: bool


class SourceReorderRequest(BaseModel):
    ordered_ids: List[int]


class SourceBatchRequest(BaseModel):
    source_ids: List[int] = Field(..., min_length=1)
    action: Literal["enable", "disable", "delete", "refresh"]


class SourceOut(BaseModel):
    id: int
    name: str
    website_name: str
    url: str
    icon_url: Optional[str] = None
    description: str
    feed_type: str
    category_id: int
    category_name: str = ""
    enabled: bool
    sort_order: int
    last_fetch_at: Optional[datetime] = None
    last_fetch_status: str
    last_error: Optional[str] = None
    last_article_count: int
    total_article_count: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ArticleOut(BaseModel):
    id: int
    source_id: int
    source_name: str = ""
    source_icon_url: Optional[str] = None
    guid: Optional[str] = None
    title: str
    description: str
    image_url: Optional[str] = None
    author: Optional[str] = None
    article_url: str
    published_at: datetime
    collected_at: datetime

    model_config = {"from_attributes": True}


class SourceRefreshResult(BaseModel):
    source_id: int
    status: str
    fetched_count: int
    new_count: int
    error: Optional[str] = None


class SchedulerConfigOut(BaseModel):
    refresh_interval_seconds: int


class SchedulerConfigUpdate(BaseModel):
    refresh_interval_seconds: int = Field(..., ge=60, le=86400)


class FeedItemOut(BaseModel):
    id: str
    item_type: Literal["hot", "subscription"]
    title: str
    url: str
    source_name: str
    source_icon_url: Optional[str] = None
    description: str = ""
    image_url: Optional[str] = None
    author: Optional[str] = None
    published_at: Optional[datetime] = None
    rank: Optional[int] = None
    hot_value: Optional[str] = None
    platform: Optional[str] = None
    category_name: Optional[str] = None
