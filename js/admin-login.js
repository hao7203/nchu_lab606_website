import { auth, db } from "./firebase-config.js";
import { DEFAULT_HOME_CONTENT, DEFAULT_PROFESSOR_CONTENT, DEFAULT_GALLERY_CONTENT } from "./seed-content.js";
import {
    onAuthStateChanged,
    browserSessionPersistence,
    setPersistence,
    signInWithEmailAndPassword,
    signOut
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import {
    collection,
    doc,
    getDoc,
    getDocs,
    serverTimestamp,
    setDoc
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

const loginSection = document.getElementById("login-section");
const loggedInSection = document.getElementById("logged-in-section");
const loginForm = document.getElementById("login-form");
const loginStatus = document.getElementById("login-status");
const currentUserEmail = document.getElementById("current-user-email");
const continueButton = document.getElementById("continue-btn");
const logoutButton = document.getElementById("logout-btn");
const backLink = document.getElementById("back-link");

const allowedReturnPages = new Set([
    "index.html",
    "professor.html",
    "research.html",
    "members.html",
    "publications.html"
]);

function getReturnPage() {
    const requested = new URLSearchParams(window.location.search).get("return");
    return allowedReturnPages.has(requested) ? requested : "index.html";
}

function setStatus(message, type = "info") {
    loginStatus.textContent = message;
    loginStatus.className = type;
}

async function verifyAdmin() {
    await getDoc(doc(db, "system", "adminCheck"));
}

async function ensureInitialContent() {
    const created = [];

    const homeRef = doc(db, "siteContent", "home");
    const professorRef = doc(db, "siteContent", "professor");
    const publicationsRef = doc(db, "siteContent", "publications");
    const galleryRef = doc(db, "siteContent", "gallery");

    const [homeSnapshot, professorSnapshot, publicationsSnapshot, gallerySnapshot] = await Promise.all([
        getDoc(homeRef),
        getDoc(professorRef),
        getDoc(publicationsRef),
        getDoc(galleryRef)
    ]);

    if (!homeSnapshot.exists()) {
        await setDoc(homeRef, {
            ...DEFAULT_HOME_CONTENT,
            updatedAt: serverTimestamp()
        });
        created.push("首頁簡介");
    }

    if (!professorSnapshot.exists()) {
        await setDoc(professorRef, {
            ...DEFAULT_PROFESSOR_CONTENT,
            updatedAt: serverTimestamp()
        });
        created.push("教授資料");
    }

    if (!gallerySnapshot.exists()) {
        await setDoc(galleryRef, {
            ...DEFAULT_GALLERY_CONTENT,
            updatedAt: serverTimestamp()
        });
        created.push("活動照片");
    }

    if (!publicationsSnapshot.exists()) {
        const legacySnapshot = await getDocs(collection(db, "publications"));
        const items = legacySnapshot.docs.map((documentSnapshot) => {
            const data = documentSnapshot.data();
            return {
                id: documentSnapshot.id,
                year: String(data.year ?? ""),
                title: String(data.title ?? ""),
                author: String(data.author ?? "")
            };
        });

        await setDoc(publicationsRef, {
            sectionTitle: "近五年碩博士論文 (Recent Theses & Dissertations)",
            periodLabel: "2020-2024 (Year 109-113)",
            moreUrl: "https://ndltd.ncl.edu.tw/cgi-bin/gs32/gsweb.cgi/login?ssoauth=1&loadingjs=1&o=dwebmge&cache=1770027991344",
            items,
            updatedAt: serverTimestamp()
        });
        created.push("著作單一文件");
    }

    return created;
}

function showLoggedOut() {
    loginSection.hidden = false;
    loggedInSection.hidden = true;
}

function showLoggedIn(user) {
    loginSection.hidden = true;
    loggedInSection.hidden = false;
    currentUserEmail.textContent = user.email || "已登入帳號";
}

function goBackInAdminMode() {
    sessionStorage.setItem("labAdminMode", "true");
    sessionStorage.setItem("labLoginSuccess", "true");
    window.location.href = getReturnPage();
}

backLink.href = getReturnPage();

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        showLoggedOut();
        if (!loginStatus.textContent) {
            setStatus("請輸入管理員帳號與密碼。", "info");
        }
        return;
    }

    setStatus("正在確認管理員權限…", "info");
    try {
        await verifyAdmin();
        showLoggedIn(user);
        setStatus("管理員身分驗證成功。", "success");
    } catch (error) {
        console.error("管理員權限驗證失敗：", error);
        await signOut(auth).catch(() => {});
        showLoggedOut();
        setStatus("此帳號沒有管理權限，或 App Check／Firestore Rules 驗證失敗。", "error");
    }
});

loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const submitButton = loginForm.querySelector("button[type='submit']");
    const email = document.getElementById("emailInput").value.trim();
    const password = document.getElementById("passwordInput").value;

    submitButton.disabled = true;
    setStatus("正在登入並確認管理員權限…", "info");

    try {
        await setPersistence(auth, browserSessionPersistence);
        await signInWithEmailAndPassword(auth, email, password);
        await verifyAdmin();
        setStatus("登入成功，正在建立或檢查網站內容資料…", "info");
        const created = await ensureInitialContent();
        const detail = created.length
            ? `已建立：${created.join("、")}。`
            : "網站內容文件已存在。";
        setStatus(`登入成功。${detail} 正在返回網站…`, "success");
        window.setTimeout(goBackInAdminMode, 1100);
    } catch (error) {
        console.error("管理員登入失敗：", error);
        setStatus("登入失敗：帳號、密碼、網域限制或管理權限不正確。", "error");
        await signOut(auth).catch(() => {});
    } finally {
        submitButton.disabled = false;
    }
});

continueButton.addEventListener("click", async () => {
    continueButton.disabled = true;
    try {
        setStatus("正在建立或檢查網站內容資料…", "info");
        const created = await ensureInitialContent();
        const detail = created.length
            ? `已建立：${created.join("、")}。`
            : "網站內容文件已存在。";
        setStatus(`${detail} 正在返回網站…`, "success");
        window.setTimeout(goBackInAdminMode, 900);
    } catch (error) {
        console.error("內容初始化失敗：", error);
        setStatus("登入成功，但內容初始化失敗。請先發布新版 Firestore Rules。", "error");
        continueButton.disabled = false;
    }
});

logoutButton.addEventListener("click", async () => {
    await signOut(auth);
    sessionStorage.removeItem("labAdminMode");
    sessionStorage.removeItem("labLoginSuccess");
    showLoggedOut();
    setStatus("已登出。", "success");
});
