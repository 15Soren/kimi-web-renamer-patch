// ==============================================================================
// Kimi Code Web 自动重命名补丁注入脚本
// 专为 Kimi Code Web 深度适配的标题栏纯图标组件 (彻底清除所有悬浮/旧版原按钮)
// ==============================================================================

(function () {
  "use strict";

  // 大模型调用配置 (由补丁工具自动填充)
  const AI_CONFIG = __CONFIG_PLACEHOLDER__;

  // 1. 注入标题栏自适应组件样式 (完全剔除所有旧版悬浮大按钮样式)
  function injectStyles() {
    if (document.getElementById("kimi-renamer-style")) return;
    const style = document.createElement("style");
    style.id = "kimi-renamer-style";
    style.textContent = `
      /* 标题栏专属图标按钮样式：与原生按钮自适应贴合 */
      .kimi-renamer-header-btn {
        margin-left: 4px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        user-select: none;
        transition: transform 0.15s ease, opacity 0.15s ease;
        padding: 4px;
        border-radius: 6px;
      }
      .kimi-renamer-header-btn:hover {
        transform: scale(1.08);
      }
      .kimi-renamer-header-btn.loading {
        opacity: 0.5;
        pointer-events: none;
      }
      .kimi-renamer-header-btn.loading .kimi-renamer-icon {
        animation: kimi-renamer-spin 0.8s linear infinite;
      }
      .kimi-renamer-icon {
        width: 16px;
        height: 16px;
        display: block;
        object-fit: contain;
        border-radius: 2px;
        pointer-events: none;
      }
      @keyframes kimi-renamer-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      .kimi-renamer-toast {
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%) translateY(-20px);
        z-index: 10000;
        padding: 7px 15px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 500;
        background: #1f2937;
        color: #f9fafb;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
        opacity: 0;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        pointer-events: none;
      }
      .kimi-renamer-toast.show {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
      .kimi-renamer-toast.success { background: #059669; }
      .kimi-renamer-toast.error { background: #dc2626; }
      .kimi-renamer-toast.info { background: #2563eb; }
    `;
    document.head.appendChild(style);
  }

  // 2. 彻底物理清理旧版残留按钮 (清除旧版悬浮按钮、带“重命名”文字的元素或外部扩展残留)
  function cleanupLegacyButtons() {
    const legacyIds = ["kimi-renamer-btn", "kimi-renamer-fallback-btn"];
    legacyIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.remove();
    });

    // 强力清除任何非标题栏的带“重命名”文本的独立按钮
    document.querySelectorAll("button").forEach((btn) => {
      if (btn.id === "kimi-renamer-header-btn") return;

      if (
        btn.className &&
        (btn.className.includes("kimi-renamer-fallback") ||
         (btn.className.includes("kimi-renamer-btn") && !btn.className.includes("kimi-renamer-header-btn")))
      ) {
        btn.remove();
      }
    });
  }

  // 3. 轻量 Toast 提示
  function showToast(message, type = "info") {
    let toast = document.querySelector(".kimi-renamer-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "kimi-renamer-toast";
      document.body.appendChild(toast);
    }
    toast.className = `kimi-renamer-toast ${type} show`;
    toast.innerText = message;

    if (window._kimiToastTimer) clearTimeout(window._kimiToastTimer);
    window._kimiToastTimer = setTimeout(() => {
      toast.classList.remove("show");
    }, 2200);
  }

  // 4. 获取当前 Session ID
  function getCurrentSessionId() {
    const match = window.location.pathname.match(
      /sessions\/(session_[a-zA-Z0-9_-]+)/
    );
    return match ? match[1] : null;
  }

  // 5. 读取首条消息
  async function getFirstMessage(sessionId, token, clientId) {
    const userRow = document.querySelector(
      '.history-row[data-history-key*="input"], .history-row[data-history-key*="t0:input"], .u-turn'
    );
    if (userRow) {
      let rawText = userRow.innerText.trim();
      rawText = rawText
        .replace(
          /\n(?:\d{2}:\d{2}|昨天 \d{2}:\d{2}|\d{2}-\d{2} \d{2}:\d{2})$/,
          ""
        )
        .trim();
      if (rawText) return rawText;
    }

    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Kimi-Client-Id": clientId,
        },
      });
      const data = await res.json();
      if (data?.data?.last_prompt) {
        return data.data.last_prompt;
      }
    } catch (e) {
      console.warn("[KimiRenamer] 从本地 API 读取首条消息失败:", e);
    }

    return null;
  }

  // 6. 调用大模型生成标题（通过本地服务端同源代理，彻底杜绝 CORS 与 OPTIONS 405）
  async function generateTitleFromAI(firstMessage, token, clientId) {
    const proxyRes = await fetch("/api/v1/custom-renamer/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-Kimi-Client-Id": clientId,
      },
      body: JSON.stringify({ prompt: firstMessage }),
    });

    if (proxyRes.ok) {
      const data = await proxyRes.json();
      if (data && data.title) {
        return data.title;
      }
    } else {
      const errJson = await proxyRes.json().catch(() => null);
      if (errJson && errJson.error) {
        throw new Error(errJson.error);
      }
    }
    throw new Error(`重命名代理响应异常 (${proxyRes.status})，请确认补丁已应用并重启 Kimi Web`);
  }

  // 7. 写回会话新标题
  async function writeBackTitle(sessionId, newTitle, token, clientId) {
    const res = await fetch(`/api/v1/sessions/${sessionId}/profile`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${token}`,
        "X-Kimi-Client-Id": clientId,
      },
      body: JSON.stringify({ title: newTitle }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`写回标题失败 (${res.status}): ${err}`);
    }

    const data = await res.json();
    if (data.code !== 0) {
      throw new Error(data.msg || "本地服务返回错误");
    }

    return true;
  }

  // 8. 更新页面标题显示
  function updateDOMTitle(sessionId, newTitle) {
    const sideItem =
      document.querySelector(`.se[data-session-id="${sessionId}"] .t`) ||
      document.querySelector(".se.on .t");
    if (sideItem) {
      sideItem.innerText = newTitle;
    }

    // 宽屏标题元素
    const headerTitle = document.querySelector(".ch-ses") || document.querySelector(".ch-title");
    if (headerTitle) {
      headerTitle.innerText = newTitle;
    }

    // 窄屏标题元素
    const mobileTitle = document.querySelector(".topbar .tt");
    if (mobileTitle) {
      mobileTitle.innerText = newTitle;
    }
  }

  // 9. 核心重命名处理流程
  async function handleAutoRename(btn) {
    const sessionId = getCurrentSessionId();
    if (!sessionId) {
      showToast("未检测到有效会话", "error");
      return;
    }

    let cred;
    try {
      cred = JSON.parse(localStorage.getItem("kimi-web.server-credential") || "{}");
    } catch (err) {
      showToast("连接凭证格式无效，请重新连接 Kimi Web", "error");
      return;
    }
    const token = cred && cred.credential;
    const clientId =
      localStorage.getItem("kimi-web.client-id") ||
      "web_kimi_renamer_patch";

    if (!token) {
      showToast("未获取到连接凭证", "error");
      return;
    }

    btn.classList.add("loading");

    try {
      const firstMessage = await getFirstMessage(sessionId, token, clientId);
      if (!firstMessage) {
        throw new Error("未能读取到会话首条消息");
      }

      const newTitle = await generateTitleFromAI(firstMessage, token, clientId);
      await writeBackTitle(sessionId, newTitle, token, clientId);
      updateDOMTitle(sessionId, newTitle);

      showToast(`已重命名: ${newTitle}`, "success");
    } catch (err) {
      console.error("[KimiRenamer] 执行重命名失败:", err);
      showToast(err.message || "重命名执行失败", "error");
    } finally {
      btn.classList.remove("loading");
    }
  }

  // 10. 仅自适应挂载到标题栏设置按钮后面 (宽屏 chat-header + 窄屏 topbar 全适配)
  function mountHeaderButton() {
    injectStyles();
    cleanupLegacyButtons();

    // 检查按钮是否已在正确位置
    const existingBtn = document.getElementById("kimi-renamer-header-btn");
    if (existingBtn && existingBtn.isConnected) {
      return;
    }

    // 1. 尝试宽屏桌面端标题栏
    const chatHeader =
      document.querySelector(".con > header.chat-header") ||
      document.querySelector("header.chat-header:not(.sa-head)");

    if (chatHeader) {
      const moreBtn =
        chatHeader.querySelector(".ch-act-more") ||
        chatHeader.querySelector('button[aria-label="选项"]');
      const titleEl = chatHeader.querySelector(".ch-id");

      const btn = document.createElement("button");
      btn.id = "kimi-renamer-header-btn";
      btn.className = "ui-icon-button ui-icon-button--md kimi-renamer-header-btn";
      btn.type = "button";
      btn.title = "rename";
      btn.setAttribute("aria-label", "rename");
      btn.innerHTML = `<img class="kimi-renamer-icon" src="/kimi-renamer.ico" alt="rename" />`;
      btn.addEventListener("click", () => handleAutoRename(btn));

      if (moreBtn && moreBtn.parentElement === chatHeader) {
        moreBtn.insertAdjacentElement("afterend", btn);
      } else if (titleEl && titleEl.parentElement === chatHeader) {
        titleEl.insertAdjacentElement("afterend", btn);
      } else {
        chatHeader.appendChild(btn);
      }
      return;
    }

    // 2. 尝试窄屏移动端顶部标题栏 (.topbar)
    const topbar = document.querySelector(".topbar");
    if (topbar) {
      const settingBtn = topbar.querySelector('button[aria-label="会话设置"]');
      const titleBtn = topbar.querySelector(".tb-main");

      const btn = document.createElement("button");
      btn.id = "kimi-renamer-header-btn";
      btn.className = "ui-icon-button ui-icon-button--lg kimi-renamer-header-btn";
      btn.type = "button";
      btn.title = "rename";
      btn.setAttribute("aria-label", "rename");
      btn.innerHTML = `<img class="kimi-renamer-icon" src="/kimi-renamer.ico" alt="rename" />`;
      btn.addEventListener("click", () => handleAutoRename(btn));

      if (settingBtn && settingBtn.parentElement === topbar) {
        settingBtn.insertAdjacentElement("afterend", btn);
      } else if (titleBtn && titleBtn.parentElement === topbar) {
        titleBtn.insertAdjacentElement("afterend", btn);
      } else {
        topbar.appendChild(btn);
      }
    }
  }

  // 初始化与监听
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountHeaderButton);
  } else {
    mountHeaderButton();
  }

  window.addEventListener("popstate", mountHeaderButton);

  const observer = new MutationObserver(() => {
    mountHeaderButton();
    cleanupLegacyButtons();
  });

  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
  });

  console.log("[KimiRenamer] 标题栏自适应组件已就绪 (旧版原悬浮按钮已彻底清理)");
})();
