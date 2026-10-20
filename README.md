<h1 align="center">Restore One Block</h1>

<p align="center">
  <a href="https://playground.wordpress.net/?blueprint-url=https://raw.githubusercontent.com/aryanjasala/restore-one-block/main/blueprint.json"><img src="https://img.shields.io/badge/Try%20in-WordPress%20Playground-3858e9?logo=wordpress&logoColor=white" alt="Try in WordPress Playground"></a>
  <a href="https://github.com/aryanjasala/restore-one-block/releases/latest"><img src="https://img.shields.io/github/v/release/aryanjasala/restore-one-block?label=release&color=2271b1" alt="Latest release"></a>
  <img src="https://img.shields.io/badge/WordPress-6.6%2B-3858e9?logo=wordpress&logoColor=white" alt="WordPress 6.6+">
  <img src="https://img.shields.io/badge/PHP-7.4%2B-777bb4?logo=php&logoColor=white" alt="PHP 7.4+">
  <a href="LICENSE.md"><img src="https://img.shields.io/badge/license-GPL--2.0--or--later-blue" alt="License: GPL-2.0-or-later"></a>
  <br>
  <a href="https://github.com/aryanjasala/restore-one-block/actions/workflows/phpcs.yml"><img src="https://github.com/aryanjasala/restore-one-block/actions/workflows/phpcs.yml/badge.svg" alt="PHPCS"></a>
  <a href="https://github.com/aryanjasala/restore-one-block/actions/workflows/phpstan.yml"><img src="https://github.com/aryanjasala/restore-one-block/actions/workflows/phpstan.yml/badge.svg" alt="PHPStan"></a>
  <a href="https://github.com/aryanjasala/restore-one-block/actions/workflows/unit-tests.yml"><img src="https://github.com/aryanjasala/restore-one-block/actions/workflows/unit-tests.yml/badge.svg" alt="Unit tests"></a>
  <a href="https://github.com/aryanjasala/restore-one-block/actions/workflows/e2e-tests.yml"><img src="https://github.com/aryanjasala/restore-one-block/actions/workflows/e2e-tests.yml/badge.svg" alt="E2E tests"></a>
  <a href="https://github.com/aryanjasala/restore-one-block/actions/workflows/plugin-check.yml"><img src="https://github.com/aryanjasala/restore-one-block/actions/workflows/plugin-check.yml/badge.svg" alt="Plugin Check"></a>
</p>

<p align="center">Restore a single block from an old revision instead of rolling back the whole post.</p>

<p align="center">
  <img src=".wordpress-org/screenshot-2.png" alt="Picking an earlier version of one block, with its changes highlighted" width="880">
</p>

---

WordPress revisions are all or nothing. If someone deleted a paragraph last week and the post has been edited ten times since, restoring the revision brings the paragraph back and throws away the ten edits. Restore One Block works inside the editor and restores single blocks, with all their settings, as a normal undoable change.

## Features

- **Block menu > Restore from a revision…**: that block's versions in each revision, best match first
- **Editor menu > Restore blocks from a revision**: every block marked *Same as now*, *Changed since* or *Not in the post now*
- **Restore it here** puts a deleted block back where it was
- **Show changes** highlights the words that differ from the current block
- **Find text in old revisions** searches every revision and jumps to the block that had it
- Revision authors, difference counts, autosaves labelled, arrow-key navigation
- Any block, including blocks from other plugins and blocks inside groups and columns
- Ctrl+Z undoes a restore, and nothing is saved until you update the post

## Install

1. Download `restore-one-block.zip` from the [latest release](https://github.com/aryanjasala/restore-one-block/releases/latest).
2. In WordPress, go to **Plugins > Add New Plugin > Upload Plugin**, choose the zip and activate it.

Or with WP-CLI:

```sh
wp plugin install https://github.com/aryanjasala/restore-one-block/releases/latest/download/restore-one-block.zip --activate
```

Needs WordPress 6.6+ and PHP 7.4+. To try it first, the **Try in WordPress Playground** badge opens a throwaway WordPress in your browser with the plugin and some demo content.

## Quick look

Select a block, open its menu (⋮) and choose **Restore from a revision…**. The closest older version is marked **Best match**, and **Show changes** shows exactly what a restore would change before you click **Replace current block**.

There is no build step and nothing is stored: revisions are read through the REST API with `_fields=content.raw`, so the server never renders them just to list them.

## Screenshots

<table>
  <tr>
    <td width="50%" valign="top"><img src=".wordpress-org/screenshot-1.png" alt="Restoring a deleted paragraph from a revision"><br><sub>Restoring a deleted paragraph from a revision</sub></td>
    <td width="50%" valign="top"><img src=".wordpress-org/screenshot-3.png" alt="Finding deleted text across revisions"><br><sub>Finding deleted text across revisions</sub></td>
  </tr>
</table>

## Documentation

| Doc | What it covers |
| --- | --- |
| [Reference](docs/REFERENCE.md) | How matching works, the scripts, and the REST field |
| [Development](docs/DEVELOPMENT.md) | Local setup, commands and tests |
| [Contributing](docs/CONTRIBUTING.md) | Pull requests, required checks and PR titles |
| [Releasing](docs/RELEASING.md) | How merged pull requests become releases |
| [Security](docs/SECURITY.md) | Reporting a vulnerability |
| [readme.txt](readme.txt) | What WordPress.org shows, with the FAQ and changelog |

## Project structure

```
restore-one-block.php     plugin header and PSR-4 autoloader
src/
├── Plugin.php            registers the services, lists supported post types
├── Editor/Assets.php     loads the editor scripts
└── Rest/RevisionAuthor.php  author name on revision REST responses
assets/
├── js/matching.js        matching, diff and search (no WordPress dependency)
├── js/components.js      the restore window
├── js/index.js           the menu entries
└── editor.css
tests/
├── Unit/                 PHPUnit
├── js/                   Node unit tests
└── e2e/                  Playwright specs and the Docker site
.wordpress-org/           screenshots
docs/                     reference, development, contributing, releasing
```

## License

[GPL-2.0-or-later](LICENSE.md) © Aryan Jasala
