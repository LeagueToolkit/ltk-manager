# Quickstart: LTK Protocol Install List

## Try it against a local manifest

The manager refuses a local or private host, so serve the manifest from a host it accepts, or
point a hosts entry at a local server with a trusted certificate. The quickest path is a public
host you control.

1. Publish a manifest per [the contract](contracts/install-list-manifest.md) with two or three
   items whose `download` is `{ "method": "GET", "url": "https://<host>/<file>.modpkg" }`.
2. Follow the link from a browser, or from a shell:

   ```powershell
   Start-Process "ltk://install-list?url=https://<host>/list.json&source=Test"
   ```

3. The dialog opens with the list. Confirm. Each row moves through its stages, and the report
   closes the run.
4. Follow the link again: every row is marked Installed and nothing is offered.

## Run the checks

```powershell
cargo test -p ltk-manager-core deep_link
cargo test -p ltk-manager-library
pnpm exec vitest run src/modules/deep-link
pnpm check
```
