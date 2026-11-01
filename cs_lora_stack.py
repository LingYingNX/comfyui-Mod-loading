"""LoRA stack node with prompt-set composition for ComfyUI Studio.

The frontend stores its complete editable state in one JSON string widget.  This
module keeps the execution side dependency-free from the browser UI: it resolves
the selected prompt set from model-config.json, filters disabled prompt tokens,
applies each LoRA in row order, and returns the composed prompt string.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

import comfy.sd
import comfy.utils
import folder_paths
import server
from aiohttp import web

from .cs_config import CFG_MANAGER


STATE_DEFAULT = json.dumps(
    {
        "version": 1,
        "slots": [
            {
                "id": "slot-1",
                "lora": "",
                "strength": 1.0,
                "set": "",
                "disabled": {},
                "custom": "",
            }
        ],
    },
    ensure_ascii=False,
    separators=(",", ":"),
)


def split_prompt_tokens(text: Any) -> list[str]:
    """Split a prompt on top-level commas while preserving weighted groups."""
    value = str(text or "")
    tokens: list[str] = []
    buffer: list[str] = []
    depth = 0
    escaped = False

    for char in value:
        if escaped:
            buffer.append(char)
            escaped = False
            continue
        if char == "\\":
            buffer.append(char)
            escaped = True
            continue
        if char in "([{":
            depth += 1
        elif char in ")]}":
            depth = max(0, depth - 1)

        if char == "," and depth == 0:
            token = "".join(buffer).strip()
            if token:
                tokens.append(token)
            buffer.clear()
            continue

        buffer.append(char)

    token = "".join(buffer).strip()
    if token:
        tokens.append(token)
    return tokens


def split_custom_prompts(text: Any) -> list[str]:
    """A custom prompt is one non-empty line, so commas inside it stay intact."""
    return [line.strip() for line in str(text or "").splitlines() if line.strip()]


def _prompt_content(item: Any) -> str:
    if isinstance(item, str):
        return item.strip()
    if not isinstance(item, dict):
        return ""

    for key in ("content", "prompt", "text"):
        value = item.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()

    tokens = item.get("tokens")
    if isinstance(tokens, list):
        return ", ".join(str(token).strip() for token in tokens if str(token).strip())
    return ""


def _prompt_set_id(source: str, content: str) -> str:
    digest = hashlib.sha1(f"{source}\0{content}".encode("utf-8")).hexdigest()[:16]
    return f"{source}-{digest}"


def _find_lora_config(lora_name: str) -> dict[str, Any]:
    details = CFG_MANAGER.get_detail("loras")
    if not isinstance(details, dict) or not lora_name:
        return {}

    direct = details.get(lora_name)
    if isinstance(direct, dict):
        return direct

    wanted = lora_name.replace("\\", "/")
    for key, value in details.items():
        if str(key).replace("\\", "/") == wanted and isinstance(value, dict):
            return value

    wanted_casefold = wanted.casefold()
    for key, value in details.items():
        if str(key).replace("\\", "/").casefold() == wanted_casefold and isinstance(value, dict):
            return value
    return {}


def normalize_prompt_sets(lora_name: str) -> list[dict[str, Any]]:
    """Return stable, de-duplicated prompt sets for one LoRA."""
    config = _find_lora_config(lora_name)
    if not config:
        return []

    sets: list[dict[str, Any]] = []
    seen: set[str] = set()
    groups = (
        ("author", config.get("prompt_authors") or [], "作者提示词"),
        ("custom", config.get("prompts") or [], "自定义提示词"),
    )

    for source, items, fallback_title in groups:
        if not isinstance(items, list):
            continue
        for index, item in enumerate(items):
            content = _prompt_content(item)
            if not content:
                continue
            set_id = _prompt_set_id(source, content)
            if set_id in seen:
                continue
            seen.add(set_id)

            title = ""
            if isinstance(item, dict):
                title = str(
                    item.get("title")
                    or item.get("name")
                    or item.get("username")
                    or ""
                ).strip()
            sets.append(
                {
                    "id": set_id,
                    "title": title or f"{fallback_title} {index + 1}",
                    "source": source,
                    "content": content,
                    "tokens": split_prompt_tokens(content),
                }
            )
    return sets


def parse_stack_state(state_json: Any) -> list[dict[str, Any]]:
    if isinstance(state_json, str):
        try:
            payload = json.loads(state_json or "{}")
        except (TypeError, ValueError) as exc:
            raise ValueError("LoRA 堆栈状态不是合法 JSON") from exc
    elif isinstance(state_json, dict):
        payload = state_json
    else:
        payload = {}

    raw_slots = payload.get("slots") if isinstance(payload, dict) else None
    if not isinstance(raw_slots, list):
        raw_slots = []

    slots: list[dict[str, Any]] = []
    for index, raw in enumerate(raw_slots[:50]):
        if not isinstance(raw, dict):
            continue
        try:
            strength = float(raw.get("strength", 1.0))
        except (TypeError, ValueError):
            strength = 1.0
        strength = max(-100.0, min(100.0, strength))

        try:
            strength_clip = float(raw.get("strength_clip", strength))
        except (TypeError, ValueError):
            strength_clip = strength
        strength_clip = max(-100.0, min(100.0, strength_clip))

        raw_disabled = raw.get("disabled")
        disabled: dict[str, list[str]] = {}
        if isinstance(raw_disabled, dict):
            for key, values in raw_disabled.items():
                if isinstance(values, list):
                    disabled[str(key)] = [str(value) for value in values if str(value)]

        slots.append(
            {
                "id": str(raw.get("id") or f"slot-{index + 1}"),
                "lora": str(raw.get("lora") or "").strip(),
                "strength": strength,
                "strength_clip": strength_clip,
                "set": str(raw.get("set") or "").strip(),
                "disabled": disabled,
                "custom": str(raw.get("custom") or ""),
            }
        )
    return slots


def build_prompt_text(slots: list[dict[str, Any]]) -> str:
    prompt_parts: list[str] = []
    set_cache: dict[str, list[dict[str, Any]]] = {}

    for slot in slots:
        lora_name = slot["lora"]
        if lora_name not in set_cache:
            set_cache[lora_name] = normalize_prompt_sets(lora_name)
        prompt_sets = set_cache[lora_name]

        selected = next(
            (item for item in prompt_sets if item["id"] == slot["set"]),
            prompt_sets[0] if prompt_sets else None,
        )
        if selected:
            disabled = set(slot["disabled"].get(selected["id"], []))
            prompt_parts.extend(
                token for token in selected["tokens"] if token not in disabled
            )

        custom_disabled = set(slot["disabled"].get("custom", []))
        prompt_parts.extend(
            token
            for token in split_custom_prompts(slot["custom"])
            if token not in custom_disabled
        )

    return ", ".join(prompt_parts)


def _load_lora_file(lora_name: str):
    lora_path = folder_paths.get_full_path_or_raise("loras", lora_name)
    loaded = comfy.utils.load_torch_file(
        lora_path,
        safe_load=True,
        return_metadata=True,
    )
    if isinstance(loaded, tuple) and len(loaded) == 2:
        return loaded
    return loaded, None


class AIGODLIKELoraPromptStack:
    CATEGORY = "AIGODLIKE/loaders"
    FUNCTION = "apply_stack"
    # 只要两个输出：模型 + 编码好的条件。CLIP 与提示词字符串合并进条件里，
    # 接采样器的正面提示词就不需要再挂一个文本编码节点。
    RETURN_TYPES = ("MODEL", "CONDITIONING")
    RETURN_NAMES = ("MODEL", "CONDITIONING")
    OUTPUT_TOOLTIPS = (
        "应用堆栈后的扩散模型。",
        "按槽位顺序合成的提示词，用打过 LoRA 补丁的 CLIP 编码后的条件；直接接采样器的正面提示词。",
    )
    DESCRIPTION = (
        "按槽位顺序应用多个 LoRA，并把每个 LoRA 的提示词套装与自定义追加词"
        "合成为一条正向提示词，直接输出编码好的条件（CLIP 与提示词在本节点内合并）。"
    )
    SEARCH_ALIASES = [
        "LoRA提示词堆栈",
        "lora提示词",
        "提示词堆栈",
        "lora堆",
        "LoRA stack",
        "LoRA prompt stack",
    ]

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "state_json": (
                    "STRING",
                    {
                        "default": STATE_DEFAULT,
                        "multiline": True,
                        "tooltip": "由 LoRA 堆栈节点界面维护的工作流状态。",
                    },
                ),
            },
            "optional": {
                "clip": ("CLIP",),
            },
        }

    def apply_stack(self, model, state_json, clip=None):
        slots = parse_stack_state(state_json)
        prompt_text = build_prompt_text(slots)

        for slot in slots:
            lora_name = slot["lora"]
            strength = slot["strength"]
            if not lora_name or strength == 0:
                continue

            lora, metadata = _load_lora_file(lora_name)
            model, clip = comfy.sd.load_lora_for_models(
                model,
                clip,
                lora,
                strength,
                slot["strength_clip"],
                lora_metadata=metadata,
            )

        # 编码放在 LoRA 之后：文本编码器补丁已经挂上，条件里才是打过补丁的结果。
        conditioning = (
            clip.encode_from_tokens_scheduled(clip.tokenize(prompt_text))
            if clip is not None
            else None
        )

        return (model, conditioning)


@server.PromptServer.instance.routes.post("/cs/lora_stack/prompts")
async def lora_stack_prompts(request: web.Request):
    try:
        body = json.loads(await request.read() or b"{}")
        lora_name = str(body.get("name") or "").strip() if isinstance(body, dict) else ""
        sets = normalize_prompt_sets(lora_name)
        response = {"status": True, "name": lora_name, "sets": sets}
        return web.Response(
            status=200,
            text=json.dumps(response, ensure_ascii=False),
            content_type="application/json",
        )
    except Exception as exc:
        response = {"status": False, "message": str(exc), "sets": []}
        return web.Response(
            status=200,
            text=json.dumps(response, ensure_ascii=False),
            content_type="application/json",
        )


NODE_CLASS_MAPPINGS = {
    "AIGODLIKELoraPromptStack": AIGODLIKELoraPromptStack,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "AIGODLIKELoraPromptStack": "LoRA 提示词堆栈（Studio）",
}
