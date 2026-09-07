# Golf dependency candidate gate — 2026-09-07

Scope: upgrade two vulnerable Python dependencies and the supported Vite toolchain,
preserve the current application behavior and existing tests. Evidence below was
obtained in a separate temporary candidate copied without project secrets, databases,
backups or node_modules. It is local compatibility evidence, not a production deployment
or confirmation that remote security alerts have been closed.

## Package decisions

- `python-jose[cryptography]`: 3.3.0 → 3.5.0; current PyPI metadata requires Python >=3.9.
- `python-multipart`: 0.0.12 → 0.0.32; current PyPI metadata requires Python >=3.10.
- Vite: 5.4.21 (manifest `^5.4.10`) → exact 7.3.6. Vite 5 is unsupported; the current
  support policy gives Vite 7.3 important/security fixes, while 6.4 is security-only.
- The existing React plugin 4.7.0 supports Vite 7. The current project Node policy is
  already stricter than Vite 7's Node 20.19+/22.12+ requirement; no Node-policy change.
- Fresh npm resolution selected esbuild 0.28.2, browserslist 4.28.9 and
  postcss-selector-parser 6.1.4, newer patched versions than the initial advisory floors.
  Official registry metadata and upstream release/commit notes were checked. The
  esbuild install-script allowlist changes to the exact resolved 0.28.2 version.
- No new direct dependency or permanent transitive override was added. The lockfile
  has 278 → 283 package records including its root: 245 semantically unchanged,
  33 changed (including root), 5 added, none removed. Changed records are the Vite/
  esbuild family, browserslist and its data updater, and selector-parser. Added records
  are three esbuild platform packages plus Vite's nested fdir and picomatch.

## Compatibility controls

Vite 6/7 migration guides were reviewed against the existing config. No Sass, SSR,
custom resolution conditions, library mode, deprecated vendor-chunk plugin or custom
HTML transform hooks were found. Existing alias, preserveSymlinks, optimizer and proxy
configuration remain in place.

Vite 7 raises the default browser transformation target. The new config regression
passed on Vite 5, then failed on Vite 7's defaults. An explicit target preserves the old
resolved values: es2020, Edge 88, Firefox 78, Chrome 87, Safari 14. Both JS and CSS targets
are checked. This only preserves bundler transformation settings: it does not add API
polyfills or prove actual behavior in those browsers. Chromium is the only E2E browser
used here. A second config check retains loopback-only development binding, strict port
and the explicit local backend proxy.

## RED/GREEN and final local gate

- Original candidate baseline: all 12 backend tests PASS.
- Nine new synthetic dependency checks on the old packages: 7 PASS, 2 FAIL. The old
  JOSE accepted an ephemeral OpenSSH ECDSA public key as an HMAC secret; old parse_form
  accepted a negative Content-Length and read the tiny test body.
- The JOSE test's expected exception was corrected to the public encode API's wrapped
  JWSError, with an asymmetric-key message assertion. RED was repeated against the old
  installed versions and still produced the same 2 failures; the assertion was not
  broadened to a generic exception.
- Upgraded dependencies: all 21 backend tests PASS. Existing tests remain unchanged.
  New controls cover a normal application token, wrong signing key, expired token,
  disallowed algorithm, unsigned token, SSH/HMAC separation, valid multipart field,
  mismatched multipart boundary and rejection of negative length before any stream read.
- Full `GOLF_KEEP_FAILED_TMP=1 bash scripts/test.sh`: 6 wrapper regressions, 21 backend
  tests (5.71 s), 4 lint regressions, 2 build-config checks, ESLint, TypeScript/Vite build
  and all 19 existing Chromium E2E (25.2 s) PASS, rc 0.
- Frontend `npm audit --json`: 4 vulnerable package entries before, 0 after the upgrade
  under the advisory data returned on 2026-09-07. No advisory was ignored/suppressed.
- Ruff lint/format check on the new Python file and Node syntax check on the new config
  regression passed. The full runner used a fresh install from the candidate manifests.

## Threat and acceptance boundaries

The application uses an explicit JWT algorithm allowlist, defaults to HS256 and does
not use JWE. No Form/UploadFile/request.form multipart endpoint was found in backend/app
in this review. The dependency tests establish library behavior, not demonstrated
exploitation of Golf. In particular, the negative-length advisory describes direct
parse_form consumers; FastAPI/Starlette ASGI multipart parsing does not use that helper.

This is **not a clean bill of health for all backend dependencies**. FastAPI remains
0.115.0 and resolves Starlette 0.38.6 (<0.39), whose current PyPI metadata contains seven
distinct GHSA advisories after alias deduplication:

- GHSA-f96h-pmfr-66vw; GHSA-2c2j-9gv5-cj73; GHSA-86qp-5c8j-p5mr;
- GHSA-wqp7-x3pw-xc5r; GHSA-x746-7m8f-x49c;
- GHSA-82w8-qh3p-5jfq; GHSA-jp82-jpqv-5vv3.

Their listed fixed versions range from 0.40.0 to 1.3.1, outside the current framework
constraint. A compatible framework upgrade and route-specific applicability review
are a separate gate, not silently included in this dependency slice. A PyPI advisory
record alone is not evidence of a reachable production exploit.

Retained observations: 252 backend warnings (251 existing plus the legacy multipart
import compatibility warning); Vite's large-chunk warning (526.95 kB, gzip 146.92 kB).
No real database, ignored backup, production server or active checkout node_modules
was changed. Windows-specific development-server paths and old-browser runtime
compatibility were not exercised. Host startup hooks remain trusted as documented in
the existing runner; this is not an arbitrary-host-code sandbox.

## Primary sources checked

- [JOSE 3.5.0 package metadata](https://pypi.org/pypi/python-jose/3.5.0/json)
- [Multipart 0.0.32 package metadata](https://pypi.org/pypi/python-multipart/0.0.32/json)
- [SSH/HMAC advisory](https://github.com/advisories/GHSA-6c5p-j8vq-pqhj)
- [Negative Content-Length advisory](https://github.com/advisories/GHSA-v9pg-7xvm-68hf)
- [Vite 5 to 6 migration](https://github.com/vitejs/vite/blob/v6.4.3/docs/guide/migration.md)
- [Vite 6 to 7 migration](https://github.com/vitejs/vite/blob/v7.3.6/docs/guide/migration.md)
- [Vite support policy](https://github.com/vitejs/vite/blob/main/docs/releases.md)
- [esbuild 0.28.2 release](https://github.com/evanw/esbuild/releases/tag/v0.28.2)
- [browserslist 4.28.9 release](https://github.com/browserslist/browserslist/releases/tag/4.28.9)
- [Selector parser 6.1.4 release commit](https://github.com/postcss/postcss-selector-parser/commit/fb22e1247963c272d45dc7bb0f4f9eff089dc379)
- [Remaining Starlette metadata](https://pypi.org/pypi/starlette/0.38.6/json)
