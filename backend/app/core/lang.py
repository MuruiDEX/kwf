"""Bilingual user-facing messages (RU default, KK via Accept-Language: kk)."""
from __future__ import annotations
from fastapi import Request

def pick(request: Request | None, ru: str, kk: str) -> str:
    lang = ""
    if request is not None:
        lang = request.headers.get("Accept-Language", "")
    return kk if lang.lower().startswith("kk") else ru
