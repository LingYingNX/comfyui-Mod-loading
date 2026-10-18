const message = {
  cn: {
    home: {
      head: {
        search: "搜索",
        title: "本地工作流",
        categoryList: [
          {
            name: "最新排序",
            value: 0,
          },
          {
            name: "最旧排序",
            value: 1,
          },
          {
            name: "名称顺序",
            value: 2,
          },
          {
            name: "名称倒序",
            value: 3,
          },
          {
            name: "品质顺序",
            value: 4,
          },
          {
            name: "品质倒序",
            value: 5,
          },
          {
            name: "体积顺序",
            value: 6,
          },
          {
            name: "体积倒序",
            value: 7,
          },
        ],
        rateList: [
          {
            name: "不限",
            value: 0,
          },
          {
            name: "S",
            value: "S",
          },
          {
            name: "A",
            value: "A",
          },
          {
            name: "B",
            value: "B",
          },
          {
            name: "C",
            value: "C",
          },
          {
            name: "D",
            value: "D",
          },
        ],
        sizeList: [
          {
            name: "9列",
            value: 9,
          },
          {
            name: "8列",
            value: 8,
          },
          {
            name: "7列",
            value: 7,
          },
          {
            name: "6列",
            value: 6,
          },
          {
            name: "5列",
            value: 5,
          },
          {
            name: "4列",
            value: 4,
          },
        ],
        renderText: "一键渲染缩略图",
        renderAllThumbnails: "渲染并覆盖所有缩略图？",
        renderingAlert: "正在渲染缩略图，请稍后再试",
        closePageConfirm: "关闭窗口并终止正在执行的任务？",
        archFilter: "架构",
        archAll: "全部架构",
        fetchText: "一键获取元数据",
        fetchStart: "开始批量获取元数据？已上锁的模型与你自己写过的提示词会自动跳过。",
        fetching: "正在获取元数据",
        fetchProgress: ({ named }) => {
          return `正在获取元数据 ${named("done")}/${named("total")}：${named("current")}`;
        },
        fetchDone: ({ named }) => {
          return `获取完成：成功 ${named("ok")}，跳过 ${named("skipped")}，失败 ${named("failed")}`;
        },
      },
      nav: {
        all: "全部",
        other: "其他",
        tip: "按架构分类，点击三角展开文件夹",
      },
      model: {
        useModelConfirm: "设置模型将退出缩略图渲染,是否确定?",
        dirTagCantDelete: "文件夹标签不能删除",
        lockOn: "点击上锁，一键获取时跳过",
        lockOff: "已上锁，点击解锁",
        lockFailed: "上锁状态保存失败",
        newVersion: "新版",
        updateTip: "检测到远端有新版本 {version}，点右键「仅更新当前模型元数据」获取",
        downloadCard: "下载新模型",
        downloadCardTip: "点击打开下载与元数据窗口",
        openFolderFailed: "打开本地目录失败",
        fetchFailed: "获取元数据失败",
      },
      contextMenu: {
        openSite: "跳转到模型原网站",
        openFolder: "打开本地存放目录",
        toggleLock: "锁定 / 解锁元数据",
        updateOne: "仅更新当前模型元数据",
      },
      download: {
        title: "下载模型",
        toCategory: ({ named }) => {
          return `下载到「${named("category")}」分类目录`;
        },
        url: "模型链接 / Model ID / URL",
        urlPlaceholder: "https://civitai.com/models/12345?modelVersionId=67890",
        name: "名称",
        namePlaceholder: "留空则用作者提供的标题",
        autoName: "自动以作者标题命名，并下载所有多服装形态的提示词",
        cancel: "取消",
        confirm: "开始下载并获取元数据",
        needUrl: "请填模型链接",
        needName: "请填模型名称",
        downloading: ({ named }) => {
          return `下载中 ${named("percent")}%（${named("got")} / ${named("total")}）`;
        },
        done: "下载完成，已写入预览图与提示词",
        failed: "下载失败",
      },
      foot: {
        text: ({ named }) => {
          return `共计模型${named("modelCount")}个，其中${named("noThumbnailCount")}个无缩略图，正在生成第${named("taskIndex")}/${named("taskCount")}个缩略图`;
        },
      },
      searchValue: "关键词",
      modelDetail: {
        menuTab: [
          {
            name: "工作流",
          },
          {
            name: "提示词",
          },
          {
            name: "基本信息",
          }
        ],
        basicInf: {
          title: "基本信息",
          size: "文件大小",
          type: "文件类型",
          creationTime: "创建时间",
          modificationTime: "修改时间",
          notImageFile: "请选择图片格式文件",
          editName: "点击修改",
        },
        workflow: {
          importText: "导入",
          copyText: "复制JSON",
          delete: "删除",
          addWorkflowButtonText: "添加工作流",
          noWorkflowTip: "未发现工作流，点击下面添加工作流按钮即可添加",
          form: {
            title: "更改名称",
            confirmText: "确认",
            cancelText: "取消",
            placeholder: "请输入名称(默认随机填充)",
          },
          saveSuccess: "保存成功",
          saveFail: "保存失败",
          saveTimeout: "保存超时",
          copySuccess: "复制成功",
          copyFail: "复制失败",
          copyTimeout: "复制超时",
          deleteSuccess: "删除成功",
          deleteFail: "删除失败",
          deleteTimeout: "删除超时",
          importSuccess: "导入成功",
          importFail: "导入失败",
          importTimeout: "导入超时",
        },
        note: {
          delete: "删除",
          copyNote: "复制笔记",
          addNoteButtonText: "添加笔记",
          noNoteTip: "未发现笔记，点击下面添加笔记按钮即可添加",
          saveNoteSuccess: "保存笔记成功",
          saveNoteFail: "保存笔记失敗",
          saveNoteTimeout: "保存笔记超时",
          copyNoteSuccess: "复制笔记成功",
          copyNoteFail: "复制笔记失敗",
          copyNoteTimeout: "复制笔记超时",
          deleteNoteSuccess: "刪除笔记成功",
          deleteNoteFail: "刪除笔记失敗",
          deleteNoteTimeout: "刪除笔记超时",
          form: {
            title: "更改名称",
            confirmText: "确认",
            cancelText: "取消",
            placeholder: "请输入笔记名称(默认随机填充)",
          },
        },
        prompt: {
          authorTab: "作者提示词",
          customTab: "自定义提示词",
          authorTabCount: "作者提示词",
          customTabCount: "自定义提示词",
          createSet: "追加一套提示词",
          copyOne: "一键复制",
          copyDone: "已复制",
          tokensTip: "作者提供触发词（点击单独复制）",
          setTitle: "提示词标题",
          contentLabel: "自定义提示词内容",
          protected: "防覆盖保护",
          deleteSet: "删除此套件",
          noAuthor: "该作者没有提供提示词，可切到「自定义提示词」自己写",
          noCustom: "还没有自定义提示词，点下方「＋」添加",
          placeholder: "输入提示词，一键获取元数据时会跳过这里的内容",
          saveFailed: "提示词保存失败",
        },
        useButtonText: "使用此模型",
      },
    },
    settings: {
      language: {
        title: "UI语言选项",
        describe: "设置UI语言，让沟通无所不能",
      },
      shortcut: {
        title: "模型菜单快捷键",
        describe: "设置模型菜单快捷键，让操作更加快捷",
      },
      modelShield: {
        title: "模型屏蔽",
        describe: "你可以决定有一些模型不在特定加载器中显示和进行缩略图渲染(这仅对支持的加载器有用)",
        loaderName: "加载器名称",
        shieldingModel: "屏蔽模型",
        blockInputBoxText: "请输入需要屏蔽的模型文件完整名称(如a.ckpt)",
        confirmText: "确认",
        cancelText: "取消",
      },
      window: {
        title: "个性化设置",
        describe: "选择自定义窗口显示方式",
        list: [
          {
            name: "全屏",
            value: "full",
          },
          {
            name: "窗口化",
            value: "noFull",
          },
        ],
      },
      civitai: {
        title: "C站 API",
        describe: "设置 Civitai 的 API Key，用于读取 C站 模型元数据（保存在插件配置文件中）",
        placeholder: "粘贴 C站 API Key",
        saveText: "保存",
        clearText: "清除",
        openText: "获取 API Key",
        showText: "显示",
        hideText: "隐藏",
        emptyStatus: "尚未设置 API Key",
        setStatus: "已设置",
        emptyInputTip: "请先粘贴 API Key",
        savedTip: "已保存到插件配置文件",
        clearedTip: "已清除",
      },
    },
    messages: {
      tagExists: "tag存在",
      fileNameError: "文件名错误",
      fileNameExists: "文件名存在",
    },
    noResult: "未找到结果",
    confirmBox: {
      describe: "你确定要退出当前操作吗",
      refuseText: "取消",
      acceptText: "确定",
    },
    modelManagerBtn: "ComfyUI-Studio 模型管理器",
  },
  en: {
    home: {
      head: {
        search: "Search",
        title: "Local workflow",
        categoryList: [
          {
            name: "latest",
            value: 0,
          },
          {
            name: "oldest",
            value: 1,
          },
          {
            name: "Name order",
            value: 2,
          },
          {
            name: "Name reverse",
            value: 3,
          },
          {
            name: "Level order",
            value: 4,
          },
          {
            name: "Level reverse",
            value: 5,
          },
          {
            name: "Size order",
            value: 6,
          },
          {
            name: "Size reverse",
            value: 7,
          },
        ],
        rateList: [
          {
            name: "All",
            value: 0,
          },
          {
            name: "S",
            value: "S",
          },
          {
            name: "A",
            value: "A",
          },
          {
            name: "B",
            value: "B",
          },
          {
            name: "C",
            value: "B",
          },
          {
            name: "D",
            value: "D",
          },
        ],
        sizeList: [
          {
            name: "9 COLUMN",
            value: 9,
          },
          {
            name: "8 COLUMN",
            value: 8,
          },
          {
            name: "7 COLUMN",
            value: 7,
          },
          {
            name: "6 COLUMN",
            value: 6,
          },
          {
            name: "5 COLUMN",
            value: 5,
          },
          {
            name: "4 COLUMN",
            value: 4,
          },
        ],
        renderText: "render",
        renderAllThumbnails: "Render and overwrite all thumbnails?",
        renderingAlert: "Rendering thumbnails, please try again later",
        closePageConfirm: "Close the window and terminate the task?",
        archFilter: "Architecture",
        archAll: "All architectures",
        fetchText: "Fetch metadata",
        fetchStart: "Fetch metadata for all models? Locked models and your own prompts are skipped.",
        fetching: "Fetching metadata",
        fetchProgress: ({ named }) => {
          return `Fetching metadata ${named("done")}/${named("total")}: ${named("current")}`;
        },
        fetchDone: ({ named }) => {
          return `Done: ${named("ok")} ok, ${named("skipped")} skipped, ${named("failed")} failed`;
        },
      },
      nav: {
        all: "All",
        other: "Other",
        tip: "Grouped by architecture; click the arrow to expand folders",
      },
      model: {
        useModelConfirm: "Using model will exit the thumbnail rendering, are you sure?",
        dirTagCantDelete: "Folder tag cannot be deleted",
        lockOn: "Click to lock, skipped when fetching metadata",
        lockOff: "Locked, click to unlock",
        lockFailed: "Failed to save lock state",
        newVersion: "New",
        updateTip: "A newer version {version} exists upstream. Right-click “Update this model's metadata only” to fetch it.",
        downloadCard: "Download model",
        downloadCardTip: "Open the download and metadata window",
        openFolderFailed: "Failed to open the local folder",
        fetchFailed: "Failed to fetch metadata",
      },
      contextMenu: {
        openSite: "Open the original model page",
        openFolder: "Open the local folder",
        toggleLock: "Lock / unlock metadata",
        updateOne: "Refresh this model's metadata only",
      },
      download: {
        title: "Download model",
        toCategory: ({ named }) => {
          return `Download into the "${named("category")}" category`;
        },
        url: "Model link / Model ID / URL",
        urlPlaceholder: "https://civitai.com/models/12345?modelVersionId=67890",
        name: "Name",
        namePlaceholder: "Leave empty to use the author's title",
        autoName: "Name it after the author's title, and download all outfit prompts",
        cancel: "Cancel",
        confirm: "Download and fetch metadata",
        needUrl: "Please enter a model link",
        needName: "Please enter a model name",
        downloading: ({ named }) => {
          return `Downloading ${named("percent")}% (${named("got")} / ${named("total")})`;
        },
        done: "Download finished, preview and prompts written",
        failed: "Download failed",
      },
      foot: {
        text: ({ named }) => {
          return `Total ${named("modelCount")} models, ${named("noThumbnailCount")} models without thumbnails. Now ${named("taskIndex")}/${named("taskCount")} thumbnail`;
        },
      },
      searchValue: "Keyword",
      modelDetail: {
        menuTab: [
          {
            name: "Workflow",
          },
          {
            name: "Prompts"
          },
          {
            name: "Basic information",
          }
        ],
        basicInf: {
          title: "Basic",
          size: "Size",
          type: "Type",
          creationTime: "Create time",
          modificationTime: "Modify time",
          notImageFile: "Please choose an image file",
          editName: "Click to edit",
        },
        workflow: {
          importText: "import",
          copyText: "Copy JSON",
          delete: "Delete",
          addWorkflowButtonText: "Add workflow",
          noWorkflowTip: "No workflow found, click the add workflow button below to add it",
          form: {
            title: "Change name",
            confirmText: "Confirm",
            cancelText: "Cancel",
            placeholder: "Rand name default",
          },
          saveSuccess: "Save success",
          saveFail: "Save failed",
          saveTimeout: "Save timeout",
          copySuccess: "Copy success",
          copyFail: "Copy failed",
          copyTimeout: "Copy timeout",
          deleteSuccess: "Delete success",
          deleteFail: "Delete failed",
          deleteTimeout: "Delete timeout",
          importSuccess: "Import success",
          importFail: "Import failed",
          importTimeout: "Import timeout",
        },
        note: {
          delete: "Delete",
          copyNote: "Copy note",
          addNoteButtonText: "Add note",
          noNoteTip: "No notes found, click the add note button below to add it",
          saveNoteSuccess: "Save note success",
          saveNoteFail: "Save note failed",
          saveNoteTimeout: "Save note timeout",
          copyNoteSuccess: "Copy note success",
          copyNoteFail: "Copy note failed",
          copyNoteTimeout: "Copy note timeout",
          deleteNoteSuccess: "Delete note success",
          deleteNoteFail: "Delete note failed",
          deleteNoteTimeout: "Delete note timeout",
          form: {
            title: "Change name",
            confirmText: "Confirm",
            cancelText: "Cancel",
            placeholder: "Rand note name default",
          },
        },
        prompt: {
          authorTab: "Author prompts",
          customTab: "Custom prompts",
          authorTabCount: "Author prompts",
          customTabCount: "Custom prompts",
          createSet: "Add prompt set",
          copyOne: "Copy",
          copyDone: "Copied",
          tokensTip: "Trigger words from the author (click one to copy)",
          setTitle: "Prompt title",
          contentLabel: "Custom prompt content",
          protected: "Overwrite protected",
          deleteSet: "Delete this preset",
          noAuthor: "The author provided no prompts. Switch to \"Custom prompts\" to write your own.",
          noCustom: "No custom prompts yet. Click the + button below to add one.",
          placeholder: "Type a prompt here. Fetching metadata skips whatever you write.",
          saveFailed: "Failed to save prompts",
        },
        useButtonText: "Use model",
      },
    },
    settings: {
      language: {
        title: "UI Language Options",
        describe: "Set UI language to make communication omnipotent",
      },
      shortcut: {
        title: "Model Menu Shortcut Key",
        describe: "Set the shortcut key for the model menu",
      },
      modelShield: {
        title: "Model shielding",
        describe: "You can decide that some models are no longer displayed and thumbnail rendered in specific loaders (this is only useful for supported loaders)",
        loaderName: "Loader Name",
        shieldingModel: "Shielding model",
        blockInputBoxText: "The complete name of the blocked model file(such as a.ckpt)",
        confirmText: "Confirm",
        cancelText: "Cancel",
      },
      window: {
        title: "Personalized settings",
        describe: "Choose custom window display method",
        list: [
          {
            name: "Full screen",
            value: "full",
          },
          {
            name: "Windowing",
            value: "noFull",
          },
        ],
      },
      civitai: {
        title: "Civitai API",
        describe: "Set your Civitai API key to read model metadata from Civitai (stored in the plugin config file)",
        placeholder: "Paste your Civitai API key",
        saveText: "Save",
        clearText: "Clear",
        openText: "Get API key",
        showText: "Show",
        hideText: "Hide",
        emptyStatus: "No API key set",
        setStatus: "Saved",
        emptyInputTip: "Paste an API key first",
        savedTip: "Saved to the plugin config file",
        clearedTip: "Cleared",
      },
    },
    messages: {
      tagExists: "Tag exists",
      fileNameError: "File name error",
      fileNameExists: "File name exists",
    },
    noResult: "No results found",
    confirmBox: {
      describe: "Are you sure you want to exit the current operation",
      refuseText: "Cancel",
      acceptText: "Confirm",
    },
    modelManagerBtn: "ComfyUI-Studio Model Manager",
  },
  tc: {
    home: {
      head: {
        search: "搜索",
        title: "本地工作流",
        categoryList: [
          {
            name: "最新排序",
            value: 0,
          },
          {
            name: "最舊排序",
            value: 1,
          },
          {
            name: "名稱順序",
            value: 2,
          },
          {
            name: "名稱倒序",
            value: 3,
          },
          {
            name: "品質順序",
            value: 4,
          },
          {
            name: "品質倒序",
            value: 5,
          },
          {
            name: "體積順序",
            value: 6,
          },
          {
            name: "體積倒序",
            value: 7,
          },
        ],
        rateList: [
          {
            name: "不限",
            value: 0,
          },
          {
            name: "S",
            value: "S",
          },
          {
            name: "A",
            value: "A",
          },
          {
            name: "B",
            value: "B",
          },
          {
            name: "C",
            value: "C",
          },
          {
            name: "D",
            value: "D",
          },
        ],
        sizeList: [
          {
            name: "9列",
            value: 9,
          },
          {
            name: "8列",
            value: 8,
          },
          {
            name: "7列",
            value: 7,
          },
          {
            name: "6列",
            value: 6,
          },
          {
            name: "5列",
            value: 5,
          },
          {
            name: "4列",
            value: 4,
          },
        ],
        renderText: "壹鍵渲染縮略圖",
        renderAllThumbnails: "渲染並覆蓋所有縮略圖？",
        renderingAlert: "正在渲染縮略圖，請稍後再試",
        closePageConfirm: "關閉窗口並終止正在執行的任務？",
        archFilter: "架構",
        archAll: "全部架構",
        fetchText: "一鍵獲取元數據",
        fetchStart: "開始批量獲取元數據？已上鎖的模型與你自己寫過的提示詞會自動跳過。",
        fetching: "正在獲取元數據",
        fetchProgress: ({ named }) => {
          return `正在獲取元數據 ${named("done")}/${named("total")}：${named("current")}`;
        },
        fetchDone: ({ named }) => {
          return `獲取完成：成功 ${named("ok")}，跳過 ${named("skipped")}，失敗 ${named("failed")}`;
        },
      },
      nav: {
        all: "全部",
        other: "其他",
        tip: "按架構分類，點擊三角展開資料夾",
      },
      model: {
        useModelConfirm: "使用模型將退出縮略圖渲染,是否確定?",
        dirTagCantDelete: "文件夾標簽不能刪除",
        lockOn: "點擊上鎖，一鍵獲取時跳過",
        lockOff: "已上鎖，點擊解鎖",
        lockFailed: "上鎖狀態保存失敗",
        newVersion: "新版",
        updateTip: "檢測到遠端有新版本 {version}，點右鍵「僅更新當前模型元數據」獲取",
        downloadCard: "下載新模型",
        downloadCardTip: "點擊打開下載與元數據窗口",
        openFolderFailed: "打開本地目錄失敗",
        fetchFailed: "獲取元數據失敗",
      },
      contextMenu: {
        openSite: "跳轉到模型原網站",
        openFolder: "打開本地存放目錄",
        toggleLock: "鎖定 / 解鎖元數據",
        updateOne: "僅更新當前模型元數據",
      },
      download: {
        title: "下載模型",
        toCategory: ({ named }) => {
          return `下載到「${named("category")}」分類目錄`;
        },
        url: "模型鏈接 / Model ID / URL",
        urlPlaceholder: "https://civitai.com/models/12345?modelVersionId=67890",
        name: "名稱",
        namePlaceholder: "留空則用作者提供的標題",
        autoName: "自動以作者標題命名，並下載所有多服裝形態的提示詞",
        cancel: "取消",
        confirm: "開始下載並獲取元數據",
        needUrl: "請填模型鏈接",
        needName: "請填模型名稱",
        downloading: ({ named }) => {
          return `下載中 ${named("percent")}%（${named("got")} / ${named("total")}）`;
        },
        done: "下載完成，已寫入預覽圖與提示詞",
        failed: "下載失敗",
      },
      foot: {
        text: ({ named }) => {
          return `共計模型${named("modelCount")}個，其中${named("noThumbnailCount")}個無縮略圖，正在生成第${named("taskIndex")}/${named("taskCount")}個縮略圖`;
        },
      },
      searchValue: "關鍵詞",
      modelDetail: {
        menuTab: [
          {
            name: "工作流",
          },
          {
            name: "提示詞",
          },
          {
            name: "基本信息",
          }
        ],
        basicInf: {
          title: "基本信息",
          size: "文件大小",
          type: "文件類型",
          creationTime: "創建時間",
          modificationTime: "修改時間",
          buttonText: "使用此模型",
          notImageFile: "請選擇圖片格式文件",
          editName: "點擊修改",
        },
        workflow: {
          importText: "導入",
          copyText: "復製JSON",
          delete: "刪除",
          addWorkflowButtonText: "添加工作流",
          noWorkflowTip: "未發現工作流，點擊下面添加工作流按鈕即可添加",
          form: {
            title: "更改名稱",
            confirmText: "确認",
            cancelText: "取消",
            placeholder: "請輸入名稱(默认随机填充)",
          },
          saveSuccess: "保存成功",
          saveFail: "保存失敗",
          saveTimeout: "保存超时",
          copySuccess: "复制成功",
          copyFail: "复制失敗",
          copyTimeout: "复制超时",
          deleteSuccess: "刪除成功",
          deleteFail: "刪除失敗",
          deleteTimeout: "刪除超时",
          importSuccess: "導入成功",
          importFail: "導入失敗",
          importTimeout: "導入超時",
        },
        note: {
          delete: "刪除",
          copyNote: "復製備註",
          addNoteButtonText: "添加備註",
          noNoteTip: "未發現備註，點擊下面添加備註按鈕即可添加",
          saveNoteSuccess: "保存備註成功",
          saveNoteFail: "保存備註失敗",
          saveNoteTimeout: "保存備註超時",
          copyNoteSuccess: "复制備註成功",
          copyNoteFail: "复制備註失敗",
          copyNoteTimeout: "复制備註超時",
          deleteNoteSuccess: "刪除備註成功",
          deleteNoteFail: "刪除備註失敗",
          deleteNoteTimeout: "刪除備註超時",
          form: {
            title: "更改名稱",
            confirmText: "确認",
            cancelText: "取消",
            placeholder: "請輸入備註名稱(默认随机填充)",
          },
        },
        prompt: {
          authorTab: "作者提示詞",
          customTab: "自定義提示詞",
          authorTabCount: "作者提示詞",
          customTabCount: "自定義提示詞",
          createSet: "追加一套提示詞",
          copyOne: "一鍵復製",
          copyDone: "已復製",
          tokensTip: "作者提供觸發詞（點擊單獨復製）",
          setTitle: "提示詞標題",
          contentLabel: "自定義提示詞內容",
          protected: "防覆蓋保護",
          deleteSet: "刪除此套件",
          noAuthor: "該作者沒有提供提示詞，可切到「自定義提示詞」自己寫",
          noCustom: "還沒有自定義提示詞，點下方「＋」添加",
          placeholder: "輸入提示詞，一鍵獲取元數據時會跳過這裡的內容",
          saveFailed: "提示詞保存失敗",
        },
        useButtonText: "使用此模型",
      },
    },
    settings: {
      language: {
        title: "UI語言選項",
        describe: "設置UI語言，讓溝通無所不能",
      },
      shortcut: {
        title: "快捷鍵設置",
        describe: "设置模型菜单快捷键，讓操作更加快捷",
      },
      modelShield: {
        title: "模型屏蔽",
        describe: "你可以決定有一些模型不在特定加載器中顯示和進行縮略圖渲染(這僅對支持的加載器有用)",
        loaderName: "加載器名稱",
        shieldingModel: "屏蔽模型",
        blockInputBoxText: "請輸入需要屏蔽的模型文件完整名稱(如a.ckpt)",
        confirmText: "確認",
        cancelText: "取消",
      },
      window: {
        title: "个性化設置",
        describe: "選擇自定義窗口顯示方式",
        list: [
          {
            name: "全屏",
            value: "full",
          },
          {
            name: "窗口化",
            value: "noFull",
          },
        ],
      },
      civitai: {
        title: "C站 API",
        describe: "設置 Civitai 的 API Key，用於讀取 C站 模型元數據（保存在插件配置文件中）",
        placeholder: "貼上 C站 API Key",
        saveText: "保存",
        clearText: "清除",
        openText: "獲取 API Key",
        showText: "顯示",
        hideText: "隱藏",
        emptyStatus: "尚未設置 API Key",
        setStatus: "已設置",
        emptyInputTip: "請先貼上 API Key",
        savedTip: "已保存到插件配置文件",
        clearedTip: "已清除",
      },
    },
    messages: {
      tagExists: "tag存在",
      fileNameError: "文件名錯誤",
      fileNameExists: "文件名存在",
    },
    noResult: "未找到結果",
    confirmBox: {
      describe: "你確定要退出當前操作嗎",
      refuseText: "取消",
      acceptText: "確定",
    },
    modelManagerBtn: "ComfyUI-Studio 模型管理器",
  },
};
export default message;
