# Public TypeScript API snapshots

These files fingerprint the declaration closure reachable from every published `types` export. The snapshot normalizer removes comments and source-map comments so release-note wording and documentation edits do not masquerade as TypeScript API changes.

`npm run api:check` fails when an exported declaration changes, appears, disappears, or moves. Intentional API changes require review followed by `npm run api:update`. Package version numbers are deliberately excluded from the fingerprint.
