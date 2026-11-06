# Reference

## How it finds "the same block"

Blocks have no permanent ID between saves. For the selected block, every block of the same type in the revision is a candidate, scored by:

- **1** if it sits at the same position (the same path of indexes from the top, so nested blocks count)
- plus its word similarity to the current block (Jaccard similarity of the word sets, from 0 to 1)

The highest score is marked **Best match**. Candidates identical to the current block are hidden unless you ask for them.

For the whole post, each top-level block in the revision is **Same as now** when an identical block exists now, **Changed since** when the block now at that position has the same type, and **Not in the post now** otherwise.

## Scripts

There is no build step. The scripts use the `wp.*` globals WordPress already loads. They load in the post editor for post types with revisions, and in the Site Editor for templates, template parts, synced patterns and anything else that has revisions.

| Script | Job |
| --- | --- |
| `assets/js/matching.js` | Block text, similarity ranking, classification, word diff, revision search, attribute roles, partial restores and the inner block comparison. No WordPress dependency, so it is unit tested in Node |
| `assets/js/components.js` | The restore window, built on `wp.components` and `wp.blockEditor`, and the lookup of which entity a block belongs to |
| `assets/js/index.js` | The two menu entries (`BlockSettingsMenuControls` and `PluginMoreMenuItem`) and the command palette entries |

The window uses core components only (`Modal`, `Card`, `PanelBody`, `Button`, `Notice`, `Spinner`, `Badge`). `assets/editor.css` holds layout and nothing else.

## Site Editor

Both entry points work in the Site Editor: the block menu (**Restore from a revision…**) and the editor menu (**Restore blocks from a revision**). Revisions come from the entity being edited:

| Editing | Revisions from | Capability |
| --- | --- | --- |
| A template | `/wp/v2/templates/<theme>//<slug>/revisions` | `edit_theme_options` |
| A template part | `/wp/v2/template-parts/<theme>//<slug>/revisions` | `edit_theme_options` |
| A synced pattern | `/wp/v2/blocks/<id>/revisions` | `edit_posts` |
| A post or page | `/wp/v2/<type>/<id>/revisions` | the type's `edit_posts` |

A block inside a template part, opened from a template, restores from the template part's own revisions, and the change lands in the part, not in the template. In a template, core locks the blocks of a part to content editing, so their block menu has no restore item: use the command palette, or choose **Edit original** and use the menu there.

A template or template part that still comes from the theme's files has no revisions until it is saved once. The window says so.

The REST routes check permissions themselves. The plugin only loads its scripts for a user who has the capability, and does not add anything the revisions endpoints would not show.

## Restoring part of a block

With one block selected, each older version has up to four actions:

| Action | Does |
| --- | --- |
| **Replace current block** | The old block, whole |
| **Restore content only** | The old content attributes and inner blocks. The block keeps its current style attributes, `className`, layout, colours, typography and spacing |
| **Restore styling only** | The old style attributes. The block keeps its current content and inner blocks |
| **Insert below it** | The old block next to the current one |

A partial restore is disabled, with a note, when it would change nothing. **Show changes** and **Preview** follow the option picked under "Show changes for": the words that change, the settings that change (`fontSize`, `className`, and so on), and the block as it would look.

Each attribute is **content**, **style** or **keep**:

- `lock` and `metadata` are **keep**. A partial restore never touches them.
- `style`, `className`, `align`, `layout`, `backgroundColor`, `textColor`, `fontSize`, `fontFamily`, `gradient` and `borderColor` are **style**, whatever their `block.json` says.
- An attribute with `role: content` in `block.json` (core's own metadata), or a text source (`html`, `rich-text`, `text`, `children`, `node`, `query`), is **content**.
- Any other attribute is **style**: it changes how the block looks or works, not what it says.

Both filters below change this. They are read each time the window opens.

## Groups and inner blocks

A block that holds other blocks restores as a whole: **Replace current block**, **Replace current version** and **Restore it here** bring back the block and everything inside it as one change, so one Ctrl+Z undoes all of it. The card says how many inner blocks it holds.

When the block exists now and its inner blocks differ, the card has an expandable line such as "Inside: 1 added, 1 removed, 2 changed". Inner blocks that are identical drop out first. Of the rest, blocks of the same type pair up in order and count as changed, blocks only in the revision count as added, and blocks only in the post count as removed (a block counts with everything inside it). Open the line to see each difference. **Restore this Paragraph** (the block's own name) restores one inner block: it replaces its counterpart, or, for an added block, puts it into the group that holds it. The rest of the group stays as it is.

Template parts are not compared, because their blocks belong to the part's own document.

## Command palette

On WordPress 6.3 and later the command palette (Ctrl+K, ⌘K) has three entries, in the post editor and the Site Editor:

| Command | Does |
| --- | --- |
| Restore blocks from a revision | Opens the window for the whole post, template, part or pattern |
| Restore selected block from a revision | Opens it for the selected block. Only listed while one block is selected |
| Find text in old revisions | Opens the window with the search box focused |

Without `wp-commands` the script still loads and the menu entries work.

## The states of the window

Each revision and block carries a tone and a word. The tones are core's `Badge` intents.

| Label | Tone | Means |
| --- | --- | --- |
| Not in the post now | error | The block is in the revision and not in the post |
| Changed since | warning | The block now at that position has the same type and different content |
| Same as now | good | An identical block exists now |
| Best match | info | The closest version of the selected block |
| Found by your search | info | The block you picked in the search results |
| Added, Removed, Changed | good, error, warning | Inside a group, what restoring the whole group would do |

Loading shows a spinner with "Loading revisions…". A revision list that cannot load shows an error with **Try again**. A post without revisions, and a template that still comes from the theme, show a note that says why the list is empty.

## Hooks

PHP:

| Hook | Type | Use |
| --- | --- | --- |
| `axle_block_restore_post_types` | filter | `( string[] $post_types )`. Post types that get Axle Block Restore in the post editor and the abilities. Default every REST-enabled post type with revisions and the editor. Types without revisions are dropped |
| `axle_block_restore_site_editor_post_types` | filter | `( string[] $post_types )`. Post types that get it in the Site Editor. Default `wp_template`, `wp_template_part` and `wp_block`. Types that do not exist, have no revisions or are not in the REST API are dropped |
| `axle_block_restore_capability` | filter | `( string $capability, string $post_type )`. Capability a user needs before the scripts load for a post type. Default the type's own `edit_posts` capability: `edit_theme_options` for templates and parts, `edit_posts` for patterns and posts. An empty value falls back to the default |

JavaScript, through `wp.hooks`:

| Hook | Type | Use |
| --- | --- | --- |
| `axleBlockRestore.canRestore` | filter | `( boolean canRestore, Object block )`. Whether a block's menu and the "Restore selected block" command are offered for a block |
| `axleBlockRestore.revisionsPerPage` | filter | `( number perPage )`. Revisions loaded at a time, 1 to 100. Default 50 |
| `axleBlockRestore.attributeRole` | filter | `( string role, string name, string blockName, Object schema )`. Whether an attribute is `content`, `style` or `keep` for a partial restore. Default from `block.json` `role`, the attribute's source and the style list. Any other return value is ignored |
| `axleBlockRestore.styleAttributes` | filter | `( string[] names, string blockName )`. Attribute names that count as style. Default `style`, `className`, `align`, `layout`, `backgroundColor`, `textColor`, `fontSize`, `fontFamily`, `gradient`, `borderColor` |
| `axleBlockRestore.restoreModes` | filter | `( string[] modes )`. Ways to restore one block: `replace`, `content`, `style`. Default all three. `replace` is always kept, unknown names are dropped |
| `axleBlockRestore.commands` | filter | `( Object[] commands, string\|null blockId )`. Command palette entries, each `{ name, label, icon, callback }`. Add, change or remove entries |
| `axleBlockRestore.opened` | action | `( { clientId, postType, postId, focusSearch } )`. The window opened. `clientId` is null for the whole post, template, part or pattern. Template and part IDs look like `theme//slug` |
| `axleBlockRestore.restored` | action | `( { mode, block, revisionId, postId, postType } )`. A block came back. `mode` is `replace`, `content`, `style`, `insert-after`, `replace-at`, `insert-at`, `inner-replace` or `inner-insert` |

```js
// No restoring for reusable blocks, and log every restore.
wp.hooks.addFilter( 'axleBlockRestore.canRestore', 'my-plugin', ( canRestore, block ) => canRestore && 'core/block' !== block.name );
wp.hooks.addAction( 'axleBlockRestore.restored', 'my-plugin', ( details ) => console.log( 'Restored', details.block.name, 'from revision', details.revisionId ) );

// Treat a custom block's "heading" attribute as content, and a "variant" attribute as style.
wp.hooks.addFilter( 'axleBlockRestore.attributeRole', 'my-plugin', ( role, name, blockName ) => {
	if ( 'my/card' !== blockName ) {
		return role;
	}
	return 'heading' === name ? 'content' : 'variant' === name ? 'style' : role;
} );
```

```php
// Templates and parts only for people who can manage options, and no support for patterns in the Site Editor.
add_filter( 'axle_block_restore_site_editor_post_types', static fn( array $types ) => array_diff( $types, array( 'wp_block' ) ) );
add_filter( 'axle_block_restore_capability', static fn( string $cap, string $type ) => in_array( $type, array( 'wp_template', 'wp_template_part' ), true ) ? 'manage_options' : $cap, 10, 2 );
```

Load that script with `wp-hooks` as a dependency, on `enqueue_block_editor_assets`.

## Abilities

On WordPress 6.9 and later, Axle Block Restore registers [abilities](https://developer.wordpress.org/apis/abilities/), which AI agents find and run through the [MCP adapter](https://github.com/WordPress/mcp-adapter) and anything else through the REST API under `/wp-abilities/v1/`. Each one is marked public, which the MCP adapter needs before it lists an ability.

Abilities work with post IDs, so they reach templates, template parts and patterns by the ID of their post. Restoring only the content or only the styling is an editor feature: the saved markup of a block (its classes and inline styles) only comes from the block's own `save()` function, which runs in JavaScript.

In the editor the plugin guesses which old block matches which current one. An agent does not need the guess: it finds text that was deleted or changed, then names the exact block to bring back. A path counts blocks from 0, one number per level: `[2]` is the third top-level block, `[2, 0]` the first block inside it.

| Ability | Does |
| --- | --- |
| `axle-block-restore/list-revisions` | Read-only. Revisions of `post_id`, newest first, with who saved each |
| `axle-block-restore/find-deleted` | Read-only. Blocks whose text is in an old revision but not in the post, with the `revision_id` and `path` to restore them |
| `axle-block-restore/find-text` | Read-only. Blocks in old revisions containing `text`, and whether each is still in the post |
| `axle-block-restore/restore-block` | Puts the block at `path` in `revision_id` back: `mode` `insert` at a top-level `position` (default: where it was), or `replace` the block at `target_path` (default: the same path). Saves the post, which makes a new revision, so it can be undone. Refuses while someone else has the post open in the editor, unless `force` is true |

All four need `edit_post` on the post, in a post type that has Axle Block Restore. The find abilities look through 20 revisions by default, 50 at most (`axle_block_restore_max_revisions`).

| Hook | Type | Use |
| --- | --- | --- |
| `axle_block_restore_restored` | action | `( int $post_id, array $block, int $revision_id, string $mode )`. A block was saved back through `restore-block` |
| `axle_block_restore_max_revisions` | filter | `( int $max )`. Most revisions the find abilities look through. Default 50 |

## REST

Revisions are fetched 50 at a time from `/wp/v2/<rest base>/<id>/revisions` with `context=edit` and `_fields=id,wp_id,modified,date_gmt,slug,content.raw,axle_block_restore_author`, so the server returns raw block markup and never renders the content. The rest base is `templates`, `template-parts` or `blocks` in the Site Editor.

Template and template part revisions come from core's templates controller, so each one has `id` set to the template's ID (`theme//slug`), its own ID in `wp_id`, and its time in `modified`, in the site's time zone. The window reads those.

The plugin adds one read-only field to revision responses:

| Field | Value |
| --- | --- |
| `axle_block_restore_author` | Display name of the revision's author. Editors cannot always list users, so the name comes with the revision |

## Data

Nothing is stored. Restores are normal editor changes, saved when the post is updated.
