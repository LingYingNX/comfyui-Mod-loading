/**
 * 下载弹窗 —— 模型卡片网格尾部那张「下载新模型」卡点开的窗口。
 *
 * 契约：E:\DeepSeek项目\comfyui插件\STUDIO-V2-SPEC.md 第 7 节「下载卡片」
 * 视觉基准：C:\Users\LYNX\Desktop\gemini-code-1791895693133.html（只读）
 *
 * 流程：填链接 -> POST /cs/download_model -> 轮询 /cs/download_status 显示进度
 *       -> 后端下完自动算 hash、抓 Civitai 元数据、写预览图与触发词 -> 这里 emit done
 * 下载目标目录 = 打开弹窗时当前选中的分类（没有分类就落到模型根目录）。
 */
const CSS_HREF = "/cs/loader/components/public/downloadModal.css";

// index.html 已 link，但 loader 跑在只隐藏不重载的 iframe 里，浏览器可能还拿着旧 index.html。
// 模块是每次重新取的，所以在这里补一次，样式永远跟着代码走。
if (!document.querySelector('link[href*="public/downloadModal.css"]')) {
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = CSS_HREF;
  css.dataset.downloadModalCss = "1";
  document.head.appendChild(css);
}

const SVG_CLOSE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

function getApi() {
  const api = window.comfyAPI?.api?.api || window.parent?.comfyAPI?.api?.api;
  api.api_base = "";
  return api;
}

export default {
  name: "DownloadModal",
  props: {
    mtype: { type: String, default: "loras" },
    category: { type: String, default: "" },
  },
  data() {
    return {
      url: "",
      name: "",
      autoName: true,
      running: false,
      percent: 0,
      gotBytes: 0,
      totalBytes: 0,
      state: "",
      taskId: "",
      svgClose: SVG_CLOSE,
    };
  },
  computed: {
    targetText() {
      return this.$t("home.download.toCategory", { category: this.category || this.mtype });
    },
    progressText() {
      return this.$t("home.download.downloading", {
        percent: this.percent,
        got: this.formatBytes(this.gotBytes),
        total: this.totalBytes ? this.formatBytes(this.totalBytes) : "?",
      });
    },
  },
  methods: {
    formatBytes(bytes) {
      const value = Number(bytes) || 0;
      if (value >= 1024 ** 3) return (value / 1024 ** 3).toFixed(2) + " GB";
      if (value >= 1024 ** 2) return (value / 1024 ** 2).toFixed(1) + " MB";
      if (value >= 1024) return (value / 1024).toFixed(1) + " KB";
      return value + " B";
    },
    close() {
      if (this.running) return;
      this.$emit("close");
    },
    async submit() {
      if (this.running) return;
      const url = (this.url || "").trim();
      if (!url) {
        this.$message({ type: "error", message: this.$t("home.download.needUrl") });
        return;
      }
      this.running = true;
      this.state = "pending";
      this.percent = 0;
      this.gotBytes = 0;
      this.totalBytes = 0;
      try {
        const resp = await getApi().fetchApi("/cs/download_model", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url,
            name: (this.name || "").trim(),
            mtype: this.mtype,
            category: this.category || "",
            auto_name: this.autoName,
            api_key: this.$store.state.config.civitai || "",
          }),
        });
        const json = await resp.json();
        if (!resp.ok || !json.status || !json.task_id) throw new Error(json?.message || "start failed");
        this.taskId = json.task_id;
        await this.poll();
      } catch (error) {
        this.running = false;
        this.state = "failed";
        this.$message({ type: "error", message: this.$t("home.download.failed") });
      }
    },
    async poll() {
      const api = getApi();
      const deadline = Date.now() + 1000 * 60 * 60;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1200));
        let json = null;
        try {
          const resp = await api.fetchApi(`/cs/download_status?task_id=${encodeURIComponent(this.taskId)}`, {
            method: "GET",
          });
          json = await resp.json();
        } catch (error) {
          continue;
        }
        if (!json) continue;
        this.state = json.state || "";
        this.percent = json.percent || 0;
        this.gotBytes = json.got_bytes || 0;
        this.totalBytes = json.total_bytes || 0;
        if (json.running) continue;
        this.running = false;
        if (this.state === "done") {
          this.$message({ type: "success", message: this.$t("home.download.done") });
          this.$emit("done", json.current || this.name);
          this.$emit("close");
        } else {
          this.$message({ type: "error", message: json.message || this.$t("home.download.failed") });
        }
        return;
      }
      this.running = false;
    },
  },
  template: `
    <div class="s2-modal-mask" @click.self="close">
      <div class="s2-modal" role="dialog" aria-modal="true">
        <div class="s2-modal-head">
          <h3>{{$t('home.download.title')}}</h3>
          <button class="s2-modal-x" type="button" :disabled="running" @click="close" v-html="svgClose"></button>
        </div>
        <div class="s2-modal-body">
          <div class="s2-field">
            <label>{{$t('home.download.url')}}</label>
            <input v-model="url" :disabled="running" :placeholder="$t('home.download.urlPlaceholder')" @keydown.enter="submit" />
          </div>
          <div class="s2-field">
            <label>{{$t('home.download.name')}}</label>
            <input v-model="name" :disabled="running" :placeholder="$t('home.download.namePlaceholder')" />
          </div>
          <div class="s2-target">{{targetText}}</div>
          <label class="s2-check">
            <input type="checkbox" v-model="autoName" :disabled="running" />
            <span>{{$t('home.download.autoName')}}</span>
          </label>
          <div v-if="running" class="s2-progress">
            <div class="s2-progress-bar" :style="{width: Math.max(percent, 2) + '%'}"></div>
          </div>
          <div v-if="running" class="s2-progress-text">{{progressText}}</div>
        </div>
        <div class="s2-modal-foot">
          <button class="s2-btn ghost" type="button" :disabled="running" @click="close">{{$t('home.download.cancel')}}</button>
          <button class="s2-btn primary" type="button" :disabled="running" @click="submit">{{$t('home.download.confirm')}}</button>
        </div>
      </div>
    </div>
  `,
};
