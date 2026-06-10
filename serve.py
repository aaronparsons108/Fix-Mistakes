#!/usr/bin/env python3
"""Serve Blunder Lab locally: python serve.py [port]

A drop-in replacement for `python -m http.server` that always sends correct
MIME types. On Windows, the stock http.server reads types from the registry,
which often mislabels .css/.js as text/plain — Chrome then refuses to apply
the stylesheet and blocks the ES modules, leaving the page unstyled and dead.
"""

import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
        '.wasm': 'application/wasm',
        '.json': 'application/json',
        '.png': 'image/png',
        '.svg': 'image/svg+xml',
        '': 'application/octet-stream',
    }

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')  # always pick up fresh pulls
        super().end_headers()


if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    print(f'Blunder Lab → http://127.0.0.1:{PORT}')
    http.server.ThreadingHTTPServer(('', PORT), Handler).serve_forever()
