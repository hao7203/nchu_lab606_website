(() => {
    const intro = document.getElementById("intro-screen");
    if (!intro) return;

    let leaving = false;
    let touchStartY = null;

    function finishImmediately() {
        intro.style.display = "none";
        intro.setAttribute("aria-hidden", "true");
        document.body.classList.remove("intro-active");
    }

    function enterSite() {
        if (leaving || intro.style.display === "none") return;
        leaving = true;
        sessionStorage.setItem("introPlayed", "true");
        intro.classList.add("intro-leaving");
        intro.style.pointerEvents = "none";
        document.body.classList.remove("intro-active");

        window.setTimeout(() => {
            finishImmediately();
            const target = document.getElementById("home-section");
            if (target) {
                target.scrollIntoView({ behavior: "smooth", block: "start" });
            }
        }, 650);
    }

    window.enterSite = enterSite;
    window.skipIntro = () => sessionStorage.setItem("introPlayed", "true");
    window.handleScroll = (event) => {
        if (event.deltaY > 0) {
            event.preventDefault?.();
            enterSite();
        }
    };

    if (sessionStorage.getItem("introPlayed") === "true") {
        finishImmediately();
        return;
    }

    document.body.classList.add("intro-active");
    intro.focus({ preventScroll: true });

    intro.addEventListener("wheel", (event) => {
        if (event.deltaY > 0) {
            event.preventDefault();
            enterSite();
        }
    }, { passive: false });

    intro.addEventListener("touchstart", (event) => {
        touchStartY = event.touches[0]?.clientY ?? null;
    }, { passive: true });

    intro.addEventListener("touchend", (event) => {
        const endY = event.changedTouches[0]?.clientY ?? null;
        if (touchStartY !== null && endY !== null && touchStartY - endY > 30) {
            enterSite();
        }
        touchStartY = null;
    }, { passive: true });

    intro.addEventListener("keydown", (event) => {
        if (["Enter", " ", "ArrowDown", "PageDown"].includes(event.key)) {
            event.preventDefault();
            enterSite();
        }
    });

    document.getElementById("enter-site-btn")?.addEventListener("click", enterSite);

    document.querySelectorAll(".research-topics a").forEach((link) => {
        link.addEventListener("click", () => {
            sessionStorage.setItem("introPlayed", "true");
        });
    });
})();
