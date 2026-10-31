import PDFKit
import Foundation
let doc = PDFDocument(url: URL(fileURLWithPath: "/Users/ariel/Downloads/mml-book.pdf"))!
let corpus = [12, 20, 22, 30, 45, 60, 88, 120, 200]
func run(_ name: String, _ fn: (PDFPage) -> [Block]) {
    var integ = 0.0, usable = 0, total = 0, blocks = 0
    let t0 = Date()
    for idx in corpus {
        guard let page = doc.page(at: idx) else { continue }
        let b = fn(page)
        let (i, u, t, c) = Metrics.report(name, blocks: b, page: page)
        integ += i; usable += u; total += t; blocks += c
    }
    let ms = Int(Date().timeIntervalSince(t0) * 1000 / Double(corpus.count))
    print("\(name.padding(toLength: 10, withPad: " ", startingAt: 0)) integrity \(Int(integ/Double(corpus.count)*100))%   usable \(usable)/\(total)   blocks \(blocks)   \(ms)ms/page")
}
run("BASELINE", Baseline.blocks)
run("HYBRID", Hybrid.blocks)
run("VISION", VisionStrategy.blocks)
