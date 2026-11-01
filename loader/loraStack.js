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
        .then((names) => view.setLoraNames(names))
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
                fitNodeToPanel(this, { restore: true });
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
