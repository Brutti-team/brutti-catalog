import scriptURL from 'occt-import-js/dist/occt-import-js.js?url&no-inline';
import wasmURL from 'occt-import-js/dist/occt-import-js.wasm?url&no-inline';
import { BufferGeometry, Color, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, SRGBColorSpace } from 'three';

type CadMesh = {
  name: string;
  color?: [number, number, number];
  attributes: { position: { array: number[] }; normal?: { array: number[] } };
  index: { array: number[] };
};
type CadReader = (bytes: Uint8Array, options: null) => { success: boolean; meshes: CadMesh[] };
type Decoder = { ReadStepFile: CadReader; ReadIgesFile: CadReader; ReadBrepFile: CadReader };
type CadWindow = Window & { occtimportjs?: (configuration: { wasmBinary: ArrayBuffer }) => Promise<Decoder> };
let decoder: Promise<Decoder> | undefined;

function loadCadDecoder(): Promise<Decoder> {
  if (decoder) return decoder;
  const scriptLoad = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = scriptURL;
    script.onload = () => { script.remove(); resolve(); };
    script.onerror = () => { script.remove(); reject(new Error('The CAD decoder could not be loaded.')); };
    document.head.append(script);
  });
  decoder = Promise.all([scriptLoad, fetch(wasmURL)]).then(async ([, response]) => {
    const factory = (window as CadWindow).occtimportjs;
    if (!response.ok || !factory) throw new Error('The CAD decoder could not start.');
    return factory({ wasmBinary: await response.arrayBuffer() });
  }).catch(error => { decoder = undefined; throw error; });
  return decoder;
}

export async function parseCadModel(buffer: ArrayBuffer, format: string): Promise<Group> {
  const library = await loadCadDecoder();
  const reader = format === 'step' || format === 'stp' ? library.ReadStepFile
    : format === 'iges' || format === 'igs' ? library.ReadIgesFile : library.ReadBrepFile;
  const result = reader(new Uint8Array(buffer), null);
  if (!result.success) throw new Error('The CAD file could not be rendered. Export a solid or a mesh and try again.');
  const group = new Group();
  for (const part of result.meshes) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(part.attributes.position.array, 3));
    geometry.setIndex(part.index.array);
    if (part.attributes.normal) geometry.setAttribute('normal', new Float32BufferAttribute(part.attributes.normal.array, 3));
    else geometry.computeVertexNormals();
    const color = part.color ? new Color().setRGB(...part.color, SRGBColorSpace) : new Color(0xc3a386);
    const mesh = new Mesh(geometry, new MeshStandardMaterial({ color, roughness: .7 }));
    mesh.name = part.name;
    group.add(mesh);
  }
  group.rotation.x = -Math.PI / 2;
  return group;
}
