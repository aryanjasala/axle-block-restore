# Reference

## How it finds "the same block"

Blocks have no permanent ID between saves. For the selected block, every block of the same type in the revision is a candidate, scored by:

- **1** if it sits at the same position (the same path of indexes from the top, so nested blocks count)
- plus its word similarity to the current block (Jaccard similarity of the word sets, from 0 to 1)

The highest score is marked **Best match**. Candidates identical to the current block are hidden unless you ask for them.

For the whole post, each top-level block in the revision is **Same as now** when an identical block exists now, **Changed since** when the block now at that position has the same type, and **Not in the post now** otherwise.

## Scripts

There is no build step. The scripts use the `wp.*` globals WordPress already loads, and load only in the post editor for post types with revisions and the block editor.

| Script | Job |
| --- | --- |
| `assets/js/matching.js` | Block text, similarity ranking, classification, word diff and revision search. No WordPress dependency, so it is unit tested in Node |
| `assets/js/components.js` | The restore window, built on `wp.components` and `wp.blockEditor` |
| `assets/js/index.js` | The two menu entries (`BlockSettingsMenuControls` and `PluginMoreMenuItem`) |

## Hooks

PHP:

| Hook | Type | Use |
| --- | --- | --- |
| `restore_blocks_from_revisions_post_types` | filter | `( string[] $post_types )`. Post types that get Restore Blocks from Revisions. Default every REST-enabled post type with revisions and the editor. Types without revisions are dropped |

JavaScript, through `wp.hooks`:

| Hook | Type | Use |
| --- | --- | --- |
| `restoreBlocksFromRevisions.canRestore` | filter | `( boolean canRestore, Object block )`. Whether a block's menu offers "Restore from a revision…" |
| `restoreBlocksFromRevisions.revisionsPerPage` | filter | `( number perPage )`. Revisions loaded at a time, 1 to 100. Default 50 |
| `restoreBlocksFromRevisions.restored` | action | `( { mode, block, revisionId, postId } )`. A block came back. `mode` is `replace`, `insert-after`, `replace-at` or `insert-at` |

```js
// No restoring for reusable blocks, and log every restore.
wp.hooks.addFilter( 'restoreBlocksFromRevisions.canRestore', 'my-plugin', ( canRestore, block ) => canRestore && 'core/block' !== block.name );
wp.hooks.addAction( 'restoreBlocksFromRevisions.restored', 'my-plugin', ( details ) => console.log( 'Restored', details.block.name, 'from revision', details.revisionId ) );
```

Load that script with `wp-hooks` as a dependency, on `enqueue_block_editor_assets`.

## Abilities

On WordPress 6.9 and later, Restore Blocks from Revisions registers [abilities](https://developer.wordpress.org/apis/abilities/), which AI agents find and run through the [MCP adapter](https://github.com/WordPress/mcp-adapter) and anything else through the REST API under `/wp-abilities/v1/`. Each one is marked public, which the MCP adapter needs before it lists an ability.

In the editor the plugin guesses which old block matches which current one. An agent does not need the guess: it finds text that was deleted or changed, then names the exact block to bring back. A path counts blocks from 0, one number per level: `[2]` is the third top-level block, `[2, 0]` the first block inside it.

| Ability | Does |
| --- | --- |
| `restore-blocks-from-revisions/list-revisions` | Read-only. Revisions of `post_id`, newest first, with who saved each |
| `restore-blocks-from-revisions/find-deleted` | Read-only. Blocks whose text is in an old revision but not in the post, with the `revision_id` and `path` to restore them |
| `restore-blocks-from-revisions/find-text` | Read-only. Blocks in old revisions containing `text`, and whether each is still in the post |
| `restore-blocks-from-revisions/restore-block` | Puts the block at `path` in `revision_id` back: `mode` `insert` at a top-level `position` (default: where it was), or `replace` the block at `target_path` (default: the same path). Saves the post, which makes a new revision, so it can be undone. Refuses while someone else has the post open in the editor, unless `force` is true |

All four need `edit_post` on the post, in a post type that has Restore Blocks from Revisions. The find abilities look through 20 revisions by default, 50 at most (`restore_blocks_from_revisions_max_revisions`).

| Hook | Type | Use |
| --- | --- | --- |
| `restore_blocks_from_revisions_restored` | action | `( int $post_id, array $block, int $revision_id, string $mode )`. A block was saved back through `restore-block` |
| `restore_blocks_from_revisions_max_revisions` | filter | `( int $max )`. Most revisions the find abilities look through. Default 50 |

## REST

Revisions are fetched 50 at a time from `/wp/v2/<type>/<id>/revisions` with `context=edit` and `_fields=id,date_gmt,slug,content.raw,restore_blocks_from_revisions_author`, so the server returns raw block markup and never renders the content.

The plugin adds one read-only field to revision responses:

| Field | Value |
| --- | --- |
| `restore_blocks_from_revisions_author` | Display name of the revision's author. Editors cannot always list users, so the name comes with the revision |

## Data

Nothing is stored. Restores are normal editor changes, saved when the post is updated.
