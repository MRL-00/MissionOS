import "./styles.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import agentsConfig from "./config/agents.json";
import { AgentController, STATUS } from "./characters/agentController.js";
import { DemoDirector, moveAgentToDestination } from "./demo.js";
import { createOfficeScene } from "./scene/officeScene.js";
import { createHud, LabelRenderer } from "./ui/overlay.js";

const app = document.querySelector("#app");

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
app.append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#e9d5b4");
scene.fog = new THREE.Fog("#ead7b7", 28, 52);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 120);

const defaultCameraPosition = new THREE.Vector3(-17, 14, 17);
const defaultTarget = new THREE.Vector3(0, 1.6, 0);
camera.position.copy(defaultCameraPosition);
camera.lookAt(defaultTarget);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = true;
controls.screenSpacePanning = true;
controls.minDistance = 7;
controls.maxDistance = 42;
controls.target.copy(defaultTarget);

const ambient = new THREE.HemisphereLight("#fff5de", "#b98f60", 1.9);
scene.add(ambient);

const sun = new THREE.DirectionalLight("#fff4d6", 2.2);
sun.position.set(12, 18, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 50;
sun.shadow.camera.left = -20;
sun.shadow.camera.right = 20;
sun.shadow.camera.top = 20;
sun.shadow.camera.bottom = -20;
scene.add(sun);

const fill = new THREE.DirectionalLight("#c0e1ff", 0.9);
fill.position.set(-10, 12, -6);
scene.add(fill);

const roomGlow = new THREE.PointLight("#fff0d0", 0.8, 24);
roomGlow.position.set(0, 7, 0);
scene.add(roomGlow);

const { office, waypoints } = createOfficeScene();
scene.add(office);

const agents = new Map();
const deskAssignments = new Map();

agentsConfig.forEach((agentConfig, index) => {
  const desk = waypoints.deskSlots[index] ?? null;
  const initialPosition = desk?.sit ?? waypoints.bullpen[index % waypoints.bullpen.length];
  const controller = new AgentController(agentConfig, initialPosition.clone(), desk?.facing ?? 0);
  controller.navNodeId = desk?.nodeId ?? waypoints.entrance.nodeId;
  scene.add(controller.mesh);
  agents.set(agentConfig.id, controller);
  deskAssignments.set(agentConfig.id, desk);

  if (desk) {
    moveAgentToDestination({ waypoints }, controller, desk, {
      facing: desk.facing,
      status: STATUS.working,
      seated: true,
    });
    controller.mesh.position.copy(desk.sit);
    controller.mesh.position.y = desk.sit.y;
  }
});

const hud = createHud({
  onToggleDemo: toggleDemo,
  onResetCamera: resetCamera,
});
const labelRenderer = new LabelRenderer(hud.labelLayer);

const demo = new DemoDirector({
  agents,
  deskAssignments,
  waypoints,
});

function toggleDemo() {
  if (demo.running) {
    demo.stop();
    hud.setDemoRunning(false);
    resetAgentsToDesks();
    return;
  }

  demo.start();
  hud.setDemoRunning(true);
}

function resetAgentsToDesks() {
  agents.forEach((controller, id) => {
    const desk = deskAssignments.get(id);
    if (!desk) {
      return;
    }
    moveAgentToDestination({ waypoints }, controller, desk, {
      facing: desk.facing,
      status: STATUS.working,
      seated: true,
    });
  });
}

function resetCamera() {
  camera.position.copy(defaultCameraPosition);
  controls.target.copy(defaultTarget);
  controls.update();
}

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

window.addEventListener("resize", resize);

const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
  const delta = clock.getDelta();
  const elapsed = clock.elapsedTime;

  demo.update(delta);
  controls.update();

  const labels = [];
  agents.forEach((controller) => {
    controller.update(delta, elapsed);
    labels.push(controller.getLabelState());
  });

  labelRenderer.sync(labels, camera, { width: window.innerWidth, height: window.innerHeight });
  renderer.render(scene, camera);
});
