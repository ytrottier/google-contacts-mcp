# Upstream contribution drafts (domdomegg/google-contacts-mcp)

Texts ready to paste for Adam Jones's repo. Every branch is cut from upstream `master` at `80591d6` (v1.3.0), which upstream `master` was still at on 2026-10-08. Each one stands alone.

**Submission order**

1. PR: partial name/organization updates (section 1): `fix/partial-name-org-update`
2. PR: bind HTTP server to localhost (section 2): `fix/bind-localhost`
3. PR: "other contacts" tools (section 3): `feat/other-contacts`
4. Optional PR: dependency update (section 4): `chore/npm-audit-fix`
5. Issue first, then PRs only if Adam wants them (section 5): stdio refresh token, photo from file, disable delete tools

To open a PR from the fork: on GitHub, go to `ytrottier/google-contacts-mcp`, open the branch, click *Contribute → Open pull request* with base `domdomegg/google-contacts-mcp:master`, then paste the title and body below.

---

## 1. PR: Preserve existing name and organization fields on partial `contact_update`

**Branch:** `fix/partial-name-org-update`

**Title:** Preserve existing name and organization fields on partial contact_update

**Body:**

`contact_update` sends `names` / `organizations` with `updatePersonFields=names` / `organizations`. The People API replaces every field listed in `updatePersonFields`, so today:

- passing only `jobTitle` erases the company name, and passing only `organization` erases the job title
- passing only `givenName` erases the family name (and any middle name, prefix and so on)
- any update to `organization`/`jobTitle` drops every *other* organization on the contact, plus sub-fields such as `department`

**Change**

When any of `givenName`, `familyName`, `organization` or `jobTitle` is given, the tool first fetches the contact (`personFields=names,organizations&sources=READ_SOURCE_TYPE_CONTACT`). It then merges the supplied values into the current data:

- **Names:** the supplied values go over the existing name. Structured sub-fields such as `middleName` and `honorificPrefix` are kept. The derived fields (`displayName`, `displayNameLastFirst`, `unstructuredName`) and `metadata` are not sent back.
- **Organizations:** the supplied values go over the primary organization, or the first one if none is primary. Its other sub-fields and all other organizations are kept. If the contact has no organization, one is added.
- **Contact data only:** `people.get` returns profile and contact sources by default. For a contact linked to a Google or Workspace profile, that would let the merge copy profile names and organizations into the contact. The GET therefore asks for `READ_SOURCE_TYPE_CONTACT` only, and any entry whose `metadata.source.type` is something other than `CONTACT` is ignored as well. Only the contact's own entries are merged and written back.

The PATCH still sends the **caller's** etag, so Google still rejects writes based on stale data. That rejection (400 `FAILED_PRECONDITION`) is now reported as "Contact … changed since you read it … re-read it with contact_get and retry". I chose not to compare etags locally, because the etag from `contact_search`/`contacts_list` may not match one fetched with a different field mask. Google's own check covers this case anyway.

Updates that don't touch names or organizations behave exactly as before, with no extra request.

`contact_create` uses the same shape but starts from an empty contact, so it can't erase anything. It's unchanged.

**Tests** (`src/tools/contact-update.test.ts`, stubbed `fetch` with no network, checking the URL, method and JSON body):

- a title-only update keeps the company and department
- a given-name-only update keeps the middle and family names
- a second organization survives
- an organization is created when there is none
- only CONTACT-source organizations and names are written back; PROFILE-source ones from a linked profile are left out
- email-only updates make no extra GET
- a stale etag produces the clear error

`npm run lint && npm run build && npm test` pass.

This change was prepared with Claude's help and reviewed by me.

---

## 2. PR: Listen on 127.0.0.1 by default in HTTP mode

**Branch:** `fix/bind-localhost`

**Title:** Listen on 127.0.0.1 by default in HTTP mode (configurable with HOST)

**Body:**

`app.listen(port)` binds to all interfaces, so the OAuth proxy and `/mcp` are reachable from the local network. The default `MCP_BASE_URL` is `http://localhost:<port>`, so a local user doesn't need that exposure.

This adds a `HOST` env var, defaulting to `127.0.0.1`, and documents `HOST=0.0.0.0` in the README for container and remote deployments.

**Note: this changes default behaviour.** Anyone currently reaching the server from another machine or container without setting a host will need `HOST=0.0.0.0`. If you host this publicly and would rather keep `0.0.0.0` as the default, I'm happy to flip it and keep just the env var.

Tests: `src/main.test.ts` mocks `express` and checks the address passed to `listen` with and without `HOST`. I also checked by hand that the server binds to `127.0.0.1` only. `npm run lint && npm run build && npm test` pass.

This change was prepared with Claude's help and reviewed by me.

---

## 3. PR: Add tools for "other contacts"

**Branch:** `feat/other-contacts`

**Title:** Add other_contacts_list, other_contacts_search and other_contact_copy_to_contacts

**Body:**

"Other contacts" are people you've interacted with, e.g. emailed, but never saved. For me they're the main source of new contacts. This adds three tools for the People API `otherContacts` endpoints:

| Tool | Endpoint |
|------|----------|
| `other_contacts_list` | `GET /v1/otherContacts` (`readMask=names,emailAddresses,phoneNumbers`, `pageSize`, `pageToken`) |
| `other_contacts_search` | `GET /v1/otherContacts:search` (`query`, same `readMask`, `pageSize` ≤ 30) |
| `other_contact_copy_to_contacts` | `POST /v1/otherContacts/{id}:copyOtherContactToMyContactsGroup` (`copyMask=names,emailAddresses,phoneNumbers`). Returns the new `people/…` contact, so its resource name and etag can go straight into `contact_update`. |

Naming follows `contacts_list` / `contact_search`. The README tool table is updated.

**Scope / re-consent:** this needs `https://www.googleapis.com/auth/contacts.other.readonly`, which I've added to `CONTACTS_SCOPES`. **Existing users must re-consent** (sign in again) before the new tools work. Their existing tokens don't carry the new scope, and Google returns 403 for these endpoints until they do. Copying to "My Contacts" itself is covered by the existing `contacts` scope.

The search description mentions that Google may return empty results for the first search while it warms its cache.

Tests: `src/tools/other-contacts.test.ts` (stubbed `fetch`, checking the URL, method and body for each tool). `npm run lint && npm run build && npm test` pass.

This change was prepared with Claude's help and reviewed by me.

---

## 4. Optional PR: Update vulnerable dependencies

**Branch:** `chore/npm-audit-fix`

Send this only if Dependabot still hasn't updated these when you submit. On 2026-10-08 upstream `master` had no open Dependabot branch for them. The SDK bump also needs a small type fix (below), which may be why it hasn't gone through on its own.

**Title:** Update @modelcontextprotocol/sdk, proxy-addr and fast-uri (npm audit)

**Body:**

`npm audit --omit=dev` at `master` reports:

- `@modelcontextprotocol/sdk` < 1.30.2: GHSA-345p-7cg4-v4c7, GHSA-8r9q-7v3j-jr4g, GHSA-6qxp-vccf-f47h
- `proxy-addr` ≤ 2.0.7: GHSA-jqcg-44mw-7w3h
- `fast-uri` ≤ 3.1.7: GHSA-hrr3-gc8f-f4qj

This is `npm audit fix`, a lockfile-only change: the SDK goes 1.24.3 → 1.32.1, `proxy-addr` to 2.0.8, `fast-uri` to 3.1.8. After it, `npm audit --omit=dev` reports 0 vulnerabilities.

SDK 1.32 no longer type-checks under `exactOptionalPropertyTypes` in `src/main.ts`, so this also:

- drops the explicit `sessionIdGenerator: undefined`. Omitting it gives the same stateless mode.
- casts the transport passed to `server.connect` to `Transport`, because the SDK class declares its optional callbacks as `| undefined`.

I checked that stdio and HTTP `tools/list` still work. `npm run lint && npm run build && npm test` pass.

This change was prepared with Claude's help and reviewed by me.

---

## 5. Issue (ask first): stdio without a raw access token, photo from file, and turning off delete tools

**Title:** Would you accept: stdio mode with a saved refresh token, photo upload from a local file, and an option to disable delete tools?

**Body:**

Hi Adam, thanks for this server. I use it from Claude Desktop on Windows, and I've built three things on my fork that I'd be glad to upstream. I know some of them cut against the "holds no tokens or state" design, so I'm asking before opening PRs. A "no" is completely fine.

**1. stdio mode with a saved refresh token** (branch `feat/stdio-refresh-token`)

Today stdio needs a raw `GOOGLE_ACCESS_TOKEN`, which expires after an hour. HTTP mode needs a long-running server plus a bridge for Claude Desktop. My change:

- `node dist/main.js auth` / `npm run auth` runs Google's installed-app loopback flow: `127.0.0.1` on a random port, PKCE, a Desktop-app OAuth client via `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`. It opens the browser and also prints the URL.
- It saves the refresh token to `%APPDATA%\google-contacts-mcp\token.json` on Windows or `~/.config/google-contacts-mcp/token.json` elsewhere, with mode 0600. `GOOGLE_CONTACTS_TOKEN_FILE` overrides the path. No native dependencies.
- In stdio mode without `GOOGLE_ACCESS_TOKEN`, the server refreshes access tokens shortly before they expire, and once more on a 401. A revoked or missing token gives a clear "run `npm run auth` again" error.
- `Config.token` becomes `string | TokenProvider`, so every tool call site stays the same. HTTP mode and `GOOGLE_ACCESS_TOKEN` are unchanged.

This does store a token on disk, which contradicts the README's "holds no tokens or state". It only applies to this opt-in stdio path, though.

**2. `contact_photo_update_from_file`** (branch `feat/photo-from-file`)

Passing a portrait as base64 `photoBytes` costs a lot of tokens per photo. This tool takes `{resourceName, path}` and is only registered when `PHOTO_DIR` is set. Checks:

- the path must `realpath` to a regular file inside `PHOTO_DIR`, so `..` and symlink escapes are rejected
- JPEG/PNG only, checked by magic bytes
- 5 MB maximum

It calls the same `:updateContactPhoto` endpoint.

**3. `DISABLE_DELETE_TOOLS=1`** (branch `feat/disable-destructive`)

The People API has no trash. This env var leaves out `contact_delete`, `contact_photo_delete` and `contact_group_delete`. It's a few lines in `src/tools/index.ts`.

All three have tests with stubbed `fetch` and temporary directories, and pass lint, build and test. Would you like any of these as PRs, and in what shape (for example, options passed through `Config` instead of read from env)?

This was prepared with Claude's help and reviewed by me.
