// Ported from AgenticDesigner/Services/SimulatorControl.swift (the CoreGraphics
// half). Node cannot post CGEvents or read the window list, so the same calls
// run through JavaScript for Automation's ObjC bridge:
//   osascript -l JavaScript SimulatorControl.jxa.js accessibility
//   osascript -l JavaScript SimulatorControl.jxa.js tap <deviceAspect> <normX> <normY>
//   osascript -l JavaScript SimulatorControl.jxa.js type <text>
// Prints one JSON object: {"ok":true,...} or {"error":"…"}.
ObjC.import('Cocoa');
ObjC.import('CoreGraphics');
ObjC.import('ApplicationServices');

var kCGEventLeftMouseDown = 1;
var kCGEventLeftMouseUp = 2;
var kCGMouseButtonLeft = 0;
var kCGHIDEventTap = 0;
var kCGEventSourceStateCombinedSessionState = 0;
var kCGWindowListOptionOnScreenOnly = 1 << 0;
var kCGWindowListExcludeDesktopElements = 1 << 4;
var kCGNullWindowID = 0;

function fail(message) {
  return JSON.stringify({ error: message });
}

/// Throws (and shows the system prompt on first call) unless the host has
/// Accessibility permission — required to post synthetic taps/keystrokes.
function requireAccessibility() {
  var options = $.NSMutableDictionary.alloc.init;
  options.setObjectForKey($.NSNumber.numberWithBool(true), $('AXTrustedCheckOptionPrompt'));
  if (!$.AXIsProcessTrustedWithOptions(options)) {
    throw new Error('Accessibility permission is required to tap/type the real simulator. A system prompt was just shown — enable the terminal running the AgenticDesigner server in System Settings ▸ Privacy & Security ▸ Accessibility, then retry. (simulator_screenshot works without it.)');
  }
}

/// On-screen rect (points, top-left origin) occupied by the device screen
/// inside the Simulator window — the device aspect-fit within the window
/// below its title bar.
function deviceScreenRect(deviceAspect) {
  var infoRef = $.CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID);
  var infoList = ObjC.deepUnwrap(infoRef);
  if (!infoList) throw new Error('Could not read the window list.');
  var best = null;
  var bestArea = 0;
  for (var i = 0; i < infoList.length; i++) {
    var info = infoList[i];
    if (info['kCGWindowOwnerName'] !== 'Simulator') continue;
    var bounds = info['kCGWindowBounds'];
    if (!bounds) continue;
    var x = Number(bounds['X']), y = Number(bounds['Y']), width = Number(bounds['Width']), height = Number(bounds['Height']);
    var area = width * height;
    if (area > bestArea && width > 100 && height > 100) {
      bestArea = area;
      best = { x: x, y: y, width: width, height: height };
    }
  }
  if (!best) throw new Error('Simulator window not found. Make sure the Simulator app is open and visible on screen.');
  // The window frame includes a title bar (~28pt) at the top; the device
  // screen fills the remaining area, aspect-fit and centered.
  var titleBar = 28;
  var availX = best.x, availY = best.y + titleBar;
  var availW = best.width, availH = best.height - titleBar;
  var availAspect = availW / availH;
  if (availAspect > deviceAspect) {
    var h = availH, w = h * deviceAspect;
    return { x: availX + (availW - w) / 2, y: availY, width: w, height: h };
  }
  var w2 = availW, h2 = w2 / deviceAspect;
  return { x: availX, y: availY + (availH - h2) / 2, width: w2, height: h2 };
}

function activateSimulator() {
  var apps = $.NSWorkspace.sharedWorkspace.runningApplications;
  for (var i = 0; i < apps.count; i++) {
    var app = apps.objectAtIndex(i);
    if (app.localizedName && app.localizedName.js === 'Simulator') {
      app.activateWithOptions(0);
      break;
    }
  }
  delay(0.15);
}

function clamp01(value) {
  return Math.min(Math.max(value, 0), 1);
}

function tap(deviceAspect, normX, normY) {
  requireAccessibility();
  var rect = deviceScreenRect(deviceAspect);
  var point = {
    x: rect.x + clamp01(normX) * rect.width,
    y: rect.y + clamp01(normY) * rect.height,
  };
  activateSimulator();
  var src = $.CGEventSourceCreate(kCGEventSourceStateCombinedSessionState);
  var down = $.CGEventCreateMouseEvent(src, kCGEventLeftMouseDown, point, kCGMouseButtonLeft);
  $.CGEventPost(kCGHIDEventTap, down);
  delay(0.04);
  var up = $.CGEventCreateMouseEvent(src, kCGEventLeftMouseUp, point, kCGMouseButtonLeft);
  $.CGEventPost(kCGHIDEventTap, up);
  return { ok: true, x: point.x, y: point.y };
}

function typeText(text) {
  requireAccessibility();
  activateSimulator();
  var systemEvents = Application('System Events');
  var characters = Array.from(text);
  for (var i = 0; i < characters.length; i++) {
    systemEvents.keystroke(characters[i]);
    delay(0.016);
  }
  return { ok: true, typed: characters.length };
}

function run(argv) {
  try {
    var command = argv[0];
    switch (command) {
      case 'accessibility':
        requireAccessibility();
        return JSON.stringify({ ok: true });
      case 'windowRect':
        return JSON.stringify({ ok: true, rect: deviceScreenRect(parseFloat(argv[1])) });
      case 'tap':
        return JSON.stringify(tap(parseFloat(argv[1]), parseFloat(argv[2]), parseFloat(argv[3])));
      case 'type':
        return JSON.stringify(typeText(argv.slice(1).join(' ')));
      default:
        return fail('Unknown command: ' + command);
    }
  } catch (error) {
    return fail(String(error && error.message ? error.message : error));
  }
}
