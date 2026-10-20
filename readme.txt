=== Restore Blocks from Revisions ===
Contributors: aryanjasala
Tags: revisions, block editor, undo, restore, gutenberg
Requires at least: 6.6
Tested up to: 7.1
Requires PHP: 7.4
Stable tag: 1.3.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Bring back one block from an old revision, such as a deleted paragraph or an earlier version of a section, without undoing every edit since.

== Description ==

WordPress revisions are all or nothing. If someone deleted a paragraph last week and the post has been edited ten times since, "Restore This Revision" brings the paragraph back but throws away the ten edits. The usual workaround is copying text out of the revisions screen by hand, which loses the block's formatting and settings.

Restore Blocks from Revisions works inside the block editor and restores single blocks, with all their settings.

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

Every restore is a normal edit: press Ctrl+Z (⌘Z on a Mac) to undo it, and nothing is saved until you update the post.

* "Show changes" highlights the words that differ between the block now and its old version.
* Previews show each block as it looked in that revision.
* Each revision shows who saved it and how many blocks differ from now. Autosaves are labelled, and the window opens on the newest revision that actually differs.
* Works with any block, including blocks from other plugins, and with every post type that has revisions.
* Revisions are loaded without rendering them on the server, so posts with many revisions open quickly.

No settings and nothing stored in the database.

Free and open source under the GPL. No pro version, no upsells, no ads in wp-admin, no tracking. And it stays that way.

== Frequently Asked Questions ==

= How does it find "the same block" in an old revision? =

Blocks have no permanent ID between saves, so it compares blocks of the same type, preferring the one at the same position and with the most words in common. You can always pick a different version from the list.

= Where is the option? I can't see it. =

It appears in the block editor for post types that keep revisions, such as posts and pages. If revisions are turned off for the site (`WP_POST_REVISIONS` set to `false`), there is nothing to restore from.

= Does it work in the Site Editor? =

Not yet. Templates have revisions too, and support is planned.

== Screenshots ==

1. Restoring a deleted paragraph from a revision.
2. Picking an earlier version of one block, with its changes highlighted.
3. Finding deleted text across revisions.

== Changelog ==

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
