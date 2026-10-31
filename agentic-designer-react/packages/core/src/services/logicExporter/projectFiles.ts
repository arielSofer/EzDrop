// Ported 1:1 from AgenticDesigner/Services/LogicExporter.swift — everything
// that is not Swift source: Package.swift, Info.plist, the .xcodeproj,
// schemes, StoreKit config, Firestore rules, Firebase plists, READMEs and the
// generated app icon.

import type { DesignProject, AppOrientation } from '../../models/DesignProject';
import { appOrientationPlistOrientations, appPlatformDisplayName } from '../../models/DesignProject';
import type { FirebaseConfig } from '../../models/FirebaseConfig';
import { firebaseConfigIsConfigured } from '../../models/FirebaseConfig';
import type { LogicFlow } from '../../models/LogicModels';
import { bytesToBase64 } from '../GeneratedFileTree';
import { isLetter, isNumberChar } from './swiftRuntime';
import { paramValue, swiftIdentifier } from './helpers';
import { gradientPNG, type RGB } from './png';
import { hex8, swiftDropFirst, swiftHexInt, swiftPrefix, swiftStringCompare, trimWhitespacesAndNewlines } from './swiftRuntime';
import {
  entitlementsTemplate,
  firebaseRCTemplate,
  firestoreCollectionScopedRuleTemplate,
  firestoreOwnerScopedRuleTemplate,
  firestoreRulesTemplate,
  firestoreSharedRuleTemplate,
  googleServiceInfoPlistTemplate,
  iosBuildSettingsTemplate,
  packageSwiftTemplate,
  partialInfoPlistTemplate,
  pbxBuildFileSectionTemplate,
  pbxContainerProxySectionTemplate,
  pbxCopyFilesSectionTemplate,
  pbxPackageRefSectionTemplate,
  pbxProjectTemplate,
  pbxTargetDependencySectionTemplate,
  pbxWatchBuildConfigsTemplate,
  pbxWatchConfigListTemplate,
  pbxWatchSyncGroupTemplate,
  pbxWatchTargetTemplate,
  readmeTemplate,
  storeKitConfigTemplate,
  storeKitProductTemplate,
  watchBuildSettingsTemplate,
  xcodeReadmeTemplate,
  xcodeSchemeTemplate,
} from './templates';
import type { GeneratedFileTree } from '../GeneratedFileTree';

// MARK: - StoreKit test config + shared scheme

/// The literal product ids a flow tries to buy.
export function purchaseProductIds(flows: LogicFlow[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const flow of flows) {
    for (const block of flow.blocks) {
      if (block.type !== 'purchaseProduct') continue;
      const id = paramValue(block, 'productId');
      if (id === undefined || id.length === 0 || id.includes('{{') || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

/// A .storekit configuration so purchases can be TESTED in the simulator.
export function storeKitConfigSource(productIds: string[]): string {
  const products = productIds
    .map((id, index) => {
      const internalId = hex8(index + 1);
      const parts = id.split('.').filter((p) => p.length > 0);
      const name = parts.length > 0 ? parts[parts.length - 1]! : 'Product';
      return storeKitProductTemplate({ internalId, name, id });
    })
    .join(',\n');
  return storeKitConfigTemplate({ products });
}

/// A shared scheme (deterministic `xcodebuild -scheme` + StoreKit test config).
export function xcodeSchemeSource(appName: string, storeKitConfig: boolean): string {
  const storeKitRef = storeKitConfig
    ? '\n      <StoreKitConfigurationFileReference\n         identifier = "../Products.storekit">\n      </StoreKitConfigurationFileReference>'
    : '';
  return xcodeSchemeTemplate({ appName, storeKitRef });
}

// MARK: - App icon + privacy manifest

/// Writes an Assets.xcassets with a 1024×1024 AppIcon into `folder`.
export function writeAppIcon(
  files: GeneratedFileTree,
  folder: string,
  appName: string,
  hex: string | undefined,
  platform: string = 'ios',
): void {
  const catalog = folder.length === 0 ? 'Assets.xcassets' : `${folder}/Assets.xcassets`;
  const iconSet = `${catalog}/AppIcon.appiconset`;
  files[`${catalog}/Contents.json`] = '{"info":{"author":"xcode","version":1}}';
  files[`${iconSet}/Contents.json`] =
    `{"images":[{"filename":"icon-1024.png","idiom":"universal","platform":"${platform}","size":"1024x1024"}],"info":{"author":"xcode","version":1}}`;
  const png = appIconPNGData(appName, hex);
  if (png !== undefined) files[`${iconSet}/icon-1024.png`] = { base64: bytesToBase64(png) };
}

/**
 * The Swift version draws a 1024×1024 vertical gradient (base → 22%-white
 * blend) with the app's initial in white via AppKit. AppKit text rasterisation
 * has no portable equivalent, so the port emits the same gradient without the
 * glyph — a valid, correctly sized placeholder icon.
 */
export function appIconPNGData(appName: string, hex: string | undefined): Uint8Array | undefined {
  const base = nsColor(hex) ?? deterministicColor(appName);
  const top = blendWithWhite(base, 0.22);
  return gradientPNG(1024, top, base);
}

export function nsColor(hex: string | undefined): RGB | undefined {
  if (hex === undefined || !hex.startsWith('#')) return undefined;
  const value = swiftDropFirst(hex);
  if (value.length !== 6) return undefined;
  const rgb = swiftHexInt(value);
  if (rgb === null) return undefined;
  return { r: (rgb >> 16) & 0xff, g: (rgb >> 8) & 0xff, b: rgb & 0xff };
}

/**
 * `deterministicColor(for:)` — Swift hashes the name with `hashValue`, which is
 * randomly seeded per process, so the macOS app's no-brand icon hue is not
 * reproducible by design. The port uses a stable FNV-1a hash instead: the same
 * "one distinct colour per app name" behaviour, deterministic across runs.
 */
export function deterministicColor(name: string): RGB {
  let hash = 0x811c9dc5;
  for (const ch of name) {
    hash ^= ch.codePointAt(0)! & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const hue = (hash % 360) / 360;
  return hsbToRGB(hue, 0.62, 0.72);
}

function blendWithWhite(color: RGB, fraction: number): RGB {
  return {
    r: color.r + (255 - color.r) * fraction,
    g: color.g + (255 - color.g) * fraction,
    b: color.b + (255 - color.b) * fraction,
  };
}

function hsbToRGB(h: number, s: number, b: number): RGB {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = b * (1 - s);
  const q = b * (1 - f * s);
  const t = b * (1 - (1 - f) * s);
  let r: number, g: number, bl: number;
  switch (i % 6) {
    case 0: r = b; g = t; bl = p; break;
    case 1: r = q; g = b; bl = p; break;
    case 2: r = p; g = b; bl = t; break;
    case 3: r = p; g = q; bl = b; break;
    case 4: r = t; g = p; bl = b; break;
    default: r = b; g = p; bl = q; break;
  }
  return { r: r * 255, g: g * 255, b: bl * 255 };
}

// MARK: - READMEs

export function xcodeReadme(project: DesignProject, appName: string, bundleId: string, hasWatch: boolean): string {
  return xcodeReadmeTemplate({
    projectName: project.name,
    appName,
    bundleId,
    watchNote: hasWatch
      ? `\n        The watch app (\`${bundleId}.watchkitapp\`) is a second target embedded\n        automatically into the iOS app under \`${appName}.app/Watch/\`. Archiving the\n        iOS app ships the watch app with it.\n`
      : '',
    watchFolders: hasWatch ? ', and `Watch/`' : '',
    firebaseNotes: firebaseReadmeNotes(project),
    firestoreNote: firestoreCollectionsExist(project)
      ? "- `firestore.rules` holds owner-scoped, deny-by-default security rules matching the flows — deploy them (`firebase deploy --only firestore:rules`) before shipping. Test them in the console's Rules Playground.\n"
      : '',
  });
}

/// Whatever Firebase setup is still MANUAL after this export.
export function firebaseReadmeNotes(project: DesignProject): string {
  const config = project.firebaseConfig;
  if (config === undefined || !config.isEnabled) return '';
  const lines = ['- Firebase: the firebase-ios-sdk package is already declared in the project.'];
  if (
    firebaseConfigIsConfigured(config) &&
    config.apiKey.length > 0 &&
    config.appId.length > 0 &&
    config.messagingSenderId.length > 0
  ) {
    lines.push(
      `- \`GoogleService-Info.plist\` was GENERATED from the project's Firebase credentials (project \`${config.projectId}\`) and is already in the app target — no manual drag needed.`,
    );
  } else {
    lines.push(
      '- `GoogleService-Info.plist` is MISSING (no Firebase credentials set). FirebaseApp.configure() traps without it: download it from the Firebase console, or set the credentials in the designer (set_firebase_config) and re-export.',
    );
  }
  const methods = [
    config.enableEmailAuth ? 'Email/Password' : undefined,
    config.enableGoogleAuth ? 'Google' : undefined,
    config.enableAppleAuth ? 'Apple' : undefined,
    config.enableAnonymousAuth ? 'Anonymous' : undefined,
  ].filter((m): m is string => m !== undefined);
  if (methods.length > 0) {
    lines.push(
      `- Enable these sign-in methods in the Firebase console (Authentication ▸ Sign-in method): ${methods.join(', ')}. The app cannot turn them on for you.`,
    );
  }
  if (config.publicReadCollections.length > 0) {
    lines.push(`- Shared collections (any signed-in user reads, owner writes): ${config.publicReadCollections.join(', ')}.`);
  }
  return lines.join('\n') + '\n';
}

export function firestoreCollectionsExist(project: DesignProject): boolean {
  return project.pages.some((page) => page.logicFlows.some((flow) => flow.blocks.some((b) => b.category === 'Firebase')));
}

export function readme(project: DesignProject, appName: string): string {
  void appName;
  const platforms = project.platformSettings.enabledPlatforms.map(appPlatformDisplayName).join(', ');
  return readmeTemplate({
    projectName: project.name,
    platforms: platforms.length === 0 ? 'iPhone, iPad' : platforms,
  });
}

// MARK: - Package.swift

export function packageSwift(appName: string, project: DesignProject, hasResources: boolean): string {
  const platforms = project.platformSettings.enabledPlatforms;
  const platformLines = platforms.map((platform) => {
    switch (platform) {
      case 'iPhone':
      case 'iPad': return '.iOS(.v17)';
      case 'appleWatch': return '.watchOS(.v10)';
    }
  });
  const uniquePlatforms = [...new Set(platformLines)].sort(swiftStringCompare).join(',\n        ');
  const firebaseEnabled = project.firebaseConfig?.isEnabled === true;

  const dependencies = firebaseEnabled
    ? ',\n    dependencies: [\n        .package(url: "https://github.com/firebase/firebase-ios-sdk", from: "10.0.0")\n    ]'
    : '';
  const targetDependencies = firebaseEnabled
    ? ',\n                    dependencies: [\n                        .product(name: "FirebaseAuth", package: "firebase-ios-sdk"),\n                        .product(name: "FirebaseFirestore", package: "firebase-ios-sdk"),\n                        .product(name: "FirebaseAnalytics", package: "firebase-ios-sdk")\n                    ]'
    : '';

  return packageSwiftTemplate({
    appName,
    platforms: uniquePlatforms.length === 0 ? '.iOS(.v17)' : uniquePlatforms,
    dependencies,
    resources: hasResources ? ',\n                    resources: [.process("Resources")]' : '',
    targetDependencies,
    firebaseNote: firebaseEnabled
      ? '// Firebase is enabled for this project — Xcode will resolve the package dependency above the first time you build. The fast "Run" button in AgenticDesigner compiles sources directly and cannot resolve SPM dependencies, so Firebase blocks only go live once you open Package.swift in Xcode and build normally.'
      : '',
  });
}

// MARK: - Info.plist

// Background location is required when a flow tracks continuously.
export function needsBackgroundLocation(flows: LogicFlow[]): boolean {
  return flows.some((flow) =>
    flow.blocks.some(
      (block) =>
        block.type === 'onLocationChanged' ||
        (block.type === 'startTracking' && (paramValue(block, 'background') ?? 'true') !== 'false'),
    ),
  );
}

// Scans every flow for blocks that need an iOS usage-description string.
export function requiredUsageDescriptions(flows: LogicFlow[]): { key: string; value: string }[] {
  const result = new Map<string, string>();
  for (const flow of flows) {
    for (const block of flow.blocks) {
      switch (block.type) {
        case 'requestPermission':
          switch (paramValue(block, 'kind') ?? 'camera') {
            case 'camera':
              result.set('NSCameraUsageDescription', 'This app uses the camera as part of its logic flows.');
              break;
            case 'photoLibrary':
              result.set('NSPhotoLibraryUsageDescription', 'This app accesses your photo library as part of its logic flows.');
              break;
            case 'location':
              result.set('NSLocationWhenInUseUsageDescription', 'This app uses your location as part of its logic flows.');
              break;
            case 'microphone':
              result.set('NSMicrophoneUsageDescription', 'This app uses the microphone as part of its logic flows.');
              break;
            default:
              break;
          }
          break;
        case 'biometricAuth':
          result.set('NSFaceIDUsageDescription', 'This app uses Face ID to authenticate you.');
          break;
        // A sensor block IS a permission requirement.
        case 'getLocation':
        case 'onLocationChanged':
        case 'startTracking':
          result.set(
            'NSLocationWhenInUseUsageDescription',
            'Your location is used to track distance and pace while you are active.',
          );
          break;
        case 'readHeartRate':
        case 'readStepCount':
          result.set('NSHealthShareUsageDescription', 'Heart rate and step data are read to show your activity statistics.');
          result.set('NSHealthUpdateUsageDescription', 'Workout data is written to Health so your activity stays in one place.');
          break;
        case 'readMotion':
        case 'onShake':
          result.set('NSMotionUsageDescription', 'Motion data is used to detect movement and device gestures.');
          break;
        default:
          break;
      }
    }
  }
  return [...result.entries()]
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => swiftStringCompare(a.key, b.key));
}

export function infoPlistSource(
  usageDescriptions: { key: string; value: string }[],
  needsBackgroundLocationFlag: boolean = false,
  orientation: AppOrientation = 'portrait',
): string {
  const entries = usageDescriptions.map((d) => `    <key>${d.key}</key>\n    <string>${d.value}</string>`);

  if (orientation !== 'portrait') {
    const items = appOrientationPlistOrientations(orientation)
      .map((o) => `        <string>${o}</string>`)
      .join('\n');
    entries.push('    <key>UISupportedInterfaceOrientations</key>\n    <array>\n' + items + '\n    </array>');
  }

  if (needsBackgroundLocationFlag) {
    entries.push(partialInfoPlistTemplate());
    entries.push(`    <key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
    <string>Your location is tracked during an activity, including when the screen is locked, so distance and pace stay accurate.</string>`);
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    entries.join('\n'),
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

/** The root partial Info.plist for the Xcode export (UIBackgroundModes). */
export function partialInfoPlist(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>UIBackgroundModes</key>
\t<array>
\t\t<string>location</string>
\t</array>
</dict>
</plist>
`;
}

/** The push entitlements file for the Xcode export. */
export function pushEntitlements(): string {
  return entitlementsTemplate();
}

// MARK: - Firebase

/// "Light" or "Dark" — whichever matches the authored palette.
export function forcedInterfaceStyle(project: DesignProject): string | undefined {
  const firstScreen = project.pages.flatMap((p) => p.nodes).find((n) => n.type === 'Frame');
  const fill = firstScreen?.style.fill;
  if (fill === undefined || !fill.startsWith('#') || fill.length < 7) return undefined;
  const value = swiftHexInt(swiftPrefix(swiftDropFirst(fill), 6));
  if (value === null) return undefined;
  const r = ((value >> 16) & 0xff) / 255;
  const g = ((value >> 8) & 0xff) / 255;
  const b = (value & 0xff) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b < 0.5 ? 'Dark' : 'Light';
}

/// The plist FirebaseApp.configure() looks for.
export function googleServiceInfoPlist(config: FirebaseConfig | undefined, bundleId: string): string | undefined {
  if (config === undefined || !config.isEnabled) return undefined;
  const required = [config.apiKey, config.appId, config.messagingSenderId, config.projectId];
  if (!required.every((value) => trimWhitespacesAndNewlines(value).length > 0)) return undefined;
  const bucket = config.storageBucket.length === 0 ? `${config.projectId}.appspot.com` : config.storageBucket;

  const entry = (key: string, value: string): string => `\t<key>${key}</key>\n\t<string>${xmlEscaped(value)}</string>`;
  const flag = (key: string, value: boolean): string => `\t<key>${key}</key>\n\t<${value}/>`;

  return googleServiceInfoPlistTemplate({
    apiKey: entry('API_KEY', config.apiKey),
    gcmSenderId: entry('GCM_SENDER_ID', config.messagingSenderId),
    googleAppId: entry('GOOGLE_APP_ID', config.appId),
    projectId: entry('PROJECT_ID', config.projectId),
    storageBucket: entry('STORAGE_BUCKET', bucket),
    bundleId: entry('BUNDLE_ID', bundleId),
    plistVersion: entry('PLIST_VERSION', '1'),
    isAdsEnabled: flag('IS_ADS_ENABLED', false),
    isAnalyticsEnabled: flag('IS_ANALYTICS_ENABLED', false),
    isAppinviteEnabled: flag('IS_APPINVITE_ENABLED', true),
    isGcmEnabled: flag('IS_GCM_ENABLED', true),
    isSigninEnabled: flag('IS_SIGNIN_ENABLED', true),
  });
}

export function firebaseRCSource(projectId: string): string {
  return firebaseRCTemplate({ projectId });
}

export function xmlEscaped(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/// A collection the flows use, and whether documents in it are keyed by uid.
export interface FirestoreCollection {
  name: string;
  ownerScoped: boolean;
  collectionScoped: boolean;
}

export function firestoreCollections(flows: LogicFlow[], config?: FirebaseConfig): FirestoreCollection[] {
  const byName = new Map<string, FirestoreCollection>();
  // Only simple names — a value with a slash or brace would rewrite the rules.
  const validName = (name: string): boolean =>
    name.length > 0 && Array.from(name).every((ch) => isLetter(ch) || isNumberChar(ch) || ch === '_' || ch === '-');
  for (const flow of flows) {
    for (const block of flow.blocks) {
      const collection = paramValue(block, 'collection');
      if (collection === undefined || !validName(collection)) continue;
      const entry = byName.get(collection) ?? { name: collection, ownerScoped: false, collectionScoped: false };
      switch (block.type) {
        case 'firestoreSetDocument':
        case 'firestoreUpdateDocument':
        case 'firestoreDeleteDocument':
        case 'firestoreGetDocument': {
          const docId = paramValue(block, 'documentId') ?? '';
          if (docId.includes('{{uid}}') || docId.includes('{{userId}}') || docId.length !== 0) {
            entry.ownerScoped = true;
          } else {
            entry.collectionScoped = true;
          }
          break;
        }
        case 'firestoreAddDocument':
        case 'firestoreQuery':
          entry.collectionScoped = true;
          break;
        default:
          continue;
      }
      byName.set(collection, entry);
    }
  }
  // Collections the PROJECT declares but no flow touches yet.
  for (const template of config?.defaultCollections ?? []) {
    const name = template.name;
    if (!validName(name) || byName.has(name)) continue;
    byName.set(name, { name, ownerScoped: name === 'users', collectionScoped: name !== 'users' });
  }
  return [...byName.values()].sort((a, b) => swiftStringCompare(a.name, b.name));
}

/// Firestore rules: deny by default, owner-scoped.
export function firestoreRulesSource(collections: FirestoreCollection[], publicRead: string[] = []): string {
  const shared = new Set(publicRead);
  const blocks = collections
    .map((collection) => {
      if (shared.has(collection.name)) return firestoreSharedRuleTemplate({ name: collection.name });
      if (collection.ownerScoped) return firestoreOwnerScopedRuleTemplate({ name: collection.name });
      return firestoreCollectionScopedRuleTemplate({ name: collection.name });
    })
    .join('\n\n');
  return firestoreRulesTemplate({
    blocks: blocks.length === 0 ? '        // No user-scoped collections detected in the flows.' : blocks,
  });
}

// MARK: - .xcodeproj

export function xcodeProjectPBX(options: {
  appName: string;
  bundleId: string;
  hasWatch: boolean;
  usageDescriptions: { key: string; value: string }[];
  needsBackgroundLocation: boolean;
  firebaseEnabled: boolean;
  usesPush?: boolean;
  orientation?: AppOrientation;
  developmentTeam?: string;
  forcedInterfaceStyle?: string;
}): string {
  const {
    appName,
    bundleId,
    hasWatch,
    usageDescriptions,
    needsBackgroundLocation: needsBackgroundLocationFlag,
    firebaseEnabled,
    usesPush = false,
    orientation = 'portrait',
    developmentTeam,
    forcedInterfaceStyle: styleValue,
  } = options;

  const infoplistLine = (key: string, value: string): string => {
    const escaped = value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
    return `\t\t\t\tINFOPLIST_KEY_${key} = "${escaped}";`;
  };
  const iosKeys = usageDescriptions.map((d) => infoplistLine(d.key, d.value));
  if (needsBackgroundLocationFlag) {
    iosKeys.push(
      infoplistLine(
        'NSLocationAlwaysAndWhenInUseUsageDescription',
        'Your location is tracked during an activity, including when the screen is locked, so distance and pace stay accurate.',
      ),
    );
  }
  const iosUsage = [...iosKeys].sort(swiftStringCompare).join('\n');
  // Orientation: a landscape game that ships portrait-locked is broken.
  const orientationSettings = (() => {
    if (orientation === 'portrait') return '';
    const phone = appOrientationPlistOrientations(orientation).join(' ');
    return (
      `\t\t\t\tINFOPLIST_KEY_UISupportedInterfaceOrientations_iPhone = "${phone}";\n` +
      `\t\t\t\tINFOPLIST_KEY_UISupportedInterfaceOrientations_iPad = "${phone} UIInterfaceOrientationPortraitUpsideDown";\n`
    );
  })();
  const infoplistFileLine = needsBackgroundLocationFlag ? '\t\t\t\tINFOPLIST_FILE = Info.plist;\n' : '';
  const entitlementsLine = usesPush ? `\t\t\t\tCODE_SIGN_ENTITLEMENTS = ${appName}.entitlements;\n` : '';

  // The watch target always reads Health.
  const watchKeys = [
    infoplistLine('NSHealthShareUsageDescription', 'Heart rate and step data are read to show your activity statistics.'),
    infoplistLine('NSHealthUpdateUsageDescription', 'Workout data is written to Health so your activity stays in one place.'),
    '\t\t\t\tINFOPLIST_KEY_WKApplication = YES;',
    `\t\t\t\tINFOPLIST_KEY_WKCompanionAppBundleIdentifier = ${bundleId};`,
  ]
    .sort(swiftStringCompare)
    .join('\n');

  const teamLine = developmentTeam !== undefined ? `\t\t\t\tDEVELOPMENT_TEAM = ${developmentTeam};\n` : '';
  const styleLine = styleValue !== undefined ? `\t\t\t\tINFOPLIST_KEY_UIUserInterfaceStyle = ${styleValue};\n` : '';

  const iosBuildSettings = (): string =>
    iosBuildSettingsTemplate({
      teamLine,
      styleLine,
      entitlementsLine,
      infoplistFileLine,
      orientationSettings,
      iosUsage: iosUsage.length === 0 ? '' : iosUsage + '\n',
      bundleId,
    });
  const watchBuildSettings = (): string => watchBuildSettingsTemplate({ teamLine, appName, watchKeys, bundleId });

  // Firebase Swift Package products.
  const firebaseProducts: [string, string, string][] = [
    ['FirebaseAuth', 'DEAD00000000000000000021', 'DEAD00000000000000000024'],
    ['FirebaseFirestore', 'DEAD00000000000000000022', 'DEAD00000000000000000025'],
    ['FirebaseAnalytics', 'DEAD00000000000000000023', 'DEAD00000000000000000026'],
  ];
  const buildFileEntries: string[] = [];
  if (hasWatch) {
    buildFileEntries.push(
      `\t\tDEAD0000000000000000001B /* ${appName}Watch.app in Embed Watch Content */ = {isa = PBXBuildFile; fileRef = DEAD0000000000000000000A /* ${appName}Watch.app */; settings = {ATTRIBUTES = (RemoveHeadersOnCopy, ); }; };`,
    );
  }
  if (firebaseEnabled) {
    for (const [name, prodId, buildId] of firebaseProducts) {
      buildFileEntries.push(`\t\t${buildId} /* ${name} in Frameworks */ = {isa = PBXBuildFile; productRef = ${prodId} /* ${name} */; };`);
    }
  }
  const buildFileSection =
    buildFileEntries.length === 0 ? '' : pbxBuildFileSectionTemplate({ buildFileEntries: buildFileEntries.join('\n') });

  const iosFrameworkFiles = firebaseEnabled
    ? '\n' + firebaseProducts.map((p) => `\t\t\t\t${p[2]} /* ${p[0]} in Frameworks */,`).join('\n') + '\n\t\t\t'
    : '';
  const iosPackageDeps = firebaseEnabled
    ? '\n\t\t\tpackageProductDependencies = (\n' +
      firebaseProducts.map((p) => `\t\t\t\t${p[1]} /* ${p[0]} */,`).join('\n') +
      '\n\t\t\t);'
    : '';
  const projectPackageRefs = firebaseEnabled
    ? '\n\t\t\tpackageReferences = (\n\t\t\t\tDEAD00000000000000000020 /* XCRemoteSwiftPackageReference "firebase-ios-sdk" */,\n\t\t\t);'
    : '';
  const packageRefSection = firebaseEnabled
    ? pbxPackageRefSectionTemplate({
        productDependencies: firebaseProducts
          .map(
            ([name, prodId]) =>
              `\t\t${prodId} /* ${name} */ = {\n\t\t\tisa = XCSwiftPackageProductDependency;\n\t\t\tpackage = DEAD00000000000000000020 /* XCRemoteSwiftPackageReference "firebase-ios-sdk" */;\n\t\t\tproductName = ${name};\n\t\t};`,
          )
          .join('\n'),
      })
    : '';

  const containerProxySection = hasWatch ? pbxContainerProxySectionTemplate({ appName }) : '';
  const copyFilesSection = hasWatch ? pbxCopyFilesSectionTemplate({ appName }) : '';
  const watchFileRef = hasWatch
    ? `\n\t\tDEAD0000000000000000000A /* ${appName}Watch.app */ = {isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = ${appName}Watch.app; sourceTree = BUILT_PRODUCTS_DIR; };`
    : '';
  const watchSyncGroup = hasWatch ? pbxWatchSyncGroupTemplate() : '';
  const watchGroupChild = hasWatch ? '\n\t\t\t\tDEAD00000000000000000006 /* Watch */,' : '';
  const watchProductChild = hasWatch ? `\n\t\t\t\tDEAD0000000000000000000A /* ${appName}Watch.app */,` : '';
  const watchFrameworksPhase = hasWatch
    ? '\n\t\tDEAD00000000000000000019 /* Frameworks */ = {isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; };'
    : '';
  const watchSourcesPhase = hasWatch
    ? '\n\t\tDEAD00000000000000000018 /* Sources */ = {isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; };'
    : '';
  const watchResourcesPhase = hasWatch
    ? '\n\t\tDEAD0000000000000000001A /* Resources */ = {isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; };'
    : '';
  const iosEmbedPhaseRef = hasWatch ? '\n\t\t\t\tDEAD00000000000000000017 /* Embed Watch Content */,' : '';
  const iosDependency = hasWatch ? '\n\t\t\t\tDEAD0000000000000000001C /* PBXTargetDependency */,' : '';
  const watchTarget = hasWatch ? pbxWatchTargetTemplate({ appName }) : '';
  const targetDependencySection = hasWatch ? pbxTargetDependencySectionTemplate({ appName }) : '';
  const watchTargetAttr = hasWatch ? '\n\t\t\t\t\tDEAD00000000000000000008 = {CreatedOnToolsVersion = 26.6; };' : '';
  const watchTargetRef = hasWatch ? `\n\t\t\t\tDEAD00000000000000000008 /* ${appName}Watch */,` : '';
  const watchBuildConfigs = hasWatch
    ? pbxWatchBuildConfigsTemplate({ watchDebug: watchBuildSettings(), watchRelease: watchBuildSettings() })
    : '';
  const watchConfigList = hasWatch ? pbxWatchConfigListTemplate({ appName }) : '';

  return pbxProjectTemplate({
    appName,
    buildFileSection,
    containerProxySection,
    copyFilesSection,
    watchFileRef,
    watchSyncGroup,
    iosFrameworkFiles,
    watchFrameworksPhase,
    watchGroupChild,
    watchProductChild,
    iosEmbedPhaseRef,
    iosDependency,
    iosPackageDeps,
    watchTarget,
    watchTargetAttr,
    projectPackageRefs,
    watchTargetRef,
    watchResourcesPhase,
    watchSourcesPhase,
    targetDependencySection,
    iosDebug: iosBuildSettings(),
    iosRelease: iosBuildSettings(),
    watchBuildConfigs,
    watchConfigList,
    packageRefSection,
  });
}

/** `sanitizedBundleId(_:)` — reverse-DNS ids are [A-Za-z0-9.-] only. */
export function sanitizedBundleId(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = trimWhitespacesAndNewlines(raw);
  if (trimmed.length === 0) return undefined;
  const allowed = Array.from(trimmed)
    .filter((ch) => isLetter(ch) || isNumberChar(ch) || ch === '.' || ch === '-')
    .join('');
  return allowed.includes('.') ? allowed : undefined;
}

/** `exportAppName(project:)` */
export function exportAppName(project: DesignProject): string {
  return swiftIdentifier(project.name, 'ExportedApp');
}
