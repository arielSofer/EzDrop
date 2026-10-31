//
//  DesignProject.swift
//  AgenticDesigner
//
//  Created by ariel sofer on 03/07/2026.
//

import Foundation

struct DesignProject: Codable {
    var name: String
    var pages: [DesignPage]
    var firebaseConfig: FirebaseConfig?
    var supabaseConfig: SupabaseConfig?
    var apiEndpoints: [APIEndpointConfig] = []
    var globalVariables: [LogicVariable] = []
    var platformSettings: ProjectPlatformSettings = ProjectPlatformSettings()
    // The product's identity colour. Persisted so re-theming, templates and
    // future agent runs keep the brand instead of reverting to stock palettes.
    var brand: BrandIdentity?
    // Overrides the auto-derived com.agentic.<name> bundle id for shipping.
    var bundleIdentifier: String?
    // Apple Developer Team id (e.g. "AB12CD34EF") — when set, exports emit
    // DEVELOPMENT_TEAM so the project runs on device / archives without
    // opening Xcode to pick a team.
    var developmentTeam: String?
    // The agent's persistent project memo (its CLAUDE.md equivalent): design
    // decisions, tone, and constraints committed in past runs — injected into
    // every agent loop so the design system isn't re-derived from scratch.
    var agentMemo: String?
    // Code Mode edits: generated-source files the user rewrote by hand, keyed
    // by FILE NAME (unique across .swift files in every export layout). Applied
    // on top of generation in Code Mode, both exports, and simulator runs —
    // an edited file stays edited until explicitly reverted.
    var sourceOverrides: [String: String]?

    init(
        name: String,
        pages: [DesignPage],
        firebaseConfig: FirebaseConfig? = nil,
        supabaseConfig: SupabaseConfig? = nil,
        apiEndpoints: [APIEndpointConfig] = [],
        globalVariables: [LogicVariable] = [],
        platformSettings: ProjectPlatformSettings = ProjectPlatformSettings()
    ) {
        self.name = name
        self.pages = pages
        self.firebaseConfig = firebaseConfig
        self.supabaseConfig = supabaseConfig
        self.apiEndpoints = apiEndpoints
        self.globalVariables = globalVariables
        self.platformSettings = platformSettings
    }

    private enum CodingKeys: String, CodingKey {
        // brand was missing here, so the synthesized encoder silently DROPPED
        // it from every save despite its "persisted" contract — now included.
        case name, pages, firebaseConfig, supabaseConfig, apiEndpoints, globalVariables, platformSettings, brand, bundleIdentifier, developmentTeam, agentMemo, sourceOverrides
    }

    // decodeIfPresent keeps projects saved before Logic Mode loadable.
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        name = try container.decode(String.self, forKey: .name)
        pages = try container.decode([DesignPage].self, forKey: .pages)
        firebaseConfig = try container.decodeIfPresent(FirebaseConfig.self, forKey: .firebaseConfig)
        supabaseConfig = try container.decodeIfPresent(SupabaseConfig.self, forKey: .supabaseConfig)
        apiEndpoints = try container.decodeIfPresent([APIEndpointConfig].self, forKey: .apiEndpoints) ?? []
        globalVariables = try container.decodeIfPresent([LogicVariable].self, forKey: .globalVariables) ?? []
        platformSettings = try container.decodeIfPresent(ProjectPlatformSettings.self, forKey: .platformSettings) ?? ProjectPlatformSettings()
        brand = try container.decodeIfPresent(BrandIdentity.self, forKey: .brand)
        bundleIdentifier = try container.decodeIfPresent(String.self, forKey: .bundleIdentifier)
        developmentTeam = try container.decodeIfPresent(String.self, forKey: .developmentTeam)
        agentMemo = try container.decodeIfPresent(String.self, forKey: .agentMemo)
        sourceOverrides = try container.decodeIfPresent([String: String].self, forKey: .sourceOverrides)
    }
}

struct DesignPage: Codable, Identifiable {
    var id: UUID
    var name: String
    var nodes: [DesignNode]
    var logicFlows: [LogicFlow] = []
    var supportedPlatforms: [AppPlatform]? = nil

    init(id: UUID, name: String, nodes: [DesignNode], logicFlows: [LogicFlow] = [], supportedPlatforms: [AppPlatform]? = nil) {
        self.id = id
        self.name = name
        self.nodes = nodes
        self.logicFlows = logicFlows
        self.supportedPlatforms = supportedPlatforms
    }

    private enum CodingKeys: String, CodingKey {
        case id, name, nodes, logicFlows, supportedPlatforms
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(UUID.self, forKey: .id)
        name = try container.decode(String.self, forKey: .name)
        nodes = try container.decode([DesignNode].self, forKey: .nodes)
        logicFlows = try container.decodeIfPresent([LogicFlow].self, forKey: .logicFlows) ?? []
        supportedPlatforms = try container.decodeIfPresent([AppPlatform].self, forKey: .supportedPlatforms)
    }
}

enum AppPlatform: String, Codable, CaseIterable, Identifiable {
    case iPhone
    case iPad
    case appleWatch

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .iPhone: return "iPhone"
        case .iPad: return "iPad"
        case .appleWatch: return "Apple Watch"
        }
    }
}

struct ProjectPlatformSettings: Codable {
    var enabledPlatforms: [AppPlatform] = [.iPhone, .iPad]
    var defaultPreviewPlatform: AppPlatform = .iPhone
    /// Which way the device is held. Games (and any wide layout) ship
    /// landscape-only; without this the exported app rotates back to portrait
    /// and a landscape level is letterboxed into uselessness.
    var orientation: AppOrientation = .portrait

    init(enabledPlatforms: [AppPlatform] = [.iPhone, .iPad],
         defaultPreviewPlatform: AppPlatform = .iPhone,
         orientation: AppOrientation = .portrait) {
        self.enabledPlatforms = enabledPlatforms
        self.defaultPreviewPlatform = defaultPreviewPlatform
        self.orientation = orientation
    }

    private enum CodingKeys: String, CodingKey {
        case enabledPlatforms, defaultPreviewPlatform, orientation
    }

    /// Hand-written so projects saved BEFORE a field existed still load.
    /// Swift's synthesized decoder ignores property defaults and hard-fails on
    /// a missing key — adding `orientation` alone made every older
    /// .agenticdesign file unopenable ("data couldn't be read").
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        enabledPlatforms = try c.decodeIfPresent([AppPlatform].self, forKey: .enabledPlatforms) ?? [.iPhone, .iPad]
        defaultPreviewPlatform = try c.decodeIfPresent(AppPlatform.self, forKey: .defaultPreviewPlatform) ?? .iPhone
        orientation = try c.decodeIfPresent(AppOrientation.self, forKey: .orientation) ?? .portrait
    }
}

enum AppOrientation: String, Codable, CaseIterable {
    case portrait
    case landscape
    case all

    var displayName: String {
        switch self {
        case .portrait:  return "Portrait"
        case .landscape: return "Landscape"
        case .all:       return "Both"
        }
    }

    /// Info.plist value for iPhone (UISupportedInterfaceOrientations).
    var plistOrientations: [String] {
        switch self {
        case .portrait:  return ["UIInterfaceOrientationPortrait"]
        case .landscape: return ["UIInterfaceOrientationLandscapeLeft", "UIInterfaceOrientationLandscapeRight"]
        case .all:       return ["UIInterfaceOrientationPortrait",
                                 "UIInterfaceOrientationLandscapeLeft",
                                 "UIInterfaceOrientationLandscapeRight"]
        }
    }
}
