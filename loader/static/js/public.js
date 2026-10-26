// 未取得底模元数据的模型统一进入「其他」。
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
