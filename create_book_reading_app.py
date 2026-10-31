import json
import uuid
from pathlib import Path


OUT = Path("SavedProjects/AsterReader-BookApp-FullLogic.agenticdesign")


def uid():
    return str(uuid.uuid4()).upper()


def shadow(color="#000000", opacity=0.18, radius=18, x=0, y=10):
    return {"color": color, "opacity": opacity, "radius": radius, "x": x, "y": y}


def gradient(colors, angle=135, kind="linear"):
    return {"type": kind, "colors": colors, "angle": angle}


def style(
    fill="#FFFFFF",
    corner=0,
    opacity=1,
    text=None,
    font_size=None,
    font_weight=None,
    align=None,
    stroke=None,
    stroke_width=None,
    line_height=None,
    grad=None,
    sh=None,
):
    data = {"fill": fill, "cornerRadius": corner, "opacity": opacity}
    if text is not None:
        data["textColor"] = text
    if font_size is not None:
        data["fontSize"] = font_size
    if font_weight is not None:
        data["fontWeight"] = font_weight
    if align is not None:
        data["textAlign"] = align
    if stroke is not None:
        data["stroke"] = stroke
        data["strokeWidth"] = stroke_width if stroke_width is not None else 1
    if line_height is not None:
        data["lineHeight"] = line_height
    if grad is not None:
        data["gradient"] = grad
    if sh is not None:
        data["shadow"] = sh
    return data


def node(kind, name, x, y, w, h, st=None, **extra):
    data = {
        "id": extra.pop("id", uid()),
        "type": kind,
        "name": name,
        "x": x,
        "y": y,
        "width": w,
        "height": h,
        "style": st or style(),
        "children": extra.pop("children", []),
        "clipContent": extra.pop("clip", False),
        "manuallyPositioned": True,
        "zIndex": extra.pop("z", 0),
    }
    data.update(extra)
    return data


def text(name, value, x, y, w, h, size, color, weight="regular", align=None, line=None, max_lines=None, node_id=None):
    extra = {"text": value}
    if max_lines is not None:
        extra["textBehavior"] = {"wrap": True, "autoHeight": False, "maxLines": max_lines, "truncate": False}
    return node(
        "Text",
        name,
        x,
        y,
        w,
        h,
        style("#FFFFFF", text=color, font_size=size, font_weight=weight, align=align, line_height=line),
        id=node_id or uid(),
        **extra,
    )


def button(name, label, x, y, w, h, fill, color="#FFFFFF", corner=18, size=15, weight="semibold", node_id=None, sh=None, stroke=None):
    return node(
        "Button",
        name,
        x,
        y,
        w,
        h,
        style(fill, corner=corner, text=color, font_size=size, font_weight=weight, align="center", sh=sh, stroke=stroke),
        id=node_id or uid(),
        text=label,
    )


def input_node(name, placeholder, x, y, w, h, fill, color="#171616", corner=16, size=14, node_id=None, variable=None, stroke=None):
    extra = {"text": placeholder}
    if variable:
        extra["logicBindings"] = [{"id": uid(), "kind": "value", "variableName": variable}]
    return node(
        "Input",
        name,
        x,
        y,
        w,
        h,
        style(fill, corner=corner, text=color, font_size=size, font_weight="regular", stroke=stroke),
        id=node_id or uid(),
        **extra,
    )


def frame(
    name,
    x,
    y,
    w,
    h,
    fill,
    corner=0,
    children=None,
    node_id=None,
    clip=False,
    grad=None,
    sh=None,
    stroke=None,
    opacity=1,
    z=0,
    scroll_axis=None,
    scroll_offset=None,
    recycle_spacing=None,
    recycle_count=None,
):
    extra = {}
    if scroll_axis:
        behavior = {"axis": scroll_axis, "showsIndicators": True}
        if scroll_offset is not None:
            behavior["initialOffset"] = scroll_offset
        if recycle_spacing is not None:
            behavior["itemSpacing"] = recycle_spacing
        if recycle_count is not None:
            behavior["itemCount"] = recycle_count
        extra["scrollBehavior"] = behavior
        clip = True
    return node(
        "Frame",
        name,
        x,
        y,
        w,
        h,
        style(fill, corner=corner, grad=grad, sh=sh, stroke=stroke, opacity=opacity),
        id=node_id or uid(),
        children=children or [],
        clip=clip,
        z=z,
        **extra,
    )


def icon(name, sf, x, y, w, h, color, node_id=None):
    return node(
        "Icon",
        name,
        x,
        y,
        w,
        h,
        style("#00000000", text=color),
        id=node_id or uid(),
        iconName=sf,
    )


def cover(name, title, author, x, y, w, h, colors, accent="#FFFFFF", node_id=None):
    cid = node_id or uid()
    return frame(
        name,
        x,
        y,
        w,
        h,
        "#222222",
        corner=18,
        node_id=cid,
        clip=True,
        grad=gradient(colors, 145),
        sh=shadow("#000000", 0.24, 18, 0, 12),
        children=[
            frame(f"{name} Glow", w * 0.54, -12, w * 0.58, h * 0.5, accent, corner=60, opacity=0.14),
            text(f"{name} Title", title, 14, h * 0.48, w - 28, 48, 18, "#FFFFFF", "bold", line=21, max_lines=2),
            text(f"{name} Author", author, 14, h - 36, w - 28, 18, 10, "#FFFFFFCC", "medium"),
            frame(f"{name} Rule", 14, 18, 38, 3, accent, corner=2, opacity=0.72),
        ],
    )


def param(key, label, ptype, value=None, node_ref=None, variable=None, required=True, placeholder=None, options=None):
    data = {"id": uid(), "key": key, "label": label, "type": ptype, "isRequired": required}
    if value is not None:
        data["value"] = str(value)
    if node_ref is not None:
        data["nodeReference"] = node_ref
    if variable is not None:
        data["variableReference"] = variable
    if placeholder is not None:
        data["placeholder"] = placeholder
    if options is not None:
        data["options"] = options
    return data


def block(kind, category, label, x, y, params=None, connected=None, block_id=None):
    data = {
        "id": block_id or uid(),
        "type": kind,
        "category": category,
        "label": label,
        "x": x,
        "y": y,
        "width": 200,
        "parameters": params or [],
        "isCollapsed": False,
    }
    if connected is not None:
        data["connectedDesignNodeId"] = connected
    return data


def conn(a, b, source_port=0, target_port=0):
    return {"id": uid(), "sourceBlockId": a["id"], "sourcePortIndex": source_port, "targetBlockId": b["id"], "targetPortIndex": target_port}


def tap_flow(name, element_id, screen_id, steps):
    blocks = [
        block(
            "onTap",
            "Events",
            f"Tap {name}",
            40,
            40,
            [param("element", "Element", "nodeReference", node_ref=element_id, placeholder="Select a button or element...")],
            connected=element_id,
        )
    ]
    x = 300
    for step in steps:
        kind = step["type"]
        if kind == "hapticFeedback":
            params = [param("style", "Style", "dropdown", step.get("style", "light"), options=["light", "medium", "heavy", "success", "warning", "error"])]
            cat = "Actions"
        elif kind == "navigate":
            params = [param("screen", "Screen", "screenReference", node_ref=step["screen"])]
            cat = "Actions"
        elif kind == "showToast":
            params = [param("message", "Message", "string", step["message"])]
            cat = "Actions"
        elif kind == "setText":
            params = [param("element", "Element", "nodeReference", node_ref=step["element"]), param("text", "Text", "string", step["text"])]
            cat = "UI Updates"
        elif kind == "setColor":
            params = [
                param("element", "Element", "nodeReference", node_ref=step["element"]),
                param("property", "Property", "dropdown", step.get("property", "fill"), options=["fill", "textColor", "stroke"]),
                param("color", "Color", "color", step["color"]),
            ]
            cat = "UI Updates"
        elif kind == "setVisible":
            params = [param("element", "Element", "nodeReference", node_ref=step["element"]), param("visible", "Visible", "boolean", step["visible"])]
            cat = "UI Updates"
        elif kind == "animate":
            params = [
                param("element", "Element", "nodeReference", node_ref=step["element"]),
                param("property", "Property", "dropdown", step.get("property", "opacity"), options=["opacity", "scale", "x", "y", "width", "height", "cornerRadius"]),
                param("to", "To Value", "string", step["to"]),
                param("duration", "Duration (s)", "number", step.get("duration", "0.3")),
            ]
            cat = "UI Updates"
        elif kind == "setVariable":
            params = [param("variable", "Variable", "variable", variable=step["variable"]), param("value", "Value", "string", step["value"])]
            cat = "Variables"
        elif kind in {"incrementVariable", "decrementVariable"}:
            params = [param("variable", "Variable", "variable", variable=step["variable"]), param("amount", "Amount", "number", step.get("amount", "1"))]
            cat = "Variables"
        elif kind == "appendToArray":
            params = [param("array", "Array", "variable", variable=step["array"]), param("value", "Value", "string", step["value"])]
            cat = "Variables"
        elif kind == "saveValue":
            params = [param("key", "Key", "string", step["key"]), param("value", "Value", "string", step["value"])]
            cat = "Actions"
        elif kind == "copyToClipboard":
            params = [param("text", "Text", "string", step["text"])]
            cat = "Actions"
        elif kind == "shareContent":
            params = [param("text", "Text", "string", step.get("text", ""), required=False), param("url", "URL", "url", step.get("url", ""), required=False)]
            cat = "Actions"
        elif kind == "clearField":
            params = [param("element", "Field", "nodeReference", node_ref=step["element"])]
            cat = "Actions"
        else:
            raise ValueError(kind)
        blocks.append(block(kind, cat, step.get("label", kind), x, 40, params))
        x += 260
    return {
        "id": uid(),
        "name": name,
        "screenNodeId": screen_id,
        "variables": [],
        "blocks": blocks,
        "connections": [conn(blocks[i], blocks[i + 1]) for i in range(len(blocks) - 1)],
    }


def submit_flow(name, element_id, screen_id, steps):
    flow = tap_flow(name, element_id, screen_id, steps)
    event = flow["blocks"][0]
    event["type"] = "onSubmit"
    event["label"] = f"Submit {name}"
    return flow


def search_validation_flow(name, event_type, element_id, screen_id):
    event = block(
        event_type,
        "Events",
        f"{'Submit' if event_type == 'onSubmit' else 'Tap'} {name}",
        40,
        40,
        [param("element", "Element" if event_type == "onTap" else "Input", "nodeReference", node_ref=element_id, placeholder="Search input...")],
        connected=element_id,
    )
    validate = block(
        "validateForm",
        "Actions",
        "Validate search text",
        300,
        40,
        [
            param("element", "Field", "nodeReference", node_ref=ids["search_input"], placeholder="Select an input..."),
            param("rule", "Rule", "dropdown", "notEmpty", options=["notEmpty", "email", "minLength", "matchesRegex"]),
            param("argument", "Argument", "string", "", required=False),
        ],
    )
    set_status = block(
        "setText",
        "UI Updates",
        "Show search results",
        560,
        20,
        [
            param("element", "Element", "nodeReference", node_ref=ids["search_status"]),
            param("text", "Text", "string", "Showing saved passages and books for “{{searchQuery}}”"),
        ],
    )
    remember = block(
        "saveValue",
        "Actions",
        "Persist last search",
        820,
        20,
        [param("key", "Key", "string", "aster.lastSearch"), param("value", "Value", "string", "{{searchQuery}}")],
    )
    valid_toast = block(
        "showToast",
        "Actions",
        "Search toast",
        1080,
        20,
        [param("message", "Message", "string", "Search updated")],
    )
    invalid = block(
        "showToast",
        "Actions",
        "Empty search toast",
        560,
        150,
        [param("message", "Message", "string", "Type a title, author, or note first")],
    )
    blocks = [event, validate, set_status, remember, valid_toast, invalid]
    return {
        "id": uid(),
        "name": name,
        "screenNodeId": screen_id,
        "variables": [],
        "blocks": blocks,
        "connections": [
            conn(event, validate),
            conn(validate, set_status, 0),
            conn(set_status, remember),
            conn(remember, valid_toast),
            conn(validate, invalid, 1),
        ],
    }


def save_note_flow():
    event = block(
        "onTap",
        "Events",
        "Tap Save Note",
        40,
        40,
        [param("element", "Element", "nodeReference", node_ref=ids["save_note"], placeholder="Select a button or element...")],
        connected=ids["save_note"],
    )
    validate = block(
        "validateForm",
        "Actions",
        "Validate note",
        300,
        40,
        [
            param("element", "Field", "nodeReference", node_ref=ids["note_input"], placeholder="Select an input..."),
            param("rule", "Rule", "dropdown", "notEmpty", options=["notEmpty", "email", "minLength", "matchesRegex"]),
            param("argument", "Argument", "string", "", required=False),
        ],
    )
    append = block("appendToArray", "Variables", "Append note", 560, 20, [
        param("array", "Array", "variable", variable="notes"),
        param("value", "Value", "string", "{{draftNote}}"),
    ])
    persist = block("saveValue", "Actions", "Persist latest note", 820, 20, [
        param("key", "Key", "string", "aster.latestNote"),
        param("value", "Value", "string", "{{draftNote}}"),
    ])
    set_note = block("setText", "UI Updates", "Reflect saved note", 1080, 20, [
        param("element", "Element", "nodeReference", node_ref=ids["note_text"]),
        param("text", "Text", "string", "Saved: {{draftNote}}"),
    ])
    set_count = block("setText", "UI Updates", "Update note count", 1340, 20, [
        param("element", "Element", "nodeReference", node_ref=ids["notes_count"]),
        param("text", "Text", "string", "8"),
    ])
    set_sync = block("setText", "UI Updates", "Update sync state", 1600, 20, [
        param("element", "Element", "nodeReference", node_ref=ids["sync_status"]),
        param("text", "Text", "string", "Last sync: just now"),
    ])
    clear = block("clearField", "Actions", "Clear draft", 1860, 20, [
        param("element", "Field", "nodeReference", node_ref=ids["note_input"]),
    ])
    toast = block("showToast", "Actions", "Note saved toast", 2120, 20, [
        param("message", "Message", "string", "Note saved locally"),
    ])
    invalid = block("showToast", "Actions", "Empty note toast", 560, 160, [
        param("message", "Message", "string", "Write a note before saving"),
    ])
    blocks = [event, validate, append, persist, set_note, set_count, set_sync, clear, toast, invalid]
    return {
        "id": uid(),
        "name": "Save Reading Note",
        "screenNodeId": ids["reader"],
        "variables": [],
        "blocks": blocks,
        "connections": [
            conn(event, validate),
            conn(validate, append, 0),
            conn(append, persist),
            conn(persist, set_note),
            conn(set_note, set_count),
            conn(set_count, set_sync),
            conn(set_sync, clear),
            conn(clear, toast),
            conn(validate, invalid, 1),
        ],
    }


ids = {
    "library": uid(),
    "discover": uid(),
    "detail": uid(),
    "reader": uid(),
    "continue": uid(),
    "glass_card": uid(),
    "discover_tab": uid(),
    "library_tab_discover": uid(),
    "library_tab_detail": uid(),
    "library_tab_reader": uid(),
    "discover_book": uid(),
    "detail_start": uid(),
    "detail_bookmark": uid(),
    "detail_back": uid(),
    "reader_back": uid(),
    "reader_bookmark": uid(),
    "reader_theme": uid(),
    "reader_note": uid(),
    "font_plus": uid(),
    "font_minus": uid(),
    "bookmark_label": uid(),
    "bookmark_pill": uid(),
    "reader_title": uid(),
    "reader_bg": uid(),
    "reader_panel": uid(),
    "reader_passage": uid(),
    "font_value": uid(),
    "reader_state": uid(),
    "note_sheet": uid(),
    "note_text": uid(),
    "note_input": uid(),
    "save_note": uid(),
    "progress_label": uid(),
    "search_input": uid(),
    "search_button": uid(),
    "search_status": uid(),
    "reader_next": uid(),
    "reader_prev": uid(),
    "copy_quote": uid(),
    "share_quote": uid(),
    "notes_count": uid(),
    "sync_status": uid(),
}


def bottom_nav(active):
    items = [
        ("Library", "books.vertical.fill", ids[f"library_tab_{active}"] if active in {"discover", "detail", "reader"} else None, "#D9AF62" if active == "library" else "#7D828C"),
        ("Discover", "safari.fill", ids["discover_tab"] if active == "library" else None, "#D9AF62" if active == "discover" else "#7D828C"),
        ("Reader", "text.book.closed.fill", None, "#D9AF62" if active == "reader" else "#7D828C"),
    ]
    children = [frame("Bottom Nav Glass", 18, 0, 354, 62, "#191B20E8", corner=25, stroke="#FFFFFF18", sh=shadow("#000000", 0.25, 20, 0, -6))]
    for index, (label, sf, nav_id, color) in enumerate(items):
        x = 48 + index * 108
        if nav_id:
            children.append(button(f"{label} Nav Hit", "", x - 22, 8, 72, 46, "#00000000", corner=22, node_id=nav_id))
        children.append(icon(f"{label} Icon", sf, x, 13, 22, 22, color))
        children.append(text(f"{label} Label", label, x - 22, 38, 66, 16, 10, color, "medium", align="center"))
    return frame("Bottom Navigation", 0, 764, 390, 80, "#00000000", children=children, z=20)


library_children = [
    text("Library Eyebrow", "ASTER", 24, 58, 120, 18, 12, "#D9AF62", "bold"),
    text("Library Title", "Your quiet shelf", 24, 80, 260, 40, 31, "#F5F0E8", "bold"),
    icon("Profile Icon", "person.crop.circle", 338, 72, 30, 30, "#F5F0E8"),
    frame("Search Field", 24, 132, 342, 46, "#202228", corner=18, stroke="#FFFFFF12", children=[
        icon("Search Icon", "magnifyingglass", 16, 13, 18, 18, "#9AA0AA"),
        input_node("Search Input", "Search books, authors, notes", 40, 6, 242, 34, "#00000000", "#EDEAE5", corner=14, node_id=ids["search_input"], variable="searchQuery"),
        button("Search Button", "Go", 288, 7, 42, 32, "#D9AF62", "#171616", corner=16, size=12, node_id=ids["search_button"]),
    ]),
    text("Search Status", "Search your shelf, notes, and saved passages", 28, 184, 286, 18, 12, "#8E95A1", "medium", node_id=ids["search_status"]),
    frame("Continue Card", 24, 210, 342, 172, "#EFE7DA", corner=26, node_id=ids["continue"], clip=True, sh=shadow("#000000", 0.22, 24, 0, 16), children=[
        frame("Continue Glow", 236, -38, 128, 128, "#D9AF62", corner=64, opacity=0.18),
        cover("Continue Cover", "The\nafterlight", "M. Vale", 18, 26, 92, 120, ["#162027", "#526B61", "#D9AF62"], "#F2DFAE"),
        text("Continue Label", "Continue reading", 130, 26, 160, 20, 12, "#8A6230", "bold"),
        text("Continue Book", "The Afterlight", 130, 52, 160, 25, 21, "#171616", "bold"),
        text("Continue Meta", "Page 128 of 302", 130, 82, 160, 18, 13, "#665F57", "medium"),
        frame("Progress Track", 130, 116, 176, 7, "#D4CAB9", corner=4),
        frame("Progress Fill", 130, 116, 92, 7, "#171616", corner=4),
        text("Progress Label", "42%", 312, 110, 34, 20, 12, "#171616", "bold", node_id=ids["progress_label"]),
    ]),
    text("Shelf Heading", "New on your shelf", 24, 410, 220, 26, 22, "#F5F0E8", "bold"),
    button("View All Button", "View all", 294, 409, 72, 28, "#FFFFFF12", "#EAE6DF", corner=14, size=12),
    frame(
        "Horizontal Shelf Recycler",
        24,
        450,
        342,
        164,
        "#00000000",
        children=[
            cover("Glass Atlas Card", "The\nGlass Atlas", "Iris Chen", 0, 0, 104, 158, ["#213555", "#4F709C", "#D8C4B6"], "#F5EFE7", node_id=ids["glass_card"]),
            cover("Winter Index Card", "Winter\nIndex", "S. Okafor", 120, 0, 104, 158, ["#10251F", "#2E6F5F", "#E9B44C"], "#F6D365"),
            cover("Paper Cities Card", "Paper\nCities", "Noa Kline", 240, 0, 104, 158, ["#3F1D38", "#A26769", "#F4D35E"], "#F4D35E"),
            cover("Mercury Garden Rail Card", "Mercury\nGardens", "Lena Rios", 360, 0, 104, 158, ["#342A45", "#7F5A83", "#F7A072"], "#F7A072"),
            cover("Quiet Machines Rail Card", "Quiet\nMachines", "A. Sato", 480, 0, 104, 158, ["#1E293B", "#64748B", "#C084FC"], "#C084FC"),
        ],
        scroll_axis="horizontal",
        recycle_spacing=16,
        recycle_count=5,
    ),
    text("Stats Heading", "Tonight's rhythm", 24, 636, 220, 24, 20, "#F5F0E8", "bold"),
    frame("Stats Card", 24, 668, 342, 74, "#202228", corner=20, stroke="#FFFFFF10", children=[
        text("Minutes Stat", "48m", 22, 18, 70, 24, 22, "#F5F0E8", "bold"),
        text("Minutes Label", "reading", 22, 45, 70, 14, 10, "#8E95A1", "medium"),
        text("Streak Stat", "12", 136, 18, 52, 24, 22, "#F5F0E8", "bold"),
        text("Streak Label", "day streak", 136, 45, 70, 14, 10, "#8E95A1", "medium"),
        text("Notes Stat", "7", 260, 18, 42, 24, 22, "#F5F0E8", "bold", node_id=ids["notes_count"]),
        text("Notes Label", "notes", 260, 45, 52, 14, 10, "#8E95A1", "medium"),
        text("Sync Status", "Last sync: local", 22, 61, 160, 12, 9, "#6F7681", "medium", node_id=ids["sync_status"]),
    ]),
    bottom_nav("library"),
]

discover_children = [
    text("Discover Eyebrow", "CURATED", 24, 58, 120, 18, 12, "#7CC6B2", "bold"),
    text("Discover Title", "Find the next atmosphere", 24, 80, 314, 70, 30, "#F7F4EF", "bold", line=34, max_lines=2),
    frame("Editorial Hero", 24, 164, 342, 214, "#1D2832", corner=30, clip=True, grad=gradient(["#0F1720", "#2A4D55", "#D9AF62"], 145), sh=shadow("#000000", 0.28, 26, 0, 16), children=[
        frame("Hero Sun", 244, -28, 134, 134, "#E9B44C", corner=67, opacity=0.28),
        text("Hero Label", "RAINY EVENING LIST", 24, 28, 170, 18, 11, "#F4D35E", "bold"),
        text("Hero Title", "Ten books that feel like a lamp in a window", 24, 58, 246, 72, 25, "#FFFFFF", "bold", line=28, max_lines=3),
        button("Hero Save Button", "Save list", 24, 146, 94, 36, "#FFFFFF", "#172026", corner=18, size=13),
    ]),
    frame("Genre Row", 24, 404, 342, 38, "#00000000", children=[
        button("Genre Fiction", "Fiction", 0, 0, 82, 34, "#F5F0E8", "#171616", corner=17, size=13),
        button("Genre Essays", "Essays", 94, 0, 76, 34, "#232B31", "#D5DBDE", corner=17, size=13),
        button("Genre SciFi", "Sci-fi", 182, 0, 72, 34, "#232B31", "#D5DBDE", corner=17, size=13),
        button("Genre Poetry", "Poetry", 266, 0, 76, 34, "#232B31", "#D5DBDE", corner=17, size=13),
    ]),
    text("Trending Heading", "Trending quietly", 24, 472, 220, 24, 21, "#F7F4EF", "bold"),
    frame(
        "Vertical Trending Recycler",
        24,
        510,
        342,
        218,
        "#00000000",
        children=[
            frame("Discover Book Card", 0, 0, 342, 116, "#20262C", corner=24, node_id=ids["discover_book"], stroke="#FFFFFF10", sh=shadow("#000000", 0.18, 18, 0, 10), children=[
                cover("Mercury Cover", "Mercury\nGardens", "Lena Rios", 18, 16, 70, 86, ["#342A45", "#7F5A83", "#F7A072"], "#F7A072"),
                text("Mercury Title", "Mercury Gardens", 108, 18, 180, 22, 18, "#FFFFFF", "bold"),
                text("Mercury Detail", "Botanical mystery, luminous prose", 108, 46, 190, 18, 12, "#9EA7AE", "medium"),
                text("Mercury Rating", "4.8  •  9h 12m", 108, 74, 130, 18, 12, "#D9AF62", "bold"),
                icon("Mercury Chevron", "chevron.right", 304, 44, 18, 18, "#9EA7AE"),
            ]),
            frame("Author Card", 0, 132, 342, 80, "#EFE7DA", corner=22, children=[
                frame("Author Avatar", 18, 16, 48, 48, "#4F709C", corner=24, grad=gradient(["#4F709C", "#7CC6B2"], 120)),
                text("Author Label", "Author spotlight", 84, 17, 180, 18, 12, "#8A6230", "bold"),
                text("Author Name", "Iris Chen on maps, memory, and unreliable cities", 84, 38, 226, 34, 14, "#171616", "semibold", line=17, max_lines=2),
            ]),
            frame("Essay Pick Card", 0, 228, 342, 96, "#20262C", corner=22, stroke="#FFFFFF10", children=[
                cover("Essay Pick Cover", "Small\nRituals", "D. Moore", 18, 14, 58, 68, ["#253237", "#5C6B73", "#E0FBFC"], "#E0FBFC"),
                text("Essay Pick Title", "Small Rituals", 96, 18, 180, 20, 17, "#FFFFFF", "bold"),
                text("Essay Pick Detail", "Essays for slow mornings", 96, 45, 180, 18, 12, "#9EA7AE", "medium"),
                text("Essay Pick Meta", "12 essays  •  saved by 2.4k", 96, 68, 180, 16, 11, "#D9AF62", "bold"),
            ]),
            frame("SciFi Pick Card", 0, 340, 342, 96, "#20262C", corner=22, stroke="#FFFFFF10", children=[
                cover("SciFi Pick Cover", "Orbital\nLetters", "N. Reyes", 18, 14, 58, 68, ["#0B132B", "#1C2541", "#5BC0BE"], "#5BC0BE"),
                text("SciFi Pick Title", "Orbital Letters", 96, 18, 180, 20, 17, "#FFFFFF", "bold"),
                text("SciFi Pick Detail", "Tender sci-fi in fragments", 96, 45, 190, 18, 12, "#9EA7AE", "medium"),
                text("SciFi Pick Meta", "4.7  •  6h 44m", 96, 68, 130, 16, 11, "#D9AF62", "bold"),
            ]),
        ],
        scroll_axis="vertical",
        recycle_spacing=16,
        recycle_count=4,
    ),
    bottom_nav("discover"),
]

detail_children = [
    button("Detail Back", "", 22, 58, 42, 42, "#FFFFFF14", "#FFFFFF", corner=21, node_id=ids["detail_back"]),
    icon("Detail Back Icon", "chevron.left", 34, 70, 18, 18, "#F5F0E8"),
    button("Detail Bookmark", "Save", 286, 60, 80, 38, "#EFE7DA", "#171616", corner=19, size=13, node_id=ids["detail_bookmark"]),
    cover("Detail Cover", "The\nGlass Atlas", "Iris Chen", 105, 128, 180, 250, ["#213555", "#4F709C", "#D8C4B6"], "#F5EFE7"),
    text("Detail Title", "The Glass Atlas", 36, 410, 318, 34, 29, "#F5F0E8", "bold", align="center"),
    text("Detail Author", "Iris Chen", 36, 449, 318, 22, 15, "#D9AF62", "medium", align="center"),
    frame("Meta Rail", 36, 492, 318, 64, "#202228", corner=20, stroke="#FFFFFF10", children=[
        text("Meta Rating", "4.9", 36, 14, 52, 22, 20, "#F5F0E8", "bold", align="center"),
        text("Meta Rating Label", "rating", 26, 39, 70, 14, 10, "#9299A3", "medium", align="center"),
        text("Meta Time", "8h", 132, 14, 52, 22, 20, "#F5F0E8", "bold", align="center"),
        text("Meta Time Label", "length", 122, 39, 70, 14, 10, "#9299A3", "medium", align="center"),
        text("Meta Pages", "302", 228, 14, 56, 22, 20, "#F5F0E8", "bold", align="center"),
        text("Meta Pages Label", "pages", 222, 39, 70, 14, 10, "#9299A3", "medium", align="center"),
    ]),
    text("Synopsis", "A cartographer inherits a book of impossible cities and finds her own childhood folded between the streets.", 36, 584, 318, 68, 15, "#D9D5CE", "regular", line=21, max_lines=3),
    frame("Bookmark Pill", 36, 666, 136, 34, "#FFFFFF12", corner=17, stroke="#FFFFFF10", node_id=ids["bookmark_pill"], children=[
        text("Bookmark Label", "Not saved yet", 14, 9, 108, 16, 12, "#D7D9DD", "medium", node_id=ids["bookmark_label"]),
    ]),
    button("Start Reading", "Start reading", 36, 720, 318, 52, "#D9AF62", "#171616", corner=22, size=16, weight="bold", node_id=ids["detail_start"], sh=shadow("#D9AF62", 0.28, 16, 0, 8)),
    bottom_nav("detail"),
]

reader_children = [
    frame("Reader Background Layer", 0, 0, 390, 844, "#F3EBDD", node_id=ids["reader_bg"]),
    button("Reader Back", "", 22, 50, 40, 40, "#1C1C1C10", "#171616", corner=20, node_id=ids["reader_back"]),
    icon("Reader Back Icon", "chevron.left", 34, 62, 16, 16, "#171616"),
    text("Reader Title", "The Afterlight", 78, 58, 190, 20, 14, "#655D52", "semibold", align="center", node_id=ids["reader_title"]),
    button("Reader Bookmark", "", 324, 50, 40, 40, "#1C1C1C10", "#171616", corner=20, node_id=ids["reader_bookmark"]),
    icon("Reader Bookmark Icon", "bookmark", 335, 61, 18, 18, "#171616"),
    frame("Reader Page Panel", 24, 112, 342, 528, "#FFF9EE", corner=26, node_id=ids["reader_panel"], sh=shadow("#5D5140", 0.14, 24, 0, 12), children=[
        text("Chapter Label", "CHAPTER 12", 26, 28, 120, 16, 11, "#A07235", "bold"),
        text("Chapter Title", "A street that remembered rain", 26, 54, 280, 58, 25, "#171616", "bold", line=29, max_lines=2),
        text("Reader Passage", "The city unfolded in the lamplight, not as streets but as sentences. Every window held a comma of gold. Mira pressed her thumb to the atlas and felt the page answer, soft as breath, with the name of a place she had never been and somehow missed.", 26, 132, 290, 258, 18, "#25211C", "regular", line=28, max_lines=9, node_id=ids["reader_passage"]),
        frame("Quote Mark", 26, 420, 42, 42, "#D9AF6222", corner=21, children=[text("Quote Glyph", "“", 9, 1, 24, 36, 36, "#A07235", "bold", align="center")]),
        text("Reader State", "Page 128  •  42%", 82, 430, 160, 18, 12, "#897B68", "medium", node_id=ids["reader_state"]),
        button("Reader Previous Page", "Prev", 26, 476, 82, 32, "#EEE2CD", "#5E4C33", corner=16, size=12, node_id=ids["reader_prev"]),
        button("Reader Next Page", "Next page", 220, 476, 96, 32, "#171616", "#FFFFFF", corner=16, size=12, node_id=ids["reader_next"]),
    ]),
    frame("Reader Toolbar", 24, 666, 342, 58, "#191B20", corner=24, sh=shadow("#000000", 0.2, 16, 0, 8), children=[
        button("Font Minus", "A-", 18, 12, 50, 34, "#FFFFFF12", "#F4EFE7", corner=17, size=14, node_id=ids["font_minus"]),
        text("Font Value", "18 pt", 82, 20, 52, 18, 12, "#B9BEC6", "medium", align="center", node_id=ids["font_value"]),
        button("Font Plus", "A+", 146, 12, 50, 34, "#FFFFFF12", "#F4EFE7", corner=17, size=14, node_id=ids["font_plus"]),
        button("Theme Toggle", "", 220, 12, 34, 34, "#FFFFFF12", corner=17, node_id=ids["reader_theme"]),
        icon("Theme Icon", "moon.fill", 229, 21, 16, 16, "#D9AF62"),
        button("Note Button", "", 278, 12, 34, 34, "#FFFFFF12", corner=17, node_id=ids["reader_note"]),
        icon("Note Icon", "square.and.pencil", 287, 21, 16, 16, "#D9AF62"),
    ]),
    frame("Reader Action Row", 24, 728, 342, 30, "#00000000", children=[
        button("Copy Quote", "Copy quote", 0, 0, 104, 30, "#17161618", "#5E4C33", corner=15, size=12, node_id=ids["copy_quote"]),
        button("Share Quote", "Share", 118, 0, 72, 30, "#17161618", "#5E4C33", corner=15, size=12, node_id=ids["share_quote"]),
        text("Reading Persist Hint", "Progress autosaves", 212, 7, 118, 16, 10, "#897B68", "medium", align="right"),
    ]),
    frame("Note Sheet", 34, 530, 322, 180, "#FFFFFF", corner=24, node_id=ids["note_sheet"], opacity=0.08, sh=shadow("#000000", 0.18, 20, 0, 10), children=[
        text("Note Sheet Title", "Reading note", 22, 18, 180, 22, 18, "#171616", "bold"),
        text("Note Text", "Write a thought from this passage.", 22, 48, 248, 20, 13, "#61584F", "regular", line=18, max_lines=1, node_id=ids["note_text"]),
        input_node("Draft Note Input", "Type a note...", 22, 78, 278, 42, "#F4F0EA", "#171616", corner=16, node_id=ids["note_input"], variable="draftNote", stroke="#E2D7C8"),
        button("Save Note Button", "Save note", 22, 132, 120, 30, "#171616", "#FFFFFF", corner=15, size=12, node_id=ids["save_note"]),
        text("Note Sheet Status", "Stored locally in notes", 156, 139, 130, 16, 10, "#8A8176", "medium", align="right"),
    ], z=10),
    bottom_nav("reader"),
]

screens = [
    frame("Library", 0, 0, 390, 844, "#121317", corner=40, node_id=ids["library"], clip=True, children=library_children),
    frame("Discover", 450, 0, 390, 844, "#0E1116", corner=40, node_id=ids["discover"], clip=True, children=discover_children),
    frame("Book Detail", 900, 0, 390, 844, "#121317", corner=40, node_id=ids["detail"], clip=True, children=detail_children),
    frame("Reader", 1350, 0, 390, 844, "#F3EBDD", corner=40, node_id=ids["reader"], clip=True, children=reader_children),
]

flows = [
    search_validation_flow("Search Library", "onTap", ids["search_button"], ids["library"]),
    search_validation_flow("Submit Search", "onSubmit", ids["search_input"], ids["library"]),
    tap_flow("Continue Reading", ids["continue"], ids["library"], [
        {"type": "hapticFeedback", "style": "medium", "label": "Soft page haptic"},
        {"type": "setVariable", "variable": "currentBookTitle", "value": "The Afterlight", "label": "Remember book"},
        {"type": "setText", "element": ids["reader_title"], "text": "The Afterlight", "label": "Set reader title"},
        {"type": "navigate", "screen": ids["reader"], "label": "Open reader"},
        {"type": "showToast", "message": "Resuming page 128", "label": "Resume toast"},
    ]),
    tap_flow("Open Glass Atlas", ids["glass_card"], ids["library"], [
        {"type": "hapticFeedback", "style": "light", "label": "Card haptic"},
        {"type": "navigate", "screen": ids["detail"], "label": "Open detail"},
    ]),
    tap_flow("Discover Tab", ids["discover_tab"], ids["library"], [
        {"type": "hapticFeedback", "style": "light", "label": "Tab haptic"},
        {"type": "navigate", "screen": ids["discover"], "label": "Show discover"},
    ]),
    tap_flow("Discover Book Detail", ids["discover_book"], ids["discover"], [
        {"type": "hapticFeedback", "style": "light", "label": "Book haptic"},
        {"type": "navigate", "screen": ids["detail"], "label": "Open detail"},
    ]),
    tap_flow("Back To Library From Detail", ids["detail_back"], ids["detail"], [
        {"type": "navigate", "screen": ids["library"], "label": "Return library"},
    ]),
    tap_flow("Save Book", ids["detail_bookmark"], ids["detail"], [
        {"type": "hapticFeedback", "style": "success", "label": "Saved haptic"},
        {"type": "setText", "element": ids["bookmark_label"], "text": "Saved to shelf", "label": "Update saved label"},
        {"type": "setColor", "element": ids["bookmark_pill"], "property": "fill", "color": "#D9AF62", "label": "Highlight saved"},
        {"type": "showToast", "message": "Saved to your shelf", "label": "Saved toast"},
    ]),
    tap_flow("Start Reading Detail", ids["detail_start"], ids["detail"], [
        {"type": "hapticFeedback", "style": "medium", "label": "Start haptic"},
        {"type": "setVariable", "variable": "currentBookTitle", "value": "The Glass Atlas", "label": "Remember title"},
        {"type": "setText", "element": ids["reader_title"], "text": "The Glass Atlas", "label": "Reader title"},
        {"type": "setText", "element": ids["reader_state"], "text": "Page 1  •  0%", "label": "Reset progress"},
        {"type": "navigate", "screen": ids["reader"], "label": "Open reader"},
    ]),
    tap_flow("Reader Back", ids["reader_back"], ids["reader"], [
        {"type": "navigate", "screen": ids["library"], "label": "Back to library"},
    ]),
    tap_flow("Reader Bookmark", ids["reader_bookmark"], ids["reader"], [
        {"type": "hapticFeedback", "style": "success", "label": "Bookmark haptic"},
        {"type": "setText", "element": ids["reader_state"], "text": "Saved to nightstand  •  page 128", "label": "Bookmark state"},
        {"type": "showToast", "message": "Bookmark placed", "label": "Bookmark toast"},
    ]),
    tap_flow("Reader Theme", ids["reader_theme"], ids["reader"], [
        {"type": "setColor", "element": ids["reader_bg"], "property": "fill", "color": "#111216", "label": "Night background"},
        {"type": "setColor", "element": ids["reader_panel"], "property": "fill", "color": "#191B20", "label": "Night page"},
        {"type": "setColor", "element": ids["reader_passage"], "property": "textColor", "color": "#EEE7DC", "label": "Night text"},
        {"type": "showToast", "message": "Night reading mode", "label": "Theme toast"},
    ]),
    tap_flow("Reader Note", ids["reader_note"], ids["reader"], [
        {"type": "setVisible", "element": ids["note_sheet"], "visible": "true", "label": "Reveal note"},
        {"type": "setText", "element": ids["note_text"], "text": "Write a thought from this passage.", "label": "Prompt for note"},
        {"type": "showToast", "message": "Note editor opened", "label": "Note toast"},
    ]),
    save_note_flow(),
    tap_flow("Reader Next Page", ids["reader_next"], ids["reader"], [
        {"type": "incrementVariable", "variable": "pageProgress", "amount": "1", "label": "Advance progress"},
        {"type": "setText", "element": ids["reader_state"], "text": "Page 129  •  43%", "label": "Update reader state"},
        {"type": "setText", "element": ids["progress_label"], "text": "43%", "label": "Update library progress"},
        {"type": "saveValue", "key": "aster.readerProgress", "value": "{{pageProgress}}", "label": "Persist progress"},
        {"type": "showToast", "message": "Progress saved", "label": "Progress toast"},
    ]),
    tap_flow("Reader Previous Page", ids["reader_prev"], ids["reader"], [
        {"type": "decrementVariable", "variable": "pageProgress", "amount": "1", "label": "Reverse progress"},
        {"type": "setText", "element": ids["reader_state"], "text": "Page 127  •  41%", "label": "Update reader state"},
        {"type": "setText", "element": ids["progress_label"], "text": "41%", "label": "Update library progress"},
        {"type": "saveValue", "key": "aster.readerProgress", "value": "{{pageProgress}}", "label": "Persist progress"},
        {"type": "showToast", "message": "Progress saved", "label": "Progress toast"},
    ]),
    tap_flow("Copy Passage Quote", ids["copy_quote"], ids["reader"], [
        {"type": "copyToClipboard", "text": "Every window held a comma of gold.", "label": "Copy quote"},
        {"type": "showToast", "message": "Quote copied", "label": "Copied toast"},
    ]),
    tap_flow("Share Passage Quote", ids["share_quote"], ids["reader"], [
        {"type": "shareContent", "text": "“Every window held a comma of gold.” — Aster Reader", "url": "https://aster-reader.local/passage/128", "label": "Share passage"},
        {"type": "showToast", "message": "Share sheet opened", "label": "Share toast"},
    ]),
    tap_flow("Font Plus", ids["font_plus"], ids["reader"], [
        {"type": "setText", "element": ids["font_value"], "text": "20 pt", "label": "Set font chip"},
        {"type": "animate", "element": ids["reader_panel"], "property": "scale", "to": "1.02", "duration": "0.2", "label": "Reader pulse"},
        {"type": "showToast", "message": "Text size increased", "label": "Font toast"},
    ]),
    tap_flow("Font Minus", ids["font_minus"], ids["reader"], [
        {"type": "setText", "element": ids["font_value"], "text": "16 pt", "label": "Set font chip"},
        {"type": "showToast", "message": "Text size decreased", "label": "Font toast"},
    ]),
    tap_flow("Library Tab From Discover", ids["library_tab_discover"], ids["discover"], [
        {"type": "navigate", "screen": ids["library"], "label": "Show library"},
    ]),
    tap_flow("Library Tab From Detail", ids["library_tab_detail"], ids["detail"], [
        {"type": "navigate", "screen": ids["library"], "label": "Show library"},
    ]),
    tap_flow("Library Tab From Reader", ids["library_tab_reader"], ids["reader"], [
        {"type": "navigate", "screen": ids["library"], "label": "Show library"},
    ]),
]

project = {
    "name": "Aster Reader",
    "pages": [
        {
            "id": uid(),
            "name": "Book Reading App",
            "nodes": screens,
            "logicFlows": flows,
            "supportedPlatforms": ["iPhone", "iPad"],
        }
    ],
    "apiEndpoints": [],
    "firebaseConfig": None,
    "supabaseConfig": None,
    "globalVariables": [
        {"id": uid(), "name": "currentBookTitle", "type": "string", "defaultValue": "The Afterlight", "scope": "global"},
        {"id": uid(), "name": "bookmarkSaved", "type": "boolean", "defaultValue": "false", "scope": "global"},
        {"id": uid(), "name": "pageProgress", "type": "number", "defaultValue": "42", "scope": "global"},
        {"id": uid(), "name": "themeMode", "type": "string", "defaultValue": "warm", "scope": "global"},
        {"id": uid(), "name": "notes", "type": "array", "defaultValue": "", "scope": "global"},
        {"id": uid(), "name": "draftNote", "type": "string", "defaultValue": "", "scope": "global"},
        {"id": uid(), "name": "searchQuery", "type": "string", "defaultValue": "", "scope": "global"},
        {"id": uid(), "name": "lastSavedAt", "type": "string", "defaultValue": "never", "scope": "global"},
    ],
    "platformSettings": {"enabledPlatforms": ["iPhone", "iPad"], "defaultPreviewPlatform": "iPhone"},
}

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(project, indent=2, sort_keys=True) + "\n")
print(f"Wrote {OUT}")
print(f"Screens: {len(screens)}")
print(f"Logic flows: {len(flows)}")
