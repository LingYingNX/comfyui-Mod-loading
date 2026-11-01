import asyncio
import json
import subprocess
import sys
import server
import time
from aiohttp import web
from .cs_civitai import apply_model_metadata, collect_metadata, get_civitai_key, get_or_create_detail, save_cover, set_civitai_key
from .cs_config import CFG_MANAGER
from .cs_download import run_download
from .cs_managers import ModelManager, TASKS




@server.PromptServer.instance.routes.post("/cs/toggle_lock")
async def toggle_lock(request: web.Request):
    body = json.loads(await request.read())
    mtype = body.get("mtype")
    mname = body.get("mname")
    locked = bool(body.get("locked"))
    if not mtype or not mname:
        return web.Response(
            status=200,
            body=json.dumps({"status": False, "message": "mtype/mname required"}, ensure_ascii=False),
        )
    mcfg = get_or_create_detail(mtype, mname)
    mcfg["locked"] = locked
    CFG_MANAGER.dump_config()
    sys.stdout.write(f"ComfyUI-Studio Toggle lock: [{mtype}][{mname}] -> {locked}\n")
    sys.stdout.flush()
    return web.Response(status=200, body=json.dumps({"status": True, "locked": locked}))




@server.PromptServer.instance.routes.post("/cs/save_prompt")
async def save_prompt(request: web.Request):
    """只写传了的那个键：authors -> prompt_authors，prompts -> prompts。"""
    body = json.loads(await request.read())
    mtype = body.get("mtype")
    mname = body.get("mname")
    if not mtype or not mname:
        return web.Response(
            status=200,
            body=json.dumps({"status": False, "message": "mtype/mname required"}, ensure_ascii=False),
        )
    mcfg = get_or_create_detail(mtype, mname)
    if "authors" in body:
        mcfg["prompt_authors"] = body.get("authors") or []
    if "prompts" in body:
        mcfg["prompts"] = body.get("prompts") or []
    CFG_MANAGER.dump_config()
    return web.Response(
        status=200,
        body=json.dumps(
            {
                "status": True,
                "prompt_authors": mcfg.get("prompt_authors", []),
                "prompts": mcfg.get("prompts", []),
            },
            ensure_ascii=False,
        ),
    )




@server.PromptServer.instance.routes.post("/cs/open_folder")
async def open_folder(request: web.Request):
    body = json.loads(await request.read())
    mtype = body.get("mtype")
    mname = body.get("mname")
    model_path = ModelManager.find_model(mtype, mname)
    if not model_path.exists():
        return web.Response(
            status=200,
            body=json.dumps({"status": False, "message": "model not found"}, ensure_ascii=False),
        )
    folder = model_path.parent.resolve()
    try:
        if sys.platform.startswith("win"):
            # ComfyUI 以管理员启动时，/select 会被现有桌面 Shell 吞掉；/separate 可稳定打开真实目录。
            subprocess.Popen(["explorer", f"/separate,{folder}"])  # noqa: S603  (Windows 专用)
        elif sys.platform == "darwin":
            subprocess.Popen(["open", "-R", model_path.resolve().as_posix()])
        else:
            subprocess.Popen(["xdg-open", folder.as_posix()])
    except Exception as e:
        return web.Response(
            status=200, body=json.dumps({"status": False, "message": str(e)}, ensure_ascii=False)
        )
    return web.Response(status=200, body=json.dumps({"status": True, "path": folder.as_posix()}))




async def run_fetch_metadata(task_id: str, mtype: str, names: list, skip_locked: bool, overwrite_prompts: bool):
    task = TASKS.get(task_id)
    try:
        for name in names:
            if not task["running"]:
                break
            task["current"] = name
            mcfg = get_or_create_detail(mtype, name)

            if skip_locked and mcfg.get("locked"):
                task["skipped"] += 1
                task["done"] += 1
                task["results"].append({"name": name, "ok": False, "reason": "locked"})
                continue

            try:
                meta = await collect_metadata(mtype, name)
            except Exception as e:
                task["failed"] += 1
                task["done"] += 1
                task["results"].append({"name": name, "ok": False, "reason": f"error: {e}"})
                continue

            reason = meta.pop("_reason", "")
            if reason:
                task["failed"] += 1
                task["done"] += 1
                task["results"].append({"name": name, "ok": False, "reason": reason})
                continue

            apply_model_metadata(mcfg, meta)
            # 作者触发词：元数据更完整时替换旧的自动条目；更少时保留，避免刷新回退。
            authors = meta.get("prompt_authors") or []
            if authors and len(authors) > len(mcfg.get("prompt_authors") or []):
                mcfg["prompt_authors"] = authors
            if overwrite_prompts and authors and not mcfg.get("prompts"):
                mcfg["prompts"] = [
                    {"id": f"author-{int(time.time())}", "title": authors[0].get("name", ""), "content": authors[0].get("prompt", "")}
                ]

            cover = ""
            try:
                model_path = ModelManager.find_model(mtype, name)
                if model_path.exists():
                    cover = await save_cover(meta.get("cover_url", ""), model_path)
            except Exception:
                cover = ""
            if cover:
                mcfg["cover"] = cover

            CFG_MANAGER.dump_config()
            task["ok"] += 1
            task["done"] += 1
            task["results"].append({"name": name, "ok": True, "reason": cover or "no_cover"})
            await asyncio.sleep(0)
    finally:
        TASKS.finish(task_id)




@server.PromptServer.instance.routes.post("/cs/fetch_metadata")
async def fetch_metadata(request: web.Request):
    body = json.loads(await request.read())
    # 只在真的带了 key 时才覆盖，否则单模型更新会把设置页存好的 key 抹掉
    if body.get("api_key"):
        set_civitai_key(body.get("api_key"))
    if not get_civitai_key():
        return web.Response(
            status=200,
            body=json.dumps({"status": False, "message": "civitai api_key required (设置页 C站 API)"}, ensure_ascii=False),
        )
    mtype = body.get("mtype")
    if not mtype:
        return web.Response(
            status=200,
            body=json.dumps({"status": False, "message": "mtype required"}, ensure_ascii=False),
        )
    names = body.get("names") or []
    if isinstance(names, str):
        names = [names]
    if not names:
        names = list(CFG_MANAGER.get_detail(mtype).keys())
    task_id = TASKS.create("metadata", len(names))
    asyncio.create_task(
        run_fetch_metadata(
            task_id,
            mtype,
            names,
            bool(body.get("skip_locked", True)),
            bool(body.get("overwrite_prompts", False)),
        )
    )
    return web.Response(
        status=200, body=json.dumps({"status": True, "task_id": task_id, "total": len(names)})
    )




@server.PromptServer.instance.routes.get("/cs/fetch_metadata_status")
async def fetch_metadata_status(request: web.Request):
    task_id = request.query.get("task_id", "")
    task = TASKS.get(task_id)
    if not task:
        return web.Response(
            status=200,
            body=json.dumps({"running": False, "message": "unknown task_id"}, ensure_ascii=False),
        )
    return web.Response(status=200, body=json.dumps(task, ensure_ascii=False))




@server.PromptServer.instance.routes.post("/cs/download_model")
async def download_model(request: web.Request):
    body = json.loads(await request.read())
    if body.get("api_key"):
        set_civitai_key(body.get("api_key"))
    if not get_civitai_key():
        return web.Response(
            status=200,
            body=json.dumps({"status": False, "message": "civitai api_key required (设置页 C站 API)"}, ensure_ascii=False),
        )
    url = body.get("url") or ""
    if not url:
        return web.Response(
            status=200,
            body=json.dumps({"status": False, "message": "url required"}, ensure_ascii=False),
        )
    mtype = body.get("mtype") or "loras"
    task_id = TASKS.create("download", 1)
    t = TASKS.get(task_id)
    t.update({"state": "pending", "percent": 0, "total_bytes": 0, "got_bytes": 0, "message": ""})
    asyncio.create_task(
        run_download(
            task_id,
            url,
            mtype,
            body.get("category") or "",
            body.get("name") or "",
            bool(body.get("auto_name", True)),
        )
    )
    return web.Response(status=200, body=json.dumps({"status": True, "task_id": task_id}))




@server.PromptServer.instance.routes.get("/cs/download_status")
async def download_status(request: web.Request):
    task_id = request.query.get("task_id", "")
    task = TASKS.get(task_id)
    if not task:
        return web.Response(
            status=200,
            body=json.dumps({"running": False, "state": "failed", "message": "unknown task_id"}, ensure_ascii=False),
        )
    return web.Response(status=200, body=json.dumps(task, ensure_ascii=False))
