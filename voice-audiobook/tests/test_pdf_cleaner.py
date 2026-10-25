"""Run with:  python3 -m unittest discover -s tests   (needs pymupdf and reportlab)"""

import os
import sys
import tempfile
import unittest
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

import pdf_cleaner  # noqa: E402
from make_sample_pdfs import make_book, make_paper  # noqa: E402


class SamplePdfTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.book_expected, cls.book_hyphens = make_book(os.path.join(cls.tmp.name, 'book.pdf'))
        cls.paper_expected, cls.paper_hyphens = make_paper(os.path.join(cls.tmp.name, 'paper.pdf'))
        cls.book, cls.book_report = pdf_cleaner.clean_pdf(os.path.join(cls.tmp.name, 'book.pdf'))
        cls.paper, cls.paper_report = pdf_cleaner.clean_pdf(os.path.join(cls.tmp.name, 'paper.pdf'))

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_book_text_is_exactly_the_original(self):
        self.assertGreaterEqual(self.book_hyphens, 3, 'fixture should contain hyphenated line breaks')
        self.assertEqual([p.text for p in self.book], self.book_expected)

    def test_book_headings_become_chapters(self):
        self.assertEqual([p.text for p in self.book if p.kind == 'h1'], ['Chapter One', 'Chapter Two'])

    def test_book_removals(self):
        removed = self.book_report.removed
        self.assertEqual(sorted(removed['page number']), ['1', '2', '3'])
        self.assertEqual(sorted(removed['header/footer']), ['Chapter One: The Source', 'THE QUIET RIVER'])
        self.assertEqual(len(removed['footnote']), 2)
        self.assertEqual(sorted(removed['footnote marker']), ['1', '2'])
        self.assertTrue(all(t == 'REVIEW COPY' for t in removed['rotated/margin text']))

    def test_paper_text_is_exactly_the_original(self):
        self.assertGreaterEqual(self.paper_hyphens, 3)
        self.assertEqual([p.text for p in self.paper], self.paper_expected)

    def test_paper_layout_detected(self):
        self.assertEqual(self.paper_report.pages, 2)
        self.assertEqual(self.paper_report.multi_column_pages, 2)
        removed = self.paper_report.removed
        self.assertEqual(Counter(removed['header/footer']), {'Journal of Field Instruments, Vol. 3, No. 2': 2})
        self.assertEqual(sorted(removed['page number']), ['Page 1', 'Page 2'])
        self.assertTrue(removed['footnote'][0].startswith('* Corresponding author'))
        self.assertEqual(len(removed['rotated/margin text']), 2)
        self.assertEqual(sorted(removed['figure label']), ['Data logger', 'Memory card', 'Pressure sensor'])

    def test_nothing_spoken_is_lost(self):
        """Every word of the true text appears in the output, and no removed text does."""
        for paras, expected in ((self.book, self.book_expected), (self.paper, self.paper_expected)):
            out = pdf_cleaner.to_text(paras)
            self.assertEqual(out.split(), '\n\n'.join(expected).split())

    def test_xhtml_output(self):
        body = pdf_cleaner.to_xhtml_body(self.book)
        self.assertIn('<h1>Chapter One</h1>', body)
        self.assertEqual(body.count('<p>'), len(self.book_expected) - 2)


class OcrHookTests(unittest.TestCase):
    def test_scanned_pages_are_sent_to_ocr_in_order(self):
        import pymupdf
        doc = pymupdf.open()
        p1 = doc.new_page()
        p1.insert_text((72, 100), 'Text on the first page.', fontsize=11)
        doc.new_page()  # blank page = "scan" with no text layer
        p3 = doc.new_page()
        p3.insert_text((72, 100), 'Text on the third page.', fontsize=11)
        calls = []

        def fake_ocr(i, page):
            calls.append(i)
            return '<p>Recognised text.</p>'

        paras, report = pdf_cleaner.clean_pdf(doc, ocr_page=fake_ocr)
        self.assertEqual(calls, [1])
        self.assertEqual(report.ocr_pages, 1)
        self.assertEqual([p.kind for p in paras], ['p', 'raw', 'p'])
        self.assertEqual(pdf_cleaner.to_text(paras).split('\n\n')[1], 'Recognised text.')


    def test_page_with_only_a_page_number_is_not_sent_to_ocr(self):
        import pymupdf
        doc = pymupdf.open()
        for n in range(1, 4):
            page = doc.new_page()
            if n != 2:
                page.insert_text((72, 100), f'Body text on page {n}.', fontsize=11)
            page.insert_text((300, 800), str(n), fontsize=9)
        calls = []
        paras, report = pdf_cleaner.clean_pdf(doc, ocr_page=lambda i, p: calls.append(i) or 'x')
        self.assertEqual(calls, [])
        self.assertEqual(pdf_cleaner.to_text(paras).split(), 'Body text on page 1. Body text on page 3.'.split())

    def test_sideways_page_is_still_read(self):
        import pymupdf
        doc = pymupdf.open()
        page = doc.new_page()
        page.insert_text((300, 700), 'This whole page is printed sideways, like a landscape table.',
                         fontsize=11, rotate=90)
        paras, report = pdf_cleaner.clean_pdf(doc)
        self.assertIn('landscape table', pdf_cleaner.to_text(paras))


    def test_text_over_a_full_page_image_is_kept(self):
        """Scanned books with an OCR text layer: the scan covers the page, the text is real."""
        import pymupdf
        doc = pymupdf.open()
        page = doc.new_page()
        pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 60, 80), False)
        pix.clear_with(230)
        page.insert_image(page.rect, pixmap=pix)
        verse = ['The owl and the pussycat', 'went to sea', 'in a beautiful pea-green boat.',
                 'They took some honey', 'and plenty of money', 'wrapped up in a five-pound note.']
        for i, line in enumerate(verse):
            page.insert_text((72, 120 + 30 * i), line, fontsize=11)
        paras, report = pdf_cleaner.clean_pdf(doc)
        self.assertEqual(report.removed['figure label'], [])
        self.assertEqual(pdf_cleaner.to_text(paras).split(), ' '.join(verse).split())


class HyphenTests(unittest.TestCase):
    def join(self, prev, nxt, whole=(), hyphenated=()):
        return pdf_cleaner._join_hyphenated(prev, nxt, Counter(whole), Counter(hyphenated), pdf_cleaner.CleanReport())

    def test_syllable_break_is_joined(self):
        self.assertEqual(self.join('an algo-', 'rithm for'), 'an algorithm for')
        self.assertEqual(self.join('was pro-', 'fessional'), 'was professional')

    def test_compounds_keep_their_hyphen(self):
        self.assertEqual(self.join('a well-', 'known fact'), 'a well-known fact')
        self.assertEqual(self.join('a first-', 'aid kit', hyphenated={'first-aid': 1}), 'a first-aid kit')
        self.assertEqual(self.join('anti-', 'American'), 'anti-American')

    def test_document_vocabulary_wins(self):
        self.assertEqual(self.join('self-', 'ish', whole={'selfish': 2}), 'selfish')

    def test_soft_hyphen_at_line_end(self):
        line = pdf_cleaner._normalize_chars('an algo\u00ad')
        self.assertEqual(self.join(line, 'rithm for'), 'an algorithm for')
        self.assertEqual(pdf_cleaner._normalize_chars('in\u00advisible'), 'invisible')

    def test_not_a_hyphenated_line(self):
        self.assertIsNone(self.join('the year 1990-', '1995'))
        self.assertIsNone(self.join('ends here.', 'Next'))


class PageNumberTests(unittest.TestCase):
    def test_patterns(self):
        for s in ['12', '- 12 -', 'Page 3', 'page 3 of 40', '3 / 40', 'xii', '– 7 –']:
            self.assertTrue(pdf_cleaner._PAGE_NUMBER_RE.match(s), s)
        for s in ['12 Angry Men', 'Chapter 3', 'I am here', '1990s']:
            self.assertFalse(pdf_cleaner._PAGE_NUMBER_RE.match(s), s)


if __name__ == '__main__':
    unittest.main()
