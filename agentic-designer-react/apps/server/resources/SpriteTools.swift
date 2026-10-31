// Ported from AgenticDesigner/Services/SpriteGenerator.swift — the Vision /
// CoreGraphics half that Node cannot run. Compiled once on demand by
// SpriteGenerator.ts (swiftc → ~/.agenticdesigner/bin/SpriteTools) and invoked:
//   SpriteTools cutout  <inputImage> <outputPNG>
//   SpriteTools flip    <inputImage> <outputPNG>
//   SpriteTools palette <maxColors> <imagePath>…      → JSON array of #RRGGBB
// Errors print the SpriteGeneratorError message on stderr and exit 1.
import Foundation
import Vision
import CoreImage
import ImageIO
import UniformTypeIdentifiers
import AppKit

enum SpriteGeneratorError: Error {
    case noSubjectFound
    case renderFailed
    case sourceUnreadable

    var message: String {
        switch self {
        case .noSubjectFound: return "Vision could not find a foreground subject to cut out."
        case .renderFailed:   return "Failed to render the cut-out sprite to PNG."
        case .sourceUnreadable: return "Could not read the generated source image."
        }
    }
}

func writePNG(_ cgImage: CGImage, to path: String) throws {
    let url = URL(fileURLWithPath: path)
    guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
        throw SpriteGeneratorError.renderFailed
    }
    CGImageDestinationAddImage(dest, cgImage, nil)
    guard CGImageDestinationFinalize(dest) else { throw SpriteGeneratorError.renderFailed }
}

func cutoutSubject(fromImageAt path: String, to output: String) throws {
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
        ofInstances: result.allInstances, from: handler, croppedToInstancesExtent: true
    )
    let maskedImage = CIImage(cvPixelBuffer: maskedBuffer)
    let context = CIContext(options: nil)
    guard let cgImage = context.createCGImage(maskedImage, from: maskedImage.extent) else {
        throw SpriteGeneratorError.renderFailed
    }
    try writePNG(cgImage, to: output)
}

func flipHorizontal(pathToImage path: String, to output: String) throws {
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
    ctx.translateBy(x: CGFloat(w), y: 0)
    ctx.scaleBy(x: -1, y: 1)
    ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
    guard let flipped = ctx.makeImage() else { throw SpriteGeneratorError.renderFailed }
    try writePNG(flipped, to: output)
}

func dominantPalette(fromImagePaths paths: [String], maxColors: Int) -> [String] {
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
            if buf[i + 3] > 140 {
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

let arguments = Array(CommandLine.arguments.dropFirst())
do {
    guard let command = arguments.first else {
        FileHandle.standardError.write("usage: SpriteTools cutout|flip|palette …\n".data(using: .utf8)!)
        exit(2)
    }
    switch command {
    case "cutout":
        guard arguments.count >= 3 else { exit(2) }
        try cutoutSubject(fromImageAt: arguments[1], to: arguments[2])
        print(arguments[2])
    case "flip":
        guard arguments.count >= 3 else { exit(2) }
        try flipHorizontal(pathToImage: arguments[1], to: arguments[2])
        print(arguments[2])
    case "palette":
        guard arguments.count >= 2, let maxColors = Int(arguments[1]) else { exit(2) }
        let palette = dominantPalette(fromImagePaths: Array(arguments.dropFirst(2)), maxColors: maxColors)
        let data = try JSONSerialization.data(withJSONObject: palette)
        print(String(data: data, encoding: .utf8) ?? "[]")
    default:
        FileHandle.standardError.write("Unknown command: \(command)\n".data(using: .utf8)!)
        exit(2)
    }
} catch let error as SpriteGeneratorError {
    FileHandle.standardError.write((error.message + "\n").data(using: .utf8)!)
    exit(1)
} catch {
    FileHandle.standardError.write((error.localizedDescription + "\n").data(using: .utf8)!)
    exit(1)
}
