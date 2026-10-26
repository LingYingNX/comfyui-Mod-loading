import { app } from "../../../../scripts/app.js";
import BluePrints from "./blueprints.js";
import IconRenderer from "./components/public/iconRenderer.js";
import { DEFAULT_WIDGET_TYPES } from "./static/js/public.js";
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

// 模型菜单只认「左键单击」：Shift + 左键那条分支随设置页入口一起移除（不再有 UI 能改 shortcut）
function shouldPopUp(event) {
  var clicked = event.type === LiteGraph.pointerevents_method + "down";
  return !event.shiftKey && clicked;
}

function popUpReg() {
  let f = LGraphCanvas.prototype.processNodeWidgets;
  function processNodeWidgets(node, pos, event, active_widget) {
    if (shouldPopUp(event)) {
      if (!node || !node.widgets || !node.widgets.length || (!this.allow_interaction && !node.flags.allow_interaction)) {
        return null;
      }

      var x = pos[0] - node.pos[0];
      var y = pos[1] - node.pos[1];
      var width = node.size[0];

      for (var i = 0; i < node.widgets.length; ++i) {
        var w = node.widgets[i];
        // 仅枚举
        if (!w || w.disabled || w.type !== "combo") continue;
        var w_height = w.computeSize ? w.computeSize(width)[1] : LiteGraph.NODE_WIDGET_HEIGHT;
        var w_width = w.width || width;
        // outside
        if (w != active_widget && (x < 6 || x > w_width - 12 || y < w.last_y || y > w.last_y + w_height || w.last_y === undefined)) continue;

        var delta = x < 40 ? -1 : x > w_width - 40 ? 1 : 0;
        if (!delta) {
          // combo clicked
          // console.error(node.title, node.constructor.type, w.name, event.type);
          if (node.CSnative || DEFAULT_WIDGET_TYPES[w.name]) {
            let page = loadPage();
            page.style.display = "block";
            window.CSvm.node = node;
            window.CSvm.entryWidget = w.name;
            if (!window.CSvm.renderer) {
              window.CSvm.renderer = new IconRenderer();
            }
            page.focus();
            return w;
          }
          continue;
        }
      }
    }
    return f.call(this, node, pos, event, active_widget);
  }
  LGraphCanvas.prototype.processNodeWidgets = processNodeWidgets;
  let fff = app.canvas.onMouse;
  function onMouse(event) {
    var w = this.pointer.element.data.getWidgetAtCursor();
    var node = this.graph.getNodeOnPos(event.canvasX, event.canvasY, this.visible_nodes);
    if (shouldPopUp(event)) {
      if (!node || !node.widgets || !node.widgets.length || (!this.allow_interaction && !node.flags.allow_interaction)) {
        return fff ? fff.call(this, event) : false;
      }
      // 仅枚举
      if (!w || w.disabled || w.type !== "combo") {
        return fff ? fff.call(this, event) : false;
      }
      if (node.CSnative || DEFAULT_WIDGET_TYPES[w.name]) {
        let page = loadPage();
        page.style.display = "block";
        window.CSvm.node = node;
        window.CSvm.entryWidget = w.name;
        if (!window.CSvm.renderer) {
          window.CSvm.renderer = new IconRenderer();
        }
        page.focus();
        return true;
      }
    }
    return fff ? fff.call(this, event) : false;
  }
  app.canvas.onMouse = onMouse;
}

const ext = {
  name: "AIGODLIKE.MMM",
  async init(app) {
    loadPage();
    styleInit();
    popUpReg();
  },
  nodeCreated(node, app) {
    registerCallBack(node);
  },
};

app.registerExtension(ext);
