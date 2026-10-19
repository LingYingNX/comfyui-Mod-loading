function getLevelInf(level) {
  const levelList = [
    {
      value: "S",
      color: "#FF5733",
    },
    {
      value: "A",
      color: "#7948EA",
    },
    {
      value: "B",
      color: "#2A82E4",
    },
    {
      value: "C",
      color: "#43CF7C",
    },
    {
      value: "D",
      color: "#808080",
    },
  ];
  return levelList.find((x) => x.value === level) || false;
}

// 架构筛选的清单：顶栏架构下拉与模型列表过滤共用这一份，保证两处永远同序。
export const KNOWN_ARCHS = ["Illustrious", "SDXL", "Anima", "Flux", "Pony", "SD1.5"];
// 「其他」用一个哨兵值，方便识别「不属于任何已知架构」
export const ARCH_OTHER = "__other__";
export const DEFAULT_WIDGET_TYPES = Object.freeze({
  ckpt_name: "checkpoints",
  vae_name: "vae",
  clip_name: "clip",
  gligen_name: "gligen",
  control_net_name: "controlnet",
  lora_name: "loras",
  style_model_name: "style_models",
  hypernetwork_name: "hypernetworks",
  unet_name: "unets",
});

export { getLevelInf };
