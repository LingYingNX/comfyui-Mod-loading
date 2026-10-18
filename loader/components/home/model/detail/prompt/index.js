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

function normalizeAuthor(item) {
  const raw = item && typeof item === "object" ? item : {};
  return {
    title: String(raw.name ?? raw.title ?? ""),
    content: String(raw.prompt ?? raw.content ?? ""),
    note: raw.note || "",
    raw,
  };
}

function toAuthorPayload(authors) {
  return authors.map(({ title, content, raw }) => {
    const item = Object.assign({}, raw || {});
    item.name = title || "";
    item.prompt = content || "";
    if (Object.prototype.hasOwnProperty.call(item, "title")) item.title = title || "";
    if (Object.prototype.hasOwnProperty.call(item, "content")) item.content = content || "";
    return item;
  });
}

export default {
  name: "PromptStudio",
  props: ["model"],
  data() {
    return {
      tab: "author",
      authors: [],
      sets: [],
    };
  },
  watch: {
    // 浅 watch：只有切换模型（对象引用变化）才重建本地副本。
    model: {
      handler() {
        this.loadPrompts();
      },
      immediate: true,
    },
  },
  methods: {
    loadPrompts() {
      const authorRaw = this.model && this.model.prompt_authors;
      this.authors = (Array.isArray(authorRaw) ? authorRaw : []).map(normalizeAuthor);

      const customRaw = this.model && this.model.prompts;
      this.sets = (Array.isArray(customRaw) ? customRaw : []).map((item) => ({
        id: (item && item.id) || makeSetId(),
        title: (item && item.title) || "",
        content: (item && item.content) || "",
      }));
      this.tab = "author";
    },
    switchTab(tab) {
      this.tab = tab === "custom" ? "custom" : "author";
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
    async saveAuthors() {
      if (!this.model) return;
      const snapshot = JSON.parse(JSON.stringify(this.authors));
      const payload = toAuthorPayload(this.authors);
      this.$set(this.model, "prompt_authors", payload);
      const ok = await this.postSave({ authors: payload });
      if (!ok) {
        this.authors = snapshot;
        this.$set(this.model, "prompt_authors", snapshot.map((item) => item.raw || item));
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
      <div class="prompt-tabs" role="tablist">
        <button type="button" role="tab" class="prompt-tab" :class="{ active: tab === 'author' }" :aria-selected="tab === 'author'" aria-controls="prompt-panel-author" @click="switchTab('author')">
          <span>{{ $t('home.modelDetail.prompt.authorTabCount') }}</span>
          <span class="prompt-tab-count">{{ authors.length }}</span>
        </button>
        <button type="button" role="tab" class="prompt-tab" :class="{ active: tab === 'custom' }" :aria-selected="tab === 'custom'" aria-controls="prompt-panel-custom" @click="switchTab('custom')">
          <span>{{ $t('home.modelDetail.prompt.customTabCount') }}</span>
          <span class="prompt-tab-count">{{ sets.length }}</span>
        </button>
      </div>

      <div v-if="tab === 'author'" id="prompt-panel-author" role="tabpanel" class="cards-vertical-scroll">
        <div v-if="authors.length === 0" class="prompt-empty">{{ $t('home.modelDetail.prompt.noAuthor') }}</div>
        <div v-for="(item, index) in authors" :key="'author-' + index" class="outfit-vcard">
          <div class="outfit-vcard-header">
            <div class="outfit-vcard-title">
              <input class="title-input-edit" type="text" v-model="item.title" :placeholder="$t('home.modelDetail.prompt.setTitle')" @blur="saveAuthors" @keydown.enter.prevent="saveAuthors" />
              <span v-if="item.note" class="outfit-weight-chip">{{ item.note }}</span>
            </div>
            <div class="outfit-header-actions">
              <button type="button" class="btn-copy-action" @click="copyText(item.content)">
                <svg class="s2-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                <span>{{ $t('home.modelDetail.prompt.copyOne') }}</span>
              </button>
            </div>
          </div>
          <div class="outfit-vcard-body">
            <textarea class="prompt-textarea-custom" v-model="item.content" :placeholder="$t('home.modelDetail.prompt.placeholder')" @blur="saveAuthors"></textarea>
          </div>
        </div>
      </div>

      <div v-else id="prompt-panel-custom" role="tabpanel" class="cards-vertical-scroll">
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
            <textarea class="prompt-textarea-custom" v-model="item.content" :placeholder="$t('home.modelDetail.prompt.placeholder')" @blur="saveSet"></textarea>
          </div>
        </div>
        <button type="button" class="add-set-row" @click="addSet">
          <svg class="s2-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
          <span>{{ $t('home.modelDetail.prompt.createSet') }}</span>
        </button>
      </div>
    </div>
  `,
};
