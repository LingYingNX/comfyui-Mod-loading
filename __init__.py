import asyncio
import json
import os
import shutil
import subprocess
import sys
from os import PathLike
from hashlib import md5, sha256
from aiohttp.web_urldispatcher import AbstractRoute, UrlDispatcher
import aiohttp
import server
import time
import folder_paths
import urllib.parse
from copy import deepcopy
from aiohttp import web
from pathlib import Path
from .utils import read_json
"""
1. 上传图片到缩略图文件夹
2. 获取模型管理配置
3. 更新模型管理配置

"""
CUR_PATH = Path(__file__).parent.absolute()
MOUNT_ROOT = "/cs/"
IMG_SUFFIXES = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tiff", ".svg", ".ico", ".apng", ".tif", ".hdr", ".exr"]
CONFIG_PATH = CUR_PATH.joinpath("model-config.json")
WK_PATH = CUR_PATH.joinpath("workflow")

STATIC_DIR = set()


class ConfigManager:
    def __init__(self, path: Path = None) -> None:
        self.dirty = False
        self.details = {}
        self.filters = {}
        self.path = path if path else CONFIG_PATH
        self.init_config()

    def init_config(self, config: dict[str, list[dict]] = None):
        if config is None:
            config = self.load_config()
        self.details = config.get("details", {})
        self.filters = config.get("filters", {})
        self.settings = config.get("settings", {})

    def get_detail(self, mtype: str) -> dict[dict]:
        if mtype not in self.details:
            self.details[mtype] = {}
        return self.details.get(mtype)

    def get_filter(self, loader: str) -> list[dict]:
        if loader not in self.filters:
            self.filters[loader] = []
        return self.filters.get(loader)

    def load_config(self):
        if not self.path.exists():
            return {}
        bak = self.path.with_name(self.path.name + ".bak")
        for p in (self.path, bak):
            if not p.exists():
                continue
            try:
                return read_json(p)
            except Exception as e:
                sys.stderr.write(f"ComfyUI-Studio Fetch config: {p} read failed: {e}\n")
                sys.stderr.flush()
        # 主文件与备份都读不出来 -> 判定损坏：挪走坏文件，并禁止本次会话覆盖磁盘
        try:
            self.path.replace(self.path.with_name(self.path.name + f".corrupt-{int(time.time())}"))
        except Exception:
            pass
        self.readonly = True
        return {}

    def dump_config(self, config: dict[str, list[dict]] = None):
        if getattr(self, "readonly", False):
            sys.stderr.write("ComfyUI-Studio: config is corrupt, skip dump to avoid overwriting\n")
            sys.stderr.flush()
            return
        if not self.path.parent.exists():
            self.path.parent.mkdir(parents=True)
        if config is None:
            config = {"details": self.details, "filters": self.filters, "settings": self.settings}
        try:
            tmp = self.path.with_name(self.path.name + ".tmp")
            tmp.write_text(json.dumps(config, indent=4, ensure_ascii=False), encoding="utf8")
            if self.path.exists():
                try:
                    read_json(self.path)  # 只把「合法 JSON」的当前版本留作备份
                    shutil.copy2(self.path, self.path.with_name(self.path.name + ".bak"))
                except Exception:
                    pass
            os.replace(tmp, self.path)  # 原子替换：断电最多留个 .tmp，主文件永远完整
        except Exception as e:
            sys.stderr.write(f"ComfyUI-Studio Fetch config: {e}\n")
            sys.stderr.flush()


CFG_MANAGER = ConfigManager()


class ModelManager:
    MODEL_ALIAS = {
        "unet": ["diffusion_models"],
        "clip": ["text_encoders"],
    }

    @staticmethod
    def model_path_dict() -> dict[str, tuple[list[str], set[str]]]:
        cfg_example = {
            'checkpoints': (['/MODELPATH1/checkpoints', '/MODELPATH2/checkpoints'], {'.ckpt', '.safetensors', '.pt', '.bin', '.pth'}),
            'configs': (['/MODELPATH1/configs'], ['.yaml']),
            'loras': (['/MODELPATH1/loras'], {'.ckpt', '.safetensors', '.pt', '.bin', '.pth'}),
            'vae': (['/MODELPATH1/vae', '/MODELPATH2/vae'], {'.ckpt', '.safetensors', '.pt', '.bin', '.pth'}),
            'clip': (['/MODELPATH1/clip', '/MODELPATH2/clip'], {'.ckpt', '.safetensors', '.pt', '.bin', '.pth'}),
            'unet': (['/MODELPATH1/unet'], {'.ckpt', '.safetensors', '.pt', '.bin', '.pth'}),
            'clip_vision': (['/MODELPATH1/clip_vision'], {'.ckpt', '.safetensors', '.pt', '.bin', '.pth'}),
            'style_models': (['/MODELPATH1/style_models'], {'.ckpt', '.safetensors', '.pt', '.bin', '.pth'}),
            'embeddings': (['/MODELPATH1/embeddings'], {'.ckpt', '.safetensors', '.pt', '.bin', '.pth'}),
            'diffusers': (['/MODELPATH1/diffusers'], ['folder']),
            'vae_approx': (['/MODELPATH1/vae_approx'], {'.ckpt', '.safetensors', '.pt', '.bin', '.pth'}),
            'controlnet': (['/MODELPATH1/controlnet', '/MODELPATH1/t2i_adapter'], {'.ckpt', '.safetensors', '.pt', '.bin', '.pth'}),
            'gligen': (['/MODELPATH1/gligen'], {'.ckpt', '.safetensors', '.pt', '.bin', '.pth'}),
            'upscale_models': (['/MODELPATH1/upscale_models'], {'.ckpt', '.safetensors', '.pt', '.bin', '.pth'}),
            'custom_nodes': (['/Volumes/FastTemp/AI/ComfyUI/custom_nodes'], []),
            'hypernetworks': (['/MODELPATH1/hypernetworks'], {'.ckpt', '.safetensors', '.pt', '.bin', '.pth'}),
            'classifiers': (['/MODELPATH1/classifiers'], {''}),
            'mmdets_bbox': (['/MODELPATH1/mmdets/bbox'], {'.ckpt', '.safetensors', '.pt', '.bin', '.pth'}),
            'mmdets_segm': (['/MODELPATH1/mmdets/segm'], {'.ckpt', '.safetensors', '.pt', '.bin', '.pth'}),
            'mmdets': (['/MODELPATH1/mmdets'], {'.ckpt', '.safetensors', '.pt', '.bin', '.pth'}),
            'sams': (['/MODELPATH1/sams'], {'.ckpt', '.safetensors', '.pt', '.bin', '.pth'}),
            'onnx': (['/MODELPATH1/onnx'], {'.onnx'}),
            'ultralytics_bbox': (['/MODELPATH1/ultralytics/bbox'], {'.ckpt', '.safetensors', '.pt', '.bin', '.pth'}),
            'ultralytics_segm': (['/MODELPATH1/ultralytics/segm'], {'.ckpt', '.safetensors', '.pt', '.bin', '.pth'}),
            'ultralytics': (['/MODELPATH1/ultralytics'], {'.ckpt', '.safetensors', '.pt', '.bin', '.pth'}),
            'annotators': (['/MODELPATH1/annotators'], set())
        }
        return folder_paths.folder_names_and_paths

    @staticmethod
    def model_config(mtype: str):
        mtypes = [mtype.lower(), *ModelManager.MODEL_ALIAS.get(mtype.lower(), [])]
        configs = ModelManager.model_path_dict()
        for t in mtypes:
            cfg = configs.get(t, None)
            if cfg:
                return cfg
        return [[], {}]
        return ModelManager.model_path_dict().get(mtype.lower(), [[], {}])

    @staticmethod
    def get_paths(mtype):
        model_cfg = ModelManager.model_config(mtype)
        return model_cfg[0]

    @staticmethod
    def get_suffixes(mtype):
        model_cfg = ModelManager.model_config(mtype)
        return model_cfg[1]

    @staticmethod
    def model_rename(mtype, old_name: str, new_name: str):
        """
        重命名模型
        """
        ori_oname = old_name
        ori_nname = new_name
        old_name = Path(old_name).as_posix()
        new_name = Path(new_name).as_posix()
        # 模型重命名
        model_path = ModelManager.find_model(mtype, old_name)
        # Note: 模型名可能是 a\\b.ckpt a/b.ckpt 这种带有路径的模型名
        # new_model_path = model_path.with_name(new_name)
        new_model_path = model_path.as_posix().replace(old_name, new_name)
        model_path.rename(new_model_path)
        # detail / filters / workflow 重命名
        try:
            detail = CFG_MANAGER.get_detail(mtype)
            obase_name = Path(old_name).with_suffix("").as_posix()
            nbase_name = Path(new_name).with_suffix("").as_posix()
            if ori_oname in detail:
                mcfg = detail.pop(ori_oname)
                mcfg["name"] = ori_nname
                detail[ori_nname] = mcfg
                cover = mcfg.get("cover", "")
                if cover and Path(cover).exists():
                    cover = Path(cover)
                    new_cover = Path(cover.as_posix().replace(obase_name, nbase_name))
                    # new_cover_name = cover.name.replace(obase_name, nbase_name)
                    # new_cover = cover.with_name(new_cover_name)
                    cover.rename(new_cover)
                    mcfg["cover"] = new_cover.as_posix()
            if ori_oname in CFG_MANAGER.filters:
                CFG_MANAGER.filters[ori_nname] = CFG_MANAGER.filters.pop(ori_oname)
            old_wp = WK_PATH.joinpath(mtype, ori_oname)
            new_wp = WK_PATH.joinpath(mtype, ori_nname)
            if old_wp.exists():
                old_wp.rename(new_wp)
        except Exception:
            import traceback
            traceback.print_exc()

    @staticmethod
    def find_thumbnail(mname, mtype) -> str:
        # a\\b.ckpt a/b.ckpt
        pm = Path(mname)
        base_name = pm.with_suffix("")
        psb_base_names = [base_name.as_posix(), base_name.as_posix() + pm.suffix, base_name.as_posix() + ".preview", pm.stem, pm.name]
        for p in ModelManager.get_paths(mtype):
            for pbname in psb_base_names:
                for suffix in IMG_SUFFIXES:
                    img_name = pbname + suffix
                    img_path = Path(p).joinpath(img_name)
                    if not img_path.exists():
                        continue
                    return img_path.as_posix()
        return ""

    @staticmethod
    def remove_thumbnails(mtype, mname):
        """
        移除同名的 .png, .jpg, .jpeg, .gif 缩略图
        """
        model_names = [Path(mname).stem, Path(mname).name]
        for p in ModelManager.get_paths(mtype):
            for model_name in model_names:
                for suffix in IMG_SUFFIXES:
                    img_name = model_name + suffix
                    img_path = Path(p).joinpath(img_name)
                    if not img_path.exists():
                        continue
                    img_path.unlink()
                    # sys.stderr.write(img_path.as_posix() + " REMOVE\n")
                    # sys.stderr.flush()

    @staticmethod
    def find_model(mtype, model_name) -> Path:
        """
        从mtype对应的模型路径中查找模型是否存在, 存在则返回对应路径
        """
        for p in ModelManager.get_paths(mtype):
            model_path = Path(p).joinpath(model_name)
            if not model_path.exists():
                continue
            return model_path
        return Path("XXXXX")


class ThumbnailManager:
    _code_map = {}
    _path_code_map = {}
    _image_map = {}
    _image_time = {}

    @classmethod
    def add_code(cls, path: str):
        if path not in cls._image_map:
            code = md5(path.encode()).hexdigest()
            cls._code_map[code] = path
            cls._path_code_map[path] = code
        return cls._path_code_map.get(path, "")

    @classmethod
    def get_path(cls, code: str) -> str:
        return cls._code_map.get(code, "")

    @classmethod
    def add_image(cls, path: str):
        p = Path(path)
        if path in cls._image_map and p.stat().st_mtime == cls._image_time.get(path, 0):
            return
        if not p.is_file():
            cls._image_map[path] = b""
            return
        cls._image_time[path] = p.stat().st_mtime
        cls._image_map[path] = b"" if not p.exists() else p.read_bytes()

    @classmethod
    def get_image(cls, path: str) -> bytes:
        cls.add_image(path)
        return cls._image_map.get(path, b"")

    @classmethod
    def get_image_by_code(cls, code: str) -> bytes:
        path = cls.get_path(code)
        return cls.get_image(path)


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
    if not img_name:
        # 无文件名
        ret_json["msg"] = "Invalid image name"
        return web.Response(status=400, body=json.dumps(ret_json))
    model_path = ModelManager.find_model(mtype, mname)
    if not model_path.exists():
        # 模型不存在
        ret_json["msg"] = "Model not found"
        return web.Response(status=400, body=json.dumps(ret_json))
    # 移除同名的 .png, .jpg, .jpeg, .gif 缩略图 ?
    # ModelManager.remove_thumbnails(mtype, mname)
    # 保存缩略图到模型所在路径
    img_path = model_path.with_suffix(Path(img_name).suffix)
    with open(img_path, "wb") as f:
        f.write(image.file.read())
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


def find_rel_path(p, model_paths) -> str:
    """
    calc the relative path of p in model_paths
    """
    if not p:
        return ""
    for p in model_paths:
        if not p.startswith(p):
            continue
        return Path(p).relative_to(p).as_posix()
    return ""


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
            if "tags" not in mcfg:
                mcfg["tags"] = []
            mcfg["tags"].extend(dir_tags)
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


# ---- 通用设置存取：写入 model-config.json 顶层 settings 键 ----
# 用途：C站 API Key 等原先只存浏览器 localStorage 的设置，改存插件配置文件，
# 换浏览器/换端口/清浏览器数据都不丢。
SETTING_KEYS = {"civitai_api_key"}


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
    "prompt_authors": [],
    "prompts": [],
}

CIVITAI_API = "https://civitai.com/api/v1"
HTTP_UA = "ComfyUI-Studio/1.0 (+local model manager)"

# 架构识别：按 baseModel / 模型名 / 文件名依次匹配，先命中先返回
ARCH_RULES = (
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


class TaskStore:
    """后台任务表。只留最近 5 分钟内的完成态，避免长时间跑之后内存里堆一堆。"""

    def __init__(self):
        self.tasks: dict[str, dict] = {}

    def create(self, kind: str, total: int = 0) -> str:
        now = time.time()
        self.tasks = {
            k: v
            for k, v in self.tasks.items()
            if v.get("running") or now - v.get("_ts", 0) < 300
        }
        task_id = f"{kind}-{int(now * 1000)}"
        self.tasks[task_id] = {
            "task_id": task_id,
            "kind": kind,
            "running": True,
            "total": total,
            "done": 0,
            "current": "",
            "ok": 0,
            "failed": 0,
            "skipped": 0,
            "results": [],
            "_ts": now,
        }
        return task_id

    def get(self, task_id: str):
        return self.tasks.get(task_id)

    def finish(self, task_id: str):
        task = self.tasks.get(task_id)
        if task:
            task["running"] = False
            task["current"] = ""
            task["_ts"] = time.time()


TASKS = TaskStore()

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
    version = await civitai_get(f"model-versions/by-hash/{file_hash}")
    if not version:
        return {"_reason": "not_found_on_civitai"}

    model = version.get("model") or {}
    base = version.get("baseModel") or ""
    model_id = model.get("id") or version.get("modelId")
    version_id = version.get("id")

    page_url = ""
    if model_id:
        page_url = f"https://civitai.com/models/{model_id}"
        if version_id:
            page_url += f"?modelVersionId={version_id}"

    # 有没有更新的版本：拿该模型的最新版和当前文件对应的版本比
    update = None
    if model_id:
        try:
            full = await civitai_get(f"models/{model_id}")
            versions = (full or {}).get("modelVersions") or []
            latest = versions[0] if versions else None
            if latest and latest.get("id") != version_id:
                update = {
                    "version": latest.get("name") or "",
                    "url": f"https://civitai.com/models/{model_id}?modelVersionId={latest.get('id')}",
                }
        except Exception:
            pass

    words = [w for w in (version.get("trainedWords") or []) if isinstance(w, str) and w.strip()]
    authors = []
    if words:
        authors.append(
            {
                "name": version.get("name") or model.get("name") or mname,
                "prompt": ", ".join(words),
                "tokens": words,
                "note": base,
            }
        )

    images = version.get("images") or []
    cover_url = ""
    for img in images:
        if isinstance(img, dict) and img.get("url"):
            cover_url = img["url"]
            break

    return {
        "arch": guess_arch(base, model.get("name"), mname),
        "update": update,
        "prompt_authors": authors,
        "cover_url": cover_url,
        "url": page_url,
        "title": model.get("name") or version.get("name") or "",
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
    folder = model_path.parent
    try:
        if sys.platform.startswith("win"):
            os.startfile(folder.as_posix())  # noqa: S606  (Windows 专用)
        elif sys.platform == "darwin":
            subprocess.Popen(["open", folder.as_posix()])
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

            mcfg["arch"] = meta.get("arch") or mcfg.get("arch", "")
            mcfg["update"] = meta.get("update")
            mcfg["url"] = meta.get("url") or ""
            # 作者触发词：只有一条都没有时才写，不覆盖用户自己挑过的
            authors = meta.get("prompt_authors") or []
            if authors and not mcfg.get("prompt_authors"):
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

        dl_url = direct_url or f"https://civitai.com/api/download/models/{version_id}"
        task["current"] = target.name
        task["state"] = "downloading"
        timeout = aiohttp.ClientTimeout(total=None, sock_connect=30, sock_read=180)
        got = 0
        tmp = target.with_name(target.name + ".part")
        async with aiohttp.ClientSession(timeout=timeout, headers=civitai_headers(), trust_env=True) as session:
            async with session.get(dl_url) as resp:
                if resp.status != 200:
                    raise RuntimeError(f"下载失败 HTTP {resp.status}")
                total = int(resp.headers.get("Content-Length") or 0)
                task["total_bytes"] = total
                with open(tmp, "wb") as fp:
                    async for chunk in resp.content.iter_chunked(256 * 1024):
                        fp.write(chunk)
                        got += len(chunk)
                        task["got_bytes"] = got
                        task["percent"] = round(got * 100 / total, 2) if total else 0
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
            mcfg["arch"] = meta.get("arch") or ""
            mcfg["update"] = meta.get("update")
            mcfg["url"] = meta.get("url") or ""
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
        task["failed"] = 1
        task["done"] = 1
        task["state"] = "failed"
        task["message"] = str(e)
        task["results"].append({"name": name, "ok": False, "reason": str(e)})
    finally:
        TASKS.finish(task_id)


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


def thumbnail_exists(path):
    if not Path(path).exists():
        return
    if not Path(path).as_posix().startswith(tuple(STATIC_DIR)):
        return
    suffixes = (".jpg", ".jpeg", ".png", ".gif")
    return Path(path).suffix.lower() in suffixes


def path_to_url(path):
    if not path:
        return path
    path = path.replace("\\", "/")
    if not path.startswith("/"):
        path = "/" + path
    while path.startswith("//"):
        path = path[1:]
    path = path.replace("//", "/")
    return path


def suffix_limiter(self: web.StaticResource, request: web.Request):
    # pass 图片格式后缀名
    pass_suffixes = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tiff", ".svg", ".ico", ".apng", ".tif", ".hdr", ".exr"}
    band_suffixes = {".ckpt", ".safetensors", ".pt", ".bin", ".pth", ".yaml", ".onnx"}

    rel_url = request.match_info["filename"]
    try:
        filename = Path(rel_url)
        if filename.anchor:
            raise web.HTTPForbidden()
        filepath = self._directory.joinpath(filename).resolve()
        if filepath.exists() and filepath.suffix.lower() in band_suffixes:
            raise web.HTTPForbidden(reason="File type is not allowed")
    finally:
        ...


def filesize_limiter(self: web.StaticResource, request: web.Request):
    rel_url = request.match_info["filename"]
    try:
        filename = Path(rel_url)
        filepath = self._directory.joinpath(filename).resolve()
        # 如果文件大于 50MB, 则禁止访问
        if filepath.exists() and filepath.stat().st_size > 50 * 1024 * 1024:
            raise web.HTTPForbidden(reason="File size is too large")
    finally:
        ...


class LimitResource(web.StaticResource):
    """
    限制性资源
    """
    limiters = []

    def push_limiter(self, limiter):
        self.limiters.append(limiter)

    async def _handle(self, request: web.Request) -> web.StreamResponse:
        try:
            for limiter in self.limiters:
                limiter(self, request)
        except (ValueError, FileNotFoundError) as error:
            raise web.HTTPNotFound() from error

        return await super()._handle(request)

    def __repr__(self) -> str:
        name = "'" + self.name + "'" if self.name is not None else ""
        return f'<LimitResource {name} {self._prefix} -> {self._directory!r}>'


class LimitRouter(web.StaticDef):
    def __repr__(self) -> str:
        info = []
        for name, value in sorted(self.kwargs.items()):
            info.append(f", {name}={value!r}")
        return f'<LimitRouter {self.prefix} -> {self.path}{"".join(info)}>'

    def register(self, router: UrlDispatcher) -> list[AbstractRoute]:
        # resource = router.add_static(self.prefix, self.path, **self.kwargs)
        def add_static(
            self: UrlDispatcher,
            prefix: str,
            path: PathLike,
            *,
            name=None,
            expect_handler=None,
            chunk_size: int = 256 * 1024,
            show_index: bool = False,
            follow_symlinks: bool = False,
            append_version: bool = False,
        ) -> web.AbstractResource:
            assert prefix.startswith("/")
            if prefix.endswith("/"):
                prefix = prefix[:-1]
            resource = LimitResource(
                prefix,
                path,
                name=name,
                expect_handler=expect_handler,
                chunk_size=chunk_size,
                show_index=show_index,
                follow_symlinks=follow_symlinks,
                append_version=append_version,
            )
            resource.push_limiter(suffix_limiter)
            resource.push_limiter(filesize_limiter)
            self.register_resource(resource)
            return resource
        resource = add_static(router, self.prefix, self.path, **self.kwargs)
        routes = resource.get_info().get("routes", {})
        return list(routes.values())


def add_static_resource(prefix, path, pprefix=MOUNT_ROOT, limit=False):
    STATIC_DIR.add(Path(path).as_posix())
    app = server.PromptServer.instance.app
    prefix = path_to_url(prefix)
    prefix = pprefix + urllib.parse.quote(prefix)
    prefix = path_to_url(prefix)
    if limit:
        route = LimitRouter(prefix, path, {"follow_symlinks": True})
    else:
        route = web.static(prefix, path, follow_symlinks=True)
    app.add_routes([route])


def init():
    # modelpath_map = ModelManager.model_path_dict()
    # for mtype in modelpath_map:
    #     for path in modelpath_map[mtype][0]:
    #         if not Path(path).exists():
    #             continue
    #         add_static_resource(path, path, "", limit=True)
    add_static_resource("", CUR_PATH.joinpath("loader").as_posix(), pprefix="/cs/loader")


init()
NODE_CLASS_MAPPINGS = {}
WEB_DIRECTORY = "./loader"
