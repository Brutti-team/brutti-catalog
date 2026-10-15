import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const contained = (parent, child) => {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
};
const overlap = (first, second) => contained(first, second) || contained(second, first);

async function noSymlinkAncestors(path) {
  for (let current = resolve(path);;) {
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error('Symlinks are not allowed in assembly inputs or output paths.');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

function privatePath(path) {
  return path.split('/').some(part =>
    (part.startsWith('.') && !['.well-known', '.nojekyll'].includes(part)) ||
    /^(?:credentials?|secrets?|id_rsa|id_ed25519)(?:\.|$)/i.test(part) || /\.(?:pem|key|p12|pfx)$/i.test(part));
}

function checkPrivateBytes(bytes) {
  const text = bytes.toString('utf8');
  if (/sb_secret_[A-Za-z0-9_-]{8,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text))
    throw new Error('Private credentials were found in an input artifact; assembly refused.');
  for (const token of text.matchAll(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)) {
    let role;
    try { role = JSON.parse(Buffer.from(token[0].split('.')[1], 'base64url').toString()).role; }
    catch { continue; }
    if (role && role !== 'anon') throw new Error('Private credentials were found in an input artifact; assembly refused.');
  }
}

async function safeRead(path) {
  await noSymlinkAncestors(path);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await file.stat()).isFile()) throw new Error('Only regular artifact files may be copied.');
    return await file.readFile();
  } finally { await file.close(); }
}

async function inventory(root) {
  await noSymlinkAncestors(root);
  const result = [];
  const walk = async (directory, prefix = '') => {
    const entries = await readdir(directory);
    for (const name of entries.sort()) {
      const path = prefix ? `${prefix}/${name}` : name;
      // Reject credential paths before reading their contents.
      if (privatePath(path)) throw new Error('Hidden or private credential paths are not allowed in public build artifacts.');
      const absolute = join(root, path);
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) throw new Error('Symlinks are not allowed in assembly inputs or output paths.');
      if (info.isDirectory()) {
        result.push({ path, kind: 'directory' });
        await walk(absolute, path);
      } else if (info.isFile()) {
        const bytes = await safeRead(absolute);
        checkPrivateBytes(bytes);
        result.push({ path, kind: 'file', size: bytes.length, sha256: hash(bytes) });
      } else throw new Error('Only regular files and directories are allowed in public build artifacts.');
    }
  };
  await walk(root);
  return result;
}

const artifactHash = entries => hash(JSON.stringify(entries));

async function existingDirectory(path, description) {
  await noSymlinkAncestors(path);
  try {
    if (!(await lstat(path)).isDirectory()) throw new Error('not-directory');
  } catch { throw new Error(`${description} is missing; an existing build directory is required.`); }
}

async function catalogLayout(root, entries) {
  const files = new Map(entries.filter(entry => entry.kind === 'file').map(entry => [entry.path, entry]));
  const referenced = [];
  for (const entry of ['admin', 'catalog']) {
    const path = `${entry}/index.html`;
    if (!files.has(path)) throw new Error(`The catalog ${entry} entry document is missing.`);
    if (entries.some(item => item.path.startsWith(`${entry}/`) && item.path !== path))
      throw new Error(`Unexpected files in the catalog ${entry} entry directory.`);
    const html = (await safeRead(join(root, path))).toString('utf8');
    const assets = Array.from(html.matchAll(/\b(?:src|href)\s*=\s*(["'])(.*?)\1/gi), match => match[2]);
    if (!assets.some(asset => /\.m?js$/.test(asset)) || !assets.some(asset => /\.css$/.test(asset)))
      throw new Error('Both catalog entry documents must reference existing JavaScript and CSS assets.');
    for (const asset of assets) {
      if (!/^\/(?:[A-Za-z0-9._~-]+\/)*[A-Za-z0-9._~-]+$/.test(asset) || asset.split('/').some(segment => segment === '.' || segment === '..'))
        throw new Error('Catalog asset URLs must use safe absolute local paths.');
      const path = asset.slice(1);
      if (!files.has(path)) throw new Error('A referenced catalog asset is missing from the input artifact.');
    }
    referenced.push(assets.sort());
  }
  if (JSON.stringify(referenced[0]) !== JSON.stringify(referenced[1]))
    throw new Error('Catalog entry documents must reference the same artifact assets.');
  const assetFolders = new Set(referenced.flat().map(asset => asset.split('/')[1]));
  const assetFolder = [...assetFolders][0];
  if (assetFolders.size !== 1 || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(assetFolder) || ['admin', 'catalog'].includes(assetFolder))
    throw new Error('Catalog assets must use one safe distinct root folder.');
  const expected = new Set(['admin', 'catalog', assetFolder]);
  for (const item of entries) {
    const top = item.path.split('/')[0];
    if (!expected.has(top) || (!item.path.includes('/') && item.kind !== 'directory'))
      throw new Error('Unexpected catalog root content; root index.html, 404.html and website replacements are forbidden.');
  }
  return { assetFolder, folders: [...expected], assets: referenced[0] };
}

async function copyInventory(source, target, entries) {
  for (const entry of entries) {
    const path = join(target, entry.path);
    if (entry.kind === 'directory') await mkdir(path);
    else {
      const bytes = await safeRead(join(source, entry.path));
      if (hash(bytes) !== entry.sha256) throw new Error('An input artifact changed during assembly; review output refused.');
      await noSymlinkAncestors(dirname(path));
      await writeFile(path, bytes, { flag: 'wx' });
    }
  }
}

/** Copy two existing public build artifacts into a new ignored review folder. */
export async function assembleSite({ website, catalog, out } = {}) {
  if (!website || !catalog || !out) throw new Error('Provide --website EXISTING_WEBSITE_BUILD_DIR, --catalog dist-site and --out NEW_REVIEW.local.');
  website = resolve(website); catalog = resolve(catalog); out = resolve(out);
  await Promise.all([noSymlinkAncestors(website), noSymlinkAncestors(catalog), noSymlinkAncestors(out)]);
  if (overlap(website, catalog) || overlap(website, out) || overlap(catalog, out))
    throw new Error('Input and output paths must not overlap.');
  if (!basename(out).endsWith('.local')) throw new Error('Use a new ignored review output directory ending in .local.');
  await existingDirectory(website, 'The existing website build');
  await existingDirectory(catalog, 'The catalog build');
  await existingDirectory(dirname(out), 'The output parent directory');
  try { await lstat(out); throw new Error('The review output already exists; choose a new output directory.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }

  const [websiteEntries, catalogEntries] = await Promise.all([inventory(website), inventory(catalog)]);
  const websiteIndex = websiteEntries.find(entry => entry.path === 'index.html' && entry.kind === 'file');
  if (!websiteIndex) throw new Error('The existing website build must contain its original root index.html.');
  const layout = await catalogLayout(catalog, catalogEntries);
  if (websiteEntries.some(entry => [...layout.folders, 'assembly-report.json'].includes(entry.path.split('/')[0])))
    throw new Error('A website-owned path collides with a catalog folder or assembly report; collision refused.');

  // All refusal gates run before the only newly created directory is written.
  await mkdir(out);
  try {
    await copyInventory(website, out, websiteEntries);
    await copyInventory(catalog, out, catalogEntries);
    const outputEntries = await inventory(out);
    const outputFiles = new Map(outputEntries.filter(entry => entry.kind === 'file').map(entry => [entry.path, entry.sha256]));
    if ([...websiteEntries, ...catalogEntries].some(entry => entry.kind === 'file' && outputFiles.get(entry.path) !== entry.sha256))
      throw new Error('Output verification failed; artifact bytes were not preserved.');
    const [websiteAfter, catalogAfter] = await Promise.all([inventory(website), inventory(catalog)]);
    if (artifactHash(websiteAfter) !== artifactHash(websiteEntries) || artifactHash(catalogAfter) !== artifactHash(catalogEntries))
      throw new Error('An input artifact changed during assembly; review output refused.');
    const report = {
      generatedAt: new Date().toISOString(),
      purpose: 'Local review artifact only; no publication or deployment performed.',
      website: {
        inputDirectory: website, fileCount: websiteEntries.filter(entry => entry.kind === 'file').length,
        artifactSha256: artifactHash(websiteEntries), indexSha256Before: websiteIndex.sha256,
        indexSha256After: outputFiles.get('index.html'), rootUnchanged: true, freshness: 'not-verified',
      },
      catalog: {
        inputDirectory: catalog, fileCount: catalogEntries.filter(entry => entry.kind === 'file').length,
        artifactSha256: artifactHash(catalogEntries), assetFolder: layout.assetFolder,
        entryDocuments: ['admin/index.html', 'catalog/index.html'], assetUrls: layout.assets,
      },
      output: { directory: out, fileCountWithoutReport: outputFiles.size, artifactSha256WithoutReport: artifactHash(outputEntries) },
      gates: {
        sourceBytesPreserved: true, websiteFilesPreserved: true, noCollisions: true,
        noSymlinks: true, noPrivateCredentials: true, staticEntrypointsValid: true,
      },
    };
    await writeFile(join(out, 'assembly-report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    return report;
  } catch (error) {
    // Remove only the fresh output directory owned by this invocation.
    await rm(out, { recursive: true, force: true });
    throw error;
  }
}

function argumentsFor(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (!['--website', '--catalog', '--out'].includes(flag) || !value || value.startsWith('--') || options[flag.slice(2)])
      throw new Error('Usage: node scripts/assemble-site.mjs --website EXISTING_WEBSITE_BUILD_DIR --catalog dist-site --out NEW_REVIEW.local');
    options[flag.slice(2)] = value;
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const report = await assembleSite(argumentsFor(process.argv.slice(2)));
    process.stdout.write(`Review artifact assembled; ${report.website.fileCount} website files preserved, ${report.catalog.fileCount} catalog files added. Website root SHA-256 unchanged. No deployment performed.\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
