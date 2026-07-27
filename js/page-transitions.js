(() => {
    const html = document.documentElement;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let leaving = false;
    let cleanupTimer = null;

    const normalizePath = (pathname) => {
        const clean = pathname.replace(/\\/g, "/").replace(/\/+$/, "");
        const filename = clean.split("/").pop()?.toLowerCase() || "";
        return filename || "index.html";
    };

    const variantForPath = (pathname) => {
        const page = normalizePath(pathname);

        if (page === "index.html" || page === "") return "home";
        if (page === "members.html") return "glitch";
        if (page === "research.html") return "stream";
        if (page === "professor.html" || page === "publications.html") return "hud";
        if (page === "admin.html") return "fade";
        return "hud";
    };

    const timings = {
        home:   { enter: 720, exit: 600 },
        glitch: { enter: 480, exit: 420 },
        stream: { enter: 560, exit: 470 },
        hud:    { enter: 460, exit: 390 },
        fade:   { enter: 280, exit: 220 }
    };

    const currentVariant = variantForPath(window.location.pathname);
    html.dataset.pageTransition = currentVariant;

    // 保留既有頁面模組的呼叫介面；轉場本身不等待 Firebase。
    window.pageTransitionReady = () => {};

    const transitionLayer = document.createElement("div");
    transitionLayer.className = "page-transition-layer";
    transitionLayer.setAttribute("aria-hidden", "true");
    transitionLayer.innerHTML = `
        <div class="pt-home-layer">
            <div class="pt-home-grid"></div>
            <div class="pt-home-scan"></div>
            <div class="pt-home-core"></div>
        </div>

        <div class="pt-hud-layer">
            <div class="pt-hud-sweep"></div>
            <div class="pt-hud-line pt-hud-line--top"></div>
            <div class="pt-hud-line pt-hud-line--bottom"></div>
        </div>

        <div class="pt-glitch-layer">
            <span></span><span></span><span></span><span></span><span></span><span></span>
        </div>

        <div class="pt-stream-layer">
            <div class="pt-stream-flare"></div>
            <span></span><span></span><span></span><span></span>
            <span></span><span></span><span></span><span></span>
        </div>

        <div class="pt-fade-layer"></div>
    `;

    html.classList.add("pt-active");
    document.body.appendChild(transitionLayer);

    const getTiming = () => {
        if (reducedMotion) return { enter: 170, exit: 150 };
        return timings[currentVariant] || timings.hud;
    };

    const playEnter = () => {
        if (cleanupTimer) window.clearTimeout(cleanupTimer);

        leaving = false;
        document.body.classList.remove("pt-body-leaving");
        html.classList.remove("pt-leaving", "pt-entered", "pt-finished");

        // 連續兩個 frame，確保瀏覽器先套用初始狀態，再播放進場。
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                html.classList.add("pt-entered");
                cleanupTimer = window.setTimeout(() => {
                    if (!leaving) html.classList.add("pt-finished");
                }, getTiming().enter);
            });
        });
    };

    playEnter();

    const isSameDocumentLink = (url) => {
        const current = new URL(window.location.href);
        return url.origin === current.origin
            && url.pathname === current.pathname
            && url.search === current.search;
    };

    const isTransitionLink = (anchor, event) => {
        if (!anchor || event.defaultPrevented || event.button !== 0) return false;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
        if (anchor.target && anchor.target !== "_self") return false;
        if (anchor.hasAttribute("download") || anchor.dataset.noTransition === "true") return false;

        const rawHref = anchor.getAttribute("href");
        if (!rawHref || rawHref.startsWith("#") || rawHref.startsWith("mailto:") || rawHref.startsWith("tel:")) {
            return false;
        }

        const url = new URL(anchor.href, window.location.href);
        if (!/^https?:$/.test(url.protocol) || url.origin !== window.location.origin) return false;
        if (isSameDocumentLink(url)) return false;
        return true;
    };

    const navigateWithTransition = (href) => {
        if (leaving) return;
        leaving = true;

        if (cleanupTimer) window.clearTimeout(cleanupTimer);
        html.classList.remove("pt-finished", "pt-entered");
        html.classList.add("pt-leaving");
        document.body.classList.add("pt-body-leaving");

        // 首頁開場動畫若仍存在，停止接收操作，讓頁面轉場接管點擊。
        const intro = document.getElementById("intro-screen");
        if (intro && intro.style.display !== "none") {
            intro.style.pointerEvents = "none";
        }

        window.setTimeout(() => {
            window.location.assign(href);
        }, getTiming().exit);
    };

    window.navigateWithPageTransition = navigateWithTransition;

    document.addEventListener("click", (event) => {
        const anchor = event.target.closest?.("a[href]");
        if (!isTransitionLink(anchor, event) || leaving) return;

        event.preventDefault();
        navigateWithTransition(anchor.href);
    });

    // 從瀏覽器快取恢復時重新播放該頁自己的進場效果。
    window.addEventListener("pageshow", (event) => {
        if (!event.persisted) return;
        playEnter();
    });
})();
