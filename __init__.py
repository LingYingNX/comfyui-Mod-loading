"""AIGODLIKE-ComfyUI-Studio 入口：装配模块、注册路由、挂载静态目录。

实现按领域拆到同级模块：
  cs_paths          路径与常量
  cs_config         model-config.json 读写（ConfigManager / CFG_MANAGER）
  cs_managers       模型 / 缩略图 / 后台任务管理器
  cs_civitai        Civitai 抓取与元数据落库
  cs_download       模型下载
  cs_static         静态资源挂载与限流
  cs_routes_models  @server.PromptServer 路由（import 时注册）
  cs_routes_meta    @server.PromptServer 路由（import 时注册）
"""
from . import cs_routes_models, cs_routes_meta  # noqa: F401  路由在 import 时注册到 PromptServer
from .cs_lora_stack import (  # noqa: F401  节点与提示词路由在 import 时注册
    NODE_CLASS_MAPPINGS as LORA_STACK_NODE_CLASS_MAPPINGS,
    NODE_DISPLAY_NAME_MAPPINGS as LORA_STACK_NODE_DISPLAY_NAME_MAPPINGS,
)
from .cs_static import init

init()

NODE_CLASS_MAPPINGS = {
    **LORA_STACK_NODE_CLASS_MAPPINGS,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    **LORA_STACK_NODE_DISPLAY_NAME_MAPPINGS,
}
WEB_DIRECTORY = "./loader"
