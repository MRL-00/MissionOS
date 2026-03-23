import "./styles.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import agentsConfig from "./config/agents.json";
import { AgentController, STATUS } from "./characters/agentController.js";
import { DemoDirector } from "./demo.js";
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

const aspect = window.innerWidth / window.innerHeight;
const frustum = 13;
const camera = new THREE.OrthographicCamera(
  (-frustum * aspect) / 2,
  (frustum * aspect) / 2,
  frustum / 2,
  -frustum / 2,
  0.1,
  100,
);

const defaultCameraPosition = new THREE.Vector3(-15, 15, 15);
const defaultTarget = new THREE.Vector3(0, 0.8, 0);
camera.position.copy(defaultCameraPosition);
camera.lookAt(defaultTarget);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;
controls.minZoom = 0.85;
controls.maxZoom = 1.8;
controls.minPolarAngle = Math.PI / 5;
controls.maxPolarAngle = Math.PI / 2.2;
controls.minAzimuthAngle = -Math.PI / 8;
controls.maxAzimuthAngle = Math.PI / 3;
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

const { office, waypoints } = createOfficeScene();
scene.add(office);

const agents = new Map();
const agentLookup = {};

agentsConfig.forEach((agentConfig, index) => {
  const desk = waypoints.desks[agentConfig.id];
  const initialPosition = desk?.sit ?? waypoints.bullpen[index % waypoints.bullpen.length];
  const controller = new AgentController(agentConfig, initialPosition.clone(), desk?.facing ?? 0);
  scene.add(controller.mesh);
  agents.set(agentConfig.id, controller);
  agentLookup[agentConfig.id] = controller;

  if (desk) {
    controller.setTarget(desk.sit, {
      facing: desk.facing,
      status: STATUS.working,
      seated: true,
    });
  }
});

const hud = createHud({
  onToggleDemo: toggleDemo,
  onResetCamera: resetCamera,
});
const labelRenderer = new LabelRenderer(hud.labelLayer);

const demo = new DemoDirector({
  agents: agentLookup,
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
    const desk = waypoints.desks[id];
    if (!desk) {
      return;
    }
    controller.setTarget(desk.sit, {
      facing: desk.facing,
      status: STATUS.working,
      seated: true,
    });
  });
}

function resetCamera() {
  camera.position.copy(defaultCameraPosition);
  controls.target.copy(defaultTarget);
  camera.zoom = 1;
  camera.updateProjectionMatrix();
  controls.update();
}

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const nextAspect = width / height;
  camera.left = (-frustum * nextAspect) / 2;
  camera.right = (frustum * nextAspect) / 2;
  camera.top = frustum / 2;
  camera.bottom = -frustum / 2;
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
