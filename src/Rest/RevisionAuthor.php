<?php
/**
 * Author name on revisions in the REST API.
 *
 * @package AryanX\Axle\BlockRestore
 */

namespace AryanX\Axle\BlockRestore\Rest;

use AryanX\Axle\BlockRestore\Plugin;
use AryanX\Axle\BlockRestore\Service;

defined( 'ABSPATH' ) || exit;

/**
 * Adds `axle_block_restore_author` to revision responses.
 *
 * Revisions only carry an author ID, and editors cannot always list users,
 * so the name comes with the revision. Revisions are only readable by people
 * who can edit the post, so this shows nothing they could not see already.
 */
final class RevisionAuthor implements Service {

	public const FIELD = 'axle_block_restore_author';

	/**
	 * Adds the hooks.
	 */
	public function register(): void {
		add_action( 'rest_api_init', array( $this, 'register_field' ) );
	}

	/**
	 * Registers the field for each post type's revisions.
	 *
	 * The revisions controller names its object type "{post type}-revision".
	 * Template and template part revisions are prepared like templates, so
	 * their object type is the post type itself.
	 */
	public function register_field(): void {
		$args = array(
			'get_callback' => array( $this, 'author_name' ),
			'schema'       => array(
				'description' => __( 'Display name of the revision author.', 'axle-block-restore' ),
				'type'        => 'string',
				'context'     => array( 'edit' ),
				'readonly'    => true,
			),
		);

		foreach ( Plugin::all_post_types() as $post_type ) {
			register_rest_field( $post_type . '-revision', self::FIELD, $args );

			if ( in_array( $post_type, array( 'wp_template', 'wp_template_part' ), true ) ) {
				register_rest_field( $post_type, self::FIELD, $args );
			}
		}
	}

	/**
	 * Display name of a revision's author.
	 *
	 * @param array $revision Prepared revision data.
	 * @return string
	 */
	public function author_name( array $revision ): string {
		$author = $revision['author'] ?? get_post_field( 'post_author', (int) ( $revision['wp_id'] ?? $revision['id'] ?? 0 ) );
		$user   = get_userdata( (int) $author );

		return $user ? $user->display_name : '';
	}
}
