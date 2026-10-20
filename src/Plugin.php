<?php
/**
 * Plugin bootstrap.
 *
 * @package AryanX\RestoreOneBlock
 */

namespace AryanX\RestoreOneBlock;

use AryanX\RestoreOneBlock\Editor\Assets;
use AryanX\RestoreOneBlock\Rest\RevisionAuthor;

defined( 'ABSPATH' ) || exit;

/**
 * Registers the editor scripts and the REST field they use.
 */
final class Plugin {

	/**
	 * The running instance.
	 *
	 * @var Plugin|null
	 */
	private static ?Plugin $instance = null;

	/**
	 * Starts the plugin. Runs on `plugins_loaded`.
	 */
	public static function boot(): void {
		if ( null === self::$instance ) {
			self::$instance = new self();

			$services = array( new Assets(), new RevisionAuthor(), new Abilities() );
			foreach ( $services as $service ) {
				$service->register();
			}
		}
	}

	/**
	 * Post types the plugin works with: editable in the block editor, with revisions.
	 *
	 * @return string[]
	 */
	public static function post_types(): array {
		$post_types = array_values(
			array_filter(
				get_post_types( array( 'show_in_rest' => true ) ),
				static function ( string $post_type ): bool {
					return post_type_supports( $post_type, 'revisions' ) && post_type_supports( $post_type, 'editor' );
				}
			)
		);

		/**
		 * Filters the post types that get Restore One Block in the editor.
		 *
		 * Only post types with revisions and the editor make sense; others are dropped.
		 *
		 * @param string[] $post_types Default every REST-enabled post type with revisions and the editor.
		 */
		$filtered = (array) apply_filters( 'restore_one_block_post_types', $post_types );

		return array_values(
			array_filter(
				array_map( 'strval', $filtered ),
				static function ( string $post_type ): bool {
					return post_type_exists( $post_type ) && post_type_supports( $post_type, 'revisions' );
				}
			)
		);
	}
}
