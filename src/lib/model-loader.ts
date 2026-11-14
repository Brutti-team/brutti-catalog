import {
  BufferGeometry, Group, LoadingManager, Material, Mesh, MeshStandardMaterial, Object3D, Points,
  PointsMaterial, Texture, DoubleSide, type WebGLRenderer,
} from 'three';
import { readModelFiles, unpackModelArchive, type ModelEntry } from './model-files';
import { modelFileExtension } from './model-formats';

const localBase = 'https://catalog-model-files.invalid/';

function localResources(entries: ModelEntry[]) {
  const urls = new Map<ModelEntry, string>();
  const decoders = new Map<string, string>();
  const missing = new Set<string>();
  const failed = new Set<string>();
  const manager = new LoadingManager();
  let settled: Promise<void> | undefined;
  let endLoading: (() => void) | undefined;
  manager.onStart = () => { settled = new Promise(resolve => { endLoading = resolve; }); };
  manager.onLoad = () => { endLoading?.(); };
  manager.onError = url => { failed.add(url); };

  const normalize = (path: string) => path.replaceAll('\\', '/').replace(/^\/+/, '').replace(/^\.\//, '').toLowerCase();
  const index = new Map(entries.map(entry => [normalize(entry.path), entry]));
  function find(path: string) {
    const key = normalize(path);
    if (index.has(key)) return index.get(key);
    const name = key.split('/').at(-1);
    const matches = entries.filter(entry => normalize(entry.path).split('/').at(-1) === name);
    return matches.length === 1 ? matches[0] : undefined;
  }
  manager.setURLModifier(url => {
    if (/^(blob|data):/i.test(url)) return url;
    const decoder = decoders.get(url);
    if (decoder) return decoder;
    let path = url;
    try { path = decodeURIComponent(new URL(url.replaceAll('\\', '/'), localBase).pathname); } catch { /* try the literal filename */ }
    const entry = find(path);
    if (entry) {
      const known = urls.get(entry);
      if (known) return known;
      const objectURL = URL.createObjectURL(entry.blob);
      urls.set(entry, objectURL);
      return objectURL;
    }
    // Never fetch an external resource referenced by an uploaded model.
    missing.add(path.split('/').at(-1) || path);
    return 'data:application/octet-stream;base64,';
  });
  return { manager, find, missing, failed, decoders, settled: () => settled,
    release: () => { for (const url of urls.values()) URL.revokeObjectURL(url); } };
}

function visibleGeometry(geometry: BufferGeometry, points = false) {
  if (!geometry.getAttribute('position')?.count) throw new Error('The file contains no visible geometry.');
  const vertexColors = geometry.hasAttribute('color');
  const color = vertexColors ? 0xffffff : 0xc3a386;
  if (points) return new Points(geometry, new PointsMaterial({ color, vertexColors, size: .024 }));
  if (!geometry.hasAttribute('normal')) geometry.computeVertexNormals();
  return new Mesh(geometry, new MeshStandardMaterial({ color, roughness: .7, vertexColors, side: DoubleSide }));
}

function folderURL(path: string) {
  const folder = path.split('/').slice(0, -1).map(encodeURIComponent).join('/');
  return localBase + (folder ? `${folder}/` : '');
}

export function disposeModel(object: Object3D) {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  object.traverse(part => {
    if (part instanceof Mesh || part instanceof Points || 'geometry' in part) {
      const drawable = part as Mesh;
      if (drawable.geometry) geometries.add(drawable.geometry);
      for (const material of [drawable.material].flat().filter(Boolean)) {
        materials.add(material);
        for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
      }
    }
  });
  for (const texture of textures) {
    if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) texture.image.close();
    texture.dispose();
  }
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}

export async function loadModel(files: readonly File[], renderer: WebGLRenderer) {
  const { entries, model, name } = await readModelFiles(files);
  const format = modelFileExtension(name);
  const data = await model.blob.arrayBuffer();
  const text = () => new TextDecoder().decode(data);
  const resources = localResources(entries);
  const { manager } = resources;
  const path = folderURL(model.path);
  let object: Object3D | undefined;
  try {
    switch (format) {
      case 'glb': case 'gltf': {
        const [{ GLTFLoader }, { DRACOLoader, DRACO_GLTF_CONFIG }, { KTX2Loader }, { MeshoptDecoder }] = await Promise.all([
          import('three/addons/loaders/GLTFLoader.js'), import('three/addons/loaders/DRACOLoader.js'),
          import('three/addons/loaders/KTX2Loader.js'), import('three/addons/libs/meshopt_decoder.module.js'),
        ]);
        // The bundled decoders load from the same origin. Their managers are separate
        // from model resources so uploaded files cannot redirect decoder requests.
        const draco = new DRACOLoader().setDecoderPath(DRACO_GLTF_CONFIG);
        const textures = new KTX2Loader().detectSupport(renderer);
        try {
          const loader = new GLTFLoader(manager).setDRACOLoader(draco).setKTX2Loader(textures).setMeshoptDecoder(MeshoptDecoder);
          object = (await loader.parseAsync(data, path)).scene;
        } finally { draco.dispose(); textures.dispose(); }
        break;
      }
      case 'obj': {
        const [{ OBJLoader }, { MTLLoader }] = await Promise.all([
          import('three/addons/loaders/OBJLoader.js'), import('three/addons/loaders/MTLLoader.js'),
        ]);
        const loader = new OBJLoader(manager);
        const source = text();
        const materialName = /^mtllib\s+(.+?)\s*$/mi.exec(source)?.[1];
        if (materialName) {
          const pathname = new URL(materialName.replaceAll('\\', '/'), path).pathname;
          const material = resources.find(decodeURIComponent(pathname));
          if (material) loader.setMaterials(new MTLLoader(manager).parse(await material.blob.text(), folderURL(material.path)));
          else resources.missing.add(materialName);
        }
        object = loader.parse(source);
        break;
      }
      case 'fbx': {
        const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
        object = new FBXLoader(manager).parse(data, path);
        break;
      }
      case 'stl': {
        const { STLLoader } = await import('three/addons/loaders/STLLoader.js');
        object = visibleGeometry(new STLLoader(manager).parse(data));
        object.rotation.x = -Math.PI / 2;
        break;
      }
      case 'ply': {
        const { PLYLoader } = await import('three/addons/loaders/PLYLoader.js');
        const header = new TextDecoder().decode(data.slice(0, 8192)).split('end_header')[0];
        object = visibleGeometry(new PLYLoader(manager).parse(data), !/^element face [1-9]\d*/m.test(header));
        object.rotation.x = -Math.PI / 2;
        break;
      }
      case 'xyz': {
        const { XYZLoader } = await import('three/addons/loaders/XYZLoader.js');
        // r187's implementation returns geometry synchronously, unlike its declaration.
        const loader = new XYZLoader(manager) as unknown as { parse(text: string): BufferGeometry };
        object = visibleGeometry(loader.parse(text()), true);
        break;
      }
      case '3mf': {
        unpackModelArchive(new Uint8Array(data), false);
        const { ThreeMFLoader } = await import('three/addons/loaders/3MFLoader.js');
        object = new ThreeMFLoader(manager).parse(data);
        object.rotation.x = -Math.PI / 2;
        break;
      }
      case '3ds': {
        const { TDSLoader } = await import('three/addons/loaders/TDSLoader.js');
        object = new TDSLoader(manager).parse(data, path);
        break;
      }
      case 'dae': {
        const { ColladaLoader } = await import('three/addons/loaders/ColladaLoader.js');
        object = new ColladaLoader(manager).parse(text(), path)?.scene;
        break;
      }
      case 'wrl': {
        const { VRMLLoader } = await import('three/addons/loaders/VRMLLoader.js');
        object = new VRMLLoader(manager).parse(text(), path);
        break;
      }
      case 'usd': case 'usda': case 'usdc': case 'usdz': {
        if (format === 'usdz') unpackModelArchive(new Uint8Array(data), false);
        const { USDLoader } = await import('three/addons/loaders/USDLoader.js');
        object = await new Promise<Group>((resolve, reject) => new USDLoader(manager).parse(data, path, resolve, reject));
        break;
      }
      case '3dm': {
        const [{ Rhino3dmLoader }, decoder] = await Promise.all([
          import('three/addons/loaders/3DMLoader.js'), import('./model-decoder-rhino'),
        ]);
        resources.decoders.set(`${localBase}rhino3dm.js`, decoder.script);
        resources.decoders.set(`${localBase}rhino3dm.wasm`, decoder.wasm);
        const loader = new Rhino3dmLoader(manager).setLibraryPath(localBase).setWorkerLimit(1);
        try { object = await loader.parseAsync(data); } finally { loader.dispose(); }
        object.rotation.x = -Math.PI / 2;
        break;
      }
      case 'drc': {
        const { DRACOLoader } = await import('three/addons/loaders/DRACOLoader.js');
        const loader = new DRACOLoader();
        try {
          object = visibleGeometry(await new Promise<BufferGeometry>((resolve, reject) => loader.parse(data, resolve, reject)));
        } finally { loader.dispose(); }
        break;
      }
      default:
        object = await (await import('./model-decoder-cad')).parseCadModel(data, format);
    }
    await resources.settled();
    let visible = false;
    object?.traverse(part => { if ((part as Mesh).geometry?.getAttribute('position')?.count) visible = true; });
    if (!object || !visible) throw new Error('This file contains no visible geometry. Export a mesh and try again.');
    return { object, warning: resources.missing.size ? `Missing texture or material files: ${[...resources.missing].slice(0, 4).join(', ')}.`
      : resources.failed.size ? 'Some textures could not be opened.' : '' };
  } catch (error) {
    if (object) disposeModel(object);
    if (resources.missing.size) throw new Error(`Missing model files: ${[...resources.missing].slice(0, 4).join(', ')}. Select the model and its supporting files together.`, { cause: error });
    throw error;
  } finally { resources.release(); }
}
