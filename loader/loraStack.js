import { app } from "../../../../scripts/app.js";
import { api } from "../../../../scripts/api.js";
import { LoraStackView } from "./loraStackWidget.js";

const NODE_CLASS = "AIGODLIKELoraPromptStack";
const STATE_WIDGET = "state_json";
const UI_WIDGET = "lora_stack_ui";

const cssUrl = new URL("./loraStack.css", import.meta.url).href;
if (!document.querySelector('link[data-cs-lora-stack-css="1"]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = cssUrl;
    link.dataset.csLoraStackCss = "1";
    document.head.append(link);
}

let loraNamesPromise = null;
let loraPathsPromise = null;

function normalizeLoraName(name) {
    return String(name || "").replaceAll("\\", "/").replace(/^\/+/, "").toLowerCase();
}

// 缩略图直出路由来自 ComfyUI-Vue-Model-Preview；缺图时后端会 307 到 ComfyUI 自带预览。
function fetchLoraPaths() {
    if (loraPathsPromise) return loraPathsPromise;
    loraPathsPromise = api
        .fetchApi("/experiment/models/loras")
        .then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
        })
        .then((list) => {
            const map = new Map();
            for (const item of Array.isArray(list) ? list : []) {
                map.set(normalizeLoraName(item?.name), Number(item?.pathIndex) || 0);
            }
            return map;
        })
        .catch(() => {
            loraPathsPromise = null;
            return new Map();
        });
    return loraPathsPromise;
}

function loraPreviewUrl(name) {
    return fetchLoraPaths().then((paths) => {
        const index = paths.get(normalizeLoraName(name)) ?? 0;
        const encoded = String(name || "")
            .split(/[\\/]/)
            .filter(Boolean)
            .map(encodeURIComponent)
            .join("/");
        if (!encoded) return "";
        return api.apiURL(`/vue_model_preview/preview/loras/${index}/${encoded}`);
    });
}

function fetchLoraNames() {
    if (loraNamesPromise) return loraNamesPromise;
    loraNamesPromise = (async () => {
        const response = await api.fetchApi("/object_info/LoraLoader");
        if (!response.ok) throw new Error(`LoRA 列表读取失败：HTTP ${response.status}`);
        const payload = await response.json();
        const required = payload?.LoraLoader?.input?.required;
        const optional = payload?.LoraLoader?.input?.optional;
        const spec = required?.lora_name || optional?.lora_name;
        const values = Array.isArray(spec?.[0])
            ? spec[0]
            : Array.isArray(spec?.options)
              ? spec.options
              : Array.isArray(spec?.values)
                ? spec.values
                : [];
        return values.map(String);
    })().catch((error) => {
        loraNamesPromise = null;
        throw error;
    });
    return loraNamesPromise;
}

async function fetchPromptSets(loraName) {
    const response = await api.fetchApi("/cs/lora_stack/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: loraName }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.status === false) {
        throw new Error(payload?.message || `提示词读取失败：HTTP ${response.status}`);
    }
    return Array.isArray(payload?.sets) ? payload.sets : [];
}

// ---------------------------------------------------------------------------
// 自适应底模过滤：按 model 输入口上游那条链里的大模型架构收敛 LoRA 候选。
// 架构来自 Studio 的 model-config.json（/cs/fetch_config，与模型管理器同一份数据），
// 元数据缺失时按「元数据 arch/baseModel -> 完整文件名（含目录）」逐级退回。
// ---------------------------------------------------------------------------
const MODEL_FILE_RE = /\.(safetensors|sft|ckpt|pt|pth|gguf|bin)$/i;
// 只有这两个 widget 代表扩散模型本体，其他模型 widget（vae/clip/controlnet）不参与判定
const MODEL_WIDGET_TYPES = { ckpt_name: "checkpoints", unet_name: "unet" };
const ARCH_RULES = [
    ["anima", /(^|[^a-z])anima([^a-z]|$)/],
    ["krea2", /krea\s*2/],
    ["zimage", /z[-_ ]?image|(^|[^a-z])zit([^a-z]|$)/],
    ["qwen", /qwen/],
    ["flux", /flux/],
    ["sdxl", /illustrious|noobai|pony|sdxl|sd[-_ ]?xl|(^|[^a-z])xl([^a-z]|$)/],
    ["sd15", /sd[-_ ]?(1\.5|15|2(\.\d)?)/],
];
const FAMILY_LABELS = {
    anima: "Anima",
    krea2: "Krea 2",
    zimage: "Z-Image",
    qwen: "Qwen",
    flux: "Flux",
    sdxl: "SDXL",
    sd15: "SD 1.5",
};

function archFamily(text) {
    const value = String(text || "").toLowerCase();
    if (!value) return "";
    for (const [family, rule] of ARCH_RULES) {
        if (rule.test(value)) return family;
    }
    return "";
}

function loraFamily(name, entry) {
    return (
        archFamily(`${entry?.arch || ""} ${entry?.baseModel || ""}`) || archFamily(name)
    );
}

function archLabel(entry, family) {
    return (
        String(entry?.arch || "").trim() ||
        String(entry?.baseModel || "").trim() ||
        FAMILY_LABELS[family] ||
        family
    );
}

function fetchConfigEntries(mtype, models) {
    return api
        .fetchApi("/cs/fetch_config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mtype, models }),
        })
        .then((response) => (response.ok ? response.json() : {}))
        .catch(() => ({}));
}

let loraArchPromise = null;

// LoRA 侧的架构表：拿全部候选名一次换回元数据；失败则下次重试，退回文件名判断
function loraArchEntries() {
    if (!loraArchPromise) {
        loraArchPromise = fetchLoraNames()
            .then((names) => fetchConfigEntries("loras", names))
            .catch(() => {
                loraArchPromise = null;
                return {};
            });
    }
    return loraArchPromise;
}

const modelEntryCache = new Map();

function modelArchEntry(mtype, name) {
    const key = `${mtype}\u0000${name}`;
    if (!modelEntryCache.has(key)) {
        modelEntryCache.set(
            key,
            fetchConfigEntries(mtype, [name]).then((map) => map?.[name] || {})
        );
    }
    return modelEntryCache.get(key);
}

function inputOrigin(node, slotName) {
    const index = (node.inputs || []).findIndex((input) => input?.name === slotName);
    if (index < 0) return null;
    if (typeof node.getInputNode === "function") {
        const origin = node.getInputNode(index);
        if (origin) return origin;
    }
    const link = typeof node.inputs[index].link === "object" && node.inputs[index].link !== null
        ? node.inputs[index].link
        : node.graph?.links?.[node.inputs[index].link];
    const originId = link?.origin_id ?? link?.originId;
    if (originId === undefined || originId === null) return null;
    return node.graph?.getNodeById?.(originId) || app.graph?.getNodeById?.(originId) || null;
}

// 下拉里的值只有在「能确定候选集是纯字符串数组」时才校验，pysssss 之类子菜单结构直接放行
function isListedValue(widget, value) {
    const values = widget?.options?.values;
    if (Array.isArray(values) && values.every((item) => typeof item === "string")) {
        return values.includes(value);
    }
    return true;
}

// 从 model 口向上游走，收集像模型文件名的 widget 值（链上可能夹着采样/补丁类节点）
function upstreamModelWidgets(node) {
    const seen = new Set();
    const queue = [];
    const start = inputOrigin(node, "model");
    if (start) queue.push(start);
    const found = [];
    while (queue.length && seen.size < 40) {
        const current = queue.shift();
        if (!current || seen.has(current.id)) continue;
        seen.add(current.id);
        for (const widget of current.widgets || []) {
            const value = String(widget?.value ?? "");
            if (!MODEL_FILE_RE.test(value) || !isListedValue(widget, value)) continue;
            found.push({ widget: widget.name, value });
        }
        for (const input of current.inputs || []) {
            const parent = inputOrigin(current, input?.name);
            if (parent) queue.push(parent);
        }
    }
    return found;
}

async function resolveArchFilter(node) {
    const widgets = upstreamModelWidgets(node);
    const typed = widgets.filter((item) => MODEL_WIDGET_TYPES[item.widget]);
    const ordered = typed.length
        ? [...typed, ...widgets.filter((item) => !MODEL_WIDGET_TYPES[item.widget])]
        : widgets;
    for (const item of ordered) {
        const mtype = MODEL_WIDGET_TYPES[item.widget];
        if (mtype) {
            const entry = await modelArchEntry(mtype, item.value);
            const family = loraFamily(item.value, entry);
            if (family) {
                return { family, label: archLabel(entry, family), model: item.value };
            }
            continue;
        }
        if (typed.length) continue;
        const family = archFamily(item.value);
        if (family) {
            return { family, label: FAMILY_LABELS[family] || family, model: item.value };
        }
    }
    return null;
}

function buildLoraFilter(family, entries) {
    const cache = new Map();
    return (name) => {
        if (!cache.has(name)) cache.set(name, loraFamily(name, entries?.[name]));
        return cache.get(name) === family;
    };
}

// 打开弹层时重算：上游换了大模型，候选就跟着换；识别不出来就不过滤（全部显示）
async function applyArchFilter(node, view) {
    const resolved = await resolveArchFilter(node);
    if (node._lsView !== view) return;
    if (!resolved) {
        view.setLoraFilter(null);
        return;
    }
    const entries = await loraArchEntries();
    if (node._lsView !== view) return;
    view.setLoraFilter({
        family: resolved.family,
        label: resolved.label,
        model: resolved.model,
        match: buildLoraFilter(resolved.family, entries),
    });
}

function findStateWidget(node) {
    return node.widgets?.find((widget) => widget.name === STATE_WIDGET);
}

function hideStateWidget(widget) {
    if (!widget || widget._lsHidden) return;
    widget._lsHidden = true;
    widget.origType = widget.type;
    widget.origComputeSize = widget.computeSize;
    widget.computeSize = () => [0, -4];
    widget.type = "converted-widget";
    widget.options = { ...(widget.options || {}), hidden: true };
    widget.serializeValue = () => widget.value;
}

function setNodeDirty(node) {
    node.setDirtyCanvas?.(true, true);
    node.graph?.setDirtyCanvas?.(true, true);
    app.graph?.setDirtyCanvas?.(true, true);
}

function fitNodeToPanel(node, { restore = false } = {}) {
    if (node._lsFitFrame) cancelAnimationFrame(node._lsFitFrame);
    node._lsFitFrame = requestAnimationFrame(() => {
        node._lsFitFrame = null;
        if (!node._lsView || !node.size) return;
        const minimum = node.computeSize();
        const targetHeight = Math.max(64, minimum[1]);
        node._lsMinimumHeight = minimum[1];
        const targetWidth = Math.max(400, node.size[0] || 0);
        if (
            Math.abs(targetWidth - node.size[0]) > 0.5 ||
            Math.abs(targetHeight - node.size[1]) > 0.5
        ) {
            node.setSize([targetWidth, targetHeight]);
        }
        setNodeDirty(node);
    });
}

function setupNode(node) {
    if (node._lsView) return;
    const stateWidget = findStateWidget(node);
    if (!stateWidget) {
        console.warn("[ComfyUI-Studio] LoRA 堆栈缺少 state_json widget");
        return;
    }
    hideStateWidget(stateWidget);

    const root = document.createElement("div");
    const domWidget = node.addDOMWidget(UI_WIDGET, "LORA_STACK_UI", root, {
        serialize: false,
        hideInPanel: true,
        hideOnZoom: false,
        margin: 0,
        getMinHeight: () => node._lsView?.measureHeight() || 360,
        getMaxHeight: () => node._lsView?.measureHeight() || 660,
        getValue: () => "",
        setValue: () => {},
    });
    domWidget.serialize = false;
    domWidget.computeSize = (width) => [
        width,
        node._lsView?.measureHeight() || 360,
    ];

    let historyOpen = false;
    const view = new LoraStackView(root, {
        initialState: stateWidget.value,
        fetchPromptSets,
        previewUrl: loraPreviewUrl,
        getCanvasElement: () =>
            app.canvas?.canvas ||
            document.querySelector("canvas.litegraph") ||
            document.querySelector(".graph-canvas-container canvas"),
        onStateChange: (state, { history }) => {
            const serialized = JSON.stringify(state);
            if (history && !historyOpen) node.graph?.beforeChange?.();
            stateWidget.value = serialized;
            if (history && !historyOpen) node.graph?.afterChange?.();
            setNodeDirty(node);
        },
        onEditStart: () => {
            if (historyOpen) return;
            node.graph?.beforeChange?.();
            historyOpen = true;
        },
        onEditEnd: () => {
            if (!historyOpen) return;
            node.graph?.afterChange?.();
            historyOpen = false;
            setNodeDirty(node);
        },
        onLayout: () => fitNodeToPanel(node),
        onPickerOpen: () => applyArchFilter(node, view),
    });

    node._lsView = view;
    node._lsDomWidget = domWidget;
    node._lsStateWidget = stateWidget;
    node._lsEndEdit = () => {
        if (!historyOpen) return;
        node.graph?.afterChange?.();
        historyOpen = false;
    };

    stateWidget.value = JSON.stringify(view.getState());
    const initialMinimum = node.computeSize();
    node._lsMinimumHeight = initialMinimum[1];
    node.setSize([Math.max(400, node.size[0] || 0), initialMinimum[1]]);

    fetchLoraNames()
        .then((names) => {
            view.setLoraNames(names);
            // 已经连着大模型时才预热架构表（一次请求，缓存到页面生命周期）
            if (node.inputs?.some((input) => input?.name === "model" && input.link != null)) {
                loraArchEntries();
            }
            applyArchFilter(node, view);
        })
        .catch((error) => {
            console.warn("[ComfyUI-Studio] LoRA 列表读取失败", error);
        });

    domWidget.onRemove = () => {
        node._lsView?.dispose();
        node._lsView = null;
        node._lsDomWidget = null;
    };
}

app.registerExtension({
    name: "AIGODLIKE.LoraPromptStack",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_CLASS) return;

        const originalCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = originalCreated?.apply(this, arguments);
            setupNode(this);
            return result;
        };

        const originalConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (info) {
            const result = originalConfigure?.apply(this, arguments);
            if (!this._lsView) setupNode(this);
            const stateWidget = findStateWidget(this);
            const namedState = info?.widgets_values_named?.[STATE_WIDGET];
            if (stateWidget && !stateWidget.value && namedState) {
                stateWidget.value = namedState;
            }
            if (this._lsView && stateWidget) {
                this._lsView.setState(stateWidget.value, {
                    render: true,
                    preservePromptCache: true,
                });
                // 归一化后的状态（如权重的负数下限）写回 widget，执行侧拿到的就是修好的值。
                stateWidget.value = JSON.stringify(this._lsView.getState());
                fitNodeToPanel(this, { restore: true });
            }
            return result;
        };

        const originalConnectionsChange = nodeType.prototype.onConnectionsChange;
        nodeType.prototype.onConnectionsChange = function (type, index, connected) {
            const result = originalConnectionsChange?.apply(this, arguments);
            const slot = this.inputs?.[index];
            if (this._lsView && slot?.name === "model") {
                if (connected) loraArchEntries(); // 接上大模型时预热架构表，首次打开弹层不闪
                applyArchFilter(this, this._lsView);
            }
            return result;
        };

        const originalRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            const result = originalRemoved?.apply(this, arguments);
            if (this._lsFitFrame) cancelAnimationFrame(this._lsFitFrame);
            this._lsFitFrame = null;
            this._lsEndEdit?.();
            this._lsView?.dispose();
            this._lsView = null;
            this._lsDomWidget = null;
            this._lsStateWidget = null;
            return result;
        };
    },
});
