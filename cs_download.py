import os
import aiohttp
import time
import urllib.parse
from pathlib import Path
from .cs_civitai import apply_model_metadata, civitai_get, civitai_headers, collect_metadata, get_or_create_detail, sanitize_name, save_cover
from .cs_config import CFG_MANAGER
from .cs_managers import ModelManager, TASKS




MAX_DOWNLOAD_BYTES = 64 * 1024**3


MAX_DOWNLOAD_REDIRECTS = 5




def validate_download_url(url: str) -> str:
    parsed = urllib.parse.urlparse((url or "").strip())
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or parsed.username or parsed.password:
        raise RuntimeError("下载地址必须使用 HTTPS")
    if host != "civitai.com" and not host.endswith(".civitai.com"):
        raise RuntimeError("只允许下载 Civitai 域名")
    return parsed.geturl()




async def get_download_response(session, url: str):
    current = validate_download_url(url)
    for _ in range(MAX_DOWNLOAD_REDIRECTS + 1):
        resp = await session.get(current, allow_redirects=False)
        if 300 <= resp.status < 400:
            location = resp.headers.get("Location")
            resp.release()
            if not location:
                raise RuntimeError("下载重定向缺少 Location")
            current = validate_download_url(urllib.parse.urljoin(current, location))
            continue
        return resp
    raise RuntimeError("下载重定向次数过多")




def parse_download_url(url: str, timeout=30):
    """返回 (version_id, model_id, direct_url)。三者最多一个非空。"""
    url = (url or "").strip()
    if not url:
        raise RuntimeError("empty url")
    if url.isdigit():
        return url, "", ""
    if "civitai.com" in url:
        parsed = urllib.parse.urlparse(url)
        params = urllib.parse.parse_qs(parsed.query)
        vid = (params.get("modelVersionId") or [""])[0]
        if vid:
            return vid, "", ""
        parts = [p for p in parsed.path.split("/") if p]
        if "models" in parts:
            idx = parts.index("models")
            if len(parts) > idx + 1 and parts[idx + 1].isdigit():
                return "", parts[idx + 1], ""
        raise RuntimeError("无法从链接里解析出模型版本")
    return "", "", url




async def run_download(task_id: str, url: str, mtype: str, category: str, name: str, auto_name: bool):
    task = TASKS.get(task_id)
    tmp = None
    try:
        version_id, model_id, direct_url = parse_download_url(url)
        version = None
        if version_id:
            version = await civitai_get(f"model-versions/{version_id}")
        elif model_id:
            full = await civitai_get(f"models/{model_id}")
            versions = (full or {}).get("modelVersions") or []
            if versions:
                version_id = versions[0].get("id")
                version = versions[0]
        if not direct_url and not version_id:
            raise RuntimeError("找不到可下载的版本")

        roots = [Path(p) for p in ModelManager.get_paths(mtype)]
        roots = [p for p in roots if p.exists()]
        if not roots:
            raise RuntimeError(f"{mtype} 没有可写的模型目录")
        root = roots[0]
        target_dir = root.joinpath(sanitize_name(category)) if category else root
        target_dir.mkdir(parents=True, exist_ok=True)

        ext = ".safetensors"
        if version:
            files = version.get("files") or []
            for f in files:
                fname = f.get("name") or ""
                if fname:
                    ext = Path(fname).suffix or ext
                    break
            if auto_name:
                title = (version.get("model") or {}).get("name") or ""
                if title:
                    name = title
        if not name:
            name = f"model-{version_id or int(time.time())}"
        if not Path(name).suffix:
            name += ext
        target = target_dir.joinpath(sanitize_name(Path(name).stem) + Path(name).suffix)

        dl_url = validate_download_url(direct_url or f"https://civitai.com/api/download/models/{version_id}")
        task["current"] = target.name
        task["state"] = "downloading"
        timeout = aiohttp.ClientTimeout(total=None, sock_connect=30, sock_read=180)
        got = 0
        tmp = target.with_name(target.name + ".part")
        async with aiohttp.ClientSession(timeout=timeout, headers=civitai_headers(), trust_env=True) as session:
            resp = await get_download_response(session, dl_url)
            try:
                if resp.status != 200:
                    raise RuntimeError(f"下载失败 HTTP {resp.status}")
                total = int(resp.headers.get("Content-Length") or 0)
                if total > MAX_DOWNLOAD_BYTES:
                    raise RuntimeError("下载文件超过体积上限")
                task["total_bytes"] = total
                with open(tmp, "wb") as fp:
                    async for chunk in resp.content.iter_chunked(256 * 1024):
                        fp.write(chunk)
                        got += len(chunk)
                        if got > MAX_DOWNLOAD_BYTES:
                            raise RuntimeError("下载文件超过体积上限")
                        task["got_bytes"] = got
                        task["percent"] = round(got * 100 / total, 2) if total else 0
            finally:
                resp.release()
        os.replace(tmp, target)

        task["state"] = "metadata"
        rel_name = target.relative_to(root).as_posix()
        try:
            meta = await collect_metadata(mtype, rel_name)
        except Exception as e:
            meta = {"_reason": str(e)}
        meta.pop("_reason", None)
        mcfg = get_or_create_detail(mtype, rel_name)
        if meta:
            apply_model_metadata(mcfg, meta)
            if meta.get("prompt_authors"):
                mcfg["prompt_authors"] = meta["prompt_authors"]
            cover = await save_cover(meta.get("cover_url", ""), target)
            if cover:
                mcfg["cover"] = cover
        CFG_MANAGER.dump_config()

        task["ok"] = 1
        task["done"] = 1
        task["state"] = "done"
        task["current"] = rel_name
        task["results"].append({"name": rel_name, "ok": True})
    except Exception as e:
        if tmp and tmp.exists():
            tmp.unlink(missing_ok=True)
        task["failed"] = 1
        task["done"] = 1
        task["state"] = "failed"
        task["message"] = str(e)
        task["results"].append({"name": name, "ok": False, "reason": str(e)})
    finally:
        TASKS.finish(task_id)
