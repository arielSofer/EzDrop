"""Document structure analysis for the general PDF translator.

Turns a fixed-layout PDF page into an ORDERED list of typed blocks — the
semantic structure a PDF throws away. Downstream, prose blocks get
translated and re-typeset while figure/table/formula blocks are embedded
verbatim from the original, in correct reading order.

Uses PyMuPDF (fitz): real font data (name/size/bold/serif), exact image and
vector-drawing regions, and column-aware reading order. No ML, deterministic.
"""

import sys
import fitz  # PyMuPDF

# Span flags (PyMuPDF): bit0 superscript, bit1 italic, bit2 serif,
# bit3 monospace, bit4 bold.
FLAG_ITALIC = 1 << 1
FLAG_BOLD = 1 << 4

# Math / notation glyphs that mark a block as a formula rather than prose.
MATH_CHARS = set(
    "∈∉ℝℕℤℚℂ⇒⇐⇑⇓⇔↦→←↑↓↕↖↗↘↙∀∃∑∏∫≃≅≈≪≫≠≤≥⊤⊥∥×÷√∇∂λΣΠ⊗⊕⊖⊙∘∗†‖⟨⟩∅∞∝∼⋅𝟙"
)


def _span_stats(block):
    """Dominant size, bold fraction, italic fraction, text of a text block."""
    sizes = {}
    total = bold = italic = 0
    parts = []
    for line in block.get("lines", []):
        line_text = "".join(s["text"] for s in line["spans"])
        parts.append(line_text)
        for s in line["spans"]:
            n = max(1, len(s["text"].strip()))
            sizes[round(s["size"], 1)] = sizes.get(round(s["size"], 1), 0) + n
            total += n
            if s["flags"] & FLAG_BOLD:
                bold += n
            if s["flags"] & FLAG_ITALIC:
                italic += n
    dom_size = max(sizes, key=sizes.get) if sizes else 0.0
    text = _join_hyphenated(parts)
    return {
        "size": dom_size,
        "bold_frac": bold / max(1, total),
        "italic_frac": italic / max(1, total),
        "text": text,
    }


def _join_hyphenated(lines):
    out = ""
    for line in lines:
        line = line.strip()
        if not line:
            continue
        if out.endswith("-") and line[:1].islower():
            out = out[:-1] + line
        elif out:
            out += " " + line
        else:
            out = line
    return out


def _classify(stats, bbox, page_rect, body_size):
    """Return a block type from font + geometry cues (general, not book-specific)."""
    text = stats["text"].strip()
    if not text:
        return "empty"
    page_h = page_rect.height
    non_space = max(1, len(text.replace(" ", "")))
    letters = sum(ch.isalpha() for ch in text)
    letter_frac = letters / max(1, len(text))
    math_count = sum(ch in MATH_CHARS for ch in text)
    math_frac = math_count / non_space
    words = len(text.split())

    # Formula: symbol-DENSE (not merely containing a few inline symbols — a
    # prose paragraph mentioning x and y stays prose and masks them later).
    is_dense_math = letter_frac < 0.45 or math_frac > 0.18
    is_short_equation = ("=" in text) and words <= 8 and letter_frac < 0.7
    if is_dense_math or is_short_equation:
        return "formula"
    # Running header / footer: a short line hugging the top/bottom edge.
    top_edge = bbox[1] < page_h * 0.09
    bottom_edge = bbox[3] > page_h * 0.92
    if (top_edge or bottom_edge) and words <= 14:
        return "furniture"
    # Heading / title: notably larger than body, or bold and short.
    if stats["size"] >= body_size * 1.18 and words <= 20:
        return "heading"
    if stats["bold_frac"] > 0.6 and words <= 12:
        return "heading"
    # Caption: smaller than body (figure/table labels, margin notes).
    if stats["size"] <= body_size * 0.92 and words <= 45:
        return "caption"
    return "body"


def analyze_page(page):
    raw = page.get_text("dict")
    page_rect = page.rect
    blocks = []

    # Body size = the most common text size across the page, weighted by text.
    size_weight = {}
    for b in raw["blocks"]:
        if b.get("type") != 0:
            continue
        st = _span_stats(b)
        if st["text"].strip():
            size_weight[st["size"]] = size_weight.get(st["size"], 0) + len(st["text"])
    body_size = max(size_weight, key=size_weight.get) if size_weight else 10.0

    for b in raw["blocks"]:
        bbox = tuple(b["bbox"])
        if b.get("type") == 1:  # image
            blocks.append({"type": "figure", "bbox": bbox, "text": ""})
            continue
        st = _span_stats(b)
        if not st["text"].strip():
            continue
        kind = _classify(st, bbox, page_rect, body_size)
        blocks.append({
            "type": kind, "bbox": bbox, "text": st["text"],
            "size": st["size"], "bold": st["bold_frac"] > 0.6,
        })

    # Vector-drawing regions (charts/diagrams with no image XObject).
    text_rects = [fitz.Rect(b["bbox"]) for b in blocks
                  if b["type"] in ("body", "heading", "caption")]
    for fig in _drawing_figures(page, text_rects):
        blocks.append({"type": "figure", "bbox": fig, "text": ""})

    # Merge same-line fragments (inline-math fonts split a line into pieces),
    # then assemble paragraphs so translation gets whole units.
    columns = _columns(blocks, page_rect)
    ordered = _reading_order(blocks, columns)
    ordered = _merge_line_fragments(ordered)
    ordered = _assemble_paragraphs(ordered)
    return {
        "page_width": page_rect.width,
        "page_height": page_rect.height,
        "body_size": body_size,
        "blocks": ordered,
    }


def _drawing_figures(page, text_rects, min_area_frac=0.015, min_paths=4):
    """Dense vector-drawing clusters (plots, diagrams) — clipped to the page,
    rule/underline paths excluded, and never overlapping real text."""
    page_rect = page.rect
    rects = []
    for d in page.get_drawings():
        r = fitz.Rect(d["rect"]) & page_rect  # clip to page bounds
        if r.is_empty or r.width < 3 or r.height < 3:
            continue
        aspect = max(r.width, r.height) / max(1.0, min(r.width, r.height))
        if aspect > 12:  # horizontal rules, underlines, axes — not figures
            continue
        rects.append(r)
    if not rects:
        return []
    # Cluster by proximity; track how many source paths each cluster holds.
    clusters = []  # (rect, path_count)
    pad = page_rect.width * 0.02
    for r in rects:
        for i, (c, n) in enumerate(clusters):
            if _near(c, r, pad):
                clusters[i] = ((c | r) & page_rect, n + 1)
                break
        else:
            clusters.append((r, 1))
    # A real figure is a dense cluster (many paths) of meaningful area that
    # doesn't sit on top of body text.
    page_area = page_rect.width * page_rect.height
    figures = []
    for c, n in clusters:
        if n < min_paths or c.get_area() < page_area * min_area_frac:
            continue
        if any((c & t).get_area() > 0.35 * t.get_area() for t in text_rects):
            continue  # overlaps a text block — false cluster
        figures.append(tuple(c))
    return figures


def _near(a, b, pad):
    return fitz.Rect(a.x0 - pad, a.y0 - pad, a.x1 + pad, a.y1 + pad).intersects(b)


def _merge_line_fragments(blocks):
    """Concatenate blocks that share a baseline in the same column (a single
    visual line the extractor split at inline-math font boundaries)."""
    out = []
    for b in blocks:
        if b["type"] == "figure" or not out:
            out.append(b)
            continue
        prev = out[-1]
        if prev["type"] == "figure" or prev.get("_col") != b.get("_col"):
            out.append(b)
            continue
        py0, py1 = prev["bbox"][1], prev["bbox"][3]
        y0, y1 = b["bbox"][1], b["bbox"][3]
        overlap = min(py1, y1) - max(py0, y0)
        same_line = overlap > 0.5 * min(py1 - py0, y1 - y0)
        if same_line:
            prev["text"] = (prev["text"].rstrip() + " " + b["text"].lstrip()).strip()
            prev["bbox"] = _union(prev["bbox"], b["bbox"])
            # A line that mixes prose and inline math is prose overall.
            if b["type"] == "body" or prev["type"] == "body":
                prev["type"] = "body"
        else:
            out.append(b)
    return out


def _assemble_paragraphs(blocks):
    """Merge consecutive continuation blocks in a column into one paragraph:
    small vertical gap AND the previous block doesn't end a sentence."""
    out = []
    for b in blocks:
        if b["type"] not in ("body", "formula") or not out:
            out.append(b)
            continue
        prev = out[-1]
        if (prev["type"] not in ("body", "formula")
                or prev.get("_col") != b.get("_col")):
            out.append(b)
            continue
        gap = b["bbox"][1] - prev["bbox"][3]
        line_h = b["bbox"][3] - b["bbox"][1]
        prev_text = prev["text"].rstrip()
        ends_sentence = prev_text[-1:] in ".:!?;" if prev_text else False
        starts_list = b["text"].lstrip()[:2].strip().rstrip(".").isdigit()
        if gap < line_h * 1.2 and not ends_sentence and not starts_list:
            prev["text"] = (prev_text + " " + b["text"].lstrip()).strip()
            prev["bbox"] = _union(prev["bbox"], b["bbox"])
            if b["type"] == "body":
                prev["type"] = "body"
        else:
            out.append(b)
    return out


def _union(a, b):
    return (min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3]))


def _columns(blocks, page_rect):
    """Greedy column bands from block x-intervals (body + margin, or N-column)."""
    text_blocks = [b for b in blocks if b["type"] not in ("figure", "furniture")]
    cols = []  # each: [x0, x1]
    for b in sorted(text_blocks, key=lambda b: b["bbox"][0]):
        x0, x1 = b["bbox"][0], b["bbox"][2]
        for c in cols:
            overlap = min(c[1], x1) - max(c[0], x0)
            if overlap > 0.35 * min(c[1] - c[0], x1 - x0):
                c[0], c[1] = min(c[0], x0), max(c[1], x1)
                break
        else:
            cols.append([x0, x1])
    cols.sort(key=lambda c: c[0])
    return cols


def _reading_order(blocks, columns):
    def col_index(b):
        cx = (b["bbox"][0] + b["bbox"][2]) / 2
        best, bd = 0, 1e9
        for i, c in enumerate(columns):
            d = 0 if c[0] <= cx <= c[1] else min(abs(cx - c[0]), abs(cx - c[1]))
            if d < bd:
                best, bd = i, d
        return best

    # Full-width blocks (titles, wide figures) break the column flow: order by
    # y first, then column. Approximate with (band, column, y).
    for b in blocks:
        b["_col"] = col_index(b)
        b["_y"] = b["bbox"][1]
    # Within a column, top-to-bottom; ties (same visual line) left-to-right.
    return sorted(blocks, key=lambda b: (b["_col"], round(b["_y"] / 3), b["bbox"][0]))


# ---- debug overlay -------------------------------------------------------

TYPE_COLOR = {
    "heading": (0.85, 0.1, 0.1),
    "body": (0.1, 0.3, 0.9),
    "caption": (0.1, 0.65, 0.2),
    "formula": (0.8, 0.1, 0.8),
    "figure": (0.95, 0.55, 0.05),
    "furniture": (0.5, 0.5, 0.5),
    "empty": (0.7, 0.7, 0.7),
}


def render_debug(pdf_path, page_index, out_path):
    doc = fitz.open(pdf_path)
    page = doc[page_index]
    result = analyze_page(page)
    for i, b in enumerate(result["blocks"]):
        color = TYPE_COLOR.get(b["type"], (0, 0, 0))
        rect = fitz.Rect(b["bbox"])
        page.draw_rect(rect, color=color, width=1.2)
        label = f"{i}:{b['type'][:4]}"
        page.insert_text((rect.x0 + 1, rect.y0 + 8), label, fontsize=7, color=color)
    pix = page.get_pixmap(matrix=fitz.Matrix(1.6, 1.6))
    pix.save(out_path)
    counts = {}
    for b in result["blocks"]:
        counts[b["type"]] = counts.get(b["type"], 0) + 1
    print(f"page {page_index + 1}: {len(result['blocks'])} blocks, body_size={result['body_size']:.1f}, {counts}")
    print("saved", out_path)


if __name__ == "__main__":
    render_debug(sys.argv[1], int(sys.argv[2]), sys.argv[3])
