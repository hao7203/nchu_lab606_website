import { auth, db } from "./firebase-config.js";
import { showToast } from "./editor-utils.js";
import {
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import {
    doc,
    getDoc
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

let initialized = false;
let adminVerified = false;
let authResolved = false;
let adminModeEnabled = sessionStorage.getItem("labAdminMode") === "true";
const listeners = new Set();

function currentFileName() {
    const file = window.location.pathname.split("/").pop();
    return file || "index.html";
}

function safeReturnUrl() {
    return encodeURIComponent(currentFileName());
}

function currentState() {
    return {
        isAdmin: adminVerified,
        adminMode: adminVerified && adminModeEnabled,
        authResolved,
        user: auth.currentUser
    };
}

function applyAdminVisibility(state) {
    document.body.classList.toggle("admin-mode", state.adminMode);

    document.querySelectorAll(".admin-only").forEach((element) => {
        element.hidden = !state.adminMode;
        element.setAttribute("aria-hidden", String(!state.adminMode));
    });
}

function notifyState() {
    const state = currentState();
    applyAdminVisibility(state);

    listeners.forEach((listener) => {
        Promise.resolve()
            .then(() => listener(state))
            .catch((error) => {
                console.error("管理模式監聽器執行失敗：", error);
            });
    });
}

function updateToolbar() {
    const toolbar = document.getElementById("admin-toolbar");
    const indicator = document.getElementById("admin-mode-indicator");
    const toggleButton = document.getElementById("admin-mode-toggle");

    if (!toolbar || !indicator || !toggleButton) {
        return;
    }

    toolbar.classList.toggle("is-visible", adminVerified);

    if (adminVerified) {
        indicator.textContent = adminModeEnabled
            ? "管理模式：開啟"
            : "管理模式：關閉";
        toggleButton.textContent = adminModeEnabled
            ? "關閉管理模式"
            : "開啟管理模式";
    }
}

function setAdminMode(enabled, showMessage = false) {
    adminModeEnabled = Boolean(enabled) && adminVerified;
    sessionStorage.setItem("labAdminMode", String(adminModeEnabled));
    updateToolbar();
    notifyState();

    if (showMessage && adminVerified) {
        showToast(
            adminModeEnabled ? "管理模式已開啟。" : "管理模式已關閉。",
            "info"
        );
    }
}

function installToolbar() {
    if (document.getElementById("admin-toolbar")) {
        return;
    }

    const toolbar = document.createElement("div");
    toolbar.id = "admin-toolbar";
    toolbar.className = "admin-toolbar";
    toolbar.setAttribute("aria-live", "polite");

    const indicator = document.createElement("span");
    indicator.id = "admin-mode-indicator";
    indicator.className = "admin-mode-indicator";

    const toggleButton = document.createElement("button");
    toggleButton.id = "admin-mode-toggle";
    toggleButton.className = "admin-mode-toggle";
    toggleButton.type = "button";
    toggleButton.addEventListener("click", () => {
        setAdminMode(!adminModeEnabled, true);
    });

    const logoutButton = document.createElement("button");
    logoutButton.id = "admin-logout-btn";
    logoutButton.className = "admin-logout-btn";
    logoutButton.type = "button";
    logoutButton.textContent = "登出";
    logoutButton.addEventListener("click", async () => {
        try {
            await signOut(auth);
        } finally {
            sessionStorage.removeItem("labAdminMode");
            window.location.reload();
        }
    });

    toolbar.append(indicator, toggleButton, logoutButton);
    document.body.appendChild(toolbar);
}

function configureAdminShortcut() {
    document.querySelectorAll(".admin-shortcut").forEach((shortcut) => {
        shortcut.href = `admin.html?return=${safeReturnUrl()}`;

        shortcut.addEventListener("click", (event) => {
            if (!adminVerified) {
                return;
            }

            event.preventDefault();
            setAdminMode(!adminModeEnabled, true);
        });
    });
}

async function verifyAdmin(user) {
    if (!user) {
        return false;
    }

    try {
        // 文件可不存在；只要 Firestore Rules 允許此 Email 讀取，就代表是管理員。
        await getDoc(doc(db, "system", "adminCheck"));
        return true;
    } catch (error) {
        console.warn("目前帳號不是管理員或權限驗證失敗：", error);
        return false;
    }
}

export function onAdminStateChange(listener) {
    listeners.add(listener);
    Promise.resolve(listener(currentState())).catch((error) => {
        console.error("管理模式監聽器執行失敗：", error);
    });
    return () => listeners.delete(listener);
}

export function getAdminState() {
    return currentState();
}

export function requireAdminMode() {
    if (!authResolved) {
        throw new Error("登入狀態仍在確認中，請稍候再試。");
    }
    if (!adminVerified) {
        throw new Error("請先使用管理員帳號登入。");
    }
    if (!adminModeEnabled) {
        throw new Error("請先開啟管理模式。");
    }
}

export function initializeAdminMode() {
    if (initialized) {
        return;
    }
    initialized = true;

    // HTML 即使暫時沒有載入 CSS，也先用 hidden 屬性封鎖管理按鈕。
    document.querySelectorAll(".admin-only").forEach((element) => {
        element.hidden = true;
    });

    installToolbar();
    configureAdminShortcut();
    updateToolbar();
    notifyState();

    onAuthStateChanged(auth, async (user) => {
        adminVerified = false;
        authResolved = false;
        updateToolbar();
        notifyState();

        adminVerified = await verifyAdmin(user);
        authResolved = true;

        if (!adminVerified) {
            adminModeEnabled = false;
            sessionStorage.removeItem("labAdminMode");
        }

        updateToolbar();
        notifyState();

        if (adminVerified && adminModeEnabled && sessionStorage.getItem("labLoginSuccess") === "true") {
            sessionStorage.removeItem("labLoginSuccess");
            showToast("管理員登入成功，管理模式已開啟。", "success", 3200);
        }
    });
}
