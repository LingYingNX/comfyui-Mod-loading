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
    center: {
      default: false,
      type: Boolean,
    },
  },
  data() {
    return {
      index: 0,
      isExpand: false,
      closeTimer: null,
      canHover: window.matchMedia?.("(hover: hover) and (pointer: fine)").matches ?? false,
    };
  },
  watch: {
    value(newValue) {
      this.selectItem(newValue);
    },
  },
  mounted() {
    document.addEventListener("click", this.onDocumentClick);
    document.addEventListener("keydown", this.onDocumentKeydown);
    if (!window.CSSStartingStyleRule) this.$el.classList.add("s2-no-starting-style");
    this.selectItem(this.value);
  },
  beforeDestroy() {
    document.removeEventListener("click", this.onDocumentClick);
    document.removeEventListener("keydown", this.onDocumentKeydown);
    if (this.closeTimer) clearTimeout(this.closeTimer);
  },
  computed: {
    alignStyle() {
      return {
        justifyContent: this.center ? "center" : "flex-start",
        textAlign: this.center ? "center" : "left",
      };
    },
  },
  methods: {
    openMenu(event) {
      if (event?.type === "mouseenter" && !this.canHover) return;
      if (this.closeTimer) {
        clearTimeout(this.closeTimer);
        this.closeTimer = null;
      }
      this.isExpand = true;
    },
    scheduleClose() {
      if (this.closeTimer) clearTimeout(this.closeTimer);
      this.closeTimer = setTimeout(() => {
        this.isExpand = false;
        this.closeTimer = null;
      }, 140);
    },
    onMouseLeave() {
      if (this.canHover) this.scheduleClose();
    },
    onDocumentClick(event) {
      if (!this.isExpand || !this.$refs.hoverMenu?.contains(event.target)) {
        this.isExpand = false;
      }
    },
    onDocumentKeydown(event) {
      if (event.key === "Escape") this.isExpand = false;
    },
    selectItem(index) {
      this.index = index;
      this.isExpand = false;
      this.$emit("changeValue", index);
    },
  },
  template: `<div ref="hoverMenu" class="hover_menu" :class="{ open: isExpand }" :style="{fontSize: fontSize}" :aria-expanded="isExpand" @click.stop="openMenu" @mouseenter="openMenu" @mouseleave="onMouseLeave">
                <div class="default_value" :style="alignStyle">
                    <em v-if="icon" class="iconfont" :class="icon"></em> 
                    {{list[index]?.name || ''}}
                </div>
                <ul role="listbox">
                    <li v-for="(item,itemIndex) in list" :key="itemIndex" role="option" :aria-selected="itemIndex === index" :class="{ selected: itemIndex === index }" :style="alignStyle" @click.stop="selectItem(itemIndex)">
                       {{item.name}}
                    </li>
                </ul>
            </div>`,
};
