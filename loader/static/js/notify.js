// 气泡出口：loader iframe 里 $message 挂在 Vue 原型上（static/js/message.js）；
// 同一模块也可能由 window.CSvm.renderer 在 ComfyUI 父页里实例化，那里没有全局 Vue，
// 故两条都试（后者同 blueprints.js 的 `window.CSvm?.$t` 约定）。
// detail 只进控制台，避免把整段错误塞进气泡；两条都拿不到才退回 console。
export function notify(type, key, detail) {
  const vm = typeof window !== "undefined" ? window.CSvm : null;
  const proto = typeof Vue !== "undefined" ? Vue.prototype : null;
  const push = (proto && proto.$message) || (vm && vm.$message);
  const i18n = (vm && vm.$i18n) || (proto && proto.$i18n);
  const text = i18n && i18n.t ? i18n.t(key) : key;
  if (push) push({ type: type, message: detail ? text + "：" + detail : text });
  else console.error("[studio] " + text + (detail ? " " + detail : ""));
  if (push && detail) console.error("[studio] " + key + " " + detail);
}
