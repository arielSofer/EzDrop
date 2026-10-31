// Ported 1:1 from AgenticDesigner/Services/LogicExporter.swift — asyncSetup /
// supabaseSetup / permissionSetup: every block that "does the work, sets a
// local success flag, then branches on it".

import type { DesignNode } from '../../models/DesignNode';
import type { DesignProject } from '../../models/DesignProject';
import { supabaseConfigIsConfigured } from '../../models/SupabaseConfig';
import type { LogicBlock } from '../../models/LogicModels';
import {
  firestoreQueryConstraints,
  keyValueLiteral,
  swiftInterpolatedString,
  swiftStringParam,
  swiftValueExpr,
} from './expressions';
import {
  findNode,
  indent,
  nodeReference,
  paramValue,
  swiftEscaped,
  swiftIdentifier,
  swiftString,
  variableReference,
} from './helpers';
import { swiftSplit, trimWhitespaces, trimWhitespacesAndNewlines } from './swiftRuntime';
import type { VariableTypeMap } from './types';

export function asyncSetup(
  block: LogicBlock,
  flag: string,
  screens: DesignNode[],
  variableTypes: VariableTypeMap,
  project: DesignProject,
): string {
  // Canonically a "Store In" target is a .variableReference, set by the GUI
  // inspector. But an agent driving via MCP may pass the variable name as a
  // plain value; honour that too.
  const store = (key: string = 'variable'): string | undefined => {
    const fallbackParam = block.parameters.find((p) => p.key === key && p.type === 'variable')?.value;
    const fallback = fallbackParam === undefined ? undefined : trimWhitespacesAndNewlines(fallbackParam);
    const ref = variableReference(block, key) ?? (fallback !== undefined && fallback.length > 0 ? fallback : undefined);
    return ref === undefined ? undefined : `state.${swiftIdentifier(ref, 'value')}`;
  };

  // Reads a parameter that names a TEXT FIELD (Email/Password on an auth
  // block) rather than a value.
  const fieldValue = (key: string): string => {
    const nodeId = nodeReference(block, key);
    if (nodeId !== undefined) {
      const node = findNode(nodeId, screens);
      const binding = node?.logicBindings?.find((b) => b.kind === 'value' || b.kind === 'text');
      if (node !== undefined && binding !== undefined) {
        return `state.${swiftIdentifier(binding.variableName, 'value')}`;
      }
    }
    return swiftValueExpr(block, key, variableTypes);
  };

  switch (block.type) {

    // MARK: Device sensors

    case 'startTracking': {
      const distanceRef = variableReference(block, 'distanceVariable');
      const distanceVar = distanceRef === undefined ? undefined : `state.${swiftIdentifier(distanceRef, 'distance')}`;
      const speedRef = variableReference(block, 'speedVariable');
      const speedVar = speedRef === undefined ? undefined : `state.${swiftIdentifier(speedRef, 'speed')}`;
      const background = (paramValue(block, 'background') ?? 'true') !== 'false';
      const capture = distanceVar !== undefined || speedVar !== undefined ? '[state] ' : '';
      return `var ${flag} = false
#if canImport(CoreLocation)
if await Permissions.requestLocation() {
    // Capture the AppState reference explicitly (it's an
    // ObservableObject, so the mutation propagates to the UI).
    LocationService.shared.onDistanceChange = { ${capture}meters, kmh in
        ${distanceVar !== undefined ? `${distanceVar} = meters` : '_ = meters'}
        ${speedVar !== undefined ? `${speedVar} = kmh` : '_ = kmh'}
    }
    LocationService.shared.startTracking(background: ${background})
    ${flag} = true
}
#endif`;
    }

    case 'stopTracking':
      return `#if canImport(CoreLocation)
LocationService.shared.stopTracking()
#endif`;

    // MARK: Apple Watch
    case 'startWatchWorkout': {
      const activity = paramValue(block, 'activity') ?? 'running';
      const hkActivity = (() => {
        switch (activity) {
          case 'walking': return '.walking';
          case 'cycling': return '.cycling';
          case 'hiking': return '.hiking';
          case 'swimming': return '.swimming';
          case 'other': return '.other';
          default: return '.running';
        }
      })();
      return `var ${flag} = false
#if os(watchOS) && canImport(HealthKit)
await WatchWorkoutService.shared.start(activity: ${hkActivity})
${flag} = WatchWorkoutService.shared.isRunning
#endif`;
    }

    case 'pauseWatchWorkout':
      return `#if os(watchOS) && canImport(HealthKit)
if WatchWorkoutService.shared.isPaused {
    WatchWorkoutService.shared.resume()
} else {
    WatchWorkoutService.shared.pause()
}
#endif`;

    case 'endWatchWorkout':
      return `#if os(watchOS) && canImport(HealthKit)
await WatchWorkoutService.shared.finish()
#endif`;

    case 'watchHaptic': {
      const type = paramValue(block, 'type') ?? 'notification';
      const hkType = (() => {
        switch (type) {
          case 'success': return '.success';
          case 'failure': return '.failure';
          case 'retry': return '.retry';
          case 'start': return '.start';
          case 'stop': return '.stop';
          case 'click': return '.click';
          case 'directionUp': return '.directionUp';
          case 'directionDown': return '.directionDown';
          default: return '.notification';
        }
      })();
      return `#if os(watchOS) && canImport(WatchKit)
WKInterfaceDevice.current().play(${hkType})
#endif`;
    }

    case 'getLocation': {
      const lat = store('latitudeVariable');
      const lon = store('longitudeVariable');
      return `var ${flag} = false
#if canImport(CoreLocation)
if let __loc_${flag} = await LocationService.shared.requestOnce() {
    ${lat !== undefined ? `${lat} = __loc_${flag}.coordinate.latitude` : ''}
    ${lon !== undefined ? `${lon} = __loc_${flag}.coordinate.longitude` : ''}
    ${flag} = true
}
#endif`;
    }

    case 'readHeartRate': {
      const target = store();
      return `var ${flag} = false
#if canImport(HealthKit)
if await HealthService.shared.requestAuthorization(),
   let __bpm_${flag} = await HealthService.shared.latestHeartRate() {
    ${target !== undefined ? `${target} = __bpm_${flag}` : ''}
    ${flag} = true
}
#endif`;
    }

    case 'readStepCount': {
      const target = store();
      return `var ${flag} = false
#if canImport(HealthKit)
if await HealthService.shared.requestAuthorization(),
   let __steps_${flag} = await HealthService.shared.todaySteps() {
    ${target !== undefined ? `${target} = __steps_${flag}` : ''}
    ${flag} = true
}
#endif`;
    }

    case 'readMotion': {
      const xVar = store('xVariable');
      const yVar = store('yVariable');
      const zVar = store('zVariable');
      return `var ${flag} = false
#if canImport(CoreMotion)
if MotionService.shared.readOnce() {
    ${xVar !== undefined ? `${xVar} = MotionService.shared.x` : ''}
    ${yVar !== undefined ? `${yVar} = MotionService.shared.y` : ''}
    ${zVar !== undefined ? `${zVar} = MotionService.shared.z` : ''}
    ${flag} = true
}
#endif`;
    }

    case 'readBatteryLevel': {
      const target = store();
      return `var ${flag} = false
if let __battery_${flag} = DeviceInfo.batteryPercent() {
    ${target !== undefined ? `${target} = __battery_${flag}` : ''}
    ${flag} = true
}`;
    }

    // MARK: HTTP
    case 'httpRequest': {
      const url = swiftStringParam(block, 'url', variableTypes);
      const method = swiftStringParam(block, 'method', variableTypes);
      const rawBody = paramValue(block, 'body');
      const body = rawBody === undefined ? undefined : swiftInterpolatedString(rawBody, variableTypes);
      const headerLines = swiftSplit(paramValue(block, 'headers') ?? '', '\n')
        .map((line) => {
          const parts = swiftSplit(line, '=', 1).map(trimWhitespaces);
          if (parts.length !== 2) return undefined;
          return `request.setValue(${swiftInterpolatedString(parts[1]!, variableTypes)}, forHTTPHeaderField: ${swiftString(parts[0]!)})`;
        })
        .filter((l): l is string => l !== undefined)
        .join('\n');
      return `var ${flag} = false
do {
    guard let __url_${flag} = URL(string: ${url}) else { throw URLError(.badURL) }
    var request = URLRequest(url: __url_${flag})
    request.httpMethod = ${method}
    // Consume anything Set Header / Set Body queued before this call.
    for (__k, __v) in __pendingHeaders { request.setValue(__v, forHTTPHeaderField: __k) }
    if let __pb = __pendingBody { request.httpBody = __pb; request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
    __pendingHeaders = [:]; __pendingBody = nil
${headerLines.length === 0 ? '' : indent(headerLines, 4) + '\n'}${body !== undefined ? `    request.httpBody = Data((${body}).utf8)\n    request.setValue("application/json", forHTTPHeaderField: "Content-Type")\n` : ''}    let (data, response) = try await URLSession.shared.data(for: request)
    __lastResponseData = data
    __lastStatusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
    ${flag} = (200..<300).contains(__lastStatusCode)
} catch {
    print("HTTP Request failed: \\(error.localizedDescription)")
}`;
    }

    case 'setRequestHeader': {
      const key = swiftStringParam(block, 'key', variableTypes);
      const value = swiftStringParam(block, 'value', variableTypes);
      return `__pendingHeaders[${key}] = ${value}\nlet ${flag} = true`;
    }

    case 'setRequestBody': {
      const bodyValue = swiftStringParam(block, 'body', variableTypes);
      return `__pendingBody = Data((${bodyValue}).utf8)\nlet ${flag} = true`;
    }

    case 'buildURL': {
      const storeIn = store();
      if (storeIn === undefined) return `let ${flag} = false`;
      const base = swiftStringParam(block, 'base', variableTypes);
      const path = swiftStringParam(block, 'path', variableTypes);
      const queryLiteral = keyValueLiteral(block, 'query', variableTypes);
      return `var ${flag} = false
do {
    var __components_${flag} = URLComponents(string: ${base} + ${path})
    let __query_${flag}: [String: Any] = ${queryLiteral}
    if !__query_${flag}.isEmpty {
        __components_${flag}?.queryItems = __query_${flag}.map { URLQueryItem(name: $0.key, value: String(describing: $0.value)) }
    }
    if let __built_${flag} = __components_${flag}?.url?.absoluteString {
        ${storeIn} = __built_${flag}
        ${flag} = true
    }
}`;
    }

    case 'parseJSONResponse': {
      const storeIn = store();
      if (storeIn === undefined) return `let ${flag} = false`;
      const path = paramValue(block, 'path') ?? '';
      const keys = swiftSplit(path, '.');
      const keyArray = '[' + keys.map((k) => swiftString(k)).join(', ') + ']';
      return `var ${flag} = false
if let __obj_${flag} = try? JSONSerialization.jsonObject(with: __lastResponseData) {
    var __cursor_${flag}: Any? = __obj_${flag}
    for __key_${flag} in ${keyArray} as [String] {
        if let __dict_${flag} = __cursor_${flag} as? [String: Any] {
            __cursor_${flag} = __dict_${flag}[__key_${flag}]
        } else if let __arr_${flag} = __cursor_${flag} as? [Any], let __idx_${flag} = Int(__key_${flag}), __arr_${flag}.indices.contains(__idx_${flag}) {
            __cursor_${flag} = __arr_${flag}[__idx_${flag}]
        } else {
            __cursor_${flag} = nil
        }
    }
    if let __value_${flag} = __cursor_${flag} {
        ${storeIn} = String(describing: __value_${flag})
        ${flag} = true
    }
}`;
    }

    case 'handleAPIError':
      return `var ${flag} = (200..<300).contains(__lastStatusCode)`;

    // MARK: Commerce & Push
    case 'purchaseProduct': {
      const productId = swiftStringParam(block, 'productId', variableTypes);
      const storeIn = store();
      return `var ${flag} = false
if let __txId_${flag} = await StoreService.shared.purchase(productId: ${productId}) {
    ${storeIn !== undefined ? `${storeIn} = __txId_${flag}` : `_ = __txId_${flag}`}
    ${flag} = true
}`;
    }

    case 'restorePurchases':
      return `let ${flag} = await StoreService.shared.restore()`;

    case 'registerForPush': {
      const storeIn = store();
      return `var ${flag} = false
#if os(iOS)
let __token_${flag} = await PushService.shared.register()
${storeIn !== undefined ? `if let __t_${flag} = __token_${flag} { ${storeIn} = __t_${flag} }` : ''}
${flag} = (__token_${flag} != nil)
#endif`;
    }

    case 'jsonParse': {
      const storeIn = store();
      if (storeIn === undefined) return `let ${flag} = false`;
      const input = swiftStringParam(block, 'input', variableTypes);
      return `var ${flag} = false
if let __data_${flag} = (${input}).data(using: .utf8), (try? JSONSerialization.jsonObject(with: __data_${flag})) != nil {
    ${storeIn} = ${input}
    ${flag} = true
}`;
    }

    // MARK: Firebase Auth
    case 'firebaseLogin': {
      const email = fieldValue('email');
      const password = fieldValue('password');
      return `var ${flag} = false
#if canImport(FirebaseAuth)
do {
    _ = try await Auth.auth().signIn(withEmail: ${email}, password: ${password})
    ${flag} = true
} catch {
    print("Firebase Login failed: \\(error.localizedDescription)")
}
#else
print("Firebase Login: add the Firebase SPM package (FirebaseAuth) to enable this.")
#endif`;
    }

    case 'firebaseRegister': {
      const email = fieldValue('email');
      const password = fieldValue('password');
      return `var ${flag} = false
#if canImport(FirebaseAuth)
do {
    _ = try await Auth.auth().createUser(withEmail: ${email}, password: ${password})
    ${flag} = true
} catch {
    print("Firebase Register failed: \\(error.localizedDescription)")
}
#else
print("Firebase Register: add the Firebase SPM package (FirebaseAuth) to enable this.")
#endif`;
    }

    case 'firebaseLogout':
      return `var ${flag} = false
#if canImport(FirebaseAuth)
do {
    try Auth.auth().signOut()
    ${flag} = true
} catch {
    print("Firebase Logout failed: \\(error.localizedDescription)")
}
#else
print("Firebase Logout: add the Firebase SPM package (FirebaseAuth) to enable this.")
#endif`;

    case 'firebaseGetCurrentUser':
    case 'firebaseAuthStateChanged': {
      const storeIn = store();
      const storeName = (
        variableReference(block, 'variable') ??
        block.parameters.find((p) => p.key === 'variable')?.value ??
        ''
      ).toLowerCase();
      const wantsIdentity = storeName.includes('uid') || storeName.endsWith('id') || storeName.endsWith('userid');
      const storeLine = (() => {
        if (storeIn === undefined) return undefined;
        // Already assigned two lines up — assigning again would clobber it.
        if (storeIn === 'state.currentUserId') return undefined;
        return wantsIdentity
          ? `\n    ${storeIn} = __user_${flag}.uid`
          : `\n    ${storeIn} = __user_${flag}.email ?? __user_${flag}.uid`;
      })();
      return `var ${flag} = false
#if canImport(FirebaseAuth)
if let __user_${flag} = Auth.auth().currentUser {
    state.currentUserEmail = __user_${flag}.email ?? ""
    state.currentUserId = __user_${flag}.uid${storeLine ?? ''}
    ${flag} = true
}
#else
print("${swiftEscaped(block.label)}: add the Firebase SPM package (FirebaseAuth) to enable this.")
#endif`;
    }

    case 'firebaseResetPassword': {
      const email = fieldValue('email');
      return `var ${flag} = false
#if canImport(FirebaseAuth)
do {
    try await Auth.auth().sendPasswordReset(withEmail: ${email})
    ${flag} = true
} catch {
    print("Reset Password failed: \\(error.localizedDescription)")
}
#else
print("Reset Password: add the Firebase SPM package (FirebaseAuth) to enable this.")
#endif`;
    }

    case 'firebaseDeleteAccount':
      return `var ${flag} = false
#if canImport(FirebaseAuth)
do {
    try await Auth.auth().currentUser?.delete()
    ${flag} = true
} catch {
    print("Delete Account failed: \\(error.localizedDescription)")
}
#else
print("Delete Account: add the Firebase SPM package (FirebaseAuth) to enable this.")
#endif`;

    case 'firebaseUpdateProfile': {
      const rawName = paramValue(block, 'displayName');
      const name = rawName === undefined ? undefined : swiftInterpolatedString(rawName, variableTypes);
      const rawPhoto = paramValue(block, 'photoURL');
      const photo = rawPhoto === undefined ? undefined : swiftInterpolatedString(rawPhoto, variableTypes);
      return `var ${flag} = false
#if canImport(FirebaseAuth)
do {
    let __change_${flag} = Auth.auth().currentUser?.createProfileChangeRequest()
${name !== undefined ? `    __change_${flag}?.displayName = ${name}\n` : ''}${photo !== undefined ? `    __change_${flag}?.photoURL = URL(string: ${photo})\n` : ''}    try await __change_${flag}?.commitChanges()
    ${flag} = true
} catch {
    print("Update Profile failed: \\(error.localizedDescription)")
}
#else
print("Update Profile: add the Firebase SPM package (FirebaseAuth) to enable this.")
#endif`;
    }

    // MARK: Firestore
    case 'firestoreAddDocument':
    case 'firestoreSetDocument': {
      const collection = swiftStringParam(block, 'collection', variableTypes);
      const data = keyValueLiteral(block, 'data', variableTypes);
      const rawDocId = paramValue(block, 'documentId');
      const docId = rawDocId === undefined ? undefined : swiftInterpolatedString(rawDocId, variableTypes);
      const addOrSet =
        block.type === 'firestoreAddDocument' || docId === undefined
          ? `try await Firestore.firestore().collection(${collection}).addDocument(data: ${data})`
          : `try await Firestore.firestore().collection(${collection}).document(${docId}).setData(${data})`;
      return `var ${flag} = false
#if canImport(FirebaseFirestore)
do {
    _ = ${addOrSet}
    ${flag} = true
} catch {
    print("${swiftEscaped(block.label)} failed: \\(error.localizedDescription)")
}
#else
print("${swiftEscaped(block.label)}: add the Firebase SPM package (FirebaseFirestore) to enable this.")
#endif`;
    }

    case 'firestoreGetDocument': {
      const path = swiftStringParam(block, 'path', variableTypes);
      const storeIn = store();
      return `var ${flag} = false
#if canImport(FirebaseFirestore)
do {
    let __doc_${flag} = try await Firestore.firestore().document(${path}).getDocument()
${storeIn !== undefined ? `    ${storeIn} = GeneratedJSON.encode(__doc_${flag}.data() ?? [:])\n` : ''}    ${flag} = __doc_${flag}.exists
} catch {
    print("Get Document failed: \\(error.localizedDescription)")
}
#else
print("Get Document: add the Firebase SPM package (FirebaseFirestore) to enable this.")
#endif`;
    }

    case 'firestoreUpdateDocument': {
      const path = swiftStringParam(block, 'path', variableTypes);
      const data = keyValueLiteral(block, 'data', variableTypes);
      return `var ${flag} = false
#if canImport(FirebaseFirestore)
do {
    try await Firestore.firestore().document(${path}).updateData(${data})
    ${flag} = true
} catch {
    print("Update Document failed: \\(error.localizedDescription)")
}
#else
print("Update Document: add the Firebase SPM package (FirebaseFirestore) to enable this.")
#endif`;
    }

    case 'firestoreDeleteDocument': {
      const path = swiftStringParam(block, 'path', variableTypes);
      return `var ${flag} = false
#if canImport(FirebaseFirestore)
do {
    try await Firestore.firestore().document(${path}).delete()
    ${flag} = true
} catch {
    print("Delete Document failed: \\(error.localizedDescription)")
}
#else
print("Delete Document: add the Firebase SPM package (FirebaseFirestore) to enable this.")
#endif`;
    }

    case 'firestoreQuery': {
      const collection = swiftStringParam(block, 'collection', variableTypes);
      const limit = paramValue(block, 'limit');
      const storeIn = store();
      const constraints = firestoreQueryConstraints(block, flag, variableTypes);
      return `var ${flag} = false
#if canImport(FirebaseFirestore)
do {
    var __query_${flag}: Query = Firestore.firestore().collection(${collection})
${constraints}${limit !== undefined ? `    __query_${flag} = __query_${flag}.limit(to: ${limit})\n` : ''}    let __snapshot_${flag} = try await __query_${flag}.getDocuments()
${storeIn !== undefined ? `    ${storeIn} = GeneratedJSON.encode(__snapshot_${flag}.documents.map { __d -> [String: Any] in var __m = __d.data(); __m["_id"] = __d.documentID; return __m })\n` : ''}    ${flag} = true
} catch {
    print("Query Collection failed: \\(error.localizedDescription)")
}
#else
print("Query Collection: add the Firebase SPM package (FirebaseFirestore) to enable this.")
#endif`;
    }

    case 'firestoreListenDocument':
    case 'firestoreListenQuery': {
      // A LISTENER that isn't implemented must not claim success.
      const path =
        block.type === 'firestoreListenDocument'
          ? swiftStringParam(block, 'path', variableTypes)
          : swiftStringParam(block, 'collection', variableTypes);
      const storeIn = store();
      if (block.type === 'firestoreListenDocument') {
        return `var ${flag} = false
#if canImport(FirebaseFirestore)
do {
    // One-shot read standing in for a listener (native
    // addSnapshotListener codegen is not implemented yet).
    let __doc_${flag} = try await Firestore.firestore().document(${path}).getDocument()
${storeIn !== undefined ? `    ${storeIn} = GeneratedJSON.encode(__doc_${flag}.data() ?? [:])\n` : ''}    ${flag} = __doc_${flag}.exists
} catch {
    print("${swiftEscaped(block.label)} failed: \\(error.localizedDescription)")
}
#else
print("${swiftEscaped(block.label)}: add the Firebase SPM package (FirebaseFirestore) to enable this.")
#endif`;
      }
      return `var ${flag} = false
#if canImport(FirebaseFirestore)
do {
    // One-shot query standing in for a listener (native
    // addSnapshotListener codegen is not implemented yet).
    let __snapshot_${flag} = try await Firestore.firestore().collection(${path}).getDocuments()
${storeIn !== undefined ? `    ${storeIn} = GeneratedJSON.encode(__snapshot_${flag}.documents.map { __d -> [String: Any] in var __m = __d.data(); __m["_id"] = __d.documentID; return __m })\n` : ''}    ${flag} = true
} catch {
    print("${swiftEscaped(block.label)} failed: \\(error.localizedDescription)")
}
#else
print("${swiftEscaped(block.label)}: add the Firebase SPM package (FirebaseFirestore) to enable this.")
#endif`;
    }

    case 'firestoreBatchWrite':
      return `let ${flag} = false
print("${swiftEscaped(block.label)}: batch writes are not implemented in native export yet — taking the Error branch. Use individual Save/Update blocks instead.")`;

    // MARK: Supabase
    case 'supabaseInsert':
    case 'supabaseUpdate':
    case 'supabaseDelete':
    case 'supabaseQuery':
      return supabaseSetup(block, flag, variableTypes, project);

    // MARK: Supabase auth
    case 'supabaseSignUp':
    case 'supabaseSignIn':
    case 'supabaseSignOut':
    case 'supabaseCurrentUser': {
      const config = project.supabaseConfig;
      if (config === undefined || !supabaseConfigIsConfigured(config)) {
        return `let ${flag} = false // Supabase is not configured for this project`;
      }
      const baseURL = swiftString(config.projectURL);
      const anonKey = swiftString(config.anonKey);
      const sessionRef = variableReference(block, 'sessionVariable');
      const sessionVariable = sessionRef === undefined ? undefined : `state.${swiftIdentifier(sessionRef, 'session')}`;

      if (block.type === 'supabaseSignOut') {
        return `var ${flag} = true
${sessionVariable !== undefined ? `${sessionVariable} = ""` : ''}
AuthService.shared.signOut()`;
      }

      if (block.type === 'supabaseCurrentUser') {
        const userRef = variableReference(block, 'userVariable');
        const storeIn = userRef === undefined ? undefined : `state.${swiftIdentifier(userRef, 'user')}`;
        const token = sessionVariable ?? '""';
        return `var ${flag} = false
do {
    guard let __url_${flag} = URL(string: ${baseURL} + "/auth/v1/user") else { throw URLError(.badURL) }
    var __request_${flag} = URLRequest(url: __url_${flag})
    __request_${flag}.setValue(${anonKey}, forHTTPHeaderField: "apikey")
    __request_${flag}.setValue("Bearer \\(${token})", forHTTPHeaderField: "Authorization")
    let (__data_${flag}, __response_${flag}) = try await URLSession.shared.data(for: __request_${flag})
    let __status_${flag} = (__response_${flag} as? HTTPURLResponse)?.statusCode ?? 0
    ${flag} = (200..<300).contains(__status_${flag})
    ${storeIn !== undefined ? `if ${flag} { ${storeIn} = String(data: __data_${flag}, encoding: .utf8) ?? "" }` : ''}
} catch {
    ${flag} = false
}`;
      }

      // Sign up / sign in.
      const path = block.type === 'supabaseSignUp' ? '/auth/v1/signup' : '/auth/v1/token?grant_type=password';
      const email = swiftStringParam(block, 'email', variableTypes);
      const password = swiftStringParam(block, 'password', variableTypes);
      return `var ${flag} = false
do {
    guard let __url_${flag} = URL(string: ${baseURL} + ${swiftString(path)}) else { throw URLError(.badURL) }
    var __request_${flag} = URLRequest(url: __url_${flag})
    __request_${flag}.httpMethod = "POST"
    __request_${flag}.setValue(${anonKey}, forHTTPHeaderField: "apikey")
    __request_${flag}.setValue("application/json", forHTTPHeaderField: "Content-Type")
    __request_${flag}.httpBody = try? JSONSerialization.data(
        withJSONObject: ["email": ${email}, "password": ${password}]
    )
    let (__data_${flag}, __response_${flag}) = try await URLSession.shared.data(for: __request_${flag})
    let __status_${flag} = (__response_${flag} as? HTTPURLResponse)?.statusCode ?? 0
    let __json_${flag} = (try? JSONSerialization.jsonObject(with: __data_${flag})) as? [String: Any]
    if (200..<300).contains(__status_${flag}), let __token_${flag} = __json_${flag}?["access_token"] as? String {
        ${sessionVariable !== undefined ? `${sessionVariable} = __token_${flag}` : ''}
        let __user_${flag} = __json_${flag}?["user"] as? [String: Any]
        state.currentUserId = (__user_${flag}?["id"] as? String) ?? ""
        AuthService.shared.didSignIn(
            userId: state.currentUserId,
            email: ${email},
            verified: (__user_${flag}?["email_confirmed_at"] as? String) != nil
        )
        ${flag} = true
    }
} catch {
    ${flag} = false
}`;
    }

    // MARK: SQLite
    case 'sqliteQuery': {
      const sql = swiftStringParam(block, 'sql', variableTypes);
      const storeIn = store();
      return `var ${flag} = false
let __rows_${flag} = GeneratedSQLite.query(${sql})
${storeIn !== undefined ? `${storeIn} = GeneratedJSON.encode(__rows_${flag})\n` : ''}${flag} = __rows_${flag} != nil`;
    }

    case 'sqliteExecute': {
      const sql = swiftStringParam(block, 'sql', variableTypes);
      return `let ${flag} = GeneratedSQLite.execute(${sql})`;
    }

    // MARK: Algolia
    case 'algoliaSearch': {
      const appId = swiftStringParam(block, 'appId', variableTypes);
      const apiKey = swiftStringParam(block, 'apiKey', variableTypes);
      const index = swiftStringParam(block, 'index', variableTypes);
      const query = swiftStringParam(block, 'query', variableTypes);
      const storeIn = store();
      return `var ${flag} = false
do {
    var request = URLRequest(url: URL(string: "https://\\(${appId})-dsn.algolia.net/1/indexes/\\(${index})/query")!)
    request.httpMethod = "POST"
    request.setValue(${appId}, forHTTPHeaderField: "X-Algolia-Application-Id")
    request.setValue(${apiKey}, forHTTPHeaderField: "X-Algolia-API-Key")
    request.httpBody = try JSONSerialization.data(withJSONObject: ["params": "query=\\(${query})"])
    let (data, response) = try await URLSession.shared.data(for: request)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
${storeIn !== undefined ? `    ${storeIn} = String(data: data, encoding: .utf8) ?? ""\n` : ''}    ${flag} = (200..<300).contains(status)
} catch {
    print("Algolia Search failed: \\(error.localizedDescription)")
}`;
    }

    // MARK: Native async actions
    case 'downloadFile': {
      const url = swiftStringParam(block, 'url', variableTypes);
      const storeIn = store();
      return `var ${flag} = false
do {
    guard let __url_${flag} = URL(string: ${url}) else { throw URLError(.badURL) }
    let (__tempURL_${flag}, _) = try await URLSession.shared.download(from: __url_${flag})
${storeIn !== undefined ? `    ${storeIn} = __tempURL_${flag}.path\n` : ''}    ${flag} = true
} catch {
    print("Download File failed: \\(error.localizedDescription)")
}`;
    }

    case 'biometricAuth': {
      const reason = swiftStringParam(block, 'reason', variableTypes);
      return `var ${flag} = false
#if canImport(LocalAuthentication)
let __context_${flag} = LAContext()
if __context_${flag}.canEvaluatePolicy(.deviceOwnerAuthentication, error: nil) {
    ${flag} = (try? await __context_${flag}.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: ${reason})) ?? false
}
#endif`;
    }

    case 'requestPermission':
      return permissionSetup(block, flag);

    case 'confirmDialog': {
      const title = swiftStringParam(block, 'title', variableTypes);
      const message = swiftStringParam(block, 'message', variableTypes);
      const confirmLabel = swiftStringParam(block, 'confirmLabel', variableTypes);
      const cancelLabel = swiftStringParam(block, 'cancelLabel', variableTypes);
      return `let ${flag} = await state.confirm(title: ${title}, message: ${message}, confirmLabel: ${confirmLabel}, cancelLabel: ${cancelLabel})`;
    }

    case 'validateForm': {
      const nodeId = nodeReference(block, 'element');
      const node = nodeId === undefined ? undefined : findNode(nodeId, screens);
      if (nodeId === undefined || node === undefined) return `let ${flag} = false`;
      const binding = node.logicBindings?.find((b) => b.kind === 'value' || b.kind === 'text');
      const textExpr =
        binding !== undefined
          ? `String(describing: state.${swiftIdentifier(binding.variableName, 'value')})`
          : swiftString(node.text ?? '');
      const rule = paramValue(block, 'rule') ?? 'notEmpty';
      const argument = swiftStringParam(block, 'argument', variableTypes);
      let expr: string;
      switch (rule) {
        case 'email':
          expr = `(${textExpr}).range(of: "^\\\\S+@\\\\S+\\\\.\\\\S+$", options: .regularExpression) != nil`;
          break;
        case 'minLength':
          expr = `(${textExpr}).count >= (Int(${argument}) ?? 0)`;
          break;
        case 'matchesRegex':
          expr = `(${textExpr}).range(of: ${argument}, options: .regularExpression) != nil`;
          break;
        default:
          expr = `!(${textExpr}).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty`;
      }
      return `let ${flag} = ${expr}`;
    }

    default:
      return `let ${flag} = false // ${swiftEscaped(block.label)} has no export codegen yet`;
  }
}

export function supabaseSetup(
  block: LogicBlock,
  flag: string,
  variableTypes: VariableTypeMap,
  project: DesignProject,
): string {
  const config = project.supabaseConfig;
  if (config === undefined || !supabaseConfigIsConfigured(config)) {
    return `let ${flag} = false // Configure Supabase (project URL + anon key) to enable ${swiftEscaped(block.label)}`;
  }
  const baseURL = swiftString(config.projectURL);
  const anonKey = swiftString(config.anonKey);
  const table = swiftStringParam(block, 'table', variableTypes);
  const rawFilter = paramValue(block, 'filter');
  const filter = rawFilter === undefined ? undefined : swiftInterpolatedString(rawFilter, variableTypes);
  const storeRef = variableReference(block, 'variable');
  const storeIn = storeRef === undefined ? undefined : `state.${swiftIdentifier(storeRef, 'value')}`;

  let method: string;
  let bodyLine: string;
  switch (block.type) {
    case 'supabaseInsert':
      method = 'POST';
      bodyLine = `request.httpBody = try? JSONSerialization.data(withJSONObject: ${keyValueLiteral(block, 'data', variableTypes)})`;
      break;
    case 'supabaseUpdate':
      method = 'PATCH';
      bodyLine = `request.httpBody = try? JSONSerialization.data(withJSONObject: ${keyValueLiteral(block, 'data', variableTypes)})`;
      break;
    case 'supabaseDelete':
      method = 'DELETE';
      bodyLine = '// no body';
      break;
    default:
      method = 'GET';
      bodyLine = '// no body';
  }

  return `var ${flag} = false
do {
    var __components_${flag} = URLComponents(string: ${baseURL} + "/rest/v1/" + ${table})!
${filter !== undefined ? `    __components_${flag}.query = ${filter}\n` : ''}    var request = URLRequest(url: __components_${flag}.url!)
    request.httpMethod = ${swiftString(method)}
    request.setValue(${anonKey}, forHTTPHeaderField: "apikey")
    request.setValue("Bearer " + ${anonKey}, forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    ${bodyLine}
    let (data, response) = try await URLSession.shared.data(for: request)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
${storeIn !== undefined ? `    ${storeIn} = String(data: data, encoding: .utf8) ?? ""\n` : ''}    ${flag} = (200..<300).contains(status)
} catch {
    print("${swiftEscaped(block.label)} failed: \\(error.localizedDescription)")
}`;
}

export function permissionSetup(block: LogicBlock, flag: string): string {
  switch (paramValue(block, 'kind') ?? 'camera') {
    case 'camera':
      return `var ${flag} = false
#if os(iOS)
${flag} = await AVCaptureDevice.requestAccess(for: .video)
#endif`;
    case 'microphone':
      return `var ${flag} = false
#if os(iOS)
${flag} = await AVCaptureDevice.requestAccess(for: .audio)
#endif`;
    case 'photoLibrary':
      return `var ${flag} = false
#if canImport(Photos)
let __status_${flag} = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
${flag} = (__status_${flag} == .authorized || __status_${flag} == .limited)
#endif`;
    case 'location':
      return `// Location permission needs a CLLocationManagerDelegate; request it once at launch.
// This block reports the CURRENT authorization status rather than presenting the prompt itself.
var ${flag} = false
#if canImport(CoreLocation)
${flag} = [.authorizedWhenInUse, .authorizedAlways].contains(CLLocationManager().authorizationStatus)
#endif`;
    default:
      return `var ${flag} = false
#if canImport(UserNotifications)
${flag} = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
#endif`;
  }
}
