import Foundation
import SwiftUI
import AppKit
import Combine

struct CanvasFocusRequest: Equatable {
    let nodeId: UUID
    let requestId = UUID()
}

final class ProjectViewModel: ObservableObject {
    @Published var project: DesignProject
    @Published var selectedNodeId: UUID? {
        didSet {
            // Direct single-selection assignments happen all over the
            // codebase — keep the multi-selection set consistent with them.
            if let selectedNodeId {
                if !selectedNodeIds.contains(selectedNodeId) {
                    selectedNodeIds = [selectedNodeId]
                }
            } else if !selectedNodeIds.isEmpty {
                selectedNodeIds.removeAll()
            }
        }
    }
    // Multi-selection (shift-click). Always contains selectedNodeId, which
    // stays the "primary" node the inspector and resize handles target.
    @Published var selectedNodeIds: Set<UUID> = []
    /// A layer-row click emits a fresh request even when the same node is
    /// already selected, so the canvas can reveal it again on demand.
    @Published private(set) var canvasFocusRequest: CanvasFocusRequest?
    @Published var currentPageIndex: Int = 0
    @Published var undoStack: [DesignProject] = []
    @Published var redoStack: [DesignProject] = []
    
    private var currentAgentStylePreset: VisualStylePreset = .minimalEditorial
    private var currentAgentRequestIntent: AgentRequestIntent = .createNewDesign
    private var currentAgentPresentationMode: PresentationMode = .appScreen
    private var currentAgentUserPrompt: String = ""
    private var shouldAutoParentUnreferencedAgentActions = true
    private var allowsRootScreenDeletion = false
    
    /// העמוד הנוכחי — מאובטח מפני out-of-bounds
    var currentPage: DesignPage {
        let safe = max(0, min(currentPageIndex, project.pages.count - 1))
        return project.pages[safe]
    }
    
    func selectPage(index: Int) {
        guard index < project.pages.count else { return }
        currentPageIndex = index
        selectedNodeId = nil
    }
    
    // MARK: - Undo / Redo
    
    func snapshot() {
        undoStack.append(project)
        redoStack.removeAll()
        if undoStack.count > 50 { undoStack.removeFirst() } // Keep last 50 states
    }
    
    func undo() {
        guard let prev = undoStack.popLast() else { return }
        redoStack.append(project)
        project = prev
        selectedNodeId = nil
    }
    
    func redo() {
        guard let next = redoStack.popLast() else { return }
        undoStack.append(project)
        project = next
        selectedNodeId = nil
    }

    func replaceProject(_ newProject: DesignProject) {
        project = newProject
        // Projects saved before hugging existed (and templates) arrive full of
        // text frames far wider than their words, so the fix has to apply on
        // load too — otherwise "default" only ever means "newly generated".
        if Self.autoHugTextBoxes {
            for index in project.pages.indices {
                hugTextBoxesToContent(in: &project.pages[index].nodes)
            }
        }
        // Projects saved before clipping existed carry cards whose artwork
        // bleeds past the corner radius, so heal them on load too — otherwise
        // the fix only ever reaches newly generated work.
        for index in project.pages.indices {
            clipRoundedContainers(in: &project.pages[index].nodes)
        }
        currentPageIndex = project.pages.isEmpty ? 0 : min(currentPageIndex, project.pages.count - 1)
        selectedNodeId = nil
        undoStack.removeAll()
        redoStack.removeAll()
    }
    
    func safeDeleteSelectedNode() {
        // Prevent deleting when typing in a text field
        #if os(macOS)
        let isFocused = NSApplication.shared.keyWindow?.firstResponder is NSTextView ||
                        NSApplication.shared.keyWindow?.firstResponder is NSTextField
        if !isFocused {
            deleteSelectedNode()
        }
        #else
        deleteSelectedNode()
        #endif
    }

    init() {
        let titleNode = DesignNode(
            id: UUID(),
            type: .Text,
            name: "Title",

            x: 32,
            y: 80,
            width: 260,
            height: 44,
            text: "Welcome Back",
            style: NodeStyle(
                fill: "#FFFFFF",
                stroke: nil,
                cornerRadius: 0,
                opacity: 1.0,
                fontSize: 32
            ),
            children: []
        )
        
        let loginButton = DesignNode(
            id: UUID(),
            type: .Button,
            name: "Login Button",

            x: 32,
            y: 680,
            width: 326,
            height: 56,
            text: "Log In",
            style: NodeStyle(
                fill: "#2563EB",
                stroke: nil,
                cornerRadius: 14,
                opacity: 1.0,
                fontSize: 16,
                textColor: "#FFFFFF"
            ),
            children: []
        )
        
        let loginFrame = DesignNode(
            id: UUID(),
            type: .Frame,
            name: "Login Screen",

            x: 100,
            y: 100,
            width: 390,
            height: 844,
            text: nil,
            style: NodeStyle(
                fill: "#111827",
                stroke: "#3B82F6",
                cornerRadius: 24,
                opacity: 1.0,
                fontSize: nil
            ),
            children: [
                titleNode,
                loginButton
            ]
        )
        
        self.project = DesignProject(
            name: "Untitled Project",
            pages: [
                DesignPage(
                    id: UUID(),
                    name: "App Screens",
                    nodes: [
                        loginFrame
                    ]
                )
            ]
        )

        // The starter screen is built with hand-written boxes too, so it needs
        // the same treatment — otherwise the very first text a user ever sees
        // is the one case that doesn't hug.
        if Self.autoHugTextBoxes {
            for index in project.pages.indices {
                hugTextBoxesToContent(in: &project.pages[index].nodes)
            }
        }
    }

    private static let mizmorLetodahLines = [
        "  מִזְמוֹר לְתוֹדָה:    ",
        "  הָרִיעוּ לַיהוָה, כָּל־הָאָרֶץ.",
        "  עִבְדוּ אֶת־יְהוָה בְּשִׂמְחָה   ",
        "  בֹּאוּ לְפָנָיו, בִּרְנָנָה.",
        "  דְּעוּ כִּי יְהוָה, הוּא אֱלֹהִים:",
        "  הוּא־עָשָׂנוּ, ולא אֲנַחְנוּ",
        "  עַמּוֹ, וְצֹאן מַרְעִיתוֹ.",
        "  בֹּאוּ שְׁעָרָיו, בְּתוֹדָה",
        "  חֲצֵרֹתָיו בִּתְהִלָּה  ",
        "  הוֹדוּ־לוֹ, בָּרְכוּ שְׁמוֹ.",
        "  כִּי־טוֹב יְהוָה, לְעוֹלָם חַסְדּוֹ  ",
        "  וְעַד־דֹּר וָדֹר, אֱמוּנָתוֹ.",
        " "
    ]

    private static let mizmorLetodahText = mizmorLetodahLines.joined(separator: "\n")
    
    var selectedNode: DesignNode? {
        guard let selectedNodeId else { return nil }
        return findNode(id: selectedNodeId, in: currentPage.nodes)
    }
    
    // מחזיר את ה־id של ה־Node הנבחר רק אם הוא יכול להכיל children
    var selectedContainerNodeId: UUID? {
        guard let selectedNode else { return nil }
        
        switch selectedNode.type {
        case .Frame:
            return selectedNode.id
        case .Text, .Rectangle, .Button, .Input, .Image, .Icon:
            return nil
        }
    }
    
    // מחזיר Container מתאים ל-Agent גם כשלא בחרנו Frame ידנית
    var agentContainerNodeId: UUID? {
        if let selectedContainerNodeId {
            return selectedContainerNodeId
        }
        
        if let selectedNodeId,
           let parent = parentNode(of: selectedNodeId),
           parent.type == .Frame {
            return parent.id
        }
        
        return firstFrameNodeId(in: currentPage.nodes)
    }
    
    // בונה Context עבור ה-Agent מתוך מצב הפרויקט הנוכחי
    func makeAgentContext(userPrompt: String) -> AgentContext {
        currentAgentUserPrompt = userPrompt
        let selectedSummary = selectedNode.map { AgentNodeSummary(node: $0) }
        let selectedParentNode = selectedNodeId.flatMap { parentNode(of: $0) }
        let selectedParentSummary = selectedParentNode.map { AgentNodeSummary(node: $0) }
        let selectedSiblingNodes: [DesignNode]
        
        if let selectedNodeId, let selectedParentNode {
            selectedSiblingNodes = selectedParentNode.children.filter { $0.id != selectedNodeId }
        } else if let selectedNodeId {
            selectedSiblingNodes = currentPage.nodes.filter { $0.id != selectedNodeId }
        } else {
            selectedSiblingNodes = []
        }
        
        let selectedSiblings = selectedSiblingNodes.map { AgentNodeSummary(node: $0) }
        let layoutIssues = auditLayoutIssues(in: currentPage.nodes)
        let creativeDirection = AgentCreativeDirectionLibrary.direction(for: userPrompt)
        let requestIntent = AgentRequestIntentClassifier.classify(
            prompt: userPrompt,
            hasSelection: selectedNodeId != nil,
            hasCanvasNodes: !currentPage.nodes.isEmpty
        )
        currentAgentRequestIntent = requestIntent

        // New designs only need to know what space is occupied, not every
        // descendant of the existing canvas — keep the summary shallow.
        let canvasSummaryDepth = requestIntent == .createNewDesign ? 1 : 4
        // A single-element edit only needs the screen it lives on, not all the
        // OTHER screens — sending the whole multi-screen canvas is wasted tokens.
        let summaryNodes: [DesignNode]
        if requestIntent == .editSelection, let sel = selectedNodeId,
           let screen = currentPage.nodes.first(where: { findNode(id: sel, in: [$0]) != nil }) {
            summaryNodes = [screen]
        } else {
            summaryNodes = currentPage.nodes
        }
        let canvasSummary = summaryNodes.map {
            AgentNodeSummary(node: $0, maxDepth: canvasSummaryDepth)
        }
        
        // A brand-new design must never inherit an old selected frame as its
        // container — that fuses leftover content into the new screens and
        // poisons every layout hint (suggestedNextY, existingChildrenCount).
        let containerId = requestIntent == .createNewDesign ? nil : agentContainerNodeId
        let container = containerId.flatMap { findNode(id: $0, in: currentPage.nodes) }
        
        let containerWidth  = container?.width
        let containerHeight = container?.height
        let horizontalMargin: CGFloat = 32
        
        let suggestedElementWidth: CGFloat? = containerWidth.map { $0 - horizontalMargin * 2 }
        
        // מחשב את ה-Y הפנוי הבא — הילד הנמוך ביותר + גובהו + gap
        let suggestedNextY: CGFloat? = {
            guard let c = container, !c.children.isEmpty else {
                return container != nil ? 40 : nil   // אין ילדים — התחל מ-40
            }
            let bottomMost = c.children.max {
                ($0.y + $0.height) < ($1.y + $1.height)
            }
            guard let last = bottomMost else { return 40 }
            return last.y + last.height + 20          // 20pt gap בין אלמנטים
        }()
        
        let childrenCount = container?.children.count ?? 0
        
        let pattern = MobileDesignPatternLibrary.pattern(for: userPrompt)
        
        // --- Design Intelligence Layer ---
        let category = AppCategoryClassifier.classify(prompt: userPrompt)
        let screenType = ScreenTypeClassifier.classify(prompt: userPrompt)
        let recipe = DesignRecipeLibrary.recipe(category: category, screenType: screenType)
        let tokens = DesignTokenLibrary.tokens(for: recipe.recommendedStyle)
        let visualCategory = VisualProductCategoryClassifier.classify(prompt: userPrompt)
        let presentationMode = PresentationModeClassifier.classify(prompt: userPrompt)
        currentAgentPresentationMode = presentationMode
        let visualRecipe = VisualRecipeLibrary.recipe(
            visualCategory: visualCategory,
            presentationMode: presentationMode
        )
        if visualCategory != .generic,
           let visualPreset = VisualStylePreset(rawValue: visualRecipe.stylePreset) {
            currentAgentStylePreset = visualPreset
        } else {
            currentAgentStylePreset = recipe.recommendedStyle
        }
        
        let deviceRules: DeviceDesignRules?
        if let selectedNode,
           let devicePresetId = selectedNode.devicePresetId,
           let preset = DevicePresetLibrary.preset(for: devicePresetId) {
            deviceRules = DeviceDesignRuleLibrary.rules(for: preset.platform)
        } else {
            deviceRules = nil
        }
        // ---------------------------------
        
        return AgentContext(
            requestIntent: requestIntent,
            selectedNode: selectedSummary,
            selectedParent: selectedParentSummary,
            selectedSiblings: selectedSiblings,
            selectedContainerId: containerId,
            canvasSummary: canvasSummary,
            layoutIssues: layoutIssues,
            creativeDirection: creativeDirection,
            containerWidth: containerWidth,
            containerHeight: containerHeight,
            suggestedNextY: suggestedNextY,
            horizontalMargin: horizontalMargin,
            suggestedElementWidth: suggestedElementWidth,
            existingChildrenCount: childrenCount,
            mobileDesignPattern: pattern,
            appCategory: category,
            screenType: screenType,
            designRecipe: recipe,
            designTokens: tokens,
            visualProductCategory: visualCategory,
            presentationMode: presentationMode,
            visualRecipe: visualRecipe,
            deviceRules: deviceRules
        )
    }

    
    // המסגרת הגלובלית של ה־Node הנבחר בקנבס
    var selectedNodeGlobalRect: CGRect? {
        guard let selectedNodeId else { return nil }
        return globalRect(for: selectedNodeId)
    }

    /// The box around EVERY selected node — what a multi-selection resizes as
    /// one object.
    var selectionGlobalRect: CGRect? {
        let rects = selectedNodeIds.compactMap { globalRect(for: $0) }
        guard let first = rects.first else { return selectedNodeGlobalRect }
        return rects.dropFirst().reduce(first) { $0.union($1) }
    }
    
    /// Binding ישיר לתוך ה-node הנבחר — מונע stale snapshot ורצד ב-SelectionOverlay
    var selectedNodeBinding: Binding<DesignNode>? {
        guard let selectedNodeId,
              let pageIndex = project.pages.indices.first,
              let nodeIndex = project.pages[pageIndex].nodes.firstIndex(where: { $0.id == selectedNodeId })
        else { return nil }
        
        return Binding(
            get: { self.project.pages[pageIndex].nodes[nodeIndex] },
            set: { self.project.pages[pageIndex].nodes[nodeIndex] = $0 }
        )
    }
    
    func selectNode(_ id: UUID) {
        selectedNodeIds = [id]
        selectedNodeId = id
    }

    func selectAndRevealNode(_ id: UUID) {
        selectNode(id)
        canvasFocusRequest = CanvasFocusRequest(nodeId: id)
    }

    // Shift-click: adds the node to the selection, or removes it when it is
    // already selected. The primary selection follows the last click.
    func toggleNodeInSelection(_ id: UUID) {
        if selectedNodeIds.contains(id) {
            selectedNodeIds.remove(id)
            if selectedNodeId == id {
                selectedNodeId = selectedNodeIds.first
            }
        } else {
            selectedNodeIds.insert(id)
            selectedNodeId = id
        }
    }

    func clearSelection() {
        selectedNodeId = nil
    }

    func selectNodes(in rect: CGRect, extending: Bool = false) {
        let selectionRect = rect.standardized
        guard selectionRect.width > 0, selectionRect.height > 0 else {
            if !extending {
                clearSelection()
            }
            return
        }

        var matches: [UUID] = []
        collectMarqueeSelectableNodes(
            in: currentPage.nodes,
            parentOffset: .zero,
            selectionRect: selectionRect,
            matches: &matches
        )

        if extending {
            var updatedSelection = selectedNodeIds
            updatedSelection.formUnion(matches)
            selectedNodeIds = updatedSelection
            if selectedNodeId == nil {
                selectedNodeId = matches.first ?? selectedNodeIds.first
            }
        } else {
            selectedNodeIds = Set(matches)
            selectedNodeId = matches.first
        }
    }

    /// A marquee starts only from the stage — a screen's own background, or a
    /// decorative backdrop. Dragging an actual element must move it, not
    /// rubber-band around it.
    func shouldBeginMarqueeSelection(fromHitNode id: UUID) -> Bool {
        guard let node = node(id: id) else { return false }
        return isScreenRoot(node) || isMarqueePassthroughNode(node)
    }

    // Moves any node by id — used for group drags where several selected
    // nodes move together by the same delta.
    func moveNode(id: UUID, toX x: CGFloat, y: CGFloat) {
        var t = Transaction()
        t.disablesAnimations = true
        withTransaction(t) {
            _ = updateNode(id: id, in: &project.pages[currentPageIndex].nodes) { node in
                node.x = x
                node.y = y
                node.constraints = nil
                node.manuallyPositioned = true
            }
        }
    }
    
    func node(id: UUID) -> DesignNode? {
        findNode(id: id, in: currentPage.nodes)
    }

    func studioExportNodes() -> [DesignNode] {
        guard let selectedNodeId,
              let selected = findNode(id: selectedNodeId, in: currentPage.nodes)
        else {
            return currentPage.nodes
        }

        if selected.type == .Frame {
            return [selected]
        }

        if let parent = parentNode(of: selectedNodeId), parent.type == .Frame {
            return [parent]
        }

        return [selected]
    }

    // Public parent lookup — shift-drag snapping aligns a node to the
    // center line of its parent in the tree.
    func parentOfNode(_ id: UUID) -> DesignNode? {
        parentNode(of: id)
    }
    
    func isRootNode(_ id: UUID) -> Bool {
        currentPage.nodes.contains { $0.id == id }
    }
    
    func globalRect(for id: UUID) -> CGRect? {
        findGlobalRect(
            id: id,
            in: currentPage.nodes,
            parentOffset: .zero
        )
    }
    
    private func auditLayoutIssues(in nodes: [DesignNode]) -> [AgentLayoutIssue] {
        var issues: [AgentLayoutIssue] = []
        collectLayoutIssues(in: nodes, issues: &issues)
        return Array(issues.prefix(24))
    }
    
    private func collectLayoutIssues(in nodes: [DesignNode], issues: inout [AgentLayoutIssue]) {
        for node in nodes {
            auditChildren(of: node, issues: &issues)
            
            if !node.children.isEmpty {
                collectLayoutIssues(in: node.children, issues: &issues)
            }
        }
    }
    
    private func auditChildren(of parent: DesignNode, issues: inout [AgentLayoutIssue]) {
        guard !parent.children.isEmpty else { return }
        
        for child in parent.children {
            if child.x < -0.5 ||
                child.y < -0.5 ||
                child.x + child.width > parent.width + 0.5 ||
                child.y + child.height > parent.height + 0.5 {
                issues.append(
                    AgentLayoutIssue(
                        severity: "high",
                        nodeId: child.id,
                        relatedNodeId: parent.id,
                        issue: "\(child.name) is outside the bounds of \(parent.name).",
                        suggestedAction: "moveNode or resizeNode the child so it stays inside the parent."
                    )
                )
            }
        }
        
        for lhsIndex in parent.children.indices {
            for rhsIndex in parent.children.indices where rhsIndex > lhsIndex {
                let lhs = parent.children[lhsIndex]
                let rhs = parent.children[rhsIndex]
                
                guard shouldAuditOverlap(lhs, rhs) else { continue }
                
                let lhsRect = CGRect(x: lhs.x, y: lhs.y, width: lhs.width, height: lhs.height)
                let rhsRect = CGRect(x: rhs.x, y: rhs.y, width: rhs.width, height: rhs.height)
                let intersection = lhsRect.intersection(rhsRect)
                
                if !intersection.isNull,
                   intersection.width > 2,
                   intersection.height > 2,
                   intersection.width * intersection.height > 80 {
                    issues.append(
                        AgentLayoutIssue(
                            severity: "high",
                            nodeId: rhs.id,
                            relatedNodeId: lhs.id,
                            issue: "\(rhs.name) overlaps \(lhs.name) inside \(parent.name).",
                            suggestedAction: "moveNode, resizeNode, or distributeChildren within the parent."
                        )
                    )
                }
            }
        }
        
        auditIconLabelQuality(in: parent, issues: &issues)
    }
    
    private func shouldAuditOverlap(_ lhs: DesignNode, _ rhs: DesignNode) -> Bool {
        let allowsLayering = lhs.type == .Icon ||
            rhs.type == .Icon ||
            lhs.name.lowercased().contains("background") ||
            rhs.name.lowercased().contains("background") ||
            lhs.name.lowercased().contains("overlay") ||
            rhs.name.lowercased().contains("overlay")
        
        return !allowsLayering
    }
    
    private func auditIconLabelQuality(in parent: DesignNode, issues: inout [AgentLayoutIssue]) {
        let iconIndices = parent.children.indices.filter { parent.children[$0].type == .Icon }
        let labelIndices = parent.children.indices.filter { parent.children[$0].type == .Text }
        
        guard iconIndices.count >= 2, labelIndices.count >= 2 else { return }
        
        let parentName = parent.name.lowercased()
        let likelyIconGroup = parentName.contains("nav") ||
            parentName.contains("action") ||
            parentName.contains("tab") ||
            parentName.contains("icon") ||
            parent.height <= 140
        
        guard likelyIconGroup else { return }
        
        let averageIconSize = iconIndices
            .map { min(parent.children[$0].width, parent.children[$0].height) }
            .reduce(CGFloat(0), +) / CGFloat(iconIndices.count)
        
        if averageIconSize < 22, !isBottomNavigation(parent) {
            issues.append(
                AgentLayoutIssue(
                    severity: "medium",
                    nodeId: parent.id,
                    relatedNodeId: nil,
                    issue: "\(parent.name) uses icons that are too small for a premium icon-led UI.",
                    suggestedAction: "scaleNode icons up or use distributeChildren on the parent."
                )
            )
        }
        
        var usedLabels = Set<Int>()
        var checkedPairs = 0
        
        for iconIndex in iconIndices {
            let iconName = baseSemanticName(parent.children[iconIndex].name)
            guard let labelIndex = labelIndices
                .filter({ !usedLabels.contains($0) })
                .min(by: { lhs, rhs in
                    let lhsScore = iconLabelMatchScore(iconName: iconName, labelNode: parent.children[lhs], iconNode: parent.children[iconIndex])
                    let rhsScore = iconLabelMatchScore(iconName: iconName, labelNode: parent.children[rhs], iconNode: parent.children[iconIndex])
                    return lhsScore < rhsScore
                })
            else { continue }
            
            usedLabels.insert(labelIndex)
            checkedPairs += 1
            
            let iconCenter = parent.children[iconIndex].x + parent.children[iconIndex].width / 2
            let labelCenter = parent.children[labelIndex].x + parent.children[labelIndex].width / 2
            
            if abs(iconCenter - labelCenter) > 10 {
                issues.append(
                    AgentLayoutIssue(
                        severity: "medium",
                        nodeId: parent.id,
                        relatedNodeId: nil,
                        issue: "\(parent.name) has icon labels that are not centered under their icons.",
                        suggestedAction: "distributeChildren with axis horizontal on the parent."
                    )
                )
                return
            }
        }
        
        if checkedPairs < 2 {
            return
        }
    }
    
    func reparentNode(_ id: UUID, toParent targetId: UUID) {
        guard let currentGlobalRect = globalRect(for: id),
              let movingNode = node(id: id),
              targetId != id,
              !containsNode(id: targetId, in: movingNode.children),
              let targetGlobalRect = globalRect(for: targetId)
        else {
            return
        }
        
        var t = Transaction()
        t.disablesAnimations = true
        withTransaction(t) {
            snapshot()
            guard var nodeToMove = removeNode(id: id, from: &project.pages[currentPageIndex].nodes) else {
                return
            }
            
            nodeToMove.x = currentGlobalRect.minX - targetGlobalRect.minX
            nodeToMove.y = currentGlobalRect.minY - targetGlobalRect.minY
            
            _ = updateNode(id: targetId, in: &project.pages[currentPageIndex].nodes) { target in
                let maxX = max(0, target.width - nodeToMove.width)
                let maxY = max(0, target.height - nodeToMove.height)
                
                nodeToMove.x = min(max(nodeToMove.x, 0), maxX)
                nodeToMove.y = min(max(nodeToMove.y, 0), maxY)
                
                target.children.append(nodeToMove)
            }
            
            selectedNodeId = id
        }
    }
    
    func canReparentNode(_ id: UUID, toParent targetId: UUID) -> Bool {
        guard let movingNode = node(id: id) else { return false }
        return id != targetId && !containsNode(id: targetId, in: movingNode.children)
    }
    
    func clampedPositionForMove(nodeId: UUID, proposedX: CGFloat, proposedY: CGFloat) -> CGPoint {
        guard let node = node(id: nodeId),
              let parent = parentNode(of: nodeId)
        else {
            return CGPoint(x: proposedX, y: proposedY)
        }
        
        let maxX = max(0, parent.width - node.width)
        let maxY = max(0, parent.height - node.height)
        
        return CGPoint(
            x: min(max(proposedX, 0), maxX),
            y: min(max(proposedY, 0), maxY)
        )
    }
    
    enum CanvasHitMode {
        /// Figma-style: select the outermost element, then drill in on repeat
        /// clicks. Picking the smallest node under the cursor (the old
        /// behavior) made every click land on a leaf and left the container
        /// that owns those leaves unreachable.
        case smart
        /// Straight to the innermost leaf (⌘/⌥-click).
        case deepest
    }

    /// The stack of nodes under a point, outermost first: [screen, card, label].
    /// At each level the topmost sibling wins, matching the draw order.
    func hitTestChain(at point: CGPoint) -> [UUID] {
        var chain: [UUID] = []

        func walk(_ nodes: [DesignNode], offset: CGPoint) {
            let ordered = nodes.enumerated().sorted { lhs, rhs in
                let lz = lhs.element.zIndex ?? 0, rz = rhs.element.zIndex ?? 0
                return lz == rz ? lhs.offset < rhs.offset : lz < rz
            }.map(\.element)

            var candidates: [(node: DesignNode, origin: CGPoint, area: CGFloat)] = []
            for node in ordered {
                let origin = CGPoint(x: offset.x + node.x, y: offset.y + node.y)
                let rect = interactionRect(for: node, origin: origin)
                guard rect.contains(point) else { continue }
                candidates.append((node, origin, max(0, rect.width) * max(0, rect.height)))
            }
            guard var winner = candidates.last else { return }

            // Topmost-wins is the default: that is what a user expects when two
            // elements genuinely overlap, and it keeps whole frames clickable.
            // The exception is a small LEAF under a much larger sibling — a
            // padded label or an oversized empty box would otherwise swallow
            // every click meant for a 24pt icon beneath its edge. Containers
            // are excluded so clicking a frame still selects the frame.
            if let preciseLeaf = candidates
                .filter({ $0.node.children.isEmpty && $0.area < winner.area * 0.5 })
                .min(by: { $0.area < $1.area }) {
                winner = preciseLeaf
            }

            // Anything already selected keeps the hit, so a selected element can
            // always be grabbed again and a drag never jumps to another node.
            if let selectedNodeId,
               let stillUnderCursor = candidates.first(where: { $0.node.id == selectedNodeId }) {
                winner = stillUnderCursor
            }

            let hit: (node: DesignNode, origin: CGPoint)? = (winner.node, winner.origin)
            guard let hit else { return }
            chain.append(hit.node.id)
            walk(hit.node.children, offset: hit.origin)
        }

        walk(currentPage.nodes, offset: .zero)
        return chain
    }

    /// Text nodes often have a layout box much wider or taller than their
    /// visible glyphs. Treating all of that transparent space as clickable
    /// blocks small nearby icons from ever receiving a drag. Other node types
    /// keep their full box; text uses its rendered content bounds plus a small
    /// forgiving hit slop.
    private func interactionRect(for node: DesignNode, origin: CGPoint) -> CGRect {
        let fullRect = CGRect(
            origin: origin,
            size: CGSize(width: max(0, node.width), height: max(0, node.height))
        )
        guard node.type == .Text,
              let text = node.text,
              !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else {
            return fullRect
        }

        let paddingLeft = node.style.paddingLeft ?? 0
        let paddingRight = node.style.paddingRight ?? 0
        let paddingTop = node.style.paddingTop ?? 0
        let paddingBottom = node.style.paddingBottom ?? 0
        let availableWidth = max(1, node.width - paddingLeft - paddingRight)
        let availableHeight = max(1, node.height - paddingTop - paddingBottom)
        let font = interactionFont(for: node)
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineBreakMode = .byWordWrapping
        if let lineHeight = node.style.lineHeight, lineHeight > 0 {
            paragraph.minimumLineHeight = lineHeight
            paragraph.maximumLineHeight = lineHeight
        }

        var attributes: [NSAttributedString.Key: Any] = [
            .font: font,
            .paragraphStyle: paragraph
        ]
        if let letterSpacing = node.style.letterSpacing {
            attributes[.kern] = letterSpacing
        }

        let measured = (text as NSString).boundingRect(
            with: CGSize(width: availableWidth, height: .greatestFiniteMagnitude),
            options: [.usesLineFragmentOrigin, .usesFontLeading],
            attributes: attributes
        ).integral
        let contentWidth = min(availableWidth, max(1, measured.width))
        let contentHeight = min(availableHeight, max(1, measured.height))
        let contentX: CGFloat

        switch node.style.textAlign?.lowercased() {
        case "center":
            contentX = origin.x + paddingLeft + (availableWidth - contentWidth) / 2
        case "right":
            contentX = origin.x + node.width - paddingRight - contentWidth
        default:
            contentX = origin.x + paddingLeft
        }

        let contentRect = CGRect(
            x: contentX,
            y: origin.y + paddingTop,
            width: contentWidth,
            height: contentHeight
        ).insetBy(dx: -4, dy: -3)
        return contentRect.intersection(fullRect)
    }

    private func interactionFont(for node: DesignNode) -> NSFont {
        let size = node.style.fontSize ?? 16
        let weight: NSFont.Weight
        switch node.style.fontWeight?.lowercased() {
        case "black": weight = .black
        case "heavy", "extrabold": weight = .heavy
        case "bold": weight = .bold
        case "semibold": weight = .semibold
        case "medium": weight = .medium
        case "light": weight = .light
        default: weight = .regular
        }

        if let family = node.style.fontFamily?.trimmingCharacters(in: .whitespacesAndNewlines),
           !family.isEmpty,
           let customFont = NSFont(name: family, size: size) {
            return customFont
        }
        return NSFont.systemFont(ofSize: size, weight: weight)
    }

    func hitTestNodeId(at point: CGPoint, mode: CanvasHitMode = .smart) -> UUID? {
        let chain = hitTestChain(at: point)
        guard !chain.isEmpty else { return nil }

        switch mode {
        case .deepest:
            return chain.last

        case .smart:
            // Clicking inside what's already selected drills one level in —
            // and stays put once there's nothing deeper, so repeat clicks
            // don't bounce back up to the container.
            if let selected = selectedNodeId, let index = chain.firstIndex(of: selected) {
                return index + 1 < chain.count ? chain[index + 1] : chain[index]
            }
            // Otherwise take the top-level element inside the screen frame
            // (chain[0] is the screen root itself).
            return chain.count > 1 ? chain[1] : chain[0]
        }
    }
    
    // מחפש Node לפי id בתוך עץ של Nodes
    private func findNode(id: UUID, in nodes: [DesignNode]) -> DesignNode? {
        for node in nodes {
            if node.id == id {
                return node
            }
            
            if let found = findNode(id: id, in: node.children) {
                return found
            }
        }
        
        return nil
    }
    
    // מחפש את המסגרת הגלובלית של Node לפי id
    private func findGlobalRect(
        id: UUID,
        in nodes: [DesignNode],
        parentOffset: CGPoint
    ) -> CGRect? {
        for node in nodes {
            let globalX = parentOffset.x + node.x
            let globalY = parentOffset.y + node.y
            
            if node.id == id {
                return CGRect(
                    x: globalX,
                    y: globalY,
                    width: node.width,
                    height: node.height
                )
            }
            
            if let found = findGlobalRect(
                id: id,
                in: node.children,
                parentOffset: CGPoint(x: globalX, y: globalY)
            ) {
                return found
            }
        }
        
        return nil
    }
    
    private func hitTestNodeId(
        at point: CGPoint,
        in nodes: [DesignNode],
        parentOffset: CGPoint,
        order: inout Int,
        bestMatch: inout (id: UUID, area: CGFloat, order: Int)?
    ) {
        for node in nodes {
            let globalX = parentOffset.x + node.x
            let globalY = parentOffset.y + node.y
            let rect = CGRect(
                x: globalX,
                y: globalY,
                width: node.width,
                height: node.height
            )
            let currentOrder = order
            order += 1
            
            if rect.contains(point) {
                let area = max(0, node.width) * max(0, node.height)
                
                if bestMatch == nil ||
                    area < bestMatch!.area ||
                    (area == bestMatch!.area && currentOrder > bestMatch!.order) {
                    bestMatch = (id: node.id, area: area, order: currentOrder)
                }
            }
            
            hitTestNodeId(
                at: point,
                in: node.children,
                parentOffset: CGPoint(x: globalX, y: globalY),
                order: &order,
                bestMatch: &bestMatch
            )
        }
    }

    /// Marquee picks the ELEMENTS a user sees — the cards, buttons and images
    /// sitting on a screen — not the leaves buried inside them. It used to
    /// exclude every Frame with children, so dragging across a card selected
    /// its inner labels individually and never the card itself.
    private func collectMarqueeSelectableNodes(
        in nodes: [DesignNode],
        parentOffset: CGPoint,
        selectionRect: CGRect,
        matches: inout [UUID]
    ) {
        for node in nodes {
            let origin = CGPoint(x: parentOffset.x + node.x, y: parentOffset.y + node.y)
            let nodeRect = CGRect(origin: origin, size: CGSize(width: node.width, height: node.height))

            if isScreenRoot(node) {
                // Screens are the stage: never selected, but their direct
                // children are exactly what the marquee should catch.
                for child in node.children {
                    let childRect = CGRect(
                        x: origin.x + child.x, y: origin.y + child.y,
                        width: child.width, height: child.height
                    )
                    if selectionRect.intersects(childRect), !isMarqueePassthroughNode(child) {
                        matches.append(child.id)
                    }
                }
                continue
            }

            // Loose elements placed directly on the canvas.
            if selectionRect.intersects(nodeRect), !isMarqueePassthroughNode(node) {
                matches.append(node.id)
            }
        }
    }

    private func isScreenRoot(_ node: DesignNode) -> Bool {
        node.type == .Frame && currentPage.nodes.contains { $0.id == node.id }
    }

    private func isMarqueePassthroughNode(_ node: DesignNode) -> Bool {
        let lowercasedName = node.name.lowercased()
        return (node.zIndex ?? 0) < 0 || lowercasedName.contains("background")
    }

    // MARK: - Group resize

    /// Every selected node's global frame, plus their union — captured once
    /// when a resize drag starts.
    func groupResizeStart() -> (frames: [UUID: CGRect], bounds: CGRect)? {
        var frames: [UUID: CGRect] = [:]
        for id in selectedNodeIds {
            guard let rect = globalRect(for: id) else { continue }
            frames[id] = rect
        }
        guard let first = frames.values.first else { return nil }
        let bounds = frames.values.reduce(first) { $0.union($1) }
        return (frames, bounds)
    }

    /// Scales the whole selection as one object: each node keeps its position
    /// and size RELATIVE to the group's bounding box, so the composition holds
    /// together instead of every element resizing about its own origin.
    /// `uniform` (Shift) locks the aspect ratio so proportions are preserved.
    func applyGroupResize(
        handle: ResizeHandle,
        translation: CGSize,
        startFrames: [UUID: CGRect],
        startBounds: CGRect,
        uniform: Bool
    ) {
        let minSize: CGFloat = 24
        var dx = translation.width
        var dy = translation.height

        if uniform {
            // One factor for both axes — the drag's dominant direction wins.
            let sx = handle.affectsHorizontally
                ? (startBounds.width + dx * handle.horizontalSign) / max(startBounds.width, 1)
                : 1
            let sy = handle.affectsVertically
                ? (startBounds.height + dy * handle.verticalSign) / max(startBounds.height, 1)
                : 1
            let scale = handle.affectsHorizontally && handle.affectsVertically
                ? (abs(dx) > abs(dy) ? sx : sy)
                : (handle.affectsHorizontally ? sx : sy)
            dx = handle.affectsHorizontally ? (startBounds.width * scale - startBounds.width) * handle.horizontalSign : 0
            dy = handle.affectsVertically ? (startBounds.height * scale - startBounds.height) * handle.verticalSign : 0
            // Corner handles scale both axes even if the drag was mostly one way.
            if handle.affectsHorizontally, handle.affectsVertically {
                dx = (startBounds.width * scale - startBounds.width) * handle.horizontalSign
                dy = (startBounds.height * scale - startBounds.height) * handle.verticalSign
            }
        }

        var newBounds = startBounds
        if handle.affectsHorizontally {
            let width = max(minSize, startBounds.width + dx * handle.horizontalSign)
            newBounds.size.width = width
            if handle.anchorsRight { newBounds.origin.x = startBounds.maxX - width }
        }
        if handle.affectsVertically {
            let height = max(minSize, startBounds.height + dy * handle.verticalSign)
            newBounds.size.height = height
            if handle.anchorsBottom { newBounds.origin.y = startBounds.maxY - height }
        }

        let scaleX = newBounds.width / max(startBounds.width, 1)
        let scaleY = newBounds.height / max(startBounds.height, 1)

        var t = Transaction()
        t.disablesAnimations = true
        withTransaction(t) {
            for (id, start) in startFrames {
                // Position and size scale about the group's box, not each node's.
                let globalX = newBounds.minX + (start.minX - startBounds.minX) * scaleX
                let globalY = newBounds.minY + (start.minY - startBounds.minY) * scaleY
                let width = max(1, start.width * scaleX)
                let height = max(1, start.height * scaleY)

                // Back to the node's own parent space.
                let parentOrigin = parentGlobalOrigin(of: id)
                _ = updateNode(id: id, in: &project.pages[currentPageIndex].nodes) { node in
                    node.x = globalX - parentOrigin.x
                    node.y = globalY - parentOrigin.y
                    node.width = width
                    node.height = height
                    node.constraints = nil
                    node.manuallyPositioned = true
                }
            }
        }
    }

    /// Where a node's parent sits in canvas coordinates (zero for a root).
    private func parentGlobalOrigin(of id: UUID) -> CGPoint {
        guard let parent = parentNode(of: id), let rect = globalRect(for: parent.id) else {
            return .zero
        }
        return rect.origin
    }
    
    /// The top-level screen frame that contains `id` (itself or any descendant).
    /// Lets a single-element edit send just that screen, not the whole canvas.
    func rootScreen(containing id: UUID) -> DesignNode? {
        currentPage.nodes.first { findNode(id: id, in: [$0]) != nil }
    }

    private func parentNode(of id: UUID) -> DesignNode? {
        parentNode(of: id, in: currentPage.nodes)
    }
    
    private func parentNode(of id: UUID, in nodes: [DesignNode]) -> DesignNode? {
        for node in nodes {
            if node.children.contains(where: { $0.id == id }) {
                return node
            }
            
            if let found = parentNode(of: id, in: node.children) {
                return found
            }
        }
        
        return nil
    }
    
    private func containsNode(id: UUID, in nodes: [DesignNode]) -> Bool {
        findNode(id: id, in: nodes) != nil
    }
    
    private func firstFrameNodeId(in nodes: [DesignNode]) -> UUID? {
        for node in nodes {
            if node.type == .Frame {
                return node.id
            }
            
            if let frameId = firstFrameNodeId(in: node.children) {
                return frameId
            }
        }
        
        return nil
    }
    
    // מעדכן Node לפי id בתוך עץ של Nodes
    private func updateNode(
        id: UUID,
        in nodes: inout [DesignNode],
        update: (inout DesignNode) -> Void
    ) -> Bool {
        for index in nodes.indices {
            if nodes[index].id == id {
                update(&nodes[index])
                return true
            }
            
            let didUpdate = updateNode(
                id: id,
                in: &nodes[index].children,
                update: update
            )
            
            if didUpdate {
                return true
            }
        }
        
        return false
    }
    
    private func removeNode(id: UUID, from nodes: inout [DesignNode]) -> DesignNode? {
        if let index = nodes.firstIndex(where: { $0.id == id }) {
            return nodes.remove(at: index)
        }
        
        for index in nodes.indices {
            if let removed = removeNode(id: id, from: &nodes[index].children) {
                return removed
            }
        }
        
        return nil
    }
    
    // מוסיף Node חדש לתוך children של Parent לפי id
    private func addChildNode(
        _ child: DesignNode,
        toParentId parentId: UUID,
        in nodes: inout [DesignNode]
    ) -> Bool {
        for index in nodes.indices {
            if nodes[index].id == parentId {
                nodes[index].children.append(child)
                return true
            }
            
            let didAdd = addChildNode(
                child,
                toParentId: parentId,
                in: &nodes[index].children
            )
            
            if didAdd {
                return true
            }
        }
        
        return false
    }
    
    // מוסיף Node חדש או לרמת העמוד או לתוך Parent
    private func insertNode(_ node: DesignNode, parentId: UUID?) {
        if let parentId {
            let didAdd = addChildNode(
                node,
                toParentId: parentId,
                in: &project.pages[currentPageIndex].nodes
            )
            
            if !didAdd {
                project.pages[currentPageIndex].nodes.append(node)
            }
        } else {
            project.pages[currentPageIndex].nodes.append(node)
        }
        
        selectedNodeId = node.id
    }
    
    // מעדכן את ה־Node הנבחר, גם אם הוא נמצא בתוך children
    func updateSelectedNode(_ update: (inout DesignNode) -> Void) {
        guard let selectedNodeId else { return }
        
        _ = updateNode(
            id: selectedNodeId,
            in: &project.pages[currentPageIndex].nodes,
            update: update
        )
    }
    
    func updateSelectedNodeAndRelayout(_ update: (inout DesignNode) -> Void) {
        updateSelectedNode(update)
        resolveLayoutForCurrentPage()
    }

    // Applies a style/content edit to every node in the multi-selection —
    // "change color" with 3 text layers selected must recolor all 3, not
    // just the last-clicked (primary) one. Geometry edits (position, size)
    // intentionally keep using the single-target updateSelectedNode above:
    // there is no delta logic here, so broadcasting an absolute x/y/width/
    // height would collapse every selected node onto identical coordinates.
    func updateSelectedNodes(_ update: (inout DesignNode) -> Void) {
        let targets = selectedNodeIds.isEmpty ? [selectedNodeId].compactMap { $0 } : Array(selectedNodeIds)
        for id in targets {
            _ = updateNode(id: id, in: &project.pages[currentPageIndex].nodes, update: update)
        }
    }

    func updateSelectedNodesAndRelayout(_ update: (inout DesignNode) -> Void) {
        updateSelectedNodes(update)
        resolveLayoutForCurrentPage()
    }

    // מוחק Node לפי id מתוך עץ של Nodes
    private func deleteNode(id: UUID, from nodes: inout [DesignNode]) -> Bool {
        if let index = nodes.firstIndex(where: { $0.id == id }) {
            nodes.remove(at: index)
            return true
        }
        
        for index in nodes.indices {
            let didDelete = deleteNode(id: id, from: &nodes[index].children)
            
            if didDelete {
                return true
            }
        }
        
        return false
    }
    
    // מוחק את ה־Node הנבחר מכל מקום בעץ — וכשיש בחירה מרובה, את כולם.
    func deleteSelectedNode() {
        let idsToDelete = selectedNodeIds.isEmpty
            ? [selectedNodeId].compactMap { $0 }
            : Array(selectedNodeIds)
        guard !idsToDelete.isEmpty else { return }
        snapshot()

        for id in idsToDelete {
            _ = deleteNode(
                id: id,
                from: &project.pages[currentPageIndex].nodes
            )
        }

        self.selectedNodeId = nil
    }
    
    func addTextNode() {
        snapshot()
        let newNode = DesignNode(
            id: UUID(),
            type: .Text,
            name: "Text",

            x: 160,
            y: 160,
            width: 220,
            height: 40,
            text: "New Text",
            style: NodeStyle(
                fill: "#000000",
                stroke: nil,
                cornerRadius: 0,
                opacity: 1.0,
                fontSize: 24
            ),
            children: []
        )
        
        project.pages[currentPageIndex].nodes.append(newNode)
        selectedNodeId = newNode.id
        // The 220x40 default box is much wider than "New Text": hug it now so a
        // hand-placed label behaves like every other text node.
        hugTextBoxIfEnabled(id: newNode.id)
    }
    
        func addButtonNode() {
        snapshot()
        let newNode = DesignNode(
                id: UUID(),
                type: .Button,
                name: "Button",

                x: 160,
                y: 230,
                width: 160,
                height: 48,
                text: "Click me",
                style: NodeStyle(
                    fill: "#2563EB",
                    stroke: nil,
                    cornerRadius: 12,
                    opacity: 1.0,
                    fontSize: 16
                ),
                children: []
            )
            
            project.pages[currentPageIndex].nodes.append(newNode)
            selectedNodeId = newNode.id
        }
    func moveSelectedNode(toX x: CGFloat, y: CGFloat) {
        var t = Transaction()
        t.disablesAnimations = true
        withTransaction(t) {
            updateSelectedNode { node in
                node.x = x
                node.y = y
                // A hand-placed position must survive layout resolves:
                // drop pin constraints and opt out of auto-layout stacking.
                node.constraints = nil
                node.manuallyPositioned = true
            }
        }
    }
    
    
    func addDeviceFrame(_ preset: DevicePreset) {
        snapshot()
        let newNode = DesignNode(
            id: UUID(),
            type: .Frame,
            name: preset.name,
            x: 120,
            y: 120,
            width: preset.width,
            height: preset.height,
            text: nil,
            style: NodeStyle(
                fill: "#FFFFFF",
                stroke: "#E5E7EB",
                cornerRadius: preset.cornerRadius,
                opacity: 1.0,
                fontSize: nil
            ),
            devicePresetId: preset.id,
            children: []
        )
        
        project.pages[currentPageIndex].nodes.append(newNode)
        selectedNodeId = newNode.id
    }
    
    func addFrameNode() {
        snapshot()
        let newNode = DesignNode(
            id: UUID(),
            type: .Frame,
            name: "Frame",

            x: 120,
            y: 120,
            width: 390,
            height: 844,
            text: nil,
            style: NodeStyle(
                fill: "#111827",
                stroke: "#3B82F6",
                cornerRadius: 24,
                opacity: 1.0,
                fontSize: nil
            ),
            children: []
        )
        
        project.pages[currentPageIndex].nodes.append(newNode)
        selectedNodeId = newNode.id
    }

    func addArtboard(name: String, width: CGFloat, height: CGFloat, fill: String = "#FFFFFF") {
        snapshot()
        let offset = CGFloat(project.pages[currentPageIndex].nodes.filter { $0.type == .Frame }.count) * 48
        let newNode = DesignNode(
            id: UUID(),
            type: .Frame,
            name: name,
            x: 120 + offset,
            y: 100 + offset,
            width: max(1, width),
            height: max(1, height),
            text: nil,
            style: NodeStyle(
                fill: fill,
                stroke: "#D1D5DB",
                strokeWidth: 1,
                cornerRadius: 0,
                opacity: 1.0,
                fontSize: nil,
                shadow: ShadowStyle(color: "#0F172A", opacity: 0.12, radius: 20, x: 0, y: 12)
            ),
            clipContent: true,
            children: []
        )

        project.pages[currentPageIndex].nodes.append(newNode)
        selectedNodeId = newNode.id
    }

    func addMizmorLetodahArtboard() {
        snapshot()
        let offset = CGFloat(project.pages[currentPageIndex].nodes.filter { $0.type == .Frame }.count) * 48
        let backgroundNode = DesignNode(
            id: UUID(),
            type: .Image,
            name: "Mizmor Background",
            x: 0,
            y: 0,
            width: 1000,
            height: 1800,
            text: nil,
            imageName: Self.studioAssetPath("mizmor-background-100x180cm-150dpi.png"),
            imageSource: Self.studioAssetPath("mizmor-background-100x180cm-150dpi.png"),
            contentMode: .fill,
            iconName: nil,
            style: NodeStyle(
                fill: "#FFFDF8",
                stroke: nil,
                cornerRadius: 0,
                opacity: 1.0,
                fontSize: nil
            ),
            clipContent: true,
            zIndex: -100,
            children: []
        )
        let lineHeight: CGFloat = 125
        let textNodes = Self.mizmorLetodahLines.enumerated().map { index, line in
            DesignNode(
                id: UUID(),
                type: .Text,
                name: "Mizmor Letodah Line \(index + 1)",
                x: 70,
                y: 90 + CGFloat(index) * lineHeight,
                width: 860,
                height: 110,
                text: line,
                style: NodeStyle(
                    fill: "#111827",
                    stroke: nil,
                    cornerRadius: 0,
                    opacity: 1.0,
                    fontSize: 56,
                    fontWeight: "regular",
                    fontFamily: "Arial Hebrew",
                    textColor: "#111827",
                    textAlign: "right",
                    letterSpacing: 0,
                    lineHeight: lineHeight
                ),
                zIndex: 10,
                textBehavior: TextBehavior(wrap: false, autoHeight: false, maxLines: 1, truncate: false, overflow: nil),
                children: []
            )
        }

        let artboard = DesignNode(
            id: UUID(),
            type: .Frame,
            name: "Mizmor Letodah 100x180cm",
            x: 120 + offset,
            y: 100 + offset,
            width: 1000,
            height: 1800,
            text: nil,
            style: NodeStyle(
                fill: "#FFFDF8",
                stroke: "#D8CDBB",
                strokeWidth: 1,
                cornerRadius: 0,
                opacity: 1.0,
                fontSize: nil,
                shadow: ShadowStyle(color: "#0F172A", opacity: 0.10, radius: 10, x: 0, y: 6)
            ),
            clipContent: true,
            children: [backgroundNode] + textNodes
        )

        project.pages[currentPageIndex].nodes.append(artboard)
        selectedNodeIds = Set(textNodes.map { $0.id })
        selectedNodeId = textNodes.first?.id ?? artboard.id
    }

    // A blank arch/tombstone-shaped canvas, exactly 100x180cm (1000x1800
    // canvas units, the project's established 10-units-per-cm convention) —
    // no background image at all. The Frame node ITSELF is the arch: its
    // fill/stroke/shadow render with a semicircular top (archTopRadius =
    // width/2) and a flat bottom, so the shape is the artboard's own outline,
    // not a picture of one. A blank starting point to design on top of.
    func addMizmorShapeArtboard() {
        snapshot()
        let offset = CGFloat(project.pages[currentPageIndex].nodes.filter { $0.type == .Frame }.count) * 48

        let artboard = DesignNode(
            id: UUID(),
            type: .Frame,
            name: "Mizmor Shape 100x180cm",
            x: 120 + offset,
            y: 100 + offset,
            width: 1000,
            height: 1800,
            text: nil,
            style: NodeStyle(
                fill: "#FFFFFF",
                stroke: "#D8CDBB",
                strokeWidth: 1,
                cornerRadius: 0,
                opacity: 1.0,
                fontSize: nil,
                shadow: ShadowStyle(color: "#0F172A", opacity: 0.10, radius: 10, x: 0, y: 6),
                // Full-width semicircle on top (radius = width / 2), flat
                // bottom — the arch/tombstone silhouette itself.
                archTopRadius: 500
            ),
            clipContent: true,
            children: []
        )

        project.pages[currentPageIndex].nodes.append(artboard)
        selectedNodeId = artboard.id
    }

    private static func studioAssetPath(_ fileName: String) -> String {
        if let bundled = Bundle.main.path(forResource: fileName, ofType: nil, inDirectory: "Assets/Studio") {
            return bundled
        }

        let sourceRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        return sourceRoot
            .appendingPathComponent("Assets/Studio")
            .appendingPathComponent(fileName)
            .path
    }

    func addStudioText() {
        snapshot()
        let newNode = DesignNode(
            id: UUID(),
            type: .Text,
            name: "Headline",
            x: 180,
            y: 180,
            width: 360,
            height: 72,
            text: "Add headline",
            style: NodeStyle(
                fill: "#111827",
                stroke: nil,
                cornerRadius: 0,
                opacity: 1.0,
                fontSize: 48,
                fontWeight: "bold",
                textColor: "#111827",
                textAlign: "left",
                letterSpacing: 0
            ),
            textBehavior: TextBehavior(wrap: true, autoHeight: true, maxLines: nil, truncate: false, overflow: nil),
            children: []
        )

        project.pages[currentPageIndex].nodes.append(newNode)
        selectedNodeId = newNode.id
    }

    func addStudioShape(name: String, fill: String, cornerRadius: CGFloat) {
        snapshot()
        let newNode = DesignNode(
            id: UUID(),
            type: .Rectangle,
            name: name,
            x: 180,
            y: 180,
            width: 220,
            height: 160,
            text: nil,
            style: NodeStyle(
                fill: fill,
                stroke: nil,
                cornerRadius: cornerRadius,
                opacity: 1.0,
                fontSize: nil
            ),
            children: []
        )

        project.pages[currentPageIndex].nodes.append(newNode)
        selectedNodeId = newNode.id
    }
    
    func resizeSelectedNode(x: CGFloat, y: CGFloat, width: CGFloat, height: CGFloat) {
        var t = Transaction()
        t.disablesAnimations = true
        withTransaction(t) {
            updateSelectedNode { node in
                node.x = x
                node.y = y
                node.width = max(1, width)
                node.height = max(1, height)
            }
        }
    }
    // מחזיר את כל ה־Nodes חוץ מה־Node שקיבלנו
    func nodesExcluding(_ id: UUID) -> [DesignNode] {
        currentPage.nodes.filter { $0.id != id }
    }
    
    
    //Agent part
    // מבצע רשימת פעולות עיצוב על הפרויקט

    @discardableResult
    func applyDesignActions(_ actions: [DesignAction]) -> [String: UUID] {
        let actionsToApply = sanitizedActionsForCurrentIntent(actions)
        let shouldRunPostProcessingOnly = actionsToApply.isEmpty && currentAgentRequestIntent != .createNewDesign
        guard !actionsToApply.isEmpty || shouldRunPostProcessingOnly else { return [:] }

        snapshot()
        var temporaryIds: [String: UUID] = [:]
        let previousAutoParenting = shouldAutoParentUnreferencedAgentActions
        shouldAutoParentUnreferencedAgentActions = rootScreenActionCount(in: actionsToApply) <= 1
        defer {
            shouldAutoParentUnreferencedAgentActions = previousAutoParenting
        }

        prepareImplicitScreenFrameIfNeeded(for: actionsToApply, temporaryIds: &temporaryIds)

        for action in actionsToApply {

            applyDesignAction(action, temporaryIds: &temporaryIds)

        }

        runNormalizationPass("normalizeAgentScreenRoots") {
            normalizeAgentScreenRoots(
                in: &project.pages[currentPageIndex].nodes,
                createdIds: Set(temporaryIds.values)
            )
        }
        runNormalizationPass("nestLooseRootNodesIntoMobileFrame") {
            nestLooseRootNodesIntoMobileFrame(in: &project.pages[currentPageIndex].nodes)
        }
        resolveLayoutForCurrentPage()
        runNormalizationPass("expandContainersToFitChildren") {
            expandContainersToFitChildren(in: &project.pages[currentPageIndex].nodes)
        }
        runNormalizationPass("normalizeMobileScreenLayouts") {
            normalizeMobileScreenLayouts(in: &project.pages[currentPageIndex].nodes)
        }
        runNormalizationPass("normalizeNavigationLayouts") {
            normalizeNavigationLayouts(in: &project.pages[currentPageIndex].nodes)
        }
        runNormalizationPass("normalizeIconLabelClusterLayouts") {
            normalizeIconLabelClusterLayouts(in: &project.pages[currentPageIndex].nodes)
        }
        runNormalizationPass("applyDesignQualityPass") {
            applyDesignQualityPass(in: &project.pages[currentPageIndex].nodes)
        }
        runNormalizationPass("repairGeneratedDesignSemantics") {
            repairGeneratedDesignSemantics(in: &project.pages[currentPageIndex].nodes)
        }
        runNormalizationPass("removePromptArtifactText") {
            removePromptArtifactText(in: &project.pages[currentPageIndex].nodes)
        }
        runNormalizationPass("repairTextSizing") {
            repairTextSizing(in: &project.pages[currentPageIndex].nodes, parentWidth: nil)
        }
        runNormalizationPass("clipRoundedContainers") {
            clipRoundedContainers(in: &project.pages[currentPageIndex].nodes)
        }
        // Generated text frames arrive far wider than their words, which makes
        // every later "centre this" centre an empty box while the text sits off
        // to one side. Hugging is the default; set autoHugTextBoxes=false to opt out.
        if Self.autoHugTextBoxes {
            runNormalizationPass("hugTextBoxesToContent") {
                hugTextBoxesToContent(in: &project.pages[currentPageIndex].nodes)
            }
        }
        resolveLayoutForCurrentPage()
        runNormalizationPass("repairTextContrast") {
            repairTextContrast(in: &project.pages[currentPageIndex].nodes, inheritedFill: "#FFFFFF")
        }

        return temporaryIds
    }

    // Applies actions with exact coordinates — none of the agent-output repair
    // passes run. Those passes exist to fix sloppy in-app generations, but they
    // restack absolute layouts into columns; MCP-connected agents position
    // nodes precisely and iterate via screenshots, so what they send is what
    // must land on the canvas.
    @discardableResult
    func applyDesignActionsExactly(_ actions: [DesignAction]) -> [String: UUID] {
        guard !actions.isEmpty else { return [:] }

        snapshot()

        // Reference every create action so all created ids can be returned
        // and marked hand-positioned below.
        let createTypes: Set<DesignActionType> = [
            .createFrame, .createText, .createButton, .createInput, .createRectangle,
            .createImage, .createIcon, .createOnboardingScreen, .createComponent,
            .createPresentationShot
        ]
        var preparedActions = actions
        for index in preparedActions.indices
        where createTypes.contains(preparedActions[index].type) && preparedActions[index].nodeReference == nil {
            preparedActions[index].nodeReference = "node\(index)"
        }

        // .improveExistingCanvas: no forced 390x844 roots, no implicit screen
        // frame, no selection fallback — actions mean exactly what they say.
        let previousIntent = currentAgentRequestIntent
        let previousAutoParenting = shouldAutoParentUnreferencedAgentActions
        let previousRootDeletion = allowsRootScreenDeletion
        currentAgentRequestIntent = .improveExistingCanvas
        shouldAutoParentUnreferencedAgentActions = false
        allowsRootScreenDeletion = true
        defer {
            currentAgentRequestIntent = previousIntent
            shouldAutoParentUnreferencedAgentActions = previousAutoParenting
            allowsRootScreenDeletion = previousRootDeletion
        }

        var temporaryIds: [String: UUID] = [:]
        for action in preparedActions {
            applyDesignAction(action, temporaryIds: &temporaryIds)
        }

        // Hand-positioned semantics: the auto-layout engine skips these nodes,
        // so later agent runs and relayouts can't restack them either.
        markManuallyPositioned(ids: Set(temporaryIds.values), in: &project.pages[currentPageIndex].nodes)

        // Hugging is the one repair this exact-coordinates path still runs: it
        // never moves the rendered glyphs, only trims the invisible box around
        // them, so "what the agent sent is what lands" still holds visually —
        // and every later alignment operates on the real text bounds.
        if Self.autoHugTextBoxes {
            hugTextBoxesToContent(in: &project.pages[currentPageIndex].nodes)
        }

        return temporaryIds
    }

    private func markManuallyPositioned(ids: Set<UUID>, in nodes: inout [DesignNode]) {
        for index in nodes.indices {
            if ids.contains(nodes[index].id) {
                nodes[index].manuallyPositioned = true
            }
            if !nodes[index].children.isEmpty {
                markManuallyPositioned(ids: ids, in: &nodes[index].children)
            }
        }
    }

    // Post-processing passes are safety nets, but they can also silently fight
    // intentional art direction. Logging which pass mutated the scene makes
    // "why does the result look different from the actions" debuggable.
    private func runNormalizationPass(_ name: String, _ body: () -> Void) {
        let before = try? JSONEncoder().encode(project.pages[currentPageIndex].nodes)
        body()
        let after = try? JSONEncoder().encode(project.pages[currentPageIndex].nodes)

        if before != after {
            print("🔧 post-pass '\(name)' modified the scene graph")
        }
    }

    // גישה לסימולטור הלוגיקה — קריאה ועדכון של Nodes לפי מזהה
    func nodeForSimulation(id: UUID) -> DesignNode? {
        findNode(id: id, in: project.pages[currentPageIndex].nodes)
    }

    // The repeat-list template that owns `id` — `id`'s node if it is itself a
    // template, otherwise its nearest ancestor carrying a repeatBinding.
    // Lets a tap on a button INSIDE a list cell resolve which row it's in.
    func repeatTemplateForOrAncestorOf(_ id: UUID) -> DesignNode? {
        func search(_ nodes: [DesignNode], ancestorTemplate: DesignNode?) -> DesignNode? {
            for node in nodes {
                let template = node.repeatBinding != nil ? node : ancestorTemplate
                if node.id == id { return template }
                if let found = search(node.children, ancestorTemplate: template) { return found }
            }
            return nil
        }
        return search(project.pages[currentPageIndex].nodes, ancestorTemplate: nil)
    }

    func simulateUpdateNode(id: UUID, _ update: (inout DesignNode) -> Void) {
        _ = updateNode(id: id, in: &project.pages[currentPageIndex].nodes, update: update)
    }

    func setLogicBinding(nodeId: UUID, kind: NodeLogicBindingKind, variableName: String?) {
        _ = updateNode(id: nodeId, in: &project.pages[currentPageIndex].nodes) { node in
            var bindings = node.logicBindings ?? []
            bindings.removeAll { $0.kind == kind }
            if let variableName, !variableName.isEmpty {
                bindings.append(NodeLogicBinding(kind: kind, variableName: variableName))
            }
            node.logicBindings = bindings.isEmpty ? nil : bindings
        }
    }

    func snapshotNodesForSimulation() -> [DesignNode] {
        project.pages[currentPageIndex].nodes
    }

    func restoreNodesFromSimulation(_ nodes: [DesignNode]) {
        project.pages[currentPageIndex].nodes = nodes
    }

    // מחליף מקור תמונה של Node אחרי שהתמונה נוצרה ברקע
    /// Image files already used by the current page — game-entity sprites,
    /// game-scene entities, and image nodes — so a newly designed sprite can be
    /// generated to match the existing art (shared palette and style).
    func currentArtReferenceImagePaths(limit: Int = 8) -> [String] {
        guard project.pages.indices.contains(currentPageIndex) else { return [] }
        var found: [String] = []
        func collect(_ nodes: [DesignNode]) {
            for n in nodes {
                if let s = n.imageSource { found.append(s) }
                if let s = n.gameEntity?.sprite { found.append(s) }
                if let scene = n.gameScene { found.append(contentsOf: scene.entities.compactMap { $0.sprite }) }
                collect(n.children)
            }
        }
        collect(project.pages[currentPageIndex].nodes)
        let fm = FileManager.default
        var seen = Set<String>()
        var out: [String] = []
        for path in found where fm.fileExists(atPath: path) && !seen.contains(path) {
            seen.insert(path)
            out.append(path)
            if out.count >= limit { break }
        }
        return out
    }

    func setGeneratedImage(nodeId: UUID, imagePath: String) {
        _ = updateNode(id: nodeId, in: &project.pages[currentPageIndex].nodes) { node in
            node.imageSource = imagePath
        }
    }

    // מוחק Node קיים (פעולת deleteNode של הסוכן) — לעולם לא מסך שורש שלם.
    private func applyDeleteNode(nodeId: UUID?) {
        guard let nodeId else { return }

        // The root-screen guard protects against destructive deletes the
        // in-app AI sometimes emits; exact mode (MCP) is explicit by contract.
        if !allowsRootScreenDeletion,
           let node = findNode(id: nodeId, in: project.pages[currentPageIndex].nodes),
           node.type == .Frame,
           isLikelyMobileRootFrame(node) {
            print("⚠️ deleteNode ignored for root screen frame '\(node.name)'")
            return
        }

        if removeNode(id: nodeId, from: &project.pages[currentPageIndex].nodes) != nil {
            if selectedNodeId == nodeId {
                selectedNodeId = nil
            }
            print("🗑️ deleteNode removed node \(nodeId)")
        }
    }

    // מסיר טקסטים שהם שאריות פרומפט (קודי צבע, קטעי JSON) שדלפו לקנבס —
    // גם כתוויות של כפתורים/צ'יפים, לא רק Text.
    private func removePromptArtifactText(in nodes: inout [DesignNode]) {
        nodes.removeAll { node in
            let hasArtifactLabel: Bool
            switch node.type {
            case .Text, .Button, .Input:
                hasArtifactLabel = isPromptArtifactText(node.text)
            default:
                hasArtifactLabel = false
            }

            guard hasArtifactLabel else { return false }
            print("🗑️ removed prompt-artifact \(node.type.rawValue) node '\(node.text ?? "")'")
            return true
        }

        for index in nodes.indices {
            removePromptArtifactText(in: &nodes[index].children)
        }
    }

    private func isPromptArtifactText(_ text: String?) -> Bool {
        guard let trimmed = text?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty
        else { return false }

        // Strip decorative bullets/dashes so "• #3B82F6" is still caught.
        let stripped = trimmed.trimmingCharacters(in: CharacterSet(charactersIn: "•·●○◦▪‣*–— \t"))

        if stripped.range(of: #"^#[0-9A-Fa-f]{3,8}$"#, options: .regularExpression) != nil {
            return true
        }

        let lowered = stripped.lowercased()
        if lowered.hasPrefix("{"), lowered.contains("\"subject\"") || lowered.contains("negativeprompt") {
            return true
        }

        return lowered == "negativeprompt" || lowered == "imageprompt"
    }

    // מרחיב טקסטים צרים מדי כך שמילים לא יישברו לעמודות אותיות
    // ("Dis tan ce") — הסיבה המרכזית למסכים שנראים שבורים.
    private func repairTextSizing(in nodes: inout [DesignNode], parentWidth: CGFloat?) {
        for index in nodes.indices {
            // A right-hand sibling (amount, chevron, "See All") caps how far a
            // label may grow — a text can take the row only up to its neighbor.
            let neighborLimit = nearestRightNeighborX(for: index, in: nodes)
            let growthLimit: CGFloat? = {
                switch (parentWidth, neighborLimit) {
                case let (.some(parent), .some(neighbor)): return min(parent, neighbor)
                case let (.some(parent), nil): return parent
                case let (nil, .some(neighbor)): return neighbor
                default: return nil
                }
            }()

            if nodes[index].type == .Text,
               let text = nodes[index].text?.trimmingCharacters(in: .whitespacesAndNewlines),
               !text.isEmpty {
                repairSingleTextNode(&nodes[index], text: text, parentWidth: growthLimit)
            }

            if nodes[index].type == .Button,
               let text = nodes[index].text?.trimmingCharacters(in: .whitespacesAndNewlines),
               !text.isEmpty {
                repairButtonLabel(&nodes[index], text: text, parentWidth: growthLimit)
            }

            let childParentWidth = nodes[index].width
            repairTextSizing(in: &nodes[index].children, parentWidth: childParentWidth)
        }
    }

    private func nearestRightNeighborX(for index: Int, in nodes: [DesignNode]) -> CGFloat? {
        let node = nodes[index]
        var limit: CGFloat?

        for otherIndex in nodes.indices where otherIndex != index {
            let other = nodes[otherIndex]
            let overlapsVertically = other.y < node.y + node.height &&
                other.y + other.height > node.y

            guard overlapsVertically, other.x > node.x + 20 else { continue }
            limit = min(limit ?? .greatestFiniteMagnitude, other.x)
        }

        return limit
    }

    // Buttons render their label inside their own fill — a too-narrow button
    // truncates ("Albu…"). Grow the button when the row has room, otherwise
    // shrink the label font until the full word fits.
    private func repairButtonLabel(_ node: inout DesignNode, text: String, parentWidth: CGFloat?) {
        let labelInset: CGFloat = 28
        var neededWidth = ceil(measuredTextSize(text, style: node.style).width) + labelInset

        guard node.width < neededWidth else { return }

        let availableWidth: CGFloat = {
            guard let parentWidth, parentWidth > 0 else { return neededWidth }
            return max(40, parentWidth - node.x - 8)
        }()

        if neededWidth <= availableWidth {
            node.width = neededWidth
            return
        }

        node.width = max(node.width, availableWidth)

        var style = node.style
        var fontSize = style.fontSize ?? 14
        while fontSize > 10 {
            style.fontSize = fontSize
            neededWidth = ceil(measuredTextSize(text, style: style).width) + labelInset
            if neededWidth <= node.width { break }
            fontSize -= 1
        }
        node.style.fontSize = fontSize
    }

    private func repairSingleTextNode(_ node: inout DesignNode, text: String, parentWidth: CGFloat?) {
        let paddingH = (node.style.paddingLeft ?? 0) + (node.style.paddingRight ?? 0)
        let paddingV = (node.style.paddingTop ?? 0) + (node.style.paddingBottom ?? 0)
        let singleLineWidth = ceil(measuredTextSize(text, style: node.style).width) + paddingH + 4
        let longestWordWidth = ceil(
            text.split(whereSeparator: \.isWhitespace)
                .map { measuredTextSize(String($0), style: node.style).width }
                .max() ?? 0
        ) + paddingH + 4

        let availableWidth: CGFloat = {
            guard let parentWidth, parentWidth > 0 else { return singleLineWidth }
            return max(40, parentWidth - node.x - 8)
        }()

        // Short labels ("Apple Store", "Account Settings") read premium on ONE
        // line — take it whenever the row genuinely has room up to the next
        // sibling, instead of settling for a two-line word wrap.
        let wordCount = text.split(whereSeparator: \.isWhitespace).count
        if wordCount <= 3, node.width < singleLineWidth, singleLineWidth <= availableWidth {
            node.width = singleLineWidth
        }

        // Broken case 1: node is narrower than its longest word, so the
        // renderer breaks words into vertical letter columns ("Dis tan ce").
        // Broken case 2: single-line text (maxLines 1) that truncates.
        let breaksWords = node.width < longestWordWidth
        let truncatesSingleLine = (node.textBehavior?.maxLines == 1) && node.width < singleLineWidth

        if breaksWords || truncatesSingleLine {
            if singleLineWidth <= availableWidth {
                node.width = max(node.width, singleLineWidth)
            } else if !text.contains(where: \.isWhitespace) {
                // A single word cannot wrap — shrink the font until it fits
                // the available slot. A smaller full word beats "Activi…".
                var style = node.style
                var fontSize = style.fontSize ?? 16
                while fontSize > 10 {
                    style.fontSize = fontSize
                    if ceil(measuredTextSize(text, style: style).width) + paddingH + 4 <= availableWidth {
                        break
                    }
                    fontSize -= 1
                }
                node.style.fontSize = fontSize
                node.width = max(node.width, min(availableWidth, ceil(measuredTextSize(text, style: style).width) + paddingH + 4))
            } else {
                // Cannot fit one line inside the parent — take what is
                // available and wrap real lines. If even the longest word
                // exceeds the slot, shrink the font so words never break
                // mid-word into letter columns ("Midnig ht Mix").
                node.width = max(node.width, availableWidth)

                if longestWordWidth > availableWidth {
                    var style = node.style
                    var fontSize = style.fontSize ?? 16
                    while fontSize > 10 {
                        style.fontSize = fontSize
                        let longest = ceil(
                            text.split(whereSeparator: \.isWhitespace)
                                .map { measuredTextSize(String($0), style: style).width }
                                .max() ?? 0
                        ) + paddingH + 4
                        if longest <= availableWidth { break }
                        fontSize -= 1
                    }
                    node.style.fontSize = fontSize
                }

                var behavior = node.textBehavior ?? TextBehavior()
                behavior.wrap = true
                behavior.autoHeight = true
                if behavior.maxLines == 1 {
                    behavior.maxLines = nil
                }
                node.textBehavior = behavior
            }
        }

        // Height repair: wrapped text needs enough vertical room, otherwise
        // lines clip ("5" / ".2"). Only when no explicit line cap is set.
        if node.textBehavior?.maxLines == nil {
            let contentWidth = max(20, node.width - paddingH)
            let wrappedHeight = ceil(
                measuredTextSize(text, style: node.style, constrainedToWidth: contentWidth).height * 1.15
            ) + paddingV

            if node.height < wrappedHeight {
                node.height = wrappedHeight
            }
        }
    }

    private func measuredTextSize(
        _ text: String,
        style: NodeStyle,
        constrainedToWidth width: CGFloat? = nil
    ) -> CGSize {
        let fontSize = style.fontSize ?? 16
        let font = NSFont.systemFont(ofSize: fontSize, weight: nsFontWeight(style.fontWeight))
        var attributes: [NSAttributedString.Key: Any] = [.font: font]
        if let letterSpacing = style.letterSpacing {
            attributes[.kern] = letterSpacing
        }

        let attributed = NSAttributedString(string: text, attributes: attributes)

        guard let width else {
            return attributed.size()
        }

        let bounds = attributed.boundingRect(
            with: NSSize(width: width, height: .greatestFiniteMagnitude),
            options: [.usesLineFragmentOrigin, .usesFontLeading]
        )
        return bounds.size
    }

    private func nsFontWeight(_ weight: String?) -> NSFont.Weight {
        switch weight?.lowercased() {
        case "black": return .black
        case "heavy", "extrabold": return .heavy
        case "bold": return .bold
        case "semibold": return .semibold
        case "medium": return .medium
        case "light": return .light
        default: return .regular
        }
    }
    
    private func normalizeAgentScreenRoots(in nodes: inout [DesignNode], createdIds: Set<UUID> = []) {
        guard currentAgentRequestIntent == .createNewDesign,
              currentAgentPresentationMode != .presentationShot,
              nodes.count > 1
        else {
            return
        }

        // Loose generated content must only be absorbed into screens created
        // by THIS generation — never into leftover frames from old runs
        // (the "Welcome Back" login screen swallowing new sections bug).
        var screenIndices = agentScreenRootIndices(in: nodes)
        if !createdIds.isEmpty {
            let createdOnly = screenIndices.filter { createdIds.contains(nodes[$0].id) }
            if !createdOnly.isEmpty { screenIndices = createdOnly }
        }
        guard !screenIndices.isEmpty else { return }
        
        let originalScreenRects = screenIndices.map { index in
            CGRect(
                x: nodes[index].x,
                y: nodes[index].y,
                width: nodes[index].width,
                height: nodes[index].height
            )
        }
        let screenIds = Set(screenIndices.map { nodes[$0].id })
        var screens = screenIndices.map { nodes[$0] }
        var leftovers: [DesignNode] = []
        
        for index in screens.indices {
            normalizeAgentScreenRoot(&screens[index], index: index)
        }
        
        for node in nodes where !screenIds.contains(node.id) {
            guard isLooseVisualRoot(node) || shouldFlattenExtraRootContainer(node) else {
                leftovers.append(node)
                continue
            }
            
            let screenIndex = nearestScreenIndex(to: node, originalScreenRects: originalScreenRects)
            appendLooseRoot(node, to: &screens[screenIndex], originalScreenRect: originalScreenRects[screenIndex])
        }
        
        nodes = screens + leftovers
    }
    
    private func agentScreenRootIndices(in nodes: [DesignNode]) -> [Int] {
        nodes.indices.filter { isAgentScreenRoot(nodes[$0]) }
    }
    
    private func isAgentScreenRoot(_ node: DesignNode) -> Bool {
        guard node.type == .Frame else { return false }
        
        let name = node.name.lowercased()
        let hasScreenName = containsScreenRootKeyword(name)
        let hasMobileScreenSize = node.width >= 320 &&
            node.width <= 500 &&
            node.height >= 560 &&
            node.height <= 980
        
        return hasScreenName || hasMobileScreenSize
    }
    
    private func containsScreenRootKeyword(_ text: String) -> Bool {
        let normalized = text
            .lowercased()
            .replacingOccurrences(of: "_", with: " ")
            .replacingOccurrences(of: "-", with: " ")
        let compact = normalized.replacingOccurrences(of: " ", with: "")
        let words = Set(normalized.split(separator: " ").map(String.init))
        
        if compact.contains("screen") ||
            compact.contains("phone") ||
            compact.contains("iphone") ||
            compact.contains("mobile") ||
            compact.contains("mockup") ||
            words.contains("page") ||
            words.contains("view") {
            return true
        }
        
        let screenPhrases = [
            "home screen", "discover screen", "search screen", "detail screen",
            "player screen", "library screen", "profile screen", "settings screen",
            "onboarding screen", "checkout screen", "cart screen", "login screen",
            "signup screen", "dashboard screen", "feed screen", "messages screen",
            "chat screen", "map screen", "booking screen"
        ]
        
        return screenPhrases.contains { normalized.contains($0) }
    }
    
    private func nearestScreenIndex(to node: DesignNode, originalScreenRects: [CGRect]) -> Int {
        guard !originalScreenRects.isEmpty else { return 0 }
        
        let nodeCenter = CGPoint(x: node.x + node.width / 2, y: node.y + node.height / 2)
        
        return originalScreenRects.indices.min { lhs, rhs in
            squaredDistance(from: nodeCenter, to: CGPoint(x: originalScreenRects[lhs].midX, y: originalScreenRects[lhs].midY)) <
                squaredDistance(from: nodeCenter, to: CGPoint(x: originalScreenRects[rhs].midX, y: originalScreenRects[rhs].midY))
        } ?? 0
    }
    
    private func squaredDistance(from lhs: CGPoint, to rhs: CGPoint) -> CGFloat {
        let dx = lhs.x - rhs.x
        let dy = lhs.y - rhs.y
        return dx * dx + dy * dy
    }
    
    private func appendLooseRoot(_ node: DesignNode, to screen: inout DesignNode, originalScreenRect: CGRect) {
        if shouldFlattenExtraRootContainer(node) {
            for childNode in node.children {
                var child = childNode
                child.x = node.x + child.x - originalScreenRect.minX
                child.y = node.y + child.y - originalScreenRect.minY
                screen.children.append(child)
            }
        } else {
            var child = node
            child.x = node.x - originalScreenRect.minX
            child.y = node.y - originalScreenRect.minY
            screen.children.append(child)
        }
    }
    
    /// How many screens sit in one row before wrapping to the next. Without a
    /// cap the screens marched off to the right forever and vanished off-canvas.
    static let screensPerRow = 6

    private func normalizeAgentScreenRoot(_ frame: inout DesignNode, index: Int = 0) {
        let screenSpacing: CGFloat = 72
        let rowGap: CGFloat = 150
        let perRow = max(1, Self.screensPerRow)
        let col = index % perRow
        let row = index / perRow
        frame.x = 100 + CGFloat(col) * (390 + screenSpacing)
        frame.y = 80 + CGFloat(row) * (844 + rowGap)
        frame.width = 390
        frame.height = 844
        frame.clipContent = true
        frame.style.cornerRadius = min(max(frame.style.cornerRadius, 28), 44)
        
        if frame.style.paddingTop == nil { frame.style.paddingTop = 24 }
        if frame.style.paddingRight == nil { frame.style.paddingRight = 24 }
        if frame.style.paddingBottom == nil { frame.style.paddingBottom = 24 }
        if frame.style.paddingLeft == nil { frame.style.paddingLeft = 24 }
    }
    
    private func shouldFlattenExtraRootContainer(_ node: DesignNode) -> Bool {
        guard node.type == .Frame, !node.children.isEmpty else { return false }
        
        let name = node.name.lowercased()
        let looksLikeScreen = isLikelyMobileRootFrame(node) ||
            name.contains("screen") ||
            name.contains("app") ||
            name.contains("phone")
        let isOversizedRootContainer = node.width >= 320 && node.height >= 520
        
        return looksLikeScreen || isOversizedRootContainer
    }
    
    private func nestLooseRootNodesIntoMobileFrame(in nodes: inout [DesignNode]) {
        guard currentAgentRequestIntent == .createNewDesign,
              agentScreenRootIndices(in: nodes).count == 1,
              let frameIndex = nodes.firstIndex(where: { isMobileScreenFrame($0) || isLikelyMobileRootFrame($0) })
        else {
            return
        }
        
        let frameOrigin = CGPoint(x: nodes[frameIndex].x, y: nodes[frameIndex].y)
        var looseChildren: [DesignNode] = []
        var remainingNodes: [DesignNode] = []
        
        for index in nodes.indices {
            if index == frameIndex {
                remainingNodes.append(nodes[index])
                continue
            }
            
            guard isLooseVisualRoot(nodes[index]) else {
                remainingNodes.append(nodes[index])
                continue
            }
            
            var child = nodes[index]
            child.x = max(0, child.x - frameOrigin.x)
            child.y = max(0, child.y - frameOrigin.y)
            looseChildren.append(child)
        }
        
        guard !looseChildren.isEmpty else { return }
        
        if let newFrameIndex = remainingNodes.firstIndex(where: { $0.id == nodes[frameIndex].id }) {
            remainingNodes[newFrameIndex].children.append(contentsOf: looseChildren)
        }
        
        nodes = remainingNodes
    }
    
    private func isLooseVisualRoot(_ node: DesignNode) -> Bool {
        switch node.type {
        case .Text, .Button, .Input, .Rectangle, .Image, .Icon:
            return true
        case .Frame:
            return !isLikelyMobileRootFrame(node)
        }
    }
    
    private func isLikelyMobileRootFrame(_ node: DesignNode) -> Bool {
        node.type == .Frame &&
        node.width >= 320 &&
        node.width <= 460 &&
        node.height >= 600 &&
        node.height <= 980
    }
    
    private func resolveLayoutForCurrentPage() {
        applyAutoLayout(to: &project.pages[currentPageIndex].nodes)
        applyPaddingBounds(in: &project.pages[currentPageIndex].nodes)
        applyConstraints(in: &project.pages[currentPageIndex].nodes)
    }
    
    private func sanitizedActionsForCurrentIntent(_ actions: [DesignAction]) -> [DesignAction] {
        switch currentAgentRequestIntent {
        case .createNewDesign:
            return actions
            
        case .editSelection:
            guard selectedNodeId != nil else { return actions }
            return actions.filter { action in
                switch action.type {
                case .updateText,
                     .updateStyle,
                     .moveNode,
                     .resizeNode,
                     .scaleNode,
                     .setAutoLayout,
                     .pinNode,
                     .bringToFront,
                     .sendToBack,
                     .setZIndex,
                     .alignChildren,
                     .distributeChildren,
                     .positionRelativeTo,
                     .deleteNode:
                    return true
                case .createFrame,
                     .createText,
                     .createButton,
                     .createInput,
                     .createRectangle,
                     .createImage,
                     .createIcon,
                     .createPage,
                     .createOnboardingScreen,
                     .createComponent,
                     .createPresentationShot:
                    return false
                }
            }

        case .improveExistingCanvas:
            return actions.filter { action in
                switch action.type {
                case .createPage, .createPresentationShot, .createOnboardingScreen:
                    return false
                case .createFrame:
                    return action.parentId != nil || action.parentReference != nil
                case .createText,
                     .createButton,
                     .createInput,
                     .createRectangle,
                     .createImage,
                     .createIcon,
                     .updateText,
                     .updateStyle,
                     .moveNode,
                     .resizeNode,
                     .scaleNode,
                     .setAutoLayout,
                     .pinNode,
                     .bringToFront,
                     .sendToBack,
                     .setZIndex,
                     .alignChildren,
                     .distributeChildren,
                     .positionRelativeTo,
                     .deleteNode,
                     .createComponent:
                    return true
                }
            }
        }
    }
    
    private let implicitAgentFrameReference = "__implicitAgentScreenFrame"
    private let defaultAgentRootFrameReference = "__defaultAgentRootFrame"
    
    private func rootScreenActionCount(in actions: [DesignAction]) -> Int {
        actions.filter { action in
            action.type == .createFrame &&
            action.parentId == nil &&
            action.parentReference == nil &&
            shouldTreatActionAsRootScreen(action)
        }.count
    }
    
    private func prepareImplicitScreenFrameIfNeeded(
        for actions: [DesignAction],
        temporaryIds: inout [String: UUID]
    ) {
        guard shouldCreateImplicitScreenFrame(for: actions) else { return }
        
        let tokens = DesignTokenLibrary.tokens(for: currentAgentStylePreset)
        let frameAction = DesignAction(
            type: .createFrame,
            nodeReference: implicitAgentFrameReference,
            name: "App Screen",
            x: 100,
            y: 80,
            width: 390,
            height: 844,
            fill: tokens.colors.backgroundPrimary,
            cornerRadius: 36,
            shadow: ShadowStyle(color: "#0F172A", opacity: 0.10, radius: 28, x: 0, y: 18)
        )
        
        let frameId = applyCreateFrame(frameAction, parentId: nil)
        temporaryIds[implicitAgentFrameReference] = frameId
    }
    
    private func shouldCreateImplicitScreenFrame(for actions: [DesignAction]) -> Bool {
        let hasRootContainer = actions.contains { action in
            switch action.type {
            case .createOnboardingScreen, .createPresentationShot:
                return true
            case .createFrame:
                return action.parentId == nil &&
                    action.parentReference == nil &&
                    shouldTreatActionAsRootScreen(action)
            default:
                return false
            }
        }
        
        guard !hasRootContainer else { return false }
        
        let unparentedCreateActions = actions.filter {
            $0.parentId == nil &&
            $0.parentReference == nil &&
            (isVisualCreateAction($0) || shouldAutoNestUnparentedFrame($0))
        }
        
        return unparentedCreateActions.count >= 2
    }
    
    private func shouldTreatActionAsRootScreen(_ action: DesignAction) -> Bool {
        guard action.type == .createFrame else { return false }
        
        let combinedText = [
            action.nodeReference,
            action.name,
            action.rawComponentName
        ]
            .compactMap { $0 }
            .joined(separator: " ")
        
        if containsScreenRootKeyword(combinedText) {
            return true
        }
        
        if let width = action.width,
           let height = action.height,
           width >= 320,
           width <= 500,
           height >= 560,
           height <= 980 {
            return true
        }
        
        return false
    }
    
    private func shouldAutoNestUnparentedFrame(_ action: DesignAction) -> Bool {
        action.type == .createFrame &&
        currentAgentRequestIntent == .createNewDesign &&
        !shouldTreatActionAsRootScreen(action)
    }
    
    private func isVisualCreateAction(_ action: DesignAction) -> Bool {
        switch action.type {
        case .createText,
             .createButton,
             .createInput,
             .createRectangle,
             .createImage,
             .createIcon,
             .createComponent:
            return true
        default:
            return false
        }
    }
    
    private func expandContainersToFitChildren(in nodes: inout [DesignNode]) {
        for index in nodes.indices {
            if !nodes[index].children.isEmpty {
                expandContainersToFitChildren(in: &nodes[index].children)
            }
            
            guard nodes[index].type == .Frame || nodes[index].type == .Rectangle,
                  !nodes[index].children.isEmpty,
                  !isMobileScreenFrame(nodes[index])
            else { continue }
            
            let paddingBottom: CGFloat = isTransparentHex(nodes[index].style.fill) ? 0 : 16
            let requiredHeight = nodes[index].children
                .map { $0.y + $0.height + paddingBottom }
                .max() ?? nodes[index].height
            
            if requiredHeight > nodes[index].height {
                nodes[index].height = requiredHeight
            }
        }
    }
    
    private func normalizeMobileScreenLayouts(in nodes: inout [DesignNode]) {
        for index in nodes.indices {
            if isMobileScreenFrame(nodes[index]) {
                normalizeMobileScreen(&nodes[index])
            }
            
            if !nodes[index].children.isEmpty {
                normalizeMobileScreenLayouts(in: &nodes[index].children)
            }
        }
    }
    
    /// Gives every light surface CARD the same soft shadow, so the screen reads
    /// as one design system instead of a mix of flat and floating cards. Only
    /// touches opaque light-filled child frames that have content — never the
    /// nav, dark heroes, transparent rows, or full-bleed surfaces.
    private func addConsistentCardDepth(in screen: inout DesignNode) {
        for i in screen.children.indices where screen.children[i].type == .Frame {
            var card = screen.children[i]
            guard !card.children.isEmpty,
                  card.style.shadow == nil,
                  !isBottomNavigation(card),
                  card.width <= screen.width,
                  card.height >= 44, card.height <= 360,
                  isLightOpaqueFill(card.style.fill)
            else { continue }
            card.style.shadow = ShadowStyle(color: "#0F172A", opacity: 0.06, radius: 16, x: 0, y: 8)
            screen.children[i] = card
        }
    }

    private func isLightOpaqueFill(_ hex: String) -> Bool {
        let h = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        guard h.count == 6, let v = Int(h, radix: 16) else { return false }  // 8-digit (alpha) or invalid → skip
        let r = Double((v >> 16) & 0xFF), g = Double((v >> 8) & 0xFF), b = Double(v & 0xFF)
        return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.82
    }

    private func applyDesignQualityPass(in nodes: inout [DesignNode]) {
        for index in nodes.indices {
            if !nodes[index].children.isEmpty {
                applyDesignQualityPass(in: &nodes[index].children)
                
                if isMobileScreenFrame(nodes[index]) {
                    resolveMobileSiblingOverlaps(in: &nodes[index])
                    addConsistentCardDepth(in: &nodes[index])
                }
                
                expandTextNodesForTypography(in: &nodes[index])
                clampChildrenInsideParent(&nodes[index])
            }
        }
    }
    
    private func resolveMobileSiblingOverlaps(in frame: inout DesignNode) {
        let bottomIndex = frame.children.indices.first {
            isBottomNavigation(frame.children[$0]) || isChatInput(frame.children[$0])
        }
        let bottomLimit = bottomIndex.map { frame.children[$0].y - 16 } ?? frame.height - 24
        let orderedIndices = frame.children.indices
            .filter { $0 != bottomIndex }
            .sorted { frame.children[$0].y < frame.children[$1].y }
        
        var currentBottom: CGFloat = 24
        
        for childIndex in orderedIndices {
            if frame.children[childIndex].y < currentBottom {
                frame.children[childIndex].y = currentBottom
            }
            
            if frame.children[childIndex].y + frame.children[childIndex].height > bottomLimit {
                let availableHeight = bottomLimit - frame.children[childIndex].y
                if availableHeight >= 48 {
                    frame.children[childIndex].height = availableHeight
                    fitChildrenInsideParent(&frame.children[childIndex])
                }
            }
            
            currentBottom = frame.children[childIndex].y
                + frame.children[childIndex].height
                + verticalGap(after: frame.children[childIndex])
        }
    }
    
    private func clampChildrenInsideParent(_ parent: inout DesignNode) {
        let padding = isTransparentHex(parent.style.fill) ? CGFloat(0) : CGFloat(2)
        
        for index in parent.children.indices {
            if parent.children[index].width > parent.width - padding * 2 {
                parent.children[index].width = max(1, parent.width - padding * 2)
            }
            
            if parent.children[index].height > parent.height - padding * 2 {
                parent.children[index].height = max(1, parent.height - padding * 2)
            }
            
            parent.children[index].x = min(
                max(parent.children[index].x, padding),
                max(padding, parent.width - padding - parent.children[index].width)
            )
            parent.children[index].y = min(
                max(parent.children[index].y, padding),
                max(padding, parent.height - padding - parent.children[index].height)
            )
        }
    }
    
    private func expandTextNodesForTypography(in parent: inout DesignNode) {
        for index in parent.children.indices where parent.children[index].type == .Text {
            let fontSize = parent.children[index].style.fontSize ?? 16
            let lineHeight = parent.children[index].style.lineHeight ?? fontSize * 1.25
            let maxLines = CGFloat(parent.children[index].textBehavior?.maxLines ?? 1)
            let requestedLines = parent.children[index].textBehavior?.autoHeight == true ||
                parent.children[index].textBehavior?.wrap == true ? max(1, maxLines) : 1
            let minimumHeight = ceil(lineHeight * requestedLines)
            
            if parent.children[index].height < minimumHeight {
                parent.children[index].height = min(minimumHeight, max(1, parent.height - parent.children[index].y))
            }
        }
    }
    
    private func normalizeNavigationLayouts(in nodes: inout [DesignNode]) {
        for index in nodes.indices {
            if isBottomNavigation(nodes[index]) {
                relayoutBottomNavigation(&nodes[index])
            }
            
            if !nodes[index].children.isEmpty {
                normalizeNavigationLayouts(in: &nodes[index].children)
            }
        }
    }
    
    private func normalizeIconLabelClusterLayouts(in nodes: inout [DesignNode]) {
        for index in nodes.indices {
            if isIconLabelCluster(nodes[index]) {
                _ = distributeIconLabelPairs(in: &nodes[index], padding: 4)
            }
            
            if !nodes[index].children.isEmpty {
                normalizeIconLabelClusterLayouts(in: &nodes[index].children)
            }
        }
    }
    
    private func isIconLabelCluster(_ node: DesignNode) -> Bool {
        let name = node.name.lowercased()
        let iconCount = node.children.filter { $0.type == .Icon }.count
        let textCount = node.children.filter { $0.type == .Text }.count
        
        return iconCount >= 2 &&
            textCount >= 2 &&
            (name.contains("quick action") ||
             name.contains("action row") ||
             name.contains("tab bar") ||
             name.contains("icon row"))
    }
    
    private func isMobileScreenFrame(_ node: DesignNode) -> Bool {
        node.type == .Frame &&
        node.width >= 320 &&
        node.width <= 460 &&
        node.height >= 600 &&
        node.height <= 980 &&
        node.children.count >= 2
    }
    
    private func normalizeMobileScreen(_ frame: inout DesignNode) {
        let defaultPadding: CGFloat = frame.width <= 420 ? 24 : 32
        frame.clipContent = true
        
        if frame.style.paddingTop == nil { frame.style.paddingTop = defaultPadding }
        if frame.style.paddingRight == nil { frame.style.paddingRight = defaultPadding }
        if frame.style.paddingBottom == nil { frame.style.paddingBottom = defaultPadding }
        if frame.style.paddingLeft == nil { frame.style.paddingLeft = defaultPadding }
        
        let paddingTop = frame.style.paddingTop ?? defaultPadding
        let paddingRight = frame.style.paddingRight ?? defaultPadding
        let paddingBottom = frame.style.paddingBottom ?? defaultPadding
        let paddingLeft = frame.style.paddingLeft ?? defaultPadding
        let sidePadding = min(paddingLeft, paddingRight)
        let contentWidth = max(1, frame.width - paddingLeft - paddingRight)
        let bottomIndex = frame.children.indices.first {
            isBottomNavigation(frame.children[$0]) || isChatInput(frame.children[$0])
        }
        // The nav sits a SMALL fixed margin from the true screen bottom — NOT
        // the content paddingBottom, which is large (≈100pt, reserved so flow
        // content clears the bar). Using paddingBottom left the nav floating
        // ~100pt above the bottom edge with dead space beneath it.
        let navBottomMargin: CGFloat = 16
        var bottomTop = frame.height - paddingBottom

        if let bottomIndex {
            frame.children[bottomIndex].width = contentWidth
            frame.children[bottomIndex].x = paddingLeft
            frame.children[bottomIndex].height = max(60, min(frame.children[bottomIndex].height, 70))
            frame.children[bottomIndex].y = frame.height - frame.children[bottomIndex].height - navBottomMargin

            // Constraints keep the bar pinned when the screen's auto-layout
            // resolves again after this pass and restacks children in flow.
            frame.children[bottomIndex].constraints = EdgeConstraints(
                top: nil,
                right: paddingRight,
                bottom: navBottomMargin,
                left: paddingLeft,
                centerX: nil,
                centerY: nil
            )

            if isBottomNavigation(frame.children[bottomIndex]) {
                relayoutBottomNavigation(&frame.children[bottomIndex])
            } else if isChatInput(frame.children[bottomIndex]) {
                relayoutChatInput(&frame.children[bottomIndex])
            }

            bottomTop = frame.children[bottomIndex].y
        }
        
        let orderedIndices = frame.children.indices
            .filter { $0 != bottomIndex }
            .sorted { frame.children[$0].y < frame.children[$1].y }
        
        var currentY: CGFloat = paddingTop
        let bottomLimit = bottomTop - 20
        var droppedIDs: Set<UUID> = []

        for childIndex in orderedIndices {
            compactMobileSection(&frame.children[childIndex])
            normalizeHorizontalPlacement(
                child: &frame.children[childIndex],
                frameWidth: frame.width,
                padding: sidePadding,
                contentWidth: contentWidth
            )

            frame.children[childIndex].y = currentY

            let naturalHeight = frame.children[childIndex].height
            if currentY + naturalHeight > bottomLimit {
                let available = bottomLimit - currentY
                // A stacked card squeezed below ~72% of its height overlaps its
                // own text (a 110pt 3-row card jammed into 48pt). Dropping the
                // component that doesn't fit is honest; rendering overlapping,
                // unreadable text is not.
                if available >= naturalHeight * 0.72, available >= 48 {
                    frame.children[childIndex].height = available
                    fitChildrenInsideParent(&frame.children[childIndex])
                } else {
                    droppedIDs.insert(frame.children[childIndex].id)
                    continue
                }
            }

            currentY = frame.children[childIndex].y
                + frame.children[childIndex].height
                + verticalGap(after: frame.children[childIndex])
        }
        if !droppedIDs.isEmpty {
            frame.children.removeAll { droppedIDs.contains($0.id) }
        }

        // A final CTA is a deliberate bottom anchor, not just the next item in
        // a loose stack. Pinning it above the navigation (or safe-area bottom
        // on entry screens) removes the large accidental dead zone that made
        // otherwise complete onboarding/setup screens look half-finished.
        let visibleContent = frame.children.indices
            .filter { !isBottomNavigation(frame.children[$0]) && !isChatInput(frame.children[$0]) }
            .sorted { frame.children[$0].y < frame.children[$1].y }
        if let lastIndex = visibleContent.last, frame.children[lastIndex].type == .Button {
            let targetY = bottomLimit - frame.children[lastIndex].height
            let previousBottom = visibleContent.dropLast().last.map {
                frame.children[$0].y + frame.children[$0].height
            } ?? paddingTop
            if targetY > frame.children[lastIndex].y, targetY - previousBottom >= 24 {
                frame.children[lastIndex].y = targetY
            }
        }
    }
    
    private func compactMobileSection(_ node: inout DesignNode) {
        let name = node.name.lowercased()
        
        if name.contains("avatar") || name.contains("header") {
            node.height = min(node.height, 72)
        } else if name.contains("hero") || name.contains("map") || name.contains("artwork") || node.type == .Image {
            node.height = min(max(node.height, 160), 260)
            fitChildrenInsideParent(&node)
        } else if name.contains("balance") {
            node.height = min(max(node.height, 132), 180)
            fitChildrenInsideParent(&node)
        } else if name.contains("quick action") {
            node.height = min(max(node.height, 92), 104)
            fitChildrenInsideParent(&node)
        } else if name.contains("transaction") || name.contains("activity") || name.contains("list") {
            node.height = min(node.height, 232)
            fitChildrenInsideParent(&node)
        } else if name.contains("market") || name.contains("grid") || name.contains("currency") {
            node.height = min(node.height, 132)
            fitChildrenInsideParent(&node)
        } else if name.contains("message") || name.contains("response") {
            node.height = min(max(node.height, 64), 84)
            fitChildrenInsideParent(&node)
        } else if name.contains("chat input") {
            node.height = min(max(node.height, 60), 70)
            fitChildrenInsideParent(&node)
        } else if name.contains("sheet") || name.contains("card") || name.contains("panel") {
            node.height = min(max(node.height, 80), 240)
            fitChildrenInsideParent(&node)
        } else if node.type == .Frame || node.type == .Rectangle {
            node.height = min(max(node.height, 48), 240)
            fitChildrenInsideParent(&node)
        }
    }
    
    private func fitChildrenInsideParent(_ parent: inout DesignNode) {
        guard !parent.children.isEmpty else { return }
        
        for index in parent.children.indices {
            if parent.children[index].width > parent.width {
                parent.children[index].width = max(1, parent.width)
            }
            
            if parent.children[index].height > parent.height {
                parent.children[index].height = max(1, parent.height)
            }
            
            parent.children[index].x = min(
                max(0, parent.children[index].x),
                max(0, parent.width - parent.children[index].width)
            )
            
            parent.children[index].y = min(
                max(0, parent.children[index].y),
                max(0, parent.height - parent.children[index].height)
            )
            
            if !parent.children[index].children.isEmpty {
                fitChildrenInsideParent(&parent.children[index])
            }
        }
    }
    
    private func normalizeHorizontalPlacement(
        child: inout DesignNode,
        frameWidth: CGFloat,
        padding: CGFloat,
        contentWidth: CGFloat
    ) {
        let shouldConstrain = child.type != .Icon
        
        if shouldConstrain, child.width > contentWidth {
            child.width = contentWidth
        }
        
        if shouldConstrain {
            child.x = (frameWidth - child.width) / 2
        } else {
            child.x = min(max(child.x, padding), frameWidth - padding - child.width)
        }
    }
    
    private func verticalGap(after node: DesignNode) -> CGFloat {
        let name = node.name.lowercased()
        
        if node.type == .Text {
            return 12
        }
        
        if name.contains("chip") || name.contains("search") {
            return 12
        }
        
        if node.height >= 180 {
            return 12
        }
        
        // Reference apps overwhelmingly align section rhythm to a 4pt grid.
        // The old 10pt fallback accumulated small visual inconsistencies and
        // made otherwise coherent screens feel mechanically stacked.
        return 12
    }
    
    private func isBottomNavigation(_ node: DesignNode) -> Bool {
        let name = node.name.lowercased()

        if name.contains("bottom"), name.contains("nav") || name.contains("navigation") {
            return true
        }

        // Models name nav bars many ways ("Navigation Bar", "Tab Bar", "Tabs").
        // Recognize any short, icon-heavy frame with a nav-ish name so it still
        // gets pinned to the screen bottom instead of floating mid-flow.
        let navishName = name.contains("nav") ||
            name.contains("tab bar") ||
            name.contains("tabbar") ||
            name.contains("tabs")

        guard navishName, node.type == .Frame, node.height <= 110 else {
            return false
        }

        let directIcons = node.children.filter { $0.type == .Icon }.count
        let nestedIcons = node.children.reduce(0) { count, child in
            count + child.children.filter { $0.type == .Icon }.count
        }

        return directIcons + nestedIcons >= 3
    }
    
    private func isChatInput(_ node: DesignNode) -> Bool {
        node.name.lowercased().contains("chat input")
    }
    
    private func relayoutBottomNavigation(_ node: inout DesignNode) {
        guard !node.children.isEmpty else { return }

        // Manual distribution must survive the final auto-layout resolve —
        // a leftover horizontal layout would restack the icons to the left.
        node.style.layout = nil
        node.style.spacing = nil

        // Group children into tab items: an icon starts an item and one text
        // directly after it joins that item; frames (icon+label clusters) and
        // anything else are items of their own. This survives icon-only bars,
        // icon+label pairs, and cluster-frame bars alike.
        var items: [[Int]] = []
        for index in node.children.indices {
            if node.children[index].type == .Text,
               let lastItem = items.last,
               lastItem.count == 1,
               node.children[lastItem[0]].type == .Icon {
                items[items.count - 1].append(index)
            } else {
                items.append([index])
            }
        }

        guard !items.isEmpty else { return }
        let itemWidth = node.width / CGFloat(items.count)
        let hasLabels = node.children.contains { $0.type == .Text }

        for (slot, group) in items.enumerated() {
            let baseX = CGFloat(slot) * itemWidth

            for index in group {
                switch node.children[index].type {
                case .Icon:
                    node.children[index].width = min(node.children[index].width, 22)
                    node.children[index].height = min(node.children[index].height, 22)
                    node.children[index].x = baseX + (itemWidth - node.children[index].width) / 2
                    node.children[index].y = hasLabels
                        ? 10
                        : (node.height - node.children[index].height) / 2

                case .Text:
                    let text = node.children[index].text ?? ""
                    let maxLabelWidth = max(28, itemWidth - 6)
                    var labelStyle = node.children[index].style

                    // Shrink the font until the label fits its slot on one
                    // line — an 11pt full word beats a truncated "Activi…".
                    var fontSize = labelStyle.fontSize ?? 11
                    while fontSize > 9,
                          ceil(measuredTextSize(text, style: labelStyle).width) > maxLabelWidth {
                        fontSize -= 1
                        labelStyle.fontSize = fontSize
                    }
                    node.children[index].style.fontSize = fontSize

                    let labelWidth = min(maxLabelWidth, ceil(measuredTextSize(text, style: labelStyle).width) + 2)
                    node.children[index].width = labelWidth
                    node.children[index].height = 16
                    node.children[index].textBehavior = TextBehavior(wrap: false, autoHeight: false, maxLines: 1)
                    node.children[index].style.textAlign = "center"
                    node.children[index].x = baseX + (itemWidth - labelWidth) / 2
                    node.children[index].y = 36

                default:
                    node.children[index].width = max(1, itemWidth - 8)
                    node.children[index].x = baseX + 4
                    node.children[index].y = max(0, (node.height - node.children[index].height) / 2)
                }
            }
        }
    }
    
    private func relayoutChatInput(_ node: inout DesignNode) {
        guard !node.children.isEmpty else { return }
        
        for index in node.children.indices {
            let name = node.children[index].name.lowercased()
            
            if name.contains("attach") {
                node.children[index].x = 18
                node.children[index].y = (node.height - node.children[index].height) / 2
            } else if name.contains("placeholder") {
                node.children[index].x = 50
                node.children[index].y = (node.height - node.children[index].height) / 2
                node.children[index].width = max(1, node.width - 118)
            } else if name.contains("send button") {
                node.children[index].width = 44
                node.children[index].height = 44
                node.children[index].x = node.width - 54
                node.children[index].y = (node.height - 44) / 2
                fitChildrenInsideParent(&node.children[index])
            }
        }
    }
    
    // Auto-Layout Engine
    private func applyAutoLayout(to nodes: inout [DesignNode]) {
        for i in 0..<nodes.count {
            if !nodes[i].children.isEmpty {
                applyAutoLayout(to: &nodes[i].children)
            }
            
            if nodes[i].type == .Frame || nodes[i].type == .Rectangle,
               let layout = nodes[i].style.layout {
                applyAutoLayout(to: &nodes[i], layout: layout)
            }
        }
    }
    
    private func applyAutoLayout(to node: inout DesignNode, layout: String) {
        guard !node.children.isEmpty else { return }
        
        let normalizedLayout = layout
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "-", with: "")
            .replacingOccurrences(of: "_", with: "")
        let spacing = node.style.spacing ?? 16
        let paddingTop = node.style.paddingTop ?? 16
        let paddingRight = node.style.paddingRight ?? 16
        let paddingBottom = node.style.paddingBottom ?? 16
        let paddingLeft = node.style.paddingLeft ?? 16
        let align = (node.style.layoutAlign ?? "stretch")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        let contentWidth = max(1, node.width - paddingLeft - paddingRight)
        let contentHeight = max(1, node.height - paddingTop - paddingBottom)
        
        if ["vertical", "verticalstack", "vstack", "column"].contains(normalizedLayout) {
            var currentY = paddingTop

            for index in node.children.indices {
                if node.children[index].manuallyPositioned == true { continue }
                let marginTop = node.children[index].style.marginTop ?? 0
                let marginRight = node.children[index].style.marginRight ?? 0
                let marginBottom = node.children[index].style.marginBottom ?? 0
                let marginLeft = node.children[index].style.marginLeft ?? 0
                let childContentWidth = max(1, contentWidth - marginLeft - marginRight)
                
                switch align {
                case "left", "leading", "start":
                    node.children[index].x = paddingLeft + marginLeft
                case "right", "trailing", "end":
                    node.children[index].x = node.width - paddingRight - marginRight - node.children[index].width
                case "center", "middle":
                    node.children[index].x = paddingLeft + marginLeft + (childContentWidth - node.children[index].width) / 2
                default:
                    node.children[index].x = paddingLeft + marginLeft
                    node.children[index].width = childContentWidth
                }
                
                node.children[index].y = currentY + marginTop
                currentY += marginTop + node.children[index].height + marginBottom + spacing
            }
            
            let calculatedHeight = currentY - spacing + paddingBottom
            if calculatedHeight > node.height && !isMobileScreenFrame(node) {
                node.height = calculatedHeight
            }
        } else if ["horizontal", "horizontalstack", "hstack", "row"].contains(normalizedLayout) {
            var currentX = paddingLeft

            for index in node.children.indices {
                if node.children[index].manuallyPositioned == true { continue }
                let marginTop = node.children[index].style.marginTop ?? 0
                let marginRight = node.children[index].style.marginRight ?? 0
                let marginBottom = node.children[index].style.marginBottom ?? 0
                let marginLeft = node.children[index].style.marginLeft ?? 0
                let childContentHeight = max(1, contentHeight - marginTop - marginBottom)
                
                node.children[index].x = currentX + marginLeft
                
                switch align {
                case "top", "start":
                    node.children[index].y = paddingTop + marginTop
                case "bottom", "end":
                    node.children[index].y = node.height - paddingBottom - marginBottom - node.children[index].height
                case "stretch":
                    node.children[index].y = paddingTop + marginTop
                    node.children[index].height = childContentHeight
                default:
                    node.children[index].y = paddingTop + marginTop + (childContentHeight - node.children[index].height) / 2
                }
                
                currentX += marginLeft + node.children[index].width + marginRight + spacing
            }
            
            let calculatedWidth = currentX - spacing + paddingRight
            if calculatedWidth > node.width {
                fitHorizontalChildrenInsideParent(&node, spacing: spacing)
            }
        }
    }
    
    private func fitHorizontalChildrenInsideParent(_ parent: inout DesignNode, spacing: CGFloat) {
        guard !parent.children.isEmpty else { return }
        
        let paddingLeft = parent.style.paddingLeft ?? 16
        let paddingRight = parent.style.paddingRight ?? 16
        let contentWidth = max(1, parent.width - paddingLeft - paddingRight)
        let count = CGFloat(parent.children.count)
        let totalSpacing = spacing * max(0, count - 1)
        let availableChildWidth = max(1, (contentWidth - totalSpacing) / max(1, count))
        var currentX = paddingLeft
        
        for index in parent.children.indices {
            parent.children[index].width = min(parent.children[index].width, availableChildWidth)
            parent.children[index].x = currentX
            currentX += parent.children[index].width + spacing
            fitChildrenInsideParent(&parent.children[index])
        }
    }
    
    private func applyPaddingBounds(in nodes: inout [DesignNode]) {
        for index in nodes.indices {
            applyPaddingBounds(toChildrenOf: &nodes[index])
            
            if !nodes[index].children.isEmpty {
                applyPaddingBounds(in: &nodes[index].children)
            }
        }
    }
    
    private func applyPaddingBounds(toChildrenOf parent: inout DesignNode) {
        guard !parent.children.isEmpty,
              parent.style.layout == nil,
              parent.type == .Frame || parent.type == .Rectangle
        else {
            return
        }
        
        let paddingTop = parent.style.paddingTop ?? 0
        let paddingRight = parent.style.paddingRight ?? 0
        let paddingBottom = parent.style.paddingBottom ?? 0
        let paddingLeft = parent.style.paddingLeft ?? 0
        let parentHasPadding = paddingTop > 0 || paddingRight > 0 || paddingBottom > 0 || paddingLeft > 0
        
        for index in parent.children.indices {
            let marginTop = parent.children[index].style.marginTop ?? 0
            let marginRight = parent.children[index].style.marginRight ?? 0
            let marginBottom = parent.children[index].style.marginBottom ?? 0
            let marginLeft = parent.children[index].style.marginLeft ?? 0
            let childHasMargin = marginTop > 0 || marginRight > 0 || marginBottom > 0 || marginLeft > 0
            
            guard parentHasPadding || childHasMargin else { continue }
            
            let minX = paddingLeft + marginLeft
            let maxWidth = max(1, parent.width - paddingLeft - paddingRight - marginLeft - marginRight)
            if parent.children[index].width > maxWidth {
                parent.children[index].width = maxWidth
            }
            let maxX = max(minX, parent.width - paddingRight - marginRight - parent.children[index].width)
            parent.children[index].x = min(max(parent.children[index].x, minX), maxX)
            
            let minY = paddingTop + marginTop
            let maxHeight = max(1, parent.height - paddingTop - paddingBottom - marginTop - marginBottom)
            if parent.children[index].height > maxHeight {
                parent.children[index].height = maxHeight
            }
            let maxY = max(minY, parent.height - paddingBottom - marginBottom - parent.children[index].height)
            parent.children[index].y = min(max(parent.children[index].y, minY), maxY)
        }
    }
    
    private func applyConstraints(in nodes: inout [DesignNode]) {
        for index in nodes.indices {
            applyConstraints(toChildrenOf: &nodes[index])
            
            if !nodes[index].children.isEmpty {
                applyConstraints(in: &nodes[index].children)
            }
        }
    }
    
    private func applyConstraints(toChildrenOf parent: inout DesignNode) {
        guard !parent.children.isEmpty else { return }
        
        for index in parent.children.indices {
            guard let constraints = parent.children[index].constraints else { continue }
            
            if let left = constraints.left, let right = constraints.right {
                parent.children[index].x = left
                parent.children[index].width = max(1, parent.width - left - right)
            } else if let left = constraints.left {
                parent.children[index].x = left
            } else if let right = constraints.right {
                parent.children[index].x = parent.width - right - parent.children[index].width
            } else if let centerX = constraints.centerX {
                parent.children[index].x = (parent.width - parent.children[index].width) / 2 + centerX
            }
            
            if let top = constraints.top, let bottom = constraints.bottom {
                parent.children[index].y = top
                parent.children[index].height = max(1, parent.height - top - bottom)
            } else if let top = constraints.top {
                parent.children[index].y = top
            } else if let bottom = constraints.bottom {
                parent.children[index].y = parent.height - bottom - parent.children[index].height
            } else if let centerY = constraints.centerY {
                parent.children[index].y = (parent.height - parent.children[index].height) / 2 + centerY
            }
        }
    }


    // מבצע פעולה אחת של Agent
    private func applyDesignAction(
        _ action: DesignAction,
        temporaryIds: inout [String: UUID]
    ) {
        let resolvedParentId = resolvedParentId(for: action, temporaryIds: temporaryIds)
        
        switch action.type {
        case .createFrame:
            let createdId = applyCreateFrame(action, parentId: resolvedParentId)
            rememberCreatedNode(createdId, for: action, temporaryIds: &temporaryIds)
            if resolvedParentId == nil,
               currentAgentRequestIntent == .createNewDesign,
               shouldTreatActionAsRootScreen(action),
               temporaryIds[defaultAgentRootFrameReference] == nil {
                temporaryIds[defaultAgentRootFrameReference] = createdId
            }
            
        case .createText:
            let createdId = applyCreateText(action, parentId: resolvedParentId)
            rememberCreatedNode(createdId, for: action, temporaryIds: &temporaryIds)
            
        case .createButton:
            let createdId = applyCreateButton(action, parentId: resolvedParentId)
            rememberCreatedNode(createdId, for: action, temporaryIds: &temporaryIds)
            
        case .createInput:
            let createdId = applyCreateInput(action, parentId: resolvedParentId)
            rememberCreatedNode(createdId, for: action, temporaryIds: &temporaryIds)
            
        case .createRectangle:
            let createdId = applyCreateRectangle(action, parentId: resolvedParentId)
            rememberCreatedNode(createdId, for: action, temporaryIds: &temporaryIds)
            
        case .createImage:
            let createdId = applyCreateImage(action, parentId: resolvedParentId)
            rememberCreatedNode(createdId, for: action, temporaryIds: &temporaryIds)
            
        case .createIcon:
            let createdId = applyCreateIcon(action, parentId: resolvedParentId)
            rememberCreatedNode(createdId, for: action, temporaryIds: &temporaryIds)
            
        case .createPage:
            applyCreatePage(action)
            
        case .updateText:
            applyUpdateText(action, nodeId: resolvedNodeId(for: action, temporaryIds: temporaryIds))
            
        case .updateStyle:
            applyUpdateStyle(action, nodeId: resolvedNodeId(for: action, temporaryIds: temporaryIds))
            
        case .moveNode:
            applyMoveNode(action, nodeId: resolvedNodeId(for: action, temporaryIds: temporaryIds))
            
        case .resizeNode:
            applyResizeNode(action, nodeId: resolvedNodeId(for: action, temporaryIds: temporaryIds))
            
        case .scaleNode:
            applyScaleNode(action, nodeId: resolvedNodeId(for: action, temporaryIds: temporaryIds))
            
        case .setAutoLayout:
            applySetAutoLayout(action, nodeId: resolvedNodeId(for: action, temporaryIds: temporaryIds))
            
        case .pinNode:
            applyPinNode(action, nodeId: resolvedNodeId(for: action, temporaryIds: temporaryIds))
            
        case .bringToFront:
            applySetLayerOrder(action, nodeId: resolvedNodeId(for: action, temporaryIds: temporaryIds), order: .front)
            
        case .sendToBack:
            applySetLayerOrder(action, nodeId: resolvedNodeId(for: action, temporaryIds: temporaryIds), order: .back)
            
        case .setZIndex:
            applySetZIndex(action, nodeId: resolvedNodeId(for: action, temporaryIds: temporaryIds))
            
        case .alignChildren:
            applyAlignChildren(action, nodeId: resolvedNodeId(for: action, temporaryIds: temporaryIds))
            
        case .distributeChildren:
            applyDistributeChildren(action, nodeId: resolvedNodeId(for: action, temporaryIds: temporaryIds))
            
        case .positionRelativeTo:
            applyPositionRelativeTo(action, nodeId: resolvedNodeId(for: action, temporaryIds: temporaryIds), temporaryIds: temporaryIds)

        case .deleteNode:
            applyDeleteNode(nodeId: resolvedNodeId(for: action, temporaryIds: temporaryIds))

        case .createOnboardingScreen:
            let createdId = applyCreateOnboardingScreen(action, parentId: resolvedParentId)
            rememberCreatedNode(createdId, for: action, temporaryIds: &temporaryIds)
            
        case .createComponent:
            let createdId = applyCreateComponent(action, parentId: resolvedParentId)
            rememberCreatedNode(createdId, for: action, temporaryIds: &temporaryIds)
            
        case .createPresentationShot:
            let createdId = applyCreatePresentationShot(action, parentId: resolvedParentId)
            rememberCreatedNode(createdId, for: action, temporaryIds: &temporaryIds)
        }
    }
    
    private func resolvedNodeId(
        for action: DesignAction,
        temporaryIds: [String: UUID]
    ) -> UUID? {
        if let nodeId = action.nodeId {
            return nodeId
        }
        
        if let nodeReference = action.nodeReference {
            return temporaryIds[nodeReference]
        }
        
        if currentAgentRequestIntent == .editSelection {
            return selectedNodeId
        }
        
        return nil
    }
    
    private func resolvedParentId(
        for action: DesignAction,
        temporaryIds: [String: UUID]
    ) -> UUID? {
        if let parentId = action.parentId {
            return parentId
        }
        
        if let parentReference = action.parentReference {
            return temporaryIds[parentReference]
        }
        
        if shouldAutoParentUnreferencedAgentActions,
           isVisualCreateAction(action) || shouldAutoNestUnparentedFrame(action) {
            if let defaultRootFrameId = temporaryIds[defaultAgentRootFrameReference] {
                return defaultRootFrameId
            }
            
            if let implicitFrameId = temporaryIds[implicitAgentFrameReference] {
                return implicitFrameId
            }
        }
        
        return nil
    }
    
    private func resolvedRelativeNodeId(
        for action: DesignAction,
        temporaryIds: [String: UUID]
    ) -> UUID? {
        if let relativeToNodeId = action.relativeToNodeId {
            return relativeToNodeId
        }
        
        if let relativeToReference = action.relativeToReference {
            return temporaryIds[relativeToReference]
        }
        
        return nil
    }
    
    private func rememberCreatedNode(
        _ createdId: UUID,
        for action: DesignAction,
        temporaryIds: inout [String: UUID]
    ) {
        guard let nodeReference = action.nodeReference else { return }
        temporaryIds[nodeReference] = createdId
    }
    
    private func applyBoxSpacing(from action: DesignAction, to style: inout NodeStyle) {
        if let padding = action.padding {
            style.paddingTop = padding
            style.paddingRight = padding
            style.paddingBottom = padding
            style.paddingLeft = padding
        }
        if let paddingH = action.paddingH {
            style.paddingLeft = paddingH
            style.paddingRight = paddingH
        }
        if let paddingV = action.paddingV {
            style.paddingTop = paddingV
            style.paddingBottom = paddingV
        }
        if let paddingTop = action.paddingTop { style.paddingTop = paddingTop }
        if let paddingRight = action.paddingRight { style.paddingRight = paddingRight }
        if let paddingBottom = action.paddingBottom { style.paddingBottom = paddingBottom }
        if let paddingLeft = action.paddingLeft { style.paddingLeft = paddingLeft }
        
        if let margin = action.margin {
            style.marginTop = margin
            style.marginRight = margin
            style.marginBottom = margin
            style.marginLeft = margin
        }
        if let marginH = action.marginH {
            style.marginLeft = marginH
            style.marginRight = marginH
        }
        if let marginV = action.marginV {
            style.marginTop = marginV
            style.marginBottom = marginV
        }
        if let marginTop = action.marginTop { style.marginTop = marginTop }
        if let marginRight = action.marginRight { style.marginRight = marginRight }
        if let marginBottom = action.marginBottom { style.marginBottom = marginBottom }
        if let marginLeft = action.marginLeft { style.marginLeft = marginLeft }
    }

    private func applyScrollBehavior(from action: DesignAction, to node: inout DesignNode) {
        guard action.scrollAxis != nil ||
              action.scrollOffset != nil ||
              action.recycleItemSpacing != nil ||
              action.recycleItemCount != nil
        else { return }

        var behavior = node.scrollBehavior ?? ScrollBehavior(axis: "vertical")
        if let axis = action.scrollAxis {
            behavior.axis = axis
        }
        if let offset = action.scrollOffset {
            behavior.initialOffset = max(0, offset)
        }
        if let spacing = action.recycleItemSpacing {
            behavior.itemSpacing = max(0, spacing)
        }
        if let count = action.recycleItemCount {
            behavior.itemCount = max(0, count)
        }

        node.scrollBehavior = behavior
        node.clipContent = true
    }

    // Data-bound repeat (recycler) template from agent/MCP design actions:
    // repeatSourceVariable + repeatItemAlias turn the node into a template
    // cloned per item of that JSON-array variable.
    private func applyTimePicker(from action: DesignAction, to node: inout DesignNode) {
        guard action.timePickerHourVariable != nil || action.timePickerMinuteVariable != nil else { return }
        node.timePicker = TimePickerBinding(
            hourVariable: action.timePickerHourVariable ?? "alarmHour",
            minuteVariable: action.timePickerMinuteVariable ?? "alarmMinute"
        )
    }

    private func applyRepeatBinding(from action: DesignAction, to node: inout DesignNode) {
        guard let sourceVariable = action.repeatSourceVariable, !sourceVariable.isEmpty else { return }
        node.repeatBinding = RepeatBinding(
            sourceVariable: sourceVariable,
            itemAlias: (action.repeatItemAlias?.isEmpty == false ? action.repeatItemAlias! : "item"),
            maxItems: action.repeatMaxItems,
            axis: action.repeatAxis == "horizontal" ? .horizontal : .vertical,
            isScrollable: action.repeatScrollable ?? false,
            filterVariable: (action.repeatFilterVariable?.isEmpty == false ? action.repeatFilterVariable : nil),
            categoryVariable: (action.repeatCategoryVariable?.isEmpty == false ? action.repeatCategoryVariable : nil)
        )
    }

    // יוצר Frame חדש דרך פעולה של Agent
    /// Next free slot for a ROOT frame in a wrapping grid, so screens added one
    /// at a time (not through a full generation) also tile into rows instead of
    /// stacking at one point or running off the right edge.
    private func nextRootFrameOrigin(width: CGFloat, height: CGFloat) -> CGPoint {
        let roots = project.pages[currentPageIndex].nodes.filter { $0.type == .Frame }
        let perRow = max(1, Self.screensPerRow)
        let index = roots.count
        let stepX = max(width, 390) + 72
        let stepY = max(height, 844) + 150
        let col = index % perRow
        let row = index / perRow
        return CGPoint(x: 100 + CGFloat(col) * stepX, y: 80 + CGFloat(row) * stepY)
    }

    private func applyCreateFrame(_ action: DesignAction, parentId: UUID?) -> UUID {
        let shouldForceMobileRoot = parentId == nil &&
            currentAgentRequestIntent == .createNewDesign &&
            shouldTreatActionAsRootScreen(action)
        let frameWidth = shouldForceMobileRoot ? CGFloat(390) : max(1, action.width ?? 390)
        let frameHeight = shouldForceMobileRoot ? CGFloat(844) : max(1, action.height ?? 844)
        // Root frames with no given position tile into a wrapping grid; nested
        // frames keep the plain (100,100) default.
        let autoOrigin = parentId == nil ? nextRootFrameOrigin(width: frameWidth, height: frameHeight) : CGPoint(x: 100, y: 100)
        
        var newNode = DesignNode(
            id: UUID(),
            type: .Frame,
            name: action.name ?? "Frame",

            x: action.x ?? autoOrigin.x,
            y: action.y ?? autoOrigin.y,
            width: frameWidth,
            height: frameHeight,
            text: nil,
            style: NodeStyle(
                fill: action.fill ?? "#111827",
                stroke: action.stroke,
                strokeWidth: action.strokeWidth,
                cornerRadius: action.cornerRadius ?? 24,
                opacity: action.opacity ?? 1.0,
                fontSize: nil,
                textAlign: action.textAlign,
                letterSpacing: action.letterSpacing,
                lineHeight: action.lineHeight,
                paddingTop: action.paddingTop ?? action.paddingV ?? action.padding ?? (shouldForceMobileRoot ? 24 : nil),
                paddingRight: action.paddingRight ?? action.paddingH ?? action.padding ?? (shouldForceMobileRoot ? 24 : nil),
                paddingBottom: action.paddingBottom ?? action.paddingV ?? action.padding ?? (shouldForceMobileRoot ? 24 : nil),
                paddingLeft: action.paddingLeft ?? action.paddingH ?? action.padding ?? (shouldForceMobileRoot ? 24 : nil),
                layout: action.layout,
                spacing: action.spacing,
                layoutAlign: action.layoutAlign ?? action.alignment,
                shadow: action.shadow,
                blur: action.blur,
                backgroundBlur: action.backgroundBlur,
                overlayColor: action.overlayColor,
                overlayOpacity: action.overlayOpacity,
                gradient: action.gradient
            ),
            constraints: action.constraints,
            clipContent: action.clipContent ?? shouldForceMobileRoot,
            zIndex: action.zIndex ?? 0,
            textBehavior: action.textBehavior,
            children: []
        )
        applyBoxSpacing(from: action, to: &newNode.style)
        applyScrollBehavior(from: action, to: &newNode)
        applyRepeatBinding(from: action, to: &newNode)
        applyTimePicker(from: action, to: &newNode)

        insertNode(newNode, parentId: parentId)
        return newNode.id
    }
    
    // יוצר Text חדש דרך פעולה של Agent
    private func applyCreateText(_ action: DesignAction, parentId: UUID?) -> UUID {
        var newNode = DesignNode(
            id: UUID(),
            type: .Text,
            name: action.name ?? "Text",

            x: action.x ?? 120,
            y: action.y ?? 120,
            width: max(1, action.width ?? 240),
            height: max(1, action.height ?? 44),
            text: action.text ?? "New Text",
            style: NodeStyle(
                fill: action.fill ?? "#FFFFFF",
                stroke: action.stroke,
                strokeWidth: action.strokeWidth,
                cornerRadius: action.cornerRadius ?? 0,
                opacity: action.opacity ?? 1.0,
                fontSize: action.fontSize ?? 24,
                fontWeight: action.fontWeight,
                fontFamily: action.fontFamily,
                textColor: action.textColor,
                textAlign: action.textAlign,
                letterSpacing: action.letterSpacing,
                lineHeight: action.lineHeight,
                gradient: action.gradient
            ),
            constraints: action.constraints,
            clipContent: action.clipContent ?? false,
            zIndex: action.zIndex ?? 0,
            textBehavior: action.textBehavior,
            children: []
        )
        applyBoxSpacing(from: action, to: &newNode.style)
        applyRepeatBinding(from: action, to: &newNode)
        applyTimePicker(from: action, to: &newNode)
        
        insertNode(newNode, parentId: parentId)
        return newNode.id
    }
    
    // יוצר Button חדש דרך פעולה של Agent
    private func applyCreateButton(_ action: DesignAction, parentId: UUID?) -> UUID {
        var newNode = DesignNode(
            id: UUID(),
            type: .Button,
            name: action.name ?? "Button",

            x: action.x ?? 120,
            y: action.y ?? 220,
            width: max(1, action.width ?? 180),
            height: max(1, action.height ?? 52),
            text: action.text ?? "Button",
            style: NodeStyle(
                fill: action.fill ?? "#2563EB",
                stroke: action.stroke,
                strokeWidth: action.strokeWidth,
                cornerRadius: action.cornerRadius ?? 12,
                opacity: action.opacity ?? 1.0,
                fontSize: action.fontSize ?? 16,
                fontWeight: action.fontWeight,
                fontFamily: action.fontFamily,
                textColor: action.textColor,
                textAlign: action.textAlign,
                letterSpacing: action.letterSpacing,
                lineHeight: action.lineHeight,
                gradient: action.gradient
            ),
            constraints: action.constraints,
            clipContent: action.clipContent ?? false,
            zIndex: action.zIndex ?? 0,
            textBehavior: action.textBehavior,
            children: []
        )
        applyBoxSpacing(from: action, to: &newNode.style)
        applyRepeatBinding(from: action, to: &newNode)
        applyTimePicker(from: action, to: &newNode)
        
        insertNode(newNode, parentId: parentId)
        return newNode.id
    }
    
    // יוצר Input חדש דרך פעולה של Agent
    private func applyCreateInput(_ action: DesignAction, parentId: UUID?) -> UUID {
        var newNode = DesignNode(
            id: UUID(),
            type: .Input,
            name: action.name ?? "Input",

            x: action.x ?? 120,
            y: action.y ?? 300,
            width: max(1, action.width ?? 326),
            height: max(1, action.height ?? 52),
            text: action.text ?? "Input",
            style: NodeStyle(
                fill: action.fill ?? "#FFFFFF",
                stroke: action.stroke ?? "#CBD5E1",
                strokeWidth: action.strokeWidth,
                cornerRadius: action.cornerRadius ?? 14,
                opacity: action.opacity ?? 1.0,
                fontSize: action.fontSize ?? 15,
                fontWeight: action.fontWeight,
                fontFamily: action.fontFamily,
                textColor: action.textColor,
                textAlign: action.textAlign,
                letterSpacing: action.letterSpacing,
                lineHeight: action.lineHeight,
                gradient: action.gradient
            ),
            constraints: action.constraints,
            clipContent: action.clipContent ?? false,
            zIndex: action.zIndex ?? 0,
            textBehavior: action.textBehavior,
            children: []
        )
        applyBoxSpacing(from: action, to: &newNode.style)
        applyRepeatBinding(from: action, to: &newNode)
        applyTimePicker(from: action, to: &newNode)
        
        insertNode(newNode, parentId: parentId)
        return newNode.id
    }
    
    // יוצר Rectangle חדש דרך פעולה של Agent
    private func applyCreateRectangle(_ action: DesignAction, parentId: UUID?) -> UUID {
        var newNode = DesignNode(
            id: UUID(),
            type: .Rectangle,
            name: action.name ?? "Rectangle",

            x: action.x ?? 120,
            y: action.y ?? 120,
            width: max(1, action.width ?? 120),
            height: max(1, action.height ?? 120),
            text: nil,
            style: NodeStyle(
                fill: action.fill ?? "#E5E7EB",
                stroke: action.stroke,
                strokeWidth: action.strokeWidth,
                cornerRadius: action.cornerRadius ?? 12,
                opacity: action.opacity ?? 1.0,
                fontSize: nil,
                textAlign: action.textAlign,
                letterSpacing: action.letterSpacing,
                lineHeight: action.lineHeight,
                gradient: action.gradient
            ),
            constraints: action.constraints,
            clipContent: action.clipContent ?? false,
            zIndex: action.zIndex ?? 0,
            textBehavior: action.textBehavior,
            children: []
        )
        applyBoxSpacing(from: action, to: &newNode.style)
        applyRepeatBinding(from: action, to: &newNode)
        applyTimePicker(from: action, to: &newNode)
        
        insertNode(newNode, parentId: parentId)
        return newNode.id
    }
    
    // מעדכן טקסט של Node קיים
    private func applyUpdateText(_ action: DesignAction, nodeId: UUID?) {
        guard let nodeId else { return }
        
        _ = updateNode(id: nodeId, in: &project.pages[currentPageIndex].nodes) { node in
            node.text = action.text ?? node.text
        }
    }
    // מעדכן Style של Node קיים
    private func applyUpdateStyle(_ action: DesignAction, nodeId: UUID?) {
        guard let nodeId else { return }
        
        _ = updateNode(id: nodeId, in: &project.pages[currentPageIndex].nodes) { node in
            if let fill = action.fill          { node.style.fill = fill }
            if let stroke = action.stroke      { node.style.stroke = stroke }
            if let strokeWidth = action.strokeWidth { node.style.strokeWidth = strokeWidth }
            if let gradient = action.gradient  { node.style.gradient = gradient }
            if let cornerRadius = action.cornerRadius { node.style.cornerRadius = max(0, cornerRadius) }
            if let opacity = action.opacity    { node.style.opacity = min(max(opacity, 0), 1) }
            if let fontSize = action.fontSize  { node.style.fontSize = max(1, fontSize) }
            if let fontWeight = action.fontWeight { node.style.fontWeight = fontWeight }
            if let fontFamily = action.fontFamily { node.style.fontFamily = fontFamily }
            if let tc = action.textColor       { node.style.textColor = tc }
            if let align = action.textAlign    { node.style.textAlign = align }
            if let ls = action.letterSpacing   { node.style.letterSpacing = ls }
            if let lh = action.lineHeight      { node.style.lineHeight = lh }
            if let constraints = action.constraints { node.constraints = constraints }
            if let clipContent = action.clipContent { node.clipContent = clipContent }
            if let zIndex = action.zIndex { node.zIndex = zIndex }
            if let textBehavior = action.textBehavior { node.textBehavior = textBehavior }
            applyScrollBehavior(from: action, to: &node)
            applyRepeatBinding(from: action, to: &node)
            if let imageName = action.imageName { node.imageName = imageName }
            if let imageSource = action.imageSource { node.imageSource = imageSource }
            if let contentMode = action.contentMode { node.contentMode = contentMode }
            if let iconName = action.iconName  { node.iconName = iconName }
            if let layout = action.layout { node.style.layout = layout }
            if let spacing = action.spacing { node.style.spacing = max(0, spacing) }
            if let layoutAlign = action.layoutAlign ?? action.alignment { node.style.layoutAlign = layoutAlign }
            if let shadow = action.shadow { node.style.shadow = shadow }
            if let overlayColor = action.overlayColor { node.style.overlayColor = overlayColor }
            if let overlayOpacity = action.overlayOpacity { node.style.overlayOpacity = overlayOpacity }
            if let blur = action.blur { node.style.blur = blur }
            if let backgroundBlur = action.backgroundBlur { node.style.backgroundBlur = backgroundBlur }
            applyBoxSpacing(from: action, to: &node.style)
        }
    }
    // מזיז Node קיים
    private func applyMoveNode(_ action: DesignAction, nodeId: UUID?) {
        guard let nodeId else { return }
        
        _ = updateNode(id: nodeId, in: &project.pages[currentPageIndex].nodes) { node in
            if let x = action.x {
                node.x = x
            }
            
            if let y = action.y {
                node.y = y
            }
        }
    }
    // משנה מיקום וגודל של Node קיים
    private func applyResizeNode(_ action: DesignAction, nodeId: UUID?) {
        guard let nodeId else { return }
        
        _ = updateNode(id: nodeId, in: &project.pages[currentPageIndex].nodes) { node in
            if let x = action.x {
                node.x = x
            }
            
            if let y = action.y {
                node.y = y
            }
            
            if let width = action.width {
                node.width = max(1, width)
            }
            
            if let height = action.height {
                node.height = max(1, height)
            }
        }
    }
    
    private func applyScaleNode(_ action: DesignAction, nodeId: UUID?) {
        guard let nodeId else { return }
        
        _ = updateNode(id: nodeId, in: &project.pages[currentPageIndex].nodes) { node in
            let scale = max(0.1, action.scale ?? 1)
            let centerX = node.x + node.width / 2
            let centerY = node.y + node.height / 2
            let newWidth = max(1, action.width ?? node.width * scale)
            let newHeight = max(1, action.height ?? node.height * scale)
            
            node.width = newWidth
            node.height = newHeight
            node.x = action.x ?? centerX - newWidth / 2
            node.y = action.y ?? centerY - newHeight / 2
        }
    }
    
    private func applySetAutoLayout(_ action: DesignAction, nodeId: UUID?) {
        guard let nodeId else { return }
        
        _ = updateNode(id: nodeId, in: &project.pages[currentPageIndex].nodes) { node in
            if let layout = action.layout {
                node.style.layout = layout
            }
            
            if let spacing = action.spacing {
                node.style.spacing = max(0, spacing)
            }
            
            if let layoutAlign = action.layoutAlign ?? action.alignment {
                node.style.layoutAlign = layoutAlign
            }
            
            applyBoxSpacing(from: action, to: &node.style)
        }
    }
    
    private func applyPinNode(_ action: DesignAction, nodeId: UUID?) {
        guard let nodeId else { return }
        
        _ = updateNode(id: nodeId, in: &project.pages[currentPageIndex].nodes) { node in
            if let constraints = action.constraints {
                node.constraints = constraints
            }
        }
    }
    
    private enum LayerOrderTarget {
        case front
        case back
    }
    
    private func applySetLayerOrder(_ action: DesignAction, nodeId: UUID?, order: LayerOrderTarget) {
        guard let nodeId else { return }
        
        let allZ = allZIndexes(in: project.pages[currentPageIndex].nodes)
        let nextZ: Double
        
        switch order {
        case .front:
            nextZ = (allZ.max() ?? 0) + 1
        case .back:
            nextZ = (allZ.min() ?? 0) - 1
        }
        
        _ = updateNode(id: nodeId, in: &project.pages[currentPageIndex].nodes) { node in
            node.zIndex = nextZ
        }
    }
    
    private func applySetZIndex(_ action: DesignAction, nodeId: UUID?) {
        guard let nodeId,
              let zIndex = action.zIndex
        else { return }
        
        _ = updateNode(id: nodeId, in: &project.pages[currentPageIndex].nodes) { node in
            node.zIndex = zIndex
        }
    }
    
    private func allZIndexes(in nodes: [DesignNode]) -> [Double] {
        nodes.flatMap { node in
            [node.zIndex ?? 0] + allZIndexes(in: node.children)
        }
    }
    
    private func applyAlignChildren(_ action: DesignAction, nodeId: UUID?) {
        guard let nodeId else { return }
        
        _ = updateNode(id: nodeId, in: &project.pages[currentPageIndex].nodes) { node in
            alignChildren(in: &node, alignment: action.alignment ?? "center")
        }
    }
    
    private func applyDistributeChildren(_ action: DesignAction, nodeId: UUID?) {
        guard let nodeId else { return }
        
        _ = updateNode(id: nodeId, in: &project.pages[currentPageIndex].nodes) { node in
            distributeChildren(
                in: &node,
                axis: action.axis ?? "horizontal",
                padding: action.padding ?? action.paddingH ?? action.paddingLeft ?? 16,
                spacing: action.spacing
            )
        }
    }
    
    private func applyPositionRelativeTo(
        _ action: DesignAction,
        nodeId: UUID?,
        temporaryIds: [String: UUID]
    ) {
        guard let nodeId,
              let relativeNodeId = resolvedRelativeNodeId(for: action, temporaryIds: temporaryIds),
              let relativeRect = globalRect(for: relativeNodeId)
        else { return }
        
        let parentRect = parentNode(of: nodeId)
            .flatMap { globalRect(for: $0.id) }
            ?? .zero
        let anchor = (action.anchor ?? "below").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let offsetX = action.offsetX ?? action.x ?? 0
        let offsetY = action.offsetY ?? action.y ?? 0
        
        _ = updateNode(id: nodeId, in: &project.pages[currentPageIndex].nodes) { node in
            let globalPoint: CGPoint
            
            switch anchor {
            case "above", "top":
                globalPoint = CGPoint(
                    x: relativeRect.midX - node.width / 2 + offsetX,
                    y: relativeRect.minY - node.height + offsetY
                )
            case "below", "bottom":
                globalPoint = CGPoint(
                    x: relativeRect.midX - node.width / 2 + offsetX,
                    y: relativeRect.maxY + offsetY
                )
            case "left", "leading":
                globalPoint = CGPoint(
                    x: relativeRect.minX - node.width + offsetX,
                    y: relativeRect.midY - node.height / 2 + offsetY
                )
            case "right", "trailing":
                globalPoint = CGPoint(
                    x: relativeRect.maxX + offsetX,
                    y: relativeRect.midY - node.height / 2 + offsetY
                )
            case "alignleft":
                globalPoint = CGPoint(x: relativeRect.minX + offsetX, y: node.y + parentRect.minY + offsetY)
            case "alignright":
                globalPoint = CGPoint(x: relativeRect.maxX - node.width + offsetX, y: node.y + parentRect.minY + offsetY)
            case "aligntop":
                globalPoint = CGPoint(x: node.x + parentRect.minX + offsetX, y: relativeRect.minY + offsetY)
            case "alignbottom":
                globalPoint = CGPoint(x: node.x + parentRect.minX + offsetX, y: relativeRect.maxY - node.height + offsetY)
            case "center", "centered":
                globalPoint = CGPoint(
                    x: relativeRect.midX - node.width / 2 + offsetX,
                    y: relativeRect.midY - node.height / 2 + offsetY
                )
            default:
                globalPoint = CGPoint(
                    x: relativeRect.midX - node.width / 2 + offsetX,
                    y: relativeRect.maxY + offsetY
                )
            }
            
            node.x = globalPoint.x - parentRect.minX
            node.y = globalPoint.y - parentRect.minY
        }
    }
    
    private func alignChildren(in node: inout DesignNode, alignment: String) {
        let normalized = alignment.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let paddingLeft = node.style.paddingLeft ?? 0
        let paddingRight = node.style.paddingRight ?? 0
        let paddingTop = node.style.paddingTop ?? 0
        let paddingBottom = node.style.paddingBottom ?? 0
        let innerWidth = max(0, node.width - paddingLeft - paddingRight)
        let innerHeight = max(0, node.height - paddingTop - paddingBottom)
        
        for index in node.children.indices {
            switch normalized {
            case "left", "leading":
                node.children[index].x = paddingLeft
            case "right", "trailing":
                node.children[index].x = paddingLeft + innerWidth - node.children[index].width
            case "top":
                node.children[index].y = paddingTop
            case "bottom":
                node.children[index].y = paddingTop + innerHeight - node.children[index].height
            case "middle", "verticalcenter", "centery":
                node.children[index].y = paddingTop + (innerHeight - node.children[index].height) / 2
            default:
                node.children[index].x = paddingLeft + (innerWidth - node.children[index].width) / 2
            }
            node.children[index].constraints = nil
            node.children[index].manuallyPositioned = true
        }
    }
    
    private func distributeChildren(
        in node: inout DesignNode,
        axis: String,
        padding: CGFloat,
        spacing: CGFloat?
    ) {
        guard !node.children.isEmpty else { return }
        
        if distributeIconLabelPairs(in: &node, padding: padding) {
            return
        }
        
        let normalizedAxis = axis.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let childCount = CGFloat(node.children.count)
        
        if normalizedAxis == "vertical" {
            let totalChildHeight = node.children.reduce(CGFloat(0)) { $0 + $1.height }
            let gap = spacing ?? max(0, (node.height - padding * 2 - totalChildHeight) / max(1, childCount - 1))
            var currentY = padding
            
            for index in node.children.indices {
                node.children[index].y = currentY
                node.children[index].x = (node.width - node.children[index].width) / 2
                currentY += node.children[index].height + gap
            }
        } else {
            let totalChildWidth = node.children.reduce(CGFloat(0)) { $0 + $1.width }
            let gap = spacing ?? max(0, (node.width - padding * 2 - totalChildWidth) / max(1, childCount - 1))
            var currentX = padding
            
            for index in node.children.indices {
                node.children[index].x = currentX
                node.children[index].y = (node.height - node.children[index].height) / 2
                currentX += node.children[index].width + gap
            }
        }
    }
    
    private func distributeIconLabelPairs(in node: inout DesignNode, padding: CGFloat) -> Bool {
        var pairs: [(icon: Int, label: Int?, background: Int?)] = []
        var usedLabelIndices = Set<Int>()
        var usedBackgroundIndices = Set<Int>()
        
        for iconIndex in node.children.indices where node.children[iconIndex].type == .Icon {
            let iconName = baseSemanticName(node.children[iconIndex].name)
            let labelIndex = node.children.indices
                .filter { node.children[$0].type == .Text && !usedLabelIndices.contains($0) }
                .min { lhs, rhs in
                    let lhsScore = iconLabelMatchScore(iconName: iconName, labelNode: node.children[lhs], iconNode: node.children[iconIndex])
                    let rhsScore = iconLabelMatchScore(iconName: iconName, labelNode: node.children[rhs], iconNode: node.children[iconIndex])
                    return lhsScore < rhsScore
                }
            
            if let labelIndex {
                usedLabelIndices.insert(labelIndex)
            }
            
            let backgroundIndex = node.children.indices
                .filter {
                    node.children[$0].type == .Rectangle &&
                    !usedBackgroundIndices.contains($0)
                }
                .min { lhs, rhs in
                    let lhsScore = iconLabelMatchScore(iconName: iconName, labelNode: node.children[lhs], iconNode: node.children[iconIndex])
                    let rhsScore = iconLabelMatchScore(iconName: iconName, labelNode: node.children[rhs], iconNode: node.children[iconIndex])
                    return lhsScore < rhsScore
                }
            
            if let backgroundIndex {
                usedBackgroundIndices.insert(backgroundIndex)
            }
            
            pairs.append((icon: iconIndex, label: labelIndex, background: backgroundIndex))
        }
        
        guard pairs.count >= 2 else { return false }
        
        let columnWidth = (node.width - padding * 2) / CGFloat(pairs.count)
        let iconSize = max(22, min(34, node.height * 0.32))
        let backgroundSize = min(max(iconSize + 18, 44), min(64, node.height - 28))
        let iconTop = max(8, min(18, node.height * 0.16))
        let backgroundTop = max(0, iconTop - (backgroundSize - iconSize) / 2)
        let labelTop = min(node.height - 22, iconTop + iconSize + 8)
        
        for (pairIndex, pair) in pairs.enumerated() {
            let columnX = padding + CGFloat(pairIndex) * columnWidth
            let centerX = columnX + columnWidth / 2
            
            if let backgroundIndex = pair.background {
                node.children[backgroundIndex].width = backgroundSize
                node.children[backgroundIndex].height = backgroundSize
                node.children[backgroundIndex].style.cornerRadius = backgroundSize / 2
                node.children[backgroundIndex].x = centerX - backgroundSize / 2
                node.children[backgroundIndex].y = backgroundTop
            }
            
            node.children[pair.icon].width = iconSize
            node.children[pair.icon].height = iconSize
            node.children[pair.icon].x = centerX - iconSize / 2
            node.children[pair.icon].y = iconTop
            
            if let labelIndex = pair.label {
                let labelWidth = min(max(56, columnWidth - 8), 96)
                node.children[labelIndex].width = labelWidth
                node.children[labelIndex].height = max(18, node.children[labelIndex].height)
                node.children[labelIndex].x = centerX - labelWidth / 2
                node.children[labelIndex].y = labelTop
            }
        }
        
        return true
    }
    
    private func baseSemanticName(_ name: String) -> String {
        name.lowercased()
            .replacingOccurrences(of: " icon background", with: "")
            .replacingOccurrences(of: " icon", with: "")
            .replacingOccurrences(of: " label", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
    
    private func iconLabelMatchScore(iconName: String, labelNode: DesignNode, iconNode: DesignNode) -> CGFloat {
        let labelName = baseSemanticName(labelNode.name)
        let semanticScore: CGFloat = labelName.contains(iconName) || iconName.contains(labelName) ? 0 : 1_000
        let centerDistance = abs((labelNode.x + labelNode.width / 2) - (iconNode.x + iconNode.width / 2))
        return semanticScore + centerDistance
    }
    
    // יוצר Image node דרך פעולה של Agent
    private func applyCreateImage(_ action: DesignAction, parentId: UUID?) -> UUID {
        var newNode = DesignNode(
            id: UUID(),
            type: .Image,
            name: action.name ?? "Image",

            x: action.x ?? 32,
            y: action.y ?? 120,
            width: max(1, action.width ?? 326),
            height: max(1, action.height ?? 200),
            text: nil,
            imageName: action.imageName,
            imageSource: action.imageSource ?? action.imageName,
            contentMode: action.contentMode ?? .fill,
            iconName: nil,
            style: NodeStyle(
                fill: action.fill ?? "#1E293B",
                stroke: action.stroke,
                strokeWidth: action.strokeWidth,
                cornerRadius: action.cornerRadius ?? 12,
                opacity: action.opacity ?? 1.0,
                fontSize: nil,
                shadow: action.shadow,
                blur: action.blur,
                backgroundBlur: action.backgroundBlur,
                overlayColor: action.overlayColor,
                overlayOpacity: action.overlayOpacity,
                gradient: action.gradient
            ),
            constraints: action.constraints,
            clipContent: action.clipContent ?? false,
            zIndex: action.zIndex ?? 0,
            textBehavior: action.textBehavior,
            children: []
        )
        applyScrollBehavior(from: action, to: &newNode)
        applyRepeatBinding(from: action, to: &newNode)
        applyTimePicker(from: action, to: &newNode)
        applyBoxSpacing(from: action, to: &newNode.style)
        
        insertNode(newNode, parentId: parentId)
        return newNode.id
    }
    
    // יוצר Icon node דרך פעולה של Agent
    private func applyCreateIcon(_ action: DesignAction, parentId: UUID?) -> UUID {
        var newNode = DesignNode(
            id: UUID(),
            type: .Icon,
            name: action.name ?? "Icon",

            x: action.x ?? 32,
            y: action.y ?? 120,
            width: max(1, action.width ?? 48),
            height: max(1, action.height ?? 48),
            text: nil,
            imageName: nil,
            iconName: action.iconName ?? "star",
            style: NodeStyle(
                fill: action.fill ?? "#00000000",
                stroke: action.stroke,
                strokeWidth: action.strokeWidth,
                cornerRadius: action.cornerRadius ?? 0,
                opacity: action.opacity ?? 1.0,
                fontSize: nil,
                textColor: action.textColor ?? action.fill ?? "#FFFFFF",
                gradient: action.gradient
            ),
            constraints: action.constraints,
            clipContent: action.clipContent ?? false,
            zIndex: action.zIndex ?? 0,
            textBehavior: action.textBehavior,
            children: []
        )
        applyBoxSpacing(from: action, to: &newNode.style)
        
        insertNode(newNode, parentId: parentId)
        return newNode.id
    }
    
    // יוצר Page חדש — Agent יכול להוסיף עמודים חדשים לפרויקט
    private func applyCreatePage(_ action: DesignAction) {
        let newPage = DesignPage(
            id: UUID(),
            name: action.pageName ?? action.name ?? "New Page",
            nodes: []
        )
        project.pages.append(newPage)
    }
    
    // ─── Page management (ממשק ציבורי) ───────────────────────────────
    
    func addPage(name: String = "New Page") {
        snapshot()
        let newPage = DesignPage(id: UUID(), name: name, nodes: [])
        project.pages.append(newPage)
    }
    
    func deletePage(at index: Int) {
        guard project.pages.count > 1, index < project.pages.count else { return }
        snapshot()
        project.pages.remove(at: index)
        if currentPageIndex >= project.pages.count {
            currentPageIndex = project.pages.count - 1
        }
    }
    
    func renamePage(at index: Int, name: String) {
        guard index < project.pages.count else { return }
        project.pages[index].name = name
    }
    
    // ─── Image & Icon (ממשק ציבורי לtoolbar) ─────────────────────────
    
    func addImageNode() {
        snapshot()
        let newNode = DesignNode(
            id: UUID(),
            type: .Image,
            name: "Image",

            x: 160, y: 160,
            width: 260, height: 180,
            text: nil, imageName: nil, iconName: nil,
            style: NodeStyle(
                fill: "#1E293B", stroke: nil,
                cornerRadius: 12, opacity: 1.0, fontSize: nil
            ),
            children: []
        )
        project.pages[currentPageIndex].nodes.append(newNode)
        selectedNodeId = newNode.id
    }

    func addImageNode(source: String?, name: String = "Photo") {
        snapshot()
        let newNode = DesignNode(
            id: UUID(),
            type: .Image,
            name: name,

            x: 180, y: 180,
            width: 360, height: 240,
            text: nil, imageName: source, imageSource: source, contentMode: .fill, iconName: nil,
            style: NodeStyle(
                fill: "#E5E7EB", stroke: nil,
                cornerRadius: 0, opacity: 1.0, fontSize: nil
            ),
            children: []
        )
        project.pages[currentPageIndex].nodes.append(newNode)
        selectedNodeId = newNode.id
    }
    
    func addIconNode() {
        snapshot()
        let newNode = DesignNode(
            id: UUID(),
            type: .Icon,
            name: "Icon",

            x: 160, y: 160,
            width: 48, height: 48,
            text: nil, imageName: nil, iconName: "star",
            style: NodeStyle(
                fill: "#00000000", stroke: nil,
                cornerRadius: 0, opacity: 1.0, fontSize: nil,
                textColor: "#FFFFFF"
            ),
            children: []
        )
        project.pages[currentPageIndex].nodes.append(newNode)
        selectedNodeId = newNode.id
    }

    func duplicateSelection() {
        let idsToDuplicate = selectedNodeIds.isEmpty
            ? [selectedNodeId].compactMap { $0 }
            : Array(selectedNodeIds)
        guard !idsToDuplicate.isEmpty else { return }

        snapshot()
        var newIds: [UUID] = []
        for id in idsToDuplicate {
            if let newId = duplicateNode(id: id, in: &project.pages[currentPageIndex].nodes) {
                newIds.append(newId)
            }
        }

        if let first = newIds.first {
            selectedNodeIds = Set(newIds)
            selectedNodeId = first
        }
    }

    func bringSelectionToFront() {
        layerSelection(toFront: true)
    }

    func sendSelectionToBack() {
        layerSelection(toFront: false)
    }

    /// Align every direct child inside a selected parent. This is the
    /// container-level counterpart to Studio's selection alignment controls.
    /// Shrinks a text node's box down to the glyphs it actually draws.
    /// Generated text frames are routinely far wider than their words, and a
    /// box that doesn't hug its content makes every alignment lie: centring the
    /// node centres the empty box while the visible text sits off to one side.
    /// The rendered text is kept where it already is — the box collapses toward
    /// the text according to the node's own textAlign, so nothing jumps.
    @discardableResult
    func fitTextNodeToContent(id: UUID) -> Bool {
        guard let node = node(id: id), let fit = fittedTextBox(for: node) else { return false }
        snapshot()
        _ = updateNode(id: id, in: &project.pages[currentPageIndex].nodes) { node in
            node.x += fit.dx
            node.width = fit.width
            node.height = fit.height
            node.manuallyPositioned = true
        }
        return true
    }

    /// Whether newly generated text boxes hug their content automatically.
    /// On by default; a box that doesn't hug makes every later alignment lie.
    static var autoHugTextBoxes: Bool {
        UserDefaults.standard.object(forKey: "autoHugTextBoxes") as? Bool ?? true
    }

    /// A rounded container whose child spills past its edge is broken by
    /// definition — that is what a card IS. Image sizing runs through several
    /// paths (aspect fitting, scaleNode, generated-asset patching) and any of
    /// them can leave a child wider than its parent, so rather than police
    /// every writer, the container clips. Aspect-fill cropping is also what a
    /// real product card does, so this is the correct rendering, not a patch.
    func clipRoundedContainers(in nodes: inout [DesignNode]) {
        for index in nodes.indices {
            let node = nodes[index]
            let radius = node.style.cornerRadius ?? 0

            // A child placed at a NEGATIVE offset is protruding on purpose —
            // the raised "+" in a tab bar, a badge on an avatar, a floating
            // action button. Clipping those deletes them from the design.
            // (This is exactly what an earlier, blunter version of this pass
            // did to a tab bar's add button.)
            let hasIntentionalProtrusion = node.children.contains { $0.x < -0.5 || $0.y < -0.5 }

            // Oversized MEDIA anchored inside the box is the real defect: an
            // image wider than its card, which a product card always crops.
            let hasOversizedMedia = node.children.contains { child in
                (child.type == .Image || child.type == .Icon)
                    && child.x >= -0.5 && child.y >= -0.5
                    && (child.x + child.width > node.width + 0.5
                        || child.y + child.height > node.height + 0.5)
            }

            if radius > 0, hasOversizedMedia, !hasIntentionalProtrusion, node.clipContent != true {
                nodes[index].clipContent = true
            }
            // Heal containers a previous run clipped into hiding their own
            // protruding children.
            if hasIntentionalProtrusion, node.clipContent == true {
                nodes[index].clipContent = false
            }
            clipRoundedContainers(in: &nodes[index].children)
        }
    }

    /// Re-hugs one node in place, no snapshot and no manual-position flag —
    /// used right after the words themselves change, where leaving the old
    /// frame behind is what makes a shortened label look off-centre.
    func hugTextBoxIfEnabled(id: UUID) {
        guard Self.autoHugTextBoxes,
              let node = node(id: id),
              let fit = fittedTextBox(for: node) else { return }
        _ = updateNode(id: id, in: &project.pages[currentPageIndex].nodes) { node in
            node.x += fit.dx
            node.width = fit.width
            node.height = fit.height
        }
    }

    /// Batch form used as a normalization pass. Deliberately does NOT mark the
    /// nodes manually positioned — the layout engine stays in charge of where
    /// they sit, this only stops the box from being wider than its words.
    private func hugTextBoxesToContent(in nodes: inout [DesignNode]) {
        for index in nodes.indices {
            if let fit = fittedTextBox(for: nodes[index]) {
                nodes[index].x += fit.dx
                nodes[index].width = fit.width
                nodes[index].height = fit.height
            }
            hugTextBoxesToContent(in: &nodes[index].children)
        }
    }

    /// Measures the box a text node actually needs, plus the x-shift that keeps
    /// the rendered glyphs exactly where they already are. Returns nil when the
    /// node isn't text or already fits.
    private func fittedTextBox(for node: DesignNode) -> (width: CGFloat, height: CGFloat, dx: CGFloat)? {
        guard node.type == .Text,
              let text = node.text,
              !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else { return nil }

        // Explicitly wrapping text owns a layout slot, not a one-line hug.
        // Collapsing that slot because the current macOS font happens to fit
        // on one line makes the exported iOS font wrap into a now-too-small
        // frame and truncate. Preserve both width and line capacity across
        // canvas, preview and SwiftUI export.
        if node.textBehavior?.wrap == true || (node.textBehavior?.maxLines ?? 1) > 1 {
            return nil
        }

        let paddingLeft = node.style.paddingLeft ?? 0
        let paddingRight = node.style.paddingRight ?? 0
        let paddingTop = node.style.paddingTop ?? 0
        let paddingBottom = node.style.paddingBottom ?? 0
        let availableWidth = max(1, node.width - paddingLeft - paddingRight)

        let paragraph = NSMutableParagraphStyle()
        paragraph.lineBreakMode = .byWordWrapping
        if let lineHeight = node.style.lineHeight, lineHeight > 0 {
            paragraph.minimumLineHeight = lineHeight
            paragraph.maximumLineHeight = lineHeight
        }
        var attributes: [NSAttributedString.Key: Any] = [
            .font: interactionFont(for: node),
            .paragraphStyle: paragraph
        ]
        if let letterSpacing = node.style.letterSpacing {
            attributes[.kern] = letterSpacing
        }

        let unbounded = (text as NSString).boundingRect(
            with: CGSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude),
            options: [.usesLineFragmentOrigin, .usesFontLeading],
            attributes: attributes
        )
        // Multi-line text keeps its current width (that width is what decides
        // the wrap); only a single line collapses horizontally.
        let wraps = unbounded.width > availableWidth
        let measured = wraps
            ? (text as NSString).boundingRect(
                with: CGSize(width: availableWidth, height: .greatestFiniteMagnitude),
                options: [.usesLineFragmentOrigin, .usesFontLeading],
                attributes: attributes
              )
            : unbounded

        let newWidth = max(1, ceil(measured.width) + paddingLeft + paddingRight)
        let newHeight = max(1, ceil(measured.height) + paddingTop + paddingBottom)
        // Only ever shrink: growing a box would re-introduce the overlap the
        // layout passes just resolved.
        guard newWidth <= node.width, newHeight <= node.height,
              (node.width - newWidth) > 0.5 || (node.height - newHeight) > 0.5
        else { return nil }

        // Collapse toward wherever the glyphs already sit.
        let widthDelta = node.width - newWidth
        let dx: CGFloat
        switch node.style.textAlign?.lowercased() {
        case "center": dx = widthDelta / 2
        case "right":  dx = widthDelta
        default:       dx = 0
        }
        return (newWidth, newHeight, dx)
    }

    /// Bulk version for a container: every text node beneath it hugs its
    /// content. This is the practical one — generated screens arrive with
    /// dozens of oversized labels at once.
    @discardableResult
    func fitTextNodesToContent(under parentId: UUID?) -> Int {
        let roots: [DesignNode]
        if let parentId, let parent = node(id: parentId) {
            roots = parent.children
        } else {
            roots = currentPage.nodes
        }
        var textIds: [UUID] = []
        func collect(_ nodes: [DesignNode]) {
            for node in nodes {
                if node.type == .Text { textIds.append(node.id) }
                collect(node.children)
            }
        }
        collect(roots)

        var changed = 0
        for id in textIds where fitTextNodeToContent(id: id) {
            changed += 1
        }
        return changed
    }

    /// Saves the selected node as a reusable component in the user's library.
    @discardableResult
    func saveSelectionAsComponent(name: String, category: String = "General") -> SavedComponent? {
        guard let id = selectedNodeId, let node = node(id: id) else { return nil }
        return try? ComponentLibrary.save(node: node, name: name, category: category)
    }

    /// Drops a library component into the current screen (or the page root when
    /// nothing is selected), with fresh ids so instances stay independent.
    @discardableResult
    func insertComponent(_ component: SavedComponent, at point: CGPoint? = nil) -> UUID {
        snapshot()
        // Prefer the selected screen frame; otherwise the first screen.
        let targetScreen = selectedNodeId
            .flatMap { node(id: $0) }
            .flatMap { $0.type == .Frame ? $0 : nil }
            ?? currentPage.nodes.first { $0.type == .Frame }

        let instance = ComponentLibrary.instantiate(
            component,
            at: point ?? CGPoint(x: 24, y: 24)
        )
        insertNode(instance, parentId: targetScreen?.id)
        return instance.id
    }

    func alignChildren(of parentId: UUID, to alignment: CanvasStudioAlignment) {
        guard let parent = node(id: parentId), !parent.children.isEmpty else { return }
        snapshot()
        _ = updateNode(id: parentId, in: &project.pages[currentPageIndex].nodes) { node in
            alignChildren(in: &node, alignment: alignment.rawValue)
        }
    }

    func distributeChildren(of parentId: UUID, axis: CanvasStudioDistributionAxis) {
        guard let parent = node(id: parentId), parent.children.count >= 2 else { return }
        snapshot()
        _ = updateNode(id: parentId, in: &project.pages[currentPageIndex].nodes) { node in
            distributeChildren(
                in: &node,
                axis: axis.rawValue,
                padding: axis == .horizontal
                    ? (node.style.paddingLeft ?? 0)
                    : (node.style.paddingTop ?? 0),
                spacing: nil
            )
        }
    }

    func alignSelection(_ alignment: CanvasStudioAlignment) {
        let ids = !selectedNodeIds.isEmpty ? Array(selectedNodeIds) : (selectedNodeId.map { [$0] } ?? [])
        // One element selected → align it INSIDE its parent (center/edge in the
        // frame it lives on). Only multi-selection aligns nodes to each other,
        // which is why a single frame/element used to do nothing.
        if ids.count == 1 {
            alignWithinParent(ids[0], alignment)
            return
        }
        guard ids.count >= 2 else { return }
        let rects = ids.compactMap { id -> (UUID, CGRect)? in
            guard let rect = globalRect(for: id) else { return nil }
            return (id, rect)
        }
        guard rects.count >= 2 else { return }

        snapshot()
        let bounds = rects.map(\.1).reduce(rects[0].1) { $0.union($1) }
        for (id, rect) in rects {
            guard let node = node(id: id) else { continue }
            var x = node.x
            var y = node.y
            let parentOrigin = parentNode(of: id).flatMap { globalRect(for: $0.id)?.origin } ?? .zero

            switch alignment {
            case .left:
                x = bounds.minX - parentOrigin.x
            case .center:
                x = bounds.midX - rect.width / 2 - parentOrigin.x
            case .right:
                x = bounds.maxX - rect.width - parentOrigin.x
            case .top:
                y = bounds.minY - parentOrigin.y
            case .middle:
                y = bounds.midY - rect.height / 2 - parentOrigin.y
            case .bottom:
                y = bounds.maxY - rect.height - parentOrigin.y
            }

            moveNode(id: id, toX: x, y: y)
        }
    }

    /// Aligns a single node within its parent's inner box (padding-aware). A
    /// top-level screen has no parent, so it is left as-is.
    private func alignWithinParent(_ id: UUID, _ alignment: CanvasStudioAlignment) {
        guard let parent = parentNode(of: id), let node = node(id: id) else { return }
        let padL = parent.style.paddingLeft ?? 0
        let padR = parent.style.paddingRight ?? 0
        let padT = parent.style.paddingTop ?? 0
        let padB = parent.style.paddingBottom ?? 0
        let innerW = parent.width - padL - padR
        let innerH = parent.height - padT - padB
        var x = node.x
        var y = node.y
        switch alignment {
        case .left:   x = padL
        case .center: x = padL + (innerW - node.width) / 2
        case .right:  x = padL + innerW - node.width
        case .top:    y = padT
        case .middle: y = padT + (innerH - node.height) / 2
        case .bottom: y = padT + innerH - node.height
        }
        snapshot()
        moveNode(id: id, toX: x, y: y)
    }

    func distributeSelection(axis: CanvasStudioDistributionAxis) {
        let ids = Array(selectedNodeIds)
        guard ids.count >= 3 else { return }
        let rects = ids.compactMap { id -> (UUID, CGRect)? in
            guard let rect = globalRect(for: id) else { return nil }
            return (id, rect)
        }
        guard rects.count >= 3 else { return }

        snapshot()
        switch axis {
        case .horizontal:
            let sorted = rects.sorted { $0.1.minX < $1.1.minX }
            let minX = sorted.first?.1.minX ?? 0
            let maxX = sorted.last?.1.maxX ?? 0
            let totalWidth = sorted.reduce(CGFloat(0)) { $0 + $1.1.width }
            let gap = max(0, (maxX - minX - totalWidth) / CGFloat(sorted.count - 1))
            var cursor = minX
            for (id, rect) in sorted {
                let parentOrigin = parentNode(of: id).flatMap { globalRect(for: $0.id)?.origin } ?? .zero
                if let node = node(id: id) {
                    moveNode(id: id, toX: cursor - parentOrigin.x, y: node.y)
                }
                cursor += rect.width + gap
            }
        case .vertical:
            let sorted = rects.sorted { $0.1.minY < $1.1.minY }
            let minY = sorted.first?.1.minY ?? 0
            let maxY = sorted.last?.1.maxY ?? 0
            let totalHeight = sorted.reduce(CGFloat(0)) { $0 + $1.1.height }
            let gap = max(0, (maxY - minY - totalHeight) / CGFloat(sorted.count - 1))
            var cursor = minY
            for (id, rect) in sorted {
                let parentOrigin = parentNode(of: id).flatMap { globalRect(for: $0.id)?.origin } ?? .zero
                if let node = node(id: id) {
                    moveNode(id: id, toX: node.x, y: cursor - parentOrigin.y)
                }
                cursor += rect.height + gap
            }
        }
    }

    func setSelectedImageSource(_ source: String) {
        updateSelectedNodeAndRelayout { node in
            node.imageName = source
            node.imageSource = source
        }
    }

    private func duplicateNode(id: UUID, in nodes: inout [DesignNode]) -> UUID? {
        if let index = nodes.firstIndex(where: { $0.id == id }) {
            var duplicate = nodes[index]
            assignFreshIds(to: &duplicate)
            duplicate.name += " Copy"
            duplicate.x += 24
            duplicate.y += 24
            duplicate.manuallyPositioned = true
            nodes.insert(duplicate, at: index + 1)
            return duplicate.id
        }

        for index in nodes.indices {
            if let newId = duplicateNode(id: id, in: &nodes[index].children) {
                return newId
            }
        }

        return nil
    }

    private func assignFreshIds(to node: inout DesignNode) {
        node.id = UUID()
        for index in node.children.indices {
            assignFreshIds(to: &node.children[index])
        }
    }

    private func layerSelection(toFront: Bool) {
        let ids = selectedNodeIds.isEmpty ? [selectedNodeId].compactMap { $0 } : Array(selectedNodeIds)
        guard !ids.isEmpty else { return }

        snapshot()
        let allZ = allZIndexes(in: project.pages[currentPageIndex].nodes)
        var nextZ = toFront ? (allZ.max() ?? 0) + 1 : (allZ.min() ?? 0) - 1
        for id in ids {
            _ = updateNode(id: id, in: &project.pages[currentPageIndex].nodes) { node in
                node.zIndex = nextZ
            }
            nextZ += toFront ? 1 : -1
        }
    }
}

enum CanvasStudioAlignment: String, CaseIterable, Identifiable {
    case left, center, right, top, middle, bottom

    var id: String { rawValue }
}

enum CanvasStudioDistributionAxis: String, CaseIterable, Identifiable {
    case horizontal, vertical

    var id: String { rawValue }
}

// MARK: - Macro Component Factories
extension ProjectViewModel {
    
    private func applyCreatePresentationShot(_ action: DesignAction, parentId: UUID?) -> UUID {
        let frameId = UUID()
        let width = action.width ?? 1200
        let height = action.height ?? 700
        let screenCount = Int(action.props?["screenCount"] ?? "3") ?? 3
        let clampedScreenCount = min(max(screenCount, 2), 3)
        let background = action.props?["background"] ?? action.fill ?? "#294D2A"
        let phoneWidth: CGFloat = clampedScreenCount == 3 ? 260 : 300
        let phoneHeight: CGFloat = clampedScreenCount == 3 ? 560 : 620
        let gap = (width - CGFloat(clampedScreenCount) * phoneWidth) / CGFloat(clampedScreenCount + 1)
        
        let phones: [DesignNode] = (0..<clampedScreenCount).map { index in
            let yOffset: CGFloat = index == 1 && clampedScreenCount == 3 ? 40 : 80
            
            return DesignNode(
                id: UUID(),
                type: .Frame,
                name: "Phone Screen \(index + 1)",

                x: gap + CGFloat(index) * (phoneWidth + gap),
                y: yOffset,
                width: phoneWidth,
                height: phoneHeight,
                text: nil,
                imageName: nil,
                imageSource: nil,
                contentMode: nil,
                iconName: nil,
                style: NodeStyle(
                    fill: "#F9FAF6",
                    stroke: "#FFFFFF",
                    cornerRadius: 36,
                    opacity: 1.0,
                    fontSize: nil,
                    shadow: ShadowStyle(
                        color: "#000000",
                        opacity: 0.24,
                        radius: 34,
                        x: 0,
                        y: 24
                    )
                ),
                children: []
            )
        }
        
        let frame = DesignNode(
            id: frameId,
            type: .Frame,
            name: action.name ?? "Presentation Shot",

            x: action.x ?? 80,
            y: action.y ?? 80,
            width: width,
            height: height,
            text: nil,
            imageName: nil,
            imageSource: nil,
            contentMode: nil,
            iconName: nil,
            style: NodeStyle(
                fill: background,
                stroke: nil,
                cornerRadius: action.cornerRadius ?? 40,
                opacity: action.opacity ?? 1.0,
                fontSize: nil,
                shadow: action.shadow ?? ShadowStyle(
                    color: "#000000",
                    opacity: 0.16,
                    radius: 28,
                    x: 0,
                    y: 16
                ),
                overlayColor: action.overlayColor,
                overlayOpacity: action.overlayOpacity
            ),
            children: phones
        )
        
        insertNode(frame, parentId: parentId)
        return frameId
    }
    
    private func applyCreateComponent(_ action: DesignAction, parentId: UUID?) -> UUID {
        guard let compType = action.component else { return UUID() }
        
        let tokens = tokens(for: action, component: compType)
        
        let newNode = ComponentFactory.createComponent(
            compType,
            props: action.props,
            action: action,
            tokens: tokens
        )
        
        insertNode(newNode, parentId: parentId)
        return newNode.id
    }
    
    private func tokens(for action: DesignAction, component: ComponentType) -> DesignTokens {
        if let rawPreset = action.stylePreset,
           let preset = VisualStylePreset(rawValue: rawPreset) {
            return DesignTokenLibrary.tokens(for: preset)
        }
        
        switch component {
        case .avatarGreetingHeader,
             .balanceHeroCard,
             .quickActionRow,
             .transactionRow,
             .transactionList,
             .currencyCard,
             .currencyCardGrid,
             .bottomNavBar,
             .chartCard,
             .metricCard,
             .searchBar,
             .categoryChips:
            return .softFintech
        default:
            return DesignTokenLibrary.tokens(for: currentAgentStylePreset)
        }
    }
    
    private enum AgentSemanticDomain: Equatable {
        case runningFitness
        case finance
        case ecommerce
        case music
        case chat
        case books
        case travel
        case wellness
        case generic
        
        var primaryTitle: String {
            switch self {
            case .runningFitness:
                return "Run Dashboard"
            case .finance:
                return "Your Portfolio"
            case .ecommerce:
                return "New Arrivals"
            case .music:
                return "Your Library"
            case .chat:
                return "Messages"
            case .books:
                return "Reading Now"
            case .travel:
                return "Explore"
            case .wellness:
                return "Today Check-In"
            case .generic:
                return "Today's Focus"
            }
        }
        
        var primaryCTA: String {
            switch self {
            case .runningFitness:
                return "Start Run"
            case .finance:
                return "View Portfolio"
            case .ecommerce:
                return "Shop Now"
            case .music:
                return "Play Now"
            case .chat:
                return "New Chat"
            case .books:
                return "Continue Reading"
            case .travel:
                return "Explore Trips"
            case .wellness:
                return "Begin Session"
            case .generic:
                return "Get Started"
            }
        }
        
        var fallbackBody: String {
            switch self {
            case .runningFitness:
                return "Track pace, distance, routes and progress in one clean view."
            case .finance:
                return "Track performance, activity and insights at a glance."
            case .ecommerce:
                return "Discover curated picks and product highlights."
            case .music:
                return "Queue up fresh tracks and keep listening."
            case .chat:
                return "Keep conversations organized and easy to continue."
            case .books:
                return "Continue reading and discover your next book."
            case .travel:
                return "Explore curated places and plan your next trip."
            case .wellness:
                return "Slow down, check in and continue your session."
            case .generic:
                return "Key details for this experience."
            }
        }
        
        var exactTextReplacements: [String: String] {
            switch self {
            case .runningFitness:
                return [
                    "your portfolio": "Run Dashboard",
                    "portfolio": "Run Dashboard",
                    "shop now": "Start Run",
                    "add to cart": "Start Run",
                    "buy": "Run",
                    "sell": "Plan",
                    "deposit": "Log",
                    "transfer": "Routes",
                    "markets": "Activity",
                    "market": "Activity",
                    "trade": "Routes",
                    "wallet": "Progress",
                    "market pulse": "Morning Run",
                    "product detail": "Run Details"
                ]
            case .finance:
                return [
                    "shop now": "View Portfolio",
                    "add to cart": "Transfer",
                    "product detail": "Account Details",
                    "playlist": "Watchlist"
                ]
            case .ecommerce:
                return [
                    "your portfolio": "New Arrivals",
                    "portfolio": "New Arrivals",
                    "market pulse": "Trending Now",
                    "buy": "Shop",
                    "sell": "Deals",
                    "deposit": "Saved",
                    "transfer": "Orders"
                ]
            case .music:
                return [
                    "your portfolio": "Your Library",
                    "portfolio": "Your Library",
                    "shop now": "Play Now",
                    "add to cart": "Save Track",
                    "market pulse": "Daily Mix",
                    "product detail": "Track Details",
                    "buy": "Play",
                    "sell": "Browse",
                    "deposit": "Save",
                    "transfer": "Share"
                ]
            case .chat:
                return [
                    "your portfolio": "Messages",
                    "portfolio": "Messages",
                    "shop now": "New Chat",
                    "add to cart": "Send",
                    "market pulse": "Recent Chats",
                    "user message": "You",
                    "ai response": "Assistant",
                    "product detail": "Conversation"
                ]
            case .books:
                return [
                    "your portfolio": "Reading Now",
                    "portfolio": "Reading Now",
                    "shop now": "Continue Reading",
                    "add to cart": "Save Book",
                    "market pulse": "Recommended Reads",
                    "product detail": "Book Details",
                    "buy": "Read",
                    "sell": "Browse",
                    "deposit": "Save",
                    "transfer": "Share"
                ]
            case .travel:
                return [
                    "your portfolio": "Explore",
                    "portfolio": "Explore",
                    "shop now": "Explore Trips",
                    "add to cart": "Book Trip",
                    "market pulse": "Top Destinations",
                    "product detail": "Trip Details",
                    "buy": "Book",
                    "sell": "Discover",
                    "deposit": "Saved",
                    "transfer": "Route"
                ]
            case .wellness:
                return [
                    "your portfolio": "Today Check-In",
                    "portfolio": "Today Check-In",
                    "shop now": "Begin Session",
                    "add to cart": "Save Session",
                    "market pulse": "Daily Calm",
                    "product detail": "Session Details",
                    "buy": "Start",
                    "sell": "Reflect",
                    "deposit": "Log",
                    "transfer": "Share"
                ]
            case .generic:
                return [:]
            }
        }
        
        var forbiddenTerms: [String] {
            let financeTerms = ["portfolio", "stock", "broker", "market", "buy", "sell", "deposit", "transfer", "crypto", "wallet", "trade"]
            let ecommerceTerms = ["shop", "cart", "checkout", "product", "price", "new arrivals"]
            let musicTerms = ["playlist", "album", "song", "artist"]
            let chatTerms = ["user message", "ai response", "chat input"]
            
            switch self {
            case .runningFitness:
                return financeTerms + ecommerceTerms + musicTerms + chatTerms
            case .finance:
                return ecommerceTerms + musicTerms + chatTerms
            case .ecommerce:
                return financeTerms + musicTerms + chatTerms
            case .music:
                return financeTerms + ecommerceTerms + chatTerms
            case .chat:
                return financeTerms + ecommerceTerms + musicTerms
            case .books:
                return financeTerms + ecommerceTerms + musicTerms + chatTerms
            case .travel:
                return financeTerms + ecommerceTerms + musicTerms + chatTerms
            case .wellness:
                return financeTerms + ecommerceTerms + musicTerms + chatTerms
            case .generic:
                return []
            }
        }
    }
    
    private func repairGeneratedDesignSemantics(in nodes: inout [DesignNode]) {
        guard currentAgentRequestIntent == .createNewDesign else { return }
        
        let domain = semanticDomain(for: currentAgentUserPrompt)
        for index in nodes.indices {
            repairSemanticCopy(in: &nodes[index], domain: domain)
        }
    }
    
    private func repairSemanticCopy(in node: inout DesignNode, domain: AgentSemanticDomain) {
        if let replacement = semanticReplacement(for: node, domain: domain) {
            node.text = replacement
        }
        
        for index in node.children.indices {
            repairSemanticCopy(in: &node.children[index], domain: domain)
        }
    }
    
    private func semanticReplacement(for node: DesignNode, domain: AgentSemanticDomain) -> String? {
        guard node.type == .Text || node.type == .Button || node.type == .Input,
              let originalText = node.text?.trimmingCharacters(in: .whitespacesAndNewlines),
              !originalText.isEmpty
        else {
            return nil
        }
        
        let lower = originalText.lowercased()
        
        if looksLikePromptArtifact(originalText) {
            return styledReplacement(domain.fallbackBody, like: originalText)
        }
        
        if isPlaceholderCopy(lower) {
            return styledReplacement(placeholderReplacement(for: node, domain: domain), like: originalText)
        }
        
        if let exact = domain.exactTextReplacements[lower] {
            return styledReplacement(exact, like: originalText)
        }
        
        guard domain != .generic,
              containsAny(lower, domain.forbiddenTerms)
        else {
            return nil
        }
        
        if node.type == .Button || likelyCTA(originalText) {
            return styledReplacement(domain.primaryCTA, like: originalText)
        }
        
        if likelyHeadline(node) {
            return styledReplacement(domain.primaryTitle, like: originalText)
        }
        
        return styledReplacement(domain.fallbackBody, like: originalText)
    }
    
    private func semanticDomain(for prompt: String) -> AgentSemanticDomain {
        let text = prompt.lowercased()
        
        if containsAny(text, ["run", "running", "runner", "jog", "fitness", "workout", "gym", "pace", "marathon", "כושר", "אימון", "ריצה", "ריצות", "ספורט", "קצב"]) {
            return .runningFitness
        }
        
        if containsAny(text, ["stock", "broker", "trading", "finance", "bank", "wallet", "portfolio", "crypto", "invest", "מניות", "מסחר", "השקעות", "בנק", "ארנק", "פורטפוליו", "קריפטו"]) {
            return .finance
        }
        
        if containsAny(text, ["shop", "store", "ecommerce", "commerce", "product", "cart", "retail", "חנות", "קניות", "מוצר", "מוצרים"]) {
            return .ecommerce
        }
        
        if containsAny(text, ["spotify", "music", "audio", "playlist", "song", "album", "podcast", "מוזיקה", "שירים", "פלייליסט", "ספוטיפיי"]) {
            return .music
        }
        
        if containsAny(text, ["chat", "message", "messenger", "assistant", "ai", "צאט", "צ'אט", "שיחה", "הודעות", "עוזר"]) {
            return .chat
        }
        
        if containsAny(text, ["book", "reading", "library", "ebook", "novel", "ספר", "ספרים", "קריאה", "ספריה"]) {
            return .books
        }
        
        if containsAny(text, ["travel", "trip", "hotel", "flight", "destination", "journey", "טיול", "נסיעה", "מלון", "טיסה", "חופשה"]) {
            return .travel
        }
        
        if containsAny(text, ["meditation", "wellness", "mental", "therapy", "mindful", "calm", "מדיטציה", "רוגע", "נפש", "מיינדפולנס"]) {
            return .wellness
        }
        
        return .generic
    }
    
    private func isPlaceholderCopy(_ lower: String) -> Bool {
        lower == "flexible section" ||
            lower == "product detail" ||
            lower == "key details" ||
            lower.hasPrefix("[") ||
            lower.hasSuffix("]") ||
            lower.contains("placeholder") ||
            lower.contains("lorem ipsum")
    }
    
    private func looksLikePromptArtifact(_ text: String) -> Bool {
        let lower = text.lowercased()
        let fragments = [
            "negativeprompt",
            "negative prompt",
            "imageprompt",
            "ui usage",
            "no readable text",
            "app screenshot",
            "phone mockup",
            "watermark",
            "low quality",
            "lighting",
            "palette",
            "composition",
            "constraints",
            "modern professional",
            "quality full",
            "ipatrong",
            "profesm",
            "hiscvvice",
            "strorp",
            "caleative",
            "mdoern",
            "lusisable",
            "prodecasions",
            "artictor"
        ]
        
        if containsAny(lower, fragments) {
            return true
        }
        
        let words = lower
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { $0.count >= 7 }
        let suspiciousLongWords = words.filter { word in
            containsAny(word, ["prompt", "artifact", "unstyled", "render", "negative"])
        }
        
        return suspiciousLongWords.count >= 2
    }
    
    private func placeholderReplacement(for node: DesignNode, domain: AgentSemanticDomain) -> String {
        if likelyHeadline(node) {
            return domain.primaryTitle
        }
        
        if node.type == .Button || likelyCTA(node.text ?? "") {
            return domain.primaryCTA
        }
        
        return domain.fallbackBody
    }
    
    private func likelyHeadline(_ node: DesignNode) -> Bool {
        let name = node.name.lowercased()
        let fontSize = node.style.fontSize ?? 0
        return fontSize >= 22 ||
            name.contains("title") ||
            name.contains("headline") ||
            name.contains("hero")
    }
    
    private func likelyCTA(_ text: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= 24 else { return false }
        return trimmed == trimmed.uppercased() ||
            containsAny(trimmed.lowercased(), ["shop", "cart", "start", "begin", "continue", "book", "play", "send"])
    }
    
    private func styledReplacement(_ replacement: String, like original: String) -> String {
        let trimmed = original.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed == trimmed.uppercased(), trimmed.count <= 24 {
            return replacement.uppercased()
        }
        
        return replacement
    }
    
    private func containsAny(_ text: String, _ fragments: [String]) -> Bool {
        fragments.contains { text.contains($0) }
    }
    
    private func repairTextContrast(in nodes: inout [DesignNode], inheritedFill: String) {
        for index in nodes.indices {
            let node = nodes[index]

            // The surface visually behind this node's children: its own fill
            // composited over whatever is behind it. Glass fills like
            // "#FFFFFF14" resolve to nearly the backdrop color instead of
            // being scored as solid white.
            let surfaceForChildren: String = {
                // Children of a real photo sit on unknowable pixels — assume a
                // mid-dark surface (photos overwhelmingly read dark under UI
                // text) instead of the light placeholder fill, and account
                // for any overlay tint.
                if node.type == .Image, (node.imageSource ?? node.imageName) != nil {
                    let photoProxy = "#6B7280"
                    if let overlay = node.style.overlayColor,
                       let opacity = node.style.overlayOpacity, opacity > 0 {
                        let alphaByte = String(format: "%02X", Int(min(1, max(0, opacity)) * 255))
                        let overlayHex = overlay.hasPrefix("#") && overlay.count == 7
                            ? overlay + alphaByte
                            : overlay
                        return compositedFill(overlayHex, over: photoProxy)
                    }
                    return photoProxy
                }
                if let gradient = node.style.gradient, let firstColor = gradient.colors.first {
                    return compositedFill(firstColor, over: inheritedFill)
                }
                return compositedFill(node.style.fill, over: inheritedFill)
            }()

            switch node.type {
            case .Text:
                // A text node's own fill is its color fallback, not a surface —
                // its background is whatever the parent painted behind it.
                let renderedColor = node.style.textColor ?? node.style.fill
                let visibleColor = compositedFill(renderedColor, over: inheritedFill)
                if contrastRatio(visibleColor, inheritedFill) < 4.5 {
                    nodes[index].style.textColor = luminance(of: inheritedFill) > 0.55 ? "#0F172A" : "#FFFFFF"
                }

            case .Button:
                let renderedColor = node.style.textColor ?? "#FFFFFF"
                let visibleColor = compositedFill(renderedColor, over: surfaceForChildren)
                if contrastRatio(visibleColor, surfaceForChildren) < 4.5 {
                    nodes[index].style.textColor = luminance(of: surfaceForChildren) > 0.55 ? "#0F172A" : "#FFFFFF"
                }

            case .Input, .Icon:
                let renderedColor = node.style.textColor ?? node.style.fill
                let visibleColor = compositedFill(renderedColor, over: surfaceForChildren)
                if contrastRatio(visibleColor, surfaceForChildren) < 4.5 {
                    nodes[index].style.textColor = luminance(of: surfaceForChildren) > 0.55 ? "#0F172A" : "#FFFFFF"
                }

            default:
                break
            }

            if !nodes[index].children.isEmpty {
                repairTextContrast(in: &nodes[index].children, inheritedFill: surfaceForChildren)
            }
        }
    }

    // Parses hex (#RGB, #RRGGBB, #RRGGBBAA) and rgb()/rgba() color strings.
    private func parseColorComponents(_ value: String) -> (r: Double, g: Double, b: Double, a: Double)? {
        let source = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()

        if source == "white" { return (1, 1, 1, 1) }
        if source == "black" { return (0, 0, 0, 1) }
        if source == "transparent" || source == "clear" { return (0, 0, 0, 0) }

        if source.hasPrefix("rgb"),
           let open = source.firstIndex(of: "("),
           let close = source.lastIndex(of: ")"),
           open < close {
            let parts = source[source.index(after: open)..<close]
                .split(separator: ",")
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }

            func channel(_ part: String) -> Double? {
                if part.hasSuffix("%"), let number = Double(part.dropLast()) { return number / 100 }
                guard let number = Double(part) else { return nil }
                return number > 1 ? number / 255 : number
            }

            guard parts.count >= 3,
                  let r = channel(parts[0]),
                  let g = channel(parts[1]),
                  let b = channel(parts[2])
            else { return nil }

            let a = parts.count >= 4 ? (Double(parts[3]) ?? 1) : 1
            return (min(max(r, 0), 1), min(max(g, 0), 1), min(max(b, 0), 1), min(max(a, 0), 1))
        }

        let cleaned = source.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        guard Scanner(string: cleaned).scanHexInt64(&int) else { return nil }

        switch cleaned.count {
        case 8:
            return (
                Double((int >> 24) & 0xFF) / 255,
                Double((int >> 16) & 0xFF) / 255,
                Double((int >> 8) & 0xFF) / 255,
                Double(int & 0xFF) / 255
            )
        case 6:
            return (
                Double((int >> 16) & 0xFF) / 255,
                Double((int >> 8) & 0xFF) / 255,
                Double(int & 0xFF) / 255,
                1
            )
        case 3:
            let r = Double((int >> 8) & 0xF) / 15
            let g = Double((int >> 4) & 0xF) / 15
            let b = Double(int & 0xF) / 15
            return (r, g, b, 1)
        default:
            return nil
        }
    }

    // Composites a possibly-translucent color over the opaque background
    // behind it and returns the resulting opaque hex.
    private func compositedFill(_ fill: String, over background: String) -> String {
        guard let top = parseColorComponents(fill) else { return background }

        if top.a >= 0.999 {
            return hexString(r: top.r, g: top.g, b: top.b)
        }

        let bottom = parseColorComponents(background) ?? (r: 1, g: 1, b: 1, a: 1)
        let r = top.r * top.a + bottom.r * (1 - top.a)
        let g = top.g * top.a + bottom.g * (1 - top.a)
        let b = top.b * top.a + bottom.b * (1 - top.a)
        return hexString(r: r, g: g, b: b)
    }

    private func hexString(r: Double, g: Double, b: Double) -> String {
        String(
            format: "#%02X%02X%02X",
            Int((r * 255).rounded()),
            Int((g * 255).rounded()),
            Int((b * 255).rounded())
        )
    }
    
    private func isTransparentHex(_ hex: String) -> Bool {
        let cleaned = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        guard cleaned.count == 8 else { return false }
        return cleaned.suffix(2).lowercased() == "00"
    }
    
    private func contrastRatio(_ firstHex: String, _ secondHex: String) -> Double {
        let first = luminance(of: firstHex)
        let second = luminance(of: secondHex)
        let lighter = max(first, second)
        let darker = min(first, second)
        return (lighter + 0.05) / (darker + 0.05)
    }
    
    private func luminance(of hex: String) -> Double {
        let cleaned = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        let rgbHex: String
        
        switch cleaned.count {
        case 8:
            rgbHex = String(cleaned.prefix(6))
        case 6:
            rgbHex = cleaned
        default:
            return 1
        }
        
        var int: UInt64 = 0
        Scanner(string: rgbHex).scanHexInt64(&int)
        
        func channel(_ value: UInt64) -> Double {
            let normalized = Double(value) / 255
            return normalized <= 0.03928
                ? normalized / 12.92
                : pow((normalized + 0.055) / 1.055, 2.4)
        }
        
        let r = channel((int >> 16) & 0xFF)
        let g = channel((int >> 8) & 0xFF)
        let b = channel(int & 0xFF)
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    
    private func applyCreateOnboardingScreen(_ action: DesignAction, parentId: UUID?) -> UUID {
        let frameId = UUID()
        
        let frame = DesignNode(
            id: frameId,
            type: .Frame,
            name: action.title ?? "Onboarding Screen",

            x: action.x ?? 120,
            y: action.y ?? 120,
            width: 390,
            height: 844,
            text: nil,
            style: NodeStyle(
                fill: "#FFFFFF",
                stroke: nil,
                cornerRadius: 36,
                opacity: 1.0,
                fontSize: nil
            ),
            children: [
                makeSkipText(),
                makeDecorativeCurve(name: "Curve 1", x: 0, y: 60, width: 390, height: 180),
                makeOnboardingTitle(action.title ?? "Risk Ready"),
                makeIllustrationPlaceholder(action.imageName ?? "Line Art"),
                makeDescriptionText(action.descriptionText ?? "Describe the value clearly and simply."),
                makePrimaryCTA(action.primaryCTA ?? "Log In"),
                makeSecondaryCTA(action.secondaryCTA ?? "Sign Up")
            ]
        )
        
        insertNode(frame, parentId: parentId)
        return frameId
    }
    
    private func makeSkipText() -> DesignNode {
        DesignNode(
            id: UUID(),
            type: .Text,
            name: "Skip",

            x: 320,
            y: 36,
            width: 48,
            height: 24,
            text: "Skip",
            style: NodeStyle(
                fill: "#8A8A8A",
                stroke: nil,
                cornerRadius: 0,
                opacity: 1.0,
                fontSize: 14,
                fontWeight: "regular",
                textColor: "#8A8A8A"
            ),
            children: []
        )
    }

    private func makeOnboardingTitle(_ title: String) -> DesignNode {
        DesignNode(
            id: UUID(),
            type: .Text,
            name: "Title",

            x: 48,
            y: 120,
            width: 300,
            height: 60,
            text: title,
            style: NodeStyle(
                fill: "#111111",
                stroke: nil,
                cornerRadius: 0,
                opacity: 1.0,
                fontSize: 42,
                fontWeight: "bold",
                textColor: "#111111"
            ),
            children: []
        )
    }

    private func makeIllustrationPlaceholder(_ name: String) -> DesignNode {
        DesignNode(
            id: UUID(),
            type: .Rectangle,
            name: "Illustration - \(name)",

            x: 95,
            y: 270,
            width: 200,
            height: 200,
            text: nil,
            style: NodeStyle(
                fill: "#FFF3E8",
                stroke: "#111111",
                cornerRadius: 100,
                opacity: 1.0,
                fontSize: nil
            ),
            children: []
        )
    }

    private func makeDescriptionText(_ description: String) -> DesignNode {
        DesignNode(
            id: UUID(),
            type: .Text,
            name: "Description",

            x: 56,
            y: 540,
            width: 278,
            height: 72,
            text: description,
            style: NodeStyle(
                fill: "#222222",
                stroke: nil,
                cornerRadius: 0,
                opacity: 1.0,
                fontSize: 16,
                fontWeight: "regular",
                textColor: "#222222"
            ),
            children: []
        )
    }

    private func makePrimaryCTA(_ text: String) -> DesignNode {
        DesignNode(
            id: UUID(),
            type: .Button,
            name: "Primary CTA",

            x: 48,
            y: 660,
            width: 294,
            height: 52,
            text: text,
            style: NodeStyle(
                fill: "#111111",
                stroke: nil,
                cornerRadius: 26,
                opacity: 1.0,
                fontSize: 16,
                fontWeight: "semibold",
                textColor: "#FFFFFF"
            ),
            children: []
        )
    }

    private func makeSecondaryCTA(_ text: String) -> DesignNode {
        DesignNode(
            id: UUID(),
            type: .Button,
            name: "Secondary CTA",

            x: 48,
            y: 724,
            width: 294,
            height: 52,
            text: text,
            style: NodeStyle(
                fill: "#FFFFFF",
                stroke: "#E5E0DA",
                cornerRadius: 26,
                opacity: 1.0,
                fontSize: 16,
                fontWeight: "semibold",
                textColor: "#111111"
            ),
            children: []
        )
    }

    private func makeDecorativeCurve(
        name: String,
        x: CGFloat,
        y: CGFloat,
        width: CGFloat,
        height: CGFloat
    ) -> DesignNode {
        DesignNode(
            id: UUID(),
            type: .Rectangle,
            name: name,

            x: x,
            y: y,
            width: width,
            height: 1,
            text: nil,
            style: NodeStyle(
                fill: "#E8E3DD",
                stroke: nil,
                cornerRadius: 0,
                opacity: 0.6,
                fontSize: nil
            ),
            children: []
        )
    }
}
