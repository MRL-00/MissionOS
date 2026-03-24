import * as THREE from "three";
import { createAgent } from "../characters/agentFactory";
import type { Accessory, AgentAppearance, AgentBackendLink, AgentRuntimeState } from "../types";

type CreatorStep = 0 | 1 | 2 | 3;
type CreatorMode = "create" | "edit";

interface CharacterCreatorOptions {
  apiBase: string;
  getExistingAgents(): AgentRuntimeState[];
}

interface DraftAgent {
  id: string;
  name: string;
  role: string;
  emoji: string;
  type: "resident" | "visitor";
  appearance: AgentAppearance;
  backendLink: AgentBackendLink;
}

interface OauthSessionResult {
  provider: "claude" | "codex";
  status: "connected";
  tokenId: string;
}

export interface CharacterCreatorApi {
  openCreate(): void;
  openEdit(agent: AgentRuntimeState): void;
}

const ACCESSORIES: Accessory[] = ["glasses", "hat", "tie", "beard"];
const OAUTH_STORAGE_KEY = "office.oauth.result";

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function createRandomAgentId(): string {
  return `office-agent-${Math.random().toString(36).slice(2, 10)}`;
}

function createDefaultDraft(): DraftAgent {
  return {
    id: "",
    name: "",
    role: "",
    emoji: "🙂",
    type: "resident",
    appearance: {
      height: 1,
      headShape: "oval",
      skinColor: "#d4a57d",
      hairStyle: "short",
      hairColor: "#2e241d",
      bodyColor: "#4b7b96",
      pantsColor: "#2c3448",
      accessories: [],
    },
    backendLink: {
      provider: "unlinked",
      connected: false,
    },
  };
}

function cloneDraft(agent?: AgentRuntimeState): DraftAgent {
  if (!agent) {
    return createDefaultDraft();
  }

  const fallback = createDefaultDraft();

  return {
    id: agent.id,
    name: agent.name,
    role: agent.role,
    emoji: agent.emoji ?? "🙂",
    type: agent.type ?? "visitor",
    appearance: {
      ...fallback.appearance,
      ...(agent.appearance ?? {}),
      accessories: [...(agent.appearance?.accessories ?? [])],
    },
    backendLink: agent.backendLink
      ? { ...agent.backendLink }
      : {
          provider: "unlinked",
          connected: false,
        },
  };
}

function captureOauthResult(): void {
  const url = new URL(window.location.href);
  const provider = url.searchParams.get("oauth_provider");
  const status = url.searchParams.get("oauth_status");
  const tokenId = url.searchParams.get("token_id");

  if ((provider === "claude" || provider === "codex") && status === "connected" && tokenId) {
    const result: OauthSessionResult = { provider, status, tokenId };
    window.sessionStorage.setItem(OAUTH_STORAGE_KEY, JSON.stringify(result));
    url.searchParams.delete("oauth_provider");
    url.searchParams.delete("oauth_status");
    url.searchParams.delete("token_id");
    window.history.replaceState({}, "", url.toString());
  }
}

function getOauthResult(provider: "claude" | "codex"): OauthSessionResult | null {
  const raw = window.sessionStorage.getItem(OAUTH_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<OauthSessionResult>;
    if (parsed.provider === provider && parsed.status === "connected" && typeof parsed.tokenId === "string") {
      return parsed as OauthSessionResult;
    }
  } catch {
    return null;
  }

  return null;
}

function buildBackendStatus(link: AgentBackendLink): string {
  if (link.provider === "unlinked") {
    return "Unlinked";
  }
  if (link.provider === "openclaw") {
    return link.connected ? `OpenClaw linked${link.agentId ? ` · ${link.agentId}` : ""}` : "OpenClaw not linked";
  }
  if (link.connected) {
    return `${link.provider === "claude" ? "Claude Code" : "Codex"} connected`;
  }
  return `${link.provider === "claude" ? "Claude Code" : "Codex"} awaiting OAuth`;
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) {
    material.forEach((entry) => entry.dispose());
    return;
  }
  material.dispose();
}

function disposeObject3D(object: THREE.Object3D): void {
  object.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }
    if ("material" in mesh && mesh.material) {
      disposeMaterial(mesh.material);
    }
  });
}

export function createCharacterCreator({ apiBase, getExistingAgents }: CharacterCreatorOptions): CharacterCreatorApi {
  captureOauthResult();

  const modal = document.createElement("div");
  modal.className = "character-creator";
  modal.hidden = true;
  modal.innerHTML = `
    <div class="character-creator-backdrop" data-action="close"></div>
    <div class="character-creator-dialog" role="dialog" aria-modal="true" aria-label="Character creator">
      <div class="character-creator-header">
        <div>
          <span class="eyebrow">Office Casting</span>
          <h2>Character Creator</h2>
        </div>
        <button class="button secondary" type="button" data-action="close">Close</button>
      </div>
      <div class="character-creator-steps">
        <button type="button" data-step="0">Identity</button>
        <button type="button" data-step="1">Appearance</button>
        <button type="button" data-step="2">Backend Link</button>
        <button type="button" data-step="3">Confirm</button>
      </div>
      <div class="character-creator-body">
        <section class="character-step" data-step-panel="0">
          <label class="creator-field">
            <span>Name</span>
            <input class="admin-input" name="name" placeholder="Pam Beesly" />
          </label>
          <label class="creator-field">
            <span>Role</span>
            <input class="admin-input" name="role" placeholder="Reception" />
          </label>
          <label class="creator-field">
            <span>Emoji</span>
            <input class="admin-input" name="emoji" placeholder="🖇️" maxlength="4" />
          </label>
          <div class="creator-field">
            <span>Type</span>
            <div class="creator-toggle-row">
              <label><input type="radio" name="agent-type" value="resident" checked /> Resident</label>
              <label><input type="radio" name="agent-type" value="visitor" /> Visitor</label>
            </div>
          </div>
        </section>
        <section class="character-step" data-step-panel="1" hidden>
          <div class="creator-layout">
            <div class="creator-fields">
              <label class="creator-field">
                <span>Height</span>
                <input type="range" min="0.8" max="1.3" step="0.01" name="height" />
                <strong class="creator-inline-value" data-value="height"></strong>
              </label>
              <div class="creator-field">
                <span>Head Shape</span>
                <div class="creator-toggle-row">
                  <label><input type="radio" name="head-shape" value="round" /> Round</label>
                  <label><input type="radio" name="head-shape" value="oval" checked /> Oval</label>
                  <label><input type="radio" name="head-shape" value="square" /> Square</label>
                </div>
              </div>
              <label class="creator-field">
                <span>Skin Color</span>
                <input type="color" name="skin-color" />
              </label>
              <label class="creator-field">
                <span>Hair Style</span>
                <select class="admin-select" name="hair-style">
                  <option value="none">None</option>
                  <option value="short">Short</option>
                  <option value="long">Long</option>
                  <option value="messy">Messy</option>
                  <option value="slicked">Slicked</option>
                  <option value="buzz">Buzz</option>
                  <option value="curly">Curly</option>
                  <option value="mohawk">Mohawk</option>
                </select>
              </label>
              <label class="creator-field">
                <span>Hair Color</span>
                <input type="color" name="hair-color" />
              </label>
              <label class="creator-field">
                <span>Shirt Color</span>
                <input type="color" name="body-color" />
              </label>
              <label class="creator-field">
                <span>Pants Color</span>
                <input type="color" name="pants-color" />
              </label>
              <div class="creator-field">
                <span>Accessories</span>
                <div class="creator-checkbox-grid">
                  <label><input type="checkbox" name="accessory" value="glasses" /> Glasses</label>
                  <label><input type="checkbox" name="accessory" value="hat" /> Hat</label>
                  <label><input type="checkbox" name="accessory" value="tie" /> Tie</label>
                  <label><input type="checkbox" name="accessory" value="beard" /> Beard</label>
                </div>
              </div>
            </div>
            <div class="creator-preview-shell">
              <div class="creator-preview" data-preview></div>
            </div>
          </div>
        </section>
        <section class="character-step" data-step-panel="2" hidden>
          <label class="creator-field">
            <span>Agent Backend</span>
            <select class="admin-select" name="backend-provider">
              <option value="openclaw">OpenClaw Agent</option>
              <option value="claude">Claude Code (OAuth)</option>
              <option value="codex">Codex (OAuth)</option>
              <option value="unlinked">Unlinked</option>
            </select>
          </label>
          <label class="creator-field" data-backend-openclaw>
            <span>OpenClaw Agent ID</span>
            <input class="admin-input" name="backend-agent-id" placeholder="agent-42" />
          </label>
          <div class="creator-field" data-backend-claude hidden>
            <span>Claude Code</span>
            <button class="button" type="button" data-action="oauth-claude">Connect with Claude</button>
          </div>
          <div class="creator-field" data-backend-codex hidden>
            <span>Codex</span>
            <button class="button" type="button" data-action="oauth-codex">Connect with Codex</button>
          </div>
          <div class="creator-status">
            <span class="creator-status-dot"></span>
            <strong data-backend-status></strong>
          </div>
        </section>
        <section class="character-step" data-step-panel="3" hidden>
          <div class="creator-layout">
            <div class="creator-summary" data-summary></div>
            <div class="creator-preview-shell">
              <div class="creator-preview" data-summary-preview></div>
            </div>
          </div>
        </section>
      </div>
      <div class="character-creator-footer">
        <div class="creator-save-status" data-save-status hidden></div>
        <button class="button secondary" type="button" data-action="back">Back</button>
        <div class="creator-footer-actions">
          <button class="button danger" type="button" data-action="remove" hidden>Remove from Office</button>
          <button class="button secondary" type="button" data-action="next">Next</button>
          <button class="button" type="button" data-action="submit" hidden>Add to Office</button>
        </div>
      </div>
    </div>
  `;
  document.body.append(modal);

  const dialog = modal.querySelector<HTMLDivElement>(".character-creator-dialog");
  const stepButtons = Array.from(modal.querySelectorAll<HTMLButtonElement>(".character-creator-steps button"));
  const stepPanels = Array.from(modal.querySelectorAll<HTMLElement>(".character-step"));
  const previewRoot = modal.querySelector<HTMLDivElement>("[data-preview]");
  const summaryPreviewRoot = modal.querySelector<HTMLDivElement>("[data-summary-preview]");
  const summary = modal.querySelector<HTMLDivElement>("[data-summary]");
  const backendStatus = modal.querySelector<HTMLElement>("[data-backend-status]");
  const removeButton = modal.querySelector<HTMLButtonElement>('[data-action="remove"]');
  const nextButton = modal.querySelector<HTMLButtonElement>('[data-action="next"]');
  const submitButton = modal.querySelector<HTMLButtonElement>('[data-action="submit"]');
  const backButton = modal.querySelector<HTMLButtonElement>('[data-action="back"]');
  const nameInput = modal.querySelector<HTMLInputElement>('input[name="name"]');
  const roleInput = modal.querySelector<HTMLInputElement>('input[name="role"]');
  const emojiInput = modal.querySelector<HTMLInputElement>('input[name="emoji"]');
  const heightInput = modal.querySelector<HTMLInputElement>('input[name="height"]');
  const heightValue = modal.querySelector<HTMLElement>('[data-value="height"]');
  const skinColorInput = modal.querySelector<HTMLInputElement>('input[name="skin-color"]');
  const hairStyleInput = modal.querySelector<HTMLSelectElement>('select[name="hair-style"]');
  const hairColorInput = modal.querySelector<HTMLInputElement>('input[name="hair-color"]');
  const bodyColorInput = modal.querySelector<HTMLInputElement>('input[name="body-color"]');
  const pantsColorInput = modal.querySelector<HTMLInputElement>('input[name="pants-color"]');
  const backendProviderInput = modal.querySelector<HTMLSelectElement>('select[name="backend-provider"]');
  const backendAgentIdInput = modal.querySelector<HTMLInputElement>('input[name="backend-agent-id"]');
  const openclawField = modal.querySelector<HTMLElement>("[data-backend-openclaw]");
  const claudeField = modal.querySelector<HTMLElement>("[data-backend-claude]");
  const codexField = modal.querySelector<HTMLElement>("[data-backend-codex]");
  const saveStatus = modal.querySelector<HTMLElement>("[data-save-status]");

  if (
    !dialog ||
    !previewRoot ||
    !summaryPreviewRoot ||
    !summary ||
    !backendStatus ||
    !removeButton ||
    !nextButton ||
    !submitButton ||
    !backButton ||
    !nameInput ||
    !roleInput ||
    !emojiInput ||
    !heightInput ||
    !heightValue ||
    !skinColorInput ||
    !hairStyleInput ||
    !hairColorInput ||
    !bodyColorInput ||
    !pantsColorInput ||
    !backendProviderInput ||
    !backendAgentIdInput ||
    !openclawField ||
    !claudeField ||
    !codexField ||
    !saveStatus
  ) {
    throw new Error("Failed to initialize character creator");
  }

  const previewRootEl = previewRoot;
  const summaryPreviewRootEl = summaryPreviewRoot;
  const summaryEl = summary;
  const backendStatusEl = backendStatus;
  const removeButtonEl = removeButton;
  const nextButtonEl = nextButton;
  const submitButtonEl = submitButton;
  const backButtonEl = backButton;
  const nameInputEl = nameInput;
  const roleInputEl = roleInput;
  const emojiInputEl = emojiInput;
  const heightInputEl = heightInput;
  const heightValueEl = heightValue;
  const skinColorInputEl = skinColorInput;
  const hairStyleInputEl = hairStyleInput;
  const hairColorInputEl = hairColorInput;
  const bodyColorInputEl = bodyColorInput;
  const pantsColorInputEl = pantsColorInput;
  const backendProviderInputEl = backendProviderInput;
  const backendAgentIdInputEl = backendAgentIdInput;
  const openclawFieldEl = openclawField;
  const claudeFieldEl = claudeField;
  const codexFieldEl = codexField;
  const saveStatusEl = saveStatus;

  const previewScene = new THREE.Scene();
  const previewCamera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  previewScene.add(new THREE.HemisphereLight("#ffe9c6", "#3f4a63", 1.7));
  const keyLight = new THREE.DirectionalLight("#fff3d9", 1.8);
  keyLight.position.set(3, 6, 5);
  previewScene.add(keyLight);
  const fillLight = new THREE.DirectionalLight("#92b8f5", 0.8);
  fillLight.position.set(-4, 4, -3);
  previewScene.add(fillLight);
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(1.9, 48),
    new THREE.MeshStandardMaterial({ color: "#141c28", transparent: true, opacity: 0.78 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.05;
  previewScene.add(floor);

  previewCamera.position.set(0, 1.85, 5);
  previewCamera.lookAt(0, 1.2, 0);

  let currentMesh: THREE.Object3D | null = null;
  let previewRenderer: THREE.WebGLRenderer | null = null;
  let currentStep: CreatorStep = 0;
  let currentMode: CreatorMode = "create";
  let currentAgentId: string | null = null;
  let draft = createDefaultDraft();
  let animationFrame = 0;
  let windowListenersBound = false;

  const onWindowResize = () => {
    resizePreview();
  };
  const onWindowKeydown = (event: KeyboardEvent) => {
    if (modal.hidden) {
      return;
    }
    if (event.key === "Escape") {
      close();
    }
  };

  function setSaveStatus(message = ""): void {
    saveStatusEl.textContent = message;
    saveStatusEl.hidden = message.length === 0;
  }

  function ensureRenderer(): THREE.WebGLRenderer {
    if (previewRenderer) {
      return previewRenderer;
    }
    previewRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    previewRenderer.outputColorSpace = THREE.SRGBColorSpace;
    previewRenderer.setSize(280, 280);
    return previewRenderer;
  }

  function bindWindowListeners(): void {
    if (windowListenersBound) {
      return;
    }
    window.addEventListener("resize", onWindowResize);
    window.addEventListener("keydown", onWindowKeydown);
    windowListenersBound = true;
  }

  function unbindWindowListeners(): void {
    if (!windowListenersBound) {
      return;
    }
    window.removeEventListener("resize", onWindowResize);
    window.removeEventListener("keydown", onWindowKeydown);
    windowListenersBound = false;
  }

  function disposeCurrentMesh(): void {
    if (!currentMesh) {
      return;
    }
    previewScene.remove(currentMesh);
    disposeObject3D(currentMesh);
    currentMesh = null;
  }

  function resizePreview(): void {
    if (!previewRenderer) {
      return;
    }
    const activeRoot = currentStep === 3 ? summaryPreviewRootEl : previewRootEl;
    const width = Math.max(activeRoot.clientWidth || 280, 220);
    const height = Math.max(activeRoot.clientHeight || 280, 220);
    previewCamera.aspect = width / height;
    previewCamera.updateProjectionMatrix();
    previewRenderer.setSize(width, height);
  }

  function animatePreview(): void {
    animationFrame = window.requestAnimationFrame(animatePreview);
    if (currentMesh) {
      currentMesh.rotation.y += 0.01;
    }
    previewRenderer?.render(previewScene, previewCamera);
  }

  function mountPreview(): void {
    const renderer = ensureRenderer();
    const root = currentStep === 3 ? summaryPreviewRootEl : previewRootEl;
    if (renderer.domElement.parentElement !== root) {
      root.append(renderer.domElement);
      resizePreview();
    }
  }

  function renderPreview(): void {
    const renderer = ensureRenderer();
    disposeCurrentMesh();

    const built = createAgent({
      id: draft.id || "preview-agent",
      name: draft.name || "Preview Agent",
      role: draft.role || "Role",
      emoji: draft.emoji || "🙂",
      appearance: draft.appearance,
    });
    currentMesh = built.mesh;
    currentMesh.position.y = 0;
    previewScene.add(currentMesh);
    mountPreview();
    renderer.render(previewScene, previewCamera);
  }

  function renderSummary(): void {
    const cards: Array<{ title: string; detail: string }> = [
      {
        title: `${draft.emoji || "🙂"} ${draft.name || "Unnamed Character"}`,
        detail: draft.role || "No role yet",
      },
      {
        title: draft.type === "resident" ? "Resident" : "Visitor",
        detail: buildBackendStatus(draft.backendLink),
      },
      {
        title: "Appearance",
        detail: `${draft.appearance.headShape} head · ${draft.appearance.hairStyle} hair · ${(draft.appearance.accessories ?? []).join(", ") || "no accessories"}`,
      },
    ];

    summaryEl.replaceChildren();
    cards.forEach(({ title, detail }) => {
      const card = document.createElement("div");
      card.className = "creator-summary-card";
      const strong = document.createElement("strong");
      strong.textContent = title;
      const span = document.createElement("span");
      span.textContent = detail;
      card.append(strong, span);
      summaryEl.append(card);
    });
  }

  function updateBackendLinkFromDraft(): void {
    if (draft.backendLink.provider === "claude" || draft.backendLink.provider === "codex") {
      const oauth = getOauthResult(draft.backendLink.provider);
      if (oauth) {
        draft.backendLink = {
          provider: oauth.provider,
          connected: true,
          tokenId: oauth.tokenId,
          connectedAt: Date.now(),
        };
      }
    }
  }

  function syncFields(): void {
    nameInputEl.value = draft.name;
    roleInputEl.value = draft.role;
    emojiInputEl.value = draft.emoji;
    const typeInput = modal.querySelector<HTMLInputElement>(`input[name="agent-type"][value="${draft.type}"]`);
    if (typeInput) {
      typeInput.checked = true;
    }
    heightInputEl.value = String(draft.appearance.height ?? 1);
    heightValueEl.textContent = `${(draft.appearance.height ?? 1).toFixed(2)}x`;
    const headShapeInput = modal.querySelector<HTMLInputElement>(`input[name="head-shape"][value="${draft.appearance.headShape}"]`);
    if (headShapeInput) {
      headShapeInput.checked = true;
    }
    skinColorInputEl.value = draft.appearance.skinColor;
    hairStyleInputEl.value = draft.appearance.hairStyle;
    hairColorInputEl.value = draft.appearance.hairColor;
    bodyColorInputEl.value = draft.appearance.bodyColor;
    pantsColorInputEl.value = draft.appearance.pantsColor;
    modal.querySelectorAll<HTMLInputElement>('input[name="accessory"]').forEach((input) => {
      input.checked = (draft.appearance.accessories ?? []).includes(input.value as Accessory);
    });
    backendProviderInputEl.value = draft.backendLink.provider;
    backendAgentIdInputEl.value = draft.backendLink.agentId ?? "";
    openclawFieldEl.hidden = draft.backendLink.provider !== "openclaw";
    claudeFieldEl.hidden = draft.backendLink.provider !== "claude";
    codexFieldEl.hidden = draft.backendLink.provider !== "codex";
    backendStatusEl.textContent = buildBackendStatus(draft.backendLink);
    const connected = draft.backendLink.connected;
    backendStatusEl.parentElement?.setAttribute("data-connected", connected ? "true" : "false");
    renderSummary();
    renderPreview();
  }

  function syncSteps(): void {
    stepButtons.forEach((button, index) => {
      button.dataset.active = index === currentStep ? "true" : "false";
    });
    stepPanels.forEach((panel, index) => {
      panel.hidden = index !== currentStep;
    });
    backButtonEl.disabled = currentStep === 0;
    nextButtonEl.hidden = currentStep === 3;
    submitButtonEl.hidden = currentStep !== 3;
    submitButtonEl.textContent = currentMode === "edit" ? "Save Changes" : "Add to Office";
    removeButtonEl.hidden = currentMode !== "edit";
    mountPreview();
  }

  function makeAgentId(): string {
    const base = slugify(draft.name) || createRandomAgentId();
    const existingIds = new Set(getExistingAgents().map((agent) => agent.id));
    if (currentMode === "edit" && currentAgentId) {
      existingIds.delete(currentAgentId);
    }
    if (!existingIds.has(base)) {
      return base;
    }

    let index = 2;
    while (existingIds.has(`${base}-${index}`)) {
      index += 1;
    }
    return `${base}-${index}`;
  }

  function open(mode: CreatorMode, agent?: AgentRuntimeState): void {
    currentMode = mode;
    currentAgentId = agent?.id ?? null;
    currentStep = 0;
    draft = cloneDraft(agent);
    updateBackendLinkFromDraft();
    setSaveStatus();
    modal.hidden = false;
    bindWindowListeners();
    ensureRenderer();
    syncFields();
    syncSteps();
    resizePreview();

    if (!animationFrame) {
      animatePreview();
    }
  }

  function close(): void {
    modal.hidden = true;
    if (animationFrame) {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }
    unbindWindowListeners();
    disposeCurrentMesh();
    previewRenderer?.dispose();
    previewRenderer?.domElement.remove();
    previewRenderer = null;
    setSaveStatus();
  }

  function setBackendProvider(provider: AgentBackendLink["provider"]): void {
    if (provider === "unlinked") {
      draft.backendLink = { provider, connected: false };
    } else if (provider === "openclaw") {
      draft.backendLink = {
        provider,
        agentId: backendAgentIdInputEl.value.trim() || draft.backendLink.agentId,
        connected: Boolean((backendAgentIdInputEl.value.trim() || draft.backendLink.agentId)?.trim()),
      };
    } else {
      const oauth = getOauthResult(provider);
      draft.backendLink = {
        provider,
        connected: Boolean(oauth),
        tokenId: oauth?.tokenId,
        connectedAt: oauth ? Date.now() : undefined,
      };
    }
    syncFields();
  }

  async function save(): Promise<void> {
    draft.name = nameInputEl.value.trim();
    draft.role = roleInputEl.value.trim();
    draft.emoji = emojiInputEl.value.trim() || "🙂";

    if (!draft.name || !draft.role) {
      setSaveStatus("Name and role are required.");
      currentStep = 0;
      syncSteps();
      return;
    }

    draft.id = currentMode === "edit" && currentAgentId ? currentAgentId : makeAgentId();

    const path = currentMode === "edit" ? `${apiBase}/api/agents/${encodeURIComponent(draft.id)}` : `${apiBase}/api/agents/register`;
    const method = currentMode === "edit" ? "PUT" : "POST";
    const response = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });

    if (!response.ok) {
      throw new Error(`Character save failed with ${response.status}`);
    }

    close();
  }

  async function remove(): Promise<void> {
    if (!currentAgentId) {
      return;
    }
    if (!window.confirm("Remove this character from the office?")) {
      return;
    }

    const response = await fetch(`${apiBase}/api/agents/${encodeURIComponent(currentAgentId)}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      throw new Error(`Character removal failed with ${response.status}`);
    }
    close();
  }

  modal.querySelectorAll<HTMLElement>("[data-action='close']").forEach((element) => {
    element.addEventListener("click", close);
  });

  stepButtons.forEach((button) => {
    button.addEventListener("click", () => {
      currentStep = Number(button.dataset.step ?? 0) as CreatorStep;
      syncSteps();
    });
  });

  backButtonEl.addEventListener("click", () => {
    currentStep = Math.max(0, currentStep - 1) as CreatorStep;
    syncSteps();
  });

  nextButtonEl.addEventListener("click", () => {
    currentStep = Math.min(3, currentStep + 1) as CreatorStep;
    syncSteps();
  });

  submitButtonEl.addEventListener("click", () => {
    setSaveStatus();
    void save().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Character save failed";
      setSaveStatus(message);
    });
  });

  removeButtonEl.addEventListener("click", () => {
    setSaveStatus();
    void remove().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Character removal failed";
      setSaveStatus(message);
    });
  });

  nameInputEl.addEventListener("input", () => {
    draft.name = nameInputEl.value;
    syncFields();
  });
  roleInputEl.addEventListener("input", () => {
    draft.role = roleInputEl.value;
    syncFields();
  });
  emojiInputEl.addEventListener("input", () => {
    draft.emoji = emojiInputEl.value;
    syncFields();
  });
  modal.querySelectorAll<HTMLInputElement>('input[name="agent-type"]').forEach((input) => {
    input.addEventListener("change", () => {
      draft.type = input.value === "visitor" ? "visitor" : "resident";
      syncFields();
    });
  });
  heightInputEl.addEventListener("input", () => {
    draft.appearance.height = Number(heightInputEl.value);
    syncFields();
  });
  modal.querySelectorAll<HTMLInputElement>('input[name="head-shape"]').forEach((input) => {
    input.addEventListener("change", () => {
      draft.appearance.headShape = input.value as AgentAppearance["headShape"];
      syncFields();
    });
  });
  skinColorInputEl.addEventListener("input", () => {
    draft.appearance.skinColor = skinColorInputEl.value;
    syncFields();
  });
  hairStyleInputEl.addEventListener("change", () => {
    draft.appearance.hairStyle = hairStyleInputEl.value as AgentAppearance["hairStyle"];
    syncFields();
  });
  hairColorInputEl.addEventListener("input", () => {
    draft.appearance.hairColor = hairColorInputEl.value;
    syncFields();
  });
  bodyColorInputEl.addEventListener("input", () => {
    draft.appearance.bodyColor = bodyColorInputEl.value;
    syncFields();
  });
  pantsColorInputEl.addEventListener("input", () => {
    draft.appearance.pantsColor = pantsColorInputEl.value;
    syncFields();
  });
  modal.querySelectorAll<HTMLInputElement>('input[name="accessory"]').forEach((input) => {
    input.addEventListener("change", () => {
      const accessories = new Set(draft.appearance.accessories ?? []);
      if (input.checked) {
        accessories.add(input.value as Accessory);
      } else {
        accessories.delete(input.value as Accessory);
      }
      draft.appearance.accessories = ACCESSORIES.filter((accessory) => accessories.has(accessory));
      syncFields();
    });
  });
  backendProviderInputEl.addEventListener("change", () => {
    setBackendProvider(backendProviderInputEl.value as AgentBackendLink["provider"]);
  });
  backendAgentIdInputEl.addEventListener("input", () => {
    if (draft.backendLink.provider === "openclaw") {
      draft.backendLink = {
        provider: "openclaw",
        agentId: backendAgentIdInputEl.value.trim(),
        connected: Boolean(backendAgentIdInputEl.value.trim()),
      };
      syncFields();
    }
  });
  modal.querySelector<HTMLButtonElement>('[data-action="oauth-claude"]')?.addEventListener("click", () => {
    window.location.href = `${apiBase}/auth/claude/authorize?redirect=${encodeURIComponent(window.location.origin + window.location.pathname)}`;
  });
  modal.querySelector<HTMLButtonElement>('[data-action="oauth-codex"]')?.addEventListener("click", () => {
    window.location.href = `${apiBase}/auth/codex/authorize?redirect=${encodeURIComponent(window.location.origin + window.location.pathname)}`;
  });

  return {
    openCreate() {
      open("create");
    },
    openEdit(agent) {
      open("edit", agent);
    },
  };
}
