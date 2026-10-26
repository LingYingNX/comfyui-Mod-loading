from hashlib import md5, sha256
import time
import folder_paths
from pathlib import Path
from .cs_config import CFG_MANAGER
from .cs_paths import IMG_SUFFIXES, WK_PATH




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




THUMBNAIL_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".gif"}


MAX_THUMBNAIL_BYTES = 20 * 1024 * 1024




def safe_thumbnail_suffix(filename: str) -> str:
    suffix = Path(filename or "").suffix.lower()
    if suffix not in THUMBNAIL_SUFFIXES:
        raise ValueError("unsupported thumbnail type")
    return suffix




def is_supported_image(data: bytes, suffix: str) -> bool:
    if suffix == ".png":
        return data.startswith(b"\x89PNG\r\n\x1a\n")
    if suffix in {".jpg", ".jpeg"}:
        return data.startswith(b"\xff\xd8\xff")
    if suffix == ".gif":
        return data.startswith((b"GIF87a", b"GIF89a"))
    if suffix == ".webp":
        return len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP"
    return False




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
