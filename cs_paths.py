from pathlib import Path


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


# shortcut: 仅覆盖 Lora Manager 已扫描的本地文件；需要在线档案时再扩展 provider 链。
LORA_MANAGER_DB = CUR_PATH.parent.joinpath("ComfyUI-Lora-Manager", "cache", "model", "comfyui.sqlite")



STATIC_DIR = set()
