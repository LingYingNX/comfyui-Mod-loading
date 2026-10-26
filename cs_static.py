from os import PathLike
from aiohttp.web_urldispatcher import AbstractRoute, UrlDispatcher
import server
import urllib.parse
from aiohttp import web
from pathlib import Path
from .cs_paths import CUR_PATH, MOUNT_ROOT, STATIC_DIR




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
