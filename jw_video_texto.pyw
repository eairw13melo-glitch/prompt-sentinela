import tkinter as tk
from tkinter import ttk, filedialog, messagebox
import urllib.request, urllib.parse, urllib.error
import json, re, html as htmlmod, os, sys, threading, queue, pathlib, webbrowser
from datetime import datetime

APP_NAME = "JW Vídeo → Texto"
VERSION = "1.1.0"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36"
ALLOWED_HOSTS = ("jw.org", "www.jw.org", "wol.jw.org", "b.jw-cdn.org", "data.jw-api.org")
MEDIA_API = "https://b.jw-cdn.org/apis/mediator/v1/media-items/{lang}/{key}?clientType=www"
PUB_API = "https://b.jw-cdn.org/apis/pub-media/GETPUBMEDIALINKS"
PT_LANG = "T"


def app_dir():
    base = os.getenv("APPDATA") or os.path.expanduser("~")
    p = os.path.join(base, "JWVideoTexto")
    os.makedirs(p, exist_ok=True)
    return p

HISTORY_FILE = os.path.join(app_dir(), "history.json")


def request_bytes(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.6"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(), dict(r.headers), r.geturl()


def request_text(url, timeout=30):
    data, headers, final_url = request_bytes(url, timeout)
    charset = "utf-8"
    ct = headers.get("Content-Type", "")
    m = re.search(r"charset=([\w-]+)", ct, re.I)
    if m: charset = m.group(1)
    try:
        return data.decode(charset, errors="replace"), final_url
    except LookupError:
        return data.decode("utf-8", errors="replace"), final_url


def is_allowed_url(url):
    try:
        u = urllib.parse.urlparse(url)
        host = (u.hostname or "").lower()
        return u.scheme in ("http", "https") and (host == "jw.org" or host.endswith(".jw.org"))
    except Exception:
        return False


def unescape_url(s):
    s = htmlmod.unescape(s)
    s = s.replace("\\u002F", "/").replace("\\/", "/")
    return s


def extract_title(page):
    for pat in [r'<meta[^>]+property=["\']og:title["\'][^>]+content=["\']([^"\']+)',
                r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:title["\']',
                r'<title[^>]*>(.*?)</title>']:
        m = re.search(pat, page, re.I | re.S)
        if m:
            return re.sub(r"\s+", " ", htmlmod.unescape(m.group(1))).strip()
    return "Vídeo JW"


def walk_strings(obj):
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, dict):
        for k, v in obj.items():
            yield from walk_strings(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from walk_strings(v)


def collect_vtt_from_obj(obj):
    out = []
    for s in walk_strings(obj):
        s2 = unescape_url(s)
        if re.search(r"\.vtt(?:\?|$)", s2, re.I) and s2.startswith("http"):
            out.append(s2)
    return list(dict.fromkeys(out))


def collect_media_keys(page, url):
    text = unescape_url(page + " " + url)
    keys = set(re.findall(r"pub-[A-Za-z0-9-]+(?:_[A-Za-z0-9-]+)+_VIDEO", text))
    # URLs encoded as lank/item query params
    for raw in re.findall(r"(?:lank|item)=([^&\"'<> ]+)", text, re.I):
        val = urllib.parse.unquote(raw)
        if val.startswith("pub-") and val.endswith("_VIDEO"):
            keys.add(val)
    return sorted(keys)


def collect_docids(page, url):
    text = htmlmod.unescape(page + " " + url)
    ids = set(re.findall(r"(?:docid|docId)[=:\"'\s]+(\d{6,12})", text, re.I))
    return sorted(ids)


def api_media_vtts(keys, log):
    found = []
    for key in keys[:12]:
        api = MEDIA_API.format(lang=PT_LANG, key=urllib.parse.quote(key, safe="_-"))
        try:
            body, _ = request_text(api, 20)
            obj = json.loads(body)
            urls = collect_vtt_from_obj(obj)
            for u in urls:
                found.append((f"Legenda oficial · {key}", u, key))
            log(f"Catálogo: {key} → {len(urls)} faixa(s) de legenda.")
        except Exception as e:
            log(f"Catálogo: não foi possível consultar {key}: {e}")
    return found


def api_pub_vtts(docids, log):
    found = []
    for docid in docids[:8]:
        qs = urllib.parse.urlencode({
            "docid": docid, "output": "json", "fileformat": "MP4",
            "alllangs": "0", "track": "1", "langwritten": PT_LANG, "txtCMSLang": PT_LANG
        })
        try:
            body, _ = request_text(PUB_API + "?" + qs, 20)
            obj = json.loads(body)
            urls = collect_vtt_from_obj(obj)
            for u in urls:
                found.append((f"Legenda oficial · docid {docid}", u, f"docid-{docid}"))
            log(f"Publicação: docid {docid} → {len(urls)} faixa(s) de legenda.")
        except Exception as e:
            log(f"Publicação: falha em docid {docid}: {e}")
    return found


def direct_page_vtts(page, log):
    page2 = unescape_url(page)
    urls = re.findall(r'https?://[^\s"\'<>]+?\.vtt(?:\?[^\s"\'<>]*)?', page2, re.I)
    urls = list(dict.fromkeys(urls))
    log(f"Página: {len(urls)} link(s) VTT direto(s).")
    return [("Legenda encontrada na página", u, "page") for u in urls]


def clean_vtt(vtt):
    vtt = vtt.replace("\ufeff", "").replace("\r\n", "\n").replace("\r", "\n")
    lines = vtt.split("\n")
    out = []
    in_note = False
    for line in lines:
        s = line.strip()
        if not s:
            continue
        if s.upper().startswith("WEBVTT"):
            continue
        if s.startswith("NOTE") or s.startswith("STYLE") or s.startswith("REGION"):
            in_note = True
            continue
        if in_note:
            # NOTE/STYLE blocks end at blank; blank already skipped, so recognize timestamps/text resume
            if "-->" in s:
                in_note = False
            else:
                continue
        if "-->" in s:
            continue
        if re.fullmatch(r"\d+", s):
            continue
        s = re.sub(r"<[^>]+>", "", s)
        s = htmlmod.unescape(s)
        s = re.sub(r"\s+", " ", s).strip()
        if not s:
            continue
        if not out or s != out[-1]:
            out.append(s)
    # Join cues while preserving sentence readability.
    text = " ".join(out)
    text = re.sub(r"\s+([,.;:!?])", r"\1", text)
    text = re.sub(r"\s+", " ", text).strip()
    # Paragraphize after sentence endings; conservative to avoid overfragmentation.
    sentences = re.split(r"(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ0-9“\"])" , text)
    paras, buf = [], []
    for sent in sentences:
        buf.append(sent)
        if len(" ".join(buf)) >= 420:
            paras.append(" ".join(buf).strip())
            buf = []
    if buf: paras.append(" ".join(buf).strip())
    return "\n\n".join(paras)


def load_history():
    try:
        with open(HISTORY_FILE, "r", encoding="utf-8") as f:
            obj = json.load(f)
            return obj if isinstance(obj, list) else []
    except Exception:
        return []


def save_history(rows):
    tmp = HISTORY_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(rows[-100:], f, ensure_ascii=False, indent=2)
    os.replace(tmp, HISTORY_FILE)


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title(f"{APP_NAME} {VERSION}")
        self.geometry("1040x720")
        self.minsize(850, 600)
        self.configure(bg="#111111")
        self.q = queue.Queue()
        self.tracks = []
        self.current_title = ""
        self.current_url = ""
        self._styles()
        self._ui()
        self.after(120, self._poll)

    def _styles(self):
        style = ttk.Style(self)
        try: style.theme_use("clam")
        except Exception: pass
        style.configure("TFrame", background="#111111")
        style.configure("Card.TFrame", background="#1b1b1b")
        style.configure("TLabel", background="#111111", foreground="#e2e2e2", font=("Segoe UI", 10))
        style.configure("Card.TLabel", background="#1b1b1b", foreground="#e2e2e2", font=("Segoe UI", 10))
        style.configure("Title.TLabel", background="#111111", foreground="#ffffff", font=("Segoe UI Semibold", 20))
        style.configure("Sub.TLabel", background="#111111", foreground="#bdbdbd", font=("Segoe UI", 10))
        style.configure("TButton", padding=(12, 8), font=("Segoe UI Semibold", 10))
        style.map("TButton", background=[("active", "#ff3b2e")])
        style.configure("Accent.TButton", background="#ff1100", foreground="white")
        style.map("Accent.TButton", background=[("active", "#cc0e00")], foreground=[("active", "white")])
        style.configure("TCombobox", padding=6)

    def _ui(self):
        root = ttk.Frame(self, padding=18)
        root.pack(fill="both", expand=True)
        ttk.Label(root, text="JW Vídeo → Texto", style="Title.TLabel").pack(anchor="w")
        ttk.Label(root, text="Extrai texto das legendas oficiais disponíveis em vídeos públicos do JW.ORG/WOL.", style="Sub.TLabel").pack(anchor="w", pady=(2,14))

        card = ttk.Frame(root, style="Card.TFrame", padding=14)
        card.pack(fill="x")
        ttk.Label(card, text="Link do vídeo", style="Card.TLabel").pack(anchor="w")
        row = ttk.Frame(card, style="Card.TFrame")
        row.pack(fill="x", pady=(6,8))
        self.url_var = tk.StringVar()
        self.url_entry = ttk.Entry(row, textvariable=self.url_var, font=("Segoe UI", 10))
        self.url_entry.pack(side="left", fill="x", expand=True)
        ttk.Button(row, text="Colar", command=self.paste).pack(side="left", padx=(8,0))
        self.analyze_btn = ttk.Button(row, text="Analisar", style="Accent.TButton", command=self.analyze)
        self.analyze_btn.pack(side="left", padx=(8,0))

        row2 = ttk.Frame(card, style="Card.TFrame")
        row2.pack(fill="x")
        ttk.Label(row2, text="Legenda:", style="Card.TLabel").pack(side="left")
        self.track_var = tk.StringVar()
        self.track_combo = ttk.Combobox(row2, state="readonly", textvariable=self.track_var, width=55)
        self.track_combo.pack(side="left", padx=(8,8), fill="x", expand=True)
        self.extract_btn = ttk.Button(row2, text="Extrair texto", command=self.extract, state="disabled")
        self.extract_btn.pack(side="left")

        nb = ttk.Notebook(root)
        nb.pack(fill="both", expand=True, pady=(14,0))
        tab_text = ttk.Frame(nb, padding=10)
        tab_log = ttk.Frame(nb, padding=10)
        tab_hist = ttk.Frame(nb, padding=10)
        nb.add(tab_text, text="Texto")
        nb.add(tab_log, text="Diagnóstico")
        nb.add(tab_hist, text="Histórico")

        toolbar = ttk.Frame(tab_text)
        toolbar.pack(fill="x", pady=(0,8))
        self.info_var = tk.StringVar(value="Nenhum vídeo analisado.")
        ttk.Label(toolbar, textvariable=self.info_var).pack(side="left", fill="x", expand=True)
        ttk.Button(toolbar, text="Copiar", command=self.copy_text).pack(side="right", padx=(6,0))
        ttk.Button(toolbar, text="Salvar TXT", command=self.save_txt).pack(side="right", padx=(6,0))
        self.text = tk.Text(tab_text, wrap="word", bg="#171717", fg="#eeeeee", insertbackground="white", relief="flat", font=("Segoe UI", 11), padx=12, pady=12)
        self.text.pack(fill="both", expand=True)

        self.log = tk.Text(tab_log, wrap="word", bg="#171717", fg="#d6d6d6", relief="flat", font=("Consolas", 9), padx=10, pady=10)
        self.log.pack(fill="both", expand=True)

        histbar = ttk.Frame(tab_hist)
        histbar.pack(fill="x", pady=(0,8))
        ttk.Button(histbar, text="Atualizar", command=self.refresh_history).pack(side="left")
        ttk.Button(histbar, text="Exportar BKP", command=self.export_history).pack(side="left", padx=(6,0))
        ttk.Button(histbar, text="Importar BKP", command=self.import_history).pack(side="left", padx=(6,0))
        self.hist = tk.Listbox(tab_hist, bg="#171717", fg="#eeeeee", selectbackground="#ff1100", relief="flat", font=("Segoe UI", 10))
        self.hist.pack(fill="both", expand=True)
        self.hist.bind("<Double-1>", self.open_history)
        self.refresh_history()

        foot = ttk.Frame(root)
        foot.pack(fill="x", pady=(8,0))
        self.status_var = tk.StringVar(value="Pronto.")
        ttk.Label(foot, textvariable=self.status_var, style="Sub.TLabel").pack(side="left")
        ttk.Label(foot, text="Uso pessoal · somente conteúdo público", style="Sub.TLabel").pack(side="right")

    def emit(self, kind, value): self.q.put((kind, value))
    def _poll(self):
        try:
            while True:
                kind, value = self.q.get_nowait()
                if kind == "log": self._log(value)
                elif kind == "status": self.status_var.set(value)
                elif kind == "analysis": self._analysis_done(value)
                elif kind == "text": self._text_done(value)
                elif kind == "error":
                    self.status_var.set("Erro.")
                    messagebox.showerror(APP_NAME, value)
                    self.analyze_btn.config(state="normal")
                    self.extract_btn.config(state="normal" if self.tracks else "disabled")
        except queue.Empty: pass
        self.after(120, self._poll)

    def _log(self, msg):
        self.log.insert("end", f"[{datetime.now().strftime('%H:%M:%S')}] {msg}\n")
        self.log.see("end")

    def paste(self):
        try: self.url_var.set(self.clipboard_get().strip())
        except Exception: pass

    def analyze(self):
        url = self.url_var.get().strip()
        if not is_allowed_url(url):
            messagebox.showwarning(APP_NAME, "Cole um link público do jw.org ou wol.jw.org.")
            return
        self.analyze_btn.config(state="disabled")
        self.extract_btn.config(state="disabled")
        self.tracks = []
        self.track_combo["values"] = []
        self.track_var.set("")
        self.log.delete("1.0", "end")
        self.status_var.set("Analisando a página…")
        threading.Thread(target=self._analyze_worker, args=(url,), daemon=True).start()

    def _analyze_worker(self, url):
        try:
            self.emit("log", f"Abrindo: {url}")
            page, final_url = request_text(url)
            title = extract_title(page)
            self.emit("log", f"Página carregada: {title}")
            tracks = direct_page_vtts(page, lambda x:self.emit("log",x))
            keys = collect_media_keys(page, final_url)
            self.emit("log", f"IDs de mídia encontrados: {', '.join(keys) if keys else 'nenhum'}")
            tracks += api_media_vtts(keys, lambda x:self.emit("log",x))
            if not tracks:
                docids = collect_docids(page, final_url)
                self.emit("log", f"DocIDs encontrados: {', '.join(docids) if docids else 'nenhum'}")
                tracks += api_pub_vtts(docids, lambda x:self.emit("log",x))
            # dedupe by URL
            uniq, seen = [], set()
            for t in tracks:
                if t[1] not in seen:
                    seen.add(t[1]); uniq.append(t)
            self.emit("analysis", {"title": title, "url": final_url, "tracks": uniq})
        except urllib.error.HTTPError as e:
            self.emit("error", f"O site respondeu HTTP {e.code}. Verifique o link e tente novamente.")
        except Exception as e:
            self.emit("error", f"Não foi possível analisar o link.\n\n{e}")

    def _analysis_done(self, data):
        self.analyze_btn.config(state="normal")
        self.current_title, self.current_url, self.tracks = data["title"], data["url"], data["tracks"]
        if self.tracks:
            labels = [f"{i+1}. {t[0]}" for i,t in enumerate(self.tracks)]
            self.track_combo["values"] = labels
            self.track_combo.current(0)
            self.extract_btn.config(state="normal")
            self.status_var.set(f"{len(self.tracks)} faixa(s) de legenda encontrada(s).")
            self.info_var.set(self.current_title)
        else:
            self.status_var.set("Nenhuma legenda VTT pública foi localizada.")
            self.info_var.set(self.current_title)
            messagebox.showinfo(APP_NAME,
                "A página foi reconhecida, mas não encontrei uma faixa de legenda pública.\n\n"
                "Nesta v1.0 o aplicativo prioriza a legenda oficial do JW.ORG. "
                "Uma etapa futura pode acrescentar transcrição local do áudio para vídeos sem legenda.")

    def extract(self):
        idx = self.track_combo.current()
        if idx < 0 or idx >= len(self.tracks): return
        self.extract_btn.config(state="disabled")
        self.status_var.set("Baixando e convertendo a legenda…")
        threading.Thread(target=self._extract_worker, args=(self.tracks[idx],), daemon=True).start()

    def _extract_worker(self, track):
        try:
            raw, _ = request_text(track[1], 30)
            text = clean_vtt(raw)
            if not text.strip(): raise ValueError("A faixa de legenda foi baixada, mas não continha texto legível.")
            self.emit("text", {"text": text, "track": track})
        except Exception as e:
            self.emit("error", f"Falha ao extrair a legenda.\n\n{e}")

    def _text_done(self, data):
        self.extract_btn.config(state="normal")
        self.text.delete("1.0", "end")
        self.text.insert("1.0", data["text"])
        words = len(re.findall(r"\S+", data["text"]))
        self.info_var.set(f"{self.current_title} · {words} palavras")
        self.status_var.set("Texto extraído com sucesso.")
        rows = load_history()
        rows.append({"date": datetime.now().isoformat(timespec="seconds"), "title": self.current_title,
                     "url": self.current_url, "track": data["track"][0], "text": data["text"]})
        save_history(rows)
        self.refresh_history()

    def copy_text(self):
        t = self.text.get("1.0", "end").strip()
        if not t: return
        self.clipboard_clear(); self.clipboard_append(t)
        self.status_var.set("Texto copiado.")

    def save_txt(self):
        t = self.text.get("1.0", "end").strip()
        if not t: return
        safe = re.sub(r"[^\w\- ]+", "", self.current_title, flags=re.UNICODE).strip()[:80] or "transcricao"
        p = filedialog.asksaveasfilename(defaultextension=".txt", initialfile=safe + ".txt", filetypes=[("Texto UTF-8","*.txt")])
        if p:
            with open(p, "w", encoding="utf-8-sig") as f: f.write(t + "\n")
            self.status_var.set(f"Salvo: {p}")

    def refresh_history(self):
        self.hist.delete(0, "end")
        rows = load_history()
        for r in reversed(rows):
            dt = r.get("date", "")[:16].replace("T", " ")
            self.hist.insert("end", f"{dt}  ·  {r.get('title','Vídeo')}")

    def open_history(self, event=None):
        sel = self.hist.curselection()
        if not sel: return
        rows = load_history()
        r = list(reversed(rows))[sel[0]]
        self.current_title = r.get("title", "Vídeo")
        self.current_url = r.get("url", "")
        self.url_var.set(self.current_url)
        self.text.delete("1.0", "end"); self.text.insert("1.0", r.get("text", ""))
        self.info_var.set(self.current_title + " · histórico")

    def export_history(self):
        rows = load_history()
        p = filedialog.asksaveasfilename(defaultextension=".json", initialfile=f"JW-Video-Texto-BKP-{datetime.now():%Y%m%d}.json", filetypes=[("BKP JSON","*.json")])
        if not p: return
        payload = {"app": APP_NAME, "version": VERSION, "exportedAt": datetime.now().isoformat(), "history": rows}
        with open(p, "w", encoding="utf-8") as f: json.dump(payload, f, ensure_ascii=False, indent=2)
        self.status_var.set("BKP exportado.")

    def import_history(self):
        p = filedialog.askopenfilename(filetypes=[("BKP JSON","*.json")])
        if not p: return
        try:
            with open(p, "r", encoding="utf-8-sig") as f: obj = json.load(f)
            incoming = obj.get("history") if isinstance(obj, dict) else None
            if not isinstance(incoming, list): raise ValueError("Arquivo não é um BKP válido deste aplicativo.")
            current = load_history()
            seen = {(r.get("url"), r.get("text")) for r in current}
            added = 0
            for r in incoming:
                key = (r.get("url"), r.get("text"))
                if key not in seen:
                    current.append(r); seen.add(key); added += 1
            save_history(current)
            self.refresh_history()
            messagebox.showinfo(APP_NAME, f"BKP importado. {added} registro(s) novo(s), sem duplicar os já existentes.")
        except Exception as e:
            messagebox.showerror(APP_NAME, f"Não foi possível importar o BKP.\n\n{e}")

if __name__ == "__main__":
    App().mainloop()
