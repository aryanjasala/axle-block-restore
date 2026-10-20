# Restore One Block

[![PHPCS](https://github.com/aryanjasala/restore-one-block/actions/workflows/phpcs.yml/badge.svg)](https://github.com/aryanjasala/restore-one-block/actions/workflows/phpcs.yml) [![PHPStan](https://github.com/aryanjasala/restore-one-block/actions/workflows/phpstan.yml/badge.svg)](https://github.com/aryanjasala/restore-one-block/actions/workflows/phpstan.yml) [![Unit tests](https://github.com/aryanjasala/restore-one-block/actions/workflows/unit-tests.yml/badge.svg)](https://github.com/aryanjasala/restore-one-block/actions/workflows/unit-tests.yml) [![E2E tests](https://github.com/aryanjasala/restore-one-block/actions/workflows/e2e-tests.yml/badge.svg)](https://github.com/aryanjasala/restore-one-block/actions/workflows/e2e-tests.yml) [![Plugin Check](https://github.com/aryanjasala/restore-one-block/actions/workflows/plugin-check.yml/badge.svg)](https://github.com/aryanjasala/restore-one-block/actions/workflows/plugin-check.yml)

Restores a single block from an old revision instead of rolling back the whole post. Brings back a deleted paragraph, or an earlier version of one section, without undoing the edits made since.

![Restoring a deleted paragraph from a revision](.wordpress-org/screenshot-1.png)

## Features

- **Block menu > Restore from a revision…** lists that block's versions in each revision, best match first, with **Replace** or **Insert below**
- **Editor menu > Restore blocks from a revision** compares a revision's blocks with the post now (*Same as now*, *Changed since*, *Not in the post now*) and puts a deleted block back where it was
- **Show changes** highlights the words that differ between the current block and the old version
- **Find text in old revisions** searches every loaded revision and jumps to the block that had it
- Each revision shows who saved it and how many blocks differ from now. Autosaves are labelled, and the window opens on the newest revision that actually differs
- Every restore is a normal editor change: Ctrl+Z (⌘Z) undoes it, and nothing is saved until the post is updated
- Works with any block, including blocks from other plugins and blocks nested inside groups and columns

## Installation

1. Download `restore-one-block.zip` from the [latest release](https://github.com/aryanjasala/restore-one-block/releases/latest).
2. In WordPress, go to **Plugins > Add New Plugin > Upload Plugin**, choose the zip and activate it.

Or with WP-CLI:

```sh
wp plugin install https://github.com/aryanjasala/restore-one-block/releases/latest/download/restore-one-block.zip --activate
```

Needs WordPress 6.6+ and PHP 7.4+.

## Usage

Select a block, open its menu and choose **Restore from a revision…**. The closest match is marked, and **Show changes** shows what a restore would change:

![An earlier version of one block, with its changes highlighted](.wordpress-org/screenshot-2.png)

Can't remember which revision had the sentence you need? Type a few words into **Find text in old revisions**:

![Finding deleted text across revisions](.wordpress-org/screenshot-3.png)

### For developers

There is no build step. The editor scripts use the `wp.*` globals WordPress already loads:

| Script | Job |
| --- | --- |
| `assets/js/matching.js` | Block text, similarity ranking, word diff and revision search. No WordPress dependency, so it runs in Node for the unit tests |
| `assets/js/components.js` | The restore window |
| `assets/js/index.js` | The two menu entries |

Revisions are requested with `_fields=content.raw`, so the server does not render each revision just to list them. Revision responses get a `restore_one_block_author` field with the author's display name, because editors cannot always list users.

## Development

```sh
composer install
npm ci
```

| Command | What it runs |
| --- | --- |
| `composer lint` | PHPCS with the WordPress standard and PHPCompatibility from PHP 7.4 |
| `composer analyse` | PHPStan level 6 with WordPress and WP-CLI stubs |
| `composer test` | PHPUnit unit tests. WordPress functions are mocked with Brain Monkey, so no database is needed |
| `npm run test:unit:js` | Node unit tests for `assets/js/matching.js` |
| `npm run env:start` | WordPress and MariaDB in Docker on http://localhost:8895 |
| `npm run test:e2e` | Playwright end-to-end tests against that site, in headless Chrome |
| `npm run screenshots` | Regenerates the screenshots in `.wordpress-org/` |
| `npm run env:stop` | Removes the site and its database |

The plugin is mounted read-only into the Docker site, so nothing in WordPress can change or delete the source. The end-to-end run empties the site's content before it starts, so point it only at this throwaway site.

## Tests

- **9 JavaScript unit tests**: text extraction, similarity, nested block paths, candidate ranking, same/changed/missing classification, the word diff (and its fallback for very long blocks), search grouping and excerpts
- **2 PHP unit tests**: which post types get the tools, and the revision author field
- **5 end-to-end tests**: restoring a deleted paragraph and saving it, replacing a block with an older version after checking the diff, a block nested inside a Group, finding deleted text, and the revision list with arrow-key navigation

## Contributing

`main` is protected: every change goes through a pull request, and it can only be merged once these pass:

- PHPCS and PHPStan
- PHPUnit on PHP 7.4, 8.0, 8.1, 8.2, 8.3 and 8.4, and the Node unit tests
- the end-to-end suite against the latest WordPress
- the WordPress.org Plugin Check on the built zip
- the PR title check

Pull requests are squash-merged, so the **PR title becomes the commit on `main`** and decides the next release. Use a [Conventional Commit](https://www.conventionalcommits.org/) title:

| Title | Release |
| --- | --- |
| `feat: add bulk restore` | minor (1.1.0 to 1.2.0) |
| `fix: keep the notice on narrow screens`, `perf: ...` | patch (1.1.0 to 1.1.1) |
| `feat!: drop PHP 7.4`, or a `BREAKING CHANGE:` footer | major (1.1.0 to 2.0.0) |
| `docs:`, `ci:`, `chore:`, `test:`, `refactor:`, `build:` | none |

## Releases

Releases are automatic:

1. After each merge to `main`, the **Prepare release** workflow checks for `feat`, `fix`, `perf` or breaking commits since the last tag. If there are any, it opens (or updates) a `chore(release): x.y.z` pull request that bumps the version in the plugin header, the `VERSION` constant and the readme `Stable tag`, and adds the changelog entry to `readme.txt`.
2. Merging that pull request runs the **Release** workflow: it tags `vx.y.z`, builds the zip with `bin/build-zip.sh` (leaving out everything in `.distignore`) and publishes the GitHub release with the changelog entry as notes.

`bin/release.sh next` and `bin/release.sh notes` show locally what the next release would contain.

Deploying to WordPress.org is off until the repository variable `WPORG_DEPLOY` is `true` and the secrets `SVN_USERNAME` and `SVN_PASSWORD` are set. The deploy uses `.wordpress-org/` for the screenshots.

## License

GPL-2.0-or-later
