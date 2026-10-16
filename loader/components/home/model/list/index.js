import { getLevelInf } from "../../../../static/js/public.js";

// 内联 SVG（禁止 emoji / 禁止 iconfont 硬凑）
const SVG_LOCKED =
  '<svg class="s2-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="9.5" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/></svg>';
const SVG_UNLOCKED =
  '<svg class="s2-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="9.5" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 7.5-2"/></svg>';
const SVG_PLUS =
  '<svg class="s2-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
// 新版本角标的闪电图标：模板用带 U+FE0F 变体选择符的闪电 emoji，契约第 9 节禁止 emoji，
// 改用同风格内联 SVG（class 里的 badge-icon 让尺寸随角标字号走）
const SVG_BOLT =
  '<svg class="s2-icon badge-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2 4.5 13.2h5.3L10 22l8.5-11.2h-5.3L13 2Z"/></svg>';

// 右键菜单图标兜底（优先用 public/contextMenu.js 挂到 window 上的同一套，避免两份不一致）
function svgSite() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.7 4 5.7 4 9s-1.4 6.3-4 9c-2.6-2.7-4-5.7-4-9s1.4-6.3 4-9Z"/></svg>';
}
function svgFolder() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l1.8 2H19.5A1.5 1.5 0 0 1 21 9.5v7A1.5 1.5 0 0 1 19.5 18h-15A1.5 1.5 0 0 1 3 16.5v-9Z"/></svg>';
}
function svgRefresh() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v4.5h-4.5"/></svg>';
}

const ICON_SITE = window.CSContextMenu?.ICONS?.site || svgSite();
const ICON_FOLDER = window.CSContextMenu?.ICONS?.folder || svgFolder();
const ICON_LOCK = window.CSContextMenu?.ICONS?.lock || SVG_LOCKED;
const ICON_REFRESH = window.CSContextMenu?.ICONS?.refresh || svgRefresh();

function getApi() {
  const api = window.comfyAPI?.api?.api || window.parent?.comfyAPI?.api?.api;
  api.api_base = "";
  return api;
}

// 与 components/home/model/index.js:5-9 保持一致的取 api 方式（那边没导出，这里复制一份）
async function csPost(path, body) {
  const resp = await getApi().fetchApi(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const text = await resp.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch (e) {
    json = { status: false, raw: text };
  }
  return { ok: resp.ok, json };
}

export default {
  props: ["curList", "selectedModel", "column"],
  data() {
    return {
      defaultCover: "./static/image/default.jpg",
      svgLocked: SVG_LOCKED,
      svgUnlocked: SVG_UNLOCKED,
      svgPlus: SVG_PLUS,
      svgBolt: SVG_BOLT,
      iconSite: ICON_SITE,
      iconFolder: ICON_FOLDER,
      iconLock: ICON_LOCK,
      iconRefresh: ICON_REFRESH,
    };
  },
  mounted() {},
  methods: {
    // Use selected items
    useModel(model) {
      this.$emit("useModel", model);
    },
    // Change selected items
    changeModel(model) {
      this.$emit("changeSelectedModel", model);
    },
    // Obtain color values based on level
    levelInf(level) {
      return getLevelInf(level).color || "#808080";
    },
    // 新版本角标文字（版本号在前、后缀在后）
    updateBadge(item) {
      const version = item?.update?.version || "";
      const suffix = this.$t("home.model.newVersion");
      return version ? version + " " + suffix : suffix;
    },
    // 角标悬浮提示。version 缺失时传空串，避免 i18n 插值漏参渲染出 {version} 占位符
    updateTip(item) {
      return this.$t("home.model.updateTip", { version: item?.update?.version || "" });
    },
    // 打开下载弹窗（由 model/index.js 接线到 downloadModal）
    openDownload() {
      this.$emit("openDownload");
    },

    /* ---------------- 锁定 ---------------- */

    // 乐观更新 + 失败回滚，成功/失败都给 $message
    async toggleLock(item) {
      if (!item) return;
      const old = !!item.locked;
      const next = !old;
      item.locked = next;
      try {
        const { ok, json } = await csPost("/cs/toggle_lock", {
          mtype: item.mtype,
          mname: item.name,
          locked: next,
        });
        if (!ok || json.status === false) throw new Error(json?.message || "toggle_lock failed");
        if (typeof json.locked === "boolean") item.locked = json.locked;
        if (item.locked) {
          this.$message({ type: "success", message: this.$t("home.model.lockOff") });
        } else {
          this.$message({ type: "success", message: this.$t("home.model.lockOn") });
        }
      } catch (e) {
        item.locked = old; // 回滚
        this.$message({ type: "error", message: this.$t("home.model.lockFailed") });
      }
    },

    /* ---------------- 右键菜单 ---------------- */

    onContextMenu(evt, item) {
      if (typeof this.$contextMenu !== "function") return;
      this.$contextMenu(evt, [
        {
          icon: this.iconSite,
          text: this.$t("home.contextMenu.openSite"),
          action: () => this.openModelSite(item),
        },
        {
          icon: this.iconFolder,
          text: this.$t("home.contextMenu.openFolder"),
          action: () => this.openLocalFolder(item),
        },
        { divider: true },
        {
          icon: this.iconLock,
          text: this.$t("home.contextMenu.toggleLock"),
          action: () => this.toggleLock(item),
        },
        {
          icon: this.iconRefresh,
          text: this.$t("home.contextMenu.updateOne"),
          action: () => this.fetchOneMetadata(item),
        },
      ]);
    },

    // 跳转模型原网站：有 update.url 用它，否则退化为站内搜索
    openModelSite(item) {
      const url = item?.update?.url;
      if (url) {
        window.open(url, "_blank");
        return;
      }
      const keyword = encodeURIComponent(String(item?.name || "").replace(/\\/g, "/").split("/").pop() || "");
      window.open(`https://civitai.com/search/models?query=${keyword}`, "_blank");
    },

    // 打开本地存放目录
    async openLocalFolder(item) {
      try {
        const { ok, json } = await csPost("/cs/open_folder", {
          mtype: item?.mtype,
          mname: item?.name,
        });
        if (!ok || json.status === false) throw new Error(json?.message || "open_folder failed");
      } catch (e) {
        this.$message({ type: "error", message: this.$t("home.model.openFolderFailed") });
      }
    },

    // 仅更新当前模型元数据（单模型走批量接口的 names: [name]）
    async fetchOneMetadata(item) {
      try {
        const { ok, json } = await csPost("/cs/fetch_metadata", {
          mtype: item?.mtype,
          names: [item?.name],
          skip_locked: true,
          overwrite_prompts: false,
        });
        if (!ok || !json.task_id) throw new Error(json?.message || "fetch_metadata failed");
        this.$message({ type: "success", message: this.$t("home.head.fetching") });
        this.pollTask(json.task_id, item);
      } catch (e) {
        this.$message({ type: "error", message: this.$t("home.model.fetchFailed") });
      }
    },

    // 轮询任务；拿到结果后把 arch / update 原地写回，卡片徽标立刻可见
    async pollTask(taskId, item) {
      const api = getApi();
      const deadline = Date.now() + 1000 * 60 * 10;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1500));
        let json = null;
        try {
          const resp = await api.fetchApi(
            `/cs/fetch_metadata_status?task_id=${encodeURIComponent(taskId)}`,
            { method: "GET" }
          );
          json = await resp.json();
        } catch (e) {
          return; // 网络层失败就不再重试
        }
        if (!json) return;
        if (json.running) continue;
        const result = (json.results || []).find((r) => r && r.name === item?.name);
        if (result?.ok === false) {
          this.$message({ type: "error", message: item?.name + " - " + (result.reason || "") });
        } else {
          this.$emit("refreshMetadata", item);
        }
        return;
      }
    },
  },
  template: `
              <div class="model_list" :style="{'--column':column}">
                  <div v-for="(item,index) in curList" :key="index" class="model_item" :class="{'selected':item === selectedModel}"
                       @click="changeModel(item)" @dblclick="useModel(item)"
                       @contextmenu.prevent="onContextMenu($event, item)">
                      <div class="img_container" :style="{'--height': (73.05 - (column * 0.55)) / column + 'vw' }">
                          <img :src="item.cover || defaultCover" alt="cover" />
                          <div v-if="item.update" class="badge-update" :title="updateTip(item)">
                              <span v-html="svgBolt"></span>
                              <span class="badge-text">{{updateBadge(item)}}</span>
                          </div>
                          <div class="badge-lock" :class="item.locked ? 'locked' : 'unlocked'"
                               :title="$t('home.model.lockOn')"
                               @click.stop="toggleLock(item)" v-html="item.locked ? svgLocked : svgUnlocked"></div>
                      </div>
                      <div class="model_des" :style="{'--height':6 / column * 3 + 'vw'}">
                          <div class="level" :style="{'background':levelInf(item.level)}">{{item.level}}</div>
                          <div class="text_des">
                              <p :title="item.name">{{item.name}}</p>
                              <p :title="item.type">{{item.type}}</p>
                          </div>
                      </div>
                  </div>
                  <div class="model_item model-card-download" :title="$t('home.model.downloadCardTip')" @click="openDownload">
                      <div class="download-icon-circle" v-html="svgPlus"></div>
                      <div class="download-title">{{$t('home.model.downloadCard')}}</div>
                      <div class="download-tip">{{$t('home.model.downloadCardTip')}}</div>
                  </div>
              </div>
  `,
};
