import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import List, Optional
from urllib.parse import urljoin, urlparse

import defusedxml.ElementTree as DefusedET
from bs4 import BeautifulSoup
from dateutil import parser as dateutil_parser

from app.sources.validator import normalize_article_url


@dataclass
class ParsedArticle:
    guid: Optional[str]
    normalized_url: str
    title: str
    description: str
    image_url: Optional[str]
    author: Optional[str]
    article_url: str
    published_at: datetime


@dataclass
class ParsedFeed:
    feed_type: str  # rss2 | rss1 | atom | json_feed
    feed_title: str
    website_name: str
    website_title: str
    icon_url: Optional[str]
    description: str
    articles: List[ParsedArticle] = field(default_factory=list)


class FeedParseError(ValueError):
    """Raised when feed content cannot be parsed as RSS/Atom/JSON Feed."""


def sanitize_html_to_text(raw_html: Optional[str], max_len: int = 500) -> str:
    """Strip scripts, iframes, and HTML tags safely to produce clean summary text."""
    if not raw_html:
        return ""
    soup = BeautifulSoup(raw_html, "html.parser")
    for tag in soup(["script", "style", "iframe", "object", "embed", "noscript"]):
        tag.decompose()
    text = soup.get_text(" ", strip=True)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > max_len:
        return text[: max_len - 1].rstrip() + "…"
    return text


def extract_first_image_from_html(raw_html: Optional[str], base_url: str = "") -> Optional[str]:
    if not raw_html:
        return None
    soup = BeautifulSoup(raw_html, "html.parser")
    img = soup.find("img")
    if img and img.get("src"):
        src = img["src"].strip()
        if src.startswith("javascript:") or src.startswith("data:"):
            return None
        return urljoin(base_url, src) if base_url else src
    return None


def safe_url(raw_url: Optional[str], base_url: str = "") -> Optional[str]:
    if not raw_url:
        return None
    val = raw_url.strip()
    if not val:
        return None
    if val.lower().startswith(("javascript:", "data:", "vbscript:")):
        return None
    resolved = urljoin(base_url, val) if base_url else val
    parsed = urlparse(resolved)
    if parsed.scheme.lower() in ("http", "https"):
        return resolved
    return None


def parse_datetime(value: Optional[str]) -> datetime:
    if not value or not value.strip():
        return datetime.now(timezone.utc)
    text = value.strip()
    try:
        dt = parsedate_to_datetime(text)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        pass
    try:
        dt = dateutil_parser.parse(text)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return datetime.now(timezone.utc)


def _local_name(tag: str) -> str:
    if "}" in tag:
        return tag.split("}", 1)[1].lower()
    return tag.lower()


def _child_text(elem, *names: str) -> Optional[str]:
    target = {n.lower() for n in names}
    for child in elem:
        if _local_name(child.tag) in target:
            if child.text and child.text.strip():
                return child.text.strip()
    return None


def _derive_website_name(site_url: str, fallback_title: str) -> str:
    if site_url:
        host = urlparse(site_url).hostname or ""
        if host.startswith("www."):
            host = host[4:]
        if host:
            return host
    return fallback_title


def _default_favicon(site_url: str) -> Optional[str]:
    if not site_url:
        return None
    parsed = urlparse(site_url)
    if parsed.scheme in ("http", "https") and parsed.netloc:
        return f"{parsed.scheme}://{parsed.netloc}/favicon.ico"
    return None


def _parse_json_feed(data: dict, source_url: str) -> ParsedFeed:
    version = str(data.get("version", ""))
    if "jsonfeed.org" not in version and "items" not in data:
        raise FeedParseError("不是有效的 JSON Feed 格式")

    feed_title = (data.get("title") or "").strip() or "未命名订阅源"
    home_url = safe_url(data.get("home_page_url"), source_url) or source_url
    icon_url = safe_url(data.get("icon") or data.get("favicon"), home_url) or _default_favicon(home_url)
    description = sanitize_html_to_text(data.get("description") or "")
    website_name = _derive_website_name(home_url, feed_title)

    articles: List[ParsedArticle] = []
    for item in data.get("items") or []:
        if not isinstance(item, dict):
            continue
        raw_url = item.get("url") or item.get("external_url") or ""
        article_url = safe_url(raw_url, home_url)
        if not article_url:
            continue
        norm_url = normalize_article_url(article_url, home_url)
        if not norm_url:
            continue

        title = (item.get("title") or "").strip() or sanitize_html_to_text(item.get("summary") or item.get("content_text") or "", 80) or article_url
        raw_desc = item.get("summary") or item.get("content_text") or item.get("content_html") or ""
        desc = sanitize_html_to_text(raw_desc)
        image_url = safe_url(item.get("image") or item.get("banner_image"), home_url) or extract_first_image_from_html(item.get("content_html"), home_url)

        author = None
        authors = item.get("authors")
        if isinstance(authors, list) and authors:
            first = authors[0]
            if isinstance(first, dict):
                author = (first.get("name") or "").strip() or None
        elif isinstance(item.get("author"), dict):
            author = (item["author"].get("name") or "").strip() or None

        guid = str(item["id"]).strip() if item.get("id") is not None else None
        if guid == "":
            guid = None

        published_at = parse_datetime(item.get("date_published") or item.get("date_modified"))
        articles.append(
            ParsedArticle(
                guid=guid,
                normalized_url=norm_url,
                title=title[:500],
                description=desc,
                image_url=image_url,
                author=author[:200] if author else None,
                article_url=article_url,
                published_at=published_at,
            )
        )

    return ParsedFeed(
        feed_type="json_feed",
        feed_title=feed_title,
        website_name=website_name,
        website_title=feed_title,
        icon_url=icon_url,
        description=description,
        articles=articles,
    )


def _parse_atom(root, source_url: str) -> ParsedFeed:
    feed_title = _child_text(root, "title") or "未命名 Atom 订阅"
    description = sanitize_html_to_text(_child_text(root, "subtitle") or "")

    home_url = source_url
    icon_url = None
    for child in root:
        lname = _local_name(child.tag)
        if lname == "link":
            rel = (child.attrib.get("rel") or "alternate").lower()
            href = safe_url(child.attrib.get("href"), source_url)
            if rel == "alternate" and href:
                home_url = href
        elif lname in ("icon", "logo") and child.text:
            icon_url = safe_url(child.text, source_url) or icon_url

    if not icon_url:
        icon_url = _default_favicon(home_url)

    website_name = _derive_website_name(home_url, feed_title)
    articles: List[ParsedArticle] = []

    for child in root:
        if _local_name(child.tag) != "entry":
            continue

        entry_link = None
        enclosure_img = None
        for sub in child:
            if _local_name(sub.tag) == "link":
                rel = (sub.attrib.get("rel") or "alternate").lower()
                href = safe_url(sub.attrib.get("href"), home_url)
                mime = (sub.attrib.get("type") or "").lower()
                if rel == "alternate" and href and not entry_link:
                    entry_link = href
                elif rel == "enclosure" and href and mime.startswith("image/") and not enclosure_img:
                    enclosure_img = href
                elif not entry_link and href and rel != "self":
                    entry_link = href

        if not entry_link:
            continue
        norm_url = normalize_article_url(entry_link, home_url)
        if not norm_url:
            continue

        title = sanitize_html_to_text(_child_text(child, "title") or "", 500) or entry_link
        raw_content = _child_text(child, "summary", "content") or ""
        desc = sanitize_html_to_text(raw_content)
        image_url = enclosure_img or extract_first_image_from_html(raw_content, home_url)

        author = None
        for sub in child:
            if _local_name(sub.tag) == "author":
                author = _child_text(sub, "name")
                if author:
                    break

        guid = _child_text(child, "id")
        published_at = parse_datetime(_child_text(child, "published", "updated"))

        articles.append(
            ParsedArticle(
                guid=guid[:1024] if guid else None,
                normalized_url=norm_url,
                title=title,
                description=desc,
                image_url=image_url,
                author=author[:200] if author else None,
                article_url=entry_link,
                published_at=published_at,
            )
        )

    return ParsedFeed(
        feed_type="atom",
        feed_title=feed_title,
        website_name=website_name,
        website_title=feed_title,
        icon_url=icon_url,
        description=description,
        articles=articles,
    )


def _parse_rss(root, source_url: str, feed_type: str) -> ParsedFeed:
    channel = None
    for child in root:
        if _local_name(child.tag) == "channel":
            channel = child
            break

    if channel is None:
        raise FeedParseError("RSS 缺少 channel 节点")

    feed_title = _child_text(channel, "title") or "未命名 RSS 订阅"
    home_url = safe_url(_child_text(channel, "link"), source_url) or source_url
    description = sanitize_html_to_text(_child_text(channel, "description") or "")

    icon_url = None
    for child in channel:
        if _local_name(child.tag) == "image":
            icon_url = safe_url(_child_text(child, "url"), home_url)
            if icon_url:
                break
    if not icon_url:
        icon_url = _default_favicon(home_url)

    website_name = _derive_website_name(home_url, feed_title)

    # RSS 1.0 (RDF) places <item> directly under <rdf:RDF>, RSS 2.0 places <item> under <channel>
    items = [c for c in channel if _local_name(c.tag) == "item"]
    if not items and feed_type == "rss1":
        items = [c for c in root if _local_name(c.tag) == "item"]

    articles: List[ParsedArticle] = []
    for item in items:
        raw_link = _child_text(item, "link")
        article_url = safe_url(raw_link, home_url)
        if not article_url:
            continue
        norm_url = normalize_article_url(article_url, home_url)
        if not norm_url:
            continue

        title = sanitize_html_to_text(_child_text(item, "title") or "", 500) or article_url
        raw_desc = _child_text(item, "encoded", "description") or ""
        desc = sanitize_html_to_text(raw_desc)

        image_url = None
        for sub in item:
            lname = _local_name(sub.tag)
            if lname == "enclosure":
                mime = (sub.attrib.get("type") or "").lower()
                if mime.startswith("image/"):
                    image_url = safe_url(sub.attrib.get("url"), home_url)
                    if image_url:
                        break
            elif lname in ("thumbnail", "content"):
                medium = (sub.attrib.get("medium") or "").lower()
                mime = (sub.attrib.get("type") or "").lower()
                if medium == "image" or mime.startswith("image/") or lname == "thumbnail":
                    image_url = safe_url(sub.attrib.get("url"), home_url)
                    if image_url:
                        break
        if not image_url:
            image_url = extract_first_image_from_html(raw_desc, home_url)

        author = _child_text(item, "creator", "author")
        guid = _child_text(item, "guid") or item.attrib.get("{http://www.w3.org/1999/02/22-rdf-syntax-ns#}about")
        published_at = parse_datetime(_child_text(item, "pubdate", "date", "published", "updated"))

        articles.append(
            ParsedArticle(
                guid=guid[:1024] if guid else None,
                normalized_url=norm_url,
                title=title,
                description=desc,
                image_url=image_url,
                author=author[:200] if author else None,
                article_url=article_url,
                published_at=published_at,
            )
        )

    return ParsedFeed(
        feed_type=feed_type,
        feed_title=feed_title,
        website_name=website_name,
        website_title=feed_title,
        icon_url=icon_url,
        description=description,
        articles=articles,
    )


def parse_feed_content(content: bytes, source_url: str, content_type: str = "") -> ParsedFeed:
    """
    Parse RSS 2.0, RSS 1.0 (RDF), Atom, or JSON Feed safely (XXE-protected via defusedxml).
    """
    if not content or not content.strip():
        raise FeedParseError("订阅源返回内容为空")

    stripped = content.lstrip()
    if stripped.startswith(b"{") or "json" in content_type.lower():
        try:
            data = json.loads(content.decode("utf-8", errors="replace"))
            if isinstance(data, dict):
                return _parse_json_feed(data, source_url)
        except FeedParseError:
            raise
        except Exception as exc:
            if stripped.startswith(b"{"):
                raise FeedParseError(f"JSON Feed 解析失败: {exc}") from exc

    try:
        root = DefusedET.fromstring(content)
    except Exception as exc:
        raise FeedParseError(f"XML/订阅内容解析失败: {exc}") from exc

    root_name = _local_name(root.tag)
    if root_name == "rss":
        return _parse_rss(root, source_url, "rss2")
    if root_name == "rdf":
        return _parse_rss(root, source_url, "rss1")
    if root_name == "feed":
        return _parse_atom(root, source_url)

    raise FeedParseError(f"不支持的订阅源格式: <{root_name}>")
