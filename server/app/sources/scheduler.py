import asyncio
import logging
from datetime import timedelta, timezone
from typing import Optional

from app.database import SessionLocal
from app.sources import repository, service
from app.sources.models import utcnow

logger = logging.getLogger(__name__)


class SourceScheduler:
    """Unified backend scheduler that refreshes enabled subscription sources on schedule."""

    def __init__(self, tick_seconds: int = 30):
        self.tick_seconds = tick_seconds
        self._task: Optional[asyncio.Task] = None
        self._stop_event = asyncio.Event()

    def start(self) -> None:
        if self._task is not None and not self._task.done():
            return
        self._stop_event.clear()
        self._task = asyncio.create_task(self._run_loop(), name="source-scheduler")

    async def stop(self) -> None:
        self._stop_event.set()
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    async def _run_loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                await self.run_due_sources()
            except Exception as exc:
                logger.exception("Scheduler tick failed: %s", exc)
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=self.tick_seconds)
            except asyncio.TimeoutError:
                continue

    async def run_due_sources(self) -> None:
        db = SessionLocal()
        try:
            interval = repository.get_refresh_interval(db)
            now = utcnow()
            sources = [s for s, _ in repository.list_sources(db, enabled=True)]
            for src in sources:
                if src.last_fetch_at is not None:
                    last_at = src.last_fetch_at
                    if last_at.tzinfo is None:
                        last_at = last_at.replace(tzinfo=timezone.utc)
                    if now - last_at < timedelta(seconds=interval):
                        continue
                try:
                    await service.refresh_source(db, src, enforce_cooldown=False)
                except Exception as exc:
                    logger.warning("Scheduled refresh failed for source %s: %s", src.id, exc)
        finally:
            db.close()


scheduler = SourceScheduler()
