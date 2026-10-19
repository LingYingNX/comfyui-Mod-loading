export function getApi() {
  const api = window.comfyAPI?.api?.api || window.parent?.comfyAPI?.api?.api;
  api.api_base = "";
  return api;
}
