#!/usr/bin/env python3
"""Servidor local do Extrator A Sentinela.

Serve os arquivos da plataforma e oferece um proxy restrito para imagens dos
domínios oficiais jw.org e jw-cdn.org. Usa apenas a biblioteca padrão do Python.
"""
from __future__ import annotations

import http.server
import io
import os
import socket
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from pathlib import Path

HOST = "127.0.0.1"
START_PORT = 8765
END_PORT = 8795
MAX_IMAGE_BYTES = 35 * 1024 * 1024
ALLOWED_SUFFIXES = ("jw.org", "jw-cdn.org")
BASE_DIR = Path(__file__).resolve().parent


def is_allowed_host(hostname: str | None) -> bool:
    host = (hostname or "").lower().rstrip(".")
    return any(host == suffix or host.endswith("." + suffix) for suffix in ALLOWED_SUFFIXES)


def validate_remote_url(url: str) -> str:
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https":
        raise ValueError("Somente endereços HTTPS são permitidos.")
    if not is_allowed_host(parsed.hostname):
        raise ValueError("O endereço não pertence a um domínio oficial permitido.")
    if parsed.username or parsed.password:
        raise ValueError("Endereço com credenciais não é permitido.")
    return urllib.parse.urlunsplit(parsed)


class SafeRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        validated = validate_remote_url(urllib.parse.urljoin(req.full_url, newurl))
        return super().redirect_request(req, fp, code, msg, headers, validated)


class Handler(http.server.SimpleHTTPRequestHandler):
    server_version = "SentinelaLocal/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        super().end_headers()

    def log_message(self, fmt, *args):
        # Mantém o terminal legível, sem imprimir URLs completas das imagens.
        message = fmt % args
        if "/__image_proxy" in message:
            message = message.split("?", 1)[0] + ' HTTP/1.1"'
        print(f"[{self.log_date_time_string()}] {message}")

    def do_GET(self):
        parsed = urllib.parse.urlsplit(self.path)
        if parsed.path == "/__health":
            self._send_bytes(200, b"ok", "text/plain; charset=utf-8", cache=False)
            return
        if parsed.path == "/__image_proxy":
            self._proxy_image(parsed.query)
            return
        super().do_GET()

    def _proxy_image(self, query: str):
        params = urllib.parse.parse_qs(query)
        raw_url = (params.get("url") or [""])[0]
        try:
            remote_url = validate_remote_url(raw_url)
            opener = urllib.request.build_opener(SafeRedirectHandler())
            request = urllib.request.Request(
                remote_url,
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/142 Safari/537.36",
                    "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
                    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.7",
                    "Referer": "https://wol.jw.org/",
                },
            )
            with opener.open(request, timeout=45) as response:
                final_url = validate_remote_url(response.geturl())
                declared_length = response.headers.get("Content-Length")
                if declared_length and int(declared_length) > MAX_IMAGE_BYTES:
                    raise ValueError("A imagem ultrapassa o limite de 35 MB.")
                data = response.read(MAX_IMAGE_BYTES + 1)
                if len(data) > MAX_IMAGE_BYTES:
                    raise ValueError("A imagem ultrapassa o limite de 35 MB.")
                content_type = (response.headers.get_content_type() or "application/octet-stream").lower()
                # Alguns endpoints não informam image/*; o navegador fará a detecção por assinatura.
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Cache-Control", "private, max-age=86400")
                self.send_header("X-Image-Final-Url", final_url)
                self.end_headers()
                self.wfile.write(data)
        except urllib.error.HTTPError as exc:
            self._send_error_text(exc.code, f"O servidor de imagens respondeu HTTP {exc.code}.")
        except urllib.error.URLError as exc:
            detail = getattr(exc, "reason", exc)
            self._send_error_text(502, f"Não foi possível acessar a imagem: {detail}")
        except (ValueError, TimeoutError) as exc:
            self._send_error_text(400, str(exc))
        except Exception as exc:  # proteção final para manter o servidor vivo
            self._send_error_text(500, f"Falha inesperada ao baixar a imagem: {exc}")

    def _send_error_text(self, status: int, message: str):
        self._send_bytes(status, message.encode("utf-8", errors="replace"), "text/plain; charset=utf-8", cache=False)

    def _send_bytes(self, status: int, data: bytes, content_type: str, cache: bool):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "private, max-age=300" if cache else "no-store")
        self.end_headers()
        self.wfile.write(data)


def find_port() -> int:
    for port in range(START_PORT, END_PORT + 1):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            try:
                sock.bind((HOST, port))
                return port
            except OSError:
                continue
    raise RuntimeError("Nenhuma porta local disponível entre 8765 e 8795.")


def main() -> int:
    os.chdir(BASE_DIR)
    port = find_port()
    server = http.server.ThreadingHTTPServer((HOST, port), Handler)
    server.daemon_threads = True
    url = f"http://{HOST}:{port}/index.html"

    print("=" * 68)
    print(" EXTRATOR A SENTINELA — SERVIDOR LOCAL DE IMAGENS")
    print("=" * 68)
    print(f"Sistema aberto em: {url}")
    print("Mantenha esta janela aberta enquanto estiver usando a plataforma.")
    print("Para encerrar, pressione Ctrl+C ou feche esta janela.")
    print("=" * 68)

    threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever(poll_interval=0.3)
    except KeyboardInterrupt:
        print("\nEncerrando o servidor local...")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
