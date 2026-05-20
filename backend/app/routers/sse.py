"""GET /sse/events — Server-Sent Events stream.

Authenticated endpoint that pushes realtime updates to the browser. Every
mutating booking/customer/membership API call calls `broadcast()` after its
commit; the frontend listens here and invalidates the matching React Query
key, so other people's changes appear without F5.
"""
from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from ..deps import get_current_user
from ..realtime import event_stream

router = APIRouter(prefix="/sse", tags=["sse"])


@router.get("/events")
def sse_events(request: Request, user=Depends(get_current_user)):
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
    return StreamingResponse(
        event_stream(request),
        media_type="text/event-stream",
        headers=headers,
    )
