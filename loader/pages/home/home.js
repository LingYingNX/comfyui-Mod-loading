import Head from "../../components/home/head/index.js";
import Classification from "../../components/home/classification/index.js";
import Model from "../../components/home/model/index.js";
import Foot from "../../components/home/foot/index.js";

export default {
  name: "Home",
  components: {
    Head,
    Classification,
    Model,
    Foot,
  },
  data() {
    return {
      allList: [],
      searchParameter: {
        key: "",
        sort: "",
        tags: [],
        // 架构筛选（顶栏下拉写入，model 组件按它过滤）
        arch: "",
      },
      isLoading: true,
      column: 0,
      columnIndex: 0,
    };
  },
  computed: {
    selectedWidget() {
      return this.node?.CSgetSelModelWidget();
    },
    rendering() {
      return this.renderer?.rendering;
    },
  },
  watch: {
    nodeId: {
      handler() {
        this.allList = this.node?.CSgetModelLists() || [];
      },
      immediate: true,
    },
  },
  mounted() {
    this.columnIndex = JSON.parse(localStorage.getItem("columnIndex"));
    if (typeof this.columnIndex !== "number") {
      this.columnIndex = 3;
    }
    this.column = this.$t("home.head.sizeList")[this.columnIndex].value;
    this.$i18n.locale = this.$store.state.config.language;
    this.$store.commit("config/updateWindowing", this.$store.state.config.windowing);
    // C站 Key 存在插件配置文件里，进 home 页先拉进内存，
    // 之后 runFetch / downloadModal 提交的 api_key 才有值
    this.$store.commit("config/loadCivitai");
    this.isLoading = false;
  },
  methods: {
    // Change the quantity displayed in a row
    changeColumn(value) {
      this.column = value;
    },
    // Change filtering criteria
    changeSearchParameter(value) {
      // 展开合并：value 里带的键覆盖旧值，其余键保持（tags 由 Classification 整份给出）
      this.searchParameter = {
        ...this.searchParameter,
        ...value,
      };
    },
  },
  template: `<div v-if="!isLoading" class="home_page">
               <div class="content">
                <Head :column-index="columnIndex" @changeSearchParameter="changeSearchParameter" @changeColumn="changeColumn" :all-list="allList" :arch="searchParameter.arch" :tags="searchParameter.tags" />
                <Classification @changeSearchParameter="changeSearchParameter" :all-list="allList" />
                <Model :column="column" :all-list="allList" :selected-widget="selectedWidget" :search-parameter="searchParameter" @changeSearchParameter="changeSearchParameter" />
              </div>
              <Foot :all-list="allList" v-show="rendering"/>
             </div>`,
};
