from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.hotlist.service import get_hotlist
from app.sources import repository, service
from app.sources.parser import FeedParseError
from app.sources.schemas import (
    ArticleOut,
    CategoryCreate,
    CategoryOut,
    CategoryReorderRequest,
    CategoryUpdate,
    FeedItemOut,
    SchedulerConfigOut,
    SchedulerConfigUpdate,
    SourceBatchRequest,
    SourceCreate,
    SourceOut,
    SourceRefreshResult,
    SourceReorderRequest,
    SourceStatusPatch,
    SourceUpdate,
    SourceValidateRequest,
    SourceValidateResponse,
)
from app.sources.service import RateLimitError
from app.sources.validator import FetchError, SSRFError, validate_url_security

router = APIRouter(prefix="/api/v1", tags=["sources"])


def _to_source_out(src, total_count: int) -> SourceOut:
    return SourceOut(
        id=src.id,
        name=src.name,
        website_name=src.website_name,
        url=src.url,
        icon_url=src.icon_url,
        description=src.description,
        feed_type=src.feed_type,
        category_id=src.category_id,
        category_name=src.category.name if src.category else "",
        enabled=src.enabled,
        sort_order=src.sort_order,
        last_fetch_at=src.last_fetch_at,
        last_fetch_status=src.last_fetch_status,
        last_error=src.last_error,
        last_article_count=src.last_article_count,
        total_article_count=total_count,
        created_at=src.created_at,
        updated_at=src.updated_at,
    )


def _to_article_out(article) -> ArticleOut:
    return ArticleOut(
        id=article.id,
        source_id=article.source_id,
        source_name=article.source.name if article.source else "",
        source_icon_url=article.source.icon_url if article.source else None,
        guid=article.guid,
        title=article.title,
        description=article.description,
        image_url=article.image_url,
        author=article.author,
        article_url=article.article_url,
        published_at=article.published_at,
        collected_at=article.collected_at,
    )


# ---------- Config ----------

@router.get("/sources/config", response_model=SchedulerConfigOut)
def get_scheduler_config(db: Session = Depends(get_db)):
    return SchedulerConfigOut(refresh_interval_seconds=repository.get_refresh_interval(db))


@router.put("/sources/config", response_model=SchedulerConfigOut)
def update_scheduler_config(payload: SchedulerConfigUpdate, db: Session = Depends(get_db)):
    val = repository.set_refresh_interval(db, payload.refresh_interval_seconds)
    return SchedulerConfigOut(refresh_interval_seconds=val)


# ---------- Sources ----------

@router.get("/sources", response_model=List[SourceOut])
def list_sources(
    category_id: Optional[int] = Query(None),
    enabled: Optional[bool] = Query(None),
    fetch_status: Optional[str] = Query(None, alias="status"),
    search: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    rows = repository.list_sources(
        db,
        category_id=category_id,
        enabled=enabled,
        status=fetch_status,
        search=search,
    )
    return [_to_source_out(src, cnt) for src, cnt in rows]


@router.post("/sources/validate", response_model=SourceValidateResponse)
async def validate_source(payload: SourceValidateRequest):
    return await service.validate_feed_url(payload.url)


@router.post("/sources", response_model=SourceOut, status_code=status.HTTP_201_CREATED)
async def create_source(payload: SourceCreate, db: Session = Depends(get_db)):
    try:
        src = await service.create_source_from_payload(db, payload)
    except SSRFError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (FetchError, FeedParseError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    total = repository.get_source_article_count(db, src.id)
    return _to_source_out(src, total)


@router.post("/sources/reorder")
def reorder_sources(payload: SourceReorderRequest, db: Session = Depends(get_db)):
    repository.reorder_sources(db, payload.ordered_ids)
    return {"ok": True}


@router.post("/sources/batch")
async def batch_manage_sources(payload: SourceBatchRequest, db: Session = Depends(get_db)):
    processed = 0
    errors: List[dict] = []
    for sid in payload.source_ids:
        src = repository.get_source(db, sid)
        if not src:
            continue
        if payload.action == "enable":
            repository.update_source(db, src, enabled=True)
            processed += 1
        elif payload.action == "disable":
            repository.update_source(db, src, enabled=False)
            processed += 1
        elif payload.action == "delete":
            repository.delete_source(db, src)
            processed += 1
        elif payload.action == "refresh":
            res = await service.refresh_source(db, src, enforce_cooldown=False)
            processed += 1
            if res.status == "failed":
                errors.append({"source_id": sid, "error": res.error})
    return {"ok": True, "processed": processed, "errors": errors}


@router.get("/sources/{source_id}", response_model=SourceOut)
def get_source(source_id: int, db: Session = Depends(get_db)):
    src = repository.get_source(db, source_id)
    if not src:
        raise HTTPException(status_code=404, detail="订阅源不存在")
    total = repository.get_source_article_count(db, src.id)
    return _to_source_out(src, total)


@router.put("/sources/{source_id}", response_model=SourceOut)
def update_source(source_id: int, payload: SourceUpdate, db: Session = Depends(get_db)):
    src = repository.get_source(db, source_id)
    if not src:
        raise HTTPException(status_code=404, detail="订阅源不存在")

    updates = payload.model_dump(exclude_unset=True)
    if "url" in updates and updates["url"]:
        try:
            updates["url"] = validate_url_security(updates["url"])
        except SSRFError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        existing = repository.get_source_by_url(db, updates["url"])
        if existing and existing.id != source_id:
            raise HTTPException(status_code=400, detail="该订阅源 URL 已被其他订阅使用")

    if "category_id" in updates and updates["category_id"] is not None:
        if not repository.get_category(db, updates["category_id"]):
            raise HTTPException(status_code=400, detail="指定的分类不存在")

    updated = repository.update_source(db, src, **updates)
    total = repository.get_source_article_count(db, updated.id)
    return _to_source_out(updated, total)


@router.delete("/sources/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_source(source_id: int, db: Session = Depends(get_db)):
    src = repository.get_source(db, source_id)
    if not src:
        raise HTTPException(status_code=404, detail="订阅源不存在")
    repository.delete_source(db, src)
    return None


@router.post("/sources/{source_id}/refresh", response_model=SourceRefreshResult)
async def refresh_source(source_id: int, db: Session = Depends(get_db)):
    src = repository.get_source(db, source_id)
    if not src:
        raise HTTPException(status_code=404, detail="订阅源不存在")
    try:
        return await service.refresh_source(db, src, enforce_cooldown=True)
    except RateLimitError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc


@router.patch("/sources/{source_id}/status", response_model=SourceOut)
def patch_source_status(source_id: int, payload: SourceStatusPatch, db: Session = Depends(get_db)):
    src = repository.get_source(db, source_id)
    if not src:
        raise HTTPException(status_code=404, detail="订阅源不存在")
    updated = repository.update_source(db, src, enabled=payload.enabled)
    total = repository.get_source_article_count(db, updated.id)
    return _to_source_out(updated, total)


@router.get("/sources/{source_id}/articles", response_model=List[ArticleOut])
def get_source_articles(
    source_id: int,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    src = repository.get_source(db, source_id)
    if not src:
        raise HTTPException(status_code=404, detail="订阅源不存在")
    articles = repository.list_source_articles(db, source_id, limit=limit, offset=offset)
    return [_to_article_out(a) for a in articles]


# ---------- Categories ----------

@router.get("/source-categories", response_model=List[CategoryOut])
def list_categories(db: Session = Depends(get_db)):
    rows = repository.list_categories(db)
    return [
        CategoryOut(
            id=cat.id,
            name=cat.name,
            sort_order=cat.sort_order,
            is_default=cat.is_default,
            source_count=cnt,
            created_at=cat.created_at,
        )
        for cat, cnt in rows
    ]


@router.post("/source-categories", response_model=CategoryOut, status_code=status.HTTP_201_CREATED)
def create_category(payload: CategoryCreate, db: Session = Depends(get_db)):
    try:
        cat = repository.create_category(db, payload.name, payload.sort_order)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="分类名称已存在或无效") from exc
    return CategoryOut(
        id=cat.id,
        name=cat.name,
        sort_order=cat.sort_order,
        is_default=cat.is_default,
        source_count=0,
        created_at=cat.created_at,
    )


@router.post("/source-categories/reorder")
def reorder_categories(payload: CategoryReorderRequest, db: Session = Depends(get_db)):
    repository.reorder_categories(db, payload.ordered_ids)
    return {"ok": True}


@router.put("/source-categories/{category_id}", response_model=CategoryOut)
def update_category(category_id: int, payload: CategoryUpdate, db: Session = Depends(get_db)):
    cat = repository.get_category(db, category_id)
    if not cat:
        raise HTTPException(status_code=404, detail="分类不存在")
    try:
        updated = repository.update_category(
            db, cat, name=payload.name, sort_order=payload.sort_order
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail="分类名称已存在或无效") from exc
    return CategoryOut(
        id=updated.id,
        name=updated.name,
        sort_order=updated.sort_order,
        is_default=updated.is_default,
        source_count=len(updated.sources),
        created_at=updated.created_at,
    )


@router.delete("/source-categories/{category_id}")
def delete_category(category_id: int, db: Session = Depends(get_db)):
    cat = repository.get_category(db, category_id)
    if not cat:
        raise HTTPException(status_code=404, detail="分类不存在")
    try:
        reassigned = repository.delete_category(db, cat)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "reassigned_sources": reassigned}


# ---------- Integrated Feed & Hotlist ----------

@router.get("/hotlist", response_model=List[FeedItemOut])
async def get_platform_hotlist(platform: Optional[str] = Query(None)):
    return await get_hotlist(platform)


@router.get("/feed", response_model=List[FeedItemOut])
async def get_integrated_feed(
    tab: Literal["all", "hot", "subscription"] = Query("all"),
    platform: Optional[str] = Query(None),
    category_id: Optional[int] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    items: List[FeedItemOut] = []

    if tab in ("all", "hot"):
        hot_items = await get_hotlist(platform)
        items.extend(hot_items)

    if tab in ("all", "subscription"):
        sub_articles = repository.list_enabled_articles(
            db, limit=limit, offset=offset, category_id=category_id
        )
        for art in sub_articles:
            items.append(
                FeedItemOut(
                    id=f"sub-{art.id}",
                    item_type="subscription",
                    title=art.title,
                    url=art.article_url,
                    source_name=art.source.name if art.source else "订阅源",
                    source_icon_url=art.source.icon_url if art.source else None,
                    description=art.description,
                    image_url=art.image_url,
                    author=art.author,
                    published_at=art.published_at,
                    category_name=art.source.category.name if art.source and art.source.category else None,
                )
            )

    if tab == "subscription":
        items.sort(key=lambda x: x.published_at.timestamp() if x.published_at else 0, reverse=True)
    elif tab == "all":
        # Keep hot items with their ranks and subscription items sorted by published_at DESC,
        # clearly separated by item_type ("hot" vs "subscription")
        hot_part = [i for i in items if i.item_type == "hot"]
        sub_part = sorted(
            [i for i in items if i.item_type == "subscription"],
            key=lambda x: x.published_at.timestamp() if x.published_at else 0,
            reverse=True,
        )
        # Interleave or present cleanly; here we interleave 2 hot + 2 sub or list both cleanly
        merged: List[FeedItemOut] = []
        hi, si = 0, 0
        while hi < len(hot_part) or si < len(sub_part):
            for _ in range(3):
                if hi < len(hot_part):
                    merged.append(hot_part[hi])
                    hi += 1
            for _ in range(3):
                if si < len(sub_part):
                    merged.append(sub_part[si])
                    si += 1
        items = merged

    return items
