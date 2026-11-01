import { getApi } from "../../../../../static/js/api.js";
import { sameModelSelection } from "../../../../../static/js/public.js";

function csPost(path, body) {
  return getApi()
    .fetchApi(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    })
    .then(async (resp) => {
      const text = await resp.text();
      let json = {};
      try {
        json = text ? JSON.parse(text) : {};
      } catch (error) {
        json = { status: false, raw: text };
      }
      return { ok: resp.ok, json };
    });
}

export default {
  name: "BasicInf",
  props: {
    model: {
      default: () => {
        return {};
      },
      type: Object,
    },
    allList: {
      default: () => [],
      type: Array,
    },
    selectedWidget: {
      default: null,
    },
  },

  computed: {
    versionList() {
      const current = this.model;
      if (!current) return [];
      const key = this.projectKey(current);
      if (!key) return [current];
      const versions = (Array.isArray(this.allList) ? this.allList : []).filter(
        (item) => item && item.mtype === current.mtype && this.projectKey(item) === key
      );
      if (!versions.includes(current)) versions.push(current);
      const unique = new Map();
      versions.forEach((item) => unique.set(`${item.mtype || ""}:${item.name || ""}`, item));
      return [...unique.values()].sort((a, b) => {
        const published = this.dateValue(b.publishedAt) - this.dateValue(a.publishedAt);
        if (Number.isFinite(published) && published !== 0) return published;
        return this.versionLabel(a).localeCompare(this.versionLabel(b), "zh-CN", { numeric: true });
      });
    },
    remoteVersionCount() {
      return this.versionList.reduce(
        (count, item) => Math.max(count, Number(item.remoteVersionCount) || 0),
        0
      );
    },
  },

  data() {
    return {
      refreshingKey: "",
      expandedVersions: {},
    };
  },

  methods: {
    projectKey(item) {
      const match = String(item?.url || "").match(/civitai\.com\/models\/(\d+)/i);
      return match ? `civitai:${match[1]}` : "";
    },
    versionFileLabel(item) {
      const name = String(item?.name || "").replace(/\\/g, "/").split("/").pop();
      return name.replace(/\.[^.]+$/, "") || "—";
    },
    versionLabel(item) {
      return this.versionFileLabel(item);
    },
    versionKey(item) {
      return `${item?.mtype || ""}:${item?.name || ""}`;
    },
    dateValue(value) {
      if (!value) return NaN;
      const numeric = Number(value);
      if (Number.isFinite(numeric)) return numeric < 1e12 ? numeric * 1000 : numeric;
      return Date.parse(String(value));
    },
    fullTimestamp(value) {
      const time = this.dateValue(value);
      if (!Number.isFinite(time)) return "—";
      const date = new Date(time);
      if (Number.isNaN(date.getTime())) return "—";
      const pad = (number) => String(number).padStart(2, "0");
      return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    },
    timestampConversion(value) {
      return this.fullTimestamp(value).slice(0, 10);
    },
    archLabel(item) {
      return String(item?.arch || item?.baseModel || "").trim() || "—";
    },
    archClass(item) {
      return this.archLabel(item)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "");
    },
    formatSize(item) {
      const sizeKB = Number(item?.sizeKB) || 0;
      const sizeMB = sizeKB > 0 ? sizeKB / 1024 : Number(item?.size) || 0;
      if (!sizeMB) return "—";
      if (sizeMB >= 1024) return `${(sizeMB / 1024).toFixed(2)} GB`;
      return `${sizeMB.toFixed(2)} MB`;
    },
    formatResolution(value) {
      const text = String(value || "").trim();
      return text ? text.replace(/\s*[x×]\s*/i, " × ") : "—";
    },
    isActive(item) {
      return sameModelSelection(item?.data || item?.name, this.selectedWidget);
    },
    isSelected(item) {
      return item === this.model;
    },
    isExpanded(item) {
      return this.expandedVersions[this.versionKey(item)] !== false;
    },
    toggleExpanded(item) {
      const key = this.versionKey(item);
      this.$set(this.expandedVersions, key, !this.isExpanded(item));
    },
    selectVersion(item) {
      if (item && item !== this.model) this.$emit("changeVersion", item);
    },
    useVersion(item) {
      if (!this.isActive(item)) this.$emit("useVersion", item);
    },
    async openFolder(item) {
      try {
        const { ok, json } = await csPost("/cs/open_folder", {
          mtype: item?.mtype,
          mname: item?.name,
        });
        if (!ok || json.status === false) throw new Error(json?.message || "open_folder failed");
      } catch (error) {
        this.$message({ type: "error", message: this.$t("home.model.openFolderFailed") });
      }
    },
    isRefreshing(item) {
      return this.refreshingKey === this.versionKey(item);
    },
    async refreshMetadata(item) {
      if (!item?.mtype || !item?.name || this.refreshingKey) return;
      this.refreshingKey = this.versionKey(item);
      try {
        const started = await csPost("/cs/fetch_metadata", {
          mtype: item.mtype,
          names: [item.name],
          skip_locked: false,
          overwrite_prompts: false,
        });
        if (!started.ok || !started.json.task_id) throw new Error("fetch_metadata failed");
        const deadline = Date.now() + 10 * 60 * 1000;
        while (Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          const resp = await getApi().fetchApi(
            `/cs/fetch_metadata_status?task_id=${encodeURIComponent(started.json.task_id)}`,
            { method: "GET" }
          );
          const status = await resp.json();
          if (status.running) continue;
          const result = (status.results || []).find((entry) => entry?.name === item.name);
          if (result?.ok === false) throw new Error(result.reason || "metadata failed");
          this.$emit("refreshMetadata", item);
          this.$message({
            type: "success",
            message: this.$t("home.modelDetail.basicInf.refreshDone"),
          });
          return;
        }
        throw new Error("metadata timeout");
      } catch (error) {
        this.$message({
          type: "error",
          message: this.$t("home.modelDetail.basicInf.refreshFailed"),
        });
      } finally {
        this.refreshingKey = "";
      }
    },
  },

  template: `<div class="basic_inf">
    <div class="version_panel">
      <div class="version_stack">
        <article v-for="item in versionList" :key="item.name" class="version_item"
                 :class="{ selected: isSelected(item), collapsed: !isExpanded(item) }">
          <div class="version_item_head">
            <button type="button" class="version_expand" @click="toggleExpanded(item)"
                    :aria-expanded="isExpanded(item) ? 'true' : 'false'"
                    :aria-label="isExpanded(item) ? $t('home.modelDetail.basicInf.collapse') : $t('home.modelDetail.basicInf.expand')"
                    :title="isExpanded(item) ? $t('home.modelDetail.basicInf.collapse') : $t('home.modelDetail.basicInf.expand')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
            </button>
            <button type="button" class="version_heading" @click="selectVersion(item)"
                    :aria-pressed="isSelected(item) ? 'true' : 'false'"
                    :aria-label="versionLabel(item)" :title="item.name">
              <span class="version_name">{{versionLabel(item)}}</span>
              <span class="version_arch" :class="archClass(item)">{{archLabel(item)}}</span>
            </button>
            <span v-if="!isActive(item)" class="version_state">
              <i aria-hidden="true"></i>
              {{ $t("home.modelDetail.basicInf.installedVersion") }}
            </span>
          </div>

          <div v-show="isExpanded(item)" class="version_body">
            <div class="version_inf">
              <div class="version_inf_item">
                <span>{{$t("home.modelDetail.basicInf.baseModel")}}</span>
                <b>{{item.baseModel || "—"}}</b>
              </div>
              <div class="version_inf_item">
                <span>{{$t("home.modelDetail.basicInf.size")}}</span>
                <b>{{formatSize(item)}}</b>
              </div>
              <div class="version_inf_item">
                <span>{{$t("home.modelDetail.basicInf.type")}}</span>
                <b>{{item.fileFormat || item.type || "—"}}</b>
              </div>
              <div class="version_inf_item">
                <span>{{$t("home.modelDetail.basicInf.recommendedWeight")}}</span>
                <b>{{item.recommendedWeight || "—"}}</b>
              </div>
              <div class="version_inf_item">
                <span>{{$t("home.modelDetail.basicInf.trainingResolution")}}</span>
                <b>{{formatResolution(item.trainingResolution)}}</b>
              </div>
              <div class="version_inf_item">
                <span>{{$t("home.modelDetail.basicInf.clipSkip")}}</span>
                <b>{{item.clipSkip || "—"}}</b>
              </div>
              <div class="version_inf_item">
                <span>{{$t("home.modelDetail.basicInf.publishedTime")}}</span>
                <b :title="fullTimestamp(item.publishedAt)">{{timestampConversion(item.publishedAt)}}</b>
              </div>
              <div class="version_inf_item">
                <span>{{$t("home.modelDetail.basicInf.modificationTime")}}</span>
                <b :title="fullTimestamp(item.modifyTime)">{{timestampConversion(item.modifyTime)}}</b>
              </div>
            </div>

            <div class="version_actions">
              <button type="button" class="version_action primary" :class="{active: isActive(item)}"
                      :disabled="isActive(item)" @click="useVersion(item)">
                <svg v-if="isActive(item)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>
                <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2 4.5 13.2h5.3L10 22l8.5-11.2h-5.3L13 2Z"/></svg>
                <span>{{ isActive(item) ? $t("home.modelDetail.basicInf.activeVersion") : $t("home.modelDetail.basicInf.switchVersion") }}</span>
              </button>
              <button type="button" class="version_action" @click="openFolder(item)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l1.8 2H19.5A1.5 1.5 0 0 1 21 9.5v7A1.5 1.5 0 0 1 19.5 18h-15A1.5 1.5 0 0 1 3 16.5v-9Z"/></svg>
                <span>{{$t("home.modelDetail.basicInf.openFolder")}}</span>
              </button>
            </div>
          </div>
        </article>
      </div>
    </div>
  </div>`,
};
