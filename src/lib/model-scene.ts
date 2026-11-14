import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { disposeModel } from './model-loader';

export function createModelScene(host: HTMLDivElement, name: string, onContextLost: () => void) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.13;
  const canvas = renderer.domElement;
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', `Interactive 3D model of ${name}`);
  host.append(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, .03, 100);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  controls.dampingFactor = .095;
  controls.enablePan = false;
  controls.minPolarAngle = Math.PI * .08;
  controls.maxPolarAngle = Math.PI * .52;
  controls.rotateSpeed = .77;
  controls.zoomSpeed = .65;

  const environment = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environmentMap = pmrem.fromScene(environment, .045);
  scene.environment = environmentMap.texture;
  scene.environmentIntensity = .72;
  environment.dispose();
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xfff4e3, 0x836f5e, 1.7));
  const key = new THREE.DirectionalLight(0xffecd3, 2.3);
  key.position.set(4, 7, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = key.shadow.camera.bottom = -4;
  key.shadow.camera.right = key.shadow.camera.top = 4;
  key.shadow.normalBias = .018;
  key.shadow.bias = -.00015;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xe3eeff, .66);
  fill.position.set(-4, 3, -3);
  scene.add(fill);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: .245, depthWrite: false }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -.015;
  ground.receiveShadow = true;
  scene.add(ground);

  let frame = 0;
  let model: THREE.Group | undefined;
  let modelRadius = 1;
  const modelCenter = new THREE.Vector3();
  const defaultAngle = new THREE.Vector3(.94, .61, 1.48).normalize();
  const wireframeMaterials = new Set<THREE.Material & { wireframe: boolean }>();
  const embeddedLights: THREE.Object3D[] = [];

  function requestDraw() {
    if (frame || document.hidden || !model) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      controls.update();
      renderer.render(scene, camera);
    });
  }
  function resize() {
    const { clientWidth: width, clientHeight: height } = host;
    if (!width || !height) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    requestDraw();
  }
  function reset() {
    resize();
    const vertical = THREE.MathUtils.degToRad(camera.fov / 2);
    const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
    const distance = modelRadius / Math.sin(Math.min(vertical * (camera.aspect <= 1.1 ? .78 : .93), horizontal * .96));
    const damping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    controls.target.copy(modelCenter);
    camera.position.copy(modelCenter).addScaledVector(defaultAngle, distance);
    controls.minDistance = modelRadius * .6;
    controls.maxDistance = distance * 3.2;
    controls.update();
    controls.enableDamping = damping;
    requestDraw();
  }
  function show(object: THREE.Object3D) {
    const bounds = new THREE.Box3().setFromObject(object, true);
    const size = bounds.getSize(new THREE.Vector3());
    const dimension = Math.max(size.x, size.y, size.z);
    if (!(dimension > 0) || !Number.isFinite(dimension)) throw new Error('This model has no displayable geometry.');
    const scale = 3.2 / dimension;
    const center = bounds.getCenter(new THREE.Vector3());
    model = new THREE.Group();
    model.add(object);
    model.scale.setScalar(scale);
    model.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
    object.traverse(part => {
      if (part instanceof THREE.Light) embeddedLights.push(part);
      if (part instanceof THREE.Mesh) {
        part.castShadow = true;
        part.receiveShadow = true;
        for (const material of [part.material].flat()) {
          if ('wireframe' in material) wireframeMaterials.add(material as THREE.Material & { wireframe: boolean });
        }
      } else if (part instanceof THREE.Points && part.material instanceof THREE.PointsMaterial) {
        part.material.size = .023 / scale;
      }
    });
    for (const light of embeddedLights) light.removeFromParent();
    scene.add(model);
    modelRadius = size.length() * scale / 2;
    modelCenter.set(0, size.y * scale / 2, 0);
    reset();
    return wireframeMaterials.size > 0;
  }
  function zoom(factor: number) {
    const direction = camera.position.clone().sub(controls.target);
    const radius = THREE.MathUtils.clamp(direction.length() * factor, controls.minDistance, controls.maxDistance);
    camera.position.copy(controls.target).add(direction.setLength(radius));
    controls.update();
    requestDraw();
  }
  function handleKeys(event: KeyboardEvent) {
    if (!model) return;
    switch (event.key) {
      case 'ArrowLeft': controls.rotateLeft(.17); break;
      case 'ArrowRight': controls.rotateLeft(-.17); break;
      case 'ArrowUp': controls.rotateUp(.13); break;
      case 'ArrowDown': controls.rotateUp(-.13); break;
      case '+': case '=': zoom(.8); break;
      case '-': zoom(1.25); break;
      case 'Home': reset(); break;
      default: return;
    }
    event.preventDefault();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  controls.addEventListener('change', requestDraw);
  document.addEventListener('visibilitychange', requestDraw);
  canvas.addEventListener('keydown', handleKeys);
  canvas.addEventListener('webglcontextlost', onContextLost);
  return { renderer, show, reset, zoom,
    wireframe: (enabled: boolean) => {
      for (const material of wireframeMaterials) material.wireframe = enabled;
      requestDraw();
    },
    dispose() {
      observer.disconnect();
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', requestDraw);
      canvas.removeEventListener('keydown', handleKeys);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      controls.dispose();
      if (model) disposeModel(model);
      ground.geometry.dispose();
      ground.material.dispose();
      environmentMap.dispose();
      key.shadow.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
