import { db } from "./firebase-config.js";
import {
    initializeAdminMode,
    onAdminStateChange,
    requireAdminMode
} from "./admin-mode.js";
import {
    createEditorDialog,
    fillDialog,
    setDialogBusy,
    setDialogError,
    createItemActionButton,
    createStableId,
    showToast
} from "./editor-utils.js";
import {
    collection,
    doc,
    getDoc,
    getDocs,
    serverTimestamp,
    setDoc
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

initializeAdminMode();

const DEFAULT_MORE_URL = "https://ndltd.ncl.edu.tw/cgi-bin/gs32/gsweb.cgi/login?ssoauth=1&loadingjs=1&o=dwebmge&cache=1770027991344";
const tableBody = document.getElementById("paper-list");
const sectionTitleElement = document.getElementById("publication-section-title");
const periodLabelElement = document.getElementById("publication-period-label");
const moreLinkElement = document.getElementById("publication-more-link");
const migrationNote = document.getElementById("publications-migration-note");

let publicationData = {
    sectionTitle: "近五年碩博士論文 (Recent Theses & Dissertations)",
    periodLabel: "2020-2024 (Year 109-113)",
    moreUrl: DEFAULT_MORE_URL,
    items: []
};
let sourceMode = "loading";
let editingPublicationId = null;
let migrationInProgress = false;

const itemDialog = createEditorDialog({
    id: "publication-item-dialog",
    title: "新增／修改著作",
    fields: [
        { name: "year", label: "年份（民國）", required: true, maxLength: 3, placeholder: "例如：114" },
        {
            name: "title",
            label: "論文名稱",
            type: "textarea",
            rows: 4,
            required: true,
            maxLength: 500
        },
        {
            name: "author",
            label: "學生／指導教授",
            type: "textarea",
            rows: 3,
            required: true,
            maxLength: 300
        }
    ]
});

const settingsDialog = createEditorDialog({
    id: "publication-settings-dialog",
    title: "修改著作頁標題",
    fields: [
        { name: "sectionTitle", label: "區塊標題", required: true, maxLength: 120 },
        { name: "periodLabel", label: "年份說明", required: false, maxLength: 120 },
        { name: "moreUrl", label: "更多歷年著作網址", type: "url", required: true, maxLength: 1000 }
    ]
});

function sortItems(items) {
    return [...items].sort((a, b) => {
        const yearCompare = String(b.year).localeCompare(String(a.year), "zh-Hant", {
            numeric: true,
            sensitivity: "base"
        });
        if (yearCompare !== 0) return yearCompare;
        return String(a.title).localeCompare(String(b.title), "zh-Hant");
    });
}

function renderPublicationPage() {
    sectionTitleElement.textContent = publicationData.sectionTitle;
    periodLabelElement.textContent = publicationData.periodLabel;
    moreLinkElement.href = publicationData.moreUrl || DEFAULT_MORE_URL;
    migrationNote.hidden = sourceMode !== "legacy";

    tableBody.replaceChildren();
    const items = sortItems(Array.isArray(publicationData.items) ? publicationData.items : []);

    if (!items.length) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = 4;
        cell.style.textAlign = "center";
        cell.textContent = "目前尚未建立著作資料。";
        row.appendChild(cell);
        tableBody.appendChild(row);
        return;
    }

    items.forEach((paper) => {
        const row = document.createElement("tr");

        const yearCell = document.createElement("td");
        yearCell.className = "col-year";
        yearCell.textContent = String(paper.year ?? "");

        const titleCell = document.createElement("td");
        titleCell.className = "col-title";
        titleCell.textContent = String(paper.title ?? "");

        const authorCell = document.createElement("td");
        authorCell.className = "col-author";
        authorCell.textContent = String(paper.author ?? "");

        const actionCell = document.createElement("td");
        actionCell.className = "admin-table-cell admin-only";
        actionCell.hidden = true;

        const actions = document.createElement("div");
        actions.className = "admin-action-group";

        const editButton = createItemActionButton("修改", "edit");
        editButton.addEventListener("click", () => {
            try {
                requireAdminMode();
                editingPublicationId = paper.id;
                fillDialog(itemDialog, {
                    year: paper.year,
                    title: paper.title,
                    author: paper.author
                });
            } catch (error) {
                showToast(error.message, "error");
            }
        });

        const deleteButton = createItemActionButton("刪除", "delete", "delete");
        deleteButton.addEventListener("click", async () => {
            try {
                requireAdminMode();
                if (!window.confirm(`確定要刪除「${paper.title}」嗎？`)) return;
                deleteButton.disabled = true;
                publicationData.items = publicationData.items.filter((item) => item.id !== paper.id);
                await savePublicationDocument();
                renderPublicationPage();
                showToast("著作已刪除。", "success");
            } catch (error) {
                console.error("著作刪除失敗：", error);
                showToast("刪除失敗，請確認管理員權限。", "error");
            } finally {
                deleteButton.disabled = false;
            }
        });

        actions.append(editButton, deleteButton);
        actionCell.appendChild(actions);
        row.append(yearCell, titleCell, authorCell, actionCell);
        tableBody.appendChild(row);
    });

    // 動態建立的管理欄位也必須依目前 body 狀態控制。
    const enabled = document.body.classList.contains("admin-mode");
    tableBody.querySelectorAll(".admin-only").forEach((element) => {
        element.hidden = !enabled;
    });
}

async function loadLegacyPublications() {
    const legacySnapshot = await getDocs(collection(db, "publications"));
    return legacySnapshot.docs.map((documentSnapshot) => {
        const data = documentSnapshot.data();
        return {
            id: documentSnapshot.id,
            year: String(data.year ?? ""),
            title: String(data.title ?? ""),
            author: String(data.author ?? "")
        };
    });
}

async function loadPublicationData() {
    tableBody.innerHTML = "<tr><td colspan='4' style='text-align:center;'>資料載入中…</td></tr>";

    try {
        const snapshot = await getDoc(doc(db, "siteContent", "publications"));
        if (snapshot.exists()) {
            const data = snapshot.data();
            publicationData = {
                sectionTitle: String(data.sectionTitle ?? publicationData.sectionTitle),
                periodLabel: String(data.periodLabel ?? publicationData.periodLabel),
                moreUrl: String(data.moreUrl ?? DEFAULT_MORE_URL),
                items: Array.isArray(data.items) ? data.items.map((item) => ({
                    id: String(item.id || createStableId("pub")),
                    year: String(item.year ?? ""),
                    title: String(item.title ?? ""),
                    author: String(item.author ?? "")
                })) : []
            };
            sourceMode = "single-document";
            renderPublicationPage();
            return;
        }

        publicationData.items = await loadLegacyPublications();
        sourceMode = "legacy";
        renderPublicationPage();
    } catch (error) {
        console.error("著作資料載入失敗：", error);
        tableBody.innerHTML = `<tr><td colspan='4' style='text-align:center; color:red;'>資料載入失敗：${error.code || error.message || "未知錯誤"}</td></tr>`;
    }
}

async function savePublicationDocument() {
    const normalizedItems = publicationData.items.map((item) => ({
        id: String(item.id || createStableId("pub")),
        year: String(item.year ?? "").trim(),
        title: String(item.title ?? "").trim(),
        author: String(item.author ?? "").trim()
    }));

    await setDoc(doc(db, "siteContent", "publications"), {
        sectionTitle: publicationData.sectionTitle.trim(),
        periodLabel: publicationData.periodLabel.trim(),
        moreUrl: publicationData.moreUrl.trim(),
        items: normalizedItems,
        updatedAt: serverTimestamp()
    });

    publicationData.items = normalizedItems;
    sourceMode = "single-document";
}

async function migrateLegacyData() {
    if (sourceMode !== "legacy" || migrationInProgress) return;
    migrationInProgress = true;
    try {
        await savePublicationDocument();
        migrationNote.hidden = true;
        showToast("舊著作資料已移轉到 siteContent/publications。", "success", 4200);
    } catch (error) {
        console.error("著作資料移轉失敗：", error);
        showToast("著作資料移轉失敗，請檢查 Firestore Rules。", "error", 4200);
    } finally {
        migrationInProgress = false;
    }
}

const publicationLoadPromise = loadPublicationData();

onAdminStateChange(async (state) => {
    if (state.isAdmin) {
        await publicationLoadPromise;
        await migrateLegacyData();
    }
    // 管理模式切換後，重新套用動態欄位顯示狀態。
    tableBody.querySelectorAll(".admin-only").forEach((element) => {
        element.hidden = !state.adminMode;
    });
});

document.getElementById("add-publication-btn").addEventListener("click", () => {
    try {
        requireAdminMode();
        editingPublicationId = null;
        fillDialog(itemDialog, { year: "", title: "", author: "" });
    } catch (error) {
        showToast(error.message, "error");
    }
});

document.getElementById("edit-publication-settings-btn").addEventListener("click", () => {
    try {
        requireAdminMode();
        fillDialog(settingsDialog, {
            sectionTitle: publicationData.sectionTitle,
            periodLabel: publicationData.periodLabel,
            moreUrl: publicationData.moreUrl
        });
    } catch (error) {
        showToast(error.message, "error");
    }
});

itemDialog.editorForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
        requireAdminMode();
        setDialogBusy(itemDialog, true, "儲存中…");

        const values = Object.fromEntries(new FormData(itemDialog.editorForm));
        const item = {
            id: editingPublicationId || createStableId("pub"),
            year: values.year.trim(),
            title: values.title.trim(),
            author: values.author.trim()
        };

        if (!/^\d{3}$/.test(item.year)) {
            throw new Error("年份必須是三位數，例如 114。");
        }

        if (editingPublicationId) {
            publicationData.items = publicationData.items.map((existing) =>
                existing.id === editingPublicationId ? item : existing
            );
        } else {
            publicationData.items.push(item);
        }

        await savePublicationDocument();
        itemDialog.close();
        renderPublicationPage();
        showToast(editingPublicationId ? "著作已修改。" : "著作已新增。", "success");
    } catch (error) {
        console.error("著作儲存失敗：", error);
        setDialogError(itemDialog, error.message || "儲存失敗。");
    } finally {
        itemDialog.saveButton.disabled = false;
    }
});

settingsDialog.editorForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
        requireAdminMode();
        setDialogBusy(settingsDialog, true, "儲存中…");

        const values = Object.fromEntries(new FormData(settingsDialog.editorForm));
        const parsedUrl = new URL(values.moreUrl.trim());
        if (parsedUrl.protocol !== "https:") {
            throw new Error("更多著作網址必須使用 HTTPS。");
        }

        publicationData.sectionTitle = values.sectionTitle.trim();
        publicationData.periodLabel = values.periodLabel.trim();
        publicationData.moreUrl = parsedUrl.href;

        await savePublicationDocument();
        settingsDialog.close();
        renderPublicationPage();
        showToast("著作頁設定已更新。", "success");
    } catch (error) {
        console.error("著作頁設定儲存失敗：", error);
        setDialogError(settingsDialog, error.message || "儲存失敗。");
    } finally {
        settingsDialog.saveButton.disabled = false;
    }
});

await publicationLoadPromise;
