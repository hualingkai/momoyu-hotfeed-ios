import asyncio
from datetime import timedelta
from typing import Optional

import httpx
from sqlalchemy.orm import Session

from app.sources import repository
from app.sources.models import SubscriptionSource, utcnow
from app.sources.parser import FeedParseError, ParsedFeed, parse_feed_content
from app.sources.schemas import SourceCreate, SourceRefreshResult, SourceValidateResponse
from app.sources.validator import FetchError, SSRFError, safe_fetch_url

MANUAL_REFRESH_COOLDOWN_SECONDS = 10
MAX_FETCH_RETRIES = 2


class RateLimitError(RuntimeError):
    """Raised when manual refresh is triggered too frequently."""


async def fetch_and_parse_feed(
    url: str,
    *,
    retries: int = MAX_FETCH_RETRIES,
    transport: Optional[httpx.AsyncBaseTransport] = None,
    skip_ssrf_check: bool = False,
) -> ParsedFeed:
    last_exc: Optional[Exception] = None
    for attempt in range(retries + 1):
        try:
            content, final_url, content_type = await safe_fetch_url(
                url,
                transport=transport,
                skip_ssrf_check=skip_ssrf_check,
            )
            return parse_feed_content(content, final_url, content_type)
        except (SSRFError, FeedParseError):
            raise
        except FetchError as exc:
            last_exc = exc
            if attempt < retries:
                await asyncio.sleep(0.5 * (attempt + 1))
    assert last_exc is not None
    raise last_exc


async def validate_feed_url(
    url: str,
    *,
    transport: Optional[httpx.AsyncBaseTransport] = None,
    skip_ssrf_check: bool = False,
) -> SourceValidateResponse:
    try:
        parsed = await fetch_and_parse_feed(
            url,
            retries=1,
            transport=transport,
            skip_ssrf_check=skip_ssrf_check,
        )
        return SourceValidateResponse(
            valid=True,
            url=url.strip(),
            website_name=parsed.website_name,
            website_title=parsed.website_title,
            icon_url=parsed.icon_url,
            feed_type=parsed.feed_type,
            description=parsed.description,
            feed_title=parsed.feed_title,
            article_count_preview=len(parsed.articles),
        )
    except (SSRFError, FetchError, FeedParseError) as exc:
        return SourceValidateResponse(
            valid=False,
            url=url.strip(),
            error=str(exc),
        )


async def create_source_from_payload(
    db: Session,
    payload: SourceCreate,
    *,
    transport: Optional[httpx.AsyncBaseTransport] = None,
    skip_ssrf_check: bool = False,
) -> SubscriptionSource:
    url = payload.url.strip()
    existing = repository.get_source_by_url(db, url)
    if existing:
        raise ValueError("该订阅源 URL 已存在")

    category = repository.get_category(db, payload.category_id)
    if not category:
        raise ValueError("指定的分类不存在")

    parsed = await fetch_and_parse_feed(
        url,
        retries=1,
        transport=transport,
        skip_ssrf_check=skip_ssrf_check,
    )

    now = utcnow()
    src = repository.create_source(
        db,
        name=(payload.name or "").strip() or parsed.feed_title,
        website_name=(payload.website_name or "").strip() or parsed.website_name,
        url=url,
        icon_url=payload.icon_url if payload.icon_url is not None else parsed.icon_url,
        description=payload.description if payload.description is not None else parsed.description,
        feed_type=(payload.feed_type or "").strip() or parsed.feed_type,
        category_id=payload.category_id,
        enabled=payload.enabled,
        last_fetch_at=now,
        last_fetch_status="success",
        last_error=None,
        last_article_count=len(parsed.articles),
    )

    repository.upsert_articles(db, src.id, parsed.articles)
    return src


async def refresh_source(
    db: Session,
    source: SubscriptionSource,
    *,
    enforce_cooldown: bool = True,
    transport: Optional[httpx.AsyncBaseTransport] = None,
    skip_ssrf_check: bool = False,
) -> SourceRefreshResult:
    now = utcnow()
    if enforce_cooldown and source.last_fetch_at is not None:
        last_at = source.last_fetch_at
        if last_at.tzinfo is None:
            from datetime import timezone
            last_at = last_at.replace(tzinfo=timezone.utc)
        if now - last_at < timedelta(seconds=MANUAL_REFRESH_COOLDOWN_SECONDS):
            raise RateLimitError(f"刷新过于频繁，请 {MANUAL_REFRESH_COOLDOWN_SECONDS} 秒后再试")

    try:
        parsed = await fetch_and_parse_feed(
            source.url,
            retries=MAX_FETCH_RETRIES,
            transport=transport,
            skip_ssrf_check=skip_ssrf_check,
        )
        new_count = repository.upsert_articles(db, source.id, parsed.articles)
        repository.update_source(
            db,
            source,
            last_fetch_at=utcnow(),
            last_fetch_status="success",
            last_error="",
            last_article_count=len(parsed.articles),
            feed_type=parsed.feed_type,
            icon_url=source.icon_url or parsed.icon_url,
        )
        return SourceRefreshResult(
            source_id=source.id,
            status="success",
            fetched_count=len(parsed.articles),
            new_count=new_count,
        )
    except (SSRFError, FetchError, FeedParseError) as exc:
        # Preserve historical articles on failure!
        repository.update_source(
            db,
            source,
            last_fetch_at=utcnow(),
            last_fetch_status="failed",
            last_error=str(exc),
        )
        return SourceRefreshResult(
            source_id=source.id,
            status="failed",
            fetched_count=0,
            new_count=0,
            error=str(exc),
        )


async def refresh_all_enabled_sources(
    db: Session,
    *,
    transport: Optional[httpx.AsyncBaseTransport] = None,
    skip_ssrf_check: bool = False,
) -> list[SourceRefreshResult]:
    sources = [s for s, _ in repository.list_sources(db, enabled=True)]
    results: list[SourceRefreshResult] = []
    for src in sources:
        try:
            res = await refresh_source(
                db,
                src,
                enforce_cooldown=False,
                transport=transport,
                skip_ssrf_check=skip_ssrf_check,
            )
            results.append(res)
        except Exception as exc:
            # Isolate failures per source
            results.append(
                SourceRefreshResult(
                    source_id=src.id,
                    status="failed",
                    fetched_count=0,
                    new_count=0,
                    error=str(exc),
                )
            )
    return results
