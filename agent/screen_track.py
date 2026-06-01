import numpy as np
from av import VideoFrame
from mss import mss
from aiortc import VideoStreamTrack


class ScreenCaptureTrack(VideoStreamTrack):
    """Captures the primary display and yields WebRTC video frames."""

    def __init__(self, monitor_index: int = 1) -> None:
        super().__init__()
        self._sct = mss()
        self._monitor = self._sct.monitors[monitor_index]

    async def recv(self) -> VideoFrame:
        pts, time_base = await self.next_timestamp()
        shot = self._sct.grab(self._monitor)
        frame = np.array(shot)[:, :, :3]
        video = VideoFrame.from_ndarray(frame, format="bgr24")
        video.pts = pts
        video.time_base = time_base
        return video
