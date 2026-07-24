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
    showToast,
    isAllowedLocalImagePath,
    createStableId
} from "./editor-utils.js";
import { DEFAULT_GALLERY_CONTENT } from "./seed-content.js";
import {
    collection,
    addDoc,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    limit,
    orderBy,
    query,
    serverTimestamp,
    setDoc,
    startAfter,
    updateDoc
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

initializeAdminMode();

const aboutTitle = document.getElementById("about-title");
const aboutParagraph1 = document.getElementById("about-paragraph-1");
const aboutParagraph2 = document.getElementById("about-paragraph-2");
let homeDocumentExists = false;
let homeSeedInProgress = false;

const homeDialog = createEditorDialog({
    id: "home-content-dialog",
    title: "修改實驗室簡介",
    fields: [
        { name: "title", label: "簡介標題", required: true, maxLength: 100 },
        {
            name: "paragraph1",
            label: "第一段簡介",
            type: "textarea",
            rows: 6,
            required: true,
            maxLength: 1500
        },
        {
            name: "paragraph2",
            label: "第二段簡介",
            type: "textarea",
            rows: 6,
            required: true,
            maxLength: 1500
        }
    ]
});

function currentHomeContent() {
    return {
        title: aboutTitle.textContent.trim(),
        paragraph1: aboutParagraph1.textContent.trim(),
        paragraph2: aboutParagraph2.textContent.trim()
    };
}

function renderHomeContent(data) {
    aboutTitle.textContent = String(data.title ?? "實驗室簡介 (About Us)");
    aboutParagraph1.textContent = String(data.paragraph1 ?? "");
    aboutParagraph2.textContent = String(data.paragraph2 ?? "");
}

async function loadHomeContent() {
    try {
        const snapshot = await getDoc(doc(db, "siteContent", "home"));
        homeDocumentExists = snapshot.exists();
        if (homeDocumentExists) {
            renderHomeContent(snapshot.data());
        }
    } catch (error) {
        console.error("實驗室簡介載入失敗，保留頁面內建內容：", error);
    }
}

async function ensureHomeDocument() {
    if (homeDocumentExists || homeSeedInProgress) return;
    homeSeedInProgress = true;
    try {
        await setDoc(doc(db, "siteContent", "home"), {
            ...currentHomeContent(),
            updatedAt: serverTimestamp()
        });
        homeDocumentExists = true;
        showToast("已建立 siteContent/home，首頁簡介已寫入資料庫。", "success", 3600);
    } catch (error) {
        console.error("建立首頁內容文件失敗：", error);
        showToast("無法建立首頁內容文件，請檢查 Firestore Rules。", "error", 3600);
    } finally {
        homeSeedInProgress = false;
    }
}

const homeLoadPromise = loadHomeContent();

onAdminStateChange(async (state) => {
    if (state.isAdmin) {
        await homeLoadPromise;
        await ensureHomeDocument();
    }
});

document.getElementById("edit-about-btn").addEventListener("click", () => {
    try {
        requireAdminMode();
        fillDialog(homeDialog, currentHomeContent());
    } catch (error) {
        showToast(error.message, "error");
    }
});

homeDialog.editorForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
        requireAdminMode();
        setDialogBusy(homeDialog, true, "儲存中…");
        const values = Object.fromEntries(new FormData(homeDialog.editorForm));
        const payload = {
            title: values.title.trim(),
            paragraph1: values.paragraph1.trim(),
            paragraph2: values.paragraph2.trim(),
            updatedAt: serverTimestamp()
        };
        await setDoc(doc(db, "siteContent", "home"), payload);
        homeDocumentExists = true;
        renderHomeContent(payload);
        homeDialog.close();
        showToast("實驗室簡介已更新。", "success");
    } catch (error) {
        console.error("實驗室簡介儲存失敗：", error);
        setDialogError(homeDialog, error.message || "儲存失敗，請確認權限與輸入內容。");
    } finally {
        homeDialog.saveButton.disabled = false;
    }
});

const newsListElement = document.getElementById("news-list");
const loadMoreButton = document.getElementById("news-load-more");
const PAGE_SIZE = 10;
let lastNewsSnapshot = null;
let newsLoading = false;
let editingNewsId = null;

const newsDialog = createEditorDialog({
    id: "news-editor-dialog",
    title: "新增／修改最新消息",
    fields: [
        { name: "date", label: "日期", type: "date", required: true },
        {
            name: "content",
            label: "消息內容",
            type: "textarea",
            rows: 5,
            required: true,
            maxLength: 500
        }
    ]
});

function slashDateToInput(value) {
    const text = String(value ?? "");
    return /^\d{4}\/\d{2}\/\d{2}$/.test(text) ? text.replaceAll("/", "-") : "";
}

function inputDateToSlash(value) {
    return String(value ?? "").replaceAll("-", "/");
}

function createNewsElement(id, data) {
    const li = document.createElement("li");
    li.className = "admin-editable-item";
    li.dataset.id = id;

    const main = document.createElement("div");
    main.className = "item-main";
    const dateSpan = document.createElement("span");
    dateSpan.className = "news-date";
    dateSpan.textContent = String(data.date ?? "");
    main.append(dateSpan, document.createTextNode(` - ${String(data.content ?? "")}`));

    const actions = document.createElement("div");
    actions.className = "admin-item-actions";

    const editButton = createItemActionButton("修改", "edit");
    editButton.addEventListener("click", () => {
        try {
            requireAdminMode();
            editingNewsId = id;
            fillDialog(newsDialog, {
                date: slashDateToInput(data.date),
                content: String(data.content ?? "")
            });
        } catch (error) {
            showToast(error.message, "error");
        }
    });

    const deleteButton = createItemActionButton("刪除", "delete", "delete");
    deleteButton.addEventListener("click", async () => {
        try {
            requireAdminMode();
            if (!window.confirm("確定要刪除這則最新消息嗎？")) return;
            deleteButton.disabled = true;
            await deleteDoc(doc(db, "news", id));
            await resetAndLoadNews();
            showToast("最新消息已刪除。", "success");
        } catch (error) {
            console.error("消息刪除失敗：", error);
            showToast("刪除失敗，請確認管理員權限。", "error");
        } finally {
            deleteButton.disabled = false;
        }
    });

    actions.append(editButton, deleteButton);
    li.append(main, actions);
    return li;
}

async function loadNextNewsPage() {
    if (newsLoading) return;
    newsLoading = true;
    loadMoreButton.disabled = true;

    try {
        const constraints = [orderBy("date", "desc")];
        if (lastNewsSnapshot) constraints.push(startAfter(lastNewsSnapshot));
        constraints.push(limit(PAGE_SIZE));

        const snapshot = await getDocs(query(collection(db, "news"), ...constraints));

        if (!lastNewsSnapshot && snapshot.empty) {
            newsListElement.replaceChildren();
            const li = document.createElement("li");
            li.textContent = "目前暫無消息。";
            newsListElement.appendChild(li);
        } else {
            snapshot.forEach((documentSnapshot) => {
                newsListElement.appendChild(
                    createNewsElement(documentSnapshot.id, documentSnapshot.data())
                );
            });
        }

        lastNewsSnapshot = snapshot.docs[snapshot.docs.length - 1] ?? lastNewsSnapshot;
        loadMoreButton.hidden = snapshot.size < PAGE_SIZE;
    } catch (error) {
        console.error("新聞載入失敗：", error);
        if (!lastNewsSnapshot) {
            newsListElement.replaceChildren();
            const li = document.createElement("li");
            li.textContent = "目前無法載入最新消息。";
            newsListElement.appendChild(li);
        }
        loadMoreButton.hidden = true;
    } finally {
        newsLoading = false;
        loadMoreButton.disabled = false;
    }
}

async function resetAndLoadNews() {
    lastNewsSnapshot = null;
    newsListElement.replaceChildren();
    loadMoreButton.hidden = false;
    await loadNextNewsPage();
}

document.getElementById("add-news-btn").addEventListener("click", () => {
    try {
        requireAdminMode();
        editingNewsId = null;
        fillDialog(newsDialog, {
            date: new Date().toISOString().slice(0, 10),
            content: ""
        });
    } catch (error) {
        showToast(error.message, "error");
    }
});

newsDialog.editorForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
        requireAdminMode();
        setDialogBusy(newsDialog, true, "儲存中…");
        const values = Object.fromEntries(new FormData(newsDialog.editorForm));
        const payload = {
            date: inputDateToSlash(values.date),
            content: values.content.trim()
        };

        if (editingNewsId) {
            await updateDoc(doc(db, "news", editingNewsId), {
                ...payload,
                updatedAt: serverTimestamp()
            });
        } else {
            await addDoc(collection(db, "news"), {
                ...payload,
                createdAt: serverTimestamp()
            });
        }

        newsDialog.close();
        await resetAndLoadNews();
        showToast(editingNewsId ? "最新消息已修改。" : "最新消息已新增。", "success");
    } catch (error) {
        console.error("消息儲存失敗：", error);
        setDialogError(newsDialog, error.message || "儲存失敗，請確認日期格式與管理員權限。");
    } finally {
        newsDialog.saveButton.disabled = false;
    }
});

loadMoreButton.addEventListener("click", loadNextNewsPage);

const galleryRef = doc(db, "siteContent", "gallery");
const galleryTrack = document.getElementById("gallery-list");
const galleryNav = document.getElementById("carousel-nav");
const previousGalleryButton = document.getElementById("prev-btn");
const nextGalleryButton = document.getElementById("next-btn");
let galleryItems = DEFAULT_GALLERY_CONTENT.items.map((item) => ({ ...item }));
let galleryDocumentExists = false;
let gallerySeedInProgress = false;
let editingGalleryId = null;
let slides = [];
let dots = [];
let currentSlideIndex = 0;

const galleryDialog = createEditorDialog({
    id: "gallery-editor-dialog",
    title: "新增／修改活動照片",
    fields: [
        {
            name: "src",
            label: "照片路徑",
            required: true,
            maxLength: 300,
            placeholder: "例如：front_cover/lab-bg11.jpg"
        },
        {
            name: "caption",
            label: "照片說明",
            required: false,
            maxLength: 120,
            placeholder: "例如：2026 實驗室聚餐"
        }
    ]
});

function normalizeGalleryItems(value) {
    if (!Array.isArray(value)) return [];

    return value
        .map((item, index) => ({
            id: String(item?.id ?? `gallery-${index + 1}`),
            src: String(item?.src ?? "").trim(),
            caption: String(item?.caption ?? item?.alt ?? "").trim()
        }))
        .filter((item) => isAllowedLocalImagePath(item.src));
}

async function loadGalleryContent() {
    try {
        const snapshot = await getDoc(galleryRef);
        galleryDocumentExists = snapshot.exists();

        if (galleryDocumentExists) {
            galleryItems = normalizeGalleryItems(snapshot.data().items);
        }
    } catch (error) {
        console.error("活動照片載入失敗，暫時使用網頁內建照片：", error);
    }
}

async function ensureGalleryDocument() {
    if (galleryDocumentExists || gallerySeedInProgress) return;

    gallerySeedInProgress = true;
    try {
        await setDoc(galleryRef, {
            items: galleryItems,
            updatedAt: serverTimestamp()
        });
        galleryDocumentExists = true;
        showToast("已建立 siteContent/gallery，活動照片路徑已寫入資料庫。", "success", 3600);
    } catch (error) {
        console.error("建立活動照片文件失敗：", error);
        showToast("無法建立活動照片文件，請確認新版 Firestore Rules 已發布。", "error", 3800);
    } finally {
        gallerySeedInProgress = false;
    }
}

async function saveGalleryItems(nextItems) {
    await setDoc(galleryRef, {
        items: nextItems,
        updatedAt: serverTimestamp()
    });
    galleryItems = nextItems;
    galleryDocumentExists = true;
    renderGallery();
}

function createGalleryActions(item) {
    const actions = document.createElement("div");
    actions.className = "admin-item-actions gallery-slide-actions";

    const editButton = createItemActionButton("修改", "edit");
    editButton.addEventListener("click", () => {
        try {
            requireAdminMode();
            editingGalleryId = item.id;
            fillDialog(galleryDialog, {
                src: item.src,
                caption: item.caption
            });
        } catch (error) {
            showToast(error.message, "error");
        }
    });

    const deleteButton = createItemActionButton("刪除", "delete", "delete");
    deleteButton.addEventListener("click", async () => {
        try {
            requireAdminMode();
            if (!window.confirm(`確定要刪除「${item.caption || item.src}」嗎？`)) return;

            deleteButton.disabled = true;
            const nextItems = galleryItems.filter((galleryItem) => galleryItem.id !== item.id);
            await saveGalleryItems(nextItems);
            showToast("活動照片已刪除。", "success");
        } catch (error) {
            console.error("活動照片刪除失敗：", error);
            showToast("刪除失敗，請確認管理員權限與 Firestore Rules。", "error");
        } finally {
            deleteButton.disabled = false;
        }
    });

    actions.append(editButton, deleteButton);
    return actions;
}

function renderGallery() {
    galleryTrack.replaceChildren();
    galleryNav.replaceChildren();
    slides = [];
    dots = [];
    currentSlideIndex = 0;

    if (!galleryItems.length) {
        const emptySlide = document.createElement("li");
        emptySlide.className = "carousel-slide current-slide gallery-empty-slide";
        emptySlide.textContent = "目前沒有活動照片。管理者可開啟管理模式新增照片。";
        galleryTrack.appendChild(emptySlide);
        slides = [emptySlide];
        previousGalleryButton.disabled = true;
        nextGalleryButton.disabled = true;
        return;
    }

    galleryItems.forEach((imageData, index) => {
        const slide = document.createElement("li");
        slide.className = "carousel-slide";
        if (index === 0) slide.classList.add("current-slide");

        const image = document.createElement("img");
        image.src = imageData.src;
        image.alt = imageData.caption || `活動照片 ${index + 1}`;
        image.addEventListener("error", () => {
            image.src = "lab606.png";
        }, { once: true });
        slide.appendChild(image);

        if (imageData.caption) {
            const caption = document.createElement("div");
            caption.className = "gallery-caption";
            caption.textContent = imageData.caption;
            slide.appendChild(caption);
        }

        slide.appendChild(createGalleryActions(imageData));
        galleryTrack.appendChild(slide);
        slides.push(slide);

        const dot = document.createElement("button");
        dot.type = "button";
        dot.className = "carousel-indicator";
        dot.setAttribute("aria-label", `顯示第 ${index + 1} 張照片`);
        if (index === 0) dot.classList.add("current-indicator");
        dot.addEventListener("click", () => showSlide(index));
        galleryNav.appendChild(dot);
        dots.push(dot);
    });

    const hasMultipleSlides = galleryItems.length > 1;
    previousGalleryButton.disabled = !hasMultipleSlides;
    nextGalleryButton.disabled = !hasMultipleSlides;
}

function showSlide(index) {
    if (!slides.length || slides.length === 1) return;

    slides[currentSlideIndex]?.classList.remove("current-slide");
    dots[currentSlideIndex]?.classList.remove("current-indicator");
    currentSlideIndex = (index + slides.length) % slides.length;
    slides[currentSlideIndex]?.classList.add("current-slide");
    dots[currentSlideIndex]?.classList.add("current-indicator");
}

document.getElementById("add-gallery-btn").addEventListener("click", () => {
    try {
        requireAdminMode();
        editingGalleryId = null;
        fillDialog(galleryDialog, {
            src: "front_cover/",
            caption: ""
        });
    } catch (error) {
        showToast(error.message, "error");
    }
});

galleryDialog.editorForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
        requireAdminMode();
        setDialogBusy(galleryDialog, true, "儲存中…");

        const values = Object.fromEntries(new FormData(galleryDialog.editorForm));
        const src = values.src.trim();
        const caption = values.caption.trim();

        if (!isAllowedLocalImagePath(src)) {
            throw new Error("照片路徑只允許網站內的 jpg、jpeg、png 或 webp 檔案。");
        }

        let nextItems;
        if (editingGalleryId) {
            nextItems = galleryItems.map((item) => item.id === editingGalleryId
                ? { ...item, src, caption }
                : item
            );
        } else {
            nextItems = [
                ...galleryItems,
                {
                    id: createStableId("gallery"),
                    src,
                    caption
                }
            ];
        }

        await saveGalleryItems(nextItems);
        galleryDialog.close();
        showToast(editingGalleryId ? "活動照片已修改。" : "活動照片已新增。", "success");
    } catch (error) {
        console.error("活動照片儲存失敗：", error);
        setDialogError(galleryDialog, error.message || "儲存失敗，請確認照片路徑與管理員權限。");
    } finally {
        galleryDialog.saveButton.disabled = false;
    }
});

previousGalleryButton.addEventListener("click", () => showSlide(currentSlideIndex - 1));
nextGalleryButton.addEventListener("click", () => showSlide(currentSlideIndex + 1));

const galleryLoadPromise = loadGalleryContent();

onAdminStateChange(async (state) => {
    if (state.isAdmin) {
        await galleryLoadPromise;
        await ensureGalleryDocument();
    }
});

await Promise.all([homeLoadPromise, resetAndLoadNews(), galleryLoadPromise]);
renderGallery();
