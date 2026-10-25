"""
Generate messy test PDFs whose "true" text is known, so the cleaner can be
checked against it. Needs reportlab (pip install reportlab).

Markup inside the source paragraphs:
  algo|rithm   a place where the layout may break the word with a hyphen
  river^1      a superscript footnote marker "1" after "river"
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from reportlab.lib.pagesizes import letter
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

MARK = re.compile(r'\^(\S+?)(?=$|[\s.,;:!?)])')


def true_text(paragraph: str) -> str:
    """What a perfect cleaner should output for a source paragraph."""
    return MARK.sub('', paragraph.replace('|', ''))


@dataclass
class Style:
    font: str = 'Times-Roman'
    size: float = 11
    leading: float = 14
    indent: float = 18
    justify: bool = True


def auto_hyphenate(text: str) -> str:
    """Add a hyphenation point to every long plain word so that many lines end mid-word."""
    def mark(m: re.Match) -> str:
        w = m.group(0)
        return w if len(w) < 7 else w[:len(w) // 2] + '|' + w[len(w) // 2:]
    return re.sub(r'(?<![|^\w])[a-z]+(?![|\w])', mark, text)


def _visible(word: str) -> str:
    return MARK.sub('', word.replace('|', ''))


def _width(text: str, st: Style) -> float:
    marks = MARK.findall(text)
    w = stringWidth(_visible(text), st.font, st.size)
    return w + sum(stringWidth(m, st.font, st.size * 0.65) for m in marks)


def layout(paragraph: str, st: Style, width: float) -> tuple[list[tuple[str, bool]], int]:
    """Greedy line breaking with hyphenation. Returns ([(line, is_last_line)], hyphen_breaks)."""
    words = paragraph.split()
    lines: list[str] = []
    cur = ''
    avail = width - st.indent
    breaks = 0
    for word in words:
        cand = f'{cur} {word}' if cur else word
        if _width(cand.replace('|', ''), st) <= avail:
            cur = cand
            continue
        # Try to break the word at a soft (|) or hard (-) hyphenation point.
        points = [i for i, ch in enumerate(word) if ch in '|-']
        placed = False
        for p in reversed(points):
            head = word[:p].replace('|', '') + '-'
            tail = word[p + 1:]
            if _width(f'{cur} {head}' if cur else head, st) <= avail:
                lines.append(f'{cur} {head}' if cur else head)
                cur, placed = tail, True
                breaks += 1
                break
        if not placed:
            lines.append(cur)
            cur = word
        avail = width
    if cur:
        lines.append(cur)
    lines = [l.replace('|', '') for l in lines]
    return [(l, i == len(lines) - 1) for i, l in enumerate(lines)], breaks


def draw_line(c: canvas.Canvas, x: float, y: float, line: str, st: Style, width: float, last: bool) -> None:
    natural = _width(line, st)
    spaces = line.count(' ')
    ws = (width - natural) / spaces if st.justify and not last and spaces else 0
    t = c.beginText(x, y)
    t.setFont(st.font, st.size)
    t.setWordSpace(ws)
    pos = 0
    for m in MARK.finditer(line):
        t.textOut(line[pos:m.start()])
        t.setFont(st.font, st.size * 0.65)
        t.setRise(st.size * 0.38)
        t.textOut(m.group(1))
        t.setRise(0)
        t.setFont(st.font, st.size)
        pos = m.end()
    t.textOut(line[pos:])
    c.drawText(t)


@dataclass
class Frame:
    x: float
    top: float
    bottom: float
    width: float
    y: float = 0.0
    footnotes: list[str] = field(default_factory=list)

    def reset(self) -> None:
        self.y = self.top
        self.footnotes = []


class Flow:
    """Flows paragraphs through a sequence of frames (columns), page after page."""

    def __init__(self, path: str, frames_for_page, decorate_page, footnotes: dict[str, str]):
        self.c = canvas.Canvas(path, pagesize=letter)
        self.frames_for_page = frames_for_page
        self.decorate_page = decorate_page
        self.footnote_text = footnotes
        self.page = 1
        self.frames = frames_for_page(self.page)
        self.fi = 0
        for f in self.frames:
            f.reset()
        self.hyphen_breaks = 0
        self.in_paragraph = False     # is a paragraph being laid out right now?
        self.page_breaks: list[bool] = []  # for each page break: did it split a paragraph?

    @property
    def frame(self) -> Frame:
        return self.frames[self.fi]

    def _next_frame(self) -> None:
        self.fi += 1
        if self.fi >= len(self.frames):
            self._finish_page()
            self.c.showPage()
            self.page += 1
            self.page_breaks.append(self.in_paragraph)
            self.frames = self.frames_for_page(self.page)
            for f in self.frames:
                f.reset()
            self.fi = 0

    def _finish_page(self) -> None:
        for f in self.frames:
            y = f.bottom - 16
            if f.footnotes:
                self.c.line(f.x, f.bottom - 4, f.x + 72, f.bottom - 4)
            for key in f.footnotes:
                st = Style(size=8, leading=10, indent=0, justify=False)
                lines, _ = layout(f'{key} {self.footnote_text[key]}', st, f.width)
                for line, _last in lines:
                    self.c.setFont(st.font, st.size)
                    self.c.drawString(f.x, y, line)
                    y -= st.leading
        self.decorate_page(self.c, self.page)

    def space(self, pts: float) -> None:
        self.frame.y -= pts

    def paragraph(self, text: str, st: Style) -> None:
        lines, breaks = layout(auto_hyphenate(text), st, self.frame.width)
        self.hyphen_breaks += breaks
        for i, (line, last) in enumerate(lines):
            if self.frame.y - st.size < self.frame.bottom:
                self.in_paragraph = i > 0
                self._next_frame()
                self.in_paragraph = False
            x = self.frame.x + (st.indent if i == 0 else 0)
            w = self.frame.width - (st.indent if i == 0 else 0)
            self.frame.y -= st.leading
            draw_line(self.c, x, self.frame.y, line, st, w, last)
            for key in MARK.findall(line):
                self.frame.footnotes.append(key)

    def heading(self, text: str, size: float, font: str = 'Times-Bold', before: float = 0, after: float = 10) -> None:
        if self.frame.y - before - size * 3 < self.frame.bottom:
            self._next_frame()
        self.frame.y -= before + size
        self.c.setFont(font, size)
        self.c.drawString(self.frame.x, self.frame.y, text)
        self.frame.y -= after

    def save(self) -> None:
        self._finish_page()
        self.c.save()


# ------------------------------------------------------------------ the book

BOOK_TITLE = 'Chapter One'
BOOK = [
    "The river began as a thin silver thread high in the moun|tains, where the snow never quite "
    "melted and the air tasted of stone. Nobody in the valley could say exactly where the source "
    "was, and the old maps disagreed with one another in ways that were almost comi|cal.",
    "My grandmother claimed she had walked there once, as a girl, with a borrowed coat and a "
    "pocket full of dried apri|cots. She described a meadow ringed by pines and a spring that "
    "bubbled up between two flat rocks like water poured from a jug.^1 I believed every word of it.",
    "When I was twelve I decided to find the place my|self. I studied the maps until the creases "
    "wore through, I copied the contour lines into a note|book, and I worked out an algo|rithm for "
    "choosing which fork of the stream to follow: always the colder one, always the one that "
    "sounded louder in the dark.",
    "It was a well-known fact in our house that I could not be stopped once I had an idea, so my "
    "parents did the sensible thing and came with me. My father carried the tent and the stove, my "
    "mother carried the first-aid kit and a deep, unshakable skep|ticism, and I carried the "
    "note|book and the unshakable certainty of a child who has never yet been wrong about any|thing "
    "that mattered.",
    "We set out on a Tuesday in late August. The first day was easy walking along the valley floor, "
    "past orchards heavy with fruit and fields where the hay had already been cut and stacked into "
    "golden loaves. By evening we had reached the place where the road ended and the real "
    "climb|ing began.^2 My father lit the stove and my mother read aloud from a book about "
    "glaciers while the light drained out of the sky.",
    "On the second morning the path grew steep and the stream beside it grew loud. We crossed it "
    "three times on stepping stones that wobbled under our boots, and each time my mother said "
    "nothing but held my hand a little tighter than was strictly neces|sary. The air grew thinner "
    "and cooler, and the trees gave way to low shrubs and then to grass and scattered boulders.",
    "Late that afternoon we came over a rise and saw the meadow. It was exactly as my grand|mother "
    "had described it, ringed with pines, bright with small blue flowers, and in the middle of it "
    "two flat rocks with water welling up between them, clear and cold and endlessly patient. I "
    "knelt down and drank, and it tasted of snow and stone and something else that I have never "
    "been able to name.",
]
BOOK_TITLE_2 = 'Chapter Two'
BOOK_2 = [
    "The walk down took half as long as the walk up, as walks down always do. My father whistled "
    "the same three notes over and over, my mother pointed out birds whose names none of us knew, "
    "and I said almost nothing at all because I was busy memorising the shape of every bend in the "
    "path so that I could find it again on my own one day.",
    "I did go back, many years later, with a child of my own who had an algorithm of her own for "
    "choosing paths. The meadow was smaller than I remembered and the pines were taller. The "
    "spring was still there, still patient, still cold enough to make your teeth ache, and when my "
    "daughter knelt to drink I understood for the first time why my mother had held my hand so "
    "tightly at every crossing on the way up.",
    "Some places do not change because nobody needs them to. They wait at the top of the valley "
    "for whoever is stubborn enough to climb, and they give back exactly what was brought to them: "
    "a little thirst, a little patience, and a story worth carrying home.",
]
BOOK_FOOTNOTES = {
    '1': 'She always said this, though she had never owned a jug.',
    '2': 'The road has since been extended by about four kilometres.',
}


def make_book(path: str) -> tuple[list[str], int]:
    w, h = letter

    def frames(_page):
        return [Frame(x=90, top=h - 100, bottom=150, width=w - 180)]

    def decorate(c, page):
        c.setFont('Times-Italic', 9)
        if page > 1:
            c.drawCentredString(w / 2, h - 50, 'THE QUIET RIVER' if page % 2 == 0 else 'Chapter One: The Source')
        c.setFont('Times-Roman', 9)
        c.drawCentredString(w / 2, 50, str(page))
        # A diagonal watermark that should never be read.
        c.saveState()
        c.setFont('Helvetica', 40)
        c.setFillGray(0.85)
        c.translate(w / 2, h / 2)
        c.rotate(35)
        c.drawCentredString(0, 0, 'REVIEW COPY')
        c.restoreState()

    flow = Flow(path, frames, decorate, BOOK_FOOTNOTES)
    body = Style(size=12, leading=16)
    expected = []
    for title, paras in ((BOOK_TITLE, BOOK), (BOOK_TITLE_2, BOOK_2)):
        if expected:
            flow._next_frame()
        flow.heading(title, 22, before=30, after=30)
        expected.append(title)
        for i, p in enumerate(paras):
            flow.paragraph(p, Style(size=body.size, leading=body.leading, indent=0 if i == 0 else 18))
            expected.append(true_text(p))
    flow.save()
    return expected, flow.hyphen_breaks


# ----------------------------------------------------------------- the paper

PAPER_TITLE = 'Measuring Quiet Rivers With Cheap Sensors'
PAPER_AUTHORS = 'A. Researcher^* and B. Colleague'
PAPER_ABSTRACT = (
    "We describe a low-cost method for monitoring small moun|tain streams using commodity "
    "pressure sensors and a simple calibration procedure. Across twelve sites the method agrees "
    "with professional gauges to within four percent."
)
PAPER_SECTIONS = [
    ('1 Introduction', [
        "Small streams are poorly monitored because professional gauging stations are expensive to "
        "install and maintain. In this paper we ask whether a sensor that costs less than a good "
        "dinner can produce measure|ments that are useful for hydrologists, ecologists and local "
        "communities who want to understand how their rivers change through the seasons.",
        "Our contribution is threefold. First, we describe a mounting bracket that can be printed in "
        "an after|noon. Second, we give a calibration procedure that needs only a tape measure and a "
        "stopwatch. Third, we report a season of field data from twelve sites spread across three "
        "valleys, with a careful comparison against reference instru|ments maintained by the regional "
        "water authority.",
    ]),
    ('2 Method', [
        "Each sensor was fixed to a steel stake driven into the stream bed and connected by cable to a "
        "logger on the bank. Readings were taken every ten minutes and stored on a memory card that "
        "we collected once a month. The calibration procedure relates pressure to depth and depth to "
        "flow using a simple rating curve fitted to a handful of manual measure|ments made at different "
        "water levels throughout the season.",
        "We found that the most important source of error was sediment settling around the sensor "
        "inlet, which slowly biased the readings upward. A monthly cleaning with a soft brush removed "
        "almost all of this drift, and we recommend it as part of any deploy|ment that lasts more than "
        "a few weeks.",
    ]),
    ('3 Discussion', [
        "The main limitation of the approach is that it measures depth at a single point, so any "
        "change in the shape of the channel shifts the rating curve and must be corrected with fresh "
        "manual measurements. Gravel bars that move during floods were the most common cause of such "
        "shifts at our sites, and in two cases we had to recalibrate twice within a single month.",
        "A second limitation is battery life during cold weather. Loggers that were buried under snow "
        "kept running, but those exposed to wind chill lost roughly a third of their expected runtime. "
        "Simple foam insulation solved the problem at negligible cost, and we now include it in the "
        "standard kit that we lend to community groups.",
    ]),
    ('4 Results', [
        "Across all twelve sites the median difference between our sensors and the reference gauges "
        "was four percent, with the largest errors occurring during floods when debris struck the "
        "stakes. Sites in shaded valleys performed slightly better than exposed sites, which we "
        "attribute to smaller daily temperature swings inside the logger enclo|sures.",
    ]),
]
PAPER_SECTIONS.append(('5 Conclusion', [
    "Cheap pressure sensors, a printed bracket and a tape measure are enough to monitor a small "
    "stream to within a few percent of a professional gauge, provided the sensor inlet is cleaned "
    "every month and the rating curve is checked after every major flood.",
    "We hope that the method will let schools, fishing clubs and village councils keep their own "
    "records of the rivers they care about, and we have released the bracket design, the logger "
    "firmware and all of our field data so that others can build on this work.",
]))
PAPER_SECTIONS.append(('6 Future Work', [
    "The next version of the bracket will hold a small temperature sensor beside the pressure "
    "sensor, so that the readings can be corrected for the density of the water without a second "
    "logger. We also plan to test cheaper cables, since the cable was the most expensive single "
    "part of every installation.",
    "Finally, we would like to know whether the method works in larger rivers. Our sites were all "
    "less than five metres wide, and it is not yet clear how well a single sensor near the bank "
    "represents the flow across a broad channel with a moving bed of sand and gravel.",
]))
PAPER_DIAGRAM_LABELS = ['Pressure sensor', 'Data logger', 'Memory card']
PAPER_CAPTION = 'Figure 1: Water depth at all twelve sites over the season, measured every ten minutes.'
PAPER_FOOTNOTES = {'*': 'Corresponding author. Work done while visiting the valley field station.'}


def make_paper(path: str) -> tuple[list[str], int]:
    w, h = letter
    gutter, margin = 22, 60
    colw = (w - 2 * margin - gutter) / 2

    def frames(page):
        top, bottom = (h - 250, 110) if page == 1 else (h - 125, 420)
        return [Frame(x=margin, top=top, bottom=bottom, width=colw),
                Frame(x=margin + colw + gutter, top=top, bottom=bottom, width=colw)]

    def decorate(c, page):
        c.setFont('Times-Roman', 8)
        c.drawCentredString(w / 2, h - 40, 'Journal of Field Instruments, Vol. 3, No. 2')
        c.drawRightString(w - margin, 45, f'Page {page}')
        if page == 2:
            # a full-width figure caption across the top of the page, as LaTeX places them
            c.setFont('Times-Italic', 10)
            c.drawCentredString(w / 2, h - 100, PAPER_CAPTION)
            # a small block diagram whose labels must not be read out
            c.setFont('Helvetica', 9)
            for i, label in enumerate(PAPER_DIAGRAM_LABELS):
                x = margin + 40 + i * 160
                c.rect(x, 250, 100, 40)
                c.drawCentredString(x + 50, 266, label)
                if i:
                    c.line(x - 60, 270, x, 270)
        # arXiv-style sideways identifier in the left margin
        c.saveState()
        c.translate(30, h / 2)
        c.rotate(90)
        c.setFont('Times-Roman', 14)
        c.drawCentredString(0, 0, 'arXiv:2610.01234v1 [physics.ins-det] 12 Oct 2026')
        c.restoreState()

    flow = Flow(path, frames, decorate, PAPER_FOOTNOTES)
    c = flow.c
    c.setFont('Times-Bold', 18)
    c.drawCentredString(w / 2, h - 90, PAPER_TITLE)
    # authors line with a superscript marker
    st = Style(size=11, indent=0, justify=False)
    draw_line(c, w / 2 - _width(PAPER_AUTHORS, st) / 2, h - 115, PAPER_AUTHORS, st, 0, True)
    flow.frames[0].footnotes.append('*')
    c.setFont('Times-Bold', 10)
    c.drawString(margin + 40, h - 140, 'Abstract')
    ast = Style(size=10, leading=12, indent=0)
    lines, breaks = layout(auto_hyphenate(PAPER_ABSTRACT), ast, w - 2 * margin - 80)
    flow.hyphen_breaks += breaks
    y = h - 142
    for line, last in lines:
        y -= ast.leading
        draw_line(c, margin + 40, y, line, ast, w - 2 * margin - 80, last)

    body = Style(size=11, leading=13.5, indent=12)
    expected = [PAPER_TITLE, true_text(PAPER_AUTHORS), 'Abstract', true_text(PAPER_ABSTRACT)]
    for title, paras in PAPER_SECTIONS:
        flow.heading(title, 11, before=8, after=4)
        expected.append(title)
        for p in paras:
            flow.paragraph(p, body)
            expected.append(true_text(p))
            if len(flow.page_breaks) == 1 and PAPER_CAPTION not in expected:
                # The caption is read after the paragraph it interrupted, not in the middle of it.
                expected.insert(len(expected) - (0 if flow.page_breaks[0] else 1), PAPER_CAPTION)
    flow.save()
    return expected, flow.hyphen_breaks


if __name__ == '__main__':
    import sys
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    for name, fn in (('book.pdf', make_book), ('paper.pdf', make_paper)):
        exp, n = fn(f'{out}/{name}')
        print(f'{name}: {len(exp)} paragraphs, {n} hyphenated line breaks')
