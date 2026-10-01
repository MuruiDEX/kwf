import asyncio, json
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from app.core.db import get_db
from app.services.live import subscribe, unsubscribe

router = APIRouter(tags=["live"])

@router.get("/api/tournaments/{tid}/live/stream")
async def sse(tid: int):
    q = subscribe(tid)
    async def gen():
        try:
            while True:
                try:
                    ev = await asyncio.wait_for(q.get(), timeout=25)
                    yield f"data: {json.dumps(ev)}\n\n"
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
        finally:
            unsubscribe(tid, q)
    return StreamingResponse(gen(), media_type="text/event-stream")
