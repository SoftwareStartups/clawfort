---
paths:
  - "docs/**"
---

- One topic per file. Split at ~300 lines.
- ATX headings (`#`), max 3 levels
- Code blocks must specify language (`bash`, `typescript`, etc.)
- No inline secrets — reference ESC or config files instead
- External links go in `docs/references.md`, not scattered across files
- Docs describe system state ("what is"). CLAUDE.md files describe agent behavior ("what to do").
- Keep command examples runnable — use `task ssh -- '<command>'` to verify server-side state
- Key docs: architecture.md (design), prerequisites.md (setup), deployment.md (ops), verification.md (health), tool-isolation.md (sandboxing)
