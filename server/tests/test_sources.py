import json
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app
from app.sources import repository, service
from app.sources.parser import parse_feed_content
from app.sources.scheduler import SourceScheduler
from app.sources.validator import SSRFError, normalize_article_url, safe_fetch_url, validate_url_security

RSS2_XML = b"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Tech Daily RSS</title>
    <link>https://example.com</link>
    <description>Daily tech news &lt;script&gt;alert(1)&lt;/script&gt;</description>
    <image><url>https://example.com/logo.png</url></image>
    <item>
      <title>First RSS Article</title>
      <link>https://example.com/posts/1?utm_source=rss</link>
      <guid>guid-1</guid>
      <pubDate>Tue, 24 Nov 2026 10:00:00 GMT</pubDate>
      <description>&lt;p&gt;Hello RSS&lt;/p&gt;&lt;script&gt;evil()&lt;/script&gt;&lt;img src="https://example.com/cover1.jpg"/&gt;</description>
      <author>Alice</author>
    </item>
    <item>
      <title>Duplicate By GUID</title>
      <link>https://example.com/posts/1-dup</link>
      <guid>guid-1</guid>
      <pubDate>Tue, 24 Nov 2026 10:05:00 GMT</pubDate>
      <description>Should be deduplicated by guid</description>
    </item>
  </channel>
</rss>
"""

RSS1_XML = b"""<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/">
  <channel rdf:about="https://rss1.example.com/">
    <title>RSS 1.0 Feed</title>
    <link>https://rss1.example.com</link>
    <description>RDF feed</description>
  </channel>
  <item rdf:about="https://rss1.example.com/item1">
    <title>RDF Item 1</title>
    <link>https://rss1.example.com/item1</link>
    <description>RDF desc</description>
  </item>
</rdf:RDF>
"""

ATOM_XML = b"""<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Dev Blog</title>
  <subtitle>Engineering notes</subtitle>
  <link href="https://atom.example.com/" rel="alternate"/>
  <icon>https://atom.example.com/icon.png</icon>
  <entry>
    <title>Atom Entry 1</title>
    <link href="https://atom.example.com/a1" rel="alternate"/>
    <id>urn:uuid:atom-1</id>
    <updated>2026-11-25T02:00:00Z</updated>
    <author><name>Bob</name></author>
    <summary>Atom summary</summary>
  </entry>
</feed>
"""

JSON_FEED = json.dumps({
    "version": "https://jsonfeed.org/version/1.1",
    "title": "JSON Feed Weekly",
    "home_page_url": "https://json.example.com",
    "icon": "https://json.example.com/icon.png",
    "description": "Curated JSON feed",
    "items": [
        {
            "id": "jf-1",
            "url": "https://json.example.com/articles/1",
            "title": "JSON Article 1",
            "content_text": "JSON feed body",
            "image": "https://json.example.com/img1.png",
            "date_published": "2026-11-25T03:00:00Z",
            "authors": [{"name": "Carol"}],
        }
    ],
}).encode("utf-8")


@pytest.fixture()
def db_session(tmp_path: Path):
    db_file = tmp_path / "test.db"
    engine = create_engine(f"sqlite:///{db_file.as_posix()}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = TestingSessionLocal()
    repository.ensure_default_categories(db)
    yield db
    db.close()


@pytest.fixture()
def client(db_session):
    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def _mock_transport(routes: dict[str, tuple[int, bytes, dict]]):
    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if url in routes:
            code, body, headers = routes[url]
            return httpx.Response(code, content=body, headers=headers)
        return httpx.Response(404, content=b"Not found")

    return httpx.MockTransport(handler)


def test_ssrf_and_xxe_security():
    with pytest.raises(SSRFError):
        validate_url_security("http://localhost/feed.xml")
    with pytest.raises(SSRFError):
        validate_url_security("http://127.0.0.1:8000/feed.xml")
    with pytest.raises(SSRFError):
        validate_url_security("http://169.254.169.254/latest/meta-data/")
    with pytest.raises(SSRFError):
        validate_url_security("http://10.0.0.1/internal.xml")
    with pytest.raises(SSRFError):
        validate_url_security("file:///etc/passwd")

    # XXE must be blocked by defusedxml
    xxe_payload = b"""<?xml version="1.0"?>
    <!DOCTYPE foo [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
    <rss version="2.0"><channel><title>&xxe;</title></channel></rss>"""
    with pytest.raises(Exception):
        parse_feed_content(xxe_payload, "https://example.com/feed.xml")


@pytest.mark.asyncio
async def test_redirect_ssrf_blocked():
    transport = _mock_transport({
        "https://public.example.com/redirect": (
            302,
            b"",
            {"location": "http://127.0.0.1/secret"},
        )
    })
    with patch("app.sources.validator.resolve_and_validate_host") as mock_dns:
        def side_effect(host, _port):
            if host in ("127.0.0.1", "localhost"):
                raise SSRFError("blocked")
        mock_dns.side_effect = side_effect
        with pytest.raises(SSRFError):
            await safe_fetch_url("https://public.example.com/redirect", transport=transport)


def test_parse_all_formats_and_sanitize():
    rss2 = parse_feed_content(RSS2_XML, "https://example.com/rss.xml")
    assert rss2.feed_type == "rss2"
    assert "<script>" not in rss2.description
    assert rss2.articles[0].image_url == "https://example.com/cover1.jpg"
    assert "<script>" not in rss2.articles[0].description

    rss1 = parse_feed_content(RSS1_XML, "https://rss1.example.com/rss1.xml")
    assert rss1.feed_type == "rss1"
    assert len(rss1.articles) == 1

    atom = parse_feed_content(ATOM_XML, "https://atom.example.com/atom.xml")
    assert atom.feed_type == "atom"
    assert atom.articles[0].author == "Bob"

    jf = parse_feed_content(JSON_FEED, "https://json.example.com/feed.json")
    assert jf.feed_type == "json_feed"
    assert jf.articles[0].author == "Carol"


def test_full_source_lifecycle_and_feed_integration(client, db_session):
    routes = {
        "https://rss.example.com/feed.xml": (200, RSS2_XML, {"content-type": "application/rss+xml"}),
        "https://atom.example.com/atom.xml": (200, ATOM_XML, {"content-type": "application/atom+xml"}),
        "https://json.example.com/feed.json": (200, JSON_FEED, {"content-type": "application/feed+json"}),
        "https://bad.example.com/404.xml": (404, b"not found", {"content-type": "text/plain"}),
    }
    transport = _mock_transport(routes)

    async def fake_safe_fetch(url, **kwargs):
        return await safe_fetch_url(url, transport=transport, skip_ssrf_check=True)

    with patch("app.sources.service.safe_fetch_url", side_effect=fake_safe_fetch), \
         patch("app.sources.router.validate_url_security", side_effect=lambda u: u):
        cats = client.get("/api/v1/source-categories").json()
        assert len(cats) == 9
        cat_id = cats[0]["id"]

        # 1-3: Add RSS, Atom, JSON Feed
        r1 = client.post("/api/v1/sources", json={"url": "https://rss.example.com/feed.xml", "category_id": cat_id})
        assert r1.status_code == 201, r1.text
        rss_src = r1.json()
        assert rss_src["feed_type"] == "rss2"
        # Duplicate GUID in RSS2_XML should be deduped -> only 1 article stored!
        assert rss_src["total_article_count"] == 1

        r2 = client.post("/api/v1/sources", json={"url": "https://atom.example.com/atom.xml", "category_id": cat_id})
        assert r2.status_code == 201
        atom_src = r2.json()
        assert atom_src["feed_type"] == "atom"

        r3 = client.post("/api/v1/sources", json={"url": "https://json.example.com/feed.json", "category_id": cat_id})
        assert r3.status_code == 201
        json_src = r3.json()
        assert json_src["feed_type"] == "json_feed"

        # 4: Invalid URL
        bad = client.post("/api/v1/sources", json={"url": "https://bad.example.com/404.xml", "category_id": cat_id})
        assert bad.status_code == 400

        # 5: Edit source
        upd = client.put(f"/api/v1/sources/{rss_src['id']}", json={"name": "Renamed Tech RSS"})
        assert upd.status_code == 200
        assert upd.json()["name"] == "Renamed Tech RSS"

        # 7 & 8: Disable stops collection & hides from subscription feed, enable restores
        off = client.patch(f"/api/v1/sources/{atom_src['id']}/status", json={"enabled": False})
        assert off.status_code == 200
        assert off.json()["enabled"] is False

        feed_sub = client.get("/api/v1/feed?tab=subscription").json()
        assert all(item["source_name"] != atom_src["name"] for item in feed_sub)

        on = client.patch(f"/api/v1/sources/{atom_src['id']}/status", json={"enabled": True})
        assert on.status_code == 200
        feed_sub2 = client.get("/api/v1/feed?tab=subscription").json()
        assert any(item["source_name"] == atom_src["name"] for item in feed_sub2)

        # 10 & 11: Failure preserves historical articles; dedup by normalized URL
        routes["https://rss.example.com/feed.xml"] = (500, b"server error", {})
        # Bypass cooldown by clearing last_fetch_at
        src_obj = repository.get_source(db_session, rss_src["id"])
        src_obj.last_fetch_at = datetime(2020, 1, 1, tzinfo=timezone.utc)
        db_session.commit()

        ref_fail = client.post(f"/api/v1/sources/{rss_src['id']}/refresh")
        assert ref_fail.status_code == 200
        assert ref_fail.json()["status"] == "failed"
        arts_after_fail = client.get(f"/api/v1/sources/{rss_src['id']}/articles").json()
        assert len(arts_after_fail) == 1  # Historical article preserved!

        # 12: Multiple sources concurrent/isolated run
        routes["https://rss.example.com/feed.xml"] = (500, b"still failing", {})
        # Atom succeeds while RSS fails
        res_all = client.post(
            "/api/v1/sources/batch",
            json={"source_ids": [rss_src["id"], atom_src["id"]], "action": "refresh"},
        )
        assert res_all.status_code == 200
        assert len(res_all.json()["errors"]) == 1

        # 13: Integrated feed 'all' has both hot and subscription items clearly tagged
        feed_all = client.get("/api/v1/feed?tab=all").json()
        assert any(i["item_type"] == "hot" for i in feed_all)
        assert any(i["item_type"] == "subscription" for i in feed_all)

        # Category delete reassigns sources without losing them
        new_cat = client.post("/api/v1/source-categories", json={"name": "临时分类"}).json()
        client.put(f"/api/v1/sources/{json_src['id']}", json={"category_id": new_cat["id"]})
        del_cat = client.delete(f"/api/v1/source-categories/{new_cat['id']}")
        assert del_cat.status_code == 200
        assert del_cat.json()["reassigned_sources"] == 1
        assert client.get(f"/api/v1/sources/{json_src['id']}").status_code == 200

        # 6: Delete source
        del_res = client.delete(f"/api/v1/sources/{json_src['id']}")
        assert del_res.status_code == 204
        assert client.get(f"/api/v1/sources/{json_src['id']}").status_code == 404


def test_normalize_url_dedup():
    u1 = normalize_article_url("https://Example.COM/post/123/?utm_source=twitter&b=2&a=1#comments")
    u2 = normalize_article_url("https://example.com/post/123?a=1&b=2")
    assert u1 == u2
