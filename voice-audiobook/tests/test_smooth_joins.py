"""Run with:  python3 -m unittest discover -s tests   (needs numpy; torch is optional)"""

import os
import sys
import unittest

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import smooth_joins as sj  # noqa: E402

SR = 24000


def speech(seconds: float, level_db: float = -20.0, seed: int = 0) -> np.ndarray:
    """Something speech-like: a voiced tone with a syllable-rate (4 Hz) envelope."""
    rng = np.random.default_rng(seed)
    t = np.arange(int(seconds * SR)) / SR
    env = 0.35 + 0.65 * np.abs(np.sin(2 * np.pi * 4 * t))
    sig = (np.sin(2 * np.pi * 180 * t) + 0.4 * np.sin(2 * np.pi * 360 * t)) * env
    sig += 0.05 * rng.standard_normal(len(t))
    rms = np.sqrt(np.mean(sig ** 2))
    return (sig / rms * 10 ** (level_db / 20)).astype(np.float32)


def silence(seconds: float, noise_db: float = -75.0, seed: int = 1) -> np.ndarray:
    rng = np.random.default_rng(seed)
    return (rng.standard_normal(int(seconds * SR)) * 10 ** (noise_db / 20)).astype(np.float32)


def level_db(x: np.ndarray) -> float:
    return 20 * np.log10(np.sqrt(np.mean(x.astype(np.float64) ** 2)) + 1e-12)


def leading_silence(x: np.ndarray, thr: float = 1e-3) -> float:
    return np.flatnonzero(np.abs(x) > thr)[0] / SR


def trailing_silence(x: np.ndarray, thr: float = 1e-3) -> float:
    return (len(x) - 1 - np.flatnonzero(np.abs(x) > thr)[-1]) / SR


class PauseTests(unittest.TestCase):
    def test_pause_depends_on_punctuation(self):
        full = sj.pause_after('He climbed the hill.')
        comma = sj.pause_after('He climbed the hill,')
        mid = sj.pause_after('He climbed the hill and')
        self.assertGreater(full, sj.pause_after('He climbed the hill;'))
        self.assertGreater(sj.pause_after('He climbed the hill;'), comma)
        self.assertGreater(comma, mid)
        self.assertAlmostEqual(full, sj.PAUSE_SENTENCE, delta=sj.PAUSE_SENTENCE * sj.JITTER)

    def test_quotes_and_brackets_are_looked_through(self):
        self.assertAlmostEqual(sj.pause_after('"Stop!"'), sj.PAUSE_SENTENCE, delta=0.05)
        self.assertAlmostEqual(sj.pause_after('(see above.)'), sj.PAUSE_SENTENCE, delta=0.05)

    def test_same_text_same_pause(self):
        self.assertEqual(sj.pause_after('Same words.'), sj.pause_after('Same words.'))


class ChunkTests(unittest.TestCase):
    def test_model_silence_is_trimmed_to_a_constant(self):
        for lead, tail in ((0.05, 0.1), (0.4, 0.9), (0.0, 0.0)):
            raw = np.concatenate([silence(lead), speech(1.2), silence(tail)])
            out, _ = sj.smooth_chunk(raw, SR, 'Words.')
            self.assertLess(leading_silence(out), sj.LEAD_KEEP + 0.012)
            self.assertLess(trailing_silence(out), sj.TAIL_KEEP + 0.012)

    def test_no_clicks_at_the_edges(self):
        raw = speech(1.0, level_db=-12)  # starts and ends mid-waveform: a hard cut
        out, _ = sj.smooth_chunk(raw, SR, 'Words.')
        self.assertLess(abs(out[0]), 1e-3)
        self.assertLess(abs(out[-1]), 1e-3)
        # the first and last 5 ms ramp smoothly instead of jumping
        self.assertLess(np.max(np.abs(np.diff(out[:120]))), 0.05)
        self.assertLess(np.max(np.abs(np.diff(out[-120:]))), 0.05)

    def test_loudness_is_evened_out(self):
        quiet, _ = sj.smooth_chunk(speech(1.0, -25), SR, 'a.')
        loud, _ = sj.smooth_chunk(speech(1.0, -15), SR, 'b.')
        self.assertLess(abs(level_db(quiet) - level_db(loud)), 1.0)
        self.assertLess(abs(level_db(loud) - sj.TARGET_LEVEL_DB), 1.5)

    def test_gain_is_limited_and_never_clips(self):
        whisper, _ = sj.smooth_chunk(speech(1.0, -40), SR, 'a.')
        self.assertLess(level_db(whisper), -40 + sj.MAX_GAIN_DB + 1)
        hot, _ = sj.smooth_chunk(speech(1.0, -3), SR, 'b.')
        self.assertLessEqual(np.max(np.abs(hot)), sj.PEAK_LIMIT + 1e-6)

    def test_trailing_mumble_is_removed(self):
        raw = np.concatenate([speech(1.5), silence(0.5), speech(0.2, level_db=-34, seed=3), silence(0.1)])
        out, _ = sj.smooth_chunk(raw, SR, 'Words.')
        self.assertLess(len(out) / SR, 1.5 + sj.TAIL_KEEP + 0.05)

    def test_real_short_word_after_a_pause_is_kept(self):
        raw = np.concatenate([speech(1.5), silence(0.5), speech(0.3, level_db=-20, seed=4)])
        out, _ = sj.smooth_chunk(raw, SR, 'He waited. Yes.')
        self.assertGreater(len(out) / SR, 2.2)

    def test_long_inner_silence_is_shortened(self):
        raw = np.concatenate([speech(0.8), silence(1.8), speech(0.8, seed=5)])
        out, _ = sj.smooth_chunk(raw, SR, 'Words.')
        self.assertAlmostEqual(len(out) / SR, 0.8 + sj.MAX_INNER_GAP + 0.8, delta=0.15)

    def test_silent_clip_is_left_alone(self):
        out, pause = sj.smooth_chunk(np.zeros(SR, dtype=np.float32), SR, 'x.')
        self.assertEqual(len(out), SR)
        self.assertGreater(pause, 0)


class JoinTests(unittest.TestCase):
    def test_gaps_between_sentences_are_even(self):
        """The audible gap between sentences no longer depends on what the model left behind."""
        rng = np.random.default_rng(7)
        pieces, gaps = [], []
        for i in range(12):
            raw = np.concatenate([silence(rng.uniform(0, 0.6)), speech(1.0, seed=i),
                                  silence(rng.uniform(0, 1.0))])
            out, pause = sj.smooth_chunk(raw, SR, f'Sentence number {i}.')
            pieces += [out, np.zeros(pause, dtype=np.float32)]
        joined = np.concatenate(pieces)
        db, hop = sj._frame_db(joined, SR)
        segs = sj._segments(sj._voiced(db), hop, SR)
        gaps = [(b[0] - a[1]) * hop / SR for a, b in zip(segs, segs[1:])]
        self.assertEqual(len(gaps), 11)
        self.assertLess(max(gaps) - min(gaps), 0.12)
        self.assertAlmostEqual(float(np.mean(gaps)), sj.PAUSE_SENTENCE + 0.06, delta=0.1)

    def test_paragraph_pause_replaces_sentence_pause(self):
        sentence_pause = int(sj.PAUSE_SENTENCE * SR)
        extra = sj.structural_samples('break', None, SR) - sentence_pause
        self.assertAlmostEqual(extra / SR, sj.PAUSE_PARAGRAPH - sj.PAUSE_SENTENCE, places=3)
        self.assertEqual(sj.structural_samples('pause', '1.4', SR), int(1.4 * SR))


@unittest.skipUnless(__import__('importlib').util.find_spec('torch'), 'torch not installed')
class TorchAdapterTests(unittest.TestCase):
    def test_adapters(self):
        import torch
        part = torch.from_numpy(np.concatenate([silence(0.3), speech(1.0), silence(0.6)])).unsqueeze(0)
        audio, pause = sj.smooth_part(part, SR, 'Hello there.')
        self.assertEqual(audio.dim(), 2)
        self.assertEqual(audio.dtype, torch.float32)
        self.assertEqual(pause.shape[0], 1)
        sil, pending = sj.structural_pause('break', None, SR, pause.shape[-1])
        self.assertEqual(pending, max(pause.shape[-1], int(sj.PAUSE_PARAGRAPH * SR)))
        self.assertEqual(sil.shape[-1] + pause.shape[-1], pending)
        sil2, pending2 = sj.structural_pause('break', None, SR, pending)
        self.assertEqual(sil2.shape[-1], 0)   # two breaks in a row do not stack
        self.assertEqual(pending2, pending)


if __name__ == '__main__':
    unittest.main()
