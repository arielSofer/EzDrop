import urllib.request
import json

# Switch to page 1
req1 = urllib.request.Request('http://127.0.0.1:8765/mcp', data=json.dumps({
  "jsonrpc": "2.0", "method": "tools/call", "params": { "name": "select_page", "arguments": { "pageIndex": 1 } }, "id": 1
}).encode(), headers={'Content-Type': 'application/json'})
urllib.request.urlopen(req1)

# Apply actions
actions = []

screen1 = "home_fixed_p1"
actions.append({"type": "createFrame", "nodeReference": screen1, "name": "Home", "x": 0, "y": 0, "width": 390, "height": 844, "fill": "#0A0A0A", "cornerRadius": 40, "clipContent": True, "layout": "verticalStack", "spacing": 24, "padding": 24})
actions.append({"type": "createFrame", "parentReference": screen1, "name": "Header", "layout": "horizontalStack", "spacing": 0, "padding": 0, "width": 342, "height": 40})
actions.append({"type": "createText", "parentReference": "Header", "text": "Good morning, Alex", "fontSize": 24, "fontWeight": "heavy", "textColor": "#FFFFFF", "width": 280})
actions.append({"type": "createIcon", "parentReference": "Header", "iconName": "bell.badge.fill", "textColor": "#39FF14", "width": 24, "height": 24})

actions.append({"type": "createFrame", "parentReference": screen1, "name": "GoalCard", "layout": "verticalStack", "spacing": 12, "padding": 20, "width": 342, "fill": "#1C1C1E", "cornerRadius": 24, "shadow": "0 10px 30px rgba(0,0,0,0.5)"})
actions.append({"type": "createText", "parentReference": "GoalCard", "text": "WEEKLY GOAL", "fontSize": 12, "fontWeight": "bold", "textColor": "#8E8E93"})
actions.append({"type": "createFrame", "parentReference": "GoalCard", "name": "GoalRow", "layout": "horizontalStack", "spacing": 8, "padding": 0})
actions.append({"type": "createText", "parentReference": "GoalRow", "text": "18.4", "fontSize": 48, "fontWeight": "heavy", "textColor": "#39FF14"})
actions.append({"type": "createText", "parentReference": "GoalRow", "text": "/ 30 KM", "fontSize": 20, "fontWeight": "bold", "textColor": "#8E8E93"})

actions.append({"type": "createFrame", "parentReference": "GoalCard", "name": "ProgContainer", "width": 302, "height": 8, "cornerRadius": 4, "fill": "#2C2C2E"})
actions.append({"type": "createFrame", "parentReference": "ProgContainer", "name": "ProgBar", "x": 0, "y": 0, "width": 180, "height": 8, "fill": "#39FF14", "cornerRadius": 4, "shadow": "0 0 12px #39FF14"})

actions.append({"type": "createText", "parentReference": screen1, "text": "Recent Activity", "fontSize": 20, "fontWeight": "bold", "textColor": "#FFFFFF", "padding": "12 0 0 0"})
actions.append({"type": "createFrame", "parentReference": screen1, "name": "RunsList", "layout": "verticalStack", "spacing": 12, "padding": 0, "width": 342})

for i in range(3):
    row_name = f"RunRow_p1_{i}"
    actions.append({"type": "createFrame", "parentReference": "RunsList", "name": row_name, "layout": "horizontalStack", "spacing": 16, "padding": 12, "width": 342, "fill": "#1C1C1E", "cornerRadius": 16})
    actions.append({"type": "createImage", "parentReference": row_name, "name": f"Thumb_p1_{i}", "width": 56, "height": 56, "cornerRadius": 12, "assetKind": "thumbnail", "imagePrompt": "dark mode neon map snippet of running route"})
    actions.append({"type": "createFrame", "parentReference": row_name, "name": f"RunInfo_p1_{i}", "layout": "verticalStack", "spacing": 4, "padding": 0})
    actions.append({"type": "createText", "parentReference": f"RunInfo_p1_{i}", "text": f"Evening Run {i+1}", "fontSize": 16, "fontWeight": "bold", "textColor": "#FFFFFF"})
    actions.append({"type": "createText", "parentReference": f"RunInfo_p1_{i}", "text": "5.2 KM  •  Pace 5'14\"", "fontSize": 14, "fontWeight": "medium", "textColor": "#8E8E93"})

screen2 = "activity_fixed_p1"
actions.append({"type": "createFrame", "nodeReference": screen2, "name": "Activity Map", "x": 450, "y": 0, "width": 390, "height": 844, "fill": "#0A0A0A", "cornerRadius": 40, "clipContent": True})
actions.append({"type": "createImage", "parentReference": screen2, "name": "HeroMap", "x": 0, "y": 0, "width": 390, "height": 844, "imagePrompt": "dark mode satellite city map at night with a glowing neon cyan path", "assetKind": "hero", "opacity": 0.8})
actions.append({"type": "createFrame", "parentReference": screen2, "name": "LiveStats", "x": 16, "y": 480, "width": 358, "height": 330, "fill": "#1C1C1E", "cornerRadius": 32, "shadow": "0 -10px 40px rgba(0,0,0,0.8)", "layout": "verticalStack", "spacing": 24, "padding": 32})
actions.append({"type": "createFrame", "parentReference": "LiveStats", "name": "TimeRow", "layout": "verticalStack", "spacing": 4, "padding": 0, "width": 294})
actions.append({"type": "createText", "parentReference": "TimeRow", "text": "00:42:15", "fontSize": 56, "fontWeight": "heavy", "textColor": "#00FFFF", "textAlign": "center", "width": 294})
actions.append({"type": "createText", "parentReference": "TimeRow", "text": "TOTAL TIME", "fontSize": 12, "fontWeight": "bold", "textColor": "#8E8E93", "textAlign": "center", "width": 294})
actions.append({"type": "createFrame", "parentReference": "LiveStats", "name": "MetricsRow", "layout": "horizontalStack", "spacing": 40, "padding": 0, "width": 294})
actions.append({"type": "createFrame", "parentReference": "MetricsRow", "name": "DistCol", "layout": "verticalStack", "spacing": 4, "padding": 0})
actions.append({"type": "createText", "parentReference": "DistCol", "text": "6.82", "fontSize": 32, "fontWeight": "heavy", "textColor": "#FFFFFF", "textAlign": "center"})
actions.append({"type": "createText", "parentReference": "DistCol", "text": "KILOMETERS", "fontSize": 12, "fontWeight": "bold", "textColor": "#8E8E93", "textAlign": "center"})
actions.append({"type": "createFrame", "parentReference": "MetricsRow", "name": "PaceCol", "layout": "verticalStack", "spacing": 4, "padding": 0})
actions.append({"type": "createText", "parentReference": "PaceCol", "text": "5'15\"", "fontSize": 32, "fontWeight": "heavy", "textColor": "#FFFFFF", "textAlign": "center"})
actions.append({"type": "createText", "parentReference": "PaceCol", "text": "PACE", "fontSize": 12, "fontWeight": "bold", "textColor": "#8E8E93", "textAlign": "center"})
actions.append({"type": "createFrame", "parentReference": "LiveStats", "name": "PauseBtnFrame", "layout": "verticalStack", "spacing": 0, "padding": 0, "width": 294})
actions.append({"type": "createFrame", "parentReference": "PauseBtnFrame", "name": "PauseBtn", "width": 80, "height": 80, "fill": "#FF00FF", "cornerRadius": 40, "shadow": "0 0 20px #FF00FF", "x": 107, "y": 0})
actions.append({"type": "createIcon", "parentReference": "PauseBtn", "iconName": "pause.fill", "textColor": "#FFFFFF", "x": 26, "y": 26, "width": 28, "height": 28})

req2 = urllib.request.Request('http://127.0.0.1:8765/mcp', data=json.dumps({
  "jsonrpc": "2.0", "method": "tools/call", "params": { "name": "apply_design_actions", "arguments": { "normalize": False, "generateImages": True, "actions": actions } }, "id": 2
}).encode(), headers={'Content-Type': 'application/json'})
print(urllib.request.urlopen(req2).read().decode())
