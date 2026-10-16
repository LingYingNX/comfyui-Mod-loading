/**
 * 提示词工作台（Prompt Studio）
 *
 * 契约：E:\DeepSeek项目\comfyui插件\STUDIO-V2-SPEC.md 第 7.3 节
 * 视觉基准：C:\Users\LYNX\Desktop\gemini-code-1791895693133.html 1077-1250 行（只读，未改动）
 *
 * 数据来源：model.prompt_authors / model.prompts，两者都可能为 undefined，读取时兜底成 []
 * 落盘：POST /cs/save_prompt { mtype, mname, prompts }
 * 样式：本目录 index.css（vw/rem 已按 SPEC 第 3 节换算）
 */
const CSS_HREF = "/cs/loader/components/home/model/detail/prompt/index.css";

// index.html 已经 link 了这份样式，但 loader 跑在一个长期存活、只隐藏不重载的 iframe 里：
// 浏览器拿着旧 index.html 时整场会话都拿不到新样式，而本模块是每次重新取的。
// 所以在这里补一次 link，让样式跟着代码走（与 components/settings/civitai/index.js 同一做法）。
if (!document.querySelector('link[href*="detail/prompt/index.css"]')) {
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = CSS_HREF;
  css.dataset.promptStudioCss = "1";
  document.head.appendChild(css);
}

function getApi() {
  const api = window.comfyAPI?.api?.api || window.parent.comfyAPI?.api?.api;
  api.api_base = "";
  return api;
}

// 新套件 id：时间戳 + 随机串，本地唯一即可
function makeSetId() {
  return "set-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export default {
  name: "PromptStudio",
  props: ["model"],
  data() {
    return {
      tab: "author",
      sets: [],
      folded: {},
    };
  },
  computed: {
    authors() {
      const list = this.model && this.model.prompt_authors;
      return Array.isArray(list) ? list : [];
    },
    // SPEC 7.3 规定的胶囊标题拼接（"套"字是 SPEC 原文，见交付说明）
    authorTabLabel() {
      return this.$t("home.modelDetail.prompt.authorTabCount") + " (" + this.authors.length + "套)";
    },
    customTabLabel() {
      return this.$t("home.modelDetail.prompt.customTabCount") + " (" + this.sets.length + ")";
    },
  },
  watch: {
    // 浅 watch：只有切换模型（对象引用变化）才重建本地副本。
    // 不用 deep，否则自己写回 model.prompts 时会把编辑中的副本和折叠状态冲掉。
    model: {
      handler() {
        this.loadSets();
      },
      immediate: true,
    },
  },
  methods: {
    loadSets() {
      const raw = this.model && this.model.prompts;
      this.sets = (Array.isArray(raw) ? raw : []).map((item) => ({
        id: (item && item.id) || makeSetId(),
        title: (item && item.title) || "",
        content: (item && item.content) || "",
      }));
      this.tab = "author";
      this.folded = {};
    },
    switchTab(tab) {
      this.tab = tab === "custom" ? "custom" : "author";
    },
    isFolded(id) {
      return !!this.folded[id];
    },
    toggleFold(id) {
      this.$set(this.folded, id, !this.folded[id]);
    },
    // 一键复制 / 点单个 token：先试 clipboard API，失败退回 execCommand
    // （loader 在 iframe 里，clipboard 权限可能不足）
    copyText(text) {
      const value = text == null ? "" : String(text);
      if (!value) return;
      const notify = () => {
        this.$message({ type: "success", message: this.$t("home.modelDetail.prompt.copyDone") });
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(value).then(notify, () => {
          if (this.execCopy(value)) notify();
        });
        return;
      }
      if (this.execCopy(value)) notify();
    },
    execCopy(value) {
      const el = document.createElement("textarea");
      el.value = value;
      el.setAttribute("readonly", "readonly");
      el.style.position = "fixed";
      el.style.top = "-1000px";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch (error) {
        ok = false;
      }
      document.body.removeChild(el);
      return ok;
    },
    // 新建套件：先插一条空的，落盘，然后聚焦它的标题输入框
    addSet() {
      this.sets.push({ id: makeSetId(), title: "", content: "" });
      this.$nextTick(() => {
        const ref = this.$refs.titleInputs;
        const last = Array.isArray(ref) ? ref[ref.length - 1] : ref;
        if (last && last.focus) last.focus();
      });
      this.saveSet();
    },
    // 删除套件：先删本地，保存失败由 saveSet 用快照回滚
    removeSet(item) {
      const index = this.sets.findIndex((x) => x.id === item.id);
      if (index < 0) return;
      this.sets.splice(index, 1);
      this.saveSet();
    },
    // 标题 blur / Enter、正文 blur 都走这里：先写本地 model 再落盘，失败回滚
    async saveSet() {
      if (!this.model) return;
      const snapshot = JSON.parse(JSON.stringify(this.sets));
      const payload = JSON.parse(JSON.stringify(this.sets));
      this.$set(this.model, "prompts", payload);
      const ok = await this.postSave({ prompts: payload });
      if (!ok) {
        this.sets = snapshot;
        this.$set(this.model, "prompts", snapshot);
      }
    },
    async postSave(extra) {
      const mtype =
        (this.model && this.model.mtype) ||
        (this.node && this.node.CSgetModelWidgetType && this.node.CSgetModelWidgetType());
      const body = Object.assign({ mtype, mname: this.model && this.model.name }, extra);
      try {
        const resp = await getApi().fetchApi("/cs/save_prompt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!resp || resp.status !== 200) {
          this.$message({ type: "error", message: this.$t("home.modelDetail.prompt.saveFailed") });
          return false;
        }
        const json = await resp.json();
        if (!json || !json.status) {
          this.$message({ type: "error", message: this.$t("home.modelDetail.prompt.saveFailed") });
          return false;
        }
        return true;
      } catch (error) {
        this.$message({ type: "error", message: this.$t("home.modelDetail.prompt.saveFailed") });
        return false;
      }
    },
  },
  template: `
    <div class="prompt-studio-wrapper">
      <div class="capsule-nav-container">
        <div class="capsule-group">
          <div class="capsule-pill" :class="{ active: tab === 'author' }" @click="switchTab('author')">
            <svg class="s2-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.7 5.7 1.9-5.7 1.9L12 18.2l-1.9-5.7L4.4 10.6l5.7-1.9z"/></svg>
            <span>{{ authorTabLabel }}</span>
          </div>
          <div class="capsule-pill" :class="{ active: tab === 'custom' }" @click="switchTab('custom')">
            <svg class="s2-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
            <span>{{ customTabLabel }}</span>
          </div>
        </div>
        <button v-if="tab === 'custom'" type="button" class="btn-create-custom" @click="addSet">
          <svg class="s2-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
          <span>{{ $t('home.modelDetail.prompt.createSet') }}</span>
        </button>
      </div>

      <div v-if="tab === 'author'" class="cards-vertical-scroll">
        <div v-if="authors.length === 0" class="prompt-empty">{{ $t('home.modelDetail.prompt.noAuthor') }}</div>
        <div v-for="(item, index) in authors" :key="'author-' + index" class="outfit-vcard">
          <div class="outfit-vcard-header">
            <div class="outfit-vcard-title">
              <span class="outfit-title-text" :title="item.name">{{ item.name }}</span>
              <span v-if="item.note" class="outfit-weight-chip">{{ item.note }}</span>
            </div>
            <button type="button" class="btn-copy-action" @click="copyText(item.prompt)">
              <svg class="s2-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
              <span>{{ $t('home.modelDetail.prompt.copyOne') }}</span>
            </button>
          </div>
          <div class="outfit-vcard-body">
            <div class="tokens-tip">{{ $t('home.modelDetail.prompt.tokensTip') }}</div>
            <div v-if="item.tokens && item.tokens.length" class="tokens-tag-box">
              <span v-for="(token, ti) in item.tokens" :key="'token-' + index + '-' + ti" class="token-chip" :title="token" @click="copyText(token)">{{ token }}</span>
            </div>
          </div>
        </div>
      </div>

      <div v-else class="cards-vertical-scroll">
        <div v-if="sets.length === 0" class="prompt-empty">{{ $t('home.modelDetail.prompt.noCustom') }}</div>
        <div v-for="item in sets" :key="item.id" class="outfit-vcard">
          <div class="outfit-vcard-header">
            <div class="outfit-vcard-title">
              <svg class="s2-icon set-tag-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/></svg>
              <input ref="titleInputs" class="title-input-edit" type="text" v-model="item.title" :placeholder="$t('home.modelDetail.prompt.setTitle')" @blur="saveSet" @keydown.enter.prevent="saveSet" />
            </div>
            <div class="outfit-header-actions">
              <button type="button" class="btn-copy-action" @click="copyText(item.content)">
                <svg class="s2-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                <span>{{ $t('home.modelDetail.prompt.copyOne') }}</span>
              </button>
              <button type="button" class="btn-icon-danger" :title="$t('home.modelDetail.prompt.deleteSet')" @click="removeSet(item)">
                <svg class="s2-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><path d="M10 11v6M14 11v6"/></svg>
              </button>
            </div>
          </div>
          <div class="outfit-vcard-body">
            <div class="foldable-container" :class="{ collapsed: isFolded(item.id) }">
              <div class="foldable-header" @click="toggleFold(item.id)">
                <div class="triangle-btn">
                  <span class="triangle-icon"><svg class="s2-icon" viewBox="0 0 12 8" fill="currentColor"><path d="M6 8 0 0h12z"/></svg></span>
                  <span>{{ $t('home.modelDetail.prompt.contentLabel') }}</span>
                </div>
                <span class="badge-protected">
                  <svg class="s2-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.5 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z"/></svg>
                  {{ $t('home.modelDetail.prompt.protected') }}
                </span>
              </div>
              <div class="foldable-content">
                <textarea class="prompt-textarea-custom" v-model="item.content" :placeholder="$t('home.modelDetail.prompt.placeholder')" @blur="saveSet"></textarea>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
};
