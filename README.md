# Personal extension installer for DeepSeek Harness and DSH Next

[中文说明](README.zh.md)

Install nine personal extensions into an **installed official DeepSeek Harness or DSH Next desktop application on Windows**. The [one-command installer](#one-command-latest-install) selects the latest stable Profile release automatically and uses the selected application’s bundled Node, Electron and pnpm. Windows PowerShell 5.1 is sufficient; no separate Node, pnpm or Git installation is required.

This is a thin version-lock and installer repository. Plugin source is maintained in [DSH-Next-Plugins](https://github.com/xue-ding-e/DSH-Next-Plugins) or its upstream repositories. Release ZIPs include only the installer and prebuilt plugin tgz files; they contain no Harness application or Harness source tree.

The collection includes `dsh-browser-control`, `dsh-nav-buttons`, `dsh-input-guard`, `dsh-whale-boot`, `dsh-bsk-bridge`, `dsh-retry-tuning`, `dsh-plugin-subscriptions`, `dsh-qoder-connect` and `dsh-chat-import`.

These nine plugins are the default preset. The installer accepts any nonempty manifest with unique valid npm package names and exact versions/hashes, including a single scoped package. Add or remove manifest entries to change the recipe; no CLI code change is needed. Removing an entry stops managing it; uninstall an existing package separately with the selected host's supported plugin CLI.

The frozen v0.1.0 candidate has completed a real isolated Next smoke: the installed native CLI installed and enabled all nine packages, a repeat returned `changed: false` with identical `package.json` bytes, and the normal desktop Host reached `ready`, acknowledged `shutdown-complete`, and exited with code 0. The smoke used a blank isolated home and OS-user environment with no credentials. An unauthenticated HTTP 401 from the web app is expected native authentication; it is not a plugin installation failure. GUI rendering remains unverified.

## Install on a new computer

1. Install **DSH Next** to reproduce the source-owned Next features, or official DeepSeek Harness for the external plugin subset, then fully quit it, including its tray icon. Closing the window alone may leave the application running. The CLI initializes a pristine profile through the installed Host's own initializer; an incomplete existing profile still needs recovery by opening Desktop once.
2. Download the Windows ZIP from this repository's Releases and extract the entire ZIP into a local folder. Keep `Install.cmd`, `installer/`, `src/`, `profile/` and `artifacts/` together. Do not run it inside the ZIP viewer.
3. Double-click `Install.cmd`. Installation may download ordinary runtime dependencies from the npm registry, so network access can be required even though all nine plugin archives are included.
4. Wait for verification of nine dependencies and nine selected bundles, then restart the selected desktop client. A missing login, PAT, OAuth authorization, browser binding or video file requires separate setup below.

Discovery reads uninstall registrations, Start Menu shortcuts and running application locations for both products. Double-click installation prompts for a choice when several installations are found; CLI/check/dry-run usage requires an explicit selection. `--host original|next` always takes priority and must match the packaged identity. A mismatch stops installation instead of switching hosts or homes. Development checkouts are rejected.

```cmd
Install.cmd --host original --app-dir "C:\Apps\DeepSeek Harness" --dry-run
Install.cmd --host next --app-dir "C:\Apps\DSH Next" --check
Install.cmd --host next --app-dir "C:\Apps\DSH Next" --home "C:\Data\dsh-next"
```

The original host uses `DSH_HOME` or `%USERPROFILE%\.dsh`; Next uses `DSH_NEXT_HOME` or `%USERPROFILE%\.dsh-next`. `--home` overrides the selected host's default and must identify the directory that application actually uses. Installation can initialize a missing desktop profile; it does not manufacture missing files inside an incomplete existing profile. For a custom home, set the corresponding environment variable when launching that desktop host. The installer never copies a user's profile. It rejects the other host's known home, its ancestors/descendants, application installation directories and paths resolving into them through junctions. Installing into the original host is an explicit selection, not a fallback after Next detection fails.

`--dry-run` validates an initialized profile, runtime, shutdown state, locks and archive hashes without writing profile files. `check` / `--check` verifies installed versions, runtime files and `dsh.profile.bundles` without downloading archives; it still requires the application to be stopped. `doctor` reads the same inventory while the application runs and reports a missing profile without creating it. Both report package state separately from provider, runtime and GUI readiness. Add `--json` for machine-readable output. For an unattended command window, set the process variable `DSH_NEXT_INSTALL_NO_PAUSE=1` to suppress the final `pause`.

`--isolated` is reserved for a controlled packaged-host smoke. It requires explicit `--host`, `--app-dir` and `--home`; the home must be outside both normal `.dsh` and `.dsh-next` roots. The process guard may exclude a different installed process only when its executable path is proven outside the selected private app root. Unknown or selected process ownership still blocks the run. Normal installation keeps the full quit guard.

## Configure the installed plugins

| Plugin / integration | Setup after code installation |
| --- | --- |
| DSH and subscription providers | Sign in or authorize each provider you want to use. Antigravity may require an independently configured OAuth application. Missing authorization does not indicate a failed plugin installation. |
| Qoder Connect | Supply your own Qoder PAT through the plugin's configuration. The release contains no PAT. |
| BSK bridge | Explicitly bind the intended browser on this computer before use. A release must have no old browser ID and must fail clearly while unbound; it must not select an arbitrary browser. |
| Whale boot | Video resources are **not included** and remain to be supplied locally. Configure resources before using the video feature. |
| Browser control | Browser login state is local to the new computer. Authenticate to the sites you use. |
| Chat import | Choose local sources yourself after installation; the installer does not import conversations. |

The installer checks code installation and bundle selection. It does not log into providers, test PATs, authorize OAuth applications, bind browsers, download videos, or declare these integrations ready.

Native mouse AppCommand navigation in `dsh-nav-buttons` requires `globalThis.dshDesktop.protocolVersion === 1` and `dshDesktop.navigation.subscribe`. An original host lacking that IPC only gets the plugin's DOM pointer fallback; the installer does not certify native navigation. Browser control requires an Electron sidebar webview exposing `executeJavaScript` and `loadURL`. Its screenshot action has no supported public preload API and is unavailable in the collected implementation; use snapshot/read_text as appropriate. These feature limitations are reported separately from code installation and do not block Next installation. A real original-host GUI acceptance run is still required to establish its available features.

## One-command latest install

Fully quit DSH Next, including its tray icon, then run this line in **Windows PowerShell**. The working directory does not matter. Installation runs outside the DSH GUI chat:

```powershell
irm https://github.com/xue-ding-e/DSH-Next-Profile/releases/latest/download/Install-Latest.ps1 | iex
```

The default is `install` for host `next`. Every invocation queries GitHub’s latest stable release, selects that release’s immutable ZIP and checksum URLs, verifies SHA-256, and runs its `Install.ps1`. Downloaded files are temporary; installed plugin archives remain in the selected desktop profile. Restart DSH Next when verification succeeds. Run the same line again to install a newer release; it does not install a background updater or update the DSH desktop application.

For original Harness, a custom directory, read-only diagnosis or exact baseline matching, download the script and pass its options:

```powershell
Invoke-WebRequest https://github.com/xue-ding-e/DSH-Next-Profile/releases/latest/download/Install-Latest.ps1 -OutFile Install-Latest.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\Install-Latest.ps1 -HostKind next -Command doctor -MatchBaseline
```

The script accepts `-HostKind next|original`, `-AppDir`, `-HomeDirectory`, `-Command install|check|doctor|features` and `-MatchBaseline`. Original Harness requires an explicit `-HostKind original`. For a manual workflow, download the [latest Windows ZIP](https://github.com/xue-ding-e/DSH-Next-Profile/releases/latest/download/dsh-next-profile-windows.zip), extract it completely, then run `Install.cmd` as described above.

### pnpm alternative

Computers with Node 24.9+ and pnpm can use the stable full-package asset below. The cache option forces a new dlx resolution on every invocation; ordinary dlx caches a command for 24 hours. No npm registry publication or GitHub account token is needed:

```powershell
pnpm --config.dlx-cache-max-age=0 dlx --package="https://github.com/xue-ding-e/DSH-Next-Profile/releases/latest/download/dsh-next-profile.tgz" dsh-next-profile install --host next
```

The CLI supports `install`, `check`, `doctor`, `features`, `--app-dir`, `--home`, `--manifest`, `--dry-run`, `--json` and `--match-baseline`. For a reproducible older release, use its versioned asset URL; for a local candidate, use its built tgz path. GitHub’s generated source archives are not prebuilt installers.

`profile/manifest.json` records an exact skeleton baseline as well as plugin versions and SHA-256 hashes. `--match-baseline` refuses a different host, runtime version or installed application version before profile writes. `doctor` includes `baselineMatches` alongside package status. This pins installed code, not accounts, browser identity, conversations or appearance preferences. New-machine OAuth/PAT authorization, BSK installation/binding and local media remain the setup actions listed above.

`profile/feature-matrix.json` owns the complete-feature decisions. It keeps source-dependent GUI and runtime changes together, records existing external packages, and identifies the native navigation companion as still requiring the Next skeleton. `features` reads the hash-locked record without Desktop or network access. Installing plugins into official Harness provides the plugin subset; it does not add Next's source-owned features. Runtime/GUI equivalence requires the matching skeleton and the relevant functional checks, beyond the static package inventory.

The full v0.1.0 candidate is assembled from immutable plugin tgz bytes with `--archives`; it carries `profile/compatibility.json` as a hash-checked static evidence record. The record distinguishes source/API matches from runtime verification and retains the official-host preflight rejection and the native navigation IPC gap. It does not certify original-host GUI behavior or provider authorization.

## State, repeat installation and diagnostics

Each tgz is checked against the release manifest's SHA-256 before any profile write. Manifest paths must stay inside the release directory after link resolution. The installer caches the verified archives under `profiles/desktop/.extension-pack/artifacts/` so profile dependency references survive deletion of the downloaded release folder.

Installation uses the supported installed CLI: `dsh plugin --profile desktop add <cached local tgz paths>`. The selected home is mapped into `DSH_HOME` for that child process; Next also receives `DSH_NEXT_HOME`, while the original host's child has Next-only variables removed. The installer honors both the desktop profile `lock` and `package.json.lock`; it does not delete stale locks or stop an already running desktop host. Existing disabled collection bundles are enabled using the installed runtime's own writer lock and atomic writer. Other profile selections are retained.

Repeating a verified release is a no-op when its successful receipt and installed packages/bundles match. A failed attempt returns a nonzero exit status and preserves CLI diagnostics under `profiles/desktop/.plugin-manager/logs/`. Follow the printed error, fully quit the selected host, and rerun. If a stale lock or package-operation record remains, recover it with that host or its supported plugin CLI before retrying; do not delete a live operation's lock. A failed operation can leave downloaded modules or cached archives, so verify with `--check` before restarting.

The installer does not read or rewrite account credentials, workspaces or sessions. It writes only plugin package state and its own cache/receipt inside the chosen desktop profile. Keep the printed diagnostic message when reporting a failure; review logs for sensitive provider output before sharing them.

## Build a release

Use Node 24.9+ and pnpm 11.28.5 on the build machine. Keep each plugin's source, **built `lib/` output**, runtime assets and upstream license in the separate Plugins repository at `plugins/<name>/`. The Profile repository does not track plugin source; `vendor/` is ignored as a transition backup. The build never compiles plugins, installs their dependencies, or changes the external source tree. Remove machine-specific paths and credentials first; leave BSK explicitly unbound and Whale resources unconfigured.

Create `profile/manifest.json` with schema version 1 and the desired nonempty plugin list:

```json
{
  "schemaVersion": 1,
  "plugins": [
    {
      "name": "dsh-browser-control",
      "version": "1.0.0",
      "source": "plugins/dsh-browser-control",
      "url": "https://github.com/xue-ding-e/DSH-Next-Plugins/releases/download/<tag>/dsh-browser-control-1.0.0.tgz",
      "sha256": "<64 lowercase hexadecimal characters>"
    }
  ]
}
```

The single entry illustrates a valid custom recipe; the default recipe lists the nine plugins above. `name` and exact `version` are required. `source` is relative to `--sources`, without traversal or links outside that root. It can be omitted when `url` and `sha256` lock a prebuilt public HTTPS tgz. With `--sources`, the source package version and any supplied archive hash must match the lock. A source-only bootstrap recipe may omit `url`/`sha256`; it cannot be consumed by the installer until public URLs and hashes are filled. Every installation manifest requires an exact SHA-256 for each plugin. The collection version comes from the root `package.json`.

```powershell
node --test tests/*.test.mjs
node scripts/build-release.mjs --sources ../DSH-Next-Plugins --manifest profile/manifest.json --output scripts/.output
node scripts/smoke-package.mjs --directory scripts/.output/package
```

After freezing plugin archives, assemble without repacking them:

```powershell
node scripts/build-release.mjs `
  --archives .output/plugins-v0.1.0/artifacts `
  --manifest profile/manifest.json `
  --compatibility profile/compatibility.json `
  --output .output/full-v0.1.0
node scripts/smoke-package.mjs --directory .output/full-v0.1.0/package
```

Use a fresh output directory for each build; an existing `package/` is refused. Windows builds create the ZIP using system PowerShell/.NET. Other platforms need the `zip` executable or can use `--no-zip` to build only the tgz. Without `--sources`, the builder downloads locked URLs and uses system `tar` to inspect/extract them before accepting them. No additional Node dependencies are needed. To produce a thin package after all URLs/hashes are published, run `pnpm pack` at the repository root; its prepack smoke validates the required files and locks.

The builder uses npm's maintained packlist internally to stage plugin archives, removes development dependencies and all plugin lifecycle scripts, and retains runtime dependencies and licenses. End users use pnpm for `dlx`; the CI release job uses its controlled npm pack step for the final thin archive. Downloaded tgz files must already be built without scripts/development dependencies. Nonportable dependency specifications, missing built exports/patches/licenses, private account/browser files, old drive paths, recognized secret formats and the old BSK browser binding stop packaging. Downloaded archives containing links, special entries or duplicate paths are rejected. The checks reject known problems; maintainers still review plugin contents before publishing.

For an additional exact deny list, set `DSH_PROFILE_DENY_SECRETS_FILE` to a private JSON file outside the repository containing an array of secret strings. The builder scans bytes for these values and refuses a match without printing the value. The file and values are never copied into an artifact. Secret-regression tests use synthetic values only. The root MIT license applies to installer code; each plugin archive preserves its own upstream license.

The full build's `profile/manifest.json` contains `schemaVersion: 1` and one entry per selected plugin with `name`, exact `version`, `archive` (such as `artifacts/dsh-browser-control-1.0.0.tgz`) and lowercase hexadecimal `sha256`. Absolute source paths are never recorded. The Windows ZIP and full npm tgz contain this release manifest, `src/`, `installer/`, LICENSE and every selected plugin tgz file. The ZIP also has `Install.cmd` at its root. A thin npm package instead retains public URL locks and downloads them at installation. The output directory includes `SHA256SUMS` for the outer release files. Hashes detect changed files relative to the manifest; they do not authenticate the publisher, so obtain the release from a trusted source.

Tests use `node:test` with disposable fixtures. They cover hash/path rejection, both hosts' home isolation, initialized profiles, locks, CLI arguments/environment, failure propagation, idempotence, bundle verification, private-data rejection, public URL locks and real pnpm/npm package packing. Set `DSH_NEXT_TEST_APP_DIR` to an actual Next installation directory to additionally exercise its Electron probe, installed atomic writer and PowerShell shutdown guard against disposable profile fixtures. No running desktop is stopped. Tests do not assert provider readiness or replace real isolated-profile acceptance for each host.

Published-package smoke tests allocate private pnpm caches and stores and use the fixture’s isolated user environment. On Windows, the runner uses the system proxy for public downloads when no explicit environment or pnpm proxy is configured; loopback requests retain their direct route. Command deadlines retain the operation name and captured output, terminate the command’s process family, and wait for its output pipes to close before reporting failure.
