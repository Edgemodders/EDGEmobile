// `rednode` for each package: the stand-in, with the package's id from the importer's folder.
const stub = new URL('./rednode-stub.mjs', import.meta.url).href;
export async function resolve(specifier, context, next) {
  if (specifier === 'rednode') {
    const from = (context.parentURL ?? '').replace(/\\/g, '/');
    const pkg = /\/chooms\/rednode\//.test(from) ? 'chooms' : 'edgemobile';
    return { url: `${stub}?pkg=${pkg}`, shortCircuit: true };
  }
  return next(specifier, context);
}
