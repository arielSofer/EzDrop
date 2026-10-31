"""Extracts LogicExporter.swift's interpolated multiline literals into
TypeScript template functions, so every generated file is byte-identical to
the macOS app's output. Each entry names the literal by a unique marker and
maps its Swift interpolations to template parameters.
    python3 scripts/extract-templates.py
"""
import re, os, sys

SWIFT = '/Users/ariel/Documents/XcodeApps/AgenticDesigner/AgenticDesigner/Services/LogicExporter.swift'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'services', 'logicExporter', 'templates.ts')
lines = open(SWIFT, encoding='utf-8').read().split('\n')

def all_literals():
    out = []
    i = 0
    while i < len(lines):
        l = lines[i]
        if l.rstrip().endswith('"""'):
            indent = None
            for j in range(i + 1, len(lines)):
                if lines[j].lstrip().startswith('"""'):
                    indent = len(lines[j]) - len(lines[j].lstrip()); close = j; break
            if indent is None:
                i += 1; continue
            body = [(x[indent:] if len(x) >= indent else x.strip()) for x in lines[i + 1:close]]
            out.append(('\n'.join(body), i + 1))
            i = close + 1
            continue
        i += 1
    return out

LITERALS = all_literals()

def find(marker, occurrence=0):
    hits = [t for t in LITERALS if marker in t[0]]
    if not hits:
        raise SystemExit('marker not found: ' + marker)
    if occurrence >= len(hits):
        raise SystemExit('marker %r has only %d hits' % (marker, len(hits)))
    return hits[occurrence]

def parse(text, mapping, name):
    """Swift literal → TS template body, replacing \\(expr) with ${...}."""
    out = []
    i = 0
    while i < len(text):
        ch = text[i]
        if ch == '\\' and i + 1 < len(text):
            nxt = text[i + 1]
            if nxt == '\\': out.append('\\\\'); i += 2; continue
            if nxt == '"': out.append('"'); i += 2; continue
            if nxt == 'n': out.append('\\n'); i += 2; continue
            if nxt == 't': out.append('\\t'); i += 2; continue
            if nxt == '(':
                depth = 1; m = i + 2; instr = False
                while m < len(text) and depth > 0:
                    c = text[m]
                    if c == '"': instr = not instr
                    elif not instr and c == '(': depth += 1
                    elif not instr and c == ')': depth -= 1
                    m += 1
                expr = text[i + 2:m - 1]
                if expr in mapping:
                    ts = mapping[expr]
                elif re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', expr):
                    ts = expr
                else:
                    raise SystemExit('unmapped interpolation in %s: %r' % (name, expr))
                out.append('${v.' + ts + '}')
                i = m; continue
        if ch == '\\': out.append('\\\\'); i += 1; continue
        if ch == '`': out.append('\\`'); i += 1; continue
        if ch == '$' and i + 1 < len(text) and text[i + 1] == '{': out.append('\\${'); i += 1; continue
        out.append(ch); i += 1
    return ''.join(out)

# (tsName, marker, occurrence, {swift expr: ts param})
ENTRIES = [
    ('supportSourceTemplate', 'enum GeneratedAssetMap', 0, {
        'hasResources ? generatedImageSource(appName: appName) : ""': 'generatedImage',
    }),
    ('generatedImageSourceTemplate', 'enum GeneratedResources {', 0, {}),
    ('appStateSourceTemplate', 'final class AppState: ObservableObject', 0, {
        'applyLines.isEmpty ? "        // No scalar variables to restore." : applyLines': 'applyLines',
    }),
    ('rootViewSourceTemplate', 'struct RootView: View', 0, {
        'indent(launchCalls.isEmpty ? "// no app launch actions" : launchCalls, spaces: 12)': 'launchCalls',
        'swiftString(firstFill)': 'firstFill',
    }),
    ('gameScreenSourceTemplate', 'AgentGameView(spec: GameSceneLoader.load(', 0, {
        'swiftString(gameSceneResourceName(for: screen))': 'sceneResource',
        'eventLines.joined(separator: "\\n                            ")': 'eventLines',
    }),
    ('screenSourceTemplate', 'ZStack(alignment: .top) {', 0, {
        'indent(appearCalls.isEmpty ? "// no screen appear actions" : appearCalls, spaces: 12)': 'appearCalls',
        'indent(disappearCalls.isEmpty ? "// no screen disappear actions" : disappearCalls, spaces: 12)': 'disappearCalls',
    }),
    ('scrollingContentBlockTemplate', 'ScrollView(.vertical, showsIndicators: false) {', 0, {
        'Int(screen.width)': 'screenWidth',
        'Int(contentHeight)': 'contentHeight',
    }),
    ('staticContentBlockTemplate', '), height: \\(Int(screen.height)))', 0, {
        'Int(screen.width)': 'screenWidth',
        'Int(screen.height)': 'screenHeight',
    }),
    ('watchRootSourceTemplate', 'struct WatchRootView: View', 0, {
        'indent(launchCalls.isEmpty ? "// no app launch actions" : launchCalls, spaces: 12)': 'launchCalls',
    }),
    ('watchScreenSourceTemplate', 'WatchView: View {', 0, {
        'crownVar != nil ? crownState : ""': 'crownState',
        'max(Int(screen.width), 1)': 'safeWidth',
        'max(Int(screen.height), 1)': 'safeHeight',
        'Int(screen.width)': 'screenWidth',
        'Int(screen.height)': 'screenHeight',
        'indent(appearCalls.isEmpty ? "// no screen appear actions" : appearCalls, spaces: 12)': 'appearCalls',
    }),
    ('crownModifierTemplate', '.digitalCrownRotation($__crown', 0, {}),
    ('crownOnChangeTemplate', '.onChange(of: __crown)', 0, {
        'indent(crownCalls.isEmpty ? "" : crownCalls, spaces: 16)': 'crownCalls',
    }),
    ('actionsSourceTemplate', 'final class GeneratedActions', 0, {
        'functions.joined(separator: "\\n\\n")': 'functions',
    }),
    ('actionFunctionTemplate', 'func \\(name)() async {', 0, {
        'indent(body.isEmpty ? "print(\\"No generated actions for \\(swiftEscaped(flow.name))\\")" : body, spaces: 8)': 'body',
    }),
    ('customEventDispatcherTemplate', 'func runCustomEvent(named name: String) async {', 0, {
        'dispatcherCases.isEmpty ? "        case \\"__none\\": break" : dispatcherCases': 'dispatcherCases',
    }),
    ('xcodeAppEntryTemplate', 'struct \\(structName): App {', 0, {}),
    ('appSourceTemplate', 'struct \\(appName)App: App {', 0, {}),
    ('packageSwiftTemplate', 'swift-tools-version', 0, {
        'uniquePlatforms.isEmpty ? ".iOS(.v17)" : uniquePlatforms': 'platforms',
        'hasResources ? ",\\n                    resources: [.process(\\"Resources\\")]" : ""': 'resources',
        'firebaseEnabled ? "// Firebase is enabled for this project — Xcode will resolve the package dependency above the first time you build. The fast \\"Run\\" button in AgenticDesigner compiles sources directly and cannot resolve SPM dependencies, so Firebase blocks only go live once you open Package.swift in Xcode and build normally." : ""': 'firebaseNote',
    }),
    ('readmeTemplate', 'SwiftUI Export', 0, {
        'project.name': 'projectName',
        'platforms.isEmpty ? "iPhone, iPad" : platforms': 'platforms',
    }),
    ('xcodeReadmeTemplate', '— Xcode Project', 0, {
        'project.name': 'projectName',
        'hasWatch ? "\\n        The watch app (`\\(bundleId).watchkitapp`) is a second target embedded\\n        automatically into the iOS app under `\\(appName).app/Watch/`. Archiving the\\n        iOS app ships the watch app with it.\\n" : ""': 'watchNote',
        'hasWatch ? ", and `Watch/`" : ""': 'watchFolders',
        'firebaseReadmeNotes(project)': 'firebaseNotes',
        'firestoreCollectionsExist(project) ? "- `firestore.rules` holds owner-scoped, deny-by-default security rules matching the flows — deploy them (`firebase deploy --only firestore:rules`) before shipping. Test them in the console\'s Rules Playground.\\n" : ""': 'firestoreNote',
    }),
    ('storeKitProductTemplate', '"displayPrice"', 0, {}),
    ('storeKitConfigTemplate', '"nonRenewingSubscriptions"', 0, {}),
    ('xcodeSchemeTemplate', '<Scheme', 0, {}),
    ('firestoreSharedRuleTemplate', ': shared — any signed-in user reads', 0, {
        'collection.name': 'name',
    }),
    ('firestoreOwnerScopedRuleTemplate', ': documents named by uid', 0, {
        'collection.name': 'name',
    }),
    ('firestoreCollectionScopedRuleTemplate', ': auto-ID documents, scoped by a userId field', 0, {
        'collection.name': 'name',
    }),
    ('firestoreRulesTemplate', "rules_version = '2';", 0, {
        'blocks.isEmpty ? "        // No user-scoped collections detected in the flows." : blocks': 'blocks',
    }),
    ('googleServiceInfoPlistTemplate', 'API_KEY', 0, {
        'entry("API_KEY", config.apiKey)': 'apiKey',
        'entry("GCM_SENDER_ID", config.messagingSenderId)': 'gcmSenderId',
        'entry("GOOGLE_APP_ID", config.appId)': 'googleAppId',
        'entry("PROJECT_ID", config.projectId)': 'projectId',
        'entry("STORAGE_BUCKET", bucket)': 'storageBucket',
        'entry("BUNDLE_ID", bundleId)': 'bundleId',
        'entry("PLIST_VERSION", "1")': 'plistVersion',
        'flag("IS_ADS_ENABLED", false)': 'isAdsEnabled',
        'flag("IS_ANALYTICS_ENABLED", false)': 'isAnalyticsEnabled',
        'flag("IS_APPINVITE_ENABLED", true)': 'isAppinviteEnabled',
        'flag("IS_GCM_ENABLED", true)': 'isGcmEnabled',
        'flag("IS_SIGNIN_ENABLED", true)': 'isSigninEnabled',
    }),
    ('firebaseRCTemplate', '"projects"', 0, {}),
    ('partialInfoPlistTemplate', 'UIBackgroundModes', 1, {}),
    ('entitlementsTemplate', 'aps-environment', 0, {}),
    ('pbxBuildFileSectionTemplate', '/* Begin PBXBuildFile section */', 0, {
        'buildFileEntries.joined(separator: "\\n")': 'buildFileEntries',
    }),
    ('pbxPackageRefSectionTemplate', 'Begin XCRemoteSwiftPackageReference section', 0, {
        'firebaseProducts.map { name, prodId, _ in\n"\\t\\t\\(prodId) /* \\(name) */ = {\\n\\t\\t\\tisa = XCSwiftPackageProductDependency;\\n\\t\\t\\tpackage = DEAD00000000000000000020 /* XCRemoteSwiftPackageReference \\"firebase-ios-sdk\\" */;\\n\\t\\t\\tproductName = \\(name);\\n\\t\\t};"\n}.joined(separator: "\\n")': 'productDependencies',
    }),
    ('pbxContainerProxySectionTemplate', 'Begin PBXContainerItemProxy section', 0, {}),
    ('pbxCopyFilesSectionTemplate', 'Begin PBXCopyFilesBuildPhase section', 0, {}),
    ('pbxWatchSyncGroupTemplate', 'path = Watch;', 0, {}),
    ('pbxWatchTargetTemplate', 'productName = \\(appName)Watch;', 0, {}),
    ('pbxTargetDependencySectionTemplate', 'Begin PBXTargetDependency section', 0, {}),
    ('pbxWatchBuildConfigsTemplate', 'DEAD00000000000000000012 /* Debug */', 0, {
        'watchBuildSettings("Debug")': 'watchDebug',
        'watchBuildSettings("Release")': 'watchRelease',
    }),
    ('pbxWatchConfigListTemplate', 'buildConfigurations = (DEAD00000000000000000012', 0, {}),
    ('iosBuildSettingsTemplate', 'IPHONEOS_DEPLOYMENT_TARGET = 17.0;', 0, {
        'iosUsage.isEmpty ? "" : iosUsage + "\\n"': 'iosUsage',
    }),
    ('watchBuildSettingsTemplate', 'WATCHOS_DEPLOYMENT_TARGET = 10.0;', 0, {}),
    ('pbxProjectTemplate', '// !$*UTF8*$!', 0, {
        'iosBuildSettings("Debug")': 'iosDebug',
        'iosBuildSettings("Release")': 'iosRelease',
    }),
]

parts = ["""// GENERATED by scripts/extract-templates.py from
// AgenticDesigner/Services/LogicExporter.swift — every interpolated Swift
// literal the exporter emits, extracted verbatim with its interpolations
// turned into template parameters. Do not edit by hand; re-run the script.
/* eslint-disable */
"""]
for name, marker, occurrence, mapping in ENTRIES:
    text, line = find(marker, occurrence)
    body = parse(text, mapping, name)
    params = sorted(set(re.findall(r'\$\{v\.([A-Za-z0-9_]+)\}', body)))
    if params:
        sig = 'v: { ' + '; '.join('%s: string' % p for p in params) + ' }'
    else:
        sig = '_v?: Record<string, never>'
    parts.append('/** LogicExporter.swift line %d */\nexport function %s(%s): string {\n  return `%s`;\n}\n' % (line, name, sig, body))

open(os.path.abspath(OUT), 'w', encoding='utf-8').write('\n'.join(parts))
print('wrote', os.path.abspath(OUT), 'entries:', len(ENTRIES))
