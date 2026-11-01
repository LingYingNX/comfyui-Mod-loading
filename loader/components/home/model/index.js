import ModelList from "./list/index.js";
import ModelDetail from "./detail/index.js";
import DownloadModal from "../../public/downloadModal.js";
import { ARCH_OTHER, sameModelSelection } from "../../../static/js/public.js";
import { getApi } from "../../../static/js/api.js";
// import { api } from "/scripts/api.js";
import { notify } from "../../../static/js/notify.js";

const V2_MODEL_KEYS = [
  "arch",
  "url",
  "update",
  "publishedAt",
  "locked",
  "cover",
  "prompt_authors",
  "prompts",
  "baseModel",
  "versionName",
  "versionId",
  "modelId",
  "createdAt",
  "fileFormat",
  "sizeKB",
  "sha256",
  "recommendedWeight",
  "trainingResolution",
  "clipSkip",
  "remoteVersionCount",
];

async function update_config(model, key, old_data, cb = (resp) => {}) {
  try {
    const body = new FormData();
    body.append("data", JSON.stringify(model));
    // 如果 old_data为基本类型 则直接赋值
    if (typeof old_data !== "object") {
      body.append("old_data", old_data);
    } else {
      body.append("old_data", JSON.stringify(old_data));
    }
    body.append("key", key);
    const api = getApi();
    let resp = await api.fetchApi("/cs/update_config", {
      method: "POST",
      body,
    });
    cb(resp);
  } catch (error) {
    notify("error", "home.model.saveFailed", String((error && error.message) || error));
  }
}

export default {
  components: { ModelList, ModelDetail, DownloadModal },
  props: {
    allList: {
      default: () => {
        return [];
      },
      type: Array,
    },
    selectedWidget: {
      default: null,
      type: [String, Object],
    },
    column: {
      default: 0,
      type: Number,
    },
    searchParameter: {
      default: () => {
        return {};
      },
      type: Object,
    },
  },
  watch: {
    allList: {
      handler(newValue) {
        this.filterList(this.searchParameter);
      },
      immediate: true,
    },
    curList: {
      handler(newValue) {
        this.$store.commit("prop/setCurModelList", newValue);
      },
    },
    searchParameter: {
      handler(newValue) {
        this.filterList(newValue);
      },
      immediate: true,
      deep: true,
    },
    selectedWidget: {
      handler(value) {
        this.activeWidget = value;
        if (this.allList.length) this.filterList(this.searchParameter);
      },
      immediate: true,
    },
    // 底模筛选（顶栏下拉写入 searchParameter.arch，由上面的 searchParameter watcher 触发重过滤）
  },
  data() {
    return {
      curList: [],
      selectedModel: null,
      activeWidget: null,
      downloadOpen: false,
      metadataVersion: 0,
    };
  },
  methods: {
    activateModel(model) {
      const value = model.data || model.name;
      this.node.CSsetModelWidget(value);
      this.activeWidget = value;
      this.selectedModel = model;
    },
    // Use model
    useModel(model, close = true) {
      let renderer = this.renderer;
      let node = this.node;
      if (!node) return;
      if (!renderer?.rendering) {
        this.activateModel(model);
        if (close) window.parent.postMessage({ type: "close_loader_page" }, "*");
        return;
      }
      this.$confirmBox({
        describe: this.$t("home.model.useModelConfirm"),
        refuseText: this.$t("confirmBox.refuseText"),
        acceptText: this.$t("confirmBox.acceptText"),
        accept: () => {
          // 点击确认调用
          renderer?.stop();
          this.activateModel(model);
          if (close) window.parent.postMessage({ type: "close_loader_page" }, "*");
        },
        refuse: () => {},
      });
    },
    // Change name
    modifyName(model, value) {
      let old_data = model.name;
      model.name = value;
      async function cb(resp) {
        if (resp.status === 200) {
          let json = await resp.json();
          if (!json.hasOwnProperty("status") || !json.status) {
            model.name = old_data;
            notify("error", "home.model.modifyFailed");
          }
        }
      }
      update_config(model, "name", old_data, cb);
    },
    // Modify cover
    modifyCover(coverSrc) {
      this.selectedModel.cover = coverSrc;
    },
    // Change selected items
    changeSelectedModel(model) {
      this.selectedModel = model;
    },
    // Filter and filter all data based on criteria
    filterList(searchParameter) {
      const newList = this.allList.filter((x) => {
        const key = x.name.includes(searchParameter.key);
        const tag = searchParameter.tags.length === 0 || x.tags.find((tagItem) => searchParameter.tags.includes(tagItem));
        // 底模筛选：优先使用元数据 baseModel，旧数据回退 arch。
        const archFilter = searchParameter.arch || "";
        const baseModel = String(x.baseModel || x.arch || "").trim();
        const arch = !archFilter || (archFilter === ARCH_OTHER ? !baseModel : baseModel === archFilter);
        if (this.node) {
          let filters = this.node.CSgetModelFilters(true);
          if (filters?.includes(x.name)) {
            return false;
          }
        }
        return key && tag && arch;
      });
      this.sortList(searchParameter.sort, newList);
      this.curList = newList;
      this.selectedModel = false;
      if (this.activeWidget == null) {
        this.selectedModel = this.curList[0] || false;
        return;
      }
      for (let i = 0; i < this.curList.length; i++) {
        if (sameModelSelection(this.curList[i].data || this.curList[i].name, this.activeWidget)) {
          this.selectedModel = this.curList[i] || false;
          return;
        }
      }
      // selectedWidget 可能不在 curList 中(被屏蔽了)
      this.selectedModel = this.curList[0] || false;
    },
    // Sort data based on conditions
    sortList(orderValue, newList) {
      switch (orderValue) {
        case 0:
          newList.sort((a, b) => b.creationTime - a.creationTime);
          break;
        case 1:
          newList.sort((a, b) => a.creationTime - b.creationTime);
          break;
        case 2:
          newList.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
          break;
        case 3:
          newList.sort((a, b) => b.name.localeCompare(a.name, "zh-CN"));
          break;
        case 6:
          newList.sort((a, b) => a.size - b.size);
          break;
        case 7:
          newList.sort((a, b) => b.size - a.size);
          break;
      }
    },
    // 打开下载弹窗
    openDownload() {
      this.downloadOpen = true;
    },
    // 下载目标 mtype：优先用当前选中模型，其次列表第一条
    currentMtype() {
      return this.selectedModel?.mtype || this.curList[0]?.mtype || "loras";
    },
    // 下载目标分类：当前选中的分类标签；没选就落到模型根目录
    currentCategory() {
      const tags = this.searchParameter?.tags || [];
      return tags[0] || "";
    },
    // 单模型元数据抓完后回读配置，把 arch / update / cover / 提示词贴回卡片
    async refreshMetadata(item) {
      if (!item?.mtype || !item?.name) return;
      try {
        const resp = await getApi().fetchApi("/cs/fetch_config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mtype: item.mtype, models: [item.name] }),
        });
        const map = await resp.json();
        const fresh = map && map[item.name];
        if (!fresh) return;
        V2_MODEL_KEYS.forEach((key) => {
          if (key in fresh) this.$set(item, key, fresh[key]);
        });
        // 提示词工作台持有本地编辑副本，用独立令牌通知它拉取刚写回的数据
        this.metadataVersion += 1;
      } catch (error) {
        // 静默失败：卡片上是旧值，用户再点一次即可
      }
    },
  },
  template: `
            <div class="model_display">
                <ModelList v-if="curList.length > 0" :curList="curList" :all-list="allList" :selected-model="selectedModel" :column="column" @changeSelectedModel="changeSelectedModel" @useModel="useModel" @openDownload="openDownload" @refreshMetadata="refreshMetadata" />
                <ModelDetail v-if="curList.length > 0" :all-list="allList" :model="selectedModel" :selected-widget="activeWidget" :metadata-version="metadataVersion" @changeSelectedModel="changeSelectedModel" @modifyCover="modifyCover" @modifyName="modifyName" @refreshMetadata="refreshMetadata" @useModel="useModel" />
                <DownloadModal v-if="downloadOpen" :mtype="currentMtype()" :category="currentCategory()" @close="downloadOpen = false" />
                <div v-if="curList.length === 0" class="empty">
                  <p v-if="searchParameter.key">{{$t('home.searchValue')}}: {{searchParameter.key}}</p>
                  {{$t('noResult')}}
                </div>
            </div>
`,
};
