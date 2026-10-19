export default {
  props: {
    icon: {
      default: "",
      type: String,
    },
    value: {
      default: 0,
      type: Number,
    },
    list: {
      default: () => {
        return [];
      },
      type: Array,
    },
    fontSize: {
      default: "1rem",
      type: String,
    },
  },
  data() {
    return {
      index: 0,
      isExpand: false,
    };
  },
  watch: {
    value(newValue) {
      this.selectItem(newValue);
    },
  },
  mounted() {
    document.addEventListener("click", this.onDocumentClick);
    this.selectItem(this.value);
  },
  beforeDestroy() {
    document.removeEventListener("click", this.onDocumentClick);
  },
  methods: {
    toggleMenu() {
      this.isExpand = !this.isExpand;
    },
    onDocumentClick(event) {
      if (!this.isExpand || !this.$refs.hoverMenu?.contains(event.target)) {
        this.isExpand = false;
      }
    },
    selectItem(index) {
      this.index = index;
      this.isExpand = false;
      this.$emit("changeValue", index);
    },
  },
  template: `<div ref="hoverMenu" class="hover_menu" :class="{ open: isExpand }" :style="{fontSize: fontSize}" :aria-expanded="isExpand" @click.stop="toggleMenu">
                <div class="default_value">
                    <em v-if="icon" class="iconfont" :class="icon"></em> 
                    {{list[index]?.name || ''}}
                </div>
                <ul >
                    <li v-for="(item,index) in list" :key="index" @click.stop="selectItem(index)">
                       {{item.name}}
                    </li>
                </ul>
            </div>`,
};
