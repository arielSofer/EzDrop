# PDF extraction harness

Compares text-extraction strategies on a real corpus before any of them is
allowed near the app. Built because three separate "obvious" improvements to
the extractor were each measured to be WORSE than what production already does.

## Run

    DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
      swiftc -O Harness.swift Candidate.swift Hybrid.swift VisionStrat.swift main.swift -o run && ./run

## Metrics

- **word integrity** — share of the page's own words that survive extraction
  intact. This is the decisive one: an extractor can produce beautiful
  paragraph counts while splitting "published" into "blished".
- **usable blocks** — substantial blocks (≥6 words) that end in sentence
  punctuation. This is exactly the gate the translation filter applies, so it
  predicts real coverage.

## Results on mml-book.pdf (9 pages spanning prose / dense maths / figures)

| strategy  | integrity | usable  | blocks |
|-----------|-----------|---------|--------|
| BASELINE (`selectionsByLine` + geometric splits, i.e. production) | 99% | 45/148 | 426 |
| GLYPH (rebuild lines from `characterBounds`) | 84% | 3/133 | 227 |
| HYBRID (PDFKit lines + baseline-based grouping) | 99% | 32/101 | 254 |
| VISION (`VNRecognizeTextRequest` geometry, 327ms/page) | 88% | 31/108 | 226 |

**Conclusion: production wins.** PDFKit's line extraction is excellent at word
integrity; its weakness is only paragraph grouping, and every grouping rewrite
tried so far trades away more coverage than it gains.

Anything new should be added as another strategy here and only shipped if it
beats BASELINE on both columns.

## Vision / ML layout detection — evaluated, rejected

`VNDetectDocumentSegmentationRequest` returns ONE box covering the whole page
(0.99 x 0.98). It finds a document inside a photo; it does not decompose layout.

`VNRecognizeTextRequest` does give independent line geometry — an inline formula
does not inflate its boxes the way PDFKit's does — but it must OCR a rendered
image, so it reintroduces recognition error (88% word integrity) and costs
327ms/page against 7ms. Reading text we already have exactly is a downgrade.

A real layout model (DocLayout-YOLO class, what BabelDOC uses) would need
PyTorch + ~2-3GB of weights, or a Core ML conversion. Given that the ceiling
being chased is ~45 usable blocks per 9 pages, that dependency is not justified
unless scientific-document translation becomes a primary product direction.
