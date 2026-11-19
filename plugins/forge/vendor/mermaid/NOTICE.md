# Third-party notice: Mermaid

The wiki page and the ticket canvas of Forge draw a Mermaid block with the file `mermaid.tiny.js`. It is the only third-party program in the plugin.

| Item | Value |
|---|---|
| File | `mermaid.tiny.js` |
| Package | `@mermaid-js/tiny` 12.3.0, the file `dist/mermaid.tiny.js` |
| Source | https://github.com/mermaid-js/mermaid |
| Archive | https://registry.npmjs.org/@mermaid-js/tiny/-/tiny-12.3.0.tgz |
| Integrity of the archive | `sha512-90BO2kQvmQWj9YjBX2IsLHCw61rN69dPTn5wFfDu+b9aT7qtzfzTA3wpKWeaRAKK85refSo9How5EOeY39DWfA==` |
| SHA-256 of the file | `c41f5236091b83f524c4940f97a16b2b14a76f21ff84aea4fd6b66421d8a2a9a` |
| License | MIT, see [LICENSE](LICENSE). The file also has the license notes of the libraries inside it. |

The file is the same as in the package: no byte changed, and it keeps its LF line ends.
This build has no mindmap diagram, no architecture diagram, and no KaTeX math.
A page loads the file from its own folder or from its own Forge server, never from a network.

## Update

1. Download the package into an empty folder: `npm pack @mermaid-js/tiny@<version>`.
2. Compare the SHA-512 of the archive with `npm view @mermaid-js/tiny@<version> dist.integrity`.
3. Replace `mermaid.tiny.js` and `LICENSE` with the files of the package.
4. Change `MERMAID_VERSION` and `MERMAID_SHA256` in `scripts/lib/mermaid.mjs`, and the table of this file.
5. Run `npm test`. Then look at a wiki page with a diagram, in the light and the dark theme.
