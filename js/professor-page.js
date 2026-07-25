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
    linesToArray,
    arrayToLines,
    isAllowedLocalImagePath,
    showToast
} from "./editor-utils.js";
import {
    doc,
    getDoc,
    serverTimestamp,
    setDoc
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

initializeAdminMode();

let professorData = {};
let professorDocumentExists = false;
let seedInProgress = false;
let editingListField = null;
let resolveDomSeed;
const domSeedReady = new Promise((resolve) => {
    resolveDomSeed = resolve;
});

const basicDialog = createEditorDialog({
    id: "professor-basic-dialog",
    title: "修改教授基本資料",
    fields: [
        { name: "chineseName", label: "中文姓名", required: true, maxLength: 50 },
        { name: "englishName", label: "英文姓名", required: true, maxLength: 100 },
        { name: "education", label: "最高學歷", required: true, maxLength: 200 },
        { name: "position", label: "現任職務", required: true, maxLength: 200 },
        {
            name: "researchAreas",
            label: "研究領域",
            type: "textarea",
            rows: 4,
            required: true,
            maxLength: 500
        },
        { name: "email", label: "電子郵件", type: "email", required: true, maxLength: 150 },
        { name: "phone", label: "聯絡電話", required: true, maxLength: 100 },
        {
            name: "photoUrl",
            label: "照片路徑",
            required: true,
            maxLength: 300,
            placeholder: "例如：teacher.jpg"
        }
    ]
});

const listDialog = createEditorDialog({
    id: "professor-list-dialog",
    title: "修改列表",
    fields: [
        {
            name: "items",
            label: "一行一項",
            type: "textarea",
            rows: 16,
            required: false,
            maxLength: 30000
        }
    ]
});

const listConfig = {
    experiences: {
        title: "修改重要經歷",
        listId: "experience-list",
        buttonId: "edit-experiences-btn"
    },
    honors: {
        title: "修改榮譽獎勵",
        listId: "honors-list",
        buttonId: "edit-honors-btn"
    },
    services: {
        title: "修改學術服務",
        listId: "service-list",
        buttonId: "edit-services-btn"
    },
    publications: {
        title: "修改代表著作",
        listId: "publication-list",
        buttonId: "edit-prof-publications-btn"
    }
};

function listTextFromDom(listId) {
    return [...document.querySelectorAll(`#${listId} > li`)]
        .map((item) => item.textContent.trim())
        .filter(Boolean);
}

function readFallbackBasicData() {
    return {
        chineseName: document.getElementById("professor-chinese-name").textContent.trim(),
        englishName: document.getElementById("professor-english-name").textContent.trim(),
        education: document.getElementById("professor-education").textContent.trim(),
        position: document.getElementById("professor-position").textContent.trim(),
        researchAreas: document.getElementById("professor-research").textContent.trim(),
        email: document.getElementById("professor-email").textContent.trim(),
        phone: document.getElementById("professor-phone").textContent.trim(),
        photoUrl: document.getElementById("professor-photo").getAttribute("src") || "teacher.jpg"
    };
}

function seedDataFromDom() {
    professorData = {
        ...readFallbackBasicData(),
        experiences: listTextFromDom("experience-list"),
        honors: listTextFromDom("honors-list"),
        services: listTextFromDom("service-list"),
        publications: listTextFromDom("publication-list")
    };
}

function renderTextList(items, listId) {
    if (!Array.isArray(items)) return;
    const list = document.getElementById(listId);
    list.replaceChildren();

    items.forEach((item) => {
        const li = document.createElement("li");
        li.textContent = String(item);
        list.appendChild(li);
    });
}

function renderProfessorData(data) {
    const textFields = {
        chineseName: "professor-chinese-name",
        englishName: "professor-english-name",
        education: "professor-education",
        position: "professor-position",
        researchAreas: "professor-research",
        email: "professor-email",
        phone: "professor-phone"
    };

    Object.entries(textFields).forEach(([field, id]) => {
        if (Object.hasOwn(data, field)) {
            document.getElementById(id).textContent = String(data[field] ?? "");
        }
    });

    if (Object.hasOwn(data, "photoUrl")) {
        const photoUrl = String(data.photoUrl ?? "").trim();
        if (isAllowedLocalImagePath(photoUrl)) {
            document.getElementById("professor-photo").src = photoUrl;
        }
    }

    Object.entries(listConfig).forEach(([field, config]) => {
        if (Object.hasOwn(data, field)) {
            renderTextList(data[field], config.listId);
        }
    });
}

async function loadProfessorData() {
    try {
        const snapshot = await getDoc(doc(db, "siteContent", "professor"));
        professorDocumentExists = snapshot.exists();
        if (professorDocumentExists) {
            professorData = { ...professorData, ...snapshot.data() };
            renderProfessorData(snapshot.data());
        }
    } catch (error) {
        console.error("教授資料載入失敗，保留頁面內建內容：", error);
    }
}

async function ensureProfessorDocument() {
    await domSeedReady;
    if (professorDocumentExists || seedInProgress) return;
    seedInProgress = true;

    try {
        seedDataFromDom();
        await setDoc(doc(db, "siteContent", "professor"), {
            ...professorData,
            updatedAt: serverTimestamp()
        });
        professorDocumentExists = true;
        showToast("已建立 siteContent/professor，原教授資料已寫入資料庫。", "success", 4200);
    } catch (error) {
        console.error("建立教授資料文件失敗：", error);
        showToast("無法建立教授資料文件，請檢查 Firestore Rules。", "error", 4200);
    } finally {
        seedInProgress = false;
    }
}

async function saveProfessorPatch(patch) {
    await setDoc(
        doc(db, "siteContent", "professor"),
        {
            ...patch,
            updatedAt: serverTimestamp()
        },
        { merge: true }
    );

    professorDocumentExists = true;
    professorData = { ...professorData, ...patch };
    renderProfessorData(patch);
}

/* admin state listener is installed after professorInitialization is created. */

document.getElementById("edit-professor-basic-btn").addEventListener("click", () => {
    try {
        requireAdminMode();
        fillDialog(basicDialog, {
            ...readFallbackBasicData(),
            ...professorData
        });
    } catch (error) {
        showToast(error.message, "error");
    }
});

basicDialog.editorForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
        requireAdminMode();
        setDialogBusy(basicDialog, true, "儲存中…");

        const values = Object.fromEntries(new FormData(basicDialog.editorForm));
        const patch = Object.fromEntries(
            Object.entries(values).map(([key, value]) => [key, String(value).trim()])
        );

        if (!isAllowedLocalImagePath(patch.photoUrl)) {
            throw new Error("照片路徑只允許網站內的 jpg、jpeg、png 或 webp 檔案。");
        }

        await saveProfessorPatch(patch);
        basicDialog.close();
        showToast("教授基本資料已更新。", "success");
    } catch (error) {
        console.error("教授基本資料儲存失敗：", error);
        setDialogError(basicDialog, error.message || "儲存失敗。");
    } finally {
        basicDialog.saveButton.disabled = false;
    }
});

Object.entries(listConfig).forEach(([field, config]) => {
    document.getElementById(config.buttonId).addEventListener("click", () => {
        try {
            requireAdminMode();
            editingListField = field;
            listDialog.querySelector("h3").textContent = config.title;
            fillDialog(listDialog, {
                items: arrayToLines(
                    Array.isArray(professorData[field])
                        ? professorData[field]
                        : listTextFromDom(config.listId)
                )
            });
        } catch (error) {
            showToast(error.message, "error");
        }
    });
});

listDialog.editorForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!editingListField || !listConfig[editingListField]) {
        setDialogError(listDialog, "無法判斷要修改的區塊。");
        return;
    }

    try {
        requireAdminMode();
        setDialogBusy(listDialog, true, "儲存中…");
        const values = Object.fromEntries(new FormData(listDialog.editorForm));
        await saveProfessorPatch({
            [editingListField]: linesToArray(values.items)
        });
        listDialog.close();
        showToast("教授資料區塊已更新。", "success");
    } catch (error) {
        console.error("教授列表儲存失敗：", error);
        setDialogError(listDialog, error.message || "儲存失敗。");
    } finally {
        listDialog.saveButton.disabled = false;
    }
});

const professorInitialization = new Promise((resolve) => {
    window.addEventListener("load", async () => {
        // 原頁面的靜態陣列會先在 window.onload 中渲染；再讀取它們作為首次資料庫種子。
        await new Promise((next) => window.setTimeout(next, 0));
        seedDataFromDom();
        resolveDomSeed();
        await loadProfessorData();
        resolve();
    }, { once: true });
});

onAdminStateChange(async (state) => {
    if (state.isAdmin) {
        await professorInitialization;
        await ensureProfessorDocument();
    }
});
