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

const PHOTO_X_MIN = -50;
const PHOTO_X_MAX = 50;
const PHOTO_Y_MIN = -50;
const PHOTO_Y_MAX = 50;
const PHOTO_SCALE_MIN = 0.6;
const PHOTO_SCALE_MAX = 2.5;
const DEFAULT_PHOTO = "lab606.png";

const memberDialog = createEditorDialog({
    id: "member-editor-dialog",
    title: "新增／修改實驗室成員",
    fields: [
        {
            name: "year",
            label: "入學年份（民國）",
            required: true,
            maxLength: 3,
            placeholder: "例如：114"
        },
        {
            name: "title",
            label: "學位／職稱",
            required: true,
            maxLength: 50,
            placeholder: "例如：碩士班"
        },
        {
            name: "name",
            label: "姓名",
            required: true,
            maxLength: 50
        },
        {
            name: "photoUrl",
            label: "照片路徑",
            required: true,
            maxLength: 300,
            placeholder: "例如：member_ph/wen.jpg"
        },
        {
            name: "motto",
            label: "個性標籤／想說的一句話",
            required: false,
            maxLength: 120,
            placeholder: "例如：保持好奇，持續前進。"
        }
    ]
});

// 在既有成員編輯視窗中加入可拖曳、可縮放的照片預覽。
const cropEditor = document.createElement("section");
cropEditor.className = "photo-crop-editor";
cropEditor.setAttribute("aria-label", "成員照片位置調整");
cropEditor.innerHTML = `
    <div class="photo-crop-heading">照片顯示範圍</div>
    <p class="photo-crop-help">在圓形預覽上拖曳照片調整位置，並使用滑桿放大或縮小。</p>
    <div class="photo-crop-frame" id="member-photo-crop-frame">
        <img
            class="photo-crop-image"
            id="member-photo-crop-image"
            src="${DEFAULT_PHOTO}"
            alt="成員照片預覽"
            draggable="false"
        >
    </div>
    <div class="photo-zoom-row">
        <label for="member-photo-zoom">照片縮放</label>
        <input
            id="member-photo-zoom"
            type="range"
            min="${PHOTO_SCALE_MIN}"
            max="${PHOTO_SCALE_MAX}"
            step="0.01"
            value="1"
        >
        <output id="member-photo-zoom-value" for="member-photo-zoom">100%</output>
    </div>
    <button class="photo-reset-button" id="member-photo-reset" type="button">重設照片位置</button>
`;
memberDialog.statusElement.before(cropEditor);

const photoPathInput = memberDialog.editorForm.elements.namedItem("photoUrl");
const cropFrame = cropEditor.querySelector("#member-photo-crop-frame");
const cropImage = cropEditor.querySelector("#member-photo-crop-image");
const zoomInput = cropEditor.querySelector("#member-photo-zoom");
const zoomValue = cropEditor.querySelector("#member-photo-zoom-value");
const resetCropButton = cropEditor.querySelector("#member-photo-reset");

const cropState = {
    x: 0,
    y: 0,
    scale: 1
};

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function toFiniteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function normalizePhotoPosition(member = {}) {
    return {
        x: clamp(
            toFiniteNumber(member.photoX, 0),
            PHOTO_X_MIN,
            PHOTO_X_MAX
        ),
        y: clamp(
            toFiniteNumber(member.photoY, 0),
            PHOTO_Y_MIN,
            PHOTO_Y_MAX
        ),
        scale: clamp(
            toFiniteNumber(member.photoScale, 1),
            PHOTO_SCALE_MIN,
            PHOTO_SCALE_MAX
        )
    };
}

function applyPhotoTransform(image, member = {}) {
    const position = normalizePhotoPosition(member);
    image.style.setProperty("--photo-x", `${position.x}%`);
    image.style.setProperty("--photo-y", `${position.y}%`);
    image.style.setProperty("--photo-scale", String(position.scale));
}

function updateCropPreviewSource() {
    const path = String(photoPathInput?.value ?? "").trim();
    cropImage.src = isAllowedLocalImagePath(path) ? path : DEFAULT_PHOTO;
}

function updateCropPreviewTransform() {
    cropImage.style.setProperty("--photo-x", `${cropState.x}%`);
    cropImage.style.setProperty("--photo-y", `${cropState.y}%`);
    cropImage.style.setProperty("--photo-scale", String(cropState.scale));
    zoomInput.value = String(cropState.scale);
    zoomValue.textContent = `${Math.round(cropState.scale * 100)}%`;
}

function setCropState(member = {}) {
    const normalized = normalizePhotoPosition(member);
    cropState.x = normalized.x;
    cropState.y = normalized.y;
    cropState.scale = normalized.scale;
    updateCropPreviewSource();
    updateCropPreviewTransform();
}

cropImage.addEventListener("error", () => {
    if (!cropImage.src.endsWith(`/${DEFAULT_PHOTO}`)) {
        cropImage.src = DEFAULT_PHOTO;
    }
});

photoPathInput?.addEventListener("input", updateCropPreviewSource);

zoomInput.addEventListener("input", () => {
    cropState.scale = clamp(
        toFiniteNumber(zoomInput.value, 1),
        PHOTO_SCALE_MIN,
        PHOTO_SCALE_MAX
    );
    updateCropPreviewTransform();
});

resetCropButton.addEventListener("click", () => {
    cropState.x = 0;
    cropState.y = 0;
    cropState.scale = 1;
    updateCropPreviewTransform();
});

let activePointerId = null;
let dragStartClientX = 0;
let dragStartClientY = 0;
let dragStartPhotoX = 0;
let dragStartPhotoY = 0;

cropFrame.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;

    activePointerId = event.pointerId;
    dragStartClientX = event.clientX;
    dragStartClientY = event.clientY;
    dragStartPhotoX = cropState.x;
    dragStartPhotoY = cropState.y;

    cropFrame.classList.add("is-dragging");
    cropFrame.setPointerCapture(event.pointerId);
    event.preventDefault();
});

cropFrame.addEventListener("pointermove", (event) => {
    if (activePointerId !== event.pointerId) return;

    const deltaX = event.clientX - dragStartClientX;
    const deltaY = event.clientY - dragStartClientY;
    const width = cropFrame.clientWidth || 1;
    const height = cropFrame.clientHeight || 1;

    cropState.x = clamp(
        dragStartPhotoX + (deltaX / width) * 100,
        PHOTO_X_MIN,
        PHOTO_X_MAX
    );
    cropState.y = clamp(
        dragStartPhotoY + (deltaY / height) * 100,
        PHOTO_Y_MIN,
        PHOTO_Y_MAX
    );

    updateCropPreviewTransform();
});

function finishCropDrag(event) {
    if (activePointerId !== event.pointerId) return;

    if (cropFrame.hasPointerCapture(event.pointerId)) {
        cropFrame.releasePointerCapture(event.pointerId);
    }
    activePointerId = null;
    cropFrame.classList.remove("is-dragging");
}

cropFrame.addEventListener("pointerup", finishCropDrag);
cropFrame.addEventListener("pointercancel", finishCropDrag);

function showMessage(message, color = "#666") {
    const heading = document.createElement("h3");
    heading.style.textAlign = "center";
    heading.style.color = color;
    heading.style.marginTop = "50px";
    heading.textContent = message;
    mainContainer.replaceChildren(heading);
}

function openMemberEditor(member = null) {
    editingMemberId = member?.id ?? null;

    fillDialog(memberDialog, {
        year: member?.year ?? "",
        title: member?.title ?? "碩士班",
        name: member?.name ?? "",
        photoUrl: member?.photoUrl ?? "member_ph/",
        motto: member?.motto ?? ""
    });

    setCropState(member ?? {});
}

function createMemberCard(member) {
    const card = document.createElement("div");
    card.className = "member-card";

    const photoFrame = document.createElement("div");
    photoFrame.className = "member-photo-frame";

    const image = document.createElement("img");
    image.className = "member-photo";
    image.alt = `${member.name || "成員"}照片`;
    image.src = isAllowedLocalImagePath(member.photoUrl)
        ? member.photoUrl
        : DEFAULT_PHOTO;
    applyPhotoTransform(image, member);
    image.addEventListener("error", () => {
        image.src = DEFAULT_PHOTO;
        image.style.setProperty("--photo-x", "0%");
        image.style.setProperty("--photo-y", "0%");
        image.style.setProperty("--photo-scale", "1");
    }, { once: true });

    photoFrame.appendChild(image);

    const name = document.createElement("div");
    name.className = "member-name";
    name.textContent = String(member.name ?? "");

    const motto = document.createElement("div");
    motto.className = "member-motto";
    motto.textContent = String(member.motto ?? "").trim();
    motto.hidden = !motto.textContent;

    const actions = document.createElement("div");
    actions.className = "admin-item-actions";

    const editButton = createItemActionButton("修改", "edit");
    editButton.addEventListener("click", () => {
        try {
            requireAdminMode();
            openMemberEditor(member);
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
    card.append(photoFrame, name, motto, actions);
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
                photoUrl: String(data.photoUrl ?? ""),
                motto: String(data.motto ?? ""),
                photoX: toFiniteNumber(data.photoX, 0),
                photoY: toFiniteNumber(data.photoY, 0),
                photoScale: toFiniteNumber(data.photoScale, 1)
            };
        }).sort((a, b) => {
            const yearCompare = b.year.localeCompare(
                a.year,
                "zh-Hant",
                { numeric: true }
            );
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
            groupMembers.forEach((member) => {
                grid.appendChild(createMemberCard(member));
            });

            section.append(title, grid);
            fragment.appendChild(section);
        });

        mainContainer.replaceChildren(fragment);
    } catch (error) {
        console.error("載入成員失敗：", error);
        showMessage(
            `❌ 載入失敗：${error.code || error.message || "未知錯誤"}`,
            "red"
        );
    }
}

document.getElementById("add-member-btn").addEventListener("click", () => {
    try {
        requireAdminMode();
        openMemberEditor();
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
            photoUrl: values.photoUrl.trim(),
            motto: values.motto.trim(),
            photoX: Number(cropState.x.toFixed(2)),
            photoY: Number(cropState.y.toFixed(2)),
            photoScale: Number(cropState.scale.toFixed(2))
        };

        if (!/^\d{3}$/.test(payload.year)) {
            throw new Error("年份必須是三位數，例如 114。");
        }
        if (!isAllowedLocalImagePath(payload.photoUrl)) {
            throw new Error("照片路徑只允許網站內的 jpg、jpeg、png 或 webp 檔案。");
        }

        const wasEditing = Boolean(editingMemberId);

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
        editingMemberId = null;
        await loadMembersFromCloud();
        showToast(
            wasEditing ? "成員資料已修改。" : "成員資料已新增。",
            "success"
        );
    } catch (error) {
        console.error("成員儲存失敗：", error);
        setDialogError(memberDialog, error.message || "儲存失敗。");
    } finally {
        memberDialog.saveButton.disabled = false;
    }
});

await loadMembersFromCloud();
