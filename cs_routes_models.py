import json
import sys
import server
from copy import deepcopy
from aiohttp import web
from pathlib import Path
from .utils import (
    find_lora_manager_metadata,
    parse_jsonld_image,
    parse_prompt_blocks,
    pick_civitai_cover,
    read_json,
)
from .cs_civitai import V2_MODEL_FIELDS, guess_arch
from .cs_config import CFG_MANAGER, SETTING_KEYS
from .cs_managers import MAX_THUMBNAIL_BYTES, ModelManager, ThumbnailManager, is_supported_image, safe_thumbnail_suffix
from .cs_paths import CUR_PATH, WK_PATH
from .cs_static import thumbnail_exists




@server.PromptServer.instance.routes.post("/cs/upload_thumbnail")
async def upload_thumbnail(request: web.Request):
    post = await request.post()
    image = post.get("image")
    mtype = post.get("mtype")
    mname = post.get("name")
    # itype = post.get("type")
    # sys.stdout.write(f"Upload Thumbnail: {itype} {mtype} {mname}\n")
    # sys.stdout.flush()
    ret_json = {"status": False, "msg": ""}
    if not image or not image.file:
        # 无效图片
        ret_json["msg"] = "Invalid image"
        return web.Response(status=400, body=json.dumps(ret_json))
    img_name = image.filename
    if not img_name or not mtype or not mname:
        # 无文件名
        ret_json["msg"] = "Invalid image name or model"
        return web.Response(status=400, body=json.dumps(ret_json))
    try:
        suffix = safe_thumbnail_suffix(img_name)
    except ValueError:
        ret_json["msg"] = "Unsupported thumbnail type"
        return web.Response(status=400, body=json.dumps(ret_json))
    data = image.file.read(MAX_THUMBNAIL_BYTES + 1)
    if len(data) > MAX_THUMBNAIL_BYTES or not is_supported_image(data, suffix):
        ret_json["msg"] = "Invalid image content"
        return web.Response(status=400, body=json.dumps(ret_json))
    model_path = ModelManager.find_model(mtype, mname)
    if not model_path.exists():
        # 模型不存在
        ret_json["msg"] = "Model not found"
        return web.Response(status=400, body=json.dumps(ret_json))
    # 移除同名的 .png, .jpg, .jpeg, .gif 缩略图 ?
    # ModelManager.remove_thumbnails(mtype, mname)
    # 保存缩略图到模型所在路径
    img_path = model_path.with_suffix(suffix)
    with open(img_path, "wb") as f:
        f.write(data)
    # 保存缩略图路径到配置文件
    model_configs = CFG_MANAGER.get_detail(mtype)
    if mname in model_configs:
        mcfg = model_configs[mname]
        mcfg["cover"] = img_path.as_posix()
        CFG_MANAGER.dump_config()
    ret_json["status"] = True
    return web.Response(status=200, body=json.dumps(ret_json))




@server.PromptServer.instance.routes.post("/cs/update_config")
async def update_config(request: web.Request):
    post = await request.post()
    data = post.get("data")
    ret_json = {"status": False, "msg": ""}
    try:
        data = json.loads(data)
        if not isinstance(data, dict):
            ret_json["msg"] = "data is not dict"
            sys.stderr.write(f"Update Config: data is not dict {data}\n")
            return web.Response(status=200, body=json.dumps(ret_json))
    except Exception as e:
        sys.stderr.write(f"ComfyUI-Studio Update config: {e}\n")
        ret_json["msg"] = str(e)
        return web.Response(status=200, body=json.dumps(ret_json))
    key = post.get("key")
    mtype = data.get("mtype", "")
    if not mtype:
        sys.stderr.write("ComfyUI-Studio Update config: model type is empty\n")
        ret_json["msg"] = "model type is empty"
        return web.Response(status=200, body=json.dumps(ret_json))
    # sys.stdout.write(f"Update Config: {data}\n")
    # sys.stdout.write(f"Update Config: {key}\n")
    # sys.stdout.flush()
    mname = data.get("name", "")
    update_data = data.get(key, None)
    if update_data is None:
        ret_json["msg"] = "update data is empty"
        return web.Response(status=200, body=json.dumps(ret_json))

    ret_json["status"] = True

    if key == "name":
        # 更新模型名称
        old_data = post.get("old_data", "")
        if not old_data:
            ret_json["status"] = False
            ret_json["msg"] = "old data is empty"
            return web.Response(status=200)
        mname = old_data
        try:
            ModelManager.model_rename(mtype, old_data, update_data)
        except Exception as e:
            ret_json["status"] = False
            ret_json["msg"] = "Model Rename failed:" + str(e)

    model_configs = CFG_MANAGER.get_detail(mtype)
    if mname in model_configs:
        mcfg = model_configs[mname]
        mcfg[key] = update_data
    CFG_MANAGER.dump_config()
    return web.Response(status=200, body=json.dumps(ret_json))




def find_tags(string: str, sep="/") -> list[str]:
    """
    find tags from string use the sep for split
    Note: string may contain the \\ or / for path separator
    """
    if not string:
        return []
    string = string.replace("\\", "/")
    while "//" in string:
        string = string.replace("//", "/")
    if string and sep in string:
        return string.split(sep)[:-1]
    return []




@server.PromptServer.instance.routes.post("/cs/fetch_config")
async def fetch_config(request: web.Request):
    # post = await request.post()
    # 获取 body
    body = await request.read()
    body = json.loads(body)
    mtype = body.get("mtype")
    if not mtype:
        sys.stderr.write("ComfyUI-Studio Fetch config: model type is empty\n")
        sys.stderr.flush()
        return web.Response(status=200, body="{}")
    models = body.get("models")
    # body = await request.read()
    # body = json.loads(body)
    # mtype = body.get("mtype", "")
    # sys.stdout.write(f"Fetch Model Config: {mtype}\n")
    # sys.stdout.flush()
    example_cfg = {
        "cover": "xxxx.png",
        "level": "D",
        "name": "xxx.ckpt",
        "type": "CKPT",
        "mtype": "Checkpoints",
        "tags": [],
        "creationTime": 1703733395793,
        "modifyTime": 1703733395793,
        "size": 0
    }
    old_model_map = CFG_MANAGER.get_detail(mtype)
    ret_model_map = {}
    for name in models:
        if name not in old_model_map:
            mcfg = deepcopy(example_cfg)
            mcfg["name"] = name
            old_model_map[name] = mcfg
            CFG_MANAGER.dirty = True
        mcfg = old_model_map[name]
        # V2 字段兜底：只补读取时的默认值，不置 dirty（不为默认值重写整份配置）
        for _k, _default in V2_MODEL_FIELDS.items():
            if _k not in mcfg:
                mcfg[_k] = deepcopy(_default)
        # 架构：抓过 Civitai 的以抓到的为准；没抓过的按文件名猜一个，让左侧导航立刻能用
        if not mcfg.get("arch"):
            mcfg["arch"] = guess_arch(name)
        # mcfg["name"] 和 mname 不匹配
        if Path(mcfg.get("name", "")).as_posix() != Path(name).as_posix():
            mcfg["name"] = name
            CFG_MANAGER.dirty = True
        old_cover = mcfg.get("cover", "")
        if not old_cover or not thumbnail_exists(old_cover):
            img_path = ModelManager.find_thumbnail(name, mtype)
            mcfg["cover"] = img_path
            CFG_MANAGER.dirty = True
        ret_model_map[name] = mcfg
        mcfg["mtype"] = mtype
        model_path = ModelManager.find_model(mtype, name)
        if not model_path.exists():
            continue
        mcfg["size"] = model_path.stat().st_size / 1024**2  # MB
        mcfg["creationTime"] = model_path.stat().st_ctime * 1000
        mcfg["modifyTime"] = model_path.stat().st_mtime * 1000
    ret_model_map: dict[str, dict] = deepcopy(ret_model_map)
    # model_paths = ModelManager.get_paths(mtype)
    for mcfg in ret_model_map.values():
        # 遍历model_paths 对比 model_path 得到 减去 model_paths 的相对路径
        name = mcfg.get("name", "").replace("\\", "/")
        # 查找 model对应的 workflow
        mcfg["workflows"] = []
        mtype = mcfg.get("mtype", "")
        wp = WK_PATH.joinpath(mtype, name)
        if wp.exists():
            workflows = [p.name for p in wp.iterdir() if p.is_file() and p.suffix == ".json"]
            mcfg["workflows"] = workflows
        dir_tags = find_tags(name)
        if dir_tags:
            old_tags = mcfg.get("tags") or []
            tags = list(dict.fromkeys(str(tag) for tag in old_tags if str(tag).strip()))
            for tag in dir_tags:
                if tag not in tags:
                    tags.append(tag)
            mcfg["tags"] = tags
            mcfg["dir_tags"] = dir_tags
        # mcfg["cover"] = urllib.parse.quote(path_to_url(mcfg["cover"]))
        if not mcfg["cover"]:
            continue
        code = ThumbnailManager.add_code(mcfg["cover"])
        mcfg["cover"] = f"/cs/fetch_image?code={code}"
    if CFG_MANAGER.dirty:
        CFG_MANAGER.dump_config()
    json_data = json.dumps(ret_model_map)
    return web.Response(status=200, body=json_data)




@server.PromptServer.instance.routes.get("/cs/fetch_image")
async def fetch_image(request: web.Request):
    # 调用方式 http://127.0.0.1:8188/cs/fetch_image?code=xxxx.png
    code = request.query.get("code")
    image_bytes = ThumbnailManager.get_image_by_code(code)
    return web.Response(status=200, body=image_bytes)




@server.PromptServer.instance.routes.post("/cs/update_filter")
async def update_filter(request: web.Request):
    post = await request.post()
    data = post.get("data")
    try:
        data = json.loads(data)
        if not isinstance(data, list):
            raise Exception("data is not list")
    except Exception as e:
        sys.stderr.write(f"ComfyUI-Studio Update filter: {e}\n")
        sys.stderr.flush()
        return web.Response(status=200)

    loader = post.get("loader", "")
    if not loader:
        sys.stderr.write("ComfyUI-Studio Update filter: loader type is empty\n")
        sys.stderr.flush()
        return web.Response(status=200)
    filters = CFG_MANAGER.get_filter(loader)
    filters.clear()
    filters.extend(data)
    CFG_MANAGER.dump_config()
    return web.Response(status=200)




@server.PromptServer.instance.routes.post("/cs/fetch_filter")
async def fetch_filter(request: web.Request):
    body = await request.read()
    body = json.loads(body)
    loader = body.get("loader")
    if not loader:
        sys.stderr.write("ComfyUI-Studio Fetch filter: loader type is empty\n")
        sys.stderr.flush()
        return web.Response(status=200, body="{}")
    fetch_all = body.get("fetch_all", False)
    filters = CFG_MANAGER.get_filter(loader)
    if not filters:
        CFG_MANAGER.dump_config()
    sys.stderr.flush()
    if fetch_all:
        filters = CFG_MANAGER.filters
    json_data = json.dumps(filters)
    return web.Response(status=200, body=json_data)




@server.PromptServer.instance.routes.post("/cs/fetch_workflow")
async def fetch_workflow(request: web.Request):
    """
    根据传入的 mtype mname workflow名 获取对应json
    """
    body = await request.read()
    body = json.loads(body)
    mtype = body.get("mtype")
    mname = body.get("mname")
    workflow = body.get("workflow")
    wk_path = WK_PATH.joinpath(mtype, mname, workflow).with_suffix(".json")
    err_info = ""
    if not mtype:
        err_info = "ComfyUI-Studio Fetch workflow: workflow type is empty\n"
    elif not mname:
        err_info = "ComfyUI-Studio Fetch workflow: model name is empty\n"
    elif not workflow:
        err_info = "ComfyUI-Studio Fetch workflow: workflow name is empty\n"
    elif not wk_path.exists() or not wk_path.is_file():
        err_info = f"ComfyUI-Studio Fetch workflow: workflow [{wk_path.as_posix()}] not find\n"
    if err_info:
        sys.stderr.write(err_info)
        sys.stderr.flush()
    ret_json = read_json(wk_path)
    return web.Response(status=200, body=json.dumps(ret_json))




@server.PromptServer.instance.routes.post("/cs/save_workflow")
async def save_workflow(request: web.Request):
    """
    根据传入的 mtype mname workflow数据 保存对应json
    """
    body = await request.read()
    body = json.loads(body)
    mtype = body.get("mtype")
    mname = body.get("mname")
    data = body.get("data")
    wk_name = body.get("name")
    wk_path = WK_PATH.joinpath(mtype, mname, wk_name).with_suffix(".json")
    err_info = ""
    ret_json = {"saved": False}
    if not mtype:
        err_info = "ComfyUI-Studio Save workflow: workflow type is empty\n"
    elif not mname:
        err_info = "ComfyUI-Studio Save workflow: model name is empty\n"
    elif not wk_name:
        err_info = "ComfyUI-Studio Save workflow: workflow name is empty\n"
    elif not data:
        err_info = "ComfyUI-Studio Save workflow: workflow data is empty\n"
    else:
        try:
            if not wk_path.parent.exists():
                wk_path.parent.mkdir(parents=True)
            wk_path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            ret_json["saved"] = True
            sys.stdout.write(f"ComfyUI-Studio Save workflow: [{wk_name}] success\n")
        except Exception as e:
            err_info = f"ComfyUI-Studio Save workflow: {e}\n"
    if err_info:
        sys.stderr.write(err_info)
        sys.stderr.flush()
    return web.Response(status=200, body=json.dumps(ret_json))




@server.PromptServer.instance.routes.post("/cs/save_note")
async def save_note(request: web.Request):
    """
    根据传入的 mtype mname note名 保存data中的对应note
    """
    body = await request.read()
    body = json.loads(body)
    mtype = body.get("mtype")
    mname = body.get("mname")
    data = body.get("data")
    note_name = body.get("name")
    err_info = ""
    ret_json = {"saved": False}
    if not mtype:
        err_info = "ComfyUI-Studio Save note: note is empty\n"
    elif not mname:
        err_info = "ComfyUI-Studio Save note: model name is empty\n"
    elif not note_name:
        err_info = "ComfyUI-Studio Save note: note name is empty\n"
    else:
        old_model_map = CFG_MANAGER.get_detail(mtype)
        mcfg = old_model_map.get(mname, {})
        old_model_map[mname] = mcfg
        notes = mcfg.get("notes", {})
        notes[note_name] = data
        mcfg["notes"] = notes
        CFG_MANAGER.dump_config()
        ret_json["saved"] = True
        sys.stdout.write(f"ComfyUI-Studio Save note: [{note_name}] success\n")
    if err_info:
        sys.stderr.write(err_info)
        sys.stderr.flush()
    return web.Response(status=200, body=json.dumps(ret_json))




@server.PromptServer.instance.routes.post("/cs/remove_workflow")
async def remove_workflow(request: web.Request):
    """
    根据传入的 mtype mname workflow名 删除对应json
    """
    body = await request.read()
    body = json.loads(body)
    mtype = body.get("mtype")
    mname = body.get("mname")
    workflow = body.get("workflow")
    wk_name = body.get("name")
    if not wk_name:
        wk_name = workflow
    wk_path = WK_PATH.joinpath(mtype, mname, workflow).with_suffix(".json")
    err_info = ""
    ret_json = {"removed": False}
    if not mtype:
        err_info = "ComfyUI-Studio Remove workflow: workflow type is empty\n"
    elif not mname:
        err_info = "ComfyUI-Studio Remove workflow: model name is empty\n"
    elif not workflow:
        err_info = "ComfyUI-Studio Remove workflow: workflow name is empty\n"
    elif not wk_path.exists() or not wk_path.is_file():
        err_info = f"ComfyUI-Studio Remove workflow: workflow [{wk_path.as_posix()}] not find\n"
    else:
        try:
            wk_path.unlink()
            ret_json["removed"] = True
            sys.stdout.write(f"ComfyUI-Studio Remove workflow: [{wk_name}] success\n")
        except Exception as e:
            err_info = f"ComfyUI-Studio Remove workflow: {e}\n"
    if err_info:
        sys.stderr.write(err_info)
        sys.stderr.flush()
    return web.Response(status=200, body=json.dumps(ret_json))




@server.PromptServer.instance.routes.post("/cs/remove_note")
async def remove_note(request: web.Request):
    """
    根据传入的 mtype mname note名 删除data中的对应note
    """
    body = await request.read()
    body = json.loads(body)
    mtype = body.get("mtype")
    mname = body.get("mname")
    note = body.get("note")
    note_name = body.get("name")
    if not note_name:
        note_name = note
    err_info = ""
    ret_json = {"removed": False}
    if not mtype:
        err_info = "ComfyUI-Studio Remove note: note is empty\n"
    elif not mname:
        err_info = "ComfyUI-Studio Remove note: model name is empty\n"
    elif not note:
        err_info = "ComfyUI-Studio Remove note: note name is empty\n"
    else:
        old_model_map = CFG_MANAGER.get_detail(mtype)
        mcfg = old_model_map.get(mname, {})
        notes = mcfg.get("notes", {})
        if note_name not in notes:
            err_info = f"ComfyUI-Studio Remove note: note [{note_name}] not find\n"
        else:
            notes.pop(note_name)
            CFG_MANAGER.dirty = True
            CFG_MANAGER.dump_config()
            ret_json["removed"] = True
        sys.stdout.write(f"ComfyUI-Studio Remove note: [{note_name}] success\n")
    if err_info:
        sys.stderr.write(err_info)
        sys.stderr.flush()
    return web.Response(status=200, body=json.dumps(ret_json))




@server.PromptServer.instance.routes.post("/cs/fetch_ext_name")
async def fetch_ext_name(request: web.Request):
    return web.Response(status=200, body=CUR_PATH.name)




@server.PromptServer.instance.routes.post("/cs/test")
async def test(request: web.Request):
    post = await request.post()
    json_data = "{}"
    return web.Response(status=200, body=json_data)




@server.PromptServer.instance.routes.post("/cs/fetch_setting")
async def fetch_setting(request: web.Request):
    body = {}
    try:
        body = json.loads(await request.read())
    except Exception:
        pass
    key = str(body.get("key") or "")
    if key not in SETTING_KEYS:
        return web.Response(status=200, body=json.dumps({"status": False, "message": "unknown key"}))
    return web.Response(
        status=200,
        body=json.dumps({"status": True, "key": key, "value": CFG_MANAGER.settings.get(key, "")}),
    )




@server.PromptServer.instance.routes.post("/cs/save_setting")
async def save_setting(request: web.Request):
    body = {}
    try:
        body = json.loads(await request.read())
    except Exception:
        pass
    key = str(body.get("key") or "")
    if key not in SETTING_KEYS:
        return web.Response(status=200, body=json.dumps({"status": False, "message": "unknown key"}))
    value = str(body.get("value") or "").strip()
    CFG_MANAGER.settings[key] = value
    CFG_MANAGER.dump_config()
    return web.Response(status=200, body=json.dumps({"status": True, "key": key, "saved": True}))
