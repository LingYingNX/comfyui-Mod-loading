import json
import re
import sqlite3
from contextlib import closing
from html.parser import HTMLParser
from pathlib import Path


def read_json(path: Path | str) -> dict:
    if not path.exists() or not path.is_file():
        return {}
    encodings = ["utf8", "gbk"]
    for encoding in encodings:
        try:
            return json.loads(Path(path).read_text(encoding=encoding))
        except UnicodeDecodeError:
            continue
    return {}


def find_lora_manager_metadata(db_path: Path | str, file_hash: str) -> dict:
    """Read model metadata from a Lora Manager SQLite cache by SHA256."""
    db_path = Path(db_path)
    digest = str(file_hash or "").strip().lower()
    if not digest or not db_path.is_file():
        return {}

    try:
        with closing(sqlite3.connect(f"{db_path.as_uri()}?mode=ro", uri=True, timeout=1)) as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                """
                SELECT civitai_id, civitai_model_id, civitai_name, model_name, base_model, trained_words
                FROM models
                WHERE sha256 = ?
                LIMIT 1
                """,
                (digest,),
            ).fetchone()
    except (OSError, sqlite3.Error):
        return {}
    if row is None:
        return {}

    try:
        words = json.loads(row["trained_words"] or "[]")
    except (TypeError, ValueError):
        words = []
    if not isinstance(words, list):
        words = []
    words = [word.strip() for word in words if isinstance(word, str) and word.strip()]

    model_name = str(row["model_name"] or row["civitai_name"] or "").strip()
    version_name = str(row["civitai_name"] or model_name).strip()
    return {
        "id": row["civitai_id"],
        "modelId": row["civitai_model_id"],
        "name": version_name,
        "baseModel": str(row["base_model"] or "").strip(),
        "trainedWords": words,
        "images": [],
        "model": {"id": row["civitai_model_id"], "name": model_name or version_name},
    }


def pick_civitai_cover(images: list) -> str:
    """Use the safest version image as CivitAI's model-card fallback."""
    candidates = [item for item in (images or []) if isinstance(item, dict) and item.get("url")]
    if not candidates:
        return ""

    def rank(item):
        try:
            return int(item.get("nsfwLevel") or 0)
        except (TypeError, ValueError):
            return 0

    return min(candidates, key=rank)["url"]


def parse_jsonld_image(html: str) -> str:
    """Read the canonical display image from a CivitAI page's JSON-LD."""
    scripts = re.findall(
        r'<script[^>]+type="application/ld\+json"[^>]*>(.*?)</script>',
        str(html or ""),
        flags=re.IGNORECASE | re.DOTALL,
    )
    for raw in scripts:
        try:
            data = json.loads(raw)
        except (TypeError, ValueError):
            continue
        items = data if isinstance(data, list) else [data]
        for item in items:
            if not isinstance(item, dict):
                continue
            image = item.get("image")
            if isinstance(image, str) and image.strip():
                return image.strip()
            if isinstance(image, list):
                for value in image:
                    if isinstance(value, str) and value.strip():
                        return value.strip()
                    if isinstance(value, dict) and value.get("url"):
                        return str(value["url"]).strip()
    return ""


class _PromptBlocks(HTMLParser):
    def __init__(self):
        super().__init__()
        self.plain = ""
        self.code = []
        self.in_code = False
        self.blocks = []

    def handle_data(self, data):
        if self.in_code:
            self.code.append(data)
        else:
            self.plain += data

    def handle_starttag(self, tag, attrs):
        if tag in ("p", "div", "br", "li"):
            self.plain += "\n"
        elif tag == "code":
            self.in_code = True
            self.code = []

    def handle_endtag(self, tag):
        if tag in ("p", "div", "li"):
            self.plain += "\n"
        elif tag == "code":
            self.in_code = False
            self._flush()

    def _flush(self):
        text = "".join(self.code).strip().strip(",").strip()
        if not text:
            return
        lines = [" ".join(line.strip().strip(":").split()) for line in self.plain.splitlines() if line.strip()]
        self.blocks.append({"title": lines[-1] if lines else "Prompts", "prompt": text})
        self.plain = ""


def parse_prompt_blocks(html: str) -> list[dict]:
    """Extract heading + <pre><code> prompt blocks from a CivitAI description."""
    parser = _PromptBlocks()
    try:
        parser.feed(str(html or ""))
        parser.close()
    except Exception:
        return []
    return parser.blocks if len(parser.blocks) > 1 else []
