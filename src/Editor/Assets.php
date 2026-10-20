<?php
/**
 * Editor scripts and styles.
 *
 * @package AryanX\RestoreBlocksFromRevisions
 */

namespace AryanX\RestoreBlocksFromRevisions\Editor;

use AryanX\RestoreBlocksFromRevisions\Plugin;
use AryanX\RestoreBlocksFromRevisions\Service;
use const AryanX\RestoreBlocksFromRevisions\PLUGIN_FILE;
use const AryanX\RestoreBlocksFromRevisions\VERSION;

defined( 'ABSPATH' ) || exit;

/**
 * Loads the three editor scripts on post editing screens.
 *
 * The matching script has no WordPress dependencies (it is unit tested in
 * Node), the components script builds the restore window on top of it, and
 * the index script adds the menu entries.
 */
final class Assets implements Service {

	/**
	 * Adds the hooks.
	 */
	public function register(): void {
		add_action( 'enqueue_block_editor_assets', array( $this, 'enqueue' ) );
	}

	/**
	 * Enqueues the scripts in the post editor, for post types with revisions.
	 */
	public function enqueue(): void {
		$screen = get_current_screen();
		if ( ! $screen || 'post' !== $screen->base || ! in_array( $screen->post_type, Plugin::post_types(), true ) ) {
			return;
		}

		$url = plugins_url( 'assets/', PLUGIN_FILE );

		wp_register_script( 'restore-blocks-from-revisions-matching', $url . 'js/matching.js', array(), VERSION, true );
		wp_register_script(
			'restore-blocks-from-revisions-components',
			$url . 'js/components.js',
			array(
				'restore-blocks-from-revisions-matching',
				'wp-api-fetch',
				'wp-block-editor',
				'wp-blocks',
				'wp-components',
				'wp-core-data',
				'wp-data',
				'wp-date',
				'wp-editor',
				'wp-element',
				'wp-hooks',
				'wp-i18n',
				'wp-notices',
				'wp-url',
			),
			VERSION,
			true
		);
		wp_enqueue_script( 'restore-blocks-from-revisions', $url . 'js/index.js', array( 'restore-blocks-from-revisions-components', 'wp-data', 'wp-hooks', 'wp-plugins' ), VERSION, true );

		wp_set_script_translations( 'restore-blocks-from-revisions-components', 'restore-blocks-from-revisions' );
		wp_set_script_translations( 'restore-blocks-from-revisions', 'restore-blocks-from-revisions' );

		wp_enqueue_style( 'restore-blocks-from-revisions', $url . 'editor.css', array( 'wp-components' ), VERSION );
	}
}
