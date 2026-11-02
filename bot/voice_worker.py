"""Offline subprocess. Bounded Ogg/Opus decoding, no Telegram token or audio files."""
from io import BytesIO
import json
import math
import os
import sys


def main():
    import av
    import numpy as np
    from faster_whisper import WhisperModel

    os.environ["HF_HUB_OFFLINE"] = "1"
    audio = sys.stdin.buffer.read(2 * 1024 * 1024 + 1)
    if not 0 < len(audio) <= 2 * 1024 * 1024:
        raise ValueError("size")
    with av.open(BytesIO(audio)) as container:
        if container.format.name != "ogg" or len(container.streams) != 1:
            raise ValueError("container")
        stream = container.streams[0]
        if stream.type != "audio" or stream.codec_context.name != "opus":
            raise ValueError("codec")
        resampler = av.AudioResampler(format="s16", layout="mono", rate=16000)
        chunks, samples = [], 0
        for frame in container.decode(stream):
            if frame.sample_rate <= 0 or frame.samples / frame.sample_rate > 61:
                raise ValueError("frame")
            for resampled in resampler.resample(frame):
                samples += resampled.samples
                if samples > 60 * 16000:
                    raise ValueError("duration")
                chunks.append(resampled.to_ndarray().reshape(-1))
        for resampled in resampler.resample(None):
            samples += resampled.samples
            if samples > 60 * 16000:
                raise ValueError("duration")
            chunks.append(resampled.to_ndarray().reshape(-1))
    if not samples:
        raise ValueError("empty")
    pcm = np.concatenate(chunks).astype(np.float32) / 32768.0
    model = WhisperModel(sys.argv[1], device="cpu", compute_type="int8", cpu_threads=2,
                         num_workers=1, local_files_only=True)
    segments, _ = model.transcribe(pcm, beam_size=1, language="ru", vad_filter=True,
                                  condition_on_previous_text=False)
    parts, length = [], 0
    for segment in segments:
        if not math.isfinite(segment.no_speech_prob) or segment.no_speech_prob > 0.6:
            continue
        text = segment.text.strip()
        length += len(text) + 1
        if length > 2048:
            raise ValueError("text")
        parts.append(text)
    print(json.dumps({"text": " ".join(parts)}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Neither decoder exceptions nor recognized speech leak through stderr.
        sys.exit(1)
