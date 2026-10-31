#!/usr/bin/env python3
"""A1111-compatible bridge for MFLUX: AgenticDesigner posts to
127.0.0.1:7860/sdapi/v1/txt2img and gets FLUX images generated on MLX.
Run: python3 mflux_bridge.py"""
import base64, json, subprocess, tempfile, os
from http.server import HTTPServer, BaseHTTPRequestHandler

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/sdapi/v1/txt2img":
            self.send_response(404); self.end_headers(); return
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        # FLUX needs dimensions in multiples of 16
        w = max(256, (int(body.get("width", 1024)) // 16) * 16)
        h = max(256, (int(body.get("height", 1024)) // 16) * 16)
        out = tempfile.mktemp(suffix=".png")
        mflux = os.path.expanduser("~/.mflux-venv/bin/mflux-generate")
        if not os.path.exists(mflux):
            mflux = "mflux-generate"
        # Ungated pre-quantized community mirror — no HF license gate needed
        cmd = [mflux, "--model", "dhairyashil/FLUX.1-schnell-mflux-4bit",
               "--base-model", "schnell",
               "--steps", "3", "--width", str(w), "--height", str(h),
               "--prompt", body.get("prompt", "")[:2000], "--output", out]
        print(f"generating {w}x{h}...", flush=True)
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        if not os.path.exists(out):
            print("FAILED:", r.stderr[-500:], flush=True)
            self.send_response(500); self.end_headers()
            self.wfile.write(r.stderr[-500:].encode()); return
        with open(out, "rb") as f:
            b64 = base64.b64encode(f.read()).decode()
        os.remove(out)
        resp = json.dumps({"images": [b64]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(resp)
        print("done", flush=True)

    def log_message(self, *a): pass

if __name__ == "__main__":
    print("MFLUX bridge listening on 127.0.0.1:7860", flush=True)
    HTTPServer(("127.0.0.1", 7860), Handler).serve_forever()
