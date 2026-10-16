const CIVITAI_ACCOUNT_URL = "https://civitai.com/user/account";
const CSS_HREF = "/cs/loader/components/settings/civitai/index.css";

// index.html already links this stylesheet, but the loader lives in a long-lived iframe
// that is only hidden and re-shown, never reloaded. A browser holding the previous
// index.html would therefore keep this block unstyled for the rest of the session,
// while the module below is still fetched fresh. Re-link from here so the CSS always
// travels with the code that needs it.
if (!document.querySelector('link[href*="settings/civitai/index.css"]')) {
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = CSS_HREF;
  css.dataset.civitaiCss = "1";
  document.head.appendChild(css);
}

export default {
  data() {
    return {
      draft: "",
      reveal: false,
    };
  },
  computed: {
    token() {
      return this.$store.state.config.civitai;
    },
    statusText() {
      if (!this.token) return this.$t("settings.civitai.emptyStatus");
      return this.$t("settings.civitai.setStatus") + " · " + this.mask(this.token);
    },
  },
  watch: {
    token: {
      handler(value) {
        this.draft = value;
      },
      immediate: true,
    },
  },
  methods: {
    // Keep only head and tail so the saved key is identifiable without being exposed
    mask(value) {
      if (value.length <= 10) return "*".repeat(value.length);
      return value.slice(0, 4) + "****" + value.slice(-4);
    },
    // Save token to the store (persisted into localStorage)
    save() {
      const value = (this.draft || "").trim();
      if (!value) {
        this.$message({
          type: "error",
          message: this.$t("settings.civitai.emptyInputTip"),
        });
        return;
      }
      this.$store.commit("config/updateCivitai", value);
      this.reveal = false;
      this.$message({
        type: "success",
        message: this.$t("settings.civitai.savedTip"),
      });
    },
    // Remove the stored token
    clear() {
      this.draft = "";
      this.$store.commit("config/updateCivitai", "");
      this.$message({ message: this.$t("settings.civitai.clearedTip") });
    },
    // Jump to the Civitai account page where the API key can be created and copied
    openTokenPage() {
      window.open(CIVITAI_ACCOUNT_URL, "_blank", "noopener");
    },
  },
  template: `<div class="setting_items civitai_setting">
                <h1>{{$t("settings.civitai.title")}}</h1>
                <p>{{$t("settings.civitai.describe")}}</p>
                <div class="civitai_shell">
                    <input :type="reveal ? 'text' : 'password'" v-model="draft" maxlength="256" :placeholder="$t('settings.civitai.placeholder')" @keydown.enter="save" />
                    <span class="civitai_eye" @click="reveal = !reveal">{{reveal ? $t('settings.civitai.hideText') : $t('settings.civitai.showText')}}</span>
                </div>
                <div class="civitai_actions">
                    <button class="primary" @click="save">{{$t("settings.civitai.saveText")}}</button>
                    <button v-if="token" @click="clear">{{$t("settings.civitai.clearText")}}</button>
                    <button @click="openTokenPage">{{$t("settings.civitai.openText")}} ↗</button>
                </div>
                <div class="civitai_status" :class="{ is_set: !!token }">{{statusText}}</div>
            </div>`,
};
