//
//  PDFTextFitter.swift
//  AgenticDesigner
//
//  Fitting translated text back into a source layout.
//
//  Translation changes length — Hebrew runs ~20-30% shorter than English,
//  German longer — so the replacement rarely occupies the same space as the
//  original. The previous approach had exactly one lever: shrink the font
//  until it fits. That always "works" and often looks wrong, because an 11pt
//  paragraph rendered at 7pt next to an untouched 11pt paragraph reads as
//  damage even though nothing overflowed.
//
//  This tries the cheap, invisible adjustments first and only degrades the
//  type size as a last resort — and reports what it had to do, so the result
//  can be measured instead of assumed.
//

import Foundation
import AppKit

struct TextFitPlan {
    var bounds: CGRect
    var fontSize: CGFloat
    /// What it took, for reporting.
    var strategy: Strategy
    /// Ratio against the source size. 1.0 = untouched typography.
    var scale: CGFloat

    // NOTE: there is deliberately no letter-spacing lever. A `PDFAnnotation`
    // freeText carries only `.font`, so kerning cannot reach the page, and
    // macOS returns no real condensed variant for these faces (measured:
    // identical width). A strategy the renderer cannot honour would make the
    // fitter promise fits it does not deliver — worse than not having it.
    enum Strategy: String {
        case unchanged          // fit as-is
        case grewIntoSlack      // used empty space below the block
        case shrunk             // reduced font size
        case shrunkHard         // reduced a lot — visible, flagged
        case overflowed         // could not fit even at the floor
    }
}

enum PDFTextFitter {

    /// Never go below this fraction of the source size without flagging it.
    private static let comfortableFloor: CGFloat = 0.86
    private static let hardFloor: CGFloat = 0.62

    /// Computes how to place `text` in `bounds`.
    /// - Parameter verticalSlack: free space directly below the block before
    ///   the next one starts. Growing into it is invisible; growing past it
    ///   would collide, so it is a hard cap rather than a hint.
    static func plan(
        text: String,
        in bounds: CGRect,
        sourceFontSize: CGFloat,
        fontProvider: (CGFloat) -> NSFont,
        verticalSlack: CGFloat = 0,
        pageBounds: CGRect
    ) -> TextFitPlan {

        func height(_ size: CGFloat, width: CGFloat) -> CGFloat {
            let attributes: [NSAttributedString.Key: Any] = [.font: fontProvider(size)]
            return ceil((text as NSString).boundingRect(
                with: CGSize(width: width, height: .greatestFiniteMagnitude),
                options: [.usesLineFragmentOrigin, .usesFontLeading],
                attributes: attributes
            ).height)
        }

        let width = bounds.width
        let tolerance: CGFloat = 1.5

        // 1. Does it already fit? Most blocks do — translation often shortens.
        let naturalHeight = height(sourceFontSize, width: width)
        if naturalHeight <= bounds.height + tolerance {
            return TextFitPlan(bounds: bounds, fontSize: sourceFontSize,
                               strategy: .unchanged, scale: 1)
        }

        // 2. Grow downward into genuinely empty space. Costs no legibility.
        if verticalSlack > 1 {
            let grown = min(naturalHeight, bounds.height + verticalSlack)
            if naturalHeight <= grown + tolerance {
                var expanded = bounds
                // PDF origin is bottom-left: growing downward lowers minY.
                expanded.origin.y = max(pageBounds.minY, bounds.maxY - grown)
                expanded.size.height = grown
                return TextFitPlan(bounds: expanded, fontSize: sourceFontSize,
                                   strategy: .grewIntoSlack, scale: 1)
            }
        }

        // 3. Shrink — but search for the LARGEST size that fits rather than
        //    stepping down blindly past it.
        var low = sourceFontSize * hardFloor
        var high = sourceFontSize
        for _ in 0..<12 {
            let mid = (low + high) / 2
            if height(mid, width: width) <= bounds.height + tolerance {
                low = mid
            } else {
                high = mid
            }
            if high - low < 0.05 { break }
        }
        let fitted = max(sourceFontSize * hardFloor, low)
        let scale = fitted / sourceFontSize
        let fits = height(fitted, width: width) <= bounds.height + tolerance

        return TextFitPlan(
            bounds: bounds,
            fontSize: fitted,
            strategy: !fits ? .overflowed : (scale >= comfortableFloor ? .shrunk : .shrunkHard),
            scale: scale
        )
    }

    /// Vertical gap between a block and whatever sits directly beneath it.
    /// Only blocks that horizontally overlap can collide, so a caption beside
    /// a figure doesn't steal the paragraph's slack.
    static func verticalSlack(for block: CGRect, among others: [CGRect], pageBounds: CGRect) -> CGFloat {
        var nearestTop = pageBounds.minY
        for other in others {
            guard other != block else { continue }
            let overlapsHorizontally = other.maxX > block.minX + 1 && other.minX < block.maxX - 1
            guard overlapsHorizontally, other.maxY <= block.minY + 1 else { continue }
            nearestTop = max(nearestTop, other.maxY)
        }
        // Leave a hairline so text never kisses the block below.
        return max(0, block.minY - nearestTop - 2)
    }
}
