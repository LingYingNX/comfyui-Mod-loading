import { getApi } from "../../static/js/api.js";

// import { api } from "/scripts/api.js";

// 气泡出口：本 class 由 enterLoader.js 在 ComfyUI 父页里 new 出来（父页没有全局 Vue），
// 兜底走 window.CSvm（loader 起来后 iframe 自己挂的，同 blueprints.js 的 `window.CSvm?.$t` 约定）；
// 在 iframe 内跑时则直接命中 Vue 原型上的 $message。detail 只进控制台，避免把整段节点报错塞进气泡。
function notify(type, key, detail) {
  const vm = typeof window !== "undefined" ? window.CSvm : null;
  const proto = typeof Vue !== "undefined" ? Vue.prototype : null;
  const push = (proto && proto.$message) || (vm && vm.$message);
  const i18n = (vm && vm.$i18n) || (proto && proto.$i18n);
  const text = i18n && i18n.t ? i18n.t(key) : key;
  if (push) push({ type: type, message: detail ? text + "：" + detail : text });
  else console.error("[studio] " + text + (detail ? " " + detail : ""));
  if (push && detail) console.error("[studio] " + key + " " + detail);
}

class IconRenderer {
  get rendering() {
    return this._rendering;
  }
  set rendering(v) {
    this._rendering = v;
    this.rendering_setter?.(v);
  }
  get progress_value() {
    return this._progress_value;
  }
  set progress_value(v) {
    this._progress_value = v;
    this.progress_value_setter?.(v);
  }

  constructor(app) {
    this.task_index = 0;
    this.task_count = 0;
    this.loop_finished = true;

    this._rendering = false;
    this.rendering_setter = null;
    this._progress_value = 0;
    this.progress_value_setter = null;

    this.stopped = false;

    this.executed_cb_user = null;
    const api = getApi();
    api.addEventListener("progress", this.progress.bind(this));
    api.addEventListener("executed", this.executed.bind(this));
    api.addEventListener("execution_start", this.execution_start.bind(this));
    api.addEventListener("executing", this.executing.bind(this));
    api.addEventListener("execution_error", this.execution_error.bind(this));
    api.addEventListener("execution_cached", this.execution_cached.bind(this));
    api.addEventListener(
      "execution_interrupted",
      this.execution_interrupted.bind(this)
    );
    api.addEventListener("open", this.open.bind(this));
    api.addEventListener("close", this.close.bind(this));
    api.addEventListener("error", this.error.bind(this));
  }
  progress({ detail }) {
    // console.log("progress", detail.value / detail.max);
    this.progress_value = (detail.value / detail.max) * 100;
  }
  executed({ detail }) {
    // console.log("executed", detail);
    this.executed_cb(detail);
  }
  execution_start({ detail }) {
    // console.log("execution_start", detail);
  }
  executing({ detail }) {
    // console.log("executing", detail);
  }
  execution_error({ detail }) {
    // console.log("execution_error", detail);
    this.markEndLoop();
  }
  execution_cached({ detail }) {
    // console.log("execution_cached", detail);
  }
  execution_interrupted({ detail }) {
    // console.log("execution_interrupted", detail);
    this.markEndLoop();
  }
  open({ detail }) {}
  close({ detail }) {}
  error({ detail }) {
    this.markEndLoop();
  }
  async executed_cb(detail) {
    try {
      const images = detail?.output?.images;
      if (!images || !images.length) return;
      let name = encodeURIComponent(images[0].filename);
      let type = images[0].type;
      let subfolder = encodeURIComponent(images[0].subfolder);
      // let fmt = app.getPreviewFormatParam();
      // const src1 = api.apiURL(`/view?filename=${name}&type=${type}&subfolder=${subfolder}${fmt}`);

      const src = [`/view?filename=${name}`, `type=${type}`, `subfolder=${subfolder}`, `&t=${+new Date()}`].join("&");
      await this.executed_cb_user(src, name);
    } catch (e) {}
    this.markEndLoop();
  }
  async waitForOneLoop() {
    while (this.loop_finished !== true) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  markNewLoop() {
    this.progress_value = 0;
    this.loop_finished = false;
  }
  markEndLoop() {
    this.loop_finished = true;
    this.progress_value = 0;
  }
  async fetch_image(src, name) {
    return new Promise((resolve, reject) => {
      var blob = null;
      var xhr = new XMLHttpRequest();
      let url = new URL(src, window.location.origin);
      xhr.open("GET", url);
      xhr.setRequestHeader("Accept", "image/jpeg");
      xhr.responseType = "blob";
      xhr.onload = () => {
        blob = xhr.response;
        let file = new File([blob], name, { type: "image/png" });
        resolve(file);
      };
      xhr.onerror = (e) => {
        reject(e);
      };
      xhr.send();
    });
  }

  async executed_cb_user_factory(model, src, name) {
    // console.log(model.name, src);
    // 从src 读取image 为File 对象
    const file = await this.fetch_image(src, name);
    // 如果 读图报错 则不上传缩略图
    if (!file) {
      return;
    }
    try {
      const body = new FormData();
      body.append("image", file);
      body.append("type", model.type);
      body.append("mtype", model.mtype);
      body.append("name", model.name);
      const api = getApi();
      await api.fetchApi("/cs/upload_thumbnail", {
        method: "POST",
        body,
      });
      model.cover = src;
    } catch (error) {
      notify("error", "home.model.uploadFailed", String((error && error.message) || error));
    }
  }

  async render(inputNode, modelList) {
    if (this.rendering || !this.loop_finished) return;
    this.startRender();
    try {
      await this.render_ex(inputNode, modelList);
    } catch (e) {
      // console.log(e);
    }
    this.endRender();
  }

  startRender() {
    this.stopped = false;
    this.rendering = true;
    this.progress_value = 0;
    this.task_count = 0;
    this.task_index = 0;
  }

  endRender() {
    this.stopped = false;
    this.rendering = false;
    this.progress_value = 0;
    this.task_count = 0;
    this.task_index = 0;
  }

  async render_ex(inputNode, modelList) {
    if (!modelList || !modelList.length) {
      return;
    }
    let comfyWindow = window.parent;
    let app = comfyWindow.app;
    this.task_count = modelList.length;
    for await (let model of modelList) {
      inputNode.CSsetModelWidget(model.data || model.name);
      await this.waitForOneLoop();
      if (this.stopped) {
        break;
      }
      this.markNewLoop();
      this.task_index++;
      this.executed_cb_user = this.executed_cb_user_factory.bind(this, model);
      await app.queuePrompt(1);
      // app.lastNodeErrors 可能为 null 或 {}
      if (app.lastNodeErrors && Object.keys(app.lastNodeErrors).length > 0) {
        this.markEndLoop();
        let lastNodeErrors = app.lastNodeErrors;
        let msg = [];
        for (let k of Object.keys(lastNodeErrors)) {
          let nodeError = lastNodeErrors[k];
          msg.push(nodeError.class_type);
          for (let e of nodeError.errors) {
            if (!e.message) continue;
            msg.push("    " + e.message);
          }
        }
        notify("error", "home.model.executeFailed", msg.join(" · "));
        break;
      }
    }
    await this.waitForOneLoop(); // 等待最后一个执行完成
  }

  stop() {
    this.stopped = true;
    const api = getApi();
    api.clearItems("queue");
    api.interrupt();
  }
}
export default IconRenderer;
