import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Languages supported by Ulanzi Studio (see the SDK README). */
export const LANGUAGES = ['en', 'zh_CN', 'zh_HK', 'ja_JP', 'de_DE', 'ko_KR', 'pt_PT', 'es_ES'];

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

/**
 * Checks a *.ulanziPlugin folder against the rules of the SDK's manifest.md.
 * @param {string} dir
 * @returns {{ manifest: any, problems: string[] }}
 */
export function validatePlugin(dir) {
  const problems = [];
  const manifest = readJson(path.join(dir, 'manifest.json'));

  if (!path.basename(dir).endsWith('.ulanziPlugin')) problems.push('the folder name must end with .ulanziPlugin');
  for (const field of ['Author', 'Name', 'Icon', 'Version', 'CodePath', 'Type', 'UUID', 'Actions']) {
    if (!manifest[field]) problems.push(`manifest.json: ${field} is required`);
  }
  if (manifest.Type !== 'JavaScript') problems.push('manifest.json: Type must be "JavaScript"');
  if (manifest.UUID?.split('.').length !== 4) problems.push('manifest.json: UUID must have exactly 4 segments');
  if (!/^\d+\.\d+\.\d+$/.test(manifest.Version ?? '')) problems.push('manifest.json: Version must look like 1.2.3');

  const files = [manifest.Icon, manifest.CategoryIcon, manifest.CodePath];
  for (const action of manifest.Actions ?? []) {
    if (!action.UUID?.startsWith(`${manifest.UUID}.`)) {
      problems.push(`manifest.json: action UUID ${action.UUID} must start with ${manifest.UUID}.`);
    }
    if (!action.Name || !action.Icon) problems.push(`manifest.json: action ${action.UUID} needs Name and Icon`);
    if (!action.States?.length) problems.push(`manifest.json: action ${action.UUID} needs at least one state`);
    files.push(action.Icon, action.PropertyInspectorPath, ...(action.States ?? []).map((state) => state.Image));
  }
  for (const file of files.filter(Boolean)) {
    if (!existsSync(path.join(dir, file))) problems.push(`${file} (referenced by manifest.json) does not exist`);
  }

  const englishKeys = Object.keys(readJson(path.join(dir, 'en.json')).Localization ?? {}).sort();
  for (const language of LANGUAGES) {
    const file = path.join(dir, `${language}.json`);
    if (!existsSync(file)) {
      problems.push(`${language}.json is missing`);
      continue;
    }
    const json = readJson(file);
    if (!json.Name || !json.Description) problems.push(`${language}.json: Name and Description are required`);
    if (json.Actions?.length !== manifest.Actions?.length || json.Actions.some((action) => !action.Name)) {
      problems.push(`${language}.json: Actions must line up with manifest.json`);
    }
    const keys = Object.keys(json.Localization ?? {}).sort();
    if (keys.join('\n') !== englishKeys.join('\n')) problems.push(`${language}.json: Localization keys differ from en.json`);
  }

  return { manifest, problems };
}
