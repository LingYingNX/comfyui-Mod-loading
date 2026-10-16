import hoverMenu from "../../public/hoverMenu.js";
import IconRenderer from "../../public/iconRenderer.js";
import { KNOWN_ARCHS, ARCH_OTHER } from "../../../static/js/public.js";
// import { app } from "/scripts/app.js";

// 下拉菜单里的架构显示名（键是 static/js/public.js 的 KNOWN_ARCHS 值，与后端 arch 字段一致）
// 只列 Illustrious / SDXL 1.0 / Anima Pencil / Flux.1 四项，Pony / SD1.5 接在其后（有模型才渲染）。
const ARCH_LABELS = {
  Illustrious: "Illustrious",
  SDXL: "SDXL 1.0",
  Anima: "Anima Pencil",
  Flux: "Flux.1",
  Pony: "Pony",
  "SD1.5": "SD1.5",
};

// 下拉项左侧的彩色圆点。模板用 🟣🔴🟢⚡ 四个 emoji（:951-954），按反面清单换成内联 SVG 圆点，
// 颜色沿用卡片架构徽章的配色：Illustrious 淡紫 / SDXL 洋红 / Anima 薄荷绿；
// Flux 在模板里是 ⚡（黄），取 warning 同一档琥珀；Pony / 其他走中性灰。
const ARCH_DOT = {
  Illustrious: "#c4b5fd",
  SDXL: "#f472b6",
  Anima: "#6ee7b7",
  Flux: "#f59e0b",
  Pony: "#a78bfa",
  "SD1.5": "#9ca3af",
};
const DOT_NEUTRAL = "#6b7280";

// index.html 已 link 过，但 loader 跑在只隐藏不重载的 iframe 里，浏览器可能还拿着旧 index.html。
// 模块每次重新取，所以在这里补一次，样式永远跟着代码走（与 nav/index.js 同一套做法）。
if (!document.querySelector('link[href*="home/head/studio2.css"]')) {
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = "/cs/loader/components/home/head/studio2.css";
  document.head.appendChild(css);
}

function getApi() {
  const api = window.comfyAPI?.api?.api || window.parent.comfyAPI?.api?.api;
  api.api_base = "";
  return api;
}

// 后端返回的 V2 字段，批量抓完元数据后按这些键回读贴回卡片
const V2_KEYS = ["arch", "update", "locked", "cover", "prompt_authors", "prompts"];

const ext = {
  is_rendering: false,
  name: "ComfyUI-Studio.head",
  async register() {
    try {
      const { app } = await import("/scripts/app.js");
      app.registerExtension(ext);
    } catch (error) {
      // console.error(error);
    }
  },
};
ext.register();

export default {
  props: {
    columnIndex: {
      default: 0,
      type: Number,
    },
    allList: {
      default: () => {
        return [];
      },
      type: Array,
    },
    // 左侧架构导航的当前选中值（由 home.js 从 searchParameter 透传），用来让顶栏按钮
    // 跟着左侧导航变：顶栏下拉与左侧导航是同一份筛选状态的两个入口。
    arch: {
      default: "",
      type: String,
    },
    tag: {
      default: "",
      type: String,
    },
  },
  components: { HoverMenu: hoverMenu },
  data() {
    return {
      value: "",
      fetching: false,
      archOpen: false,
      task: { total: 0, done: 0, current: "" },
      search: {
        key: "",
        sort: "",
        level: "",
        arch: "",
      },
    };
  },
  computed: {
    language() {
      return this.$store.state.config.language;
    },
    // 已选架构的显示名；空串 = 全部。
    // 模板 :946 收拢态显示的是「全部」（短词），选项列表里那项才是「全部架构」（:950）。
    archLabel() {
      const arch = this.search.arch;
      if (!arch) return this.$t("home.nav.all");
      if (arch === ARCH_OTHER) return this.$t("home.nav.other");
      return ARCH_LABELS[arch] || arch;
    },
    // 与左侧架构导航同一份分组、同一份计数。
    // 计数为 0 的架构不渲染：模板 :951-954 只列了有模型的架构，第 9 节反面清单也禁止占位项。
    archOptions() {
      const otherName = this.$t("home.nav.other");
      const buckets = {};
      KNOWN_ARCHS.forEach((name) => (buckets[name] = 0));
      buckets[ARCH_OTHER] = 0;
      (this.allList || []).forEach((model) => {
        const arch = model?.arch || "";
        buckets[KNOWN_ARCHS.includes(arch) ? arch : ARCH_OTHER] += 1;
      });
      const list = [
        { key: "", name: this.$t("home.head.archAll"), count: (this.allList || []).length, dot: "" },
      ];
      KNOWN_ARCHS.forEach((name) => {
        if (!buckets[name]) return;
        list.push({ key: name, name: ARCH_LABELS[name] || name, count: buckets[name], dot: ARCH_DOT[name] || DOT_NEUTRAL });
      });
      if (buckets[ARCH_OTHER]) {
        list.push({ key: ARCH_OTHER, name: otherName, count: buckets[ARCH_OTHER], dot: DOT_NEUTRAL });
      }
      return list;
    },
  },
  mounted() {
    document.addEventListener("click", this.onDocumentClick);
  },
  watch: {
    // 左侧导航（或任何人）改了共享的架构筛选 → 顶栏按钮文案跟着变。
    // 只赋值不 emit，避免与 changeArch 形成回环。
    arch: {
      handler(v) {
        if (this.search.arch !== (v || "")) this.search.arch = v || "";
      },
      immediate: true,
    },
  },
  beforeDestroy() {
    document.removeEventListener("click", this.onDocumentClick);
  },
  methods: {
    // Change sorting method
    changeSort(value) {
      const data = this.$t("home.head.categoryList")[value].value;
      this.search.sort = data;
      this.search.key = "";
      this.$emit("changeSearchParameter", this.search);
    },
    // Filter list based on level
    changeLevel(value) {
      const data = this.$t("home.head.rateList")[value].value;
      this.search.key = "";
      this.search.level = data;
      this.$emit("changeSearchParameter", this.search);
    },
    // Change the quantity that can be displayed in a row
    changeColumn(value) {
      const data = this.$t("home.head.sizeList")[value].value;
      localStorage.setItem("columnIndex", value);
      this.$emit("changeColumn", data);
    },
    // 顶栏架构筛选下拉：展开 / 收起
    toggleArch() {
      this.archOpen = !this.archOpen;
    },
    // 选中一个架构。与左侧架构导航共用同一份筛选状态，所以两个字段一起发：
    // arch 为空串 = 全部架构。
    changeArch(key) {
      this.archOpen = false;
      this.search.arch = key || "";
      this.$emit("changeSearchParameter", { arch: this.search.arch });
    },
    // Esc 收起下拉
    onArchKeydown(e) {
      if (e.key === "Escape") this.archOpen = false;
    },
    // 点空白收起：模板用 document 级 click 实现，这里照搬（不在菜单里点就关）
    onDocumentClick(e) {
      if (!this.archOpen) return;
      if (e.target?.closest?.(".arch_menu")) return;
      this.archOpen = false;
    },
    // Enter key for search
    handleKeyDown(e) {
      if (e.key === "Enter") {
        this.handleSearch();
      }
    },
    // Click to search
    handleSearch() {
      this.search.key = this.value;
      this.$emit("changeSearchParameter", this.search);
      this.value = "";
    },
    // 一键获取元数据：批量抓 Civitai，已上锁的模型和后端判定「你自己写过提示词」的会被跳过
    fetchMetadata() {
      if (this.fetching) return;
      const mtype = this.allList[0]?.mtype;
      if (!mtype) {
        this.$message({ type: "error", message: this.$t("home.model.fetchFailed") });
        return;
      }
      this.$confirmBox({
        describe: this.$t("home.head.fetchStart"),
        refuseText: this.$t("confirmBox.refuseText"),
        acceptText: this.$t("confirmBox.acceptText"),
        accept: () => this.runFetch(mtype),
        refuse: () => {},
      });
    },
    async runFetch(mtype) {
      this.fetching = true;
      this.task = { total: this.allList.length, done: 0, current: "" };
      try {
        const resp = await getApi().fetchApi("/cs/fetch_metadata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mtype,
            names: [],
            skip_locked: true,
            overwrite_prompts: false,
            api_key: this.$store.state.config.civitai || "",
          }),
        });
        const json = await resp.json();
        if (!json.status || !json.task_id) throw new Error("no task");
        this.task.total = json.total || this.task.total;
        await this.pollFetch(json.task_id);
      } catch (error) {
        this.fetching = false;
        this.$message({ type: "error", message: this.$t("home.model.fetchFailed") });
      }
    },
    // 轮询任务进度，结束后回读一次配置把卡片刷成新数据
    async pollFetch(taskId) {
      const api = getApi();
      while (this.fetching) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        let json = null;
        try {
          const resp = await api.fetchApi(`/cs/fetch_metadata_status?task_id=${encodeURIComponent(taskId)}`, { method: "GET" });
          json = await resp.json();
        } catch (error) {
          continue;
        }
        if (!json) continue;
        this.task = { total: json.total || 0, done: json.done || 0, current: json.current || "" };
        if (json.running) continue;
        this.fetching = false;
        const okCount = json.ok || 0;
        const failedCount = json.failed || 0;
        // 全部失败时把第一条原因带上，否则用户只看到一个数字，不知道是网络还是没这个人
        const firstErr = okCount || !failedCount
          ? ""
          : String(((json.results || []).find((item) => !item.ok) || {}).reason || "").slice(0, 140);
        this.$message({
          type: okCount ? "success" : "error",
          message:
            this.$t("home.head.fetchDone", { ok: okCount, skipped: json.skipped || 0, failed: failedCount }) +
            (firstErr ? " · " + firstErr : ""),
        });
        await this.reloadConfig();
        return;
      }
    },
    // 批量抓完后 allList 还是旧快照，按名字回读一次把 arch / update / cover / 提示词贴回
    async reloadConfig() {
      const mtype = this.allList[0]?.mtype;
      if (!mtype || !this.allList.length) return;
      try {
        const resp = await getApi().fetchApi("/cs/fetch_config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mtype, models: this.allList.map((item) => item.name) }),
        });
        const map = await resp.json();
        this.allList.forEach((item) => {
          const fresh = map && map[item.name];
          if (!fresh) return;
          V2_KEYS.forEach((key) => {
            if (key in fresh) this.$set(item, key, fresh[key]);
          });
        });
      } catch (error) {
        // 静默失败：卡片停在旧值，刷新页面即可
      }
    },
    // 关闭整个 loader 页面（模板 :967-969 顶栏右端的 ⏻ 圆形按钮）。
    // 曾按 captain 的第一版指令误删，现依据模板第 968 行恢复；实现与 R1（HEAD 版本）逐字一致：
    // 正在渲染缩略图时先确认一次，因为关闭会终止正在跑的任务。
    closePage() {
      if (!this.renderer?.rendering) {
        window.parent.postMessage({ type: "close_loader_page" }, "*");
        return;
      }
      this.$confirmBox({
        describe: this.$t("home.head.closePageConfirm"),
        refuseText: this.$t("confirmBox.refuseText"),
        acceptText: this.$t("confirmBox.acceptText"),
        accept: () => {
          this.renderer?.stop();
          window.parent.postMessage({ type: "close_loader_page" }, "*");
        },
        refuse: () => {},
      });
    },
  },
  template: `<div class="head">
                <div class="left">
                    <span class="title">{{$t("home.head.title")}}</span>
                    <div class="search">
                        <input type="value" v-model="value" :placeholder="$t('home.head.search')"   @keydown="handleKeyDown($event)" />
                        <span @click="handleSearch"><em class="iconfont icon-search"></em></span>
                    </div>
                    <HoverMenu icon="icon-exchange" :list="$t('home.head.categoryList')" @changeValue= "changeSort" />
                    <div class="arch_menu">
                        <button class="arch_btn" type="button" :class="{'open': archOpen}" @click.stop="toggleArch" @keydown="onArchKeydown($event)">
                            <svg class="arch_btn_icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/></svg>
                            <span class="arch_btn_label">{{$t("home.head.archFilter")}}:</span>
                            <strong class="arch_btn_value">{{archLabel}}</strong>
                            <em class="arch_btn_arrow">▼</em>
                        </button>
                        <div v-if="archOpen" class="arch_list">
                            <div v-for="item in archOptions" :key="item.key || 'all'" class="arch_item" :class="{selected: search.arch === item.key}" @click.stop="changeArch(item.key)">
                                <svg v-if="item.dot" class="arch_item_dot" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="5" :fill="item.dot"/></svg>
                                <span class="arch_item_name">{{item.name}}</span>
                                <span class="arch_item_right">
                                    <span v-if="search.arch === item.key" class="arch_item_mark">●</span>
                                    <span class="arch_item_count">{{item.count}}</span>
                                </span>
                            </div>
                        </div>
                    </div>
                    <HoverMenu icon="icon-medal" class="space" :list="$t('home.head.rateList')" @changeValue= "changeLevel" />
                    <HoverMenu icon="" :value="columnIndex" :list="$t('home.head.sizeList')" @changeValue= "changeColumn" />
                    <div class="block"></div>
                    <button class="render_button" :class="{'fetching': fetching}" :disabled="fetching" @click="fetchMetadata">{{ fetching ? $t("home.head.fetching") : $t("home.head.fetchText") }}</button>
                    <span v-if="fetching" class="fetch_tip">{{$t("home.head.fetchProgress", {done: task.done, total: task.total, current: task.current})}}</span>
                </div>
                <div class="right">
                    <button class="close_button" type="button" :title="$t('home.head.closePageConfirm')" @click="closePage">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 3.5v7"/><path d="M7.5 6.4a6.6 6.6 0 1 0 9 0"/></svg>
                    </button>
                </div>
            </div>`,
};
