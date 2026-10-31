# Looply — Xcode Project

A ready-to-open Xcode project. Unlike the SwiftPM export, this one builds
a real, signable **app bundle** you can archive and submit.

## Run / ship
1. Open **Looply.xcodeproj** in Xcode.
2. Select the **Looply** scheme and a device or simulator, then Run.
3. To submit: set your Team under Signing & Capabilities (bundle id
   `com.agentic.looply`), then Product ▸ Archive.

## Notes
- Permission usage descriptions are set as build settings (Info tab) from
  the sensors your flows actually use — nothing more is requested.
- Source files live in `Shared/`, `iOS/`. They are folder
  references (synchronized groups): drop a new file in and it's in the
  build, no project edits.
