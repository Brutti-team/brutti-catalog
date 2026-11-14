export const modelUploadBytes = 50 * 1024 * 1024;
export const modelExtensions = 'glb gltf obj fbx stl ply 3mf 3ds dae usd usda usdc usdz 3dm step stp iges igs brep drc wrl xyz'.split(' ');

export function modelFileExtension(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}
