import Language from "../../components/settings/language/index.js";
import Civitai from "../../components/settings/civitai/index.js";

export default {
  name: "Settings",
  components: {
    Language,
    Civitai,
  },
  data() {
    return {};
  },
  // 进入设置页时把存在插件配置文件里的 C站 Key 拉进内存
  // （含 localStorage 旧值一次性迁移），面板状态才有数据可回显
  created() {
    this.$store.commit("config/loadCivitai");
  },
  methods: {},
  template: `<div class="settings_page">
              <div class="content_wrapper">
                <div class="content">
                  <Language />
                  <Civitai />
                </div>
              </div>
              <div class="foot"></div>
            </div>`,
};
