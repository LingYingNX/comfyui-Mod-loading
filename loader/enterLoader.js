import { app } from "../../../../scripts/app.js";
import BluePrints from "./blueprints.js";
import IconRenderer from "./components/public/iconRenderer.js";
function getPage() {
  return document.getElementById("loader_iframe");
}

function loadPage() {
  let page = getPage();
  if (page) return page;
  window.removeEventListener("message", message);
  // index.html 是「插件面板的壳」：它只在整个 ComfyUI 页面刷新时加载一次，
  // 之后一直在 iframe 里活着（enterLoader 只创建一次，靠 display 切换显隐）。
  // 而服务端给 index.html 的响应不带 Cache-Control（只有 ETag / Last-Modified），
  // 浏览器可能用启发式缓存直接回旧 HTML → 旧的 <link> 列表 + 新的 CSS/JS，
  // 表现为「面板一半新一半旧」。加一个每次加载都不同的查询串，强制拿最新壳。
  var realpath = "/cs/loader/index.html?v=" + Date.now();
  const html = `<iframe id="loader_iframe" src="${realpath}" frameborder="0"></iframe>`;
  document.body.insertAdjacentHTML("beforeend", html);
  page = getPage();
  page.style.display = "none";
  let w = page.contentWindow;
  window.addEventListener("message", message);
  // w.focus();
  w.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      w.parent.postMessage({ type: "close_loader_page" }, "*");
    }
  });
}

function callBack() {
  let page = loadPage();
  page.style.display = "block";
  window.CSvm.node = this._node;
  window.CSvm.entryWidget = "default";
  if (!window.CSvm.renderer) {
    window.CSvm.renderer = new IconRenderer();
  }
  page.focus();
}

function message(event) {
  if (event.data.type === "close_loader_page") {
    let page = getPage();
    page.style.display = "none";
    window.CSvm.node = null; // reset node
    // document.body.removeChild(document.getElementById("loader_iframe"));
  }
}

function registerCallBack(node) {
  BluePrints.prototype.CSregister(node, callBack);
}

function styleInit() {
  const style = document.createElement("style");
  style.type = "text/css"; // 已启用 需要更改
  style.innerHTML = `
    iframe {
      position: absolute;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
      z-index: 9999;
      background: #000000;
    }
  `;
  document.head.appendChild(style);
}

const ext = {
  name: "AIGODLIKE.MMM",
  async init(app) {
    loadPage();
    styleInit();
  },
  nodeCreated(node, app) {
    registerCallBack(node);
  },
};

app.registerExtension(ext);
