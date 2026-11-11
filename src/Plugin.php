<?php
/**
 * Plugin bootstrap.
 *
 * @package AryanX\Axle\BlockRestore
 */

namespace AryanX\Axle\BlockRestore;

use AryanX\Axle\BlockRestore\Editor\Assets;
use AryanX\Axle\BlockRestore\Rest\PostSearch;
use AryanX\Axle\BlockRestore\Rest\RevisionAuthor;
use AryanX\Axle\BlockRestore\Rest\RevisionContent;

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

			$services = array( new Assets(), new RevisionAuthor(), new RevisionContent(), new PostSearch(), new Abilities() );
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
		 * Filters the post types that get Axle Block Restore in the editor.
		 *
		 * Only post types with revisions and the editor make sense; others are dropped.
		 *
		 * @param string[] $post_types Default every REST-enabled post type with revisions and the editor.
		 */
		$filtered = (array) apply_filters( 'axle_block_restore_post_types', $post_types );

		return array_values(
			array_filter(
				array_map( 'strval', $filtered ),
				static function ( string $post_type ): bool {
					return post_type_exists( $post_type ) && post_type_supports( $post_type, 'revisions' );
				}
			)
		);
	}

	/**
	 * Post types the Site Editor adds to the list: templates, template parts and synced patterns.
	 *
	 * @return string[]
	 */
	public static function site_editor_post_types(): array {
		/**
		 * Filters the Site Editor post types that get Axle Block Restore.
		 *
		 * Only post types that exist, support revisions and are in the REST API are kept.
		 *
		 * @param string[] $post_types Default wp_template, wp_template_part and wp_block.
		 */
		$filtered = (array) apply_filters( 'axle_block_restore_site_editor_post_types', array( 'wp_template', 'wp_template_part', 'wp_block' ) );

		return array_values(
			array_filter(
				array_map( 'strval', $filtered ),
				static function ( string $post_type ): bool {
					$object = get_post_type_object( $post_type );

					return $object && $object->show_in_rest && post_type_supports( $post_type, 'revisions' );
				}
			)
		);
	}

	/**
	 * Every post type the plugin works with, in the post editor or the Site Editor.
	 *
	 * @return string[]
	 */
	public static function all_post_types(): array {
		return array_values( array_unique( array_merge( self::post_types(), self::site_editor_post_types() ) ) );
	}

	/**
	 * Capability needed to see revisions of a post type in the editor.
	 *
	 * Templates and template parts need `edit_theme_options`, synced patterns
	 * and posts need `edit_posts`: each is the post type's own `edit_posts`
	 * capability. The REST API checks the real permission on every request.
	 *
	 * @param string $post_type Post type.
	 * @return string
	 */
	public static function capability( string $post_type ): string {
		$object     = get_post_type_object( $post_type );
		$capability = $object && isset( $object->cap->edit_posts ) ? (string) $object->cap->edit_posts : 'edit_posts';

		/**
		 * Filters the capability needed to use Axle Block Restore on a post type.
		 *
		 * @param string $capability Default the post type's `edit_posts` capability.
		 * @param string $post_type  Post type.
		 */
		$filtered = (string) apply_filters( 'axle_block_restore_capability', $capability, $post_type );

		return '' !== $filtered ? $filtered : $capability;
	}

	/**
	 * Post types the current user can restore blocks in.
	 *
	 * @return string[]
	 */
	public static function editable_post_types(): array {
		return array_values(
			array_filter(
				self::all_post_types(),
				static function ( string $post_type ): bool {
					return current_user_can( self::capability( $post_type ) );
				}
			)
		);
	}
}
