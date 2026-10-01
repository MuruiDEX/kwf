"""Uniform pagination envelope: {items, total, limit, offset}.

Defaults keep UI behavior (limit 100 covers existing screens); hard cap 500
prevents full-table dumps. All pure-list GETs use this shape.
"""
from __future__ import annotations
from fastapi import Query
from sqlalchemy.orm import Query as SAQuery

DEFAULT_LIMIT = 100
MAX_LIMIT = 500


def page_args(
    limit: int = Query(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    offset: int = Query(0, ge=0),
) -> dict:
    return {"limit": limit, "offset": offset}


def paginate(query: SAQuery, limit: int, offset: int) -> tuple[list, int]:
    total = query.count()
    return query.offset(offset).limit(limit).all(), total


def envelope(items: list, total: int, limit: int, offset: int) -> dict:
    return {"items": items, "total": total, "limit": limit, "offset": offset}
