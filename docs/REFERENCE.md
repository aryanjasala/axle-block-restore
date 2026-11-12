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
| `assets/js/matching.js` | Block text, similarity ranking, classification, word diff, revision search, attribute roles, partial restores, the inner block comparison, the removed blocks list with the position a block goes back to, the block history timeline, and unique anchors for copies. No WordPress dependency, so it is unit tested in Node |
| `assets/js/components.js` | The restore window, built on `wp.components` and `wp.blockEditor`, and the lookup of which entity a block belongs to |
| `assets/js/index.js` | The menu entries (`BlockSettingsMenuControls` for **Restore from a revision…** and **Block history**, `PluginMoreMenuItem`) and the command palette entries |
| `src/Timeline.php` | The same block history in PHP, for the `block-history` ability and the `history` command. No database access, so it is unit tested without WordPress |

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
| **Insert below as a copy** | The old block next to the current one, with new IDs and no repeated anchor, so you can compare them. See Insert below as a copy |

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

On WordPress 6.3 and later the command palette (Ctrl+K, ⌘K) has five entries, in the post editor and the Site Editor:

| Command | Does |
| --- | --- |
| Restore blocks from a revision | Opens the window for the whole post, template, part or pattern |
| Restore selected block from a revision | Opens it for the selected block. Only listed while one block is selected |
| Show history of selected block | Opens the window on **Block history** for the selected block. Only listed while one block is selected |
| Find text in old revisions | Opens the window with the search box focused |
| Show removed blocks | Opens the window on the **Removed blocks** view |

Without `wp-commands` the script still loads and the menu entries work.

## Removed blocks

The window has up to four views, as tabs: **By revision** (the list above), **Block history** (with a block selected), **Removed blocks** and **Another post**. **Removed blocks** answers "what did we lose recently". It looks through the newest 20 revisions (`axleBlockRestore.removedRevisions`) and lists every block, top level or nested, that was in one of them and is not in the post now, newest removal first.

A block counts as removed when no block now has the same markup, no block of the same type now has at least 60% of its words in common (`axleBlockRestore.removedSimilarity`; that is an edit), and it holds no block that is still in the post. Then:

- A block that was gone for several revisions, or was edited before it went, is listed once, as its newest version, with "Also in 2 older revisions".
- A block inside a removed block is not listed on its own: restoring the outer block brings it back.
- A block of the same type that now sits at its old place is labelled **Rewritten since** instead of **Removed**.
- Empty paragraphs, headings and lists are left out.

Each card shows the block type, an excerpt, who saved the last revision that had it and when, and **Preview**. The actions:

| Action | Puts the block |
| --- | --- |
| **Put it back where it was** | After the nearest earlier neighbour that is still in the post, else before the nearest later one, else at its old index limited to the list. A nested block goes back into the counterpart of its old parent (same type at the same path, else the most similar block of that type), and to the top level when that parent is gone |
| **Insert below the selected block** | Below the block that is selected in the editor. Only shown while a block of what you are editing is selected |
| **Insert at the end** | At the end of the post, template or template part |

Each is one editor change: one Ctrl+Z undoes it. The view says when it is loading, when the revisions could not load (with **Try again**), and when nothing was removed. It works in the post editor and in the Site Editor.

## Copying a block from another post

**Another post** searches the posts and pages you can edit, by title or text, and leaves out the post you are editing. Pick one, choose **Current version** or one of its revisions, optionally filter its blocks by text, then **Insert below the selected block** or **Insert at the end** on any block, nested ones included. The block is copied, so the other post does not change. It is one editor change, like every restore.

Only posts you can edit are offered, and the server checks it, not just the screen. The search is `GET /axle-block-restore/v1/posts?search=&post_type=&exclude_id=&per_page=`. It asks `current_user_can( 'edit_post' )` for every post it finds and returns titles, types, status and dates only, never content, so it does not list titles of other people's published posts or drafts that you cannot edit (core's own search does list published ones). Reading a post's revisions or its content then goes through core's endpoints, which check `edit_post` again.

`axle_block_restore_copy_post_types` limits the post types, and an empty list turns the view off for everyone: the route then answers 403.

## Block history

Select a block, open its menu and choose **Block history** (or run **Show history of selected block** in the command palette). The window opens on the **Block history** tab: every version the block had in the revisions, newest first. An entry is one change:

| Entry | Means |
| --- | --- |
| Edited | The text, the settings or the blocks inside changed in that save. The words that changed are shown, the settings that changed are named, and for a group the entry counts the blocks added, removed and changed inside |
| Added | The block first appears in that save |
| Removed | The block is gone from that save on. The entry shows what it said last |
| Added back | The block came back after being removed |
| Oldest version found | The oldest revision looked through already had the block |
| Not saved yet | Marks an entry for what is in the editor now, when it differs from the newest save. It can be previewed, not restored |

Each entry says who saved the revision and when (relative, with the exact time on hover), tags autosaves, and counts later saves that kept the same version. **Preview** shows the block as it was. **Replace current block**, **Restore content only**, **Restore styling only** (under **More ways to restore**) and **Insert below as a copy** are the same restores as in the other views. **Copy block** puts the block's markup on the clipboard, so you can paste it into any post.

Blocks have no permanent ID, so the history follows the block from the newest revision to the oldest: in each revision it takes the identical block of the same type (the nearest one when there are copies), else the most alike block of that type. That needs at least half of its words in common, or a fifth of them when the block is the same type at the same place (`axleBlockRestore.historySimilarity`). A block with no text only matches at the same place. A block that only moved has no entry for the move. A paragraph that was split follows its first half in the first half's history and the second half in the second's, each back to the original. When there are copies of a block, an edited block at the same place wins over an untouched identical copy elsewhere.

Revisions load 50 at a time and the timeline grows as each page arrives, with a spinner and a count of the revisions looked through. It stops at 200 revisions (`axleBlockRestore.historyRevisions`) and offers **Look further back**. Entries show 20 at a time.

## Insert below as a copy

**Insert below as a copy** sits next to the restore button everywhere an old version of a block can be restored: the versions of one block, the blocks of a revision (below the block now at that place), one block inside a group that differs from the old one, and the block history. The copy has new client IDs, and an `anchor` (or any attribute saved as the markup's `id`) that another block in the post already uses gets `-copy` added, then `-copy-2`. When a version replaces a block, that block's own anchors count as free. `axleBlockRestore.uniqueAnchors` turns this off.

After a restore the editor shows a notice with **Undo**, which is the editor's own undo, one step. After a copy the notice also has **Compare**, which selects the new block and scrolls to it. A snackbar can hold one action only, so a copy gets the editor's own notice and the other restores keep the snackbar with **Undo**.

## WP-CLI

The commands do what the abilities do, run as the shell user, and take paths as numbers separated by commas (`2` is the third top-level block, `2,0` the first block inside it). Lists take `--format=table|json|csv|yaml|count`.

| Command | Does |
| --- | --- |
| `wp axle-block-restore revisions <post> [--limit=20]` | Revisions of a post, newest first, with who saved each |
| `wp axle-block-restore find-deleted <post> [--revisions=20]` | Blocks in old revisions that are not in the post |
| `wp axle-block-restore find-text <post> <text> [--revisions=20]` | Blocks in old revisions that contain the text, and whether each is still in the post |
| `wp axle-block-restore history <post> <path> [--revisions=100]` | Every version of the block at `path` in the post as it is now |
| `wp axle-block-restore restore <post> <revision> <path> [--mode=insert\|replace] [--position=<n>] [--target-path=<path>] [--force]` | Puts one block from a revision back. Saves the post, so it can be undone |

## Site Health

Tools > Site Health has a test, **Revisions for Axle Block Restore**. It is recommended when a post type that has the plugin keeps no revisions (`WP_POST_REVISIONS` set to 0 or false, or a `wp_revisions_to_keep` filter), because there is then nothing to restore from.

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
| Removed | error | In the Removed blocks view: in a recent revision, not in the post now |
| Rewritten since | warning | In the Removed blocks view: a block of the same type is at its old place now |
| Edited, Added, Added back | info, good, good | In Block history: what happened to the block in that save |
| Removed | error | In Block history: the block is gone from that save on |
| Oldest version found | neutral | In Block history: the oldest revision looked through has the block |
| Not saved yet | warning | In Block history: what is in the editor now, not in a revision |

Loading shows a spinner with "Loading revisions…", and in Block history with the number of revisions looked through. The results are announced to screen readers. A revision list that cannot load shows an error with **Try again**. A post without revisions, and a template that still comes from the theme, show a note that says why the list is empty.

## Hooks

PHP:

| Hook | Type | Use |
| --- | --- | --- |
| `axle_block_restore_post_types` | filter | `( string[] $post_types )`. Post types that get Axle Block Restore in the post editor and the abilities. Default every REST-enabled post type with revisions and the editor. Types without revisions are dropped |
| `axle_block_restore_site_editor_post_types` | filter | `( string[] $post_types )`. Post types that get it in the Site Editor. Default `wp_template`, `wp_template_part` and `wp_block`. Types that do not exist, have no revisions or are not in the REST API are dropped |
| `axle_block_restore_capability` | filter | `( string $capability, string $post_type )`. Capability a user needs before the scripts load for a post type. Default the type's own `edit_posts` capability: `edit_theme_options` for templates and parts, `edit_posts` for patterns and posts. An empty value falls back to the default |
| `axle_block_restore_copy_post_types` | filter | `( string[] $post_types )`. Post types the **Another post** view copies from, and the search route allows. Default every post type the user can edit that has Axle Block Restore. Types the user cannot edit are dropped. An empty array turns the view off and makes the route answer 403 |
| `axle_block_restore_copy_max_results` | filter | `( int $max )`. Most posts one search returns. Default 20 |
| `axle_block_restore_history_max_revisions` | filter | `( int $max )`. Most revisions the `block-history` ability and the `history` command look through. Default 200 |
| `axle_block_restore_history_similarity` | filter | `( array $settings, int $post_id )`. `similarity` (default 0.5) and `position_similarity` (default 0.2), the shares of words two versions need in common, as in the editor |
| `axle_block_restore_history_read` | action | `( int $post_id, int[] $path, array $history )`. The history of a block was read through the ability or WP-CLI |

JavaScript, through `wp.hooks`:

| Hook | Type | Use |
| --- | --- | --- |
| `axleBlockRestore.canRestore` | filter | `( boolean canRestore, Object block )`. Whether a block's menu and the "Restore selected block" command are offered for a block |
| `axleBlockRestore.revisionsPerPage` | filter | `( number perPage )`. Revisions loaded at a time, 1 to 100. Default 50 |
| `axleBlockRestore.removedRevisions` | filter | `( number count )`. How many of the newest revisions the Removed blocks view looks through, 1 to 100. Default 20 |
| `axleBlockRestore.removedSimilarity` | filter | `( number similarity )`. Share of words, 0 to 1, a block of the same type now must have in common with an old block for it to count as edited, not removed. Default 0.6. 1 lists every block that is not identical |
| `axleBlockRestore.removedBlocks` | filter | `( Object[] entries, { revisionIds } )`. The blocks listed as removed, newest removal first. Each has `name`, `title`, `text`, `path`, `block`, `revisionId`, `revisionIds` and `rewritten` |
| `axleBlockRestore.historyRevisions` | filter | `( number count )`. How many revisions Block history looks through before it offers **Look further back**, 1 to 1000. Default 200 |
| `axleBlockRestore.historySimilarity` | filter | `( { similarity, positionSimilarity } settings )`. Share of words, 0 to 1, two versions need in common for the history to follow the block: `similarity` (default 0.5), and `positionSimilarity` for the same type at the same place (default 0.2) |
| `axleBlockRestore.historyEntries` | filter | `( Object[] entries, { clientId, revisionIds } )`. The entries of a block's history, newest first. Each has `type` (`first`, `added`, `edited`, `removed`, `readded`), `revisionId` (`current` for what is not saved), `revisionIds`, `when`, `author`, `autosave`, `item` (the version, or null for removed), `previous` and `change` |
| `axleBlockRestore.uniqueAnchors` | filter | `( boolean unique, Object block )`. Whether a block put into the post gets anchors that no other block uses. Default true |
| `axleBlockRestore.restoredMessage` | filter | `( string message, string mode )`. The message of the notice after a restore or insert |
| `axleBlockRestore.copyPostTypes` | filter | `( string[] postTypes )`. Post types the Another post view offers. Can only narrow the PHP list. An empty array hides the view |
| `axleBlockRestore.attributeRole` | filter | `( string role, string name, string blockName, Object schema )`. Whether an attribute is `content`, `style` or `keep` for a partial restore. Default from `block.json` `role`, the attribute's source and the style list. Any other return value is ignored |
| `axleBlockRestore.styleAttributes` | filter | `( string[] names, string blockName )`. Attribute names that count as style. Default `style`, `className`, `align`, `layout`, `backgroundColor`, `textColor`, `fontSize`, `fontFamily`, `gradient`, `borderColor` |
| `axleBlockRestore.restoreModes` | filter | `( string[] modes )`. Ways to restore one block: `replace`, `content`, `style`. Default all three. `replace` is always kept, unknown names are dropped |
| `axleBlockRestore.commands` | filter | `( Object[] commands, string\|null blockId )`. Command palette entries, each `{ name, label, icon, callback }`. Add, change or remove entries |
| `axleBlockRestore.opened` | action | `( { clientId, postType, postId, focusSearch, view } )`. The window opened. `view` is `revisions`, `history`, `removed` or `other`. `clientId` is null for the whole post, template, part or pattern. Template and part IDs look like `theme//slug` |
| `axleBlockRestore.restored` | action | `( { mode, block, revisionId, postId, postType } )`. A block came back. `mode` is `replace`, `content`, `style`, `insert-after`, `replace-at`, `insert-at`, `insert-below`, `inner-replace`, `inner-insert`, `inner-insert-below`, `removed-place`, `removed-end`, `removed-below`, `other-post-below` or `other-post-end`. For the last two the details also have `sourcePostId` and `sourcePostType`, and `revisionId` is a revision of that post or `current` |

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
| `axle-block-restore/block-history` | Read-only. Every version the block at `path` (in the post as it is now) had in the newest `revisions` revisions (default 100, up to 200), newest first: type (`first`, `added`, `edited`, `removed`, `readded`), `revision_id`, `date`, `author`, `autosave`, the text and the text before, whether the text changed, the settings that changed, and how many saves kept that version. An entry with `current` true is what the post has now when it is newer than the newest revision |
| `axle-block-restore/find-deleted` | Read-only. Blocks whose text is in an old revision but not in the post, with the `revision_id` and `path` to restore them |
| `axle-block-restore/find-text` | Read-only. Blocks in old revisions containing `text`, and whether each is still in the post |
| `axle-block-restore/restore-block` | Puts the block at `path` in `revision_id` back: `mode` `insert` at a top-level `position` (default: where it was), or `replace` the block at `target_path` (default: the same path). Saves the post, which makes a new revision, so it can be undone. Refuses while someone else has the post open in the editor, unless `force` is true |

All five need `edit_post` on that post, in a post type that has Axle Block Restore, and the capability the editor asks for (`axle_block_restore_capability`), so narrowing that filter narrows the abilities too. A revision is only read through its parent post. The find abilities look through 20 revisions by default, 50 at most (`axle_block_restore_max_revisions`).

| Hook | Type | Use |
| --- | --- | --- |
| `axle_block_restore_restored` | action | `( int $post_id, array $block, int $revision_id, string $mode )`. A block was saved back through `restore-block` |
| `axle_block_restore_max_revisions` | filter | `( int $max )`. Most revisions the find abilities look through. Default 50 |

## REST

Revisions are fetched 50 at a time from `/wp/v2/<rest base>/<id>/revisions` with `context=edit` and `_fields=id,wp_id,modified,date_gmt,slug,content.raw,axle_block_restore_author`, so the server returns raw block markup and never renders the content. The rest base is `templates`, `template-parts` or `blocks` in the Site Editor.

Template and template part revisions come from core's templates controller, so each one has `id` set to the template's ID (`theme//slug`), its own ID in `wp_id`, and its time in `modified`, in the site's time zone. The window reads those.

The plugin adds one read-only route, `/axle-block-restore/v1/posts` (see Copying a block from another post), and one read-only field to revision responses:

| Field | Value |
| --- | --- |
| `axle_block_restore_author` | Display name of the revision's author. Editors cannot always list users, so the name comes with the revision |

## Data

Nothing is stored. Restores are normal editor changes, saved when the post is updated.
