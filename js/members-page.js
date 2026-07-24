import { db } from "./firebase-config.js";
import {
    initializeAdminMode,
    requireAdminMode
} from "./admin-mode.js";
import {
    createEditorDialog,
    fillDialog,
    setDialogBusy,
    setDialogError,
    isAllowedLocalImagePath,
    createItemActionButton,
    showToast
} from "./editor-utils.js";
import {
    addDoc,
    collection,
    deleteDoc,
    doc,
    getDocs,
    serverTimestamp,
    updateDoc
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

initializeAdminMode();

const mainContainer = document.getElementById("members-main-container");
let editingMemberId = null;

const memberDialog = createEditorDialog({
    id: "member-editor-dialog",
    title: "新增／修改實驗室成員",
    fields: [
        { name: "year", label: "入學年份（民國）", required: true, maxLength: 3, placeholder: "例如：114" },
        { name: "title", label: "學位／職稱", required: true, maxLength: 50, placeholder: "例如：碩士班" },
        { name: "name", label: "姓名", required: true, maxLength: 50 },
        {
            name: "photoUrl",
            label: "照片路徑",
            required: true,
            maxLength: 300,
            placeholder: "例如：members/student1.jpg"
        }
    ]
});

function showMessage(message, color = "#666") {
    const heading = document.createElement("h3");
    heading.style.textAlign = "center";
    heading.style.color = color;
    heading.style.marginTop = "50px";
    heading.textContent = message;
    mainContainer.replaceChildren(heading);
}

function createMemberCard(member) {
    const card = document.createElement("div");
    card.className = "member-card";

    const image = document.createElement("img");
    image.className = "member-photo";
    image.alt = `${member.name || "成員"}照片`;
    image.src = isAllowedLocalImagePath(member.photoUrl) ? member.photoUrl : "lab606.png";
    image.addEventListener("error", () => {
        image.src = "lab606.png";
    }, { once: true });

    const name = document.createElement("div");
    name.className = "member-name";
    name.textContent = String(member.name ?? "");

    const actions = document.createElement("div");
    actions.className = "admin-item-actions";

    const editButton = createItemActionButton("修改", "edit");
    editButton.addEventListener("click", () => {
        try {
            requireAdminMode();
            editingMemberId = member.id;
            fillDialog(memberDialog, {
                year: member.year,
                title: member.title,
                name: member.name,
                photoUrl: member.photoUrl
            });
        } catch (error) {
            showToast(error.message, "error");
        }
    });

    const deleteButton = createItemActionButton("刪除", "delete", "delete");
    deleteButton.addEventListener("click", async () => {
        try {
            requireAdminMode();
            if (!window.confirm(`確定要刪除「${member.name}」的資料嗎？`)) return;
            deleteButton.disabled = true;
            await deleteDoc(doc(db, "members", member.id));
            await loadMembersFromCloud();
            showToast("成員資料已刪除。", "success");
        } catch (error) {
            console.error("成員刪除失敗：", error);
            showToast("刪除失敗，請確認管理員權限。", "error");
        } finally {
            deleteButton.disabled = false;
        }
    });

    actions.append(editButton, deleteButton);
    card.append(image, name, actions);
    return card;
}

async function loadMembersFromCloud() {
    showMessage("⏳ 正在從雲端載入成員資料中…");

    try {
        // 不使用 orderBy，避免舊資料缺少 year 欄位時整個查詢失敗；讀回後再由瀏覽器排序。
        const snapshot = await getDocs(collection(db, "members"));

        if (snapshot.empty) {
            showMessage("目前還沒有建立成員資料。管理者可開啟管理模式新增成員。");
            return;
        }

        const members = snapshot.docs.map((documentSnapshot) => {
            const data = documentSnapshot.data();
            return {
                id: documentSnapshot.id,
                year: String(data.year ?? ""),
                title: String(data.title ?? ""),
                name: String(data.name ?? ""),
                photoUrl: String(data.photoUrl ?? "")
            };
        }).sort((a, b) => {
            const yearCompare = b.year.localeCompare(a.year, "zh-Hant", { numeric: true });
            if (yearCompare !== 0) return yearCompare;
            return a.name.localeCompare(b.name, "zh-Hant");
        });

        const groups = new Map();
        members.forEach((member) => {
            const groupName = `${member.year || "未分類"}學年度 ${member.title || "成員"}`;
            if (!groups.has(groupName)) groups.set(groupName, []);
            groups.get(groupName).push(member);
        });

        const fragment = document.createDocumentFragment();
        groups.forEach((groupMembers, groupName) => {
            const section = document.createElement("section");
            section.className = "group-container";

            const title = document.createElement("div");
            title.className = "group-title";
            title.textContent = groupName;

            const grid = document.createElement("div");
            grid.className = "member-grid";
            groupMembers.forEach((member) => grid.appendChild(createMemberCard(member)));

            section.append(title, grid);
            fragment.appendChild(section);
        });

        mainContainer.replaceChildren(fragment);
    } catch (error) {
        console.error("載入成員失敗：", error);
        showMessage(`❌ 載入失敗：${error.code || error.message || "未知錯誤"}`, "red");
    }
}

document.getElementById("add-member-btn").addEventListener("click", () => {
    try {
        requireAdminMode();
        editingMemberId = null;
        fillDialog(memberDialog, {
            year: "",
            title: "碩士班",
            name: "",
            photoUrl: "members/"
        });
    } catch (error) {
        showToast(error.message, "error");
    }
});

memberDialog.editorForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
        requireAdminMode();
        setDialogBusy(memberDialog, true, "儲存中…");

        const values = Object.fromEntries(new FormData(memberDialog.editorForm));
        const payload = {
            year: values.year.trim(),
            title: values.title.trim(),
            name: values.name.trim(),
            photoUrl: values.photoUrl.trim()
        };

        if (!/^\d{3}$/.test(payload.year)) {
            throw new Error("年份必須是三位數，例如 114。");
        }
        if (!isAllowedLocalImagePath(payload.photoUrl)) {
            throw new Error("照片路徑只允許網站內的 jpg、jpeg、png 或 webp 檔案。");
        }

        if (editingMemberId) {
            await updateDoc(doc(db, "members", editingMemberId), {
                ...payload,
                updatedAt: serverTimestamp()
            });
        } else {
            await addDoc(collection(db, "members"), {
                ...payload,
                createdAt: serverTimestamp()
            });
        }

        memberDialog.close();
        await loadMembersFromCloud();
        showToast(editingMemberId ? "成員資料已修改。" : "成員資料已新增。", "success");
    } catch (error) {
        console.error("成員儲存失敗：", error);
        setDialogError(memberDialog, error.message || "儲存失敗。");
    } finally {
        memberDialog.saveButton.disabled = false;
    }
});

await loadMembersFromCloud();
