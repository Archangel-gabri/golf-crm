# Golf framework candidate gate — 2026-09-07

Isolated upgrade of FastAPI 0.115.0 / Starlette 0.38.6 to FastAPI 0.141.1 /
Starlette 1.6.0, based on dependency8 commit
`160f74efc6df28ce60733b88b63bbe2199e6d023` and the subsequent local CI-only commit
`6a96be08149fe5bf52870fba29a1d63aaf370e9e` (final candidate base; remote publication
is verified separately by the coordinator). This report supersedes only the
framework-debt status in the earlier dependency gate, not its historical evidence.
It is local synthetic compatibility evidence, not a deployment or a claim of
zero vulnerabilities. Canonical application data, `.env`, backups and browser
authentication state were excluded from the candidate and never opened.

## Version decision and exact change boundary

FastAPI 0.132.1 still declares Starlette `<1.0.0`; 0.133.0 is the first release
officially supporting Starlette 1.x. Starlette 1.3.1 is the highest fix floor
among the seven advisories recorded in the earlier gate. Minimum compatibility
does not establish a maintained/LTS FastAPI branch. The candidate therefore pins
the current stable FastAPI 0.141.1 and explicitly pins the compatible Starlette
1.6.0 tuple. FastAPI's own broad lower bound (`>=0.46.0`) would otherwise still
permit affected installed versions; fresh latest resolution alone is not a
security floor. A declared-and-installed tuple regression failed before the
direct Starlette pin was added and then passed. This is a supported combination,
not an override of the former FastAPI 0.115 constraints.

Python remains 3.12.13, Pydantic remains 2.9.2 and AnyIO remains 4.15.1.
Their declared compatibility ranges are satisfied; `uv pip check` confirmed all
49 installed packages compatible. No Pydantic migration, HTTPX2 installation,
global DB dependency change or middleware rewrite is bundled here.

Exact six source paths:

- `backend/requirements.txt`
- `backend/app/routers/sse.py`
- `backend/tests/test_framework_compatibility.py` (new)
- `e2e/tests/realtime.spec.ts` (new)
- `docs/testing/2026-09-07-framework-gate.md` (new)
- `README.md`

## SSE lifetime: reproduced regression and minimal fix

Golf authenticates SSE via `get_current_user` → generator dependency `get_db`,
then returns an indefinite `StreamingResponse`. The stream itself does not use
the database. FastAPI 0.118 changed default yield cleanup from before sending
the response to after the entire response. That would retain an authentication
DB session through the SSE connection; the configured PostgreSQL pool is 5 with
5 overflow slots. This is a reproduced dependency-lifetime defect, not a claim
that a production pool-starvation incident occurred.

One bounded raw ASGI test uses the real app/middleware/auth/stream chain, a
synthetic signed bearer token and an instrumented DB dependency. It captures
hello and a real broadcaster event, injects disconnect, requires completion
within five seconds and verifies the subscriber count returns to its baseline.

- Original 21 backend tests: PASS on 0.115.0 / 0.38.6 (5.94 s).
- New lifetime test on the original tuple: PASS (2.75 s), trace
  `open → lookup → close → first_chunk → event`.
- The same test on 0.141.1 / 1.6.0 before the source fix: FAIL (3.38 s), trace
  `open → lookup → first_chunk → event → close`.
- Minimal SSE-only adapter: `Depends(get_db, scope="function")` directly on the
  DB generator, followed by the unchanged shared `get_current_user(request, db)`.
  The same test then passed (3.44 s). Closing is required exactly once and before
  the first chunk. Placing scope only on the outer non-generator auth function
  would not establish that boundary.

Starlette's removed middleware decorator does not require a Golf rewrite:
FastAPI provides its own decorator. Golf already uses an async lifespan context.

## A second blocker: real ASGI 2.4 idle disconnect

The first complete 41-backend/20-E2E candidate gate passed, but independent
review correctly rejected its cleanup evidence as incomplete: the ASGI probe
declared 2.3 while pinned Uvicorn 0.30.6 declares 2.4. Starlette 1.6 switches
from a receive-side disconnect listener to send-error handling at ASGI 2.4.
Uvicorn 0.30.6 silently returns from send after disconnect; additionally, the
two BaseHTTPMiddleware layers interfere with an immediately cancelled
`Request.is_disconnected()` poll. A browser EventSource.close observation did
not prove backend subscriber cleanup.

- Same full-app ASGI success test changed only to spec 2.4: timeout after the
  five-second deadline (6.88 s total); independently reproduced by the reviewer.
- A real idle TCP connection to the pinned Uvicorn received 200/hello, then
  closed without any broadcast. The DB dependency was already finalized, but
  the subscriber failed to return to baseline within two seconds (5.32 s total,
  including bounded shutdown cleanup). This was not merely a fake send harness.
- An SSE-specific response now runs public `stream_response` and
  `listen_for_disconnect` concurrently, cancels and awaits the sibling, then
  explicitly closes an iterator paused at yield/send. No fake ASGI version,
  removed security middleware, heartbeat shortening, or global routing change.
- Both ASGI 2.3 and 2.4 then passed, as did the real idle socket test. The final
  socket test covers both Uvicorn HTTP implementations, h11 and httptools, and
  requires cleanup before a two-second deadline without sending an event or
  waiting for the twenty-second heartbeat.

The existing Uvicorn pin/standard extras remain unchanged: a server update alone
would not provide immediate idle cleanup when send is never called. The real
socket tests use ephemeral loopback ports, synthetic signed auth/instrumented
DB dependencies, the actual middleware stack and `lifespan=off`; they do not
open a real project DB or replace process signal handlers. The server/listener
are stopped and awaited in finally blocks. The instrumented DB proves generator
finalization order, not a measured production PostgreSQL checkout/release.

The private response is HTTP/SSE-specific, not a generic replacement for every
Starlette response/WebSocket contract. Single stream failures are grouped by
AnyIO; tests explicitly inspect the original leaf/cause. Normal completion and
disconnect run a background callback, while error/external cancellation do not.
Explicit generator close is shielded only after its streaming task is awaited;
the actual event_stream finalizer is synchronous subscriber-set removal.

## Supplemental compatibility contracts

Twenty-nine new backend cases preserve all 21 existing tests unchanged:

- SSE lifetime, full middleware streaming headers, hello/event/disconnect and
  subscriber cleanup; missing, invalid, inactive and unknown-user auth all yield
  401 with DB cleanup and no subscriber. All four negative SSE cases use the
  bounded ASGI harness as well, so an auth regression cannot hang TestClient;
  a synthetic accidentally-public-stream case checks the harness itself.
- Actual idle TCP disconnect under both h11 and httptools, plus response normal
  finish, disconnect, send OSError, generator exception and external task.cancel:
  listener/generator cleanup exactly once, awaited sibling and background policy.
- Effective route enumeration, including nested prefixes and a hidden-from-
  OpenAPI fixture, excluding a WebSocket route. The new FastAPI represents included routers as branches:
  the old direct `app.routes` loop sees only six public static GETs, silently
  dropping its business coverage. The supplementary test uses
  `fastapi.routing.iter_route_contexts`, retains a source-verified census of all
  27 existing protected static GETs, and also checks any newly discovered ones.
  Anonymous checks use bounded raw ASGI so an accidentally public infinite SSE
  fails rather than hanging TestClient. The current app has 25 top-level entries,
  94 effective routes and 33 static GET paths, six public and 27 protected.
- Real synthetic ORM/password login and separate cookie jars with Secure false
  and true; session HttpOnly, CSRF cookie readable, Path/SameSite/Secure attributes;
  authenticated missing/mismatched CSRF yields specifically CSRF 403, matching
  header allows customer creation; ORM date/datetime responses survive; logout
  removes the session cookie and `/auth/me` returns 401.
- Allowed/denied CORS origins and OPTIONS with CSRF/Content-Type headers. A denied
  origin does not turn a normal GET into an authentication error; it lacks ACAO.
- Startup sequencing once, two controlled background tasks, cancellation and
  awaited shutdown; test instrumentation replaces DB/bootstrap effects only
  for this lifecycle contract. Full-runner startup uses the real synthetic DB.
- Missing/wrong JSON Content-Type and malformed JSON remain rejected. The SPA
  already supplies application/json, so the new strict default is not disabled.
- Tiny Request URL invariants: malformed Host does not poison the security path,
  and a path beginning with double slash does not replace the hostname. These
  are library contracts, not a production reverse-proxy or exploit test.

The initial census test used an unverified lower bound of 30; actual source
inspection established 27 protected static GETs. The arbitrary count was replaced
by the exact 27-path baseline plus dynamic checking of future discovered routes.
This was a test-expectation correction, not an application failure or a claimed
additional production RED/GREEN. Other supplemental tests are compatibility
coverage, not separately claimed pre-fix failures.

One new browser scenario preserves the 19 existing E2E cases. Two independent
synthetic authenticated browser contexts use the native EventSource. The reader
must receive real open/hello, show an empty unique-name search, then receive a
customers event and show the row created through the writer's separate cookie
jar. There is no reader reload, post-mutation click or test-induced cache
invalidation. The document nonce is unchanged. Logout calls native close,
leaves no tracked live reader stream and makes `/auth/me` return 401.

## Complete isolated gate

Command from the candidate root:

```bash
env -u PYTEST_ADDOPTS GOLF_KEEP_FAILED_TMP=1 PLAYWRIGHT_SKIP_BROWSER_GC=1 bash scripts/test.sh
```

The first unchanged-runner pass used fresh source/venv/npm installations and
synthetic SQLite under `/tmp/golf-test-MXZ7YVpz`: 41 backend (6.93 s) and 20 E2E
(29.7 s) passed,
but that did not establish the ASGI 2.4 cleanup contract described above.
The final run under `/tmp/golf-test-n00kgyjw` uses the corrected response and supplemental tests. No test
filters were used in either complete run.

| Check | Result |
|---|---|
| Wrapper regressions | 6 PASS |
| Backend pytest, final corrected gate | 50 PASS, 7.44 s; 277 warnings |
| Frontend ESLint | PASS |
| Lint-gate regressions | 4 PASS |
| Build-config regressions | 2 PASS |
| TypeScript + Vite 7.3.6 build | PASS |
| Chromium E2E | 20 PASS, 28.0 s; new realtime case 2.4 s |
| Full runner exit code | 0 |
| Ruff lint/format, both changed Python files | PASS |
| Resolved Python dependency compatibility | 49 packages compatible |

Runtime: Node 26.2.0, npm 11.16.0, uv 0.11.21, Python 3.12.13,
Playwright 1.59.1. After completion the full-runner temporary tree was confirmed
removed and neither loopback port 8000 nor 5173 had a listener. Browser binaries
were not installed or removed by this lane. Source candidate remains separate
for review; this table is not independent reviewer acceptance or canonical
publication evidence.

## Advisory audit: two remaining findings, not zero

`pip-audit 2.10.1`, checked 2026-09-07, audited the full frozen 49-package set:

```bash
uv pip freeze --python backend/venv/bin/python |
  uvx pip-audit --no-deps --disable-pip -r /dev/stdin --format json
```

It returned exit code 1: **two advisories in two packages**, no skipped package
and no suppressed advisory. FastAPI 0.141.1 and Starlette 1.6.0 each had zero
returned advisory records. The seven previous Starlette GHSAs are outside the
new resolved affected ranges: f96h-pmfr-66vw, 2c2j-9gv5-cj73, 86qp-5c8j-p5mr,
wqp7-x3pw-xc5r, x746-7m8f-x49c, 82w8-qh3p-5jfq and jp82-jpqv-5vv3.

| Remaining package | Advisory | Scope / follow-up |
|---|---|---|
| ecdsa 0.19.2 | GHSA-wj6h-64fc-37mp / CVE-2024-23342 | Timing side channel in signing/key generation/ECDH; no planned fixed version, verification unaffected according to upstream. Transitive dependency of python-jose. Golf defaults to HS256 and decodes against one explicitly configured algorithm. Both resolved JOSE ECKey and HMACKey use cryptography_backend. This limits the identified call surface but does not remove the package advisory or prove arbitrary deployment configuration safe. |
| pytest 8.4.2 | GHSA-6w46-j5rx-g56g / CVE-2025-71176 | UNIX tmpdir handling, fixed in 9.0.3. Dev requirements currently constrain pytest below 9; two existing isolation tests use tmp_path. A separate dev-tool upgrade/compatibility gate is needed; no silent dev-requirements edit is bundled. |

The coordinator separately observed zero open GitHub Dependabot alerts after
dependency8. That is a narrower remote inventory/result and does not override
the fuller resolved-environment pip-audit findings above. No zero-vulnerability
or production-exploit claim follows from either service.

Complete resolved Python tuple from both the focused candidate and full runner:

```text
alembic==1.19.2
annotated-doc==0.0.5
annotated-types==0.8.0
anyio==4.15.1
argon2-cffi==23.1.0
argon2-cffi-bindings==26.1.0
certifi==2026.7.22
cffi==2.1.1
click==8.5.0
cryptography==50.0.1
dnspython==2.8.0
ecdsa==0.19.2
email-validator==2.2.0
fastapi==0.141.1
greenlet==3.5.5
gunicorn==22.0.0
h11==0.16.0
httpcore==1.0.9
httptools==0.8.0
httpx==0.28.1
idna==3.19
iniconfig==2.3.0
mako==1.4.1
markupsafe==3.0.3
packaging==26.3
pluggy==1.6.0
psycopg==3.3.5
psycopg-binary==3.3.5
pyasn1==0.6.4
pycparser==3.0
pydantic==2.9.2
pydantic-core==2.23.4
pydantic-settings==2.15.0
pygments==2.21.0
pytest==8.4.2
python-dotenv==1.2.3
python-jose==3.5.0
python-multipart==0.0.32
pyyaml==6.0.3
rsa==4.9.1
six==1.17.0
sqlalchemy==2.0.35
starlette==1.6.0
typing-extensions==4.16.0
typing-inspection==0.4.4
uvicorn==0.30.6
uvloop==0.22.1
watchfiles==1.2.0
websockets==17.1
```

This is an evidence snapshot, not a complete lockfile: the framework pair is
pinned, but other requirements still contain ranges, so future installs require
a fresh resolution, audit and gate.

## Limits and next decisions

Retained warnings include existing naive utcnow calls, legacy multipart imports,
HTTPX TestClient deprecation and the 526.95 kB / gzip 146.92 kB JS chunk warning.
No HTTPX2 migration, broad datetime rewrite or bundle splitting is smuggled into
this framework slice. TestClient remains supported by the resolved version but
emits a migration warning.

Only Chromium and local synthetic SQLite were exercised. No production DB,
PostgreSQL load test, reverse-proxy SSE buffering/timeout, network reconnect,
multi-worker broadcaster, every application screen, native Windows development
path or old-browser runtime was verified. ASGI lifetime/cleanup tests and browser
observations complement each other; neither alone proves every realtime mode.
The existing runner trusts host startup hooks; it is not an arbitrary-host-code
sandbox. Future work should first isolate the pytest security update, then make
an explicit decision about JOSE/transitive ecdsa rather than uninstalling its
required dependency or ignoring the advisory.

## Primary sources checked on 2026-09-07

- [FastAPI 0.132.1 metadata: former Starlette upper bound](https://pypi.org/pypi/fastapi/0.132.1/json)
- [FastAPI 0.133.0 metadata: first Starlette 1.x support](https://pypi.org/pypi/fastapi/0.133.0/json)
- [FastAPI 0.141.1 metadata](https://pypi.org/pypi/fastapi/0.141.1/json)
- [Starlette 1.3.1 metadata / security floor](https://pypi.org/pypi/starlette/1.3.1/json)
- [Starlette 1.6.0 metadata](https://pypi.org/pypi/starlette/1.6.0/json)
- [FastAPI dependency lifetime and streaming](https://github.com/fastapi/fastapi/blob/0.141.1/docs/en/docs/advanced/advanced-dependencies.md)
- [FastAPI release notes: Starlette support, cleanup and strict Content-Type](https://github.com/fastapi/fastapi/blob/0.141.1/docs/en/docs/release-notes.md)
- [FastAPI 0.141.1 effective route contexts](https://github.com/fastapi/fastapi/blob/0.141.1/fastapi/routing.py)
- [Starlette 1.6.0 URL construction](https://github.com/Kludex/starlette/blob/1.6.0/starlette/datastructures.py)
- [Starlette 1.6.0 streaming disconnect behavior](https://github.com/Kludex/starlette/blob/1.6.0/starlette/responses.py)
- [Starlette 1.6.0 BaseHTTPMiddleware receive path](https://github.com/Kludex/starlette/blob/1.6.0/starlette/middleware/base.py)
- [Uvicorn 0.30.6 ASGI 2.4 declaration and disconnected send](https://github.com/Kludex/uvicorn/blob/0.30.6/uvicorn/protocols/http/httptools_impl.py)
- [ECDSA advisory, official GitHub record](https://github.com/advisories/GHSA-wj6h-64fc-37mp)
- [Pytest tmpdir advisory, official GitHub record](https://github.com/advisories/GHSA-6w46-j5rx-g56g)
