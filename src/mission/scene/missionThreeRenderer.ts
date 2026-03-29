import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { buildAgentConfig, createDeterministicAppearance, getDefaultAgentConfig } from "../../agentDefaults";
import { AgentController, STATUS } from "../../characters/agentController";
import { FishController } from "../../characters/fishController";
import { makeMaterial } from "../../scene/materials";
import type { AgentAppearance, AgentConfig, AgentRuntimeState, AgentSnapshotState, AgentStatus } from "../../types";
import { buildPlacements, type AgentPlacement } from "./missionMapModel";

type CharacterController = AgentController | FishController;

interface MissionThreeRendererOptions {
  parent: HTMLElement;
  onSelectAgent(agentId: string): void;
}

const ASSET_BASE = "/assets/kenney/retro-urban-kit";
const KIT_SCALE = 2;
const MAX_RENDER_PIXEL_RATIO = 1.5;
const CAMERA_TARGET = new THREE.Vector3(0, 2.4, -2.8);
const CAMERA_POSITION = new THREE.Vector3(0, 20, 29);
const CHARACTER_SCALE = 0.95;
const GROUND_LEVEL = 0;
const STREET_Y = 0.03;
const STREET_WIDTH = 10;
const STREET_DEPTH = 32;
const WORLD_WIDTH = 32;
const WORLD_DEPTH = 40;
const MODEL_URLS = {
  bench: `${ASSET_BASE}/detail-bench.glb`,
  lamp: `${ASSET_BASE}/detail-light-double.glb`,
  shrub: `${ASSET_BASE}/tree-shrub.glb`,
  treePark: `${ASSET_BASE}/tree-park-large.glb`,
} as const;
const TEXTURE_URLS = {
  asphalt: `${ASSET_BASE}/Textures/asphalt.png`,
  concrete: `${ASSET_BASE}/Textures/concrete.png`,
  grass: `${ASSET_BASE}/Textures/grass.png`,
  tiles: `${ASSET_BASE}/Textures/tiles.png`,
} as const;

const gltfLoader = new GLTFLoader();
const textureLoader = new THREE.TextureLoader();
const modelCache = new Map<string, Promise<THREE.Group>>();
const textureCache = new Map<string, Promise<THREE.Texture>>();

function controllerStatus(status: AgentRuntimeState["status"]): AgentStatus {
  if (status === "meeting") {
    return STATUS.meeting;
  }
  if (status === "working") {
    return STATUS.working;
  }
  return STATUS.idle;
}

function resolveAppearance(agentId: string, appearance?: AgentAppearance): AgentAppearance {
  return appearance ?? getDefaultAgentConfig(agentId)?.appearance ?? createDeterministicAppearance(agentId);
}

function buildRuntimeConfig(state: Pick<AgentRuntimeState, "id" | "name" | "role" | "emoji">, appearance?: AgentAppearance): AgentConfig {
  return buildAgentConfig({
    id: state.id,
    name: state.name,
    role: state.role,
    emoji: state.emoji,
    appearance: resolveAppearance(state.id, appearance),
  });
}

function buildLabelTexture(label: string, accent: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 96;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D context unavailable for scene label generation.");
  }

  context.imageSmoothingEnabled = false;
  context.fillStyle = "#132019";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = accent;
  context.fillRect(10, 10, canvas.width - 20, canvas.height - 20);
  context.fillStyle = "#e9f4dc";
  context.fillRect(20, 20, canvas.width - 40, canvas.height - 40);
  context.fillStyle = "#1d3325";
  context.font = "700 30px 'IBM Plex Sans', sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, canvas.width / 2, canvas.height / 2 + 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createSign(label: string, accent: string): THREE.Group {
  const group = new THREE.Group();
  const postMaterial = makeMaterial("#4b3827");
  const frameMaterial = makeMaterial("#3b5a3f");
  const texture = buildLabelTexture(label, accent);

  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 1),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true }),
  );
  sign.position.set(0, 1.6, 0.02);
  group.add(sign);

  const frame = new THREE.Mesh(new THREE.BoxGeometry(2.82, 1.18, 0.14), frameMaterial);
  frame.position.set(0, 1.6, -0.08);
  group.add(frame);

  const leftPost = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.2, 0.12), postMaterial);
  leftPost.position.set(-1.08, 0.6, -0.08);
  group.add(leftPost);

  const rightPost = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.2, 0.12), postMaterial);
  rightPost.position.set(1.08, 0.6, -0.08);
  group.add(rightPost);

  return group;
}

function createBannerLine(width: number): THREE.Group {
  const group = new THREE.Group();
  const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, width, 8), makeMaterial("#6d5d4e"));
  rope.rotation.z = Math.PI / 2;
  group.add(rope);

  const colors = ["#eb7e70", "#f7d16b", "#7ed7b5", "#74a7ff", "#d78ad7"];
  for (let index = 0; index < 14; index += 1) {
    const color = colors[index % colors.length] ?? "#eb7e70";
    const triangle = new THREE.Mesh(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(-0.25, -0.55, 0),
        new THREE.Vector3(0.25, -0.55, 0),
      ]),
      makeMaterial(color),
    );
    triangle.geometry.setIndex([0, 1, 2]);
    triangle.geometry.computeVertexNormals();
    triangle.position.x = -width / 2 + 0.7 + index * 0.9;
    triangle.position.y = -0.14 - ((index + 1) % 2) * 0.04;
    group.add(triangle);
  }

  return group;
}

function createPond(): THREE.Group {
  const group = new THREE.Group();
  const edgeMaterial = makeMaterial("#c8d8c8");
  const grassMaterial = makeMaterial("#77b85d");
  const waterMaterial = new THREE.MeshPhysicalMaterial({
    color: "#7ac2ff",
    roughness: 0.18,
    metalness: 0,
    transparent: true,
    opacity: 0.92,
    transmission: 0.18,
  });

  const grassBed = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.8, 5.6), grassMaterial);
  grassBed.position.set(0, 0.4, 0);
  group.add(grassBed);

  const pondCut = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.2, 4.2), waterMaterial);
  pondCut.position.set(-0.3, 0.34, 0);
  group.add(pondCut);

  const rim = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.45, 4.6), edgeMaterial);
  rim.position.set(-0.3, 0.3, 0);
  rim.material = edgeMaterial;
  rim.renderOrder = 1;
  rim.geometry = new THREE.BoxGeometry(5.2, 0.45, 4.6);
  group.add(rim);

  const rimInset = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.5, 4), waterMaterial);
  rimInset.position.set(-0.3, 0.32, 0);
  group.add(rimInset);

  const hedge = new THREE.Mesh(new THREE.BoxGeometry(6.5, 1.1, 0.9), makeMaterial("#5ca851"));
  hedge.position.set(0, 1.0, -2.5);
  group.add(hedge);

  const hedgeSide = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 5.4), makeMaterial("#5ca851"));
  hedgeSide.position.set(3.05, 1.0, 0);
  group.add(hedgeSide);

  return group;
}

function applyShadowFlags(object: THREE.Object3D): void {
  object.traverse((entry) => {
    const mesh = entry as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
}

function convertMaterial(material: THREE.Material): THREE.Material {
  if (!(material instanceof THREE.MeshBasicMaterial || material instanceof THREE.MeshStandardMaterial)) {
    return material;
  }

  const map = "map" in material ? material.map : null;
  if (map) {
    map.colorSpace = THREE.SRGBColorSpace;
    map.magFilter = THREE.NearestFilter;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.generateMipmaps = true;
    map.needsUpdate = true;
  }

  return new THREE.MeshStandardMaterial({
    name: material.name,
    color: "color" in material ? material.color.clone() : new THREE.Color("#ffffff"),
    map,
    transparent: material.transparent,
    opacity: material.opacity,
    alphaTest: material.transparent ? 0.22 : material.alphaTest,
    side: material.side,
    roughness: 0.9,
    metalness: material.name.includes("metal") ? 0.18 : 0.04,
  });
}

async function loadTexture(url: string): Promise<THREE.Texture> {
  let cached = textureCache.get(url);
  if (!cached) {
    cached = textureLoader.loadAsync(url).then((texture) => {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.needsUpdate = true;
      return texture;
    });
    textureCache.set(url, cached);
  }

  return cached;
}

async function loadModel(url: string): Promise<THREE.Group> {
  let cached = modelCache.get(url);
  if (!cached) {
    cached = gltfLoader.loadAsync(url).then((gltf) => {
      const source = gltf.scene;
      source.traverse((entry) => {
        const mesh = entry as THREE.Mesh;
        if (!mesh.isMesh) {
          return;
        }

        mesh.material = Array.isArray(mesh.material)
          ? mesh.material.map((material) => convertMaterial(material))
          : convertMaterial(mesh.material);
      });
      applyShadowFlags(source);
      return source;
    });
    modelCache.set(url, cached);
  }

  return (await cached).clone(true);
}

function createGroundPlane(width: number, depth: number, texture: THREE.Texture, repeatX: number, repeatY: number, y: number, color = "#ffffff"): THREE.Mesh {
  const planeTexture = texture.clone();
  planeTexture.repeat.set(repeatX, repeatY);
  planeTexture.needsUpdate = true;
  const material = new THREE.MeshStandardMaterial({
    color,
    map: planeTexture,
    roughness: 0.98,
    metalness: 0.02,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  mesh.receiveShadow = true;
  return mesh;
}

function createPlanter(width: number, depth: number, color = "#76b35d"): THREE.Group {
  const group = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(width, 0.5, depth), makeMaterial("#b9c5b5"));
  base.position.y = 0.25;
  group.add(base);

  const fill = new THREE.Mesh(new THREE.BoxGeometry(width - 0.18, 0.44, depth - 0.18), makeMaterial(color));
  fill.position.y = 0.5;
  group.add(fill);

  return group;
}

function createStreetRails(width: number): THREE.Group {
  const group = new THREE.Group();
  const railMaterial = makeMaterial("#b4b0a4");
  const shadowMaterial = makeMaterial("#8e8c84");

  const topRail = new THREE.Mesh(new THREE.BoxGeometry(width, 0.24, 0.44), railMaterial);
  topRail.position.set(0, 1.1, 0);
  group.add(topRail);

  const bottomRail = new THREE.Mesh(new THREE.BoxGeometry(width, 0.42, 0.56), shadowMaterial);
  bottomRail.position.set(0, 0.45, -0.12);
  group.add(bottomRail);

  return group;
}

function createZoneCourt(
  width: number,
  depth: number,
  texture: THREE.Texture,
  repeatX: number,
  repeatY: number,
  frameColor: string,
  topColor: string,
): THREE.Group {
  const group = new THREE.Group();

  const frame = new THREE.Mesh(new THREE.BoxGeometry(width, 0.38, depth), makeMaterial(frameColor));
  frame.position.y = 0.19;
  frame.receiveShadow = true;
  group.add(frame);

  const top = createGroundPlane(width - 0.36, depth - 0.36, texture, repeatX, repeatY, 0.39, topColor);
  group.add(top);

  const trim = new THREE.Mesh(new THREE.BoxGeometry(width - 0.12, 0.12, depth - 0.12), makeMaterial("#f3f4ec"));
  trim.position.y = 0.34;
  group.add(trim);

  return group;
}

function createHedgeStrip(width: number, depth: number, color = "#6eb95d"): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, 0.9, depth), makeMaterial(color));
  mesh.position.y = 0.45;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function placementToWorld(placement: AgentPlacement): { position: THREE.Vector3; facing: number } {
  if (placement.agent.id === "charlie") {
    return {
      position: new THREE.Vector3(-8.9, 0.12, 1.4),
      facing: Math.PI / 2,
    };
  }

  const x = (placement.point.x - 160) / 12.8;
  const z = (placement.point.y - 112) / 7.6;

  let facing = 0;
  if (placement.point.zone.includes("Front")) {
    facing = Math.PI;
  } else if (placement.point.zone.includes("CIO") || placement.point.zone.includes("Advisor") || placement.point.zone.includes("Support")) {
    facing = -Math.PI / 2;
  } else if (placement.point.zone.includes("Pond")) {
    facing = Math.PI / 2;
  } else if (placement.point.zone.includes("Meeting")) {
    facing = 0;
  } else if (x < -3) {
    facing = Math.PI / 2;
  } else if (x > 3) {
    facing = -Math.PI / 2;
  }
  return {
    position: new THREE.Vector3(x, GROUND_LEVEL, z),
    facing,
  };
}

export class MissionThreeRenderer {
  readonly ready: Promise<void>;

  private readonly parent: HTMLElement;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly clock: THREE.Clock;
  private readonly resizeObserver: ResizeObserver;
  private readonly raycaster: THREE.Raycaster;
  private readonly pointer: THREE.Vector2;
  private readonly world: THREE.Group;
  private readonly agentLayer: THREE.Group;
  private readonly selectionRing: THREE.Mesh;
  private readonly agentStates = new Map<string, AgentRuntimeState>();
  private readonly agents = new Map<string, CharacterController>();
  private onSelectAgent: (agentId: string) => void;
  private selectedAgentId: string | null = null;
  private frameHandle?: number;
  private worldReady = false;
  private destroyed = false;
  private pendingAgents: AgentRuntimeState[] = [];

  constructor(options: MissionThreeRendererOptions) {
    this.parent = options.parent;
    this.onSelectAgent = options.onSelectAgent;
    this.clock = new THREE.Clock();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_RENDER_PIXEL_RATIO));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.04;
    this.renderer.domElement.className = "mission-map__canvas";
    this.parent.append(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#b9dbef");

    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 120);
    this.camera.position.copy(CAMERA_POSITION);
    this.camera.lookAt(CAMERA_TARGET);

    this.world = new THREE.Group();
    this.agentLayer = new THREE.Group();
    this.scene.add(this.world);
    this.scene.add(this.agentLayer);

    const hemisphere = new THREE.HemisphereLight("#f5f2da", "#4e6f65", 1.85);
    this.scene.add(hemisphere);

    const sun = new THREE.DirectionalLight("#ffe4ba", 1.7);
    sun.position.set(-14, 20, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 64;
    sun.shadow.camera.left = -22;
    sun.shadow.camera.right = 22;
    sun.shadow.camera.top = 22;
    sun.shadow.camera.bottom = -22;
    this.scene.add(sun);

    const fill = new THREE.PointLight("#a4d7ff", 0.95, 44);
    fill.position.set(12, 10, 18);
    this.scene.add(fill);

    this.selectionRing = new THREE.Mesh(
      new THREE.RingGeometry(0.48, 0.72, 32),
      new THREE.MeshBasicMaterial({
        color: "#7df6c0",
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
      }),
    );
    this.selectionRing.rotation.x = -Math.PI / 2;
    this.selectionRing.position.y = 0.04;
    this.selectionRing.visible = false;
    this.scene.add(this.selectionRing);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.parent);
    this.resize();

    this.renderer.domElement.addEventListener("pointerdown", this.handlePointerDown);
    this.ready = this.buildWorld().then(() => {
      if (this.destroyed) {
        return;
      }
      this.worldReady = true;
      this.setAgents(this.pendingAgents);
      this.applySelection();
    });

    this.animate();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.frameHandle !== undefined) {
      window.cancelAnimationFrame(this.frameHandle);
    }
    this.renderer.domElement.removeEventListener("pointerdown", this.handlePointerDown);
    this.resizeObserver.disconnect();
    this.renderer.dispose();
    this.parent.replaceChildren();
  }

  setAgents(nextAgents: AgentRuntimeState[]): void {
    this.pendingAgents = nextAgents;
    if (!this.worldReady || this.destroyed) {
      return;
    }

    const placements = new Map(buildPlacements(nextAgents).map((placement) => [placement.agent.id, placement]));
    const activeIds = new Set(nextAgents.map((agent) => agent.id));

    for (const [agentId] of this.agents) {
      if (!activeIds.has(agentId)) {
        this.removeAgent(agentId);
      }
    }

    nextAgents.forEach((state) => {
      this.agentStates.set(state.id, state);
      const appearance = (state as AgentSnapshotState).appearance;
      const placement = placements.get(state.id);
      if (!placement) {
        return;
      }

      const { position, facing } = placementToWorld(placement);
      const controller = this.ensureController(state, appearance, position, facing);
      controller.status = controllerStatus(state.status);
      controller.task = state.task;
      controller.message = state.message;
      controller.setTarget(position, {
        facing,
        seated: false,
        status: controllerStatus(state.status),
      });
    });

    this.applySelection();
  }

  setSelectedAgent(agentId: string | null): void {
    this.selectedAgentId = agentId;
    this.applySelection();
  }

  setOnSelectAgent(onSelectAgent: (agentId: string) => void): void {
    this.onSelectAgent = onSelectAgent;
  }

  private async buildWorld(): Promise<void> {
    const [grassTexture, concreteTexture, asphaltTexture] = await Promise.all([
      loadTexture(TEXTURE_URLS.grass),
      loadTexture(TEXTURE_URLS.tiles),
      loadTexture(TEXTURE_URLS.asphalt),
    ]);

    this.world.add(createGroundPlane(WORLD_WIDTH, WORLD_DEPTH, grassTexture, 10, 12, GROUND_LEVEL, "#bde193"));
    this.world.add(createGroundPlane(STREET_WIDTH, STREET_DEPTH, concreteTexture, 4, 12, STREET_Y, "#f6eed7"));

    const leftShoulder = createGroundPlane(4.2, STREET_DEPTH, asphaltTexture, 2, 10, STREET_Y + 0.01, "#d5d7d3");
    leftShoulder.position.x = -(STREET_WIDTH / 2 + 1.6);
    this.world.add(leftShoulder);

    const rightShoulder = createGroundPlane(4.2, STREET_DEPTH, asphaltTexture, 2, 10, STREET_Y + 0.01, "#d5d7d3");
    rightShoulder.position.x = STREET_WIDTH / 2 + 1.6;
    this.world.add(rightShoulder);

    const leftPlanter = createPlanter(2.2, STREET_DEPTH - 4, "#8dd16d");
    leftPlanter.position.set(-5.9, 0, 0.6);
    this.world.add(leftPlanter);

    const rightPlanter = createPlanter(2.2, STREET_DEPTH - 4, "#8dd16d");
    rightPlanter.position.set(5.9, 0, 0.6);
    this.world.add(rightPlanter);

    const leftSteps = new THREE.Mesh(new THREE.BoxGeometry(STREET_WIDTH + 4, 0.5, 2.2), makeMaterial("#c7c6c2"));
    leftSteps.position.set(0, 0.24, 13.3);
    leftSteps.receiveShadow = true;
    this.world.add(leftSteps);

    const rail = createStreetRails(34);
    rail.position.set(0, 0, 12.8);
    this.world.add(rail);

    const banner = createBannerLine(24);
    banner.position.set(0, 2.4, 9.6);
    this.world.add(banner);

    const pond = createPond();
    pond.position.set(-10.3, 0, 0.8);
    this.world.add(pond);

    const deskCourt = createZoneCourt(12.8, 12.4, concreteTexture, 5, 5, "#9cc57e", "#f3ebd8");
    deskCourt.position.set(0, 0, 1.6);
    this.world.add(deskCourt);

    const meetingCourt = createZoneCourt(6.6, 5.8, concreteTexture, 3, 2.5, "#dce5a9", "#edf3dc");
    meetingCourt.position.set(-8.6, 0, -8.6);
    this.world.add(meetingCourt);

    const cioCourt = createZoneCourt(6.8, 5.8, concreteTexture, 3, 2.5, "#c9d8ef", "#e7eefb");
    cioCourt.position.set(8.8, 0, -8.4);
    this.world.add(cioCourt);

    const supportCourt = createZoneCourt(5.8, 4.6, concreteTexture, 2.5, 2, "#efd6b6", "#f8efdf");
    supportCourt.position.set(8.1, 0, 6.2);
    this.world.add(supportCourt);

    const backLawn = createZoneCourt(10.8, 5.6, grassTexture, 4, 2, "#9ec680", "#bfe18f");
    backLawn.position.set(0, 0, -13.4);
    this.world.add(backLawn);

    const leftMeetingHedge = createHedgeStrip(4.6, 0.7);
    leftMeetingHedge.position.set(-8.6, 0, -11.7);
    this.world.add(leftMeetingHedge);

    const rightCioHedge = createHedgeStrip(4.8, 0.7, "#74b26f");
    rightCioHedge.position.set(8.8, 0, -11.6);
    this.world.add(rightCioHedge);

    const backHedge = createHedgeStrip(13.4, 0.8, "#71b05f");
    backHedge.position.set(0, 0, -16.8);
    this.world.add(backHedge);

    await Promise.all([
      this.placeStreetProps(),
      this.placeGreenery(),
      this.placeZoneSigns(),
    ]);
  }

  private async placeStreetProps(): Promise<void> {
    const lampPositions = [
      [-4.6, -8.4],
      [4.6, -8.4],
      [-4.6, -1.3],
      [4.6, -1.3],
      [-4.6, 6.2],
      [4.6, 6.2],
    ] as const;
    const benchPositions = [
      [-7.4, -1.2, Math.PI / 2],
      [7.3, 4.8, -Math.PI / 2],
    ] as const;

    await Promise.all([
      ...lampPositions.map(async ([x, z]) => {
        const lamp = await loadModel(MODEL_URLS.lamp);
        lamp.scale.setScalar(KIT_SCALE);
        lamp.position.set(x, 0, z);
        this.world.add(lamp);

        const glow = new THREE.PointLight("#9eeef2", 0.7, 8, 2);
        glow.position.set(x, 2.4, z);
        this.scene.add(glow);
      }),
      ...benchPositions.map(async ([x, z, rotationY]) => {
        const bench = await loadModel(MODEL_URLS.bench);
        bench.scale.setScalar(KIT_SCALE);
        bench.rotation.y = rotationY;
        bench.position.set(x, 0, z);
        this.world.add(bench);
      }),
    ]);
  }

  private async placeGreenery(): Promise<void> {
    const treePositions = [
      [-13.5, 9.5, 1.45],
      [13.2, 9.8, 1.45],
      [-13.1, -10.8, 1.35],
      [13.4, -10.5, 1.4],
    ] as const;
    const shrubPositions = [
      [-6.1, 3.8],
      [6.1, 3.2],
      [-6.1, -4.8],
      [6.1, -5.4],
      [8.8, 6.2],
    ] as const;

    await Promise.all([
      ...treePositions.map(async ([x, z, scale]) => {
        const tree = await loadModel(MODEL_URLS.treePark);
        tree.scale.setScalar(KIT_SCALE * scale);
        tree.position.set(x, 0, z);
        this.world.add(tree);
      }),
      ...shrubPositions.map(async ([x, z]) => {
        const shrub = await loadModel(MODEL_URLS.shrub);
        shrub.scale.setScalar(KIT_SCALE * 0.9);
        shrub.position.set(x, 0, z);
        this.world.add(shrub);
      }),
    ]);
  }

  private async placeZoneSigns(): Promise<void> {
    const signs = [
      { label: "POND", accent: "#8ed3ff", position: new THREE.Vector3(-13.8, 0, 0.8), rotationY: Math.PI / 2 },
      { label: "DESKS", accent: "#d6f4b8", position: new THREE.Vector3(-7.2, 0, 2.1), rotationY: Math.PI / 2 },
      { label: "MEET", accent: "#f2f0ba", position: new THREE.Vector3(-8.6, 0, -12.7), rotationY: 0 },
      { label: "CIO", accent: "#d4e4ff", position: new THREE.Vector3(8.8, 0, -12.7), rotationY: 0 },
      { label: "SUPPORT", accent: "#ffd6a8", position: new THREE.Vector3(11.8, 0, 6.2), rotationY: -Math.PI / 2 },
      { label: "HEAD", accent: "#ffd39c", position: new THREE.Vector3(0, 0, -14.6), rotationY: 0 },
    ];

    signs.forEach(({ label, accent, position, rotationY }) => {
      const sign = createSign(label, accent);
      sign.position.copy(position);
      sign.rotation.y = rotationY;
      this.world.add(sign);
    });
  }

  private ensureController(
    state: AgentRuntimeState,
    appearance: AgentAppearance | undefined,
    position: THREE.Vector3,
    facing: number,
  ): CharacterController {
    const existing = this.agents.get(state.id);
    if (existing) {
      existing.name = state.name;
      existing.role = state.role;
      existing.emoji = state.emoji ?? existing.emoji;
      existing.task = state.task;
      existing.message = state.message;
      return existing;
    }

    const config = buildRuntimeConfig(state, appearance);
    const controller = state.id === "charlie"
      ? new FishController(config, position.clone(), facing)
      : new AgentController(config, position.clone(), facing);
    controller.mesh.scale.multiplyScalar(CHARACTER_SCALE);
    controller.mesh.userData.agentId = state.id;
    controller.task = state.task;
    controller.message = state.message;
    this.agents.set(state.id, controller);
    this.agentLayer.add(controller.mesh);
    return controller;
  }

  private removeAgent(agentId: string): void {
    const controller = this.agents.get(agentId);
    if (controller) {
      this.agentLayer.remove(controller.mesh);
      this.agents.delete(agentId);
    }
    this.agentStates.delete(agentId);
  }

  private applySelection(): void {
    const selected = this.selectedAgentId ? this.agents.get(this.selectedAgentId) ?? null : null;
    this.agents.forEach((controller, agentId) => {
      controller.setMeetingHighlight(agentId === this.selectedAgentId);
    });

    if (!selected) {
      this.selectionRing.visible = false;
      return;
    }

    this.selectionRing.visible = true;
    this.selectionRing.position.set(selected.mesh.position.x, 0.05, selected.mesh.position.z);
  }

  private resize(): void {
    const width = Math.max(320, this.parent.clientWidth);
    const height = Math.max(240, this.parent.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  private handlePointerDown = (event: PointerEvent): void => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const targets = Array.from(this.agents.values(), (controller) => controller.mesh);
    const intersects = this.raycaster.intersectObjects(targets, true);
    const hit = intersects.find((entry) => {
      let current: THREE.Object3D | null = entry.object;
      while (current) {
        if (typeof current.userData.agentId === "string") {
          return true;
        }
        current = current.parent;
      }
      return false;
    });

    if (!hit) {
      return;
    }

    let current: THREE.Object3D | null = hit.object;
    while (current) {
      if (typeof current.userData.agentId === "string") {
        this.onSelectAgent(current.userData.agentId);
        return;
      }
      current = current.parent;
    }
  };

  private animate = (): void => {
    this.frameHandle = window.requestAnimationFrame(this.animate);
    const delta = Math.min(this.clock.getDelta(), 0.1);
    const elapsed = this.clock.elapsedTime;

    this.agents.forEach((controller) => controller.update(delta, elapsed));
    const selected = this.selectedAgentId ? this.agents.get(this.selectedAgentId) ?? null : null;
    if (selected) {
      this.selectionRing.position.set(selected.mesh.position.x, 0.05, selected.mesh.position.z);
    }

    this.camera.position.lerp(CAMERA_POSITION, Math.min(1, delta * 2));
    this.camera.lookAt(CAMERA_TARGET);
    this.renderer.render(this.scene, this.camera);
  };
}
