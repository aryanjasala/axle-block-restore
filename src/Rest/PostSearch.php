<?php
/**
 * Search for posts to copy blocks from.
 *
 * @package AryanX\Axle\BlockRestore
 */

namespace AryanX\Axle\BlockRestore\Rest;

use AryanX\Axle\BlockRestore\Plugin;
use AryanX\Axle\BlockRestore\Service;

defined( 'ABSPATH' ) || exit;

/**
 * Adds `/axle-block-restore/v1/posts`, a title search limited to posts the user can edit.
 *
 * Core's search endpoint lists published posts to anyone and never lists drafts,
 * and the posts collection in the edit context shows other people's published
 * posts with their raw content. Neither answers "which posts can this person
 * edit", so this route asks WordPress that for every post it returns, and
 * returns titles only. Reading a post's revisions or its current content later
 * goes through core's own endpoints, which check `edit_post` again.
 */
final class PostSearch implements Service {

	public const NAMESPACE = 'axle-block-restore/v1';

	/**
	 * Adds the hooks.
	 */
	public function register(): void {
		add_action( 'rest_api_init', array( $this, 'register_route' ) );
	}

	/**
	 * Registers the route.
	 */
	public function register_route(): void {
		register_rest_route(
			self::NAMESPACE,
			'/posts',
			array(
				'methods'             => \WP_REST_Server::READABLE,
				'callback'            => array( $this, 'search' ),
				'permission_callback' => array( $this, 'can_search' ),
				'args'                => array(
					'search'     => array(
						'type'              => 'string',
						'default'           => '',
						'sanitize_callback' => 'sanitize_text_field',
					),
					'post_type'  => array(
						'type'    => 'string',
						'default' => '',
					),
					'exclude_id' => array(
						'type'    => 'integer',
						'default' => 0,
					),
					'per_page'   => array(
						'type'    => 'integer',
						'default' => 10,
						'minimum' => 1,
					),
				),
			)
		);
	}

	/**
	 * Post types the current user may copy blocks from.
	 *
	 * Post types that have Axle Block Restore and that the user can edit, narrowed by a filter.
	 *
	 * @return string[] Empty when copying from other posts is off.
	 */
	public static function source_post_types(): array {
		$default = array_values( array_intersect( Plugin::post_types(), Plugin::editable_post_types() ) );

		/**
		 * Filters the post types blocks can be copied from into another post's editor.
		 *
		 * Return an empty array to turn copying from other posts off. Types that
		 * the user cannot edit, or that do not have Axle Block Restore, are dropped.
		 * Applies to the editor and to the search route, which enforces it.
		 *
		 * @param string[] $post_types Default every post type the user can edit that has Axle Block Restore.
		 */
		$filtered = (array) apply_filters( 'axle_block_restore_copy_post_types', $default );

		return array_values( array_intersect( array_map( 'strval', $filtered ), $default ) );
	}

	/**
	 * Whether the user may search at all.
	 *
	 * @return bool|\WP_Error
	 */
	public function can_search() {
		if ( ! self::source_post_types() ) {
			return new \WP_Error(
				'axle_block_restore_copy_off',
				__( 'Copying blocks from other posts is not available.', 'axle-block-restore' ),
				array( 'status' => 403 )
			);
		}

		return true;
	}

	/**
	 * Posts matching a search that the user can edit.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return array[] Each post: id, title, type, type_label, status, modified, rest_base and rest_namespace.
	 */
	public function search( $request ): array {
		$allowed = self::source_post_types();
		$type    = (string) $request->get_param( 'post_type' );
		$types   = '' !== $type && in_array( $type, $allowed, true ) ? array( $type ) : $allowed;
		$exclude = (int) $request->get_param( 'exclude_id' );
		$search  = (string) $request->get_param( 'search' );

		/**
		 * Filters the most posts one search returns.
		 *
		 * @param int $max Default 20.
		 */
		$max   = max( 1, (int) apply_filters( 'axle_block_restore_copy_max_results', 20 ) );
		$limit = max( 1, min( $max, (int) ( $request->get_param( 'per_page' ) ?? 10 ) ) );
		$batch = 50;
		$items = array();

		// Posts the user cannot edit are skipped one by one, so look further until the page is full. Capped so a huge site answers fast.
		$page = 0;
		do {
			++$page;
			$query = new \WP_Query(
				array(
					'post_type'              => $types,
					'post_status'            => array( 'publish', 'future', 'draft', 'pending', 'private' ),
					's'                      => $search,
					'posts_per_page'         => $batch,
					'paged'                  => $page,
					'orderby'                => '' !== $search ? 'relevance' : 'modified',
					'order'                  => 'DESC',
					'fields'                 => 'ids',
					'no_found_rows'          => true,
					'ignore_sticky_posts'    => true,
					'update_post_term_cache' => false,
				)
			);

			foreach ( $query->posts as $post_id ) {
				$post_id = (int) $post_id;
				if ( $post_id === $exclude || ! current_user_can( 'edit_post', $post_id ) ) {
					continue;
				}
				$items[] = $this->item( $post_id );
				if ( count( $items ) >= $limit ) {
					break 2;
				}
			}
			$full = count( $query->posts ) >= $batch;
		} while ( $full && $page < 5 );

		return $items;
	}

	/**
	 * One post as the editor lists it. Titles and dates only, never content.
	 *
	 * @param int $post_id Post.
	 * @return array
	 */
	private function item( int $post_id ): array {
		$type   = (string) get_post_type( $post_id );
		$object = get_post_type_object( $type );

		return array(
			'id'             => $post_id,
			'title'          => html_entity_decode( wp_strip_all_tags( get_the_title( $post_id ) ), ENT_QUOTES, 'UTF-8' ),
			'type'           => $type,
			'type_label'     => $object && isset( $object->labels->singular_name ) ? (string) $object->labels->singular_name : $type,
			'status'         => (string) get_post_status( $post_id ),
			'modified'       => (string) get_post_modified_time( 'c', true, $post_id ),
			'rest_base'      => $object && ! empty( $object->rest_base ) ? (string) $object->rest_base : $type,
			'rest_namespace' => $object && ! empty( $object->rest_namespace ) ? (string) $object->rest_namespace : 'wp/v2',
		);
	}
}
