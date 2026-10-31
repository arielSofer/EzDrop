// Ported 1:1 from AgenticDesigner/Models/FlowTemplateLibrary.swift
//
// Ready-made logic chains for common app patterns (auth, Firestore,
// Supabase, REST). Templates insert with their event/element references
// unbound — the user picks which button/screen each one wires to via the
// same block inspector any hand-built block uses.

import { LogicAgentTranslator } from '../agent/LogicAgentPromptBuilder';
import { BlockCatalog } from './BlockDefinitions';
import { zeroPoint } from './Geometry';
import { makeBlockConnection, makeLogicFlow, type BlockConnection, type LogicBlock, type LogicBlockType, type LogicFlow } from './LogicModels';
import { newUUID } from './uuid';

export interface FlowTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  build: () => LogicFlow;
}

type Step = [LogicBlockType, Record<string, string>];

// MARK: - Shared chain builder

// Builds a linear success chain (each step's port 0 feeds the next),
// with an optional error-branch leaf hanging off port 1 of any step
// whose block type actually has an error output. Event/element
// parameters are left unbound so the palette's "Select an element..."
// placeholder guides the user to wire it up.
function chain(name: string, eventType: LogicBlockType, steps: Step[], errorBranches: Record<number, Step>): LogicFlow {
  const event = BlockCatalog.makeBlock(eventType, zeroPoint);
  if (!event) {
    return makeLogicFlow({ name });
  }
  event.label = `${name} Trigger`;

  const blocks: LogicBlock[] = [event];
  const connections: BlockConnection[] = [];
  let previousId = event.id;

  steps.forEach((step, index) => {
    const block = BlockCatalog.makeBlock(step[0], zeroPoint);
    if (!block) return;
    for (const [key, value] of Object.entries(step[1])) {
      const paramIndex = block.parameters.findIndex((param) => param.key === key);
      if (paramIndex !== -1) {
        block.parameters[paramIndex].value = value;
      }
    }
    blocks.push(block);
    connections.push(makeBlockConnection({ sourceBlockId: previousId, sourcePortIndex: 0, targetBlockId: block.id, targetPortIndex: 0 }));

    const branch = errorBranches[index];
    if (branch) {
      const [errorType, errorParams] = branch;
      const errorBlock = BlockCatalog.makeBlock(errorType, zeroPoint);
      if (errorBlock) {
        for (const [key, value] of Object.entries(errorParams)) {
          const paramIndex = errorBlock.parameters.findIndex((param) => param.key === key);
          if (paramIndex !== -1) {
            errorBlock.parameters[paramIndex].value = value;
          }
        }
        blocks.push(errorBlock);
        connections.push(makeBlockConnection({ sourceBlockId: block.id, sourcePortIndex: 1, targetBlockId: errorBlock.id, targetPortIndex: 0 }));
      }
    }

    previousId = block.id;
  });

  LogicAgentTranslator.layoutIfNeeded(blocks, connections);
  return makeLogicFlow({ name, blocks, connections });
}

// MARK: - Builders

function signUpFirebase(): LogicFlow {
  // The profile document is what makes an account useful: the auth user
  // only carries an email, so the username lives in users/{uid}.
  return chain('Sign Up', 'onTap', [
    ['firebaseRegister', {}],
    ['firestoreSetDocument', {
      collection: 'users',
      documentId: '{{uid}}',
      data: 'username={{username}}\nemail={{email}}\ncreatedAt={{now}}',
    }],
    ['showToast', { message: 'Welcome, {{username}}!' }],
    ['navigate', {}],
  ], {
    1: ['showAlert', { title: 'Registration Failed' }],
    2: ['showAlert', { title: "Couldn't Save Profile" }],
  });
}

// MARK: - Supabase auth

function signUpSupabase(): LogicFlow {
  return chain('Sign Up', 'onTap', [
    ['supabaseSignUp', {}],
    ['supabaseInsert', {
      table: 'profiles',
      data: 'username={{username}}\nemail={{email}}',
    }],
    ['showToast', { message: 'Account created' }],
    ['navigate', {}],
  ], {
    1: ['showAlert', { title: 'Sign Up Failed' }],
    2: ['showAlert', { title: "Couldn't Save Profile" }],
  });
}

function logInSupabase(): LogicFlow {
  return chain('Log In', 'onTap', [
    ['supabaseSignIn', {}],
    ['navigate', {}],
  ], {
    1: ['showAlert', { title: 'Login Failed', message: 'Check your email and password.' }],
  });
}

// MARK: - Notifications

function askNotificationPermission(): LogicFlow {
  return chain('Notification Permission', 'onAppLaunch', [
    ['requestPermission', { kind: 'notifications' }],
    ['showToast', { message: 'Notifications enabled' }],
  ], {
    0: ['showAlert', {
      title: 'Notifications Off',
      message: 'You can enable them later in Settings.',
    }],
  });
}

function dailyReminder(): LogicFlow {
  return chain('Daily Reminder', 'onTap', [
    ['requestPermission', { kind: 'notifications' }],
    ['scheduleLocalNotification', {
      title: 'Time for your daily check-in',
      body: 'Keep your streak going.',
      seconds: '86400',
      repeats: 'true',
    }],
    ['setBadgeCount', { count: '1' }],
    ['showToast', { message: 'Reminder scheduled' }],
  ], {
    0: ['showAlert', { title: 'Permission Needed' }],
  });
}

// MARK: - Device & sensors

function findMyLocation(): LogicFlow {
  return chain('Find My Location', 'onTap', [
    ['requestPermission', { kind: 'location' }],
    ['getLocation', { accuracy: 'best' }],
    ['showToast', { message: 'You are at {{latitude}}, {{longitude}}' }],
  ], {
    1: ['showAlert', {
      title: 'Location Unavailable',
      message: 'Allow location access to use this feature.',
    }],
  });
}

function liveLocation(): LogicFlow {
  return chain('Live Location', 'onLocationChanged', [
    ['log', { message: 'Moved to {{latitude}}, {{longitude}}' }],
  ], {});
}

function fitnessStats(): LogicFlow {
  return chain('Fitness Stats', 'onScreenLoad', [
    ['requestPermission', { kind: 'health' }],
    ['readHeartRate', {}],
    ['readStepCount', {}],
  ], {
    0: ['showAlert', {
      title: 'Health Access Needed',
      message: 'Allow Health access to read heart rate and steps.',
    }],
  });
}

function shakeToRefresh(): LogicFlow {
  return chain('Shake to Refresh', 'onShake', [
    ['hapticFeedback', {}],
    ['httpRequest', {}],
    ['showToast', { message: 'Refreshed' }],
  ], {
    1: ['showToast', { message: "Couldn't refresh" }],
  });
}

function motionReader(): LogicFlow {
  return chain('Motion Reader', 'onScreenLoad', [
    ['readMotion', {}],
  ], {});
}

function batteryCheck(): LogicFlow {
  return chain('Battery Check', 'onScreenLoad', [
    ['readBatteryLevel', {}],
    ['ifCondition', { left: 'batteryLevel', operation: 'lessThan', right: '20' }],
    ['showAlert', {
      title: 'Low Battery',
      message: 'Plug in to keep tracking.',
    }],
  ], {});
}

function logInFirebase(): LogicFlow {
  return chain('Log In', 'onTap', [
    ['firebaseLogin', {}],
    ['navigate', {}],
  ], {
    1: ['showAlert', { title: 'Login Failed', message: 'Check your email and password.' }],
  });
}

function logOutConfirm(): LogicFlow {
  return chain('Log Out', 'onTap', [
    ['confirmDialog', { title: 'Log out?', message: 'You can log back in anytime.' }],
    ['firebaseLogout', {}],
    ['navigate', {}],
  ], {
    2: ['showAlert', { title: "Couldn't Log Out" }],
  });
}

function forgotPassword(): LogicFlow {
  return chain('Forgot Password', 'onTap', [
    ['firebaseResetPassword', {}],
    ['showToast', { message: 'Password reset email sent' }],
  ], {
    1: ['showAlert', { title: "Couldn't Send Reset Email" }],
  });
}

function fetchListAPI(): LogicFlow {
  return chain('Fetch List', 'onScreenLoad', [
    ['httpRequest', { method: 'GET' }],
    ['parseJSONResponse', { path: 'data' }],
  ], {
    1: ['showAlert', { title: "Couldn't Load Data" }],
  });
}

function saveItemSupabase(): LogicFlow {
  return chain('Save Item', 'onTap', [
    ['supabaseInsert', {}],
    ['showToast', { message: 'Saved' }],
  ], {
    1: ['showAlert', { title: "Couldn't Save" }],
  });
}

function template(name: string, description: string, icon: string, build: () => LogicFlow): FlowTemplate {
  return { id: newUUID(), name, description, icon, build };
}

const all: FlowTemplate[] = [
  template(
    'Sign Up (Firebase)',
    'Register with email/password, create a Firestore profile doc, then navigate on success.',
    'person.badge.plus',
    signUpFirebase,
  ),
  template(
    'Log In (Firebase)',
    'Sign in with email/password and navigate to the signed-in screen, or show an error.',
    'person.badge.key',
    logInFirebase,
  ),
  template(
    'Log Out (with confirmation)',
    'Ask the user to confirm, sign out, then return to the login screen.',
    'rectangle.portrait.and.arrow.right',
    logOutConfirm,
  ),
  template(
    'Forgot Password',
    'Send a password reset email and show a toast, or an error alert.',
    'key.horizontal',
    forgotPassword,
  ),
  template(
    'Fetch List (REST API)',
    'Load data from a REST endpoint when the screen appears, parsing the response into a variable.',
    'network',
    fetchListAPI,
  ),
  template(
    'Save Item (Supabase)',
    'Insert a row into a Supabase table and confirm with a toast, or show an error.',
    'tray.and.arrow.down',
    saveItemSupabase,
  ),

  // MARK: Auth (Supabase)
  template(
    'Sign Up + Profile (Supabase)',
    "Create the account, store the session, then insert the user's profile row (username, email) into the profiles table.",
    'person.crop.circle.badge.plus',
    signUpSupabase,
  ),
  template(
    'Log In (Supabase)',
    'Sign in with email/password, store the session token, and navigate on success.',
    'person.badge.key.fill',
    logInSupabase,
  ),

  // MARK: Notifications
  template(
    'Ask Notification Permission',
    'Request permission on first launch, then confirm with a toast.',
    'bell.badge',
    askNotificationPermission,
  ),
  template(
    'Daily Reminder',
    'Schedule a repeating local notification and set the app badge.',
    'bell.and.waves.left.and.right',
    dailyReminder,
  ),

  // MARK: Device & sensors
  template(
    'Find My Location',
    'Ask for permission, read GPS coordinates into variables, then show them.',
    'location.fill',
    findMyLocation,
  ),
  template(
    'Live Location Tracking',
    'Update latitude/longitude variables whenever the device moves.',
    'location.circle.fill',
    liveLocation,
  ),
  template(
    'Fitness Stats (Watch)',
    "Read heart rate and today's step count from HealthKit on screen load.",
    'heart.text.square',
    fitnessStats,
  ),
  template(
    'Shake to Refresh',
    'Reload data when the user shakes the device, with haptic feedback.',
    'iphone.gen3.radiowaves.left.and.right',
    shakeToRefresh,
  ),
  template(
    'Motion / Tilt Reader',
    'Read accelerometer x/y/z into variables — drive tilt-based UI.',
    'gyroscope',
    motionReader,
  ),
  template(
    'Battery Saver Check',
    "Read the battery level and warn the user when it's low.",
    'battery.25',
    batteryCheck,
  ),
];

export const FlowTemplateLibrary = {
  all,
} as const;
