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
| `restore_one_block_post_types` | filter | `( string[] $post_types )`. Post types that get Restore One Block. Default every REST-enabled post type with revisions and the editor. Types without revisions are dropped |

JavaScript, through `wp.hooks`:

| Hook | Type | Use |
| --- | --- | --- |
| `restoreOneBlock.canRestore` | filter | `( boolean canRestore, Object block )`. Whether a block's menu offers "Restore from a revision…" |
| `restoreOneBlock.revisionsPerPage` | filter | `( number perPage )`. Revisions loaded at a time, 1 to 100. Default 50 |
| `restoreOneBlock.restored` | action | `( { mode, block, revisionId, postId } )`. A block came back. `mode` is `replace`, `insert-after`, `replace-at` or `insert-at` |

```js
// No restoring for reusable blocks, and log every restore.
wp.hooks.addFilter( 'restoreOneBlock.canRestore', 'my-plugin', ( canRestore, block ) => canRestore && 'core/block' !== block.name );
wp.hooks.addAction( 'restoreOneBlock.restored', 'my-plugin', ( details ) => console.log( 'Restored', details.block.name, 'from revision', details.revisionId ) );
```

Load that script with `wp-hooks` as a dependency, on `enqueue_block_editor_assets`.

## REST

Revisions are fetched 50 at a time from `/wp/v2/<type>/<id>/revisions` with `context=edit` and `_fields=id,date_gmt,slug,content.raw,restore_one_block_author`, so the server returns raw block markup and never renders the content.

The plugin adds one read-only field to revision responses:

| Field | Value |
| --- | --- |
| `restore_one_block_author` | Display name of the revision's author. Editors cannot always list users, so the name comes with the revision |

## Data

Nothing is stored. Restores are normal editor changes, saved when the post is updated.
