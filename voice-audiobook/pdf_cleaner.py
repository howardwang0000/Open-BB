#!/usr/bin/env python3
"""
pdf_cleaner.py - turn a messy PDF into clean, read-aloud-ready text.

Removes the things a text-to-speech engine should never read out loud:
  * running headers and footers (book title / chapter title on every page)
  * page numbers ("12", "Page 12 of 40", "- 12 -", "xii")
  * footnotes at the bottom of the page, and the little superscript
    markers in the body text that point to them ("word¹" -> "word")
  * rotated margin text and watermarks
and repairs:
  * words split across lines by a hyphen ("algo-\\nrithm" -> "algorithm",
    while real compounds like "well-known" keep their hyphen)
  * two- and three-column layouts (reads the left column, then the right,
    instead of zig-zagging across the page)
  * paragraphs that continue across a page or column break
  * ligatures (ﬁ ﬂ ﬀ) and invisible characters

It is used two ways:
  1. Inside ebook2audiobook (patched in by setup_mac.command) so that uploading
     a PDF in the web page automatically uses this cleaner.
  2. On its own, to preview exactly what will be read aloud:

        python3 pdf_cleaner.py my.pdf               # writes my_clean.txt
        python3 pdf_cleaner.py my.pdf -o my.html    # headings kept as <h1>/<h2>
        python3 pdf_cleaner.py my.pdf --show-removed

Requires: pymupdf  (pip install pymupdf)
"""

from __future__ import annotations

import argparse
import html
import re
import statistics
import sys
import unicodedata
from collections import Counter
from dataclasses import dataclass, field
from typing import Callable, Iterable

# Characters that should never reach the speech engine.
_INVISIBLE = dict.fromkeys(map(ord, '\u00ad\u200b\u200c\u200d\u2060\ufeff'), None)
_LIGATURES = {
    '\ufb00': 'ff', '\ufb01': 'fi', '\ufb02': 'fl', '\ufb03': 'ffi',
    '\ufb04': 'ffl', '\ufb05': 'st', '\ufb06': 'st', '\u0132': 'IJ', '\u0133': 'ij',
}
_SPACES = dict.fromkeys(map(ord, '\u00a0\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u202f\u205f\u3000'), ' ')

# Hyphen-like characters that may end a line in the middle of a word.
_LINE_END_HYPHENS = ('-', '\u2010', '\u2011', '\u00ad')

# Superscript text that is a footnote marker rather than content (¹, *, †, 12, 3,4 ...).
_MARKER_RE = re.compile(r'^[\s\d,\-–*†‡§¶¹²³⁰-⁹]+$')
# First line of a footnote: starts with a number, symbol or superscript digit.
_FOOTNOTE_START_RE = re.compile(r'^\s*(?:\d{1,3}[.)]?\s|[*†‡§¶]+\s?|[¹²³⁰-⁹]+)')
# Page numbers on their own line.
_PAGE_NUMBER_RE = re.compile(
    r'^\s*(?:'
    r'[-–—]?\s*\d{1,4}\s*[-–—]?'                        # 12, - 12 -
    r'|(?:page|p\.|pg\.?)\s*\d{1,4}(?:\s*(?:of|/)\s*\d{1,4})?'          # Page 12, Page 12 of 40
    r'|\d{1,4}\s*(?:of|/)\s*\d{1,4}'                                     # 12 / 40, 12 of 40
    r'|[ivxlcdm]{1,7}'                                                   # xii (front matter)
    r')\s*$',
    re.IGNORECASE,
)
_SENTENCE_END_RE = re.compile(r'[.!?…:;]["\'”’)\]]*$')
_WORD_RE = re.compile(r"[^\W\d_]+(?:[-\u2010\u2011][^\W\d_]+)*", re.UNICODE)

# Prefixes that are written with a hyphen and are never just a syllable break
# ("self-aware", "well-known", "twenty-five"). Deliberately short: "pro", "pre", "co"
# etc. are also ordinary syllable breaks ("pro-fessional"), and joining a real
# compound ("selfaware") sounds fine, whereas a stray hyphen makes the voice stumble.
_COMPOUND_PREFIXES = {
    'self', 'well', 'half', 'quasi', 'twenty', 'thirty', 'forty', 'fifty',
    'sixty', 'seventy', 'eighty', 'ninety',
}

# Layout tuning (fractions of the page unless stated otherwise).
MARGIN_ZONE = 0.12          # top/bottom slice of the page where headers/footers live
HEADING_RATIO = 1.18        # font this much bigger than body text = heading
SMALL_RATIO = 0.88          # font this much smaller than body text = footnote-sized


@dataclass
class Line:
    text: str
    x0: float
    y0: float
    x1: float
    y1: float
    size: float
    bold: bool
    page: int
    block: int
    page_w: float
    page_h: float
    baseline: float = 0.0
    column: int = 0               # -1 = spans several columns (title, abstract, wide figure caption)

    @property
    def width(self) -> float:
        return self.x1 - self.x0


@dataclass
class CleanReport:
    pages: int = 0
    multi_column_pages: int = 0
    ocr_pages: int = 0
    removed: dict[str, list[str]] = field(default_factory=lambda: {
        'header/footer': [], 'page number': [], 'footnote': [],
        'footnote marker': [], 'rotated/margin text': [], 'figure label': [],
    })
    hyphens_joined: int = 0
    hyphens_kept: int = 0

    def summary(self) -> str:
        parts = [f'{self.pages} pages']
        if self.multi_column_pages:
            parts.append(f'{self.multi_column_pages} multi-column')
        if self.ocr_pages:
            parts.append(f'{self.ocr_pages} scanned (OCR)')
        for k, v in self.removed.items():
            if v:
                parts.append(f'{len(v)} {k}{"s" if len(v) != 1 else ""} removed')
        if self.hyphens_joined:
            parts.append(f'{self.hyphens_joined} split words re-joined')
        return ', '.join(parts)


# LaTeX PDFs often draw accents as a separate spacing character before the letter
# ("na¨ıve"); turn them back into real accented letters ("naïve").
_SPACING_ACCENTS = {'\u00a8': '\u0308', '\u00b4': '\u0301', '\u02c6': '\u0302', '\u02dc': '\u0303',
                    '\u00b8': '\u0327', '\u02c7': '\u030c', '\u02d8': '\u0306', '\u02da': '\u030a'}
_SPACING_ACCENT_RE = re.compile('([' + ''.join(_SPACING_ACCENTS) + '])([A-Za-z\u0131])')


def _normalize_chars(text: str) -> str:
    # A soft hyphen ending a line is a visible hyphenation break; elsewhere it is invisible.
    text = re.sub('\u00ad\\s*$', '-', text)
    for lig, rep in _LIGATURES.items():
        if lig in text:
            text = text.replace(lig, rep)
    if _SPACING_ACCENT_RE.search(text):
        text = _SPACING_ACCENT_RE.sub(lambda m: m.group(2).replace('\u0131', 'i') + _SPACING_ACCENTS[m.group(1)], text)
        text = unicodedata.normalize('NFC', text)
    text = text.replace('c\u20dd', '\u00a9')        # "c⃝" -> "©"
    # Footnote symbols glued to the end of a word ("Gal∗", "Smith†").
    text = re.sub(r'(?<=[^\W\d_])[\u2217*\u2020\u2021]+', '', text)
    return text.translate(_INVISIBLE).translate(_SPACES)


def _weighted_mode(pairs: Iterable[tuple[float, int]], default: float = 10.0) -> float:
    counts: Counter = Counter()
    for value, weight in pairs:
        counts[round(value * 2) / 2] += weight
    return counts.most_common(1)[0][0] if counts else default


# ---------------------------------------------------------------- extraction

def _extract_lines(page, pno: int, report: CleanReport) -> tuple[list[Line], list[str]]:
    """Horizontal text lines of a page, plus the text of any rotated lines."""
    import pymupdf
    flags = pymupdf.TEXT_PRESERVE_WHITESPACE | pymupdf.TEXT_MEDIABOX_CLIP  # ligatures expanded
    data = page.get_text('dict', flags=flags)
    pw, ph = page.rect.width, page.rect.height
    lines: list[Line] = []
    rotated: list[str] = []
    for block in data.get('blocks', []):
        if block.get('type', 0) != 0:
            continue
        for ln in block.get('lines', []):
            spans = [s for s in ln.get('spans', []) if s.get('text', '').strip()]
            if not spans:
                continue
            raw = ''.join(s['text'] for s in ln['spans']).strip()
            dx, dy = ln.get('dir', (1, 0))
            if abs(dy) > 0.05 or dx < 0:
                rotated.append(raw)
                continue
            body_spans = [s for s in spans if not (s['flags'] & 1)] or spans
            size = _weighted_mode((s['size'], len(s['text'])) for s in body_spans)
            bold_chars = sum(len(s['text']) for s in body_spans if s['flags'] & 16 or 'bold' in s.get('font', '').lower())
            total_chars = sum(len(s['text']) for s in body_spans)
            parts = []
            for i, s in enumerate(ln['spans']):
                t = s['text']
                # Footnote reference markers: small raised digits/symbols after a word.
                if (s['flags'] & 1 and s['size'] < size * 0.92 and _MARKER_RE.match(t)
                        and i > 0 and t.strip()):
                    report.removed['footnote marker'].append(t.strip())
                    parts.append(' ' if t.endswith(' ') else '')
                    continue
                parts.append(t)
            text = re.sub(r'\s+', ' ', _normalize_chars(''.join(parts))).strip()
            if not text:
                continue
            x0, y0, x1, y1 = ln['bbox']
            baseline = max(s['origin'][1] for s in body_spans)
            lines.append(Line(text, x0, y0, x1, y1, size, bold_chars >= total_chars * 0.9,
                              pno, block.get('number', 0), pw, ph, baseline))
    lines.sort(key=lambda l: (l.block, l.baseline, l.x0))
    return [l for block_lines in _group_by_block(lines) for l in _merge_same_baseline(block_lines, max_gap_em=4)], rotated


def _sideways_page_paragraphs(page) -> list[str]:
    """Plain reading of a page whose text is all rotated (e.g. a landscape table)."""
    import pymupdf
    blocks = page.get_text('blocks', flags=pymupdf.TEXT_DEHYPHENATE | pymupdf.TEXT_MEDIABOX_CLIP, sort=True)
    return [re.sub(r'\s+', ' ', _normalize_chars(b[4])).strip() for b in blocks if b[6] == 0 and b[4].strip()]


def _group_by_block(lines: list[Line]) -> list[list[Line]]:
    groups: dict[int, list[Line]] = {}
    for l in lines:
        groups.setdefault(l.block, []).append(l)
    return list(groups.values())


def _merge_same_baseline(lines: list[Line], max_gap_em: float | None = None) -> list[Line]:
    """PDFs often store one visual line as several pieces (justified text, mixed fonts).

    Glue consecutive pieces that sit on the same baseline in the same column back together.
    """
    merged: list[Line] = []
    group: list[Line] = []

    def flush():
        if not group:
            return
        group.sort(key=lambda l: l.x0)
        first = group[0]
        for ln in group[1:]:
            sep = '' if first.text.endswith(' ') else ' '
            first.text = f'{first.text}{sep}{ln.text}'
            first.x1 = max(first.x1, ln.x1)
            first.y0, first.y1 = min(first.y0, ln.y0), max(first.y1, ln.y1)
        merged.append(first)
        group.clear()

    for ln in lines:
        if group and (ln.column != group[0].column or ln.page != group[0].page
                      or abs(ln.baseline - group[0].baseline) >= 0.35 * ln.size
                      or (max_gap_em is not None and ln.x0 - group[-1].x1 > max_gap_em * ln.size)):
            flush()
        group.append(ln)
    flush()
    return merged


# ------------------------------------------------------- headers and footers

def _margin_key(text: str) -> str:
    return re.sub(r'\d+', '#', re.sub(r'\s+', ' ', text.lower())).strip()


def _remove_headers_footers(pages: list[list[Line]], body_size: float, report: CleanReport) -> None:
    n_pages = len(pages)
    min_repeats = 2 if n_pages <= 4 else 3

    def margin_candidates(page_lines: list[Line]) -> list[Line]:
        """The top-most and bottom-most lines of a page that sit inside the margin zones."""
        if not page_lines:
            return []
        by_y = sorted(page_lines, key=lambda l: l.y0)
        out = []
        for ln in by_y[:3] + by_y[-3:]:
            in_top = ln.y1 <= ln.page_h * MARGIN_ZONE
            in_bottom = ln.y0 >= ln.page_h * (1 - MARGIN_ZONE)
            if (in_top or in_bottom) and ln.size < body_size * HEADING_RATIO and ln not in out:
                out.append(ln)
        return out

    def isolated(ln: Line, page_lines: list[Line]) -> bool:
        """A small line standing alone in the margin, far from the body text (a running header)."""
        if ln.size > body_size * 1.05:
            return False
        others = [o for o in page_lines if o is not ln]
        if not others:
            return False
        if ln.y1 <= ln.page_h * MARGIN_ZONE:
            below = [o.y0 for o in others if o.y0 >= ln.y1 - 1]
            if not below or any(o.y1 <= ln.y0 for o in others):
                return False
            return min(below) - ln.y1 > 2.2 * body_size
        above = [o.y1 for o in others if o.y1 <= ln.y0 + 1]
        if not above or any(o.y0 >= ln.y1 for o in others if o.size >= body_size * 0.93):
            return False
        return ln.y0 - max(above) > 2.2 * body_size

    candidates = [margin_candidates(p) for p in pages]
    seen_on_pages: Counter = Counter()
    for cands in candidates:
        for key in {_margin_key(l.text) for l in cands}:
            seen_on_pages[key] += 1

    for page_lines, cands in zip(pages, candidates):
        for ln in cands:
            if _PAGE_NUMBER_RE.match(ln.text):
                report.removed['page number'].append(ln.text)
                page_lines.remove(ln)
            elif (n_pages > 1 and seen_on_pages[_margin_key(ln.text)] >= min_repeats) or isolated(ln, page_lines):
                report.removed['header/footer'].append(ln.text)
                page_lines.remove(ln)


# ------------------------------------------------------------------ columns

def _find_gutters(lines: list[Line]) -> list[float]:
    """Return x positions of column gutters on a page (empty list = single column)."""
    if len(lines) < 8:
        return []
    left = min(l.x0 for l in lines)
    right = max(l.x1 for l in lines)
    area = right - left
    if area <= 0:
        return []
    narrow = [l for l in lines if l.width <= area * 0.6]
    if len(narrow) < 6 or len(narrow) < 0.4 * len(lines):
        return []
    # A handful of centred lines (title block, author affiliations) straddle the gutter;
    # leave them out. Many of them would be a real middle column, so keep those.
    middle = (left + right) / 2
    centred = [l for l in narrow if l.x0 < middle < l.x1 and abs((l.x0 + l.x1) / 2 - middle) < 0.08 * area]
    if len(centred) <= 0.15 * len(narrow):
        narrow = [l for l in narrow if not any(l is c for c in centred)]
    bins = int(area) + 1
    coverage = [0] * bins
    for l in narrow:
        for x in range(max(0, int(l.x0 - left)), min(bins, int(l.x1 - left) + 1)):
            coverage[x] += 1
    tolerance = max(1, len(narrow) // 50)
    gutters = []
    x = int(area * 0.2)
    while x < int(area * 0.8):
        if coverage[x] <= tolerance:
            start = x
            while x < bins and coverage[x] <= tolerance:
                x += 1
            if x - start >= 5 and _is_gutter(narrow, left + start, left + x, area):
                gutters.append(left + (start + x) / 2)
        x += 1
    return gutters


def _is_gutter(narrow: list[Line], gap_x0: float, gap_x1: float, area: float) -> bool:
    on_left = [l for l in narrow if l.x1 <= gap_x0 + 1]
    on_right = [l for l in narrow if l.x0 >= gap_x1 - 1]
    if len(on_left) >= max(3, 0.2 * len(narrow)) and len(on_right) >= max(3, 0.2 * len(narrow)):
        return True
    # A short last column (end of an article): accept it when the left column's lines run
    # right up to the gap, and the few lines on the right share a common left edge.
    if len(on_left) < 3 or len(on_right) < 2:
        return False
    filled = sum(1 for l in on_left if l.x1 >= gap_x0 - 0.12 * area)
    right_edge = min(l.x0 for l in on_right)
    aligned = sum(1 for l in on_right if l.x0 - right_edge < 3)
    return filled >= 0.6 * len(on_left) and aligned >= 2


def _reading_order(page_lines: list[Line], gutters: list[float]) -> list[Line]:
    by_y = sorted(page_lines, key=lambda l: (round(l.baseline / 2), l.x0))
    if not gutters:
        return by_y

    def column_of(l: Line) -> int:
        return sum(1 for g in gutters if (l.x0 + l.x1) / 2 > g)

    def spans_gutter(l: Line) -> bool:
        return any(l.x0 < g - 2 and l.x1 > g + 2 for g in gutters)

    ordered: list[Line] = []
    band: list[Line] = []

    def flush_band():
        for col in range(len(gutters) + 1):
            col_lines = [l for l in band if column_of(l) == col]
            for l in col_lines:
                l.column = col
            ordered.extend(col_lines)
        band.clear()

    for l in by_y:
        if spans_gutter(l):
            flush_band()
            l.column = -1
            ordered.append(l)
        else:
            band.append(l)
    flush_band()
    return ordered


# ------------------------------------------------------------------ figures

def _remove_figure_text(page, page_lines: list[Line], report: CleanReport) -> list[Line]:
    """Drop labels inside diagrams and pictures ("Trace 1", "Number", "x-axis").

    Text inside a drawing or image is only dropped when it reads like labels (short
    fragments); a box drawn around real paragraphs (a sidebar) is kept.
    """
    regions = []
    try:
        regions += [r for r in page.cluster_drawings()]
    except Exception:
        pass
    try:
        import pymupdf
        regions += [pymupdf.Rect(i['bbox']) for i in page.get_image_info()]
    except Exception:
        pass
    # Ignore hairlines, and anything covering most of the page: that is a page border,
    # a background, or the scan behind an OCR text layer, not a diagram.
    page_area = page.rect.width * page.rect.height
    regions = [r for r in regions if r.width >= 20 and r.height >= 20 and r.width * r.height < 0.5 * page_area]
    if not regions:
        return page_lines
    drop: list[Line] = []
    for r in regions:
        inside = [l for l in page_lines
                  if r.x0 - 2 <= (l.x0 + l.x1) / 2 <= r.x1 + 2 and r.y0 - 2 <= (l.y0 + l.y1) / 2 <= r.y1 + 2]
        if not inside:
            continue
        lengths = sorted(len(l.text) for l in inside)
        sentences = sum(1 for l in inside if _SENTENCE_END_RE.search(l.text) and len(l.text) > 40)
        if lengths[len(lengths) // 2] < 40 and sentences <= len(inside) // 4:
            drop.extend(l for l in inside if not any(l is d for d in drop))
    for l in drop:
        report.removed['figure label'].append(l.text)
    return [l for l in page_lines if not any(l is d for d in drop)]


# ---------------------------------------------------------------- footnotes

def _remove_footnotes(page_lines: list[Line], body_size: float, report: CleanReport) -> list[Line]:
    """Drop small-font text that starts with a footnote marker below the body text of its column."""
    keep = list(page_lines)
    for col in {l.column for l in page_lines}:
        col_lines = [l for l in page_lines if l.column == col]
        body = [l for l in col_lines if l.size >= body_size * 0.93]
        if not body:
            continue
        body_bottom = max(l.y1 for l in body)
        tail = sorted((l for l in col_lines if l.y0 >= body_bottom - 1 and l.size <= body_size * SMALL_RATIO
                       and l.y0 > l.page_h * 0.45), key=lambda l: l.y0)
        # Either a numbered footnote, or a block of clearly smaller print set apart at the
        # foot of the column (copyright notices, unnumbered notes).
        if tail and (_FOOTNOTE_START_RE.match(tail[0].text)
                     or (tail[0].size <= body_size * 0.85 and tail[0].y0 - body_bottom > 0.8 * body_size)):
            for l in tail:
                report.removed['footnote'].append(l.text)
                keep.remove(l)
    return keep


# --------------------------------------------------------------- paragraphs

def _hyphen_vocabulary(pages: list[list[Line]]) -> tuple[Counter, Counter]:
    whole, hyphenated = Counter(), Counter()
    for page in pages:
        for l in page:
            text = l.text.rstrip('-\u2010\u2011 ')
            for w in _WORD_RE.findall(text):
                w = re.sub('[\u2010\u2011]', '-', w.lower())
                if '-' in w:
                    hyphenated[w] += 1
                else:
                    whole[w] += 1
    return whole, hyphenated


def _join_hyphenated(prev: str, nxt: str, whole: Counter, hyphenated: Counter,
                     report: CleanReport) -> str | None:
    """If prev ends with a word broken by a hyphen, return the joined text; else None."""
    if not prev.endswith(_LINE_END_HYPHENS) or len(prev) < 2 or not prev[-2].isalpha():
        return None
    m_left = re.search('([^\\W\\d_]+)[-\u2010\u2011\u00ad]$', prev)
    m_right = re.match(r'([^\W\d_]+)', nxt)
    if not m_left or not m_right:
        return None
    if m_right.group(1)[0].isupper():          # "anti-\nAmerican" -> "anti-American"
        report.hyphens_kept += 1
        return prev + nxt
    left, right = m_left.group(1), m_right.group(1)
    joined = (left + right).lower()
    compound = f'{left}-{right}'.lower()
    keep_hyphen = (
        (hyphenated[compound] > 0 and whole[joined] == 0)
        or (whole[joined] == 0 and left.lower() in _COMPOUND_PREFIXES)
    )
    if keep_hyphen:
        report.hyphens_kept += 1
        return prev[:-1] + '-' + nxt
    report.hyphens_joined += 1
    return prev[:-1] + nxt


@dataclass
class Paragraph:
    kind: str          # 'h1', 'h2', 'p' or 'raw' (pre-built xhtml, e.g. OCR output)
    text: str
    size: float = 0.0


def _build_paragraphs(ordered: list[Line | Paragraph], body_size: float,
                      whole: Counter, hyphenated: Counter, report: CleanReport) -> list[Paragraph]:
    body_lines = [l for l in ordered if isinstance(l, Line) and abs(l.size - body_size) < 0.6]
    deltas = [b.baseline - a.baseline for a, b in zip(body_lines, body_lines[1:])
              if a.page == b.page and a.column == b.column and 0 < b.baseline - a.baseline < body_size * 3]
    leading = statistics.median(deltas) if deltas else body_size * 1.2

    col_left: dict[tuple[int, int], float] = {}
    col_right: dict[tuple[int, int], float] = {}
    for l in ordered:
        if isinstance(l, Line) and abs(l.size - body_size) < 0.6:
            k = (l.page, l.column)
            col_left[k] = min(col_left.get(k, l.x0), l.x0)
            col_right[k] = max(col_right.get(k, l.x1), l.x1)

    paras: list[Paragraph] = []
    cur: list[str] = []
    cur_size = 0.0
    prev: Line | None = None
    # Full-width captions/figures at the top of a page that interrupt a sentence are
    # held back and read after the paragraph they interrupted.
    floats: list[Line] = []

    def emit(texts: list[str], size: float):
        text = re.sub(r'\s+', ' ', ' '.join(texts)).strip()
        if re.search(r'[^\W\d_]', text):
            paras.append(Paragraph('p', text, size))

    def flush():
        nonlocal cur
        if cur:
            emit(cur, cur_size)
        cur = []
        if floats:
            emit([f.text for f in floats], floats[0].size)
            floats.clear()

    def is_heading(l: Line) -> bool:
        return l.size >= body_size * HEADING_RATIO

    for item in ordered:
        if isinstance(item, Paragraph):
            flush()
            paras.append(item)
            prev = None
            continue
        l = item
        interrupts = (cur and prev is not None and l.column == -1 and not is_heading(l)
                      and not _SENTENCE_END_RE.search(cur[-1]))
        if interrupts and len(floats) < 4 and (floats or l.page != prev.page or l.baseline < prev.baseline):
            floats.append(l)
            continue
        if is_heading(l):
            flush()
            if paras and paras[-1].kind == 'heading' and prev is not None and is_heading(prev) \
                    and abs(paras[-1].size - l.size) < 1 and l.page == prev.page:
                paras[-1].text += ' ' + l.text
            else:
                paras.append(Paragraph('heading', l.text, l.size))
            prev = l
            continue

        new_para = prev is None or is_heading(prev)
        mid_word = (prev is not None and cur and cur[-1].endswith(_LINE_END_HYPHENS)
                    and len(cur[-1]) > 1 and cur[-1][-2].isalpha() and l.text[:1].islower())
        if not new_para and not mid_word:
            # "Wrapped" = jumped to the top of the next column or page.
            wrapped = l.page != prev.page or l.baseline < prev.baseline - 0.5 * l.size
            left = col_left.get((l.page, l.column), l.x0)
            width = col_right.get((l.page, l.column), l.x1) - left
            prev_ended = bool(_SENTENCE_END_RE.search(prev.text))
            if not wrapped:
                gap = l.baseline - prev.baseline
                indented = l.x0 - left > 0.8 * l.size and prev.x0 - left < 0.5 * l.size
                short_prev = prev_ended and prev.width < 0.8 * width
                size_jump = abs(l.size - prev.size) > 0.15 * body_size
                # A short bold line on its own ("Introduction") is a sub-heading: give it its own pause.
                bold_switch = prev.bold != l.bold and len(prev.text if prev.bold else l.text) < 80
                new_para = gap > leading * 1.45 or gap < 0 or indented or short_prev or size_jump or bold_switch
            else:
                # Column or page break: keep going if the sentence clearly continues,
                # or if the previous line ran the full width and the next one is not indented.
                indented = l.x0 - left > 0.8 * l.size
                prev_left = col_left.get((prev.page, prev.column), prev.x0)
                prev_full = prev.x1 - prev_left >= 0.92 * (col_right.get((prev.page, prev.column), prev.x1) - prev_left)
                continues = not prev_ended or l.text[:1].islower() or (prev_full and not indented)
                new_para = not continues or (indented and prev_ended)

        if new_para:
            flush()
            cur, cur_size = [l.text], l.size
        else:
            joined = _join_hyphenated(cur[-1], l.text, whole, hyphenated, report)
            if joined is not None:
                cur[-1] = joined
            else:
                cur.append(l.text)
        prev = l
    flush()

    # Biggest heading size -> h1, everything else -> h2.
    head_sizes = sorted({round(p.size) for p in paras if p.kind == 'heading'}, reverse=True)
    for p in paras:
        if p.kind == 'heading':
            p.kind = 'h1' if head_sizes and round(p.size) == head_sizes[0] else 'h2'
            p.text = re.sub(r'\s+', ' ', p.text).strip()
        elif p.kind == 'p' and not _SENTENCE_END_RE.search(p.text) and re.search(r'[\w)\]"\'\u201d\u2019]$', p.text):
            # A label, sub-heading or list item ("Abstract", "2 Method"): end it like a sentence
            # so the voice pauses instead of running it into the next paragraph.
            p.text += '.'
    return paras


# ---------------------------------------------------------------- public API

def clean_pdf(doc_or_path, ocr_page: Callable | None = None, keep_footnotes: bool = False,
              keep_headers: bool = False) -> tuple[list[Paragraph], CleanReport]:
    """Clean a PDF (path or open pymupdf.Document).

    ocr_page(page_index, page) -> xhtml string is called for pages that have no
    text layer (scans); its result is inserted at that point in the flow.
    """
    import pymupdf
    doc = pymupdf.open(doc_or_path) if isinstance(doc_or_path, (str, bytes)) or hasattr(doc_or_path, '__fspath__') else doc_or_path
    report = CleanReport(pages=len(doc))
    pages: list[list[Line]] = []
    sideways: dict[int, list[str]] = {}
    for i, page in enumerate(doc):
        lines, rotated = _extract_lines(page, i, report)
        if not lines and sum(len(t) for t in rotated) >= 40:
            sideways[i] = _sideways_page_paragraphs(page)   # read it rather than lose it
        else:
            report.removed['rotated/margin text'].extend(rotated)
        pages.append(lines)
    has_text_layer = [bool(p) or i in sideways for i, p in enumerate(pages)]
    all_lines = [l for p in pages for l in p]
    body_size = _weighted_mode(((l.size, len(l.text)) for l in all_lines), default=10.0)

    if not keep_headers:
        _remove_headers_footers(pages, body_size, report)

    whole, hyphenated = _hyphen_vocabulary(pages)
    ordered: list[Line | Paragraph] = []
    for i, page_lines in enumerate(pages):
        if i in sideways:
            ordered.extend(Paragraph('p', t) for t in sideways[i] if re.search(r'[^\W\d_]', t))
            continue
        if not page_lines:
            # Only scans go to OCR; a page whose only text was a page number stays silent.
            if ocr_page is not None and not has_text_layer[i]:
                xhtml = ocr_page(i, doc[i]) or ''
                if xhtml.strip():
                    report.ocr_pages += 1
                    ordered.append(Paragraph('raw', xhtml))
            continue
        page_lines = _remove_figure_text(doc[i], page_lines, report)
        gutters = _find_gutters(page_lines)
        if gutters:
            report.multi_column_pages += 1
        page_ordered = _merge_same_baseline(_reading_order(page_lines, gutters))
        if not keep_footnotes:
            page_ordered = _remove_footnotes(page_ordered, body_size, report)
        ordered.extend(page_ordered)
    return _build_paragraphs(ordered, body_size, whole, hyphenated, report), report


def to_text(paras: list[Paragraph]) -> str:
    out = []
    for p in paras:
        if p.kind == 'raw':
            out.append(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', html.unescape(p.text))).strip())
        else:
            out.append(p.text)
    return '\n\n'.join(t for t in out if t) + '\n'


def to_xhtml_body(paras: list[Paragraph]) -> str:
    out = []
    for p in paras:
        if p.kind == 'raw':
            out.append(p.text)
        else:
            out.append(f'<{p.kind}>{html.escape(p.text, quote=False)}</{p.kind}>')
    return '\n'.join(out)


def to_html(paras: list[Paragraph], title: str) -> str:
    return (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<html xmlns="http://www.w3.org/1999/xhtml">\n<head>\n<meta charset="utf-8"/>\n'
        f'<title>{html.escape(title)}</title>\n</head>\n<body>\n{to_xhtml_body(paras)}\n</body>\n</html>\n'
    )


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description='Clean a PDF so it reads well as an audiobook.')
    ap.add_argument('pdf', help='input PDF file')
    ap.add_argument('-o', '--output', help='output .txt or .html (default: <name>_clean.txt)')
    ap.add_argument('--keep-footnotes', action='store_true', help='do not remove footnotes')
    ap.add_argument('--keep-headers', action='store_true', help='do not remove running headers/footers')
    ap.add_argument('--show-removed', action='store_true', help='list everything that was removed')
    args = ap.parse_args(argv)

    paras, report = clean_pdf(args.pdf, keep_footnotes=args.keep_footnotes, keep_headers=args.keep_headers)
    out = args.output or re.sub(r'\.pdf$', '', args.pdf, flags=re.IGNORECASE) + '_clean.txt'
    title = re.sub(r'\.pdf$', '', args.pdf.rsplit('/', 1)[-1], flags=re.IGNORECASE)
    content = to_html(paras, title) if out.lower().endswith(('.html', '.xhtml', '.htm')) else to_text(paras)
    with open(out, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f'Cleaned: {report.summary()}')
    print(f'Wrote {out}')
    if args.show_removed:
        for kind, items in report.removed.items():
            for item in items:
                print(f'  [{kind}] {item}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
