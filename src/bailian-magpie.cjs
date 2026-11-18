const { lstat, readFile } = require('node:fs/promises');
const { createRequire } = require('node:module');
const { dirname, join } = require('node:path');
const { pathToFileURL } = require('node:url');

const pick = 'bailian-magpie';
const entryId = 'llm-pi-ai';
const plugin = '@deepseek-ai/dsh-llm-pi-ai';
const route = {
  displayName: '阿里云 Token Plan · Magpie',
  api: 'openai-completions',
  baseURL: 'http://127.0.0.1:3425/v1',
  headers: { Authorization: 'Bearer magpie' },
  compat: {
    maxTokensField: 'max_tokens',
    thinkingFormat: 'qwen',
    supportsReasoningEffort: true,
    supportsDeveloperRole: false,
  },
  models: [{
    id: 'bailian-token-plan/deepseek-v4.1-flash-1017',
    name: 'DeepSeek V4.1 Flash 1017',
    contextWindow: 1048576,
    maxTokens: 32768,
    input: ['text'],
    reasoningEfforts: { off: null, low: 'low', high: 'high', max: 'max' },
  }],
};

async function readPatch(yaml, path) {
  let source;
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Expected a regular Cordis patch file: ${path}`);
    source = await readFile(path, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    source = '';
  }
  const document = yaml.parseDocument(source);
  if (document.errors.length || (document.contents?.value !== null && document.contents !== null && !yaml.isSeq(document.contents))) {
    throw new Error(`Expected a Cordis patch list in ${path}. Fix its YAML and rerun the installer.`);
  }
  return { path, document };
}

function effectiveEntry(layers) {
  let owner;
  let disabled = false;
  for (const layer of layers) {
    for (const entry of layer.document.contents?.items ?? []) {
      if (entry?.get?.('id') !== entryId || entry.has('insert')) continue;
      const name = entry.get('name');
      if (name && name !== plugin) continue;
      if (entry.has('disabled')) disabled = entry.get('disabled') === true;
      // Cordis patches replace the whole config. Edit the last patch that sets it.
      if (entry.has('config')) owner = { ...layer, entry };
    }
  }
  return { owner, disabled };
}

async function main() {
  const [app, profile, home, mode] = process.argv.slice(2);
  const resolveHost = createRequire(join(app, 'resources', 'app.asar', 'dsh', 'package.json'));
  const yaml = resolveHost('yaml');
  const layers = [join(profile, 'cordis.patch.yml'), join(home, 'cordis.patch.yml')];
  const inspect = async () => {
    const patches = await Promise.all(layers.map(path => readPatch(yaml, path)));
    const { owner, disabled } = effectiveEntry(patches);
    if (disabled) throw new Error('Enable the llm-pi-ai entry in the selected profile before installing Bailian Magpie.');
    return owner ?? patches[0];
  };
  const target = await inspect();
  const update = ({ path, document, entry }) => {
    const config = entry?.get('config', true);
    const providers = config?.get?.('providers', true);
    if ((config && config.value !== null && !yaml.isMap(config))
      || (providers && providers.value !== null && !yaml.isMap(providers))) {
      throw new Error(`Bailian Magpie needs llm-pi-ai.config.providers as a mapping in ${path}.`);
    }
    if (providers?.has?.(pick)) return 'present';
    if (mode === 'inspect') return 'missing';
    if (!entry) {
      if (!yaml.isSeq(document.contents)) document.contents = document.createNode([]);
      document.contents.add({ id: entryId, name: plugin, config: { providers: { [pick]: route } } });
    } else if (!yaml.isMap(config)) {
      entry.set('config', { providers: { [pick]: route } });
    } else if (!yaml.isMap(providers)) {
      config.set('providers', { [pick]: route });
    } else {
      providers.set(pick, route);
    }
    return 'added';
  };
  if (mode === 'inspect') {
    console.log(update(target));
    return;
  }
  const { withFileLock, writeFileAtomic } = await import(pathToFileURL(resolveHost.resolve('@deepseek-ai/dsh-atomic-write')).href);
  const state = await withFileLock(target.path, async () => {
    const current = await inspect();
    if (current.path !== target.path) throw new Error('Cordis patch ownership changed during installation. Rerun the installer.');
    const state = update(current);
    if (state === 'added') await writeFileAtomic(current.path, current.document.toString({ lineWidth: 0 }), { mode: 0o600 });
    return state;
  }, { waitMs: 2000 });
  console.log(state);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
