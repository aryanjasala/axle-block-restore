=== Axle Block Restore ===
Contributors: aryanjasala
Tags: revisions, block editor, undo, restore, blocks
Requires at least: 6.6
Tested up to: 7.1
Requires PHP: 7.4
Stable tag: 3.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Bring back one block from an old revision, such as a deleted paragraph or an earlier version of a section, without undoing every edit since.

== Description ==

WordPress revisions are all or nothing. If someone deleted a paragraph last week and the post has been edited ten times since, "Restore This Revision" brings the paragraph back but throws away the ten edits. The usual workaround is copying text out of the revisions screen by hand, which loses the block's formatting and settings.

Axle Block Restore works inside the block editor and restores single blocks, with all their settings.

Part of [Axle](https://axlewp.com/) by AryanX, a family of free plugins for running WordPress sites safely.

**Restore one block to an earlier version**

1. Select the block and open its menu (⋮).
2. Choose **Restore from a revision…**
3. Pick a revision. You see the versions of that block in it, best match first.
4. Click **Replace current block**, or **Insert below it** to compare them side by side.

**Bring back a deleted block**

1. Open the editor's main menu (⋮ at the top right).
2. Choose **Restore blocks from a revision**.
3. Pick a revision. Its blocks are labelled **Not in the post now**, **Changed since** or **Same as now**.
4. Click **Restore it here** to put a deleted block back where it was.

**Find text you deleted**

Can't remember which revision had the sentence you need? Type a few words into "Find text in old revisions". Every block that contained them is listed, with how many revisions it appears in. Click one to jump to it.

**See what was removed recently**

Open the editor menu, choose **Restore blocks from a revision**, then the **Removed blocks** tab (or run "Show removed blocks" from the command palette). It lists every block, top level or nested, that was in the newest 20 revisions and is gone now, newest removal first, with who saved the last revision that had it, when, and a preview. **Put it back where it was** returns it next to its old neighbours (or inside its old group), and **Insert below the selected block** or **Insert at the end** put it elsewhere. A block that stayed gone for many revisions is listed once, and one that was only edited is not listed.

**Copy a block from another post**

The **Another post** tab searches the posts and pages you can edit. Pick one, choose its current version or one of its revisions, and insert any of its blocks below the selected block or at the end. Only posts you can edit are offered, and the server checks that as well.

**Restore only the content, or only the styling**

With one block selected, each older version also has **Restore content only** (the words, links and inner blocks, keeping the block's current colours, fonts, spacing and layout) and **Restore styling only** (the old look, keeping what the block says now). An option that would change nothing is greyed out, and "Show changes" shows what the option you pick would change.

**Restore a whole group in one step**

A group, columns or any block with inner blocks comes back with everything inside it, and one Ctrl+Z undoes it. When the group still exists, the list shows what differs inside it (blocks added, removed and changed) and lets you restore one inner block without touching the rest.

**In the Site Editor and the command palette**

Templates, template parts and synced patterns have revisions too, and the same two menu entries work on them. A block inside a template part restores from the part's own revisions. The command palette (Ctrl+K, ⌘K) has "Restore blocks from a revision", "Restore selected block from a revision", "Find text in old revisions" and "Show removed blocks".

Every restore is a normal edit: press Ctrl+Z (⌘Z on a Mac) to undo it, and nothing is saved until you update the post.

* "Show changes" highlights the words that differ between the block now and its old version.
* Previews show each block as it looked in that revision.
* Each revision shows who saved it and how many blocks differ from now. Autosaves are labelled, and the window opens on the newest revision that actually differs.
* Works with any block, including blocks from other plugins, and with every post type that has revisions.
* Revisions are loaded without rendering them on the server, so posts with many revisions open quickly.

No settings and nothing stored in the database.

Free and open source under the GPL. No pro version, no upsells, no ads in wp-admin, no tracking. And it stays that way.

**Try it before you install.** [try.axlewp.com/axle-block-restore](https://try.axlewp.com/axle-block-restore) opens a private WordPress in your browser with this plugin and some demo content.

**Every hook** is in the [guide on axlewp.com](https://axlewp.com/docs/axle-block-restore/).

== Frequently Asked Questions ==

= How does it find "the same block" in an old revision? =

Blocks have no permanent ID between saves, so it compares blocks of the same type, preferring the one at the same position and with the most words in common. You can always pick a different version from the list.

= Where is the option? I can't see it. =

It appears in the block editor for post types that keep revisions, such as posts and pages. If revisions are turned off for the site (`WP_POST_REVISIONS` set to `false`), there is nothing to restore from.

= Does it work in the Site Editor? =

Yes, for templates, template parts and synced patterns. A template or template part that still comes from the theme's files has no revisions until you save it once. In a template, WordPress locks the blocks of a template part to content editing, so their block menu has no restore item: choose **Edit original** on the part, or use the command palette.

= How far back does the removed blocks list look? =

At the newest 20 revisions. Developers can change that with the `axleBlockRestore.removedRevisions` filter. A block you only edited is not "removed": it has to have no block of the same type with similar words left in the post. A rewritten block is listed with the label **Rewritten since**.

= Who can copy blocks from another post? =

Only posts the person can edit are searched and listed, and the server checks permission on every post, so titles of other people's posts never reach someone who cannot edit them. Turn the feature off, or limit the post types, with the `axle_block_restore_copy_post_types` filter.

= What counts as content, and what as styling? =

Attributes with `role: content` in a block's `block.json`, and text read from the block's markup, are content. The listed style attributes (`style`, `className`, `align`, `layout`, colours, font size and family, gradient, border colour) and any other setting count as styling. Developers can change this with the `axleBlockRestore.attributeRole` filter, described in the reference.

== Screenshots ==

1. Restoring a deleted paragraph from a revision.
2. Picking an earlier version of one block, with its changes highlighted.
3. Finding deleted text across revisions.
4. Restoring a block of a template part in the Site Editor.
5. Restoring a group, with what differs inside it.

== Changelog ==

= 3.1.0 =
* New: show recently removed blocks and copy blocks from another post
* New: restore blocks in the Site Editor, from the command palette, and by content or styling

= 3.0.0 =
* Changed (breaking change): rename to Axle Block Restore for WordPress.org
* Fix: keep the selected revision's details readable

= 2.0.1 =
* Fix: load revision content on WordPress 6.6 to 6.9

= 2.0.0 =
* Changed (breaking change): rename to Axle Block Restore for WordPress.org

= 1.3.0 =
* Fix: make the abilities visible to MCP agents
* New: add abilities so AI agents can find deleted blocks and restore one block from a revision

= 1.2.0 =
* New: add PHP and JavaScript hooks for post types, which blocks can be restored, and each restore
* Fix: make the restore window translatable and keyboard friendly

= 1.1.0 =
* New: search old revisions for text.
* New: "Show changes" word-level diff between the current block and an old version.
* New: revision list shows the author and the number of differences, and works with the arrow keys.
* Rewritten as PSR-4 classes and separate scripts; the matching logic has unit tests.

= 1.0.0 =
* First release.
