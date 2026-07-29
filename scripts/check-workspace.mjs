import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { readWorkspacePackages, repositoryRoot } from './workspaces.mjs';

const dependencyGroups = ['dependencies', 'devDependencies', 'optionalDependencies'];
const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const permittedLocalReference = /^(?:workspace:|file:|link:|catalog:)/;
const errors = [];

const rootManifest = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'));
const turbo = JSON.parse(await readFile(join(repositoryRoot, 'turbo.json'), 'utf8'));
const workspaces = await readWorkspacePackages();
const manifests = [{ manifest: rootManifest, manifestPath: 'package.json' }, ...workspaces];
const names = new Map();

for (const { manifest, manifestPath } of manifests) {
  if (typeof manifest.name !== 'string' || manifest.name.length === 0) {
    errors.push(`${manifestPath}: package name is required.`);
  } else if (names.has(manifest.name)) {
    errors.push(`${manifestPath}: duplicate package name "${manifest.name}".`);
  } else {
    names.set(manifest.name, manifestPath);
  }

  for (const group of dependencyGroups) {
    const dependencies = manifest[group];
    if (!dependencies || typeof dependencies !== 'object') {
      continue;
    }

    for (const [name, requested] of Object.entries(dependencies)) {
      if (
        typeof requested !== 'string' ||
        (!exactVersion.test(requested) && !permittedLocalReference.test(requested))
      ) {
        errors.push(
          `${manifestPath}: ${group}.${name} must use an exact version or an explicit local/workspace reference; found "${requested}".`,
        );
      }
    }
  }
}

if (rootManifest.packageManager !== 'pnpm@11.2.2') {
  errors.push('package.json: packageManager must be exactly "pnpm@11.2.2".');
}

if (rootManifest.engines?.node !== '22.23.1' || rootManifest.engines?.pnpm !== '11.2.2') {
  errors.push('package.json: Node and pnpm engine pins do not match the supported toolchain.');
}

const typecheckDependencies = turbo.tasks?.typecheck?.dependsOn;
if (
  !Array.isArray(typecheckDependencies) ||
  !['build', '^build', '^typecheck'].every((dependency) =>
    typecheckDependencies.includes(dependency),
  )
) {
  errors.push(
    'turbo.json: typecheck must depend on its own build plus dependency builds/typechecks so a clean checkout cannot consume missing dist declarations.',
  );
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`workspace:check: ${error}`);
  }
  process.exit(1);
}

console.log(`workspace:check: validated the root and ${workspaces.length} workspace package(s).`);
