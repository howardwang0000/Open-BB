"""
smooth_joins.py - make separately generated pieces of speech join seamlessly.

Voice-cloning models such as XTTS can only speak a sentence or two at a time,
so an audiobook is thousands of short clips glued together. Glued naively
(as upstream ebook2audiobook does) you hear:
  * clicks, because clips are cut at a non-zero sample with no fade
  * uneven rhythm, because each clip keeps whatever random amount of silence
    the model left at its start and end, and then a random pause is added on top
  * pauses that stack up (sentence pause + paragraph pause + model silence)
  * volume jumps from one sentence to the next
  * the occasional breath/mumble the model tacks onto the end of a clip
  * odd long silences in the middle of a clip

For every clip this module:
  1. drops a short quiet artefact at the very end, if the model added one
  2. shortens any silence inside the clip that is longer than MAX_INNER_GAP
  3. trims the silence at both ends, keeping a little natural air
  4. evens out the loudness to a common speech level
  5. fades in and out over a few milliseconds (no clicks)
  6. follows it with a pause whose length depends on how the text ends:
     a comma gets a short breath, a full stop a proper pause, a paragraph a longer one.
Paragraph and heading pauses replace the sentence pause instead of adding to it.

The core works on 1-D numpy arrays; smooth_part() and structural_pause() are
thin adapters for the torch tensors used inside ebook2audiobook.
"""

from __future__ import annotations

import zlib

import numpy as np

FRAME_SEC = 0.010

# Silence (seconds) after a clip, chosen by the last punctuation of its text.
PAUSE_SENTENCE = 0.45   # . ! ? …
PAUSE_CLAUSE = 0.30     # ; :
PAUSE_COMMA = 0.22      # ,
PAUSE_DASH = 0.18       # — –
PAUSE_MID = 0.10        # clip ended mid-sentence (long sentence split in two)
# Total silence for structural breaks (they replace the sentence pause, not add to it).
PAUSE_PARAGRAPH = 0.75  # [break]
PAUSE_SECTION = 1.10    # [pause] (headings, chapter titles)
JITTER = 0.08           # +/- 8% so the rhythm is not robotic, but stable for the same text

LEAD_KEEP = 0.025       # silence kept before the first sound (consonant onsets)
TAIL_KEEP = 0.070       # silence kept after the last sound (natural decay)
FADE_IN = 0.008
FADE_OUT = 0.025
MAX_INNER_GAP = 0.70    # longest silence allowed inside one clip
TARGET_LEVEL_DB = -20.0 # speech RMS level (audiobook standard is -23..-18 dB)
MAX_GAIN_DB = 6.0
PEAK_LIMIT = 0.97

_SENTENCE_END = set('.!?…‽。！？।॥؟')
_CLAUSE_END = set(';:；：')
_COMMA_END = set(',，、،')
_DASH_END = set('—–-')
_CLOSERS = '"\'”’»)]}」』 '


def _jitter(text: str) -> float:
    h = zlib.crc32(text.encode('utf-8')) % 2001
    return 1.0 + JITTER * (h / 1000.0 - 1.0)


def pause_after(text: str) -> float:
    """Seconds of silence to put after a clip that spoke `text`."""
    t = (text or '').rstrip().rstrip(_CLOSERS)
    last = t[-1:] if t else ''
    if last in _SENTENCE_END:
        base = PAUSE_SENTENCE
    elif last in _CLAUSE_END:
        base = PAUSE_CLAUSE
    elif last in _COMMA_END:
        base = PAUSE_COMMA
    elif last in _DASH_END:
        base = PAUSE_DASH
    else:
        base = PAUSE_MID
    return base * _jitter(t)


def _frame_db(audio: np.ndarray, sr: int) -> tuple[np.ndarray, int]:
    hop = max(1, int(sr * FRAME_SEC))
    n = int(np.ceil(len(audio) / hop))
    padded = np.zeros(n * hop, dtype=np.float64)
    padded[:len(audio)] = audio
    rms = np.sqrt(np.mean(padded.reshape(n, hop) ** 2, axis=1))
    return 20 * np.log10(rms + 1e-10), hop


def _voiced(db: np.ndarray) -> np.ndarray:
    if not len(db):
        return np.zeros(0, dtype=bool)
    threshold = max(db.max() - 35.0, -55.0)
    return db > threshold


def _segments(voiced: np.ndarray, hop: int, sr: int, bridge: float = 0.15) -> list[list[int]]:
    """Runs of voiced frames, as [start_frame, end_frame) pairs, bridging tiny gaps."""
    segs: list[list[int]] = []
    max_gap = int(bridge * sr / hop)
    for i, v in enumerate(voiced):
        if not v:
            continue
        if segs and i - segs[-1][1] <= max_gap:
            segs[-1][1] = i + 1
        else:
            segs.append([i, i + 1])
    return segs


def drop_tail_artifact(audio: np.ndarray, sr: int) -> np.ndarray:
    """Remove a short, quiet blob (breath, mumble) separated from the speech by a pause."""
    db, hop = _frame_db(audio, sr)
    voiced = _voiced(db)
    segs = _segments(voiced, hop, sr)
    if len(segs) < 2:
        return audio
    last, prev = segs[-1], segs[-2]
    gap = (last[0] - prev[1]) * hop / sr
    dur = (last[1] - last[0]) * hop / sr
    speech_dur = (prev[1] - segs[0][0]) * hop / sr
    main_level = np.median(db[segs[0][0]:prev[1]][voiced[segs[0][0]:prev[1]]])
    tail_level = np.mean(db[last[0]:last[1]])
    if gap >= 0.35 and dur <= 0.35 and speech_dur >= 0.8 and tail_level < main_level - 6.0:
        return audio[:prev[1] * hop]
    return audio


def compress_inner_gaps(audio: np.ndarray, sr: int, max_gap: float = MAX_INNER_GAP) -> np.ndarray:
    """Shorten silences inside the clip that are longer than max_gap seconds."""
    db, hop = _frame_db(audio, sr)
    segs = _segments(_voiced(db), hop, sr)
    if len(segs) < 2:
        return audio
    keep = int(max_gap * sr)
    pieces = [audio[:segs[0][1] * hop]]
    for (s0, e0), (s1, e1) in zip(segs, segs[1:]):
        gap = audio[e0 * hop:s1 * hop]
        if len(gap) > keep:
            half = keep // 2
            gap = np.concatenate([gap[:half], gap[-(keep - half):]])
        pieces.append(gap)
        pieces.append(audio[s1 * hop:e1 * hop])
    pieces.append(audio[segs[-1][1] * hop:])
    return np.concatenate(pieces)


def trim(audio: np.ndarray, sr: int, lead: float = LEAD_KEEP, tail: float = TAIL_KEEP) -> np.ndarray:
    db, hop = _frame_db(audio, sr)
    voiced = np.flatnonzero(_voiced(db))
    if not len(voiced):
        return audio
    start = max(0, voiced[0] * hop - int(lead * sr))
    end = min(len(audio), (voiced[-1] + 1) * hop + int(tail * sr))
    return audio[start:end]


def match_loudness(audio: np.ndarray, sr: int, target_db: float = TARGET_LEVEL_DB,
                   max_gain_db: float = MAX_GAIN_DB) -> np.ndarray:
    db, _ = _frame_db(audio, sr)
    voiced = _voiced(db)
    if not voiced.any():
        return audio
    level = 10 * np.log10(np.mean(10 ** (db[voiced] / 10)))
    gain_db = float(np.clip(target_db - level, -max_gain_db, max_gain_db))
    out = audio * (10 ** (gain_db / 20))
    peak = float(np.max(np.abs(out))) if len(out) else 0.0
    if peak > PEAK_LIMIT:
        out = out * (PEAK_LIMIT / peak)
    return out


def fade(audio: np.ndarray, sr: int, fade_in: float = FADE_IN, fade_out: float = FADE_OUT) -> np.ndarray:
    out = audio.copy()
    n_in = min(len(out) // 2, int(fade_in * sr))
    n_out = min(len(out) // 2, int(fade_out * sr))
    if n_in:
        out[:n_in] *= 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, n_in))
    if n_out:
        out[-n_out:] *= 0.5 + 0.5 * np.cos(np.linspace(0, np.pi, n_out))
    return out


def smooth_chunk(audio: np.ndarray, sr: int, text: str) -> tuple[np.ndarray, int]:
    """Clean one generated clip. Returns (audio, number of silent samples to put after it)."""
    audio = np.asarray(audio, dtype=np.float32).reshape(-1)
    pause = int(round(pause_after(text) * sr))
    if not len(audio) or not np.any(np.abs(audio) > 1e-6):
        return audio, pause
    out = drop_tail_artifact(audio, sr)
    out = compress_inner_gaps(out, sr)
    out = trim(out, sr)
    out = match_loudness(out, sr)
    out = fade(out, sr)
    return out.astype(np.float32), pause


def structural_samples(tag: str, value: str | None, sr: int) -> int:
    if tag == 'pause' and value:
        seconds = float(value)
    else:
        seconds = PAUSE_SECTION if tag == 'pause' else PAUSE_PARAGRAPH
    return int(round(seconds * sr))


# ------------------------------------------------- torch adapters (ebook2audiobook)

def smooth_part(part_tensor, sr: int, text: str):
    """(1, N) torch tensor in -> ((1, M) cleaned tensor, (1, P) silence tensor) out."""
    import torch
    audio = part_tensor.detach().reshape(-1).to('cpu', torch.float32).numpy()
    out, pause = smooth_chunk(audio, sr, text)
    return torch.from_numpy(out).unsqueeze(0), torch.zeros(1, pause)


def structural_pause(tag: str, value: str | None, sr: int, pending: int):
    """Silence for a [break]/[pause] tag, minus the silence that already ends the audio.

    Returns ((1, K) silence tensor, new trailing-silence length in samples).
    """
    import torch
    target = structural_samples(tag, value, sr)
    return torch.zeros(1, max(0, target - pending)), max(pending, target)
