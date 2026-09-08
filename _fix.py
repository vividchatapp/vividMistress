#!/usr/bin/env python3
"""Apply remaining patches: formatStatus model line + handleSession model field."""

filepath = "internal/server/server.go"
T = "\t"

with open(filepath, "r", encoding="utf-8", errors="surrogateescape") as f:
    content = f.read()

# ── 1. formatStatus: add model line ───────────────────────────────────
old_status = (
    T + 'fmt.Fprintf(&b, "  **Voice speed:** %d (%.1fx)\\n", speed, 1+float64(speed)/10)\n'
    + T + 'return strings.TrimRight(b.String(), "\\n")'
)
new_status = (
    T + 'fmt.Fprintf(&b, "  **Voice speed:** %d (%.1fx)\\n", speed, 1+float64(speed)/10)\n'
    + T + 'fmt.Fprintf(&b, "  **Model:** %s\\n", s.modelFor(c))\n'
    + T + 'return strings.TrimRight(b.String(), "\\n")'
)
if old_status in content:
    content = content.replace(old_status, new_status, 1)
    print("OK: formatStatus model line")
else:
    print("WARN: could not find formatStatus anchor")

# ── 2. handleSession: add model field ──────────────────────────────────
old_session = (
    T + 'writeJSON(w, http.StatusOK, map[string]any{\n'
    + T + T + '"conversation": c,\n'
    + T + T + '"role":         s.roleNameForConversation(c),\n'
    + T + '})\n'
    '}\n'
    '\n'
    '// sessionConversation loads the single chat for a client,'
)
new_session = (
    T + 'writeJSON(w, http.StatusOK, map[string]any{\n'
    + T + T + '"conversation": c,\n'
    + T + T + '"role":         s.roleNameForConversation(c),\n'
    + T + T + '"model":        s.modelFor(&c),\n'
    + T + '})\n'
    '}\n'
    '\n'
    '// sessionConversation loads the single chat for a client,'
)
if old_session in content:
    content = content.replace(old_session, new_session, 1)
    print("OK: handleSession model field")
else:
    print("WARN: could not find handleSession anchor")

with open(filepath, "w", encoding="utf-8", errors="surrogateescape") as f:
    f.write(content)

print("Done.")

