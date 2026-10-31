// Platform registry: core code calls getPlatform().x; apps inject real adapters
// at startup via setPlatform(). Defaults are in-memory so pure logic/tests run
// anywhere; OS-only features throw PlatformUnsupportedError rather than
// silently doing nothing.

import { SystemClock, type Clock } from './Clock';
import { MemoryClipboard, type Clipboard } from './Clipboard';
import { MemoryFileSystem, type FileSystem } from './FileSystem';
import { ConsoleLogger, type Logger } from './Logger';
import { UnsupportedProcessRunner, type ProcessRunner } from './ProcessRunner';
import { UnsupportedRenderer, type Renderer } from './Renderer';
import { MemoryStorage, type Storage } from './Storage';

export interface Platform {
  clock: Clock;
  logger: Logger;
  fileSystem: FileSystem;
  processRunner: ProcessRunner;
  clipboard: Clipboard;
  renderer: Renderer;
  storage: Storage;
}

export function makeDefaultPlatform(): Platform {
  return {
    clock: new SystemClock(),
    logger: new ConsoleLogger(),
    fileSystem: new MemoryFileSystem(),
    processRunner: new UnsupportedProcessRunner(),
    clipboard: new MemoryClipboard(),
    renderer: new UnsupportedRenderer(),
    storage: new MemoryStorage(),
  };
}

let current: Platform = makeDefaultPlatform();

/** Replace some or all adapters. Returns the resulting platform. */
export function setPlatform(overrides: Partial<Platform>): Platform {
  current = { ...current, ...overrides };
  return current;
}

export function getPlatform(): Platform {
  return current;
}

/** Restore the in-memory defaults (tests). */
export function resetPlatform(): Platform {
  current = makeDefaultPlatform();
  return current;
}
