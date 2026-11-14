import { unzipSync, zipSync } from 'three/addons/libs/fflate.module.js';
import { modelExtensions, modelFileExtension, modelUploadBytes } from './model-formats';

export type ModelEntry = { path: string; blob: Blob };
export type ModelPackage = { file: File; name: string };
const supportedModels = new Set(modelExtensions);
const previewLimit = 100 * 1024 * 1024;
const auxiliaryExtensions = new Set(['bin', 'mtl', 'jpg', 'jpeg', 'png', 'webp', 'avif', 'bmp', 'tga', 'dds', 'ktx', 'ktx2', 'tif', 'tiff']);

export function unpackModelArchive(bytes: Uint8Array, extract = true) {
  let size = 0;
  let entries = 0;
  return unzipSync(bytes, { filter(entry) {
    size += entry.originalSize;
    entries++;
    if (size > previewLimit || entries > 512) throw new Error('This model archive is too large to open.');
    return extract && !entry.name.endsWith('/') && !entry.name.startsWith('__MACOSX/');
  } });
}

function fileType(path: string): string {
  const ext = modelFileExtension(path);
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (['png', 'webp', 'avif', 'bmp'].includes(ext)) return `image/${ext}`;
  return 'application/octet-stream';
}

function normalizePath(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '');
  if (normalized.length > 1024 || normalized.split('/').some(part => !part || part === '.' || part === '..' || /\p{Cc}/u.test(part))) {
    throw new Error('The model contains an invalid file path.');
  }
  return normalized;
}

export async function readModelFiles(files: readonly File[]) {
  if (!files.length) throw new Error('Choose a 3D model first.');
  if (files.reduce((size, file) => size + file.size, 0) > previewLimit) throw new Error('Choose up to 100 MB of model files for preview.');
  const archive = files.length === 1 && modelFileExtension(files[0].name) === 'zip';
  const entries: ModelEntry[] = archive
    ? Object.entries(unpackModelArchive(new Uint8Array(await files[0].arrayBuffer())))
        .filter(([path]) => !path.split('/').some(part => part.startsWith('.')))
        .map(([path, contents]) => ({ path: normalizePath(path), blob: new Blob([contents.slice().buffer], { type: fileType(path) }) }))
    : files.map(file => ({ path: normalizePath(file.webkitRelativePath || file.name), blob: file }));
  const paths = entries.map(entry => entry.path.toLowerCase());
  if (new Set(paths).size !== paths.length) throw new Error('The package contains duplicate file names.');
  const models = entries.filter(entry => supportedModels.has(modelFileExtension(entry.path)));
  if (!models.length) throw new Error('Export the model to a supported format, such as GLB, OBJ, FBX or STEP.');
  if (models.length !== 1) throw new Error('Choose one model and its supporting files at a time.');
  const model = models[0];
  const name = model.path.split('/').at(-1)!;
  if (name.length > 200) throw new Error('The model filename must be 200 characters or fewer.');
  return { model, name, entries: entries.filter(entry => entry === model || auxiliaryExtensions.has(modelFileExtension(entry.path))) };
}

export async function packageModelFiles(files: readonly File[]): Promise<ModelPackage> {
  const { entries, name } = await readModelFiles(files);
  const contents = await Promise.all(entries.map(async entry => [entry.path, new Uint8Array(await entry.blob.arrayBuffer())] as const));
  // The original formats are retained, including texture and buffer files.
  const archive = zipSync(Object.fromEntries(contents), { level: 0 });
  if (archive.byteLength > modelUploadBytes) throw new Error('Model packages must be 50 MB or smaller to save.');
  return { file: new File([archive.slice().buffer], 'product-model.zip', { type: 'application/zip' }), name };
}
