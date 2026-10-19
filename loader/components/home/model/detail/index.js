import { getLevelInf } from "../../../../static/js/public.js";
// import { api } from "/scripts/api.js";
import BasicInf from "./basicInf/index.js";
import Workflow from "./workflow/index.js";
import Prompt from "./prompt/index.js";
import IconRenderer from "../../../public/iconRenderer.js";
import { getApi } from "../../../../static/js/api.js";

const ext = {
  is_rendering: false,
  name: "ComfyUI-Studio.model.detail",
  async register() {
    try {
      const { app } = await import("/scripts/app.js");
      app.registerExtension(ext);
    } catch (error) {
      // console.error(error);
    }
  },
};
ext.register();
export default {
  props: ["model"],
  components: {
    BasicInf,
    Workflow,
    Prompt,
  },
  data() {
    return {
      list: [],
      levelList: [],
      menuIndex: 0,
      isReadonly: true,
      selectedLevel: "D",
      defaultCover: "./static/image/default.jpg",
    };
  },
  created() {
    this.getLevelColor();
  },
  watch: {
    model: {
      handler(newValue) {
        this.selectedLevel = newValue.level;
      },
      deep: true,
    },
  },
  methods: {
    // Click to trigger name modification
    editName() {
      this.isReadonly = false;
      this.$nextTick(() => {
        this.$refs.nameInput.focus();
      });
    },
    nameInputKeyDown(e) {
      if (e.key === "Enter") {
        this.changeName(e);
      } else if (e.key === "Escape") {
        this.isReadonly = true;
        e.preventDefault();
        e.stopPropagation();
      }
    },
    // Submit a new name
    changeName(e) {
      e.preventDefault();
      this.isReadonly = true;
      const value = this.$refs.nameInput.value;
      if (value) {
        this.$emit("modifyName", this.model, value);
      }
    },
    // Trigger when the name input box blur
    blurInput() {
      this.isReadonly = true;
    },
    // Change level
    changeLevel(levelInf) {
      this.selectedLevel = levelInf.value;
      this.$emit("changeLevel", levelInf.value);
    },
    // Obtain the corresponding color based on the current level
    getLevelColor() {
      const list = ["S", "A", "B", "C", "D"];
      list.forEach((item) => {
        this.levelList.push(getLevelInf(item));
      });
      this.selectedLevel = this.model.level;
    },
    // Add a tag
    addTag(tagValue) {
      this.$emit("addTag", tagValue);
    },
    // Delete tag
    deleteTag(index) {
      this.$emit("deleteTag", index);
    },
    // Click to use
    useModel() {
      this.$emit("useModel", this.model);
    },
    // Rendering an image
    renderPic() {
      if (this.model) {
        if (this.renderer?.rendering) {
          // 契约第 1 节禁用 alert：同一提示改用 $message（key 复用 home.head.renderingAlert）
          this.$message({ type: "error", message: this.$t("home.head.renderingAlert") });
          return;
        }
        this.renderer.render(this.node, [this.model]);
      }
    },
    // Click to trigger the image acquisition event
    modifyCover() {
      document.getElementById("file_input").click();
    },
    // Change cover image path
    inputCover(e) {
      const file = e.target.files[0];
      if (!file) return;
      // 只认图片：提示走 $message（契约第 1 节禁用 alert）
      if (!file.type.startsWith("image")) {
        this.$message({
          type: "error",
          message: this.$t("home.modelDetail.basicInf.notImageFile"),
        });
        return;
      }
      try {
        const body = new FormData();
        body.append("image", file);
        body.append("type", this.model.type);
        body.append("mtype", this.model.mtype);
        body.append("name", this.model.name);
        const api = getApi();
        api.fetchApi("/cs/upload_thumbnail", { method: "POST", body });
      } catch (error) {
        // 上传是 fire-and-forget：失败时缩略图保持旧图，用户可重选，不再 alert（契约第 1 节）
      }
      const filepath = URL.createObjectURL(file);
      this.$emit("modifyCover", filepath);
    },
    changeMenu(index) {
      this.menuIndex = index;
    },
  },
  template: `
            <div v-if="model" class="model_detail">
              <div class="img_container">
                <img :src="model.cover || defaultCover" />
                <div class="option_group">
                  <span class="icon_container" @click="renderPic"><em class="iconfont icon-camera"></em></span>
                  <span class="block"></span>
                  <span class="icon_container" @click="modifyCover"><em class="iconfont icon-upload"></em></span>
                  <input type="file" id="file_input" accept="image/*" @change="inputCover($event)" />
                </div>
              </div>
              <div v-if="isReadonly" class="model_name" @click="editName" :title="$t('home.modelDetail.basicInf.editName')"><p>{{model.name}}</p></div>
              <div v-else class="name_input">
                <input ref="nameInput" type="value" :value="model.name" @blur="blurInput"  @keydown="nameInputKeyDown"/>
                <span @mousedown="changeName($event)"><em class="iconfont icon-edit"></em></span> 
              </div>
              <div class="level_group">
                <span v-for="(item, index) in levelList" :key="index" class="level_item" :class="{selected:selectedLevel === item.value}" :style="{'--color':item.color}" @click="changeLevel(item)">{{item.value}}</span>
              </div>
              <div class="menu_tab">
                <div v-for="(item,index) in $t('home.modelDetail.menuTab')" :key="index" class="menu_item" :class="{'active_menu': index === menuIndex }" @click="changeMenu(index)">{{item.name}}</div>
              </div>
              <Workflow v-if="menuIndex === 0" :model="model" />
              <Prompt v-if="menuIndex === 1" :model="model" />
              <BasicInf v-if="menuIndex === 2"  @addTag="addTag" @deleteTag="deleteTag" :model="model" />
              <div class="detail-footer">
                <button class="use_button btn-apply-model" @click="useModel">{{$t("home.modelDetail.useButtonText")}} ({{model.type}})</button>
              </div>
          </div>
  `,
};
