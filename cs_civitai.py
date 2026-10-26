import asyncio
import json
import os
from hashlib import md5, sha256
import aiohttp
import urllib.parse
from copy import deepcopy
from pathlib import Path
from .utils import (
    find_lora_manager_metadata,
    parse_jsonld_image,
    parse_prompt_blocks,
    pick_civitai_cover,
    read_json,
)
from .cs_config import CFG_MANAGER
from .cs_managers import ModelManager
from .cs_paths import LORA_MANAGER_DB




# ===========================================================================
# V2: 上锁 / 提示词 / 元数据抓取 / 模型下载
#
# 设计约定：
#   - 新增字段一律挂在 details[mtype][mname] 下，旧数据缺字段时按读取默认值处理，
#     不为了补默认值重写整份配置。
#   - 耗时操作（算 hash、查 Civitai、下模型）都丢进后台 asyncio 任务，前端拿 task_id
#     轮询 status 接口。任务表在内存里，重启即清空。
# ===========================================================================

V2_MODEL_FIELDS = {
    "locked": False,
    "arch": "",
    "update": None,
    "baseModel": "",
    "versionName": "",
    "versionId": None,
    "modelId": None,
    "publishedAt": "",
    "createdAt": "",
    "fileFormat": "",
    "sizeKB": 0,
    "sha256": "",
    "recommendedWeight": "",
    "trainingResolution": "",
    "clipSkip": "",
    "remoteVersionCount": 0,
    "prompt_authors": [],
    "prompts": [],
}



V2_METADATA_FIELDS = (
    "arch",
    "update",
    "baseModel",
    "versionName",
    "versionId",
    "modelId",
    "publishedAt",
    "createdAt",
    "fileFormat",
    "sizeKB",
    "sha256",
    "recommendedWeight",
    "trainingResolution",
    "clipSkip",
    "remoteVersionCount",
    "url",
)



CIVITAI_API = "https://civitai.com/api/v1"


HTTP_UA = "ComfyUI-Studio/1.0 (+local model manager)"



# 架构识别：按 baseModel / 模型名 / 文件名依次匹配，先命中先返回
ARCH_RULES = (
    ("krea 2", "Krea 2"),
    ("krea2", "Krea 2"),
    ("illustrious", "Illustrious"),
    ("noobai", "Illustrious"),
    ("anima", "Anima"),
    ("pony", "Pony"),
    ("flux", "Flux"),
    ("sdxl", "SDXL"),
    ("sd 1.5", "SD1.5"),
    ("sd1.5", "SD1.5"),
    ("sd 2", "SD1.5"),
)




def guess_arch(*texts) -> str:
    low = " ".join(str(t) for t in texts if t).lower()
    for keyword, name in ARCH_RULES:
        if keyword in low:
            return name
    return ""




def sanitize_name(name: str) -> str:
    name = str(name or "").strip()
    for ch in '\\/:*?"<>|':
        name = name.replace(ch, "_")
    return name.strip(". ") or "model"




def sha256_file(path: Path) -> str:
    h = sha256()
    with open(path, "rb") as fp:
        for chunk in iter(lambda: fp.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()




def read_safetensors_metadata(path: Path) -> dict:
    """Read the small JSON header at the start of a safetensors file."""
    if path.suffix.lower() != ".safetensors":
        return {}
    try:
        with open(path, "rb") as fp:
            size = int.from_bytes(fp.read(8), "little")
            if size <= 0 or size > 4 * 1024 * 1024:
                return {}
            data = json.loads(fp.read(size))
    except (OSError, ValueError, TypeError):
        return {}
    metadata = data.get("__metadata__") if isinstance(data, dict) else None
    return metadata if isinstance(metadata, dict) else {}




def format_weight_range(weights: list) -> str:
    values = []
    for value in weights:
        try:
            number = float(value)
        except (TypeError, ValueError):
            continue
        if number not in values:
            values.append(number)
    if not values:
        return ""
    values.sort()
    label = lambda value: f"{value:g}"
    return label(values[0]) if len(values) == 1 else f"{label(values[0])} ~ {label(values[-1])}"



# Civitai API Key：设置页存进 model-config.json 顶层 settings（见 /cs/save_setting），
# 各请求进来时若带了 key 则同步进内存，落盘与内存以配置文件为准。
CIVITAI_API_KEY = ""




def set_civitai_key(key):
    global CIVITAI_API_KEY
    CIVITAI_API_KEY = str(key or "").strip()




def get_civitai_key() -> str:
    global CIVITAI_API_KEY
    stored = str(CFG_MANAGER.settings.get("civitai_api_key", "") or "")
    if stored and stored != CIVITAI_API_KEY:
        CIVITAI_API_KEY = stored
    return CIVITAI_API_KEY




def civitai_headers() -> dict:
    headers = {"User-Agent": HTTP_UA}
    if get_civitai_key():
        headers["Authorization"] = f"Bearer {get_civitai_key()}"
    return headers




# 说明：下面所有 aiohttp.ClientSession 都带 trust_env=True，
# 这样 HTTP_PROXY / HTTPS_PROXY / ALL_PROXY 环境变量会被自动采用
# （国内直连 civitai.com 通常连不通，走代理是常规做法）。


async def civitai_get(path: str, params: dict = None):
    """查 Civitai。404 返回 None（没这个模型），其它非 200 抛错。"""
    url = f"{CIVITAI_API}/{path.lstrip('/')}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    timeout = aiohttp.ClientTimeout(total=30)
    async with aiohttp.ClientSession(timeout=timeout, headers=civitai_headers(), trust_env=True) as session:
        async with session.get(url) as resp:
            if resp.status == 404:
                return None
            if resp.status != 200:
                raise RuntimeError(f"civitai HTTP {resp.status}")
            return await resp.json()




async def download_bytes(url: str) -> bytes:
    if not url:
        return b""
    timeout = aiohttp.ClientTimeout(total=120)
    async with aiohttp.ClientSession(timeout=timeout, headers=civitai_headers(), trust_env=True) as session:
        async with session.get(url) as resp:
            if resp.status != 200:
                return b""
            return await resp.read()




async def civitai_page_cover(model_id, version_id) -> str:
    """Read the same primary image CivitAI puts on the model page."""
    if not model_id:
        return ""
    url = f"https://civitai.com/models/{model_id}"
    if version_id:
        url += f"?modelVersionId={version_id}"
    timeout = aiohttp.ClientTimeout(total=30)
    try:
        async with aiohttp.ClientSession(timeout=timeout, headers=civitai_headers(), trust_env=True) as session:
            async with session.get(url) as resp:
                if resp.status != 200:
                    return ""
                return parse_jsonld_image(await resp.text(errors="ignore"))
    except Exception:
        return ""




async def save_cover(url: str, model_path: Path) -> str:
    """把 Civitai 预览图落到模型旁边（同名 .png），走临时文件 + 原子替换。"""
    data = await download_bytes(url)
    if not data:
        return ""
    img_path = model_path.with_suffix(".png")
    tmp = img_path.with_name(img_path.name + ".tmp")
    try:
        tmp.write_bytes(data)
        os.replace(tmp, img_path)
    except Exception:
        try:
            tmp.unlink()
        except Exception:
            pass
        return ""
    return img_path.as_posix()




async def collect_metadata(mtype: str, mname: str) -> dict:
    """
    按文件 SHA256 反查 Civitai，返回要写进 mcfg 的字段。
    查不到（没网络 / 没这个模型）返回 {}，由调用方决定报什么原因。
    """
    model_path = ModelManager.find_model(mtype, mname)
    if not model_path.exists():
        return {"_reason": "model_file_missing"}
    file_hash = await asyncio.to_thread(sha256_file, model_path)
    safe_meta = await asyncio.to_thread(read_safetensors_metadata, model_path)
    sidecar = await asyncio.to_thread(read_json, model_path.with_suffix(".metadata.json"))
    cached_version = sidecar.get("civitai") if isinstance(sidecar, dict) else None
    try:
        version = await civitai_get(f"model-versions/by-hash/{file_hash}")
    except Exception:
        version = None
    local = await asyncio.to_thread(find_lora_manager_metadata, LORA_MANAGER_DB, file_hash)
    if not version:
        version = cached_version if isinstance(cached_version, dict) else local
    elif isinstance(cached_version, dict):
        version = {**cached_version, **version}
    if not version:
        return {"_reason": "not_found_on_civitai"}

    model = version.get("model") or {}
    local = local or {}
    base = str(version.get("baseModel") or local.get("baseModel") or "").strip()
    model_id = model.get("id") or version.get("modelId") or local.get("modelId")
    version_id = version.get("id") or local.get("id")

    page_url = ""
    if model_id:
        page_url = f"https://civitai.com/models/{model_id}"
        if version_id:
            page_url += f"?modelVersionId={version_id}"

    # 本地缓存命中时也要拉项目详情，用当前版本 ID 补全发布时间、描述和图片。
    update = None
    full = None
    remote_versions = []
    if model_id:
        try:
            full = await civitai_get(f"models/{model_id}")
            remote_versions = (full or {}).get("modelVersions") or []
            matched = next((item for item in remote_versions if item.get("id") == version_id), None)
            if matched:
                version = {**version, **matched}
            latest = remote_versions[0] if remote_versions else None
            if latest and latest.get("id") != version_id:
                update = {
                    "version": latest.get("name") or "",
                    "url": f"https://civitai.com/models/{model_id}?modelVersionId={latest.get('id')}",
                }
        except Exception:
            pass

    words = [
        w
        for w in (version.get("trainedWords") or local.get("trainedWords") or [])
        if isinstance(w, str) and w.strip()
    ]
    model_name = model.get("name") or (local.get("model") or {}).get("name") or ""
    version_name = version.get("name") or local.get("name") or model_name
    blocks = []
    for html in (version.get("description"), (full or {}).get("description")):
        for block in parse_prompt_blocks(html or ""):
            if block not in blocks:
                blocks.append(block)
    authors = []
    if len(words) <= 1 and blocks:
        authors = [
            {
                "name": block["title"],
                "prompt": block["prompt"],
                "tokens": [tag.strip() for tag in block["prompt"].split(",") if tag.strip()],
                "note": base,
            }
            for block in blocks
        ]
    elif words:
        authors.append(
            {
                "name": version_name or mname,
                "prompt": ", ".join(words),
                "tokens": words,
                "note": base,
            }
        )

    cover_url = await civitai_page_cover(model_id, version_id) or pick_civitai_cover(version.get("images"))

    files = [item for item in (version.get("files") or []) if isinstance(item, dict)]
    primary_file = next(
        (
            item
            for item in files
            if str((item.get("hashes") or {}).get("SHA256") or "").lower() == file_hash.lower()
        ),
        None,
    )
    primary_file = primary_file or next((item for item in files if item.get("primary")), files[0] if files else {})
    file_hashes = {
        str(value).lower()
        for value in (primary_file.get("hashes") or {}).values()
        if isinstance(value, str)
    }
    weights = []
    for image in version.get("images") or []:
        resources = (image.get("meta") or {}).get("resources") or []
        matched_resources = [
            resource
            for resource in resources
            if isinstance(resource, dict)
            and str(resource.get("type") or "").lower() == "lora"
            and (
                not file_hashes
                or str(resource.get("hash") or "").lower() in file_hashes
            )
        ]
        if not matched_resources:
            matched_resources = [
                resource
                for resource in resources
                if isinstance(resource, dict) and str(resource.get("type") or "").lower() == "lora"
            ]
        weights.extend(resource.get("weight") for resource in matched_resources if resource.get("weight") is not None)

    file_format = str((primary_file.get("metadata") or {}).get("format") or "").strip()
    if not file_format:
        suffix = model_path.suffix.lower()
        file_format = "Safetensors" if suffix == ".safetensors" else suffix.lstrip(".").upper()
    training_resolution = str(safe_meta.get("modelspec.resolution") or "").strip()
    clip_skip = str(safe_meta.get("ss_clip_skip") or "").strip()

    return {
        "arch": base or guess_arch(model_name, mname),
        "update": update,
        "baseModel": base,
        "versionName": version_name,
        "versionId": version_id,
        "modelId": model_id,
        "publishedAt": version.get("publishedAt") or local.get("publishedAt") or "",
        "createdAt": version.get("createdAt") or local.get("createdAt") or "",
        "fileFormat": file_format,
        "sizeKB": model_path.stat().st_size / 1024,
        "sha256": file_hash,
        "recommendedWeight": format_weight_range(weights),
        "trainingResolution": training_resolution,
        "clipSkip": clip_skip,
        "remoteVersionCount": len(remote_versions),
        "prompt_authors": authors,
        "cover_url": cover_url,
        "url": page_url,
        "title": model_name or version_name,
    }




def get_or_create_detail(mtype: str, mname: str) -> dict:
    detail = CFG_MANAGER.get_detail(mtype)
    mcfg = detail.get(mname)
    if mcfg is None:
        mcfg = {"name": mname}
        detail[mname] = mcfg
    for key, default in V2_MODEL_FIELDS.items():
        if key not in mcfg:
            mcfg[key] = deepcopy(default)
    return mcfg




def apply_model_metadata(mcfg: dict, meta: dict):
    if not meta:
        return
    for key in V2_METADATA_FIELDS:
        if key in meta:
            mcfg[key] = meta[key]
