// Platform adapter: locally spawned helper processes.
//
// Ported from the process-launch halves of
//   AgenticDesigner/Agent/OpenRouterProvider.swift  (ensureImageBridge, isPortOpen — mflux on :7860)
//   AgenticDesigner/Services/LocalModelTranslator.swift (ensureHelsinkiWorker — :17841)
// Core can speak HTTP to those servers, but only the server process can START
// them (`Process()` / child_process), so the launch is an injected adapter.
// The HTTP calls themselves stay in core, exactly like Swift.

export interface LocalBridges {
  /**
   * `OpenRouterProvider.ensureImageBridge()` — spawn the bundled
   * `mflux_bridge.py` when :7860 isn't already answering, then poll 12× at
   * 500 ms. Returns true when something is listening on :7860.
   */
  ensureMfluxBridge(): Promise<boolean>;
  /**
   * `LocalModelTranslator.ensureHelsinkiWorker()` — spawn the bundled
   * `helsinki_translation_server.py` when :17841/health isn't answering.
   * Throws the Swift `LocalTranslatorError.helsinkiWorker` message when the
   * worker cannot be started.
   */
  ensureHelsinkiWorker(): Promise<void>;
  /** `isPortOpen(_:)` — only "cannot connect" counts as closed. */
  isPortOpen(port: number): Promise<boolean>;
}

/** No server attached: nothing can be launched (the HTTP paths still run). */
export const NullLocalBridges: LocalBridges = {
  async ensureMfluxBridge() {
    return false;
  },
  async ensureHelsinkiWorker() {
    /* the caller's health poll reports the real failure */
  },
  async isPortOpen() {
    return false;
  },
};

let currentLocalBridges: LocalBridges = NullLocalBridges;

export function setLocalBridges(bridges: LocalBridges): LocalBridges {
  currentLocalBridges = bridges;
  return currentLocalBridges;
}

export function getLocalBridges(): LocalBridges {
  return currentLocalBridges;
}

export function resetLocalBridges(): LocalBridges {
  currentLocalBridges = NullLocalBridges;
  return currentLocalBridges;
}
