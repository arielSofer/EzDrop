//
//  RepeatBindingExpander.swift
//  AgenticDesigner
//
//  Turns a node tree containing repeatBinding templates into a tree with
//  those templates cloned once per item of their bound array variable,
//  fields substituted in — a pure transform consumed by the interactive
//  preview so CanvasNodeView/NodeView never need to know repeats exist.
//

import Foundation
import CoreGraphics

enum RepeatBindingExpander {

    // What a cloned row remembers about where it came from: which template
    // node it was cloned from (so a tap on the clone can find the flow wired
    // to the template) and which array item produced it (so that flow can
    // run with this item's data seeded as variables).
    struct CloneContext {
        let templateId: UUID
        let itemAlias: String
        let itemJSON: String
        // "alias" → whole item, "alias.field.subfield" → leaf values, ready
        // to merge straight into the simulator's flat variables dictionary.
        let variables: [String: String]
    }

    static func expand(_ nodes: [DesignNode], variables: [String: String]) -> [DesignNode] {
        var contexts: [UUID: CloneContext] = [:]
        return expand(nodes, variables: variables, contexts: &contexts)
    }

    // Same expansion, but also reports every clone root's CloneContext keyed
    // by the clone's (fresh) node id — the preview's hit-testing uses this to
    // make each cloned row individually tappable with its own item data.
    static func expandWithContext(_ nodes: [DesignNode], variables: [String: String]) -> ([DesignNode], [UUID: CloneContext]) {
        var contexts: [UUID: CloneContext] = [:]
        let expanded = expand(nodes, variables: variables, contexts: &contexts)
        return (expanded, contexts)
    }

    // The variables a tap on item N of this template should seed — how the
    // MCP preview_tap simulates "tap the Nth row" without a real pointer.
    static func itemContext(binding: RepeatBinding, variables: [String: String], itemIndex: Int) -> [String: String]? {
        guard let raw = variables[binding.sourceVariable],
              let items = parseItems(raw),
              items.indices.contains(itemIndex)
        else { return nil }
        return flattenedVariables(alias: binding.itemAlias, item: items[itemIndex])
    }

    // Recursively expands every repeatBinding template found anywhere in
    // `nodes`, reading array data out of `variables`. Nodes without any
    // repeat template in their subtree pass through unchanged. A node whose
    // DIRECT child is a scrollable repeat template automatically becomes a
    // scroll container along that template's axis (unless it already has
    // its own explicit scrollBehavior) — that's the "recycler view": one
    // cell template + a data source + a direction, wrapped in a viewport.
    private static func expand(_ nodes: [DesignNode], variables: [String: String], contexts: inout [UUID: CloneContext]) -> [DesignNode] {
        nodes.flatMap { node -> [DesignNode] in
            guard let binding = node.repeatBinding,
                  let raw = variables[binding.sourceVariable],
                  let items = parseItems(raw)
            else {
                var updated = node
                updated.children = expand(node.children, variables: variables, contexts: &contexts)
                if updated.scrollBehavior == nil,
                   let scrollableBinding = node.children.first(where: { $0.repeatBinding?.isScrollable == true })?.repeatBinding {
                    updated.scrollBehavior = ScrollBehavior(axis: scrollableBinding.axis.rawValue, showsIndicators: true)
                }
                return [updated]
            }

            // Live filters: keep only items matching BOTH the search filter and
            // the category filter (each empty = match all). Category chips and a
            // search box thus filter independently and combine.
            func needle(_ name: String?) -> String? {
                guard let name, let raw = variables[name]?.trimmingCharacters(in: .whitespaces), !raw.isEmpty else { return nil }
                return raw.lowercased()
            }
            let searchNeedle = needle(binding.filterVariable)
            let categoryNeedle = needle(binding.categoryVariable)
            let filtered = items.filter { item in
                if let searchNeedle, !itemMatches(item, needle: searchNeedle) { return false }
                if let categoryNeedle, !itemMatches(item, needle: categoryNeedle) { return false }
                return true
            }

            let cap = min(binding.maxItems ?? 50, 50)
            let spacing = node.style.spacing ?? 8
            var cursor: CGFloat = binding.axis == .horizontal ? node.x : node.y

            return filtered.prefix(cap).map { item in
                var clone = node
                clone.id = UUID()
                clone.repeatBinding = nil
                switch binding.axis {
                case .horizontal:
                    clone.x = cursor
                    cursor += node.width + spacing
                case .vertical:
                    clone.y = cursor
                    cursor += node.height + spacing
                }

                clone.text = node.text.map { substituting($0, alias: binding.itemAlias, item: item) }
                clone.imageSource = node.imageSource.map { substituting($0, alias: binding.itemAlias, item: item) }
                clone.imageName = node.imageName.map { substituting($0, alias: binding.itemAlias, item: item) }
                clone.children = substitutingTree(node.children, alias: binding.itemAlias, item: item)
                contexts[clone.id] = CloneContext(
                    templateId: node.id,
                    itemAlias: binding.itemAlias,
                    itemJSON: stringify(item),
                    variables: flattenedVariables(alias: binding.itemAlias, item: item)
                )
                return clone
            }
        }
    }

    // "alias" → whole item (JSON for objects, raw value for scalars), plus
    // one flat entry per nested leaf: {"title": "X", "author": {"name": "Y"}}
    // under alias "book" becomes ["book": …, "book.title": "X",
    // "book.author.name": "Y"] — matching the {{book.title}} tokens the
    // simulator's substitute() replaces by plain variable-name lookup.
    private static func flattenedVariables(alias: String, item: Any) -> [String: String] {
        var result: [String: String] = [alias: stringify(item)]
        flatten(item, prefix: alias, into: &result)
        return result
    }

    private static func flatten(_ value: Any, prefix: String, into result: inout [String: String]) {
        if let dict = value as? [String: Any] {
            for (key, nested) in dict {
                let path = "\(prefix).\(key)"
                result[path] = stringify(nested)
                flatten(nested, prefix: path, into: &result)
            }
        } else if let array = value as? [Any] {
            for (index, nested) in array.enumerated() {
                let path = "\(prefix).\(index)"
                result[path] = stringify(nested)
                flatten(nested, prefix: path, into: &result)
            }
        }
    }

    // True if any stringified value inside the item contains `needle`.
    private static func itemMatches(_ item: Any, needle: String) -> Bool {
        if let dict = item as? [String: Any] {
            return dict.values.contains { itemMatches($0, needle: needle) }
        }
        if let array = item as? [Any] {
            return array.contains { itemMatches($0, needle: needle) }
        }
        return stringify(item).lowercased().contains(needle)
    }

    // MARK: - Array parsing

    // JSON array of objects/scalars (the shape parseJSONResponse/
    // firestoreQuery/etc. already produce) with a fallback to the
    // newline-separated plain list appendToArray produces, so both of the
    // simulator's two "array" representations work as a repeat source.
    private static func parseItems(_ raw: String) -> [Any]? {
        if let data = raw.data(using: .utf8),
           let parsed = try? JSONSerialization.jsonObject(with: data),
           let array = parsed as? [Any] {
            return array
        }

        let lines = raw.split(separator: "\n").map(String.init)
        return lines.isEmpty ? nil : lines
    }

    // MARK: - Per-item substitution

    private static func substitutingTree(_ nodes: [DesignNode], alias: String, item: Any) -> [DesignNode] {
        nodes.map { node in
            var updated = node
            updated.text = node.text.map { substituting($0, alias: alias, item: item) }
            updated.imageSource = node.imageSource.map { substituting($0, alias: alias, item: item) }
            updated.imageName = node.imageName.map { substituting($0, alias: alias, item: item) }
            updated.children = substitutingTree(node.children, alias: alias, item: item)
            return updated
        }
    }

    // Replaces every {{alias}} or {{alias.path.to.field}} token in `text`
    // with the resolved value from `item`.
    private static func substituting(_ text: String, alias: String, item: Any) -> String {
        guard text.contains("{{") else { return text }

        let pattern = "\\{\\{\\s*" + NSRegularExpression.escapedPattern(for: alias) + "((?:\\.[A-Za-z0-9_]+)*)\\s*\\}\\}"
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return text }

        let nsText = text as NSString
        var result = text
        let matches = regex.matches(in: text, range: NSRange(location: 0, length: nsText.length))

        for match in matches.reversed() {
            var path = ""
            if match.range(at: 1).location != NSNotFound {
                path = nsText.substring(with: match.range(at: 1))
                if path.hasPrefix(".") { path.removeFirst() }
            }
            let replacement = resolve(path, in: item)
            result = (result as NSString).replacingCharacters(in: match.range, with: replacement)
        }

        return result
    }

    private static func resolve(_ path: String, in item: Any) -> String {
        guard !path.isEmpty else { return stringify(item) }

        var current = item
        for component in path.split(separator: ".") {
            let key = String(component)
            if let dict = current as? [String: Any], let next = dict[key] {
                current = next
            } else if let array = current as? [Any], let index = Int(key), array.indices.contains(index) {
                current = array[index]
            } else {
                return ""
            }
        }
        return stringify(current)
    }

    private static func stringify(_ value: Any) -> String {
        if let string = value as? String { return string }
        // JSON booleans deserialize as NSNumber (CFBoolean) — check Bool
        // first so they print "true"/"false", not "1"/"0".
        if let number = value as? NSNumber {
            if CFGetTypeID(number) == CFBooleanGetTypeID() {
                return number.boolValue ? "true" : "false"
            }
            return number.stringValue
        }
        if JSONSerialization.isValidJSONObject(value),
           let data = try? JSONSerialization.data(withJSONObject: value),
           let string = String(data: data, encoding: .utf8) {
            return string
        }
        return "\(value)"
    }
}
