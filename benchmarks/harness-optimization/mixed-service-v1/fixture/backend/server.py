import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from quote import quote

class Handler(BaseHTTPRequestHandler):
    def send_json(self, status, value):
        data = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)
    def do_GET(self):
        self.send_json(200 if self.path == "/ready" else 404, {"service": "python"})
    def do_POST(self):
        if self.path != "/api/quote":
            self.send_json(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 4096:
                raise ValueError("invalid body size")
            body = json.loads(self.rfile.read(length))
            value = quote(body["seats"], body["capacity"], body["used"])
        except (ValueError, KeyError, TypeError):
            self.send_json(400, {"error": "invalid quote input"})
            return
        self.send_json(200, value)

ThreadingHTTPServer(("127.0.0.1", 8091), Handler).serve_forever()
