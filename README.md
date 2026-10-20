# Restore One Block

Restores a single block from an old revision instead of rolling back the whole post. Brings back a deleted paragraph, or an earlier version of one section, without undoing the edits made since.

- **Block menu > Restore from a revision…** lists that block's versions in each revision, best match first, with **Replace** or **Insert below**
- **Editor menu > Restore blocks from a revision** compares a revision's blocks with the post now (*Same as now*, *Changed since*, *Not in the post now*) and puts a deleted block back where it was
- **Show changes** highlights the words that differ between the current block and the old version
- **Find text in old revisions** searches every loaded revision and jumps to the block that had it
- Every restore is a normal editor change: Ctrl+Z undoes it and nothing is saved until the post is updated

Revisions are requested with `_fields=content.raw`, so the server does not render each revision just to show the list.

User-facing docs are in [`readme.txt`](readme.txt), which is what WordPress.org shows.

## Requirements

WordPress 6.6+, PHP 7.4+.

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
| `npm run test:unit:js` | Node unit tests for the matching logic in `assets/js/matching.js` |
| `npm run env:start` | WordPress and MariaDB in Docker on http://localhost:8895 |
| `npm run test:e2e` | Playwright end-to-end tests against that site, in headless Chrome |
| `npm run env:stop` | Removes the site and its database |

The plugin is mounted read-only into the Docker site, so nothing in WordPress can change or delete the source. The end-to-end run empties the site's content before it starts, so point it only at this throwaway site.

There is no build step. The editor scripts use the `wp.*` globals WordPress already loads:

| Script | Job |
| --- | --- |
| `assets/js/matching.js` | Block text, similarity ranking, word diff and revision search. No WordPress dependency, so it runs in Node for the unit tests |
| `assets/js/components.js` | The restore window |
| `assets/js/index.js` | The two menu entries |

## Tests

- **9 JavaScript unit tests**: text extraction, similarity, nested block paths, candidate ranking, same/changed/missing classification, the word diff (and its fallback for very long blocks), search grouping and excerpts
- **2 PHP unit tests**: which post types get the tools, and the revision author field
- **5 end-to-end tests**: restoring a deleted paragraph and saving it, replacing a block with an older version after checking the diff, a block nested inside a Group, finding deleted text, and the revision list with arrow-key navigation

## CI

| Workflow | Runs on | What it checks |
| --- | --- | --- |
| PHPCS | push to `main`, pull requests | WordPress coding standards |
| PHPStan | push to `main`, pull requests | Static analysis, level 6 |
| Unit tests | push to `main`, pull requests | PHPUnit on PHP 7.4, 8.0, 8.1, 8.2, 8.3 and 8.4, and the Node tests |
| E2E tests | push to `main`, pull requests | Playwright against the latest WordPress in Docker |
| Plugin Check | push to `main`, pull requests | The official WordPress.org Plugin Check, on the built zip |
| Release | tags `v*` | Builds the zip and publishes a GitHub release |

## Releasing

1. Update the version in three places: the plugin header, the `VERSION` constant and `Stable tag` in `readme.txt`. Add a `= x.y.z =` entry under `== Changelog ==`.
2. Push a tag: `git tag v1.2.0 && git push origin v1.2.0`.

The release workflow fails if the tag does not match all three versions or the changelog has no entry for it. Otherwise it runs PHPCS and PHPUnit, builds the zip with `bin/build-zip.sh` (leaving out everything in `.distignore`), and publishes a GitHub release with the changelog entry as notes.

Deploying to WordPress.org is off until the repository variable `WPORG_DEPLOY` is `true` and the secrets `SVN_USERNAME` and `SVN_PASSWORD` are set.

## Layout

```
restore-one-block.php   plugin header and PSR-4 autoloader
src/
  Plugin.php            registers the services, lists supported post types
  Editor/Assets.php     loads the editor scripts
  Rest/RevisionAuthor.php  author name on revision REST responses
assets/                 editor scripts and styles
tests/
  Unit/                 PHPUnit
  js/                   Node unit tests
  e2e/                  Playwright specs and the Docker site
```

## License

GPL-2.0-or-later
