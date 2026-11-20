#!/usr/bin/env python3
"""
dev_preview_server.py - Local Desktop/Browser Simulator for Antigravity iOS.
Emulates the exact Swift WKWebView `agyNative` bridge (`NativeFileSystemBridge.swift`
and `OAuthLoopbackServer.swift`) so you can test the iOS app UI, Google OAuth 2.0 login,
dynamic tier model selector, on-device `git clone`, Folder Picker, and `/grill-me`
locally on Linux/macOS before pushing to GitHub Actions to compile `antigravity-ios.ipa`.
"""

import base64
import http.server
import json
import os
import shutil
import socketserver
import threading
import urllib.parse
import urllib.request
import webbrowser
from pathlib import Path

PORT = int(os.environ.get("PORT", "8765"))
ROOT_DIR = Path(__file__).parent.resolve()
WEB_DIR = ROOT_DIR / "web"
SIM_DOCS_DIR = ROOT_DIR / ".ios_simulator_documents"
SIM_PROJECTS_DIR = SIM_DOCS_DIR / "projects"

OAUTH_CLIENT_ID = os.environ.get("AGY_OAUTH_CLIENT_ID", "").strip()
OAUTH_CLIENT_SECRET = os.environ.get("AGY_OAUTH_CLIENT_SECRET", "").strip()
OAUTH_SCOPES = " ".join([
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/cclog",
    "https://www.googleapis.com/auth/experimentsandconfigs",
])


def resolve_sim_path(raw: str) -> Path:
    SIM_PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
    s = (raw or "").strip()
    if not s or s in ("~", "~/Documents"):
        return SIM_DOCS_DIR
    if s.startswith("~/Documents/"):
        return SIM_DOCS_DIR / s[len("~/Documents/"):]
    if s.startswith("~/"):
        return SIM_DOCS_DIR / s[2:]
    p = Path(s)
    if p.is_absolute() and str(p).startswith(str(SIM_DOCS_DIR)):
        return p
    return SIM_DOCS_DIR / s.lstrip("/")


def run_desktop_google_oauth(client_id: str = "", client_secret: str = "") -> dict:
    cid = (client_id or OAUTH_CLIENT_ID).strip()
    csec = (client_secret or OAUTH_CLIENT_SECRET).strip()
    if not cid:
        return {"ok": False, "error": "Chưa cấu hình AGY_OAUTH_CLIENT_ID (set env AGY_OAUTH_CLIENT_ID hoặc nhập trong Account Settings)."}
    result_holder = {}
    done_event = threading.Event()

    class CallbackHandler(http.server.BaseHTTPRequestHandler):
        def log_message(self, format, *args):
            pass

        def do_GET(self):
            parsed = urllib.parse.urlparse(self.path)
            qs = urllib.parse.parse_qs(parsed.query)
            code = qs.get("code", [None])[0]
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(
                b"<html><body style='background:#090d16;color:#fff;font-family:sans-serif;text-align:center;padding-top:20vh;'>"
                b"<h2>&#9889; Antigravity OAuth Sign-In Successful!</h2><p>You can close this tab.</p></body></html>"
            )
            result_holder["code"] = code
            done_event.set()

    with socketserver.TCPServer(("127.0.0.1", 0), CallbackHandler) as httpd:
        cb_port = httpd.server_address[1]
        redirect_uri = f"http://localhost:{cb_port}/oauth-callback"
        auth_url = (
            "https://accounts.google.com/o/oauth2/v2/auth?"
            + urllib.parse.urlencode({
                "client_id": cid,
                "redirect_uri": redirect_uri,
                "response_type": "code",
                "scope": OAUTH_SCOPES,
                "access_type": "offline",
                "prompt": "consent",
            })
        )
        print(f"[OAuth] Opening browser for Google Sign-In: {auth_url}", flush=True)
        webbrowser.open(auth_url)
        httpd.timeout = 120
        httpd.handle_request()

    code = result_holder.get("code")
    if not code:
        return {"ok": False, "error": "OAuth timed out or cancelled"}

    token_params = {
        "code": code,
        "client_id": cid,
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code",
    }
    if csec:
        token_params["client_secret"] = csec
    token_data = urllib.parse.urlencode(token_params).encode("utf-8")

    req = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=token_data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        tok = json.loads(resp.read().decode("utf-8"))
        return {"ok": True, "token": tok}


def handle_native_action(action: str, payload: dict) -> dict:
    SIM_PROJECTS_DIR.mkdir(parents=True, exist_ok=True)

    if action == "getEnv":
        return {
            "ok": True,
            "documentsPath": str(SIM_DOCS_DIR),
            "projectsPath": str(SIM_PROJECTS_DIR),
            "platform": "ios-simulator",
            "oauthClientId": OAUTH_CLIENT_ID,
            "oauthClientSecret": OAUTH_CLIENT_SECRET,
        }

    if action == "startGoogleOAuth":
        try:
            return run_desktop_google_oauth(
                payload.get("clientId", ""),
                payload.get("clientSecret", ""),
            )
        except Exception as e:
            return {"ok": False, "error": str(e)}

    if action == "listDir":
        target = resolve_sim_path(payload.get("path", ""))
        if not target.is_dir():
            return {"ok": False, "error": f"Not a directory: {target}"}
        entries = []
        for item in sorted(target.iterdir(), key=lambda x: x.name):
            entries.append({
                "name": item.name,
                "path": str(item),
                "isDir": item.is_dir(),
                "size": item.stat().st_size if item.is_file() else 0,
            })
        return {"ok": True, "path": str(target), "entries": entries}

    if action == "mkdir":
        target = resolve_sim_path(payload.get("path", ""))
        target.mkdir(parents=True, exist_ok=True)
        return {"ok": True, "path": str(target)}

    if action == "readFile":
        target = resolve_sim_path(payload.get("path", ""))
        if not target.is_file():
            return {"ok": False, "error": f"File not found: {target}"}
        raw = target.read_bytes()
        if payload.get("encoding") == "base64":
            return {"ok": True, "data": base64.b64encode(raw).decode("ascii"), "size": len(raw)}
        return {"ok": True, "content": raw.decode("utf-8", errors="replace"), "size": len(raw)}

    if action == "writeFile":
        target = resolve_sim_path(payload.get("path", ""))
        target.parent.mkdir(parents=True, exist_ok=True)
        if "base64" in payload and payload["base64"]:
            target.write_bytes(base64.b64decode(payload["base64"]))
        else:
            target.write_text(str(payload.get("content", "")), encoding="utf-8")
        return {"ok": True, "path": str(target)}

    if action == "deletePath":
        target = resolve_sim_path(payload.get("path", ""))
        if target.is_dir():
            shutil.rmtree(target, ignore_errors=True)
        elif target.exists():
            target.unlink()
        return {"ok": True}

    if action == "stat":
        target = resolve_sim_path(payload.get("path", ""))
        exists = target.exists()
        return {
            "ok": True,
            "exists": exists,
            "isDir": target.is_dir() if exists else False,
            "size": target.stat().st_size if (exists and target.is_file()) else 0,
            "path": str(target),
        }

    if action == "httpProxy":
        url = payload.get("url", "")
        method = payload.get("method", "GET")
        headers = payload.get("headers") or {}
        body = None
        if payload.get("bodyBase64"):
            body = base64.b64decode(payload["bodyBase64"])
        elif payload.get("body") is not None:
            body = str(payload["body"]).encode("utf-8")

        req = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                raw_resp = resp.read()
                status = resp.status
                resp_headers = {k.lower(): v for k, v in resp.headers.items()}
        except urllib.error.HTTPError as he:
            raw_resp = he.read()
            status = he.code
            resp_headers = {k.lower(): v for k, v in he.headers.items()}
        except Exception as e:
            return {"ok": False, "error": str(e)}

        if payload.get("responseType") == "base64":
            return {
                "ok": True,
                "status": status,
                "headers": resp_headers,
                "bodyBase64": base64.b64encode(raw_resp).decode("ascii"),
            }
        return {
            "ok": True,
            "status": status,
            "headers": resp_headers,
            "body": raw_resp.decode("utf-8", errors="replace"),
        }

    return {"ok": False, "error": f"Unknown action: {action}"}


class DevHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    def log_message(self, format, *args):
        pass

    def do_POST(self):
        if self.path == "/api/native":
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length).decode("utf-8"))
            res = handle_native_action(body.get("action", ""), body.get("payload") or {})
            out = json.dumps(res).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(out)))
            self.end_headers()
            self.wfile.write(out)
            return
        self.send_error(404)


if __name__ == "__main__":
    SIM_PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
    print(f"⚡ Antigravity for iOS Simulator running at http://127.0.0.1:{PORT}")
    print(f"📂 Simulated iPhone Documents directory: {SIM_DOCS_DIR}")
    with socketserver.ThreadingTCPServer(("127.0.0.1", PORT), DevHandler) as httpd:
        httpd.allow_reuse_address = True
        httpd.serve_forever()
