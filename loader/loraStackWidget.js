const MAX_SLOTS = 50;
const MAX_PANEL_HEIGHT = 560;
const MIN_PANEL_HEIGHT = 64;
const MAX_LIST_HEIGHT = 420;
const UNCATEGORIZED = "未分类";
const EXPANDED_KEY = "ls.expandedCategories.v1";

const ICONS = {
    add: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12"/></svg>',
    close: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8m0-8-8 8"/></svg>',
    drag: '<svg viewBox="0 0 16 20" aria-hidden="true"><circle cx="5" cy="5" r="1.2"/><circle cx="11" cy="5" r="1.2"/><circle cx="5" cy="10" r="1.2"/><circle cx="11" cy="10" r="1.2"/><circle cx="5" cy="15" r="1.2"/><circle cx="11" cy="15" r="1.2"/></svg>',
    chevron: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4 6 6-6 6"/></svg>',
    layers: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/></svg>',
    power: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 3.5v7"/><path d="M7.5 6.4a6.6 6.6 0 1 0 9 0"/></svg>',
    refresh: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16 8a6 6 0 1 0 .2 4"/><path d="M16 4v4h-4"/></svg>',
};

function element(tag, className = "", text = "") {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}

function iconButton(className, icon, label) {
    const node = element("button", className);
    node.type = "button";
    node.innerHTML = icon;
    node.setAttribute("aria-label", label);
    node.title = label;
    return node;
}

function makeId() {
    if (globalThis.crypto?.randomUUID) return `slot-${globalThis.crypto.randomUUID()}`;
    return `slot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function splitLoraName(name) {
    const normalized = String(name || "").replaceAll("\\", "/");
    const separator = normalized.lastIndexOf("/");
    if (separator < 0) return { category: UNCATEGORIZED, filename: normalized };
    return {
        category: normalized.slice(0, separator),
        filename: normalized.slice(separator + 1),
    };
}

function readStoredList(key) {
    try {
        const value = JSON.parse(localStorage.getItem(key));
        return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
    } catch (_) {
        return [];
    }
}

function writeStoredList(key, values) {
    try {
        localStorage.setItem(key, JSON.stringify([...values]));
    } catch (_) {
        // Storage can be unavailable in embedded or private contexts.
    }
}

const categoryCollator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });

function orderCategories(categories) {
    return [...categories].sort((left, right) => {
        if (left === UNCATEGORIZED) return 1;
        if (right === UNCATEGORIZED) return -1;
        return categoryCollator.compare(left, right);
    });
}

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}

export function createSlot() {
    return {
        id: makeId(),
        lora: "",
        strength: 1,
        expanded: true,
        enabled: true,
        set: "",
        disabled: {},
        custom: "",
    };
}

export function normalizeState(raw) {
    let payload = raw;
    if (typeof raw === "string") {
        try {
            payload = JSON.parse(raw || "{}");
        } catch (_) {
            payload = {};
        }
    }

    const rawSlots = Array.isArray(payload?.slots) ? payload.slots : [];
    const seen = new Set();
    const slots = rawSlots.slice(0, MAX_SLOTS).map((item, index) => {
        const source = item && typeof item === "object" ? item : {};
        let id = String(source.id || `slot-${index + 1}`);
        while (seen.has(id)) id = makeId();
        seen.add(id);

        const strength = Number(source.strength);
        const disabled = {};
        if (source.disabled && typeof source.disabled === "object") {
            for (const [key, values] of Object.entries(source.disabled)) {
                if (Array.isArray(values)) {
                    disabled[key] = [...new Set(values.map(String).filter(Boolean))];
                }
            }
        }

        return {
            id,
            lora: String(source.lora || "").trim(),
            strength: Number.isFinite(strength) ? clamp(strength, 0, 100) : 1,
            expanded: source.expanded !== false,
            enabled: source.enabled !== false,
            set: String(source.set || "").trim(),
            disabled,
            custom: String(source.custom || ""),
        };
    });

    if (!slots.length) slots.push(createSlot());
    return { version: 1, slots };
}

export function splitPromptTokens(text) {
    const tokens = [];
    let buffer = "";
    let depth = 0;
    let escaped = false;

    for (const char of String(text || "")) {
        if (escaped) {
            buffer += char;
            escaped = false;
            continue;
        }
        if (char === "\\") {
            buffer += char;
            escaped = true;
            continue;
        }
        if ("([{".includes(char)) depth += 1;
        else if (")]}".includes(char)) depth = Math.max(0, depth - 1);

        if (char === "," && depth === 0) {
            const token = buffer.trim();
            if (token) tokens.push(token);
            buffer = "";
            continue;
        }
        buffer += char;
    }

    const token = buffer.trim();
    if (token) tokens.push(token);
    return tokens;
}

// 自定义追加词与提示词套装同一切法：顶层逗号/换行分隔，括号内的逗号保持完整。
// 返回原始分片（raw 保原样、sep 是分隔符），关掉的词才能按位置在输入框里变灰。
function splitCustomSegments(text) {
    const segments = [];
    let raw = "";
    let depth = 0;
    let escaped = false;
    const flush = (sep) => {
        segments.push({ raw, token: raw.trim(), sep });
        raw = "";
    };
    for (const char of String(text || "")) {
        if (escaped) {
            raw += char;
            escaped = false;
            continue;
        }
        if (char === "\\") {
            raw += char;
            escaped = true;
            continue;
        }
        if (char === "(" || char === "[" || char === "{") depth += 1;
        else if (char === ")" || char === "]" || char === "}") depth = Math.max(0, depth - 1);

        if ((char === "," || char === "\n") && depth === 0) {
            flush(char);
            continue;
        }
        raw += char;
    }
    flush("");
    return segments;
}

export function splitCustomPrompts(text) {
    return splitCustomSegments(text)
        .map((segment) => segment.token)
        .filter(Boolean);
}

export function normalizePromptSets(rawSets) {
    const sets = [];
    const seen = new Set();
    for (const [index, raw] of (Array.isArray(rawSets) ? rawSets : []).entries()) {
        const source = typeof raw === "string" ? { content: raw } : raw || {};
        const content = String(
            source.content || source.prompt || source.text || ""
        ).trim();
        if (!content && !Array.isArray(source.tokens)) continue;

        const id = String(source.id || `set-${index + 1}`);
        if (seen.has(id)) continue;
        seen.add(id);

        const tokens = Array.isArray(source.tokens)
            ? source.tokens.map(String).map((token) => token.trim()).filter(Boolean)
            : splitPromptTokens(content);
        sets.push({
            id,
            title: String(source.title || source.name || `提示词套装 ${index + 1}`),
            source: String(source.source || "custom"),
            content: content || tokens.join(", "),
            tokens,
        });
    }
    return sets;
}

export function composePromptPreview(state, promptSetsByLora = new Map()) {
    const parts = [];
    for (const slot of normalizeState(state).slots) {
        const sets = normalizePromptSets(promptSetsByLora.get(slot.lora) || []);
        const selected = sets.find((item) => item.id === slot.set) || sets[0];
        if (selected) {
            const disabled = new Set(slot.disabled[selected.id] || []);
            parts.push(...selected.tokens.filter((token) => !disabled.has(token)));
        }
        const customDisabled = new Set(slot.disabled.custom || []);
        parts.push(
            ...splitCustomPrompts(slot.custom).filter(
                (token) => !customDisabled.has(token)
            )
        );
    }
    return parts.join(", ");
}

function readDisabled(slot, key) {
    return new Set(Array.isArray(slot.disabled?.[key]) ? slot.disabled[key] : []);
}

function writeDisabled(slot, key, values) {
    const next = [...values];
    if (next.length) slot.disabled[key] = next;
    else delete slot.disabled[key];
}

function markChip(button, enabled) {
    button.classList.toggle("is-enabled", enabled);
    button.classList.toggle("is-disabled", !enabled);
    button.setAttribute("aria-pressed", String(enabled));
    button.title = `${button.dataset.token}\n${enabled ? "点击关闭" : "点击启用"}`;
}

function stopShellEvent(event) {
    event.stopPropagation();
}

let autocompleteModulePromise = null;

// shortcut: 只接 pysssss（ComfyUI-Custom-Scripts）的候选补齐；需要支持其它补齐插件时再加 provider 链。
function loadAutocompleteClass() {
    if (!autocompleteModulePromise) {
        autocompleteModulePromise = import(
            "/extensions/ComfyUI-Custom-Scripts/js/common/autocomplete.js"
        )
            .then((module) => module?.TextAreaAutoComplete ?? null)
            .catch(() => null);
    }
    return autocompleteModulePromise;
}

// 自定义 textarea 不走 ComfyWidgets.STRING，补齐插件扫描不到它，这里补挂同一个实例。
function attachAutoComplete(textarea) {
    if (!textarea || textarea.dataset.lsAutocomplete) return;
    loadAutocompleteClass().then((AutoComplete) => {
        if (!AutoComplete) return;
        const setup = (attempt = 0) => {
            if (!textarea.isConnected) {
                if (attempt < 20) requestAnimationFrame(() => setup(attempt + 1));
                return;
            }
            try {
                const instance = new AutoComplete(textarea, null, null);
                // 给本实例的下拉打类，只让这份下拉吃到下面的 hover 规则。
                instance.dropdown?.classList.add("ls-autocomplete");
                // 只在挂载成功后打标记：失败时下次 render 可以重试。
                textarea.dataset.lsAutocomplete = "1";
            } catch (_) {
                // 补齐插件接口变动时静默降级，不影响自定义输入本身。
            }
        };
        setup();
    });
}

// LoRA 选择弹层：搜索 + 目录分类 + 缩略图预览。单例挂在 body 上，节点重绘不影响它。
let picker = null;
let pickerSession = null;
let previewToken = 0;

function ensurePicker() {
    if (picker?.root.isConnected) return picker;

    const root = element("div", "ls-picker");
    root.dataset.visible = "false";
    const searchWrap = element("div", "ls-picker-search");
    const input = element("input", "ls-picker-input");
    input.type = "text";
    input.placeholder = "搜索 LoRA";
    input.spellcheck = false;
    searchWrap.append(input);
    const tree = element("div", "ls-picker-tree");
    const hint = element("div", "ls-picker-hint", "");
    root.append(searchWrap, tree, hint);

    const preview = element("div", "ls-picker-preview");
    preview.dataset.visible = "false";
    const image = element("img", "ls-picker-image");
    image.alt = "";
    image.decoding = "async";
    image.addEventListener("error", () => {
        if (picker) picker.image.dataset.visible = "false";
    });
    const caption = element("div", "ls-picker-caption");
    preview.append(image, caption);

    document.body.append(root, preview);

    input.addEventListener("input", () => renderPickerTree());
    input.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closePicker({ restoreFocus: true });
    });
    // 弹层浮在节点面板上方，若把滚轮放行会被 _handleWheelCapture 按矩形判定转发给画布缩放，
    // 所以这里自己接管：指针在弹层里一律滚列表（列表内保持原生滚动）。
    const scrollListOnWheel = (event) => {
        if (event.__lsForwarded) return;
        if (event.deltaY === 0 && event.deltaX === 0) return;
        if (tree.contains(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.deltaY) tree.scrollTop += event.deltaY;
    };
    root.addEventListener("wheel", scrollListOnWheel, { passive: false });
    preview.addEventListener("wheel", scrollListOnWheel, { passive: false });
    root.addEventListener("pointerdown", stopShellEvent);
    root.addEventListener("click", stopShellEvent);
    tree.addEventListener("pointerover", (event) => {
        const item = event.target.closest?.(".ls-picker-item");
        if (!item) return;
        showPickerPreview(item.dataset.name, item);
    });
    tree.addEventListener("pointerleave", hidePickerPreview);

    picker = { root, input, tree, hint, preview, image, caption, expanded: new Set() };
    return picker;
}

function hidePickerPreview() {
    if (!picker) return;
    previewToken += 1;
    picker.preview.dataset.visible = "false";
}

function showPickerPreview(name, item) {
    if (!picker || !name) return;
    const view = pickerSession?.view;
    if (!view?.options.previewUrl) return;

    const rect = item.getBoundingClientRect();
    const card = picker.preview;
    card.dataset.visible = "true";
    picker.caption.textContent = splitLoraName(name).filename;
    const width = 220;
    const top = Math.max(8, Math.min(rect.top, window.innerHeight - 260));
    const left = rect.right + 8 + width > window.innerWidth
        ? Math.max(8, rect.left - width - 8)
        : rect.right + 8;
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;

    const token = ++previewToken;
    Promise.resolve(view.options.previewUrl(name)).then((url) => {
        if (!url || token !== previewToken || picker?.preview !== card) return;
        picker.image.dataset.visible = "false";
        picker.image.src = url;
        picker.image.decode?.().then(() => {
            if (token === previewToken && card.dataset.visible === "true") {
                picker.image.dataset.visible = "true";
            }
        }).catch(() => {});
    });
}

// 弹层底部常驻行：说明当前按哪个底模架构收敛了候选，并给一个放开/恢复的出口。
function renderPickerFilterHint(view) {
    const filter = view.loraFilter;
    if (!picker) return;
    picker.hint.replaceChildren();
    if (!filter) return;
    const text = view.loraBypass
        ? `已显示全部 ${view.loraCatalog.length} 个 LoRA`
        : `已按 ${filter.label} 筛选 · ${view.loraNames.length} 个`;
    const toggle = element("button", "ls-hint-toggle", view.loraBypass ? "恢复筛选" : "显示全部");
    toggle.type = "button";
    toggle.addEventListener("click", () => {
        view.loraBypass = !view.loraBypass;
        view._applyLoraFilter();
    });
    picker.hint.append(element("span", "", text), toggle);
}

function renderPickerTree() {
    if (!picker || !pickerSession) return;
    const { view, slot } = pickerSession;
    const query = picker.input.value.trim().toLowerCase();
    const all = slot.lora && !view.loraNames.includes(slot.lora)
        ? [slot.lora, ...view.loraNames]
        : view.loraNames;
    const names = all.filter((name) => !query || name.toLowerCase().includes(query));
    picker.tree.replaceChildren();
    renderPickerFilterHint(view);

    if (!names.length) {
        picker.tree.append(
            element("div", "ls-picker-empty", query ? "没有匹配的 LoRA" : "没有可用 LoRA")
        );
        return;
    }

    const groups = new Map();
    for (const name of names) {
        const { category, filename } = splitLoraName(name);
        const group = groups.get(category) ?? [];
        group.push({ filename, name });
        groups.set(category, group);
    }

    for (const category of orderCategories(groups.keys())) {
        const models = groups.get(category);
        const expanded = Boolean(query) || picker.expanded.has(category);
        const header = element("button", "ls-picker-category");
        header.type = "button";
        header.dataset.category = category;
        header.setAttribute("aria-expanded", String(expanded));
        const arrow = element("span", "ls-picker-arrow");
        header.append(
            arrow,
            element("span", "ls-picker-label", category),
            element("span", "ls-picker-count", String(models.length))
        );
        header.addEventListener("click", () => {
            if (picker.expanded.has(category)) picker.expanded.delete(category);
            else picker.expanded.add(category);
            writeStoredList(EXPANDED_KEY, [...picker.expanded]);
            renderPickerTree();
        });
        picker.tree.append(header);

        if (!expanded) continue;
        const items = element("div", "ls-picker-items");
        for (const model of models) {
            const item = element("button", "ls-picker-item");
            item.type = "button";
            item.dataset.name = model.name;
            item.title = model.name;
            item.append(element("span", "ls-picker-name", model.filename));
            if (model.name === slot.lora) item.classList.add("is-selected");
            item.addEventListener("click", () => {
                applyLoraSelection(view, slot, model.name);
                closePicker({ restoreFocus: true });
            });
            items.append(item);
        }
        picker.tree.append(items);
    }
}

function closePicker({ restoreFocus = false } = {}) {
    if (!picker) return;
    const trigger = pickerSession?.trigger;
    picker.root.dataset.visible = "false";
    hidePickerPreview();
    pickerSession = null;
    document.removeEventListener("pointerdown", onPickerOutside, true);
    if (restoreFocus) {
        requestAnimationFrame(() => trigger?.focus({ preventScroll: true }));
    }
}

function onPickerOutside(event) {
    if (!pickerSession) return;
    if (picker.root.contains(event.target) || pickerSession.trigger.contains(event.target)) return;
    closePicker();
}

function openPicker(view, slot, trigger) {
    const ui = ensurePicker();
    ui.input.value = "";
    const saved = readStoredList(EXPANDED_KEY);
    ui.expanded = new Set(saved);
    // 没记住展开状态时，打开时展开一次当前选中项所在分类；只在打开时做，
    // 否则点箭头折叠最后一个分类会被这里立刻顶回来。
    if (!ui.expanded.size && slot.lora) {
        ui.expanded.add(splitLoraName(slot.lora).category);
    }
    // 每次打开都回到「筛选态」，一键放开只对当次浏览有效。
    view.loraBypass = false;
    view._applyLoraFilter();
    pickerSession = { view, slot, trigger };
    view.options.onPickerOpen?.(view, slot);
    renderPickerTree();
    ui.root.dataset.visible = "true";

    const rect = trigger.getBoundingClientRect();
    const height = Math.min(ui.root.offsetHeight || 320, 340);
    const below = rect.bottom + 4;
    const top = below + height > window.innerHeight - 8
        ? Math.max(8, rect.top - height - 4)
        : below;
    ui.root.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 328))}px`;
    ui.root.style.top = `${top}px`;

    document.addEventListener("pointerdown", onPickerOutside, true);
    ui.input.focus();
}

function applyLoraSelection(view, slot, value) {
    if (slot.lora === value) return;
    const previousCustomDisabled = [...readDisabled(slot, "custom")];
    slot.lora = value;
    slot.set = "";
    slot.disabled = {};
    if (previousCustomDisabled.length) {
        writeDisabled(slot, "custom", previousCustomDisabled);
    }
    view._syncState(true);
    view._refreshSlot(slot);
}

export class LoraStackView {
    constructor(root, options = {}) {
        this.root = root;
        this.options = options;
        this.state = normalizeState(options.initialState);
        this.loraNames = [];
        this.loraCatalog = [];
        this.loraFilter = null;
        this.loraBypass = false;
        this._filterStateKey = "";
        this.promptCache = new Map();
        this._switchLayouts = [];
        this._slotElements = new Map();
        this._customTimers = new Map();
        this._disposed = false;

        this.root.classList.add("ls-panel");
        this.root.dataset.csLoraStack = "1";
        for (const eventName of [
            "pointerdown",
            "mousedown",
            "pointerup",
            "click",
            "dblclick",
        ]) {
            root.addEventListener(eventName, stopShellEvent);
        }
        this._onWheelCapture = (event) => this._handleWheelCapture(event);
        document.addEventListener("wheel", this._onWheelCapture, {
            capture: true,
            passive: false,
        });

        this.render();
    }

    setLoraNames(names) {
        const next = [...new Set((Array.isArray(names) ? names : []).map(String))]
            .filter(Boolean)
            .sort((left, right) => left.localeCompare(right, "zh-CN"));
        if (this._sameNames(next, this.loraCatalog)) return;
        this.loraCatalog = next;
        this._applyLoraFilter();
    }

    // filter: null 或 { family, label, match(name) -> boolean }；只收敛候选列表，不动槽位里已选中的模型。
    setLoraFilter(filter) {
        this.loraFilter = filter || null;
        if (!filter) this.loraBypass = false;
        this._applyLoraFilter();
    }

    _sameNames(left, right) {
        return (
            left.length === right.length &&
            left.every((value, index) => value === right[index])
        );
    }

    _applyLoraFilter() {
        const filter = this.loraBypass ? null : this.loraFilter;
        const previous = this.loraNames;
        this.loraNames = filter?.match
            ? this.loraCatalog.filter((name) => filter.match(name))
            : this.loraCatalog;
        const stateKey = filter?.label || "";
        const changed =
            !this._sameNames(this.loraNames, previous) || stateKey !== this._filterStateKey;
        this._filterStateKey = stateKey;
        if (changed && pickerSession?.view === this) renderPickerTree();
    }

    setState(raw, { render = true, preservePromptCache = true } = {}) {
        this.state = normalizeState(raw);
        if (!preservePromptCache) this.promptCache.clear();
        if (render) this.render({ keepScroll: true });
    }

    getState() {
        return this.state;
    }

    retryPrompts(slot) {
        if (!slot.lora) return;
        this.promptCache.delete(slot.lora);
        this._refreshPromptSection(slot);
    }

    measureHeight() {
        if (!this.root.isConnected) return 360;
        const header = this.root.querySelector(".ls-toolbar")?.offsetHeight || 0;
        const list = this.root.querySelector(".ls-list");
        const contentHeight = [...(list?.children || [])].reduce(
            (total, child) => total + child.offsetHeight,
            0
        );
        const listHeight = Math.min(MAX_LIST_HEIGHT, contentHeight);
        return clamp(header + listHeight + 12, MIN_PANEL_HEIGHT, MAX_PANEL_HEIGHT);
    }

    render({ keepScroll = true } = {}) {
        if (this._disposed) return;
        const previousList = this.root.querySelector(".ls-list");
        const previousScroll = keepScroll ? previousList?.scrollTop || 0 : 0;
        this._switchLayouts = [];
        this._slotElements.clear();
        this.root.replaceChildren();

        const head = element("header", "ls-toolbar");
        const titleWrap = element("div", "ls-toolbar-summary");
        const mark = element("span", "ls-title-mark");
        mark.innerHTML = ICONS.layers;
        const count = element("span", "ls-slot-count", `${this.state.slots.length} 个 LoRA`);
        titleWrap.append(mark, count);

        const add = iconButton("ls-add", ICONS.add, "添加 LoRA 槽");
        add.append(element("span", "", "LoRA"));
        add.addEventListener("click", () => {
            if (this.state.slots.length >= MAX_SLOTS) return;
            this.state.slots.push(createSlot());
            this._syncState(true);
            this.render({ keepScroll: true });
            requestAnimationFrame(() => {
                const currentList = this.root.querySelector(".ls-list");
                currentList?.scrollTo({
                    top: currentList.scrollHeight,
                    behavior: "smooth",
                });
                this.root.querySelector(".ls-slot:last-child .ls-select")?.focus();
            });
        });
        head.append(titleWrap, add);

        const list = element("div", "ls-list");
        list.setAttribute("role", "list");
        this.state.slots.forEach((slot, index) => {
            list.append(this._renderSlot(slot, index));
        });

        this.root.append(head, list);

        requestAnimationFrame(() => {
            if (this._disposed) return;
            list.scrollTop = previousScroll;
            this._layoutSetSwitches();
            this._notifyLayout();
            // 面板尺寸在 _notifyLayout 里才定下来，等一帧再按最终高度判断是否溢出。
            requestAnimationFrame(() => this._toggleScrollable());
        });
    }

    _renderSlot(slot, index) {
        const card = element("article", "ls-slot");
        card.classList.toggle("is-collapsed", slot.expanded === false);
        card.classList.toggle("is-off", slot.enabled === false);
        card.dataset.slotId = slot.id;
        card.setAttribute("role", "listitem");
        this._slotElements.set(slot.id, card);

        const top = element("div", "ls-slot-top");
        const expand = iconButton(
            "ls-expand",
            ICONS.chevron,
            slot.expanded ? "折叠提示词区" : "展开提示词区"
        );
        expand.classList.toggle("is-expanded", slot.expanded !== false);
        expand.setAttribute("aria-expanded", String(slot.expanded !== false));
        expand.addEventListener("click", () => {
            slot.expanded = slot.expanded === false;
            const nextExpanded = slot.expanded !== false;
            card.classList.toggle("is-collapsed", !nextExpanded);
            expand.classList.toggle("is-expanded", nextExpanded);
            expand.setAttribute("aria-expanded", String(nextExpanded));
            expand.setAttribute("aria-label", nextExpanded ? "折叠提示词区" : "展开提示词区");
            expand.title = nextExpanded ? "折叠提示词区" : "展开提示词区";
            this._syncState(true);
            this._notifyLayout();
            requestAnimationFrame(() => this._toggleScrollable());
        });
        const drag = iconButton("ls-drag", ICONS.drag, "拖动排序；Alt+↑/↓ 可键盘排序");
        this._bindDrag(drag, card, slot);

        const number = element(
            "span",
            "ls-slot-index",
            String(index + 1).padStart(2, "0")
        );

        const selectWrap = element("div", "ls-select-wrap");
        const select = element("button", "ls-select");
        select.type = "button";
        select.setAttribute("aria-label", `LoRA ${index + 1}`);
        select.title = slot.lora || "选择 LoRA";
        select.append(
            element("span", "ls-select-name", slot.lora || "选择 LoRA"),
            element("span", "ls-select-caret")
        );
        if (!slot.lora) select.classList.add("is-empty");
        select.addEventListener("click", () => openPicker(this, slot, select));
        selectWrap.append(select);

        const weightWrap = element("div", "ls-weight-wrap");
        const power = iconButton(
            "ls-power",
            ICONS.power,
            slot.enabled === false ? "开启此 LoRA" : "关闭此 LoRA"
        );
        power.setAttribute("aria-pressed", String(slot.enabled !== false));
        power.addEventListener("click", () => {
            slot.enabled = slot.enabled === false;
            const enabled = slot.enabled !== false;
            power.setAttribute("aria-pressed", String(enabled));
            power.title = enabled ? "关闭此 LoRA" : "开启此 LoRA";
            power.setAttribute("aria-label", power.title);
            card.classList.toggle("is-off", !enabled);
            this._syncState(true);
        });
        weightWrap.tabIndex = 0;
        weightWrap.setAttribute("role", "spinbutton");
        weightWrap.setAttribute("aria-label", `LoRA ${index + 1} 权重`);
        weightWrap.setAttribute("aria-valuemin", "0");
        weightWrap.setAttribute("aria-valuemax", "100");
        weightWrap.setAttribute("aria-valuenow", Number(slot.strength).toFixed(2));
        weightWrap.title = "按住左右拖拽微调，双击直接输入";
        const weightLabel = element("span", "ls-weight-label", "权重");
        const weightValue = element(
            "span",
            "ls-weight-value",
            Number(slot.strength).toFixed(2)
        );
        const weightInput = element("input", "ls-weight-input");
        weightInput.type = "text";
        weightInput.inputMode = "decimal";
        weightInput.autocomplete = "off";
        weightInput.spellcheck = false;
        weightInput.hidden = true;
        weightInput.setAttribute("aria-label", `LoRA ${index + 1} 权重`);
        weightWrap.append(weightLabel, weightValue, weightInput);
        this._bindWeightScrubber(weightWrap, weightValue, weightInput, slot);

        const remove = iconButton("ls-remove", ICONS.close, "移除 LoRA 槽");
        remove.disabled = this.state.slots.length <= 1;
        if (remove.disabled) remove.title = "至少保留一个 LoRA 槽";
        remove.addEventListener("click", () => {
            if (this.state.slots.length <= 1) return;
            const currentIndex = this.state.slots.findIndex((item) => item.id === slot.id);
            if (currentIndex < 0) return;
            this.state.slots.splice(currentIndex, 1);
            this._syncState(true);
            this.render({ keepScroll: true });
        });

        top.append(expand, drag, number, selectWrap, power, weightWrap, remove);
        card.append(top, this._renderPromptSection(slot));
        card.append(this._renderCustomSection(slot));
        return card;
    }

    _bindWeightScrubber(wrap, valueEl, input, slot) {
        const setValue = (value, precision = 2) => {
            const numeric = Number(value);
            if (!Number.isFinite(numeric)) return slot.strength;
            slot.strength = clamp(numeric, 0, 100);
            valueEl.textContent = slot.strength.toFixed(precision);
            wrap.setAttribute("aria-valuenow", String(slot.strength));
            return slot.strength;
        };

        let editing = false;
        let cancelEdit = false;

        const finishEdit = () => {
            if (!editing) return;
            const raw = input.value;
            editing = false;
            input.hidden = true;
            valueEl.hidden = false;
            wrap.classList.remove("is-editing");
            if (!cancelEdit) {
                setValue(raw);
                this._syncState(false);
            } else {
                setValue(slot.strength);
            }
            cancelEdit = false;
            this.options.onEditEnd?.();
        };

        const startEdit = () => {
            if (editing) return;
            editing = true;
            input.value = Number(slot.strength).toFixed(2);
            input.hidden = false;
            valueEl.hidden = true;
            wrap.classList.add("is-editing");
            input.focus();
            input.select();
            this.options.onEditStart?.();
        };

        input.addEventListener("pointerdown", (event) => {
            event.stopPropagation();
        });
        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                // 直接提交，不依赖 blur：无焦点窗口/headless 里 input.blur() 可能不派发 blur。
                finishEdit();
                input.blur();
            } else if (event.key === "Escape") {
                event.preventDefault();
                cancelEdit = true;
                finishEdit();
                input.blur();
            }
        });
        input.addEventListener("blur", finishEdit);

        wrap.addEventListener("pointerdown", (event) => {
            if (event.button !== 0 || editing || event.target === input) return;
            event.preventDefault();
            event.stopPropagation();

            const pointerId = event.pointerId;
            const startX = event.clientX;
            const startValue = Number(slot.strength);
            let moved = false;
            try {
                wrap.setPointerCapture?.(pointerId);
            } catch (_) {
                // Window listeners keep the scrub alive when capture is unavailable.
            }

            const cleanup = () => {
                window.removeEventListener("pointermove", onMove, true);
                window.removeEventListener("pointerup", onEnd, true);
                window.removeEventListener("pointercancel", onEnd, true);
                try {
                    wrap.releasePointerCapture?.(pointerId);
                } catch (_) {
                    // The browser may already have released the pointer.
                }
                wrap.classList.remove("is-scrubbing");
            };

            const onMove = (moveEvent) => {
                if (moveEvent.pointerId !== pointerId) return;
                const deltaX = moveEvent.clientX - startX;
                if (!moved && Math.abs(deltaX) < 1) return;
                if (!moved) {
                    moved = true;
                    wrap.classList.add("is-scrubbing");
                    this.options.onEditStart?.();
                }
                const precision = moveEvent.shiftKey ? 3 : 2;
                const step = moveEvent.shiftKey ? 0.001 : 0.01;
                setValue(startValue + deltaX * step, precision);
                this._syncState(false);
            };

            const onEnd = (endEvent) => {
                if (endEvent.pointerId !== pointerId) return;
                cleanup();
                setValue(slot.strength);
                if (moved) this.options.onEditEnd?.();
            };

            window.addEventListener("pointermove", onMove, true);
            window.addEventListener("pointerup", onEnd, true);
            window.addEventListener("pointercancel", onEnd, true);
        });

        wrap.addEventListener("dblclick", (event) => {
            event.preventDefault();
            event.stopPropagation();
            startEdit();
        });

        wrap.addEventListener("keydown", (event) => {
            if (editing) return;
            const direction =
                event.key === "ArrowLeft" || event.key === "ArrowDown"
                    ? -1
                    : event.key === "ArrowRight" || event.key === "ArrowUp"
                      ? 1
                      : 0;
            if (!direction) return;
            event.preventDefault();
            this.options.onEditStart?.();
            setValue(slot.strength + direction * (event.shiftKey ? 0.1 : 0.01));
            this._syncState(false);
            this.options.onEditEnd?.();
        });
    }

    _renderPromptSection(slot) {
        const section = element("section", "ls-prompts");
        if (!slot.lora) {
            return section;
        }

        const promptState = this.promptCache.get(slot.lora);
        if (!promptState || promptState.status === "loading") {
            section.append(this._statusLine("正在读取提示词套装…", "is-loading"));
            this._ensurePromptSets(slot);
            return section;
        }
        if (promptState.status === "error") {
            const row = element("div", "ls-status is-error");
            row.append(element("span", "", promptState.error || "提示词读取失败"));
            const retry = iconButton("ls-retry", ICONS.refresh, "重新读取提示词");
            retry.addEventListener("click", () => this.retryPrompts(slot));
            row.append(retry);
            section.append(row);
            return section;
        }

        const sets = promptState.sets;
        if (!sets.length) {
            return section;
        }

        if (!sets.some((item) => item.id === slot.set)) {
            slot.set = sets[0].id;
            this._syncState(false);
        }
        const selected = sets.find((item) => item.id === slot.set) || sets[0];
        section.append(this._renderSetSwitch(slot, sets));
        section.append(this._renderPromptChips(slot, selected));
        return section;
    }

    _renderSetSwitch(slot, sets) {
        const wrap = element("div", "ls-set-row");
        const track = element("div", "ls-set-switch");
        track.setAttribute("role", "tablist");
        track.setAttribute("aria-label", "提示词套装切换");

        let activeButton = null;
        sets.forEach((set, index) => {
            const button = element("button", "ls-set-option");
            button.type = "button";
            button.setAttribute("role", "tab");
            button.dataset.setId = set.id;
            button.title = `${set.title}\n${set.source === "author" ? "作者提示词" : "自定义提示词"}`;

            const dot = element("span", `ls-source-dot ${set.source}`);
            const name = element(
                "span",
                "ls-set-name",
                `${index + 1}. ${set.title}`
            );
            button.append(dot, name);
            const active = set.id === slot.set;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-selected", String(active));
            if (active) activeButton = button;

            button.addEventListener("click", () => {
                if (slot.set === set.id) return;
                slot.set = set.id;
                this._syncState(true);
                this._refreshPromptSection(slot);
            });
            track.append(button);
        });

        wrap.append(track);
        this._switchLayouts.push({ slotId: slot.id, track, activeButton });
        return wrap;
    }

    _renderPromptChips(slot, set) {
        const box = element("div", "ls-chip-box");
        const meta = element("div", "ls-chip-meta");
        const disabled = readDisabled(slot, set.id);
        const activeCount = set.tokens.length - set.tokens.filter((token) => disabled.has(token)).length;
        const count = element("span", "ls-chip-count", `${activeCount}/${set.tokens.length} 生效`);
        meta.append(count);
        const chips = element("div", "ls-chips");

        const updateCount = () => {
            const current = readDisabled(slot, set.id);
            const enabled = set.tokens.length - set.tokens.filter((token) => current.has(token)).length;
            count.textContent = `${enabled}/${set.tokens.length} 生效`;
        };

        for (const token of set.tokens) {
            const button = element("button", "ls-chip");
            button.type = "button";
            button.textContent = token;
            button.dataset.token = token;
            markChip(button, !disabled.has(token));
            button.addEventListener("click", () => {
                const current = readDisabled(slot, set.id);
                if (current.has(token)) current.delete(token);
                else current.add(token);
                writeDisabled(slot, set.id, current);
                markChip(button, !current.has(token));
                updateCount();
                this._syncState(true);
            });
            chips.append(button);
        }

        if (!set.tokens.length) {
            chips.append(element("span", "ls-empty-inline", "这套提示词为空"));
        }
        box.append(meta, chips);
        return box;
    }

    _renderCustomSection(slot) {
        const section = element("section", "ls-custom");
        const field = element("div", "ls-custom-field");
        const mirror = element("div", "ls-custom-mirror");
        mirror.setAttribute("aria-hidden", "true");
        const textarea = element("textarea", "ls-custom-input");
        textarea.value = slot.custom;
        textarea.rows = 1;
        textarea.placeholder = "";
        textarea.spellcheck = false;
        textarea.setAttribute("aria-label", "自定义追加提示词");
        attachAutoComplete(textarea);
        textarea.addEventListener("focus", () => this.options.onEditStart?.());
        textarea.addEventListener("scroll", () => {
            mirror.scrollTop = textarea.scrollTop;
        });
        textarea.addEventListener("input", () => {
            slot.custom = textarea.value;
            this._syncState(false);
            clearTimeout(this._customTimers.get(slot.id));
            this._customTimers.set(
                slot.id,
                setTimeout(() => {
                    this._customTimers.delete(slot.id);
                    const card = this._slotElements.get(slot.id);
                    const chips = card?.querySelector(".ls-custom-chips");
                    if (chips) {
                        this._renderCustomChips(
                            chips,
                            slot,
                            card.querySelector(".ls-custom-mirror")
                        );
                    }
                    this._notifyLayout();
                }, 120)
            );
        });
        textarea.addEventListener("blur", () => {
            slot.custom = textarea.value;
            this._syncState(false);
            this.options.onEditEnd?.();
        });

        field.append(mirror, textarea);
        const chips = element("div", "ls-custom-chips");
        this._renderCustomChips(chips, slot, mirror);
        section.append(field, chips);
        return section;
    }

    // 关掉的词要连输入框里的文字一起变灰：textarea 给局部文字上不了色，
    // 所以文字画在背后的镜像层，textarea 自身文字透明、只留光标与选中。
    _renderCustomMirror(mirror, slot) {
        const disabled = readDisabled(slot, "custom");
        const nodes = [];
        for (const segment of splitCustomSegments(slot.custom)) {
            if (!segment.raw && !segment.sep) continue;
            const span = element("span", "", segment.raw);
            if (segment.token && disabled.has(segment.token)) {
                span.classList.add("is-off");
            }
            nodes.push(span);
            if (segment.sep) nodes.push(document.createTextNode(segment.sep));
        }
        mirror.replaceChildren(...nodes);
        const textarea = mirror.parentElement?.querySelector(".ls-custom-input");
        if (textarea) mirror.scrollTop = textarea.scrollTop;
    }

    _renderCustomChips(container, slot, mirror) {
        container.replaceChildren();
        if (mirror) this._renderCustomMirror(mirror, slot);
        const tokens = splitCustomPrompts(slot.custom);
        if (!tokens.length) {
            return;
        }
        const disabled = readDisabled(slot, "custom");
        for (const token of tokens) {
            const button = element("button", "ls-chip");
            button.type = "button";
            button.textContent = token;
            button.dataset.token = token;
            markChip(button, !disabled.has(token));
            button.addEventListener("click", () => {
                const current = readDisabled(slot, "custom");
                if (current.has(token)) current.delete(token);
                else current.add(token);
                writeDisabled(slot, "custom", current);
                markChip(button, !current.has(token));
                if (mirror) this._renderCustomMirror(mirror, slot);
                this._syncState(true);
            });
            container.append(button);
        }
    }

    _statusLine(text, className) {
        return element("div", `ls-status ${className}`, text);
    }

    _ensurePromptSets(slot) {
        const lora = slot.lora;
        if (!lora || this.promptCache.has(lora)) return;
        this.promptCache.set(lora, {
            status: "loading",
            sets: [],
            error: "",
        });

        Promise.resolve(this.options.fetchPromptSets?.(lora))
            .then((sets) => {
                if (this._disposed) return;
                this.promptCache.set(lora, {
                    status: "ready",
                    sets: normalizePromptSets(sets),
                    error: "",
                });
                const current = this.state.slots.find(
                    (item) => item.lora === lora && item.id === slot.id
                );
                if (current) {
                    const valid = this.promptCache
                        .get(lora)
                        .sets.some((item) => item.id === current.set);
                    if (!valid && this.promptCache.get(lora).sets.length) {
                        current.set = this.promptCache.get(lora).sets[0].id;
                        this._syncState(false);
                    }
                }
                this._refreshPromptSectionsForLora(lora);
            })
            .catch((error) => {
                if (this._disposed) return;
                this.promptCache.set(lora, {
                    status: "error",
                    sets: [],
                    error: String(error?.message || error || "提示词读取失败"),
                });
                this._refreshPromptSectionsForLora(lora);
            });
    }

    _refreshSlot(slot) {
        const card = this._slotElements.get(slot.id);
        if (!card?.isConnected) return;
        const select = card.querySelector(".ls-select");
        if (select) {
            select.title = slot.lora || "选择 LoRA";
            select.classList.toggle("is-empty", !slot.lora);
            const name = select.querySelector(".ls-select-name");
            if (name) name.textContent = slot.lora || "选择 LoRA";
        }
        const customChips = card.querySelector(".ls-custom-chips");
        if (customChips) {
            this._renderCustomChips(
                customChips,
                slot,
                card.querySelector(".ls-custom-mirror")
            );
        }
        this._refreshPromptSection(slot);
    }

    _refreshPromptSectionsForLora(lora) {
        for (const slot of this.state.slots) {
            if (slot.lora === lora) {
                this._refreshPromptSection(slot, { deferLayout: true });
            }
        }
        this._finishPartialRender();
    }

    _refreshPromptSection(slot, { deferLayout = false } = {}) {
        const card = this._slotElements.get(slot.id);
        const current = card?.querySelector(".ls-prompts");
        if (!current) return;
        this._switchLayouts = this._switchLayouts.filter(
            (layout) => layout.slotId !== slot.id
        );
        const focused = current.contains(document.activeElement) ? document.activeElement : null;
        const next = this._renderPromptSection(slot);
        current.replaceWith(next);
        if (focused) {
            const selector = focused.dataset.setId
                ? `[data-set-id="${CSS.escape(focused.dataset.setId)}"]`
                : focused.dataset.token
                  ? `[data-token="${CSS.escape(focused.dataset.token)}"]`
                  : `[data-set-id="${CSS.escape(slot.set)}"]`;
            next.querySelector(selector)?.focus({ preventScroll: true });
        }
        if (!deferLayout) this._finishPartialRender();
    }

    _finishPartialRender() {
        if (this._disposed) return;
        this._notifyLayout();
        requestAnimationFrame(() => {
            if (this._disposed) return;
            this._layoutSetSwitches();
            this._toggleScrollable();
        });
    }

    _syncState(history) {
        this.options.onStateChange?.(this.state, { history: Boolean(history) });
    }

    _layoutSetSwitches() {
        for (const layout of this._switchLayouts) {
            if (!layout.track?.isConnected || !layout.activeButton) continue;
            const target =
                layout.activeButton.offsetLeft -
                layout.track.clientWidth / 2 +
                layout.activeButton.offsetWidth / 2;
            layout.track.scrollLeft = Math.max(0, target);
        }
    }

    _notifyLayout() {
        this._toggleScrollable();
        const height = this.measureHeight();
        this.options.onLayout?.(height);
    }

    // 只有真的溢出时才让滚动容器接管鼠标，否则滚轮与拖拽继续透传给画布。
    _toggleScrollable() {
        for (const el of this.root.querySelectorAll(
            ".ls-list, .ls-chip-box, .ls-custom-chips"
        )) {
            el.classList.toggle(
                "is-scrollable",
                el.scrollHeight > el.clientHeight + 1
            );
        }
    }

    // 面板整体不吃鼠标事件（否则会吞掉画布平移/缩放），滚动改由这里按需接管：
    // 只有当指针落在真正可滚动的面板容器内、且该容器还能沿滚轮方向移动时，才消费这次滚轮。
    _handleWheelCapture(event) {
        if (this._disposed || !this.root.isConnected) return;
        if (event.__lsForwarded) return;
        if (event.deltaY === 0 && event.deltaX === 0) return;
        // 弹层浮在面板矩形之上，但不在面板 DOM 内：按矩形判定会误抢，交给弹层自己滚列表。
        if (picker?.root.contains(event.target) || picker?.preview.contains(event.target)) {
            return;
        }
        const x = event.clientX;
        const y = event.clientY;
        // 只在指针位于面板内时接管/转发；面板外一律放行，避免画布缩放被重复触发。
        const panelRect = this.root.getBoundingClientRect();
        if (
            x < panelRect.left ||
            x > panelRect.right ||
            y < panelRect.top ||
            y > panelRect.bottom
        ) {
            return;
        }
        // 文本域自身可滚动时保持原生行为，不要抢走光标下的滚动。
        const editable = event.target;
        if (
            editable instanceof HTMLTextAreaElement &&
            editable.scrollHeight > editable.clientHeight + 1
        ) {
            return;
        }
        let target = null;
        for (const el of this.root.querySelectorAll(
            ".ls-list, .ls-chip-box, .ls-custom-chips"
        )) {
            if (!el.classList.contains("is-scrollable")) continue;
            const rect = el.getBoundingClientRect();
            if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
            // 取最内层的可滚动容器，避免外层列表抢走胶囊区的滚动。
            if (!target || target.contains(el)) target = el;
        }
        if (!target) {
            this._forwardWheelToCanvas(event);
            return;
        }

        const canScrollY = target.scrollHeight > target.clientHeight + 1;
        const atTop = target.scrollTop <= 0;
        const atBottom =
            target.scrollTop + target.clientHeight >= target.scrollHeight - 1;
        if (canScrollY && !(event.deltaY < 0 ? atTop : atBottom)) {
            target.scrollTop += event.deltaY;
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        // 列表已到边界：不消费，交给画布继续缩放/滚动。
        this._forwardWheelToCanvas(event);
    }

    // DOM widget 浮在画布上方，事件不会冒泡到 canvas；面板不消费时必须手动转发，
    // 否则鼠标划到节点上就再也缩放不了画布。
    _forwardWheelToCanvas(event) {
        const canvas = this.options.getCanvasElement?.();
        if (!canvas) return;
        event.preventDefault();
        event.stopPropagation();
        const forwarded = new WheelEvent("wheel", {
            bubbles: true,
            cancelable: true,
            deltaX: event.deltaX,
            deltaY: event.deltaY,
            deltaMode: event.deltaMode,
            clientX: event.clientX,
            clientY: event.clientY,
        });
        forwarded.__lsForwarded = true;
        canvas.dispatchEvent(forwarded);
    }

    _bindDrag(handle, card, slot) {
        handle.addEventListener("keydown", (event) => {
            if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
            event.preventDefault();
            const index = this.state.slots.findIndex((item) => item.id === slot.id);
            const target = index + (event.key === "ArrowUp" ? -1 : 1);
            if (index < 0 || target < 0 || target >= this.state.slots.length) return;
            const [item] = this.state.slots.splice(index, 1);
            this.state.slots.splice(target, 0, item);
            this._syncState(true);
            this.render({ keepScroll: true });
            requestAnimationFrame(() => {
                this.root
                    .querySelector(`.ls-slot[data-slot-id="${CSS.escape(slot.id)}"] .ls-drag`)
                    ?.focus();
            });
        });

        handle.addEventListener("pointerdown", (event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            const drag = {
                pointerId: event.pointerId,
                startY: event.clientY,
                started: false,
                targetId: null,
                slot,
                card,
            };
            try {
                handle.setPointerCapture?.(event.pointerId);
            } catch (_) {
                // Window-level listeners below still keep the drag alive.
            }

            const cleanup = () => {
                window.removeEventListener("pointermove", onMove, true);
                window.removeEventListener("pointerup", onEnd, true);
                window.removeEventListener("pointercancel", onEnd, true);
                try {
                    handle.releasePointerCapture?.(event.pointerId);
                } catch (_) {
                    // The browser may already have released the pointer.
                }
                card.classList.remove("is-dragging");
                for (const item of this.root.querySelectorAll(".ls-drop-before, .ls-drop-after")) {
                    item.classList.remove("ls-drop-before", "ls-drop-after");
                }
            };

            const onMove = (moveEvent) => {
                if (moveEvent.pointerId !== drag.pointerId) return;
                if (!drag.started && Math.abs(moveEvent.clientY - drag.startY) < 4) return;
                drag.started = true;
                card.classList.add("is-dragging");
                const candidates = [...this.root.querySelectorAll(".ls-slot")]
                    .filter((item) => item !== card);
                for (const item of candidates) {
                    item.classList.remove("ls-drop-before", "ls-drop-after");
                }
                drag.targetId = null;
                for (const item of candidates) {
                    const rect = item.getBoundingClientRect();
                    if (moveEvent.clientY < rect.top + rect.height / 2) {
                        item.classList.add("ls-drop-before");
                        drag.targetId = item.dataset.slotId;
                        break;
                    }
                }
                if (!drag.targetId && candidates.length) {
                    candidates[candidates.length - 1].classList.add("ls-drop-after");
                }
            };

            const onEnd = (endEvent) => {
                if (endEvent.pointerId !== drag.pointerId) return;
                cleanup();
                if (!drag.started) return;
                const remaining = this.state.slots.filter((item) => item.id !== slot.id);
                let insertAt = remaining.length;
                if (drag.targetId) {
                    const index = remaining.findIndex((item) => item.id === drag.targetId);
                    if (index >= 0) insertAt = index;
                }
                const currentIndex = this.state.slots.findIndex((item) => item.id === slot.id);
                if (currentIndex < 0) return;
                if (currentIndex === insertAt) return;
                remaining.splice(insertAt, 0, slot);
                this.state.slots = remaining;
                this._syncState(true);
                this.render({ keepScroll: true });
            };

            window.addEventListener("pointermove", onMove, true);
            window.addEventListener("pointerup", onEnd, true);
            window.addEventListener("pointercancel", onEnd, true);
        });
    }

    dispose() {
        this._disposed = true;
        document.removeEventListener("wheel", this._onWheelCapture, {
            capture: true,
        });
        if (pickerSession?.view === this) closePicker();
        for (const timer of this._customTimers.values()) clearTimeout(timer);
        this._customTimers.clear();
        this.root.replaceChildren();
        this.root.classList.remove("ls-panel");
        delete this.root.dataset.csLoraStack;
    }
}
