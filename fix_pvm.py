import re
path = "/Users/ariel/Documents/XcodeApps/AgenticDesigner/AgenticDesigner/ViewModels/ProjectViewModel.swift"
with open(path, "r") as f:
    content = f.read()

# Swap name: ... and type: ...
new_content = re.sub(
    r'([ \t]*name:\s*.*,\n)([ \t]*type:\s*\.[a-zA-Z]+,)',
    r'\2\n\1',
    content
)

with open(path, "w") as f:
    f.write(new_content)
