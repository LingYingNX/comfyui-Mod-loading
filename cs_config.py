import json
import os
import shutil
import sys
import time
from pathlib import Path
from .utils import (
    find_lora_manager_metadata,
    parse_jsonld_image,
    parse_prompt_blocks,
    pick_civitai_cover,
    read_json,
)
from .cs_paths import CONFIG_PATH




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




# ---- 通用设置存取：写入 model-config.json 顶层 settings 键 ----
# 用途：C站 API Key 等原先只存浏览器 localStorage 的设置，改存插件配置文件，
# 换浏览器/换端口/清浏览器数据都不丢。
SETTING_KEYS = {"civitai_api_key"}
