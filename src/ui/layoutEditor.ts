import * as THREE from "three";
import type { LayoutCatalogItem, LayoutItemSummary, LayoutSelectionState } from "../types";

export type LayoutTransformMode = "translate" | "rotate";

interface LayoutEditorOptions {
  getExportText(): string;
  onEnabledChange(enabled: boolean): void;
  onSelectItem(id: string | null): void;
  onSetMode(mode: LayoutTransformMode): void;
  onUpdateSelectionTransform(
    patch: Partial<{
      position: [number, number, number];
      rotationY: number;
      scale: [number, number, number];
    }>,
  ): void;
  onAddItem(templateId: string): void;
  onDeleteSelected(): void;
  onResetLayout(): void;
}

interface LayoutEditorState {
  enabled: boolean;
  mode: LayoutTransformMode;
  items: LayoutItemSummary[];
  selection: LayoutSelectionState | null;
  catalog: LayoutCatalogItem[];
}

interface LayoutInputRefs {
  posX: HTMLInputElement;
  posY: HTMLInputElement;
  posZ: HTMLInputElement;
  rotY: HTMLInputElement;
  scaleX: HTMLInputElement;
  scaleY: HTMLInputElement;
  scaleZ: HTMLInputElement;
}

export interface LayoutEditorApi {
  sync(state: LayoutEditorState): void;
  setNotice(message: string): void;
}

function toFixed(value: number, digits = 2): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "0.00";
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    const succeeded = document.execCommand("copy");
    textarea.remove();
    return succeeded;
  }
}

export function createLayoutEditor(options: LayoutEditorOptions): LayoutEditorApi {
  const shell = document.createElement("div");
  shell.className = "layout-shell";

  const launcher = document.createElement("button");
  launcher.className = "layout-launcher";
  launcher.type = "button";
  launcher.textContent = "Layout";
  shell.append(launcher);

  const panel = document.createElement("aside");
  panel.className = "layout-panel";
  panel.hidden = true;
  panel.innerHTML = `
    <div class="layout-header">
      <div>
        <span class="eyebrow">Scene Setup</span>
        <h2>Layout Editor</h2>
      </div>
      <button class="button secondary" type="button" data-action="close">Close</button>
    </div>
    <p class="layout-copy">Click office objects in the scene, drag them with the gizmo, or edit exact values here. Changes persist in this browser and can be copied back into <code>src/config/office-layout.json</code>.</p>
    <div class="layout-section">
      <div class="layout-mode-row">
        <button class="mini-button" type="button" data-mode="translate">Move</button>
        <button class="mini-button" type="button" data-mode="rotate">Rotate</button>
      </div>
    </div>
    <div class="layout-section">
      <h3>Add Item</h3>
      <div class="layout-add-row">
        <select class="admin-select" name="layout-template"></select>
        <button class="button" type="button" data-action="add">Add</button>
      </div>
    </div>
    <div class="layout-section">
      <h3>Selected Item</h3>
      <div class="layout-selection-empty">Select an office item to edit it.</div>
      <div class="layout-selection" hidden>
        <div class="layout-selection-head">
          <strong class="layout-selection-label"></strong>
          <span class="layout-selection-kind"></span>
        </div>
        <div class="layout-field-grid">
          <label><span>X</span><input class="admin-input" name="pos-x" type="number" step="0.1" /></label>
          <label><span>Y</span><input class="admin-input" name="pos-y" type="number" step="0.1" /></label>
          <label><span>Z</span><input class="admin-input" name="pos-z" type="number" step="0.1" /></label>
          <label><span>Rotate Y</span><input class="admin-input" name="rot-y" type="number" step="1" /></label>
          <label><span>Scale X</span><input class="admin-input" name="scale-x" type="number" step="0.05" /></label>
          <label><span>Scale Y</span><input class="admin-input" name="scale-y" type="number" step="0.05" /></label>
          <label><span>Scale Z</span><input class="admin-input" name="scale-z" type="number" step="0.05" /></label>
        </div>
        <button class="button secondary layout-delete" type="button" data-action="delete">Delete Selected</button>
      </div>
    </div>
    <div class="layout-section">
      <h3>Office Items</h3>
      <div class="layout-item-list"></div>
    </div>
    <div class="layout-section">
      <div class="layout-actions">
        <button class="button secondary" type="button" data-action="copy">Copy Layout JSON</button>
        <button class="button secondary" type="button" data-action="reset">Reset to Default</button>
      </div>
      <div class="layout-notice"></div>
    </div>
  `;
  shell.append(panel);
  document.body.append(shell);

  const closeButton = panel.querySelector<HTMLButtonElement>('[data-action="close"]');
  const templateSelect = panel.querySelector<HTMLSelectElement>('select[name="layout-template"]');
  const addButton = panel.querySelector<HTMLButtonElement>('[data-action="add"]');
  const moveButton = panel.querySelector<HTMLButtonElement>('[data-mode="translate"]');
  const rotateButton = panel.querySelector<HTMLButtonElement>('[data-mode="rotate"]');
  const selectionEmpty = panel.querySelector<HTMLDivElement>(".layout-selection-empty");
  const selectionRoot = panel.querySelector<HTMLDivElement>(".layout-selection");
  const selectionLabel = panel.querySelector<HTMLSpanElement>(".layout-selection-label");
  const selectionKind = panel.querySelector<HTMLSpanElement>(".layout-selection-kind");
  const deleteButton = panel.querySelector<HTMLButtonElement>('[data-action="delete"]');
  const itemList = panel.querySelector<HTMLDivElement>(".layout-item-list");
  const copyButton = panel.querySelector<HTMLButtonElement>('[data-action="copy"]');
  const resetButton = panel.querySelector<HTMLButtonElement>('[data-action="reset"]');
  const notice = panel.querySelector<HTMLDivElement>(".layout-notice");

  const inputs: LayoutInputRefs = {
    posX: panel.querySelector<HTMLInputElement>('input[name="pos-x"]')!,
    posY: panel.querySelector<HTMLInputElement>('input[name="pos-y"]')!,
    posZ: panel.querySelector<HTMLInputElement>('input[name="pos-z"]')!,
    rotY: panel.querySelector<HTMLInputElement>('input[name="rot-y"]')!,
    scaleX: panel.querySelector<HTMLInputElement>('input[name="scale-x"]')!,
    scaleY: panel.querySelector<HTMLInputElement>('input[name="scale-y"]')!,
    scaleZ: panel.querySelector<HTMLInputElement>('input[name="scale-z"]')!,
  };

  let state: LayoutEditorState = {
    enabled: false,
    mode: "translate",
    items: [],
    selection: null,
    catalog: [],
  };

  function setEnabled(enabled: boolean): void {
    state = { ...state, enabled };
    panel.hidden = !enabled;
    launcher.dataset.active = enabled ? "true" : "false";
    options.onEnabledChange(enabled);
  }

  function render(): void {
    if (templateSelect) {
      templateSelect.replaceChildren(
        ...state.catalog.map((entry) => {
          const option = document.createElement("option");
          option.value = entry.templateId;
          option.textContent = entry.label;
          return option;
        }),
      );
    }

    moveButton?.classList.toggle("active", state.mode === "translate");
    rotateButton?.classList.toggle("active", state.mode === "rotate");

    if (selectionEmpty && selectionRoot && selectionLabel && selectionKind && deleteButton) {
      const selected = state.selection;
      selectionEmpty.hidden = !!selected;
      selectionRoot.hidden = !selected;

      if (selected) {
        selectionLabel.textContent = selected.label;
        selectionKind.textContent = selected.kind;
        inputs.posX.value = toFixed(selected.position[0]);
        inputs.posY.value = toFixed(selected.position[1]);
        inputs.posZ.value = toFixed(selected.position[2]);
        inputs.rotY.value = toFixed(THREE.MathUtils.radToDeg(selected.rotationY), 1);
        inputs.scaleX.value = toFixed(selected.scale[0]);
        inputs.scaleY.value = toFixed(selected.scale[1]);
        inputs.scaleZ.value = toFixed(selected.scale[2]);
        deleteButton.disabled = !selected.removable;
      }
    }

    if (itemList) {
      itemList.replaceChildren(
        ...state.items.map((item) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "layout-item-row";
          button.dataset.selected = state.selection?.id === item.id ? "true" : "false";
          button.innerHTML = `<strong>${item.label}</strong><span>${item.kind}</span>`;
          button.addEventListener("click", () => {
            options.onSelectItem(item.id);
          });
          return button;
        }),
      );
    }
  }

  launcher.addEventListener("click", () => setEnabled(!state.enabled));
  closeButton?.addEventListener("click", () => setEnabled(false));
  moveButton?.addEventListener("click", () => options.onSetMode("translate"));
  rotateButton?.addEventListener("click", () => options.onSetMode("rotate"));
  addButton?.addEventListener("click", () => {
    if (!templateSelect?.value) {
      return;
    }
    options.onAddItem(templateSelect.value);
  });
  deleteButton?.addEventListener("click", () => options.onDeleteSelected());
  copyButton?.addEventListener("click", async () => {
    const copied = await copyText(options.getExportText());
    if (notice) {
      notice.textContent = copied ? "Layout JSON copied to clipboard." : "Copy failed. Browser clipboard access was blocked.";
    }
  });
  resetButton?.addEventListener("click", () => {
    options.onResetLayout();
    if (notice) {
      notice.textContent = "Layout reset to the default manifest.";
    }
  });

  [
    inputs.posX,
    inputs.posY,
    inputs.posZ,
    inputs.rotY,
    inputs.scaleX,
    inputs.scaleY,
    inputs.scaleZ,
  ].forEach((input) => {
    input.addEventListener("change", () => {
      if (!state.selection) {
        return;
      }

      options.onUpdateSelectionTransform({
        position: [
          Number(inputs.posX.value),
          Number(inputs.posY.value),
          Number(inputs.posZ.value),
        ],
        rotationY: THREE.MathUtils.degToRad(Number(inputs.rotY.value)),
        scale: [
          Math.max(0.05, Number(inputs.scaleX.value)),
          Math.max(0.05, Number(inputs.scaleY.value)),
          Math.max(0.05, Number(inputs.scaleZ.value)),
        ],
      });
    });
  });

  window.addEventListener("keydown", (event) => {
    if (event.repeat) {
      return;
    }

    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
      return;
    }

    if (event.key.toLowerCase() === "l") {
      setEnabled(!state.enabled);
    }
  });

  return {
    sync(nextState) {
      state = nextState;
      panel.hidden = !state.enabled;
      launcher.dataset.active = state.enabled ? "true" : "false";
      render();
    },
    setNotice(message) {
      if (notice) {
        notice.textContent = message;
      }
    },
  };
}
