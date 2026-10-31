"""Persistent localhost worker for Helsinki-NLP/opus-mt-en-he."""

import json
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL_ID = "Helsinki-NLP/opus-mt-en-he"
PORT = 17841
model = None
tokenizer = None
load_lock = threading.Lock()
inference_lock = threading.Lock()


def load_model():
    global model, tokenizer
    with load_lock:
        if model is not None:
            return
        from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

        tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
        model = AutoModelForSeq2SeqLM.from_pretrained(MODEL_ID)
        model.eval()


def translation_chunks(text, max_words=60):
    """Complete sentences ONLY — Marian hallucinates on dangling fragments
    (word-count cuts mid-sentence produce wiki-markup boilerplate and
    invented phrases). A sentence is split further only at clause commas,
    and only when it alone exceeds the budget."""
    sentences = re.split(r"(?<=[.!?;:])\s+", text.strip())
    chunks = []
    for sentence in sentences:
        sentence = sentence.strip()
        if not sentence:
            continue
        if len(sentence.split()) <= max_words:
            chunks.append(sentence)
            continue
        current = []
        for clause in re.split(r"(?<=,)\s+", sentence):
            words = clause.split()
            if current and len(current) + len(words) > max_words:
                chunks.append(" ".join(current))
                current = []
            current.extend(words)
        if current:
            chunks.append(" ".join(current))
    return chunks


def normalize_source(text):
    """Strip what Marian was never trained on: combining math accents
    (vector arrows), typographic dashes/quotes, doubled spaces."""
    text = "".join(ch for ch in text if not (0x20D0 <= ord(ch) <= 0x20FF))
    text = text.replace("–", "-").replace("—", "-")
    text = text.replace("“", '"').replace("”", '"').replace("’", "'")
    return re.sub(r"\s+", " ", text).strip()


def looks_sane(source, translated):
    """Reject hallucinations: wiki markup, too little Hebrew, wild length."""
    if "==" in translated or "'''" in translated:
        return False
    hebrew = sum(1 for ch in translated if "א" <= ch <= "ת")
    if hebrew < max(1, len(translated) * 0.3):
        return False
    ratio = len(translated) / max(1, len(source))
    return 0.35 <= ratio <= 3.0


def normalize_domain_terms(source, translated):
    if re.search(r"\bmachine learning\b", source, re.IGNORECASE):
        for variant in (
            "למידה של מכונות",
            "למידה של מכונה",
            "לימוד של מכונות",
            "לימוד של מכונה",
            "לימודי מכונות",
            "לימוד מכונות",
            "למידה מכונה",
        ):
            translated = translated.replace(variant, "למידת מכונה")
    if re.search(r"\bpractitioner(s)?\b", source, re.IGNORECASE):
        translated = translated.replace("מהרופא", "מהעוסק בתחום")
        translated = translated.replace("שרופא", "שעוסק בתחום")
        translated = translated.replace("הרופא", "העוסק בתחום")
    return translated


def translate(text):
    load_model()
    with inference_lock:
        translations = []
        for chunk in translation_chunks(normalize_source(text)):
            inputs = tokenizer(chunk, return_tensors="pt", truncation=True, max_length=512)
            # Beam search with a repetition guard tames Marian's drift on
            # hard inputs; it's a 78M-param model, the cost is negligible.
            output = model.generate(
                **inputs,
                max_new_tokens=384,
                num_beams=4,
                no_repeat_ngram_size=3,
                renormalize_logits=True,
            )
            translated = tokenizer.decode(output[0], skip_special_tokens=True).strip()
            if looks_sane(chunk, translated):
                translations.append(normalize_domain_terms(chunk, translated))
            else:
                # Garbage out -> keep the English chunk; the caller's layout
                # still typesets it, and readable English beats hallucination.
                translations.append(chunk)
        return " ".join(filter(None, translations))


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self.respond(200, {"status": "ok", "model_loaded": model is not None})
        else:
            self.respond(404, {"error": "Not found"})

    def do_POST(self):
        if self.path != "/translate":
            self.respond(404, {"error": "Not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length))
            text = payload.get("text", "").strip()
            if not text:
                raise ValueError("Translation text is empty")
            self.respond(200, {"translation": translate(text)})
        except Exception as error:
            self.respond(500, {"error": str(error)})

    def respond(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
