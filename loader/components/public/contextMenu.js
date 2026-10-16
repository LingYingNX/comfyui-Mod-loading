/*
 * 右键菜单（纯 DOM，不是 Vue 组件）
 * 契约：STUDIO-V2-SPEC.md 第 7.2 节
 *   挂载点：Vue.prototype.$contextMenu
 *   签名：  (mouseEvent, items) => void
 *   items： [{ icon, text, action, danger? }]
 * 行为：
 *   - 定位到鼠标点；超出视口右/下边界自动翻转（往左/往上收）
 *   - 点菜单本身以外任何地方、按 Esc、窗口 resize / 滚动 都关闭
 *   - 重复调用复用同一个 DOM 节点（只建一次，之后只换内容与位置）
 *   - 图标由调用方传内联 SVG 字符串，本组件不做任何内联样式注入
 * 样式在 components/public/contextMenu.css（loader/index.html 已 link）。
 *
 * 调用示例（卡片列表里）：
 *   this.$contextMenu(evt, [
 *     { icon: ICON_SITE, text: this.$t("home.contextMenu.openSite"), action: () => {...} },
 *   ]);
 */

const ICON_SITE =
  '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.7 4 5.7 4 9s-1.4 6.3-4 9c-2.6-2.7-4-5.7-4-9s1.4-6.3 4-9Z"/></svg>';
const ICON_FOLDER =
  '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l1.8 2H19.5A1.5 1.5 0 0 1 21 9.5v7A1.5 1.5 0 0 1 19.5 18h-15A1.5 1.5 0 0 1 3 16.5v-9Z"/></svg>';
const ICON_LOCK =
  '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="9.5" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/></svg>';
const ICON_REFRESH =
  '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v4.5h-4.5"/></svg>';

const MENU_CLASS = "s2-context-menu";
const ITEM_CLASS = "s2-context-item";
const DIVIDER_CLASS = "s2-context-divider";

let menuEl = null; // 复用同一个节点
let openEvent = null; // 唤起当前菜单的那个事件对象（用于识别「同一张卡再右键一次」）

function ensureNode() {
  if (menuEl && menuEl.isConnected) return menuEl;
  menuEl = document.createElement("div");
  menuEl.className = MENU_CLASS;
  // 菜单自己右键也不该冒泡去触发页面上的其它 contextmenu
  menuEl.addEventListener("contextmenu", (e) => e.stopPropagation());
  document.body.appendChild(menuEl);
  return menuEl;
}

function close() {
  openEvent = null;
  if (!menuEl) return;
  menuEl.classList.remove("is-open");
  menuEl.innerHTML = "";
  menuEl.style.left = "";
  menuEl.style.top = "";
  document.removeEventListener("mousedown", onDocPointerDown, true);
  document.removeEventListener("keydown", onDocKeyDown, true);
  window.removeEventListener("resize", close);
  window.removeEventListener("scroll", close, true);
}

function onDocPointerDown(e) {
  // 点在菜单内部不关（菜单项的 click 会自己关）
  if (menuEl && menuEl.contains(e.target)) return;
  // 上一轮残留的捕获期 mousedown 会先于本次 contextmenu 到达：若这串事件
  // 和刚打开菜单的那次是同一个事件，就别把新菜单关掉（否则右键换卡片时菜单会闪一下消失）
  if (openEvent && e === openEvent) return;
  close();
}

function onDocKeyDown(e) {
  if (e.key === "Escape" || e.key === "Esc" || e.keyCode === 27) close();
}

function normalize(items) {
  return (Array.isArray(items) ? items : []).filter(
    (it) => it && (it.icon || it.text || it.divider)
  );
}

/**
 * @param {MouseEvent} mouseEvent 触发右键的事件（需要 clientX / clientY）
 * @param {Array<{icon?:string,text?:string,action?:Function,danger?:boolean,divider?:boolean}>} items
 */
export function contextMenu(mouseEvent, items) {
  const list = normalize(items);
  if (!mouseEvent || typeof mouseEvent.clientX !== "number" || list.length === 0) {
    close();
    return;
  }

  const el = ensureNode();
  const x = mouseEvent.clientX;
  const y = mouseEvent.clientY;

  // 先清空再填内容，保证拿到的 offsetWidth/offsetHeight 是本次菜单的尺寸
  el.innerHTML = "";
  el.classList.remove("is-open");
  el.style.left = "0px";
  el.style.top = "0px";

  list.forEach((conf) => {
    if (conf.divider) {
      const hr = document.createElement("div");
      hr.className = DIVIDER_CLASS;
      el.appendChild(hr);
      return;
    }
    const item = document.createElement("div");
    item.className = ITEM_CLASS + (conf.danger ? " is-danger" : "");
    if (conf.icon) {
      const ico = document.createElement("span");
      ico.className = "s2-context-icon";
      ico.innerHTML = conf.icon; // 只接受内联 SVG 字符串
      item.appendChild(ico);
    }
    const text = document.createElement("span");
    text.className = "s2-context-text";
    text.textContent = conf.text ?? "";
    item.appendChild(text);
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      close();
      const fn = conf.action;
      if (typeof fn === "function") fn(mouseEvent);
    });
    el.appendChild(item);
  });

  // 先显示拿到真实尺寸（display:none 时量不到）
  el.classList.add("is-open");
  // 记下本次的唤起事件，供 onDocPointerDown 识别「同一张卡再右键一次」
  openEvent = mouseEvent;

  const pad = 6;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = x;
  let top = y;
  // 超出右边界 → 往左翻转；超出下边界 → 往上翻转
  if (left + w + pad > vw) left = x - w;
  if (top + h + pad > vh) top = y - h;
  // 两个方向都放不下时兜底，别让菜单跑出视口
  left = Math.max(pad, Math.min(left, Math.max(pad, vw - w - pad)));
  top = Math.max(pad, Math.min(top, Math.max(pad, vh - h - pad)));

  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;

  document.addEventListener("mousedown", onDocPointerDown, true);
  document.addEventListener("keydown", onDocKeyDown, true);
  window.addEventListener("resize", close);
  window.addEventListener("scroll", close, true);
}

contextMenu.close = close;
contextMenu.ICONS = {
  site: ICON_SITE,
  folder: ICON_FOLDER,
  lock: ICON_LOCK,
  refresh: ICON_REFRESH,
};

// 与 static/js/message.js / confirm.js 同一套挂载方式（Vue 由 index.html 先加载为全局）
if (typeof Vue !== "undefined") {
  Vue.prototype.$contextMenu = contextMenu;
}

if (typeof window !== "undefined") window.CSContextMenu = contextMenu;

export default contextMenu;
