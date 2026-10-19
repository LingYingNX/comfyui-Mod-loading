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
    };
  },
  watch: {
    value(newValue) {
      this.selectItem(newValue);
    },
  },
  mounted() {
    this.selectItem(this.value);
  },
  methods: {
    selectItem(index) {
      this.index = index;
      this.$emit("changeValue", index);
    },
  },
  template: `<div ref="hoverMenu" class="hover_menu" :style="{fontSize: fontSize}">
                <div class="default_value">
                    <em v-if="icon" class="iconfont" :class="icon"></em> 
                    {{list[index]?.name || ''}}
                </div>
                <ul >
                    <li v-for="(item,index) in list" :key="index" @click="selectItem(index)">
                       {{item.name}}
                    </li>
                </ul>
            </div>`,
};
