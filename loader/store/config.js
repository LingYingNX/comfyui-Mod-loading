const config = {
  namespaced: true,
  state: () => ({
    language: localStorage.getItem("CS.language") || "cn",
    windowing: localStorage.getItem("CS.windowing") || "full",
    civitai: "",
  }),
  mutations: {
    updateLanguage(state, newLanguage) {
      localStorage.setItem("CS.language", newLanguage);
      state.language = newLanguage;
    },
    updateWindowing(state, value) {
      localStorage.setItem("CS.windowing", value);
      if (value === "full") {
        document.getElementById("loader_page").classList.remove("windowing");
      } else {
        document.getElementById("loader_page").classList.add("windowing");
      }
      state.windowing = value;
    },
    // C站 Key 现存插件配置文件（model-config.json 顶层 settings）。
    // loadCivitai 在进入设置页时触发；fetch_metadata / download_model
    // 的调用点在 home 页，那里也需要 key 已就位 —— 所以 home 页创建时也拉一次。
    async loadCivitai(state) {
      let stored = "";
      try {
        const resp = await fetch("/cs/fetch_setting", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: "civitai_api_key" }),
        });
        const json = await resp.json();
        if (json.status) stored = json.value || "";
      } catch (e) {}
      const legacy = localStorage.getItem("CS.civitai") || "";
      if (!stored && legacy) {
        // 一次性迁移：把浏览器里存的旧 key 搬进插件配置文件
        try {
          await fetch("/cs/save_setting", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: "civitai_api_key", value: legacy.trim() }),
          });
          stored = legacy.trim();
        } catch (e) {}
      }
      if (stored || legacy) {
        localStorage.removeItem("CS.civitai"); // 明文残留清掉
      }
      state.civitai = stored;
    },
    updateCivitai(state, value) {
      const saved = (value || "").trim();
      state.civitai = saved;
      localStorage.removeItem("CS.civitai"); // 存储位置已迁到插件配置文件
      fetch("/cs/save_setting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "civitai_api_key", value: saved }),
      }).catch(() => {});
    },
  },
};
export default config;
