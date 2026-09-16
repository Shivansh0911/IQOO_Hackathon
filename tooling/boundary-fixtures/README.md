# Boundary fixtures

Deliberately-violating files. They are **not** part of the product and are excluded
from typecheck and from every build.

They exist so the two architectural lint rules are regression-tested instead of
merely configured: `pnpm boundaries` lints each fixture and asserts the expected
rule fires — and that the clean fixtures stay clean. If someone weakens a rule,
this fails.

- `core/`   — linted with the portable-zone rules (RULE A)
- `tiffin/` — linted with the Tiffin-independence rules (RULE B)
