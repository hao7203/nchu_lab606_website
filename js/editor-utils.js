export function createEditorDialog({ id, title, fields, submitText = "儲存" }) {
    let dialog = document.getElementById(id);
    if (dialog) {
        return dialog;
    }

    dialog = document.createElement("dialog");
    dialog.id = id;
    dialog.className = "editor-dialog";

    const form = document.createElement("form");
    form.className = "dialog-inner";

    const heading = document.createElement("h3");
    heading.textContent = title;
    form.appendChild(heading);

    fields.forEach((field) => {
        const wrapper = document.createElement("div");
        wrapper.className = "editor-field";

        const label = document.createElement("label");
        label.htmlFor = `${id}-${field.name}`;
        label.textContent = field.label;

        let input;
        if (field.type === "textarea") {
            input = document.createElement("textarea");
            input.rows = field.rows || 5;
        } else {
            input = document.createElement("input");
            input.type = field.type || "text";
        }

        input.id = `${id}-${field.name}`;
        input.name = field.name;
        input.required = Boolean(field.required);
        input.maxLength = field.maxLength || 10000;
        input.placeholder = field.placeholder || "";

        wrapper.append(label, input);
        form.appendChild(wrapper);
    });

    const status = document.createElement("div");
    status.className = "dialog-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");

    const actions = document.createElement("div");
    actions.className = "dialog-actions";

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "cancel-btn";
    cancelButton.textContent = "取消";
    cancelButton.addEventListener("click", () => dialog.close());

    const saveButton = document.createElement("button");
    saveButton.type = "submit";
    saveButton.className = "save-btn";
    saveButton.textContent = submitText;

    actions.append(cancelButton, saveButton);
    form.append(status, actions);
    dialog.appendChild(form);
    document.body.appendChild(dialog);

    dialog.editorForm = form;
    dialog.statusElement = status;
    dialog.saveButton = saveButton;
    return dialog;
}

export function fillDialog(dialog, values = {}) {
    Object.entries(values).forEach(([name, value]) => {
        const input = dialog.editorForm.elements.namedItem(name);
        if (input) {
            input.value = value ?? "";
        }
    });

    dialog.statusElement.textContent = "";
    dialog.statusElement.style.color = "";

    if (typeof dialog.showModal === "function") {
        dialog.showModal();
    } else {
        dialog.setAttribute("open", "");
    }
}

export function setDialogBusy(dialog, busy, message = "") {
    dialog.saveButton.disabled = busy;
    dialog.statusElement.textContent = message;
    dialog.statusElement.style.color = busy ? "#b36b00" : "";
}

export function setDialogError(dialog, message) {
    dialog.statusElement.textContent = message;
    dialog.statusElement.style.color = "#b00020";
}

export function showToast(message, type = "info", duration = 2600) {
    let toast = document.getElementById("site-toast");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "site-toast";
        toast.className = "site-toast";
        toast.setAttribute("role", "status");
        toast.setAttribute("aria-live", "polite");
        document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.className = `site-toast ${type}`;
    requestAnimationFrame(() => toast.classList.add("show"));

    window.clearTimeout(showToast.timerId);
    showToast.timerId = window.setTimeout(() => {
        toast.classList.remove("show");
    }, duration);
}

export function linesToArray(value) {
    return String(value ?? "")
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean);
}

export function arrayToLines(value) {
    return Array.isArray(value) ? value.join("\n") : "";
}

export function isAllowedLocalImagePath(value) {
    const path = String(value ?? "").trim();
    return /^(?!https?:|\/\/|data:|javascript:)[A-Za-z0-9_./ ()-]+\.(jpg|jpeg|png|webp)$/i.test(path);
}

export function createItemActionButton(text, action, className = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `item-action-btn ${className}`.trim();
    button.textContent = text;
    button.dataset.action = action;
    return button;
}

export function createStableId(prefix = "item") {
    if (globalThis.crypto?.randomUUID) {
        return globalThis.crypto.randomUUID();
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
