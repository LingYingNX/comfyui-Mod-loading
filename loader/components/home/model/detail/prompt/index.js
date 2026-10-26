import { getApi } from "../../../../../static/js/api.js";

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

// 新套件 id：时间戳 + 随机串，本地唯一即可
function makeSetId() {
  return "set-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function normalizeParams(raw) {
  const params = raw && typeof raw === "object" ? raw : {};
  return {
    steps: params.steps ?? "",
    cfg: params.cfg ?? "",
  };
}

function normalizeAuthor(item) {
  const raw = item && typeof item === "object" ? item : {};
  return {
    id: makeSetId(),
    title: String(raw.name ?? raw.title ?? ""),
    content: String(raw.prompt ?? raw.content ?? ""),
    // 旧配置可能还带 negative；仅续航保存，不再渲染。
    negative: String(raw.negative ?? ""),
    params: normalizeParams(raw.params),
    note: raw.note || "",
    viewMode: "tags",
    collapsed: false,
    raw,
  };
}

function toCustomPayload(sets) {
  return sets.map(({ id, title, content, negative, params }) => ({
    id,
    title,
    content,
    negative: negative || "",
    params: normalizeParams(params),
  }));
}

function toAuthorPayload(authors) {
  return authors.map(({ title, content, negative, params, raw }) => {
    const item = Object.assign({}, raw || {});
    item.name = title || "";
    item.prompt = content || "";
    item.negative = negative || "";
    item.params = normalizeParams(params);
    if (Object.prototype.hasOwnProperty.call(item, "title")) item.title = title || "";
    if (Object.prototype.hasOwnProperty.call(item, "content")) item.content = content || "";
    return item;
  });
}

export default {
  name: "PromptStudio",
  props: ["model", "metadataVersion"],
  data() {
    return {
      tab: "author",
      authors: [],
      sets: [],
    };
  },
  computed: {
    activeCount() {
      return this.tab === "author" ? this.authors.length : this.sets.length;
    },
    modelArch() {
      return String((this.model && this.model.arch) || "");
    },
  },
  watch: {
    // 浅 watch：只有切换模型（对象引用变化）才重建本地副本。
    model: {
      handler() {
        this.loadPrompts();
      },
      immediate: true,
    },
    metadataVersion() {
      this.loadPrompts();
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
        negative: (item && item.negative) || "",
        params: normalizeParams(item && item.params),
        viewMode: "tags",
        collapsed: false,
      }));
      this.tab = "author";
    },
    switchTab(tab) {
      this.tab = tab === "custom" ? "custom" : "author";
    },
    setView(item, mode) {
      this.$set(item, "viewMode", mode === "edit" ? "edit" : "tags");
    },
    promptTags(item) {
      return String((item && item.content) || "")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
    },
    toggleCollapse(item) {
      this.$set(item, "collapsed", !item.collapsed);
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
      this.sets.push({
        id: makeSetId(),
        title: "",
        content: "",
        negative: "",
        params: normalizeParams(),
        viewMode: "tags",
        collapsed: false,
      });
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
      const payload = toCustomPayload(this.sets);
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

      <section class="prompt-frame">
        <div v-if="tab === 'author'" id="prompt-panel-author" role="tabpanel" class="cards-vertical-scroll">
          <div v-if="authors.length === 0" class="prompt-empty">
            <span class="prompt-empty-icon"><svg class="s2-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></span>
            <span>{{ $t('home.modelDetail.prompt.noAuthor') }}</span>
          </div>
          <article v-for="item in authors" :key="item.id" class="outfit-vcard" :class="{ collapsed: item.collapsed }">
            <div class="outfit-vcard-header">
              <button type="button" class="btn-icon-utility collapse-toggle" :aria-expanded="item.collapsed ? 'false' : 'true'" :aria-label="item.collapsed ? $t('home.modelDetail.prompt.expand') : $t('home.modelDetail.prompt.collapse')" :title="item.collapsed ? $t('home.modelDetail.prompt.expand') : $t('home.modelDetail.prompt.collapse')" @click="toggleCollapse(item)">
                <svg class="s2-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
              </button>
              <input class="title-input-edit" type="text" v-model="item.title" :aria-label="$t('home.modelDetail.prompt.setTitle')" :placeholder="$t('home.modelDetail.prompt.setTitle')" @blur="saveAuthors" @keydown.enter.prevent="saveAuthors" />
              <span v-if="modelArch" class="outfit-model-chip">{{ modelArch }}</span>
              <div class="outfit-header-actions">
                <button type="button" class="btn-copy-action" :aria-label="$t('home.modelDetail.prompt.copyOne')" :title="$t('home.modelDetail.prompt.copyOne')" @click="copyText(item.content)">
                  <svg class="s2-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                  <span>{{ $t('home.modelDetail.prompt.copyOne') }}</span>
                </button>
              </div>
            </div>
            <div class="outfit-vcard-collapsible" :class="{ collapsed: item.collapsed }">
              <div class="outfit-vcard-body-clip">
                <div class="outfit-vcard-body">
                  <div class="prompt-section-head">
                    <div class="prompt-section-state">
                      <i class="prompt-status-dot positive" aria-hidden="true"></i>
                      <span v-if="item.note" class="outfit-weight-chip">{{ item.note }}</span>
                    </div>
                    <div class="prompt-view-switch" role="group">
                      <button type="button" :class="{ active: item.viewMode === 'tags' }" @click="setView(item, 'tags')">{{ $t('home.modelDetail.prompt.viewTags') }}</button>
                      <button type="button" :class="{ active: item.viewMode === 'edit' }" @click="setView(item, 'edit')">{{ $t('home.modelDetail.prompt.viewEdit') }}</button>
                    </div>
                  </div>
                  <div v-if="item.viewMode === 'tags'" class="prompt-tag-box">
                    <button v-for="(tag, tagIndex) in promptTags(item)" :key="'author-tag-' + item.id + '-' + tagIndex" type="button" class="prompt-token-chip" :class="{ core: tagIndex < 3 }" @click="copyText(tag)">{{ tag }}</button>
                    <span v-if="promptTags(item).length === 0" class="prompt-tag-empty">{{ $t('home.modelDetail.prompt.emptyTags') }}</span>
                  </div>
                  <textarea v-else class="prompt-textarea-custom" v-model="item.content" :aria-label="item.title || $t('home.modelDetail.prompt.setTitle')" :placeholder="$t('home.modelDetail.prompt.placeholder')" @blur="saveAuthors"></textarea>
                  <div class="prompt-meta-row">
                    <div class="prompt-params">
                      <span class="prompt-meta-label">{{ $t('home.modelDetail.prompt.parameters') }}</span>
                      <label class="prompt-param">Steps <input type="number" min="0" step="1" v-model.number="item.params.steps" @blur="saveAuthors" /></label>
                      <label class="prompt-param">CFG <input type="number" min="0" step="0.1" v-model.number="item.params.cfg" @blur="saveAuthors" /></label>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </article>
        </div>

        <div v-else id="prompt-panel-custom" role="tabpanel" class="cards-vertical-scroll">
          <div v-if="sets.length === 0" class="prompt-empty">
            <span class="prompt-empty-icon"><svg class="s2-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></span>
            <span>{{ $t('home.modelDetail.prompt.noCustom') }}</span>
          </div>
          <article v-for="item in sets" :key="item.id" class="outfit-vcard" :class="{ collapsed: item.collapsed }">
            <div class="outfit-vcard-header">
              <button type="button" class="btn-icon-utility collapse-toggle" :aria-expanded="item.collapsed ? 'false' : 'true'" :aria-label="item.collapsed ? $t('home.modelDetail.prompt.expand') : $t('home.modelDetail.prompt.collapse')" :title="item.collapsed ? $t('home.modelDetail.prompt.expand') : $t('home.modelDetail.prompt.collapse')" @click="toggleCollapse(item)">
                <svg class="s2-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
              </button>
              <input ref="titleInputs" class="title-input-edit" type="text" v-model="item.title" :aria-label="$t('home.modelDetail.prompt.setTitle')" :placeholder="$t('home.modelDetail.prompt.setTitle')" @blur="saveSet" @keydown.enter.prevent="saveSet" />
              <span v-if="modelArch" class="outfit-model-chip">{{ modelArch }}</span>
              <div class="outfit-header-actions">
                <button type="button" class="btn-copy-action" :aria-label="$t('home.modelDetail.prompt.copyOne')" :title="$t('home.modelDetail.prompt.copyOne')" @click="copyText(item.content)">
                  <svg class="s2-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                  <span>{{ $t('home.modelDetail.prompt.copyOne') }}</span>
                </button>
              </div>
            </div>
            <div class="outfit-vcard-collapsible" :class="{ collapsed: item.collapsed }">
              <div class="outfit-vcard-body-clip">
                <div class="outfit-vcard-body">
                  <div class="prompt-section-head">
                    <div class="prompt-section-state">
                      <i class="prompt-status-dot positive" aria-hidden="true"></i>
                    </div>
                    <div class="prompt-view-switch" role="group">
                      <button type="button" :class="{ active: item.viewMode === 'tags' }" @click="setView(item, 'tags')">{{ $t('home.modelDetail.prompt.viewTags') }}</button>
                      <button type="button" :class="{ active: item.viewMode === 'edit' }" @click="setView(item, 'edit')">{{ $t('home.modelDetail.prompt.viewEdit') }}</button>
                    </div>
                  </div>
                  <div v-if="item.viewMode === 'tags'" class="prompt-tag-box">
                    <button v-for="(tag, tagIndex) in promptTags(item)" :key="'custom-tag-' + item.id + '-' + tagIndex" type="button" class="prompt-token-chip" :class="{ core: tagIndex < 3 }" @click="copyText(tag)">{{ tag }}</button>
                    <span v-if="promptTags(item).length === 0" class="prompt-tag-empty">{{ $t('home.modelDetail.prompt.emptyTags') }}</span>
                  </div>
                  <textarea v-else class="prompt-textarea-custom" v-model="item.content" :aria-label="item.title || $t('home.modelDetail.prompt.setTitle')" :placeholder="$t('home.modelDetail.prompt.placeholder')" @blur="saveSet"></textarea>
                  <div class="prompt-meta-row">
                    <div class="prompt-params">
                      <span class="prompt-meta-label">{{ $t('home.modelDetail.prompt.parameters') }}</span>
                      <label class="prompt-param">Steps <input type="number" min="0" step="1" v-model.number="item.params.steps" @blur="saveSet" /></label>
                      <label class="prompt-param">CFG <input type="number" min="0" step="0.1" v-model.number="item.params.cfg" @blur="saveSet" /></label>
                    </div>
                    <button type="button" class="btn-icon-danger" :aria-label="$t('home.modelDetail.prompt.deleteSet')" :title="$t('home.modelDetail.prompt.deleteSet')" @click="removeSet(item)">
                      <svg class="s2-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><path d="M10 11v6M14 11v6"/></svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </article>
          <button type="button" class="add-set-row" @click="addSet">
            <svg class="s2-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
            <span>{{ $t('home.modelDetail.prompt.createSet') }}</span>
          </button>
        </div>
      </section>

      <footer class="prompt-footer">
        <span class="prompt-footer-hint"><svg class="s2-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 10v6M12 7h.01"/></svg>{{ $t('home.modelDetail.prompt.tagCopyHint') }}</span>
        <span class="prompt-footer-count">{{ activeCount }}</span>
      </footer>
    </div>
  `,
};
