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
    showToast
} from "./editor-utils.js";
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

const galleryData = Array.from({ length: 10 }, (_, index) => ({
    src: `front_cover/lab-bg${index + 1}.jpg`,
    alt: `活動照片${index + 1}`
}));
let slides = [];
let dots = [];
let currentSlideIndex = 0;

function renderGallery() {
    const galleryTrack = document.getElementById("gallery-list");
    const navContainer = document.getElementById("carousel-nav");
    galleryTrack.replaceChildren();
    navContainer.replaceChildren();
    dots = [];

    galleryData.forEach((imageData, index) => {
        const slide = document.createElement("li");
        slide.className = "carousel-slide";
        if (index === 0) slide.classList.add("current-slide");

        const image = document.createElement("img");
        image.src = imageData.src;
        image.alt = imageData.alt;
        slide.appendChild(image);
        galleryTrack.appendChild(slide);

        const dot = document.createElement("button");
        dot.type = "button";
        dot.className = "carousel-indicator";
        dot.setAttribute("aria-label", `顯示第 ${index + 1} 張照片`);
        if (index === 0) dot.classList.add("current-indicator");
        dot.addEventListener("click", () => showSlide(index));
        navContainer.appendChild(dot);
        dots.push(dot);
    });
    slides = [...document.querySelectorAll(".carousel-slide")];
}

function showSlide(index) {
    if (!slides.length) return;
    slides[currentSlideIndex].classList.remove("current-slide");
    dots[currentSlideIndex].classList.remove("current-indicator");
    currentSlideIndex = (index + slides.length) % slides.length;
    slides[currentSlideIndex].classList.add("current-slide");
    dots[currentSlideIndex].classList.add("current-indicator");
}

document.getElementById("prev-btn").addEventListener("click", () => showSlide(currentSlideIndex - 1));
document.getElementById("next-btn").addEventListener("click", () => showSlide(currentSlideIndex + 1));

await Promise.all([homeLoadPromise, resetAndLoadNews()]);
renderGallery();
