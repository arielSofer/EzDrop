// `ProjectViewModel.studioAssetPath(_:)` — the Swift version resolves
// `Assets/Studio/<file>` inside the app bundle, falling back to the source
// tree. In the port the studio assets live in Application Support
// (`Assets/Studio/`), whose absolute path only the server knows, so the web app
// caches it once the bridge reports `fs.paths` and falls back to the relative
// path until then.

let studioAssetsDirectory = 'Assets/Studio';

export function setStudioAssetsDirectory(directory: string): void {
  studioAssetsDirectory = directory;
}

export function getStudioAssetsDirectory(): string {
  return studioAssetsDirectory;
}

export function studioAssetPath(fileName: string): string {
  const base = studioAssetsDirectory.endsWith('/')
    ? studioAssetsDirectory.slice(0, -1)
    : studioAssetsDirectory;
  return `${base}/${fileName}`;
}

/** `ProjectViewModel.mizmorLetodahLines` */
export const mizmorLetodahLines = [
  '  מִזְמוֹר לְתוֹדָה:    ',
  '  הָרִיעוּ לַיהוָה, כָּל־הָאָרֶץ.',
  '  עִבְדוּ אֶת־יְהוָה בְּשִׂמְחָה   ',
  '  בֹּאוּ לְפָנָיו, בִּרְנָנָה.',
  '  דְּעוּ כִּי יְהוָה, הוּא אֱלֹהִים:',
  '  הוּא־עָשָׂנוּ, ולא אֲנַחְנוּ',
  '  עַמּוֹ, וְצֹאן מַרְעִיתוֹ.',
  '  בֹּאוּ שְׁעָרָיו, בְּתוֹדָה',
  '  חֲצֵרֹתָיו בִּתְהִלָּה  ',
  '  הוֹדוּ־לוֹ, בָּרְכוּ שְׁמוֹ.',
  '  כִּי־טוֹב יְהוָה, לְעוֹלָם חַסְדּוֹ  ',
  '  וְעַד־דֹּר וָדֹר, אֱמוּנָתוֹ.',
  ' ',
] as const;

/** `ProjectViewModel.mizmorLetodahText` */
export const mizmorLetodahText = mizmorLetodahLines.join('\n');
