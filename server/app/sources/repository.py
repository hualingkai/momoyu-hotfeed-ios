from typing import Dict, List, Optional, Tuple
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.sources.models import (
    SourceSystemConfig,
    SubscriptionArticle,
    SubscriptionCategory,
    SubscriptionSource,
    utcnow,
)
from app.sources.parser import ParsedArticle

PRESET_CATEGORIES = [
    ("综合资讯", True),
    ("科技数码", False),
    ("财经商业", False),
    ("社会新闻", False),
    ("娱乐影视", False),
    ("体育赛事", False),
    ("游戏动漫", False),
    ("开发技术", False),
    ("自定义分类", False),
]

DEFAULT_REFRESH_INTERVAL_SECONDS = 600


def ensure_default_categories(db: Session) -> None:
    existing_count = db.scalar(select(func.count(SubscriptionCategory.id))) or 0
    if existing_count > 0:
        return
    for idx, (name, is_default) in enumerate(PRESET_CATEGORIES):
        db.add(
            SubscriptionCategory(
                name=name,
                sort_order=idx,
                is_default=is_default,
            )
        )
    db.commit()


def get_refresh_interval(db: Session) -> int:
    row = db.get(SourceSystemConfig, "refresh_interval_seconds")
    if row and row.value.isdigit():
        return max(60, int(row.value))
    return DEFAULT_REFRESH_INTERVAL_SECONDS


def set_refresh_interval(db: Session, seconds: int) -> int:
    row = db.get(SourceSystemConfig, "refresh_interval_seconds")
    if row:
        row.value = str(seconds)
    else:
        db.add(SourceSystemConfig(key="refresh_interval_seconds", value=str(seconds)))
    db.commit()
    return seconds


def list_categories(db: Session) -> List[Tuple[SubscriptionCategory, int]]:
    ensure_default_categories(db)
    stmt = (
        select(
            SubscriptionCategory,
            func.count(SubscriptionSource.id).label("source_count"),
        )
        .outerjoin(SubscriptionSource, SubscriptionSource.category_id == SubscriptionCategory.id)
        .group_by(SubscriptionCategory.id)
        .order_by(SubscriptionCategory.sort_order.asc(), SubscriptionCategory.id.asc())
    )
    return [(row[0], row[1]) for row in db.execute(stmt).all()]


def get_category(db: Session, category_id: int) -> Optional[SubscriptionCategory]:
    return db.get(SubscriptionCategory, category_id)


def create_category(db: Session, name: str, sort_order: Optional[int] = None) -> SubscriptionCategory:
    if sort_order is None:
        max_order = db.scalar(select(func.max(SubscriptionCategory.sort_order)))
        sort_order = (max_order if max_order is not None else -1) + 1
    cat = SubscriptionCategory(name=name.strip(), sort_order=sort_order, is_default=False)
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat


def update_category(
    db: Session,
    category: SubscriptionCategory,
    *,
    name: Optional[str] = None,
    sort_order: Optional[int] = None,
) -> SubscriptionCategory:
    if name is not None:
        category.name = name.strip()
    if sort_order is not None:
        category.sort_order = sort_order
    db.commit()
    db.refresh(category)
    return category


def delete_category(db: Session, category: SubscriptionCategory) -> int:
    """
    Delete a category and safely reassign any existing sources to a fallback category
    so no subscription data is lost. Returns number of reassigned sources.
    """
    fallback = db.scalar(
        select(SubscriptionCategory)
        .where(SubscriptionCategory.id != category.id, SubscriptionCategory.is_default.is_(True))
        .limit(1)
    )
    if fallback is None:
        fallback = db.scalar(
            select(SubscriptionCategory)
            .where(SubscriptionCategory.id != category.id)
            .order_by(SubscriptionCategory.sort_order.asc(), SubscriptionCategory.id.asc())
            .limit(1)
        )
    if fallback is None:
        raise ValueError("至少需要保留一个分类，无法删除最后一个分类")

    sources_to_move = db.scalars(
        select(SubscriptionSource).where(SubscriptionSource.category_id == category.id)
    ).all()
    for src in sources_to_move:
        src.category_id = fallback.id
    if category.is_default:
        fallback.is_default = True

    db.flush()
    db.expire(category, ["sources"])
    db.delete(category)
    db.commit()
    return len(sources_to_move)


def reorder_categories(db: Session, ordered_ids: List[int]) -> None:
    cats = db.scalars(select(SubscriptionCategory)).all()
    by_id: Dict[int, SubscriptionCategory] = {c.id: c for c in cats}
    for idx, cid in enumerate(ordered_ids):
        if cid in by_id:
            by_id[cid].sort_order = idx
    db.commit()


def list_sources(
    db: Session,
    *,
    category_id: Optional[int] = None,
    enabled: Optional[bool] = None,
    status: Optional[str] = None,
    search: Optional[str] = None,
) -> List[Tuple[SubscriptionSource, int]]:
    article_count_sub = (
        select(
            SubscriptionArticle.source_id,
            func.count(SubscriptionArticle.id).label("total_count"),
        )
        .group_by(SubscriptionArticle.source_id)
        .subquery()
    )

    stmt = (
        select(
            SubscriptionSource,
            func.coalesce(article_count_sub.c.total_count, 0).label("total_article_count"),
        )
        .options(joinedload(SubscriptionSource.category))
        .outerjoin(article_count_sub, SubscriptionSource.id == article_count_sub.c.source_id)
    )

    if category_id is not None:
        stmt = stmt.where(SubscriptionSource.category_id == category_id)
    if enabled is not None:
        stmt = stmt.where(SubscriptionSource.enabled.is_(enabled))
    if status is not None and status != "all":
        stmt = stmt.where(SubscriptionSource.last_fetch_status == status)
    if search:
        pattern = f"%{search.strip()}%"
        stmt = stmt.where(
            SubscriptionSource.name.ilike(pattern)
            | SubscriptionSource.website_name.ilike(pattern)
            | SubscriptionSource.url.ilike(pattern)
        )

    stmt = stmt.order_by(SubscriptionSource.sort_order.asc(), SubscriptionSource.id.asc())
    return [(row[0], row[1]) for row in db.execute(stmt).all()]


def get_source(db: Session, source_id: int) -> Optional[SubscriptionSource]:
    return db.scalar(
        select(SubscriptionSource)
        .options(joinedload(SubscriptionSource.category))
        .where(SubscriptionSource.id == source_id)
    )


def get_source_by_url(db: Session, url: str) -> Optional[SubscriptionSource]:
    return db.scalar(select(SubscriptionSource).where(SubscriptionSource.url == url))


def get_source_article_count(db: Session, source_id: int) -> int:
    return db.scalar(
        select(func.count(SubscriptionArticle.id)).where(SubscriptionArticle.source_id == source_id)
    ) or 0


def create_source(db: Session, **kwargs) -> SubscriptionSource:
    if "sort_order" not in kwargs or kwargs["sort_order"] is None:
        max_order = db.scalar(select(func.max(SubscriptionSource.sort_order)))
        kwargs["sort_order"] = (max_order if max_order is not None else -1) + 1
    src = SubscriptionSource(**kwargs)
    db.add(src)
    db.commit()
    db.refresh(src)
    return get_source(db, src.id)  # type: ignore[return-value]


def update_source(db: Session, source: SubscriptionSource, **fields) -> SubscriptionSource:
    for key, val in fields.items():
        if val is not None and hasattr(source, key):
            setattr(source, key, val)
    source.updated_at = utcnow()
    db.commit()
    return get_source(db, source.id)  # type: ignore[return-value]


def delete_source(db: Session, source: SubscriptionSource) -> None:
    db.delete(source)
    db.commit()


def reorder_sources(db: Session, ordered_ids: List[int]) -> None:
    sources = db.scalars(select(SubscriptionSource)).all()
    by_id = {s.id: s for s in sources}
    for idx, sid in enumerate(ordered_ids):
        if sid in by_id:
            by_id[sid].sort_order = idx
    db.commit()


def upsert_articles(db: Session, source_id: int, parsed_articles: List[ParsedArticle]) -> int:
    """
    Insert new articles for source_id, deduplicating by (source_id, guid) first,
    then by (source_id, normalized_url). Returns count of newly inserted rows.
    """
    if not parsed_articles:
        return 0

    existing_rows = db.execute(
        select(SubscriptionArticle.guid, SubscriptionArticle.normalized_url).where(
            SubscriptionArticle.source_id == source_id
        )
    ).all()

    seen_guids = {r[0] for r in existing_rows if r[0]}
    seen_urls = {r[1] for r in existing_rows if r[1]}

    now = utcnow()
    new_count = 0

    for item in parsed_articles:
        if item.guid and item.guid in seen_guids:
            continue
        if item.normalized_url in seen_urls:
            continue

        if item.guid:
            seen_guids.add(item.guid)
        seen_urls.add(item.normalized_url)

        db.add(
            SubscriptionArticle(
                source_id=source_id,
                guid=item.guid,
                normalized_url=item.normalized_url,
                title=item.title,
                description=item.description,
                image_url=item.image_url,
                author=item.author,
                article_url=item.article_url,
                published_at=item.published_at,
                collected_at=now,
            )
        )
        new_count += 1

    if new_count > 0:
        db.commit()
    return new_count


def list_source_articles(
    db: Session,
    source_id: int,
    *,
    limit: int = 50,
    offset: int = 0,
) -> List[SubscriptionArticle]:
    stmt = (
        select(SubscriptionArticle)
        .options(joinedload(SubscriptionArticle.source))
        .where(SubscriptionArticle.source_id == source_id)
        .order_by(SubscriptionArticle.published_at.desc(), SubscriptionArticle.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(db.scalars(stmt).all())


def list_enabled_articles(
    db: Session,
    *,
    limit: int = 50,
    offset: int = 0,
    category_id: Optional[int] = None,
) -> List[SubscriptionArticle]:
    stmt = (
        select(SubscriptionArticle)
        .join(SubscriptionSource, SubscriptionArticle.source_id == SubscriptionSource.id)
        .options(joinedload(SubscriptionArticle.source).joinedload(SubscriptionSource.category))
        .where(SubscriptionSource.enabled.is_(True))
    )
    if category_id is not None:
        stmt = stmt.where(SubscriptionSource.category_id == category_id)

    stmt = (
        stmt.order_by(SubscriptionArticle.published_at.desc(), SubscriptionArticle.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(db.scalars(stmt).all())
