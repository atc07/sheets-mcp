# Static server for the concept previews that tells browsers never to cache, so a reload always
# shows the latest files. Serves the repo root (concepts link to ../../site/ for shared assets).
#   python3 concepts/serve.py            # http://localhost:4175/concepts/rope/
import http.server, os, sys

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
port = int(sys.argv[1]) if len(sys.argv) > 1 else 4175
http.server.ThreadingHTTPServer(("", port), NoCache).serve_forever()
