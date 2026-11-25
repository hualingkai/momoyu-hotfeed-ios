import ipaddress
import socket
from typing import Iterable, Optional, Tuple
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse

import httpx

MAX_RESPONSE_BYTES = 5 * 1024 * 1024  # 5 MB
MAX_REDIRECTS = 5
CONNECT_TIMEOUT = 10.0
READ_TIMEOUT = 15.0

BLOCKED_HOSTNAMES = {
    "localhost",
    "localhost.localdomain",
    "ip6-localhost",
    "ip6-loopback",
    "metadata.google.internal",
    "metadata",
}

CLOUD_METADATA_IPS = {
    "169.254.169.254",
    "100.100.100.200",
    "169.254.170.2",
    "fd00:ec2::254",
}

TRACKING_QUERY_PARAMS = {
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "fbclid",
    "gclid",
    "spm",
    "from",
}


class SSRFError(ValueError):
    """Raised when a URL fails SSRF security validation."""


class FetchError(RuntimeError):
    """Raised when fetching a remote feed fails."""


def is_ip_blocked(ip_str: str) -> bool:
    """Return True if an IP address is private, loopback, link-local, reserved, or metadata."""
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return True

    if ip_str in CLOUD_METADATA_IPS:
        return True

    # Handle IPv4-mapped IPv6 addresses like ::ffff:127.0.0.1
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped

    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
        or not ip.is_global
    )


def resolve_and_validate_host(hostname: str, port: int) -> None:
    """Resolve DNS for hostname and ensure every returned IP is public and safe."""
    if not hostname:
        raise SSRFError("URL 缺少主机名")

    lowered = hostname.strip().lower().rstrip(".")
    if lowered in BLOCKED_HOSTNAMES or lowered.endswith(".localhost") or lowered.endswith(".local"):
        raise SSRFError(f"禁止访问本地或内网主机: {hostname}")

    # Direct IP literal check
    try:
        ipaddress.ip_address(lowered)
        if is_ip_blocked(lowered):
            raise SSRFError(f"禁止访问内网或保留 IP 地址: {hostname}")
        return
    except ValueError:
        pass

    try:
        addr_infos = socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise SSRFError(f"域名解析失败 ({hostname}): {exc}") from exc

    if not addr_infos:
        raise SSRFError(f"域名无法解析到有效 IP: {hostname}")

    for info in addr_infos:
        sockaddr = info[4]
        ip_str = sockaddr[0].split("%")[0]
        if is_ip_blocked(ip_str):
            raise SSRFError(f"目标域名解析到受限内网/保留 IP ({ip_str})，已拦截")


def validate_url_security(url: str) -> str:
    """Validate URL scheme, structure, and resolved DNS IP against SSRF."""
    raw = (url or "").strip()
    if not raw:
        raise SSRFError("订阅源 URL 不能为空")

    parsed = urlparse(raw)
    scheme = parsed.scheme.lower()
    if scheme not in ("http", "https"):
        raise SSRFError("仅支持 HTTP 和 HTTPS 协议")

    if not parsed.netloc or not parsed.hostname:
        raise SSRFError("无效的 URL 格式")

    if parsed.username or parsed.password:
        raise SSRFError("不允许在 URL 中包含用户名或密码")

    port = parsed.port or (443 if scheme == "https" else 80)
    resolve_and_validate_host(parsed.hostname, port)
    return raw


def normalize_article_url(url: str, base_url: str = "") -> str:
    """Normalize an article URL for deduplication (strip fragment, tracking params, trailing slash)."""
    raw = (url or "").strip()
    if not raw:
        return ""
    if base_url and not raw.startswith(("http://", "https://")):
        raw = urljoin(base_url, raw)

    parsed = urlparse(raw)
    if parsed.scheme.lower() not in ("http", "https"):
        return ""

    query_pairs = [
        (k, v)
        for k, v in parse_qsl(parsed.query, keep_blank_values=False)
        if k.lower() not in TRACKING_QUERY_PARAMS
    ]
    query_pairs.sort()
    path = parsed.path.rstrip("/") or "/"
    normalized = urlunparse((
        parsed.scheme.lower(),
        parsed.netloc.lower(),
        path,
        "",
        urlencode(query_pairs),
        "",
    ))
    return normalized


async def safe_fetch_url(
    url: str,
    *,
    max_bytes: int = MAX_RESPONSE_BYTES,
    max_redirects: int = MAX_REDIRECTS,
    transport: Optional[httpx.AsyncBaseTransport] = None,
    skip_ssrf_check: bool = False,
) -> Tuple[bytes, str, str]:
    """
    Safely fetch a URL with SSRF validation on initial URL and every redirect hop,
    enforcing timeouts and response size limits.
    Returns (content_bytes, final_url, content_type).
    """
    current_url = url.strip()
    if not skip_ssrf_check:
        current_url = validate_url_security(current_url)

    timeout = httpx.Timeout(connect=CONNECT_TIMEOUT, read=READ_TIMEOUT, write=10.0, pool=10.0)
    headers = {
        "User-Agent": "AntigravityRSSReader/1.0 (+https://pro.momoyu.cc)",
        "Accept": "application/rss+xml, application/atom+xml, application/feed+json, application/json, application/xml, text/xml;q=0.9, */*;q=0.8",
    }

    async with httpx.AsyncClient(
        timeout=timeout,
        follow_redirects=False,
        transport=transport,
        headers=headers,
    ) as client:
        for _ in range(max_redirects + 1):
            try:
                async with client.stream("GET", current_url) as resp:
                    if resp.status_code in (301, 302, 303, 307, 308):
                        location = resp.headers.get("location")
                        if not location:
                            raise FetchError("重定向响应缺少 Location 头")
                        next_url = urljoin(current_url, location)
                        if not skip_ssrf_check:
                            validate_url_security(next_url)
                        current_url = next_url
                        continue

                    if resp.status_code >= 400:
                        raise FetchError(f"HTTP 请求失败，状态码: {resp.status_code}")

                    content_length = resp.headers.get("content-length")
                    if content_length and content_length.isdigit() and int(content_length) > max_bytes:
                        raise FetchError(f"响应体积超过限制 ({max_bytes // (1024 * 1024)}MB)")

                    chunks: Iterable[bytes] = resp.aiter_bytes()
                    buf = bytearray()
                    async for chunk in chunks:
                        buf.extend(chunk)
                        if len(buf) > max_bytes:
                            raise FetchError(f"响应体积超过限制 ({max_bytes // (1024 * 1024)}MB)")

                    content_type = resp.headers.get("content-type", "")
                    return bytes(buf), current_url, content_type
            except SSRFError:
                raise
            except FetchError:
                raise
            except httpx.TimeoutException as exc:
                raise FetchError("请求订阅源超时") from exc
            except httpx.HTTPError as exc:
                raise FetchError(f"网络请求异常: {exc}") from exc

    raise FetchError(f"重定向次数超过上限 ({max_redirects})")
