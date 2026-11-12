"""Kokoro synthesis worker: text on stdin, WAV to --out.

Runs inside the Kokoro virtualenv (``AGENTOS_KOKORO_PYTHON``), never inside the
AgentOS process: Kokoro pulls torch and is CPU-heavy. The text arrives on stdin
so it is never interpolated into code or a shell command line.
"""

import argparse
import sys


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", default="pf_dora")
    ap.add_argument("--lang", default="p")
    ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    text = sys.stdin.read().strip()
    if not text:
        print("empty text", file=sys.stderr)
        return 2

    import numpy as np
    import soundfile as sf
    from kokoro import KPipeline

    pipeline = KPipeline(lang_code=args.lang, repo_id="hexgrad/Kokoro-82M")
    chunks = [audio for _, _, audio in pipeline(text, voice=args.voice, speed=args.speed)]
    if not chunks:
        print("no audio", file=sys.stderr)
        return 3
    sf.write(args.out, np.concatenate(chunks), 24000)
    return 0


if __name__ == "__main__":
    sys.exit(main())
