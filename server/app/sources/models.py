from datetime import datetime, timezone
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from app.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class SubscriptionCategory(Base):
    __tablename__ = "subscription_category"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False)
    sort_order = Column(Integer, default=0, nullable=False)
    is_default = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    sources = relationship("SubscriptionSource", back_populates="category")


class SubscriptionSource(Base):
    __tablename__ = "subscription_source"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    website_name = Column(String(200), default="", nullable=False)
    url = Column(String(2048), unique=True, nullable=False)
    icon_url = Column(String(2048), nullable=True)
    description = Column(Text, default="", nullable=False)
    feed_type = Column(String(50), default="rss2", nullable=False)
    category_id = Column(Integer, ForeignKey("subscription_category.id"), nullable=False, index=True)
    enabled = Column(Boolean, default=True, nullable=False, index=True)
    sort_order = Column(Integer, default=0, nullable=False, index=True)
    last_fetch_at = Column(DateTime(timezone=True), nullable=True)
    last_fetch_status = Column(String(32), default="pending", nullable=False, index=True)
    last_error = Column(Text, nullable=True)
    last_article_count = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    category = relationship("SubscriptionCategory", back_populates="sources")
    articles = relationship(
        "SubscriptionArticle",
        back_populates="source",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class SubscriptionArticle(Base):
    __tablename__ = "subscription_article"
    __table_args__ = (
        UniqueConstraint("source_id", "guid", name="uq_article_source_guid"),
        UniqueConstraint("source_id", "normalized_url", name="uq_article_source_url"),
        Index("ix_article_source_published", "source_id", "published_at"),
        Index("ix_article_published", "published_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    source_id = Column(
        Integer,
        ForeignKey("subscription_source.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    guid = Column(String(1024), nullable=True)
    normalized_url = Column(String(2048), nullable=False)
    title = Column(String(500), nullable=False)
    description = Column(Text, default="", nullable=False)
    image_url = Column(String(2048), nullable=True)
    author = Column(String(200), nullable=True)
    article_url = Column(String(2048), nullable=False)
    published_at = Column(DateTime(timezone=True), nullable=False)
    collected_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    source = relationship("SubscriptionSource", back_populates="articles")


class SourceSystemConfig(Base):
    __tablename__ = "source_system_config"

    key = Column(String(64), primary_key=True)
    value = Column(String(256), nullable=False)
