//
//  AgentPromptBuilder.swift
//  AgenticDesigner
//
//  Created by ariel sofer on 03/07/2026.
//

import Foundation

// בונה את ההוראות שנשלחות ל-AI.
// The system prompt is assembled dynamically per request: every rule is stated
// exactly once, and intent/device/component sections are only included when
// they apply. Fewer, sharper instructions beat a wall of repeated rules.
enum AgentPromptBuilder {

    // MARK: - Shared sections

    private static func designPrinciplesSection() -> String {
        """
        ═══════════ DESIGN PRINCIPLES ═══════════
        You are not a template generator. Think like a senior product designer:

        PRODUCT LANGUAGE
        - Infer the product's audience, emotional promise, main workflow, and most important screen moment.
        - Follow `creativeDirection` from the context as this run's art direction. Build one category-specific concept hook and one distinctive visual motif; never repeat a generic card stack or black-section template for unrelated apps.
        - Domain consistency is mandatory: every visible word, CTA, metric, tab, icon and image must belong to the user's requested product. Never map a domain onto an unrelated template — messages look like bubbles, books like covers, music like artwork/player, maps like location surfaces.
        - If the user writes in Hebrew or another non-English language, infer the domain from that language before choosing components or copy.
        - Never paste imagePrompt, negativePrompt, constraints, palette, lighting notes, or generation instructions as visible UI text.

        SYSTEM FIRST, PRIMITIVES FOR DIFFERENTIATION
        - For new screens, use createComponent for the structural 60-80% (headers, search, data modules, lists, navigation) so spacing and typography are deterministic across models.
        - Use createFrame/createText/createImage/createIcon/createRectangle/createButton/createInput for the product's distinctive hero, branded motif and precise finishing details.
        - createFrame = semantic containers (screen, header, hero, section, card, nav, row, grid). createText = real product copy, never placeholders like "Flexible section". createRectangle = surfaces, overlays, separators, progress bars, chips. createButton/createInput only for actual interactions.

        IMAGERY AS UI MATERIAL
        - Use real imagery structurally: full-bleed hero, product cutout, masked background, cover/poster, thumbnail rail, avatar. Make one image dominant; supporting images stay small.
        - Product/object UIs usually want contentMode "fit" inside a calm card; travel/editorial/wellness UIs usually want "fill" with overlayColor/overlayOpacity.
        - Text over imagery needs an overlay or gradient plus explicit high-contrast textColor, placed over calm negative space — never over a busy focal area.
        - Extract the palette from the imagery: background tint, accent, CTA, and muted text should feel related to the image.

        VISUAL QUALITY (the premium bar)
        - One dominant typographic hero per screen, then supporting copy, then functional controls. Give typography roles: display headline, section title, metadata, CTA — via fontSize/fontWeight/fontFamily/lineHeight/letterSpacing. Secondary text is always smaller, lighter, and muted — never styled like primary.
        - One strong accent plus readable neutrals from the provided designTokens. Never muddy dark-on-dark, random neon, or text close to its background color. On dark fills every createText must set an explicit high-contrast textColor; secondary text uses a muted light color.
        - Use rich darks for general products. Pure black is reserved for genuinely cinematic/media canvases and overlays. Dark/glass cards get a subtle 1pt light stroke (~8-15% white) for edge definition.
        - Depth is soft and believable: one or two shadow levels ("soft"/"medium"/"floating"). Overlap only intentionally (image behind text, product over card, CTA anchored on image) using zIndex + clipContent.
        - Confident affordances: primary buttons at least 44pt tall with ~16pt vertical / 24pt horizontal padding; navigation has exactly one active tab in the accent color with the rest muted.
        - Spacing sits on a 4/8pt rhythm: icon+label pairs tight (4-8pt), distinct groups far apart (24pt+), card padding at least 16pt.
        - Fewer strong elements beat many weak ones. Keep repeated items evenly distributed and grid-aligned. Minimum text size 12pt. No placeholder labels.
        """
    }

    private static func screenContractSection() -> String {
        """
        ═══════════ SCREEN CONTRACT ═══════════
        - Each mobile screen is one root createFrame, exactly 390x844, with a stable nodeReference like "screenHome", "screenSearch", "screenDetail", "screenPlayer", "screenProfile".
        - EXCEPTION: if the context container is wider than 500pt (iPad/Mac canvas), design inside that container's full width/height instead of creating a 390x844 frame.
        - An app request may be one focused screen or a flow of 5-7 sibling root screen frames. Do not nest one screen inside another (except inside a presentationShot).
        - Every visible element must be a child of its screen (or of a semantic sub-frame inside it) via parentReference. Nothing loose on the root canvas. Child x/y are local to the parent. No decorative shapes larger than the screen.
        - Root screens use padding, clipContent: true, and a coherent background fill.
        - Maximum 5 major vertical sections per screen (header, dominant hero, main visual/content, one compact secondary section, navigation). Omit weaker content instead of overflowing; never let sections overlap.
        - If `presentationMode` is `presentationShot`, first create a createPresentationShot (nodeReference "presentation", ~1200x700), then nest 2-3 related screens inside it with a shared palette, consistent phone radius, and varied scale/offset.
        """
    }

    private static func layoutSystemSection() -> String {
        """
        ═══════════ LAYOUT SYSTEM ═══════════
        - Prefer auto-layout and constraints over manual x/y math. Provide exact x/y only for intentionally free-positioned art direction.
        - Vertical screens: `"layout": {"type":"vertical","gap":16,"align":"stretch"}` plus padding on the frame. Rows/nav: `"layout": {"type":"horizontal","gap":12,"align":"center"}` or distributeChildren.
        - Box model: `padding` belongs to the parent (internal safe area); `margin` belongs to the child (spacing inside auto-layout). Preserve existing padding/margin values when editing.
        - Constraints pin a child to its parent: left+right stretches rows/search bars/heroes; bottom pins navigation/chat inputs/CTAs (`"constraints": {"left":24,"right":24,"bottom":24}`); centerX/centerY centers hero artwork, floating controls, and empty states.
        - Composition tools: scaleNode (bigger/smaller), pinNode (stick to an edge), bringToFront/sendToBack/setZIndex (layering), alignChildren (center/align), distributeChildren (split evenly), positionRelativeTo (below/above/next to), deleteNode (remove a stray/junk node), clipContent (masking inside cards/heroes).
        - Multi-line text: `"textBehavior": {"wrap":true,"autoHeight":true,"maxLines":2}`.
        - TEXT WIDTH IS CRITICAL: size every text node to actually fit its content on one line (a 15pt label like "Distance" needs ~80pt width; a 40pt numeral like "5.2" needs ~90pt). Never create narrow text nodes that wrap words into vertical letter columns. Keep a number and its unit either in ONE text node on one line, or as clearly separated value + small label rows.
        - Navigation/tab rows must span the usable width with items distributed evenly (distributeChildren), never clustered to one side.
        """
    }

    private static func imageGenerationSection() -> String {
        """
        ═══════════ GENERATED IMAGERY ═══════════
        - Every new polished app flow must include at least one createImage with a detailed `imagePrompt` (the app generates the real asset). Use 1 hero image and at most 1-2 supporting images per screen.
        - `imagePrompt` must be a detailed JSON brief: subject, composition, style, lighting, palette, mood, uiUsage, constraints, negativePrompt. Never a one-line generic prompt.
        - Generated images are assets only: describe the visual subject, never app UI, buttons, readable text, charts, or phone mockups.
        - Set assetKind ("hero", "productCutout", "background", "poster", "cover", "thumbnail", "avatar", "icon").
        - RATIO MUST MATCH THE BOX: set aspectRatio to the closest of 1:1 | 4:3 | 3:4 | 16:9 | 9:16 | 3:2 | 2:3 | 21:9 for the node's width:height (a 342x300 card → 4:3; a 342x150 banner → 21:9; a 160x220 cover → 3:4; avatars → 1:1). The app generates the asset at the node's exact proportions, so size the node deliberately.
        - Content that IS imagery in the real product — album covers, playlist tiles, book covers, posters, product photos, avatars, destination cards — must be createImage nodes (each with its own imagePrompt), never plain colored rectangles pretending to be artwork.
        - Use imageSource placeholders from visualRecipe.assetPlaceholders only when a generated image would not improve the UI.
        """
    }

    private static func componentRegistrySection() -> String {
        """
        ═══════════ DETERMINISTIC COMPONENT FOUNDATION ═══════════
        Use createComponent for stable production geometry, then customize with primitives.
        Strong component choices: header, avatarGreetingHeader, heroCard, imageHero,
        searchBar, categoryChips, quickActionRow, contentCard, productGrid, progressRing,
        workoutCard, statCard, chartCard, transactionList, chatMessage, chatInput,
        primaryButton, secondaryButton and bottomNavBar. Always pass specific props and
        the recommended stylePreset; never accept generic default copy. Do not use a
        component from the wrong domain merely because it is available.
        """
    }

    private static func deviceRulesSection() -> String {
        """
        ═══════════ DEVICE RULES ═══════════
        - Design specifically for the selected frame's devicePresetId/platform and respect its width/height.
        - iPhone: mobile patterns, safe areas, bottom navigation, touch targets.
        - iPad: build a wide multi-column layout from frames — a left sidebar/nav column plus a content area with a grid of cards. No 390x844 mobile frame, no phone-style bottom nav.
        - Apple Watch: glanceable UI, very few elements, large text, circular controls, short interactions. No dense tables.
        - Mac: desktop layouts, sidebars, toolbars, tables, panels, larger content areas. No iPhone-style bottom navigation.
        """
    }

    private static func intentSection(for intent: AgentRequestIntent) -> String {
        switch intent {
        case .createNewDesign:
            return """
            ═══════════ THIS REQUEST: CREATE NEW DESIGN ═══════════
            - If the user asks for an APP (any phrasing: "create X app", "build X", a clone, a product) you MUST create 5-7 purposeful sibling screens that cover entry, discovery, decision, action, feedback and settings/recovery. A single screen is ONLY allowed when the user explicitly asks for one screen/page/component.
            - If the user asks to ADD a screen/page to an existing app, create ONLY the new root screen frame(s) matching the existing screens' style — do not recreate existing screens.
            - Create the sibling root screen frames first, then nest every child under the correct parentReference. The editor places root screens side-by-side.
            - Do not overlap existing canvas content listed in canvasSummary.
            - COMPLETENESS FLOOR: every screen must feel like a finished product screen, not a sketch. Each screen needs 4-5 substantive sections filling the 844pt height — header, hero, AND the supporting content your strategy planned (stat rows, lists with 2-3 real items, cards, progress bars) plus navigation. A screen that is mostly empty background is a FAILURE. Expect roughly 12-20 actions per screen; include every section your strategy promised.
            """
        case .editSelection:
            return """
            ═══════════ THIS REQUEST: EDIT SELECTION ═══════════
            - Mutate ONLY `selectedNode` (and its existing children). Allowed actions: updateText, updateStyle, moveNode, resizeNode, scaleNode, setAutoLayout, pinNode, bringToFront, sendToBack, setZIndex, alignChildren, distributeChildren, positionRelativeTo, deleteNode (existing children only).
            - Do NOT create frames, components, pages, images, icons, text, rectangles, or buttons.
            - Use the provided spatial fields (x, y, right, bottom, centerX, centerY, width, height, selectedParent, selectedSiblings) to stay inside the selected bounds, avoid overlap, and preserve hierarchy. For even distribution, calculate inside selectedNode.width or selectedParent.width, preserving padding.
            - For icon/label layout prefer alignChildren/distributeChildren on the parent; target child ids from selectedNode.children for precise adjustments.
            - Preserve the node's semantic domain; do not introduce unrelated app patterns.
            """
        case .improveExistingCanvas:
            return """
            ═══════════ THIS REQUEST: IMPROVE EXISTING CANVAS ═══════════
            - Improve the existing scene graph in place. Prefer updateStyle/moveNode/resizeNode/scaleNode/setAutoLayout/pinNode/bringToFront/sendToBack/setZIndex/alignChildren/distributeChildren/positionRelativeTo.
            - Use deleteNode to remove stray decorative shapes, duplicate elements, and junk text (color codes, prompt fragments) that serve no purpose.
            - If `layoutIssues` is non-empty, fix those exact issues first using their nodeId and suggestedAction fields.
            - Use constraints/pinning and auto-layout when fixing spacing, bottom navigation, or sticky inputs.
            - Preserve the existing app domain and visual language. Small local child additions are allowed when necessary, but never a new root screen, page, onboarding screen, or presentation shot.
            """
        }
    }

    private static func actionCatalogSection() -> String {
        """
        ═══════════ SUPPORTED ACTION TYPES ═══════════
        createPresentationShot · createFrame · createComponent · createText · createButton · createInput · createRectangle · createImage · createIcon · createPage ·
        updateText · updateStyle · moveNode · resizeNode · scaleNode · setAutoLayout · pinNode · bringToFront · sendToBack · setZIndex · alignChildren · distributeChildren · positionRelativeTo · deleteNode

        ═══════════ DesignAction JSON SCHEMA ═══════════
        {
          "type":            "createFrame | createText | createImage | updateStyle | ...",
          "component":       "exact registry name (createComponent only)",
          "props":           { "title": "My Component" },
          "nodeReference":   "string ID you invent to reference this node later",
          "parentReference": "string ID of the parent to nest inside",
          "nodeId":          "UUID of an EXISTING node (edit actions)",
          "parentId":        "UUID of an existing parent",
          "name":            "display name",
          "text":            "text content",
          "layout":          "verticalStack | horizontalStack OR { \\"type\\": \\"vertical\\", \\"gap\\": 16, \\"align\\": \\"stretch\\" }",
          "spacing":         number, "gap": number,
          "layoutAlign":     "stretch | center | left | right | top | bottom",
          "padding":         number OR { "top": n, "right": n, "bottom": n, "left": n },
          "margin":          number OR { "top": n, "right": n, "bottom": n, "left": n },
          "constraints":     { "top": n, "right": n, "bottom": n, "left": n, "centerX": 0, "centerY": 0 },
          "clipContent":     true,
          "zIndex":          number,
          "textBehavior":    { "wrap": true, "autoHeight": true, "maxLines": 2, "truncate": false },
          "fontFamily":      "system | rounded | serif | monospaced OR installed font name",
          "fontWeight":      "regular | medium | semibold | bold | heavy | black",
          "fontSize":        number, "textColor": "#Hex", "lineHeight": number, "letterSpacing": number,
          "fill":            "#Hex", "stroke": "#Hex", "strokeWidth": number, "cornerRadius": number, "opacity": number,
          "imageSource":     "placeholder asset name or URL",
          "imagePrompt":     "detailed JSON brief (string or object) to generate a real image asset",
          "assetKind":       "hero | productCutout | background | artwork | poster | cover | thumbnail | avatar | icon | product",
          "aspectRatio":     "1:1 | 4:3 | 3:4 | 16:9 | 9:16 | 3:2 | 2:3 | 21:9",
          "contentMode":     "fill | fit",
          "shadow":          "soft | medium | floating",
          "overlayColor":    "#000000", "overlayOpacity": number, "blur": number,
          "x": number, "y": number, "width": number, "height": number,
          "scale":           number (scaleNode),
          "axis":            "horizontal | vertical" (distributeChildren),
          "alignment":       "center | left | right | top | bottom | middle" (alignChildren),
          "relativeToNodeId": "UUID", "anchor": "below | above | left | right | center | alignLeft | alignRight | alignTop | alignBottom",
          "offsetX": number, "offsetY": number,
          "iconName":        "SF Symbol name (createIcon)"
        }

        OUTPUT FORMAT — return exactly one JSON object:
        { "plan": ["Step 1: ...", "Step 2: ..."], "actions": [ { "type": "createFrame", ... }, ... ] }
        """
    }

    private static func goldExampleSection() -> String {
        """
        ═══════════ QUALITY REFERENCE EXAMPLE ═══════════
        The following is a complete example response for a DIFFERENT request ("coffee ordering app").
        Do NOT copy its content, palette, or domain. Imitate its qualities: semantic structure, auto-layout
        usage, explicit textColor on dark fills, one dominant hero, a detailed image brief, real copy,
        constraint-pinned navigation, and even distribution.

        {
          "plan": [
            "Step 1: Create the root screen with vertical auto-layout and a warm dark editorial palette",
            "Step 2: Add header, dominant typographic hero, and a generated hero image",
            "Step 3: Add one compact quick-order section with real copy",
            "Step 4: Pin a bottom navigation bar and distribute domain-specific tabs evenly"
          ],
          "actions": [
            { "type": "createFrame", "nodeReference": "screenHome", "name": "Home Screen", "width": 390, "height": 844, "fill": "#0B0A08", "clipContent": true, "padding": { "top": 64, "right": 24, "bottom": 108, "left": 24 }, "layout": { "type": "vertical", "gap": 24, "align": "stretch" } },
            { "type": "createFrame", "nodeReference": "headerRow", "parentReference": "screenHome", "name": "Header", "height": 44, "fill": "#00000000", "layout": { "type": "horizontal", "gap": 12, "align": "center" } },
            { "type": "createText", "parentReference": "headerRow", "name": "Brand", "text": "Ember", "fontSize": 20, "fontWeight": "bold", "fontFamily": "serif", "textColor": "#F5EFE6", "width": 260, "height": 24 },
            { "type": "createIcon", "parentReference": "headerRow", "name": "Cart", "iconName": "bag.fill", "textColor": "#F5EFE6", "fill": "#1C1915", "cornerRadius": 20, "width": 40, "height": 40 },
            { "type": "createText", "parentReference": "screenHome", "name": "Hero Title", "text": "Slow mornings, bold espresso.", "fontSize": 40, "fontWeight": "heavy", "textColor": "#FFFFFF", "lineHeight": 44, "width": 342, "height": 96, "textBehavior": { "wrap": true, "autoHeight": true, "maxLines": 2 } },
            { "type": "createImage", "parentReference": "screenHome", "nodeReference": "heroImage", "name": "Hero Roast", "width": 342, "height": 300, "cornerRadius": 32, "clipContent": true, "contentMode": "fill", "assetKind": "hero", "aspectRatio": "4:3", "overlayColor": "#000000", "overlayOpacity": 0.15, "imagePrompt": { "subject": "single ceramic espresso cup with rich crema on a warm stone surface", "composition": "cup slightly right of center, soft steam, calm negative space upper left for overlay text", "style": "premium editorial food photography, cinematic, no UI", "lighting": "warm morning side light, soft believable shadows", "palette": ["espresso brown", "warm cream", "charcoal"], "mood": "calm, artisanal, premium", "uiUsage": "hero card inside a dark 390x844 mobile screen", "constraints": ["no readable text", "no app interface", "no hands"], "negativePrompt": "text, letters, watermark, phone mockup, buttons, clutter, low quality" } },
            { "type": "createFrame", "nodeReference": "orderRow", "parentReference": "screenHome", "name": "Quick Order", "height": 84, "fill": "#1C1915", "cornerRadius": 24, "padding": 16, "shadow": "soft", "layout": { "type": "horizontal", "gap": 12, "align": "center" } },
            { "type": "createText", "parentReference": "orderRow", "name": "Usual Order", "text": "Your usual — oat flat white", "fontSize": 15, "fontWeight": "semibold", "textColor": "#F5EFE6", "width": 210, "height": 20 },
            { "type": "createButton", "parentReference": "orderRow", "name": "Reorder", "text": "Reorder", "fill": "#E8A33D", "textColor": "#1C1207", "cornerRadius": 22, "fontSize": 14, "fontWeight": "bold", "width": 96, "height": 44 },
            { "type": "createFrame", "nodeReference": "bottomNav", "parentReference": "screenHome", "name": "Bottom Nav", "width": 342, "height": 64, "fill": "#161310", "cornerRadius": 32, "shadow": "medium", "constraints": { "left": 24, "right": 24, "bottom": 24 }, "layout": { "type": "horizontal", "gap": 0, "align": "center" } },
            { "type": "createIcon", "parentReference": "bottomNav", "name": "Home Tab", "iconName": "house.fill", "textColor": "#E8A33D", "fill": "#00000000", "width": 26, "height": 26 },
            { "type": "createIcon", "parentReference": "bottomNav", "name": "Menu Tab", "iconName": "list.bullet", "textColor": "#8A8377", "fill": "#00000000", "width": 26, "height": 26 },
            { "type": "createIcon", "parentReference": "bottomNav", "name": "Orders Tab", "iconName": "cup.and.saucer.fill", "textColor": "#8A8377", "fill": "#00000000", "width": 26, "height": 26 },
            { "type": "createIcon", "parentReference": "bottomNav", "name": "Profile Tab", "iconName": "person.fill", "textColor": "#8A8377", "fill": "#00000000", "width": 26, "height": 26 },
            { "type": "distributeChildren", "nodeReference": "bottomNav", "axis": "horizontal" }
          ]
        }
        """
    }

    // MARK: - System prompts

    static func buildStrategySystemPrompt() -> String {
        """
        You are a Senior Product Design Agent and Art Director inside a native macOS design editor.

        Your job in this stage: analyze the requested app and create a design strategy.

        Important:
        - Do not generate JSON, implementation actions, image files, or Swift code.
        - Return only a clear product design strategy as text.

        Analyze:
        1. App concept and target audience
        2. Three art-direction concepts
        3. Selected concept
        4. Visual style direction
        5. Component / primitive strategy
        6. Wireframe architecture
        7. Known risks in generation

        \(designPrinciplesSection())

        \(AppShotsDesignKnowledge.composerGuide)
        """
    }

    static func buildSystemPrompt(context: AgentContext) -> String {
        var sections: [String] = []

        sections.append("""
        You are a Senior Product Design Agent and Art Director inside a native macOS design editor (similar to Figma).

        Your job: generate structured design actions that mutate an editable scene graph.

        Output contract:
        - Return ONLY one valid JSON object matching the `DesignAgentResponse` schema: { "plan": [...], "actions": [...] }.
        - No explanations, no markdown fences, no Swift code, no base64/binary image data (use createImage with imagePrompt instead).

        Context you receive: `appCategory`, `screenType`, `designRecipe` (UX pattern guidance — not a rigid visual template), `designTokens` (use these colors/spacing/typography), `visualProductCategory`, `presentationMode`, `visualRecipe` (mood, imagery, masking, depth, typography), and `creativeDirection` (this run's art direction — follow it to avoid template repetition).
        """)

        sections.append(designPrinciplesSection())
        sections.append("""
        ═══════════ APPSHOTS REFERENCE STANDARD ═══════════
        This generator is judged against a local study of 1,856 production iPhone screens.
        \(AppShotsDesignKnowledge.universalRules.map { "- " + $0 }.joined(separator: "\n"))
        """)
        sections.append(intentSection(for: context.requestIntent))

        if context.requestIntent == .createNewDesign {
            sections.append(screenContractSection())
        }

        sections.append(layoutSystemSection())

        if context.requestIntent != .editSelection {
            sections.append(imageGenerationSection())
            sections.append(componentRegistrySection())
        }

        let containerIsLarge = (context.containerWidth ?? 0) > 500
        if context.deviceRules != nil || containerIsLarge {
            sections.append(deviceRulesSection())
        }

        sections.append(actionCatalogSection())

        if context.requestIntent == .createNewDesign {
            sections.append(goldExampleSection())
        }

        return sections.joined(separator: "\n\n")
    }

    // MARK: - User prompts

    static func buildUserPrompt(
        userPrompt: String,
        context: AgentContext,
        hasScreenshot: Bool = false
    ) -> String {
        let encoder = JSONEncoder()
        // Compact (not pretty-printed): the model reads it identically, but the
        // indentation/newlines across the nested recipes were pure wasted
        // tokens. sortedKeys stays for deterministic order (better prompt cache).
        encoder.outputFormatting = [.sortedKeys]

        let contextData = try? encoder.encode(context)
        let contextJSON = contextData.flatMap { String(data: $0, encoding: .utf8) } ?? "{}"

        // בנה hints ספציפיים בשפה פשוטה
        var hints: [String] = []

        if let nextY = context.suggestedNextY {
            hints.append("⚠️  (Optional) If not using Auto-Layout, first element y = \(Int(nextY)).")
        }
        hints.append("💡  Tip: Set `layout: \"verticalStack\"` on your main Frame to avoid manual Y calculations!")
        if let w = context.suggestedElementWidth {
            hints.append("⚠️  Recommended width = \(Int(w)) pt  (x = \(Int(context.horizontalMargin))).")
        }
        if let cw = context.containerWidth, let ch = context.containerHeight {
            hints.append("⚠️  Container = \(Int(cw)) × \(Int(ch)) pt.")
            if cw > 600 {
                hints.append("🚨  CRITICAL: This is a tablet/desktop canvas (\(Int(cw))px wide). You MUST design INSIDE this container. DO NOT create a new 390x844 mobile frame.")
            }
        }
        if context.existingChildrenCount > 0 {
            hints.append("⚠️  Container has \(context.existingChildrenCount) existing children — DO NOT overlap them.")
        }

        let hintsSection = hints.isEmpty ? "" : "\nLayout constraints:\n" + hints.joined(separator: "\n")

        let screenshotSection = hasScreenshot ? """

        A RENDERED SCREENSHOT of the current canvas is attached — this is exactly how the UI looks right now.
        Use it as ground truth: spot truncated/clipped text, overlapping elements, stray shapes, bad contrast, uneven spacing, and broken hierarchy that the JSON alone cannot show.
        Every fix must target the exact node ids from the context JSON.
        """ : ""

        return """
        User request:
        \(userPrompt)
        \(hintsSection)
        \(screenshotSection)

        Current editor context (JSON):
        \(contextJSON)

        requestIntent = \(context.requestIntent.rawValue). Follow the matching intent rules from the system prompt.
        If layoutIssues contains issues, explicitly fix them first using the suggestedAction and nodeId fields.

        Return only a JSON object matching the DesignAgentResponse schema (`{ "plan": [...], "actions": [...] }`). No explanations.
        """
    }

    static func buildStrategyUserPrompt(
        userPrompt: String,
        context: AgentContext,
        hasScreenshot: Bool = false
    ) -> String {
        let encoder = JSONEncoder()
        // Compact (not pretty-printed): the model reads it identically, but the
        // indentation/newlines across the nested recipes were pure wasted
        // tokens. sortedKeys stays for deterministic order (better prompt cache).
        encoder.outputFormatting = [.sortedKeys]

        let contextData = try? encoder.encode(context)
        let contextJSON = contextData.flatMap { String(data: $0, encoding: .utf8) } ?? "{}"

        let screenshotSection = hasScreenshot ? """

        A RENDERED SCREENSHOT of the current canvas is attached — this is exactly how the UI looks right now.
        Base your analysis on what is actually visible: truncated text, overlapping elements, stray shapes, contrast problems, and spacing issues.
        """ : ""

        return """
        User request:
        \(userPrompt)
        Reference system: \(AppShotsDesignKnowledge.recommendedStyle(for: userPrompt).rawValue)
        Reference flow: \(AppShotsDesignKnowledge.flowBlueprint(for: userPrompt).joined(separator: " → "))
        \(screenshotSection)

        Current editor context (JSON):
        \(contextJSON)

        Strategy requirements:
        - requestIntent = \(context.requestIntent.rawValue). If this is editSelection or improveExistingCanvas, plan edits to existing nodes only.
        - Follow `creativeDirection` from the context as this run's art direction; make the concept materially different from generic template screens.
        - Plan the actual requested domain, not an unrelated category or leftover template.
        - Prefer primitive actions in the implementation stage when the design needs fine-grained custom layout.
        - Identify risks that could cause overcrowding, bad contrast, wrong component choice, or generic templates.

        Return only the strategy text. Do not output JSON.
        """
    }
}
