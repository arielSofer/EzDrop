import urllib.request
import json
import uuid

def u(): return str(uuid.uuid4())

actions = []

# 1. Home Dashboard
screen1 = "home"
actions.append({"type":"createFrame","nodeReference":screen1,"name":"Home","x":0,"y":0,"width":390,"height":844,"fill":"#111111","cornerRadius":40,"clipContent":True})
actions.append({"type":"createText","parentReference":screen1,"text":"Good morning, Alex!","x":24,"y":80,"width":342,"height":34,"fontSize":28,"fontWeight":"bold","textColor":"#FFFFFF"})

actions.append({"type":"createFrame","parentReference":screen1,"name":"WeeklyGoal","x":24,"y":130,"width":342,"height":140,"fill":"#222222","cornerRadius":24})
actions.append({"type":"createText","parentReference":"WeeklyGoal","text":"Weekly Goal: 30 km","x":20,"y":20,"width":200,"height":24,"fontSize":16,"fontWeight":"medium","textColor":"#AAAAAA"})
actions.append({"type":"createText","parentReference":"WeeklyGoal","text":"18.4 km","x":20,"y":50,"width":200,"height":40,"fontSize":36,"fontWeight":"heavy","textColor":"#39FF14"}) # Neon green
actions.append({"type":"createFrame","parentReference":"WeeklyGoal","name":"ProgressBarBg","x":20,"y":100,"width":302,"height":8,"fill":"#333333","cornerRadius":4})
actions.append({"type":"createFrame","parentReference":"WeeklyGoal","name":"ProgressBarFill","x":20,"y":100,"width":180,"height":8,"fill":"#39FF14","cornerRadius":4,"shadow":"0 0 10px #39FF14"})

# Recent Runs
actions.append({"type":"createText","parentReference":screen1,"text":"Recent Runs","x":24,"y":300,"width":342,"height":24,"fontSize":20,"fontWeight":"bold","textColor":"#FFFFFF"})
for i in range(3):
    y_offset = 340 + i * 90
    card_ref = f"run_{i}"
    actions.append({"type":"createFrame","parentReference":screen1,"nodeReference":card_ref,"x":24,"y":y_offset,"width":342,"height":80,"fill":"#1A1A1A","cornerRadius":16})
    actions.append({"type":"createImage","parentReference":card_ref,"name":"MapThumb","x":12,"y":12,"width":56,"height":56,"cornerRadius":12,"imagePrompt":"a small dark mode map snippet showing a running route","assetKind":"thumbnail"})
    actions.append({"type":"createText","parentReference":card_ref,"text":f"Evening Run {i+1}","x":80,"y":16,"width":150,"height":20,"fontSize":16,"fontWeight":"bold","textColor":"#FFFFFF"})
    actions.append({"type":"createText","parentReference":card_ref,"text":"5.2 km  •  28:14","x":80,"y":40,"width":150,"height":20,"fontSize":14,"fontWeight":"regular","textColor":"#888888"})

# Bottom Nav
actions.append({"type":"createFrame","parentReference":screen1,"name":"BottomNav","x":0,"y":760,"width":390,"height":84,"fill":"#111111","shadow":"0 -10px 20px rgba(0,0,0,0.5)"})
actions.append({"type":"createIcon","parentReference":"BottomNav","iconName":"house.fill","x":40,"y":20,"width":24,"height":24,"textColor":"#39FF14"})
actions.append({"type":"createIcon","parentReference":"BottomNav","iconName":"figure.run","x":183,"y":20,"width":24,"height":24,"textColor":"#666666"})
actions.append({"type":"createIcon","parentReference":"BottomNav","iconName":"person.fill","x":326,"y":20,"width":24,"height":24,"textColor":"#666666"})

# 2. Activity (Run in Progress)
screen2 = "activity"
actions.append({"type":"createFrame","nodeReference":screen2,"name":"Activity","x":450,"y":0,"width":390,"height":844,"fill":"#111111","cornerRadius":40,"clipContent":True})
actions.append({"type":"createImage","parentReference":screen2,"name":"FullMap","x":0,"y":0,"width":390,"height":600,"imagePrompt":"dark mode satellite map of a city street at night with a glowing neon cyan path showing a running route","assetKind":"hero"})

actions.append({"type":"createFrame","parentReference":screen2,"name":"StatsCard","x":0,"y":550,"width":390,"height":294,"fill":"#1A1A1A","cornerRadius":32,"shadow":"0 -10px 30px rgba(0,0,0,0.8)"})
actions.append({"type":"createText","parentReference":"StatsCard","text":"00:42:15","x":24,"y":30,"width":342,"height":60,"fontSize":48,"fontWeight":"heavy","textColor":"#00FFFF","textAlign":"center"})
actions.append({"type":"createText","parentReference":"StatsCard","text":"TIME","x":24,"y":90,"width":342,"height":20,"fontSize":14,"fontWeight":"bold","textColor":"#666666","textAlign":"center"})

actions.append({"type":"createText","parentReference":"StatsCard","text":"6.82","x":40,"y":140,"width":120,"height":40,"fontSize":32,"fontWeight":"heavy","textColor":"#FFFFFF","textAlign":"center"})
actions.append({"type":"createText","parentReference":"StatsCard","text":"KILOMETERS","x":40,"y":180,"width":120,"height":20,"fontSize":12,"fontWeight":"bold","textColor":"#666666","textAlign":"center"})

actions.append({"type":"createText","parentReference":"StatsCard","text":"5'15\"","x":230,"y":140,"width":120,"height":40,"fontSize":32,"fontWeight":"heavy","textColor":"#FFFFFF","textAlign":"center"})
actions.append({"type":"createText","parentReference":"StatsCard","text":"PACE","x":230,"y":180,"width":120,"height":20,"fontSize":12,"fontWeight":"bold","textColor":"#666666","textAlign":"center"})

# Pause button
actions.append({"type":"createFrame","parentReference":"StatsCard","name":"PauseBtn","x":155,"y":210,"width":80,"height":80,"fill":"#FF00FF","cornerRadius":40,"shadow":"0 0 20px #FF00FF"})
actions.append({"type":"createIcon","parentReference":"PauseBtn","iconName":"pause.fill","x":26,"y":26,"width":28,"height":28,"textColor":"#FFFFFF"})

# 3. Profile
screen3 = "profile"
actions.append({"type":"createFrame","nodeReference":screen3,"name":"Profile","x":900,"y":0,"width":390,"height":844,"fill":"#111111","cornerRadius":40,"clipContent":True})
actions.append({"type":"createImage","parentReference":screen3,"name":"Avatar","x":145,"y":80,"width":100,"height":100,"cornerRadius":50,"imagePrompt":"modern avatar portrait of a runner wearing athletic gear with neon lighting","assetKind":"avatar"})
actions.append({"type":"createText","parentReference":screen3,"text":"Alex Runner","x":24,"y":200,"width":342,"height":30,"fontSize":24,"fontWeight":"bold","textColor":"#FFFFFF","textAlign":"center"})
actions.append({"type":"createText","parentReference":screen3,"text":"Level 12 • Pro","x":24,"y":230,"width":342,"height":20,"fontSize":16,"fontWeight":"medium","textColor":"#39FF14","textAlign":"center"})

actions.append({"type":"createFrame","parentReference":screen3,"name":"StatsGrid","x":24,"y":280,"width":342,"height":100,"fill":"#1A1A1A","cornerRadius":20})
actions.append({"type":"createText","parentReference":"StatsGrid","text":"Total KM","x":20,"y":20,"width":80,"height":20,"fontSize":14,"fontWeight":"medium","textColor":"#888888"})
actions.append({"type":"createText","parentReference":"StatsGrid","text":"432","x":20,"y":45,"width":80,"height":30,"fontSize":24,"fontWeight":"bold","textColor":"#FFFFFF"})

actions.append({"type":"createText","parentReference":"StatsGrid","text":"Runs","x":130,"y":20,"width":80,"height":20,"fontSize":14,"fontWeight":"medium","textColor":"#888888"})
actions.append({"type":"createText","parentReference":"StatsGrid","text":"68","x":130,"y":45,"width":80,"height":30,"fontSize":24,"fontWeight":"bold","textColor":"#FFFFFF"})

actions.append({"type":"createText","parentReference":"StatsGrid","text":"Avg Pace","x":240,"y":20,"width":80,"height":20,"fontSize":14,"fontWeight":"medium","textColor":"#888888"})
actions.append({"type":"createText","parentReference":"StatsGrid","text":"5'20\"","x":240,"y":45,"width":80,"height":30,"fontSize":24,"fontWeight":"bold","textColor":"#FFFFFF"})

# Send Request
payload = {
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "apply_design_actions",
    "arguments": {
      "normalize": True,
      "generateImages": True,
      "actions": actions
    }
  },
  "id": 1
}

req = urllib.request.Request('http://127.0.0.1:8765/mcp', data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
try:
    resp = urllib.request.urlopen(req)
    print("Success:", resp.read().decode())
except Exception as e:
    print("Error:", e)
