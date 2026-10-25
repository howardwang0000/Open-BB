#!/usr/bin/env python3
"""
Install the PDF-cleaning and smooth-join fixes into an ebook2audiobook checkout.

    python3 patch_ebook2audiobook.py path/to/ebook2audiobook

Safe to run more than once. Every edit is checked against the exact upstream code
it replaces; if upstream has changed, nothing is modified and the script says so.
Written against ebook2audiobook v26.10.1 (commit 0a98ac3), which setup_mac.sh pins.
"""

from __future__ import annotations

import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

COPIES = {
    'pdf_cleaner.py': 'lib/classes/pdf_cleaner.py',
    'smooth_joins.py': 'lib/classes/tts_engines/common/smooth_joins.py',
}

# (file, upstream code, replacement). A second run sees the replacement is
# already there and skips it.
EDITS = [
    # 1. PDFs go through pdf_cleaner instead of a raw page-by-page text dump.
    ('lib/core.py',
     """                xhtml_pages = []
                for i, page in enumerate(doc):
                    has_text = page.get_text('text').strip()
                    if has_text:
                        try:
                            xhtml_content = page.get_text('xhtml').strip()
                        except Exception as e:
                            print(f'Error extracting text from page {i+1}: {e}')
                            xhtml_content = ''
                        error = None
                    else:
                        xhtml_content = ''
                        error = None
                    if not xhtml_content:
                        msg = legends['msg_page_image_ocr'].format(page=i+1)
                        show_alert(session_id, {"type": "warning", "msg": msg})
                        pix = page.get_pixmap(dpi=300)
                        img = Image.open(io.BytesIO(pix.tobytes('png')))
                        xhtml_content, error = ocr2xhtml(img, session['language'])
                    if xhtml_content:
                        xhtml_pages.append(xhtml_content)
                    else:
                        show_alert(session_id, {"type": "warning", "msg": error})
""",
     """                # voice-audiobook: remove headers, footers, page numbers and footnotes,
                # re-join hyphenated words and read multi-column pages in the right order.
                from lib.classes.pdf_cleaner import clean_pdf, to_xhtml_body

                def _ocr_page(i, page):
                    msg = legends['msg_page_image_ocr'].format(page=i+1)
                    show_alert(session_id, {"type": "warning", "msg": msg})
                    pix = page.get_pixmap(dpi=300)
                    img = Image.open(io.BytesIO(pix.tobytes('png')))
                    xhtml_content, error = ocr2xhtml(img, session['language'])
                    if not xhtml_content:
                        show_alert(session_id, {"type": "warning", "msg": error})
                    return xhtml_content or ''

                paragraphs, clean_report = clean_pdf(doc, ocr_page=_ocr_page)
                print(f'PDF cleaned: {clean_report.summary()}')
                xhtml_pages = [to_xhtml_body(paragraphs)] if paragraphs else []
"""),

    # 2. XTTS: every generated clip is trimmed, faded, levelled and followed by a
    #    punctuation-aware pause, instead of a raw cut plus a random silence.
    ('lib/classes/tts_engines/xtts.py',
     """            from lib.classes.tts_engines.common.audio import trim_audio, is_audio_data_valid
""",
     """            from lib.classes.tts_engines.common.audio import trim_audio, is_audio_data_valid
            from lib.classes.tts_engines.common.smooth_joins import smooth_part  # voice-audiobook
"""),
    ('lib/classes/tts_engines/xtts.py',
     """                self.audio_segments = []
                for part in sentence_parts:
""",
     """                self.audio_segments = []
                self.params.setdefault('pending_pause', 0)  # voice-audiobook: silence already at the end
                for part in sentence_parts:
"""),
    ('lib/classes/tts_engines/xtts.py',
     """                        trim_audio_buffer = 0.006
                        if part.endswith("'"):
""",
     """                        trim_audio_buffer = 0.006
                        spoken_text = part  # voice-audiobook: original text decides the pause
                        if part.endswith("'"):
"""),
    ('lib/classes/tts_engines/xtts.py',
     """                                    if part[-1].isalnum() or part[-1] == '—':
                                        part_tensor = trim_audio(part_tensor.squeeze(), self.params['samplerate'], 0.001, trim_audio_buffer).unsqueeze(0)
                                    self.audio_segments.append(part_tensor)
                                    if not re.search(r'\\w$', part, flags=re.UNICODE) and part[-1] != '—':
                                        silence_time = int(np.random.uniform(0.3, 0.6) * 100) / 100
                                        self.audio_segments.append(torch.zeros(1, int(self.params['samplerate'] * silence_time)))
""",
     """                                    # voice-audiobook: smooth join (trim, fade, level, then a natural pause)
                                    part_tensor, pause_tensor = smooth_part(part_tensor, self.params['samplerate'], spoken_text)
                                    self.audio_segments.append(part_tensor)
                                    self.audio_segments.append(pause_tensor)
                                    self.params['pending_pause'] = pause_tensor.shape[-1]
"""),

    # 3. Paragraph/heading pauses replace the sentence pause instead of stacking on it.
    ('lib/classes/tts_engines/common/utils.py',
     """        assert tag in TTS_SML, f'Unknown SML tag: {tag!r}'
""",
     """        assert tag in TTS_SML, f'Unknown SML tag: {tag!r}'
        if tag in ('break', 'pause') and 'pending_pause' in self.params:  # voice-audiobook
            from lib.classes.tts_engines.common.smooth_joins import structural_pause
            silence, self.params['pending_pause'] = structural_pause(tag, value, self.params['samplerate'], self.params['pending_pause'])
            self.audio_segments.append(silence)
            return True, None
"""),
]


def _read(path: str) -> str:
    # newline='' keeps the file byte-for-byte (upstream mixes line-ending styles).
    with open(path, encoding='utf-8', newline='') as f:
        return f.read()


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__)
        return 2
    root = os.path.abspath(argv[1])
    if not os.path.isfile(os.path.join(root, 'lib', 'core.py')):
        print(f'error: {root} does not look like an ebook2audiobook folder (no lib/core.py)')
        return 1

    # Check every edit before touching anything.
    contents: dict[str, str] = {}
    pending = []
    for rel, old, new in EDITS:
        path = os.path.join(root, rel)
        text = contents.setdefault(rel, _read(path))
        if new in text:
            continue
        if text.count(old) != 1:
            print(f'error: {rel} is not the version this patch was written for.\n'
                  f'       Use ebook2audiobook v26.10.1 (setup_mac.sh does this for you).')
            return 1
        pending.append((rel, old, new))

    for src, dst in COPIES.items():
        shutil.copyfile(os.path.join(HERE, src), os.path.join(root, dst))
        print(f'copied   {dst}')
    for rel, old, new in pending:
        contents[rel] = contents[rel].replace(old, new)
    for rel in {rel for rel, _, _ in pending}:
        with open(os.path.join(root, rel), 'w', encoding='utf-8', newline='') as f:
            f.write(contents[rel])
        print(f'patched  {rel}')
    if not pending:
        print('already patched - nothing to do')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
