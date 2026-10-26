"""Runs get_voice_engine.command against a stand-in for Hugging Face (needs bash and curl)."""

import http.server
import json
import os
import shutil
import subprocess
import tempfile
import threading
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(os.path.dirname(HERE), 'get_voice_engine.command')
MODEL = 'onnx-community/chatterbox-ONNX'

REPO = {
    # what the app needs
    'config.json': b'{"model_type": "chatterbox"}',
    'tokenizer.json': b'{"tok": 1}',
    'preprocessor_config.json': b'{}',
    'onnx/embed_tokens.onnx': os.urandom(3000),
    'onnx/speech_encoder.onnx': os.urandom(2000),
    'onnx/speech_encoder.onnx_data': os.urandom(250_000),
    'onnx/conditional_decoder.onnx': os.urandom(2000),
    'onnx/conditional_decoder.onnx_data': os.urandom(300_000),
    'onnx/conditional_decoder.onnx_data_1': os.urandom(100_000),
    'onnx/language_model_q4.onnx': os.urandom(4000),
    'onnx/language_model_q4f16.onnx': os.urandom(4000),
    'onnx/language_model_q4f16.onnx_data': os.urandom(200_000),
    # variants the app never loads
    'onnx/language_model.onnx': os.urandom(5000),
    'onnx/language_model_fp16.onnx': os.urandom(5000),
    'onnx/embed_tokens_quantized.onnx': os.urandom(1000),
    'README.md': b'# readme',
    '.gitattributes': b'*.onnx filter=lfs',
}
WANTED = {k for k in REPO if not k.startswith(('onnx/language_model.', 'onnx/language_model_fp16', 'onnx/embed_tokens_quantized')) and k not in ('README.md', '.gitattributes')}


class FakeHub(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path == f'/api/models/{MODEL}':
            body = json.dumps({'id': MODEL, 'siblings': [{'rfilename': k} for k in REPO]}).encode()
            self.send_response(200)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        prefix = f'/{MODEL}/resolve/main/'
        name = self.path[len(prefix):] if self.path.startswith(prefix) else None
        if name not in REPO:
            self.send_error(404)
            return
        data = REPO[name]
        start = 0
        rng = self.headers.get('Range')
        if rng and rng.startswith('bytes='):
            start = int(rng[6:].split('-')[0])
            if start >= len(data):
                self.send_response(416)
                self.send_header('Content-Range', f'bytes */{len(data)}')
                self.end_headers()
                return
            self.send_response(206)
            self.send_header('Content-Range', f'bytes {start}-{len(data) - 1}/{len(data)}')
        else:
            self.send_response(200)
        self.send_header('Content-Length', str(len(data) - start))
        self.end_headers()
        self.wfile.write(data[start:])
        self.server.served.append((name, start))


class GetVoiceEngineTests(unittest.TestCase):
    def setUp(self):
        self.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), FakeHub)
        self.server.served = []
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.tmp = tempfile.mkdtemp()
        self.dest = os.path.join(self.tmp, 'chatterbox-ONNX')

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        shutil.rmtree(self.tmp)

    def run_script(self):
        env = dict(os.environ, HF_ENDPOINT=f'http://127.0.0.1:{self.server.server_port}', VOICE_ENGINE_DIR=self.tmp,
                   NO_PROXY='127.0.0.1', no_proxy='127.0.0.1')
        return subprocess.run(['bash', SCRIPT], env=env, capture_output=True, text=True, timeout=60)

    def downloaded(self):
        found = set()
        for root, _, names in os.walk(self.dest):
            for n in names:
                found.add(os.path.relpath(os.path.join(root, n), self.dest))
        return found

    def test_fetches_exactly_what_the_app_needs(self):
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.downloaded(), WANTED)
        for name in WANTED:
            with open(os.path.join(self.dest, name), 'rb') as f:
                self.assertEqual(f.read(), REPO[name], name)
        self.assertIn('Done', result.stdout)

    def test_interrupted_download_carries_on(self):
        self.assertEqual(self.run_script().returncode, 0)
        big = 'onnx/conditional_decoder.onnx_data'
        os.remove(os.path.join(self.dest, big))
        with open(os.path.join(self.dest, big + '.part'), 'wb') as f:
            f.write(REPO[big][:120_000])  # as if the connection dropped part-way
        self.server.served.clear()
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.server.served, [(big, 120_000)], 'only the missing part is fetched')
        with open(os.path.join(self.dest, big), 'rb') as f:
            self.assertEqual(f.read(), REPO[big])
        self.assertEqual(self.downloaded(), WANTED)

    def test_second_run_downloads_nothing(self):
        self.assertEqual(self.run_script().returncode, 0)
        self.server.served.clear()
        result = self.run_script()
        self.assertEqual(result.returncode, 0)
        self.assertEqual(self.server.served, [])
        self.assertEqual(result.stdout.count('already here'), len(WANTED))

    def test_works_when_piped_into_bash(self):
        """The page tells people to run `curl -fsSL <url> | bash`, so bash reads the script from stdin."""
        env = dict(os.environ, HF_ENDPOINT=f'http://127.0.0.1:{self.server.server_port}', VOICE_ENGINE_DIR=self.tmp,
                   NO_PROXY='127.0.0.1', no_proxy='127.0.0.1')
        with open(SCRIPT) as f:
            result = subprocess.run(['bash'], input=f.read(), env=env, capture_output=True, text=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.downloaded(), WANTED)

    def test_unreachable_site_explains(self):
        self.server.shutdown()
        self.server.server_close()
        result = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Could not reach', result.stdout)


if __name__ == '__main__':
    unittest.main()
