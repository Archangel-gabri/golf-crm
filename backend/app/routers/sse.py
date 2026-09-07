"""GET /sse/events — Server-Sent Events stream.

Authenticated endpoint that pushes realtime updates to the browser. Every
mutating booking/customer/membership API call calls `broadcast()` after its
commit; the frontend listens here and invalidates the matching React Query
key, so other people's changes appear without F5.
"""

import anyio
from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from starlette.requests import ClientDisconnect
from starlette.types import Receive, Scope, Send

from ..db import get_db
from ..deps import get_current_user
from ..realtime import event_stream

router = APIRouter(prefix="/sse", tags=["sse"])


class _SSEStreamingResponse(StreamingResponse):
    """Observe idle disconnects independently of ASGI 2.4 send-error behavior."""

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        try:
            async with anyio.create_task_group() as tasks:

                async def stream():
                    try:
                        await self.stream_response(send)
                    except OSError as exc:
                        raise ClientDisconnect() from exc
                    finally:
                        tasks.cancel_scope.cancel()

                tasks.start_soon(stream)
                await self.listen_for_disconnect(receive)
                tasks.cancel_scope.cancel()
        finally:
            # The sibling task has been awaited by the task group. Also close a
            # generator paused at yield/send, not only one cancelled in queue.get.
            close = getattr(self.body_iterator, "aclose", None)
            if close is not None:
                with anyio.CancelScope(shield=True):
                    await close()
        if self.background is not None:
            await self.background()


def _get_sse_user(request: Request, db: Session = Depends(get_db, scope="function")):
    """Authenticate before streaming without holding a DB connection until disconnect."""
    return get_current_user(request, db)


@router.get("/events")
def sse_events(request: Request, user=Depends(_get_sse_user)):
    """Open an SSE connection. Auth via the same JWT cookie as the rest of
    the API (browser sends it automatically because the EventSource opens
    with `credentials: 'include'`).
    """
    headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        # Tell nginx not to buffer the stream.
        "X-Accel-Buffering": "no",
    }
    return _SSEStreamingResponse(
        event_stream(request),
        media_type="text/event-stream",
        headers=headers,
    )
