//
//  SpriteGenerator.swift
//  AgenticDesigner
//
//  Turns a text prompt into a game-ready sprite: generate art with the normal
//  image pipeline (local mflux first, cloud fallback), then cut the subject out
//  to a transparent PNG using Vision's on-device subject-lift — no extra models
//  or network. Optionally emits several animation frames.
//
//  This is what makes the generated art usable as a game sprite: FLUX/most image
//  models bake in an opaque background; a sprite needs alpha.
//

import Foundation
import Vision
import CoreImage
import ImageIO
import UniformTypeIdentifiers
#if canImport(AppKit)
import AppKit
#endif

enum SpriteGeneratorError: LocalizedError {
    case noSubjectFound
    case renderFailed
    case sourceUnreadable

    var errorDescription: String? {
        switch self {
        case .noSubjectFound: return "Vision could not find a foreground subject to cut out."
        case .renderFailed:   return "Failed to render the cut-out sprite to PNG."
        case .sourceUnreadable: return "Could not read the generated source image."
        }
    }
}

struct SpriteGenerationResult {
    /// Final sprite file paths (transparent PNGs when cut-out succeeded).
    var framePaths: [String]
    /// Whether background removal actually ran on each frame.
    var cutout: Bool
}

enum SpriteGenerator {

    /// Generate `frames` sprite image(s) for `prompt`, cutting the subject out
    /// to transparent PNGs when `removeBackground` is true.
    /// The most common colours across some reference images, as #RRGGBB — the
    /// game's working palette, sampled on-device.
    static func dominantPalette(fromImagePaths paths: [String], maxColors: Int = 5) -> [String] {
        var counts: [UInt32: Int] = [:]
        for path in paths.prefix(6) {
            guard let img = NSImage(contentsOfFile: path),
                  let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { continue }
            let w = 24, h = 24
            var buf = [UInt8](repeating: 0, count: w * h * 4)
            let space = CGColorSpaceCreateDeviceRGB()
            guard let ctx = CGContext(data: &buf, width: w, height: h, bitsPerComponent: 8,
                                      bytesPerRow: w * 4, space: space,
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { continue }
            ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
            var i = 0
            while i < buf.count {
                if buf[i + 3] > 140 {  // skip the transparent cutout background
                    let r = UInt32(buf[i] / 32 * 32)
                    let g = UInt32(buf[i + 1] / 32 * 32)
                    let b = UInt32(buf[i + 2] / 32 * 32)
                    counts[(r << 16) | (g << 8) | b, default: 0] += 1
                }
                i += 4
            }
        }
        return counts.sorted { $0.value > $1.value }.prefix(maxColors).map { entry in
            let k = entry.key
            return String(format: "#%02X%02X%02X", (k >> 16) & 0xFF, (k >> 8) & 0xFF, k & 0xFF)
        }
    }

    /// A prompt fragment that steers a new sprite toward the existing art —
    /// nil when there are no usable references.
    static func styleDirective(fromImagePaths paths: [String]) -> String? {
        let palette = dominantPalette(fromImagePaths: paths)
        guard !palette.isEmpty else { return nil }
        return "Match the existing game's art style so it clearly belongs in the same game: "
             + "reuse this colour palette \(palette.joined(separator: ", ")); "
             + "keep the same lighting, outline weight, shading and overall rendering style."
    }

    static func generateSprite(
        prompt: String,
        frames: Int = 1,
        size: String? = "768x768",
        removeBackground: Bool = true,
        assetKind: String = "sprite",
        styleReferencePaths: [String] = [],
        facing: String? = nil,
        provider: OpenRouterProvider
    ) async throws -> SpriteGenerationResult {
        let frameCount = max(1, min(frames, 12))
        // Fold facing direction + the existing game's palette/style into the
        // prompt so the new sprite faces the right way and looks consistent.
        var styledPrompt = prompt
        if let facing, let dir = facingDirective(facing) { styledPrompt += ". \(dir)" }
        if let directive = styleDirective(fromImagePaths: styleReferencePaths) { styledPrompt += ". \(directive)" }
        var paths: [String] = []
        var didCutout = false

        for i in 0..<frameCount {
            let framePrompt: String
            if frameCount > 1 {
                framePrompt = "\(styledPrompt) — sprite animation frame \(i + 1) of \(frameCount); same character, same scale and colors, only a small pose/motion change between frames"
            } else {
                framePrompt = styledPrompt
            }

            let rawPath = try await provider.generateImageAsset(
                prompt: framePrompt,
                assetKind: assetKind,
                aspectRatio: nil,
                resolution: nil,
                size: size
            )

            if removeBackground, let cut = try? cutoutSubject(fromImageAt: rawPath) {
                paths.append(cut)
                didCutout = true
            } else {
                paths.append(rawPath)
            }
        }

        return SpriteGenerationResult(framePaths: paths, cutout: didCutout)
    }

    /// Cut the dominant foreground subject out of an image, returning the path
    /// of a new transparent PNG. Uses Vision's foreground-instance mask
    /// (on-device, macOS 14+).
    static func cutoutSubject(fromImageAt path: String) throws -> String {
        guard let ciImage = CIImage(contentsOf: URL(fileURLWithPath: path)) else {
            throw SpriteGeneratorError.sourceUnreadable
        }

        let request = VNGenerateForegroundInstanceMaskRequest()
        let handler = VNImageRequestHandler(ciImage: ciImage, options: [:])
        try handler.perform([request])

        guard let result = request.results?.first, !result.allInstances.isEmpty else {
            throw SpriteGeneratorError.noSubjectFound
        }

        let maskedBuffer = try result.generateMaskedImage(
            ofInstances: result.allInstances,
            from: handler,
            croppedToInstancesExtent: true
        )

        let maskedImage = CIImage(cvPixelBuffer: maskedBuffer)
        let context = CIContext(options: nil)
        guard let cgImage = context.createCGImage(maskedImage, from: maskedImage.extent) else {
            throw SpriteGeneratorError.renderFailed
        }

        return try writePNG(cgImage)
    }

    // MARK: - PNG output (preserves the alpha channel)

    /// Mirror a sprite left↔right and save a new PNG — the exact, reliable way
    /// to set a sprite's facing direction (image models routinely ignore
    /// "facing left"). Returns the new file path.
    static func flipHorizontal(pathToImage path: String) throws -> String {
        guard let img = NSImage(contentsOfFile: path),
              let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
            throw SpriteGeneratorError.renderFailed
        }
        let w = cg.width, h = cg.height
        guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8,
                                  bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
            throw SpriteGeneratorError.renderFailed
        }
        // Flip the x axis, then draw.
        ctx.translateBy(x: CGFloat(w), y: 0)
        ctx.scaleBy(x: -1, y: 1)
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
        guard let flipped = ctx.makeImage() else { throw SpriteGeneratorError.renderFailed }
        return try writePNG(flipped)
    }

    /// A facing-direction phrase to steer the prompt (best effort; pair with
    /// flipHorizontal for a guaranteed left/right).
    static func facingDirective(_ facing: String) -> String? {
        switch facing.lowercased() {
        case "right": return "side profile, facing right"
        case "left":  return "side profile, facing left"
        case "front": return "front view, facing the camera"
        case "back":  return "back view, seen from behind"
        case "up":    return "top-down view, seen from above"
        default:      return nil
        }
    }

    private static func writePNG(_ cgImage: CGImage) throws -> String {
        let assetsDirectory = try generatedAssetsDirectory()
        let url = assetsDirectory
            .appendingPathComponent("sprite-\(UUID().uuidString)")
            .appendingPathExtension("png")

        guard let dest = CGImageDestinationCreateWithURL(
            url as CFURL, UTType.png.identifier as CFString, 1, nil
        ) else {
            throw SpriteGeneratorError.renderFailed
        }
        CGImageDestinationAddImage(dest, cgImage, nil)
        guard CGImageDestinationFinalize(dest) else {
            throw SpriteGeneratorError.renderFailed
        }
        return url.path
    }

    /// Same location the rest of the app saves generated assets, so exports and
    /// the asset browser find sprites the normal way.
    /// The folder every generated sprite lands in (transparent PNGs).
    static var assetsDirectoryURL: URL? { try? generatedAssetsDirectory() }

    /// Existing sprites, newest first — the Studio's sprite library.
    static func librarySprites() -> [URL] {
        guard let dir = try? generatedAssetsDirectory() else { return [] }
        let urls = (try? FileManager.default.contentsOfDirectory(
            at: dir, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
        return urls.filter { $0.pathExtension.lowercased() == "png" }
            .sorted { a, b in
                let da = (try? a.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
                let db = (try? b.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
                return da > db
            }
    }

    private static func generatedAssetsDirectory() throws -> URL {
        let fm = FileManager.default
        let support = try fm.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let dir = support
            .appendingPathComponent("AgenticDesigner", isDirectory: true)
            .appendingPathComponent("GeneratedAssets", isDirectory: true)
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }
}
