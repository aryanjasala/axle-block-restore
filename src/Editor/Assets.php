<?php
/**
 * Editor scripts and styles.
 *
 * @package AryanX\Axle\BlockRestore
 */

namespace AryanX\Axle\BlockRestore\Editor;

use AryanX\Axle\BlockRestore\Plugin;
use AryanX\Axle\BlockRestore\Service;
use const AryanX\Axle\BlockRestore\PLUGIN_FILE;
use const AryanX\Axle\BlockRestore\VERSION;

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

		wp_register_script( 'axle-block-restore-matching', $url . 'js/matching.js', array(), VERSION, true );
		wp_register_script(
			'axle-block-restore-components',
			$url . 'js/components.js',
			array(
				'axle-block-restore-matching',
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
		wp_enqueue_script( 'axle-block-restore', $url . 'js/index.js', array( 'axle-block-restore-components', 'wp-data', 'wp-hooks', 'wp-plugins' ), VERSION, true );

		wp_set_script_translations( 'axle-block-restore-components', 'axle-block-restore' );
		wp_set_script_translations( 'axle-block-restore', 'axle-block-restore' );

		wp_enqueue_style( 'axle-block-restore', $url . 'editor.css', array( 'wp-components' ), VERSION );
	}
}
