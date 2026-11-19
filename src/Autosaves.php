<?php
/**
 * Autosaves of other people: who may see them, and the list the editor shows.
 *
 * WordPress keeps one autosave per person per post. Only that person is told
 * about it. This plugin lists the autosaves of everyone else to people who can
 * edit other people's posts and this post, so a colleague's unsaved work can be
 * picked up. Everyone else gets nothing: no name, no content, no count.
 *
 * @package AryanX\Axle\BlockRestore
 */

namespace AryanX\Axle\BlockRestore;

defined( 'ABSPATH' ) || exit;

/**
 * The gate for other people's autosaves, and the REST route that lists them. Core's own routes are left as they are.
 */
final class Autosaves implements Service {

	public const ROUTE_NAMESPACE = 'axle-block-restore/v1';

	/**
	 * Adds the hooks.
	 */
	public function register(): void {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	/**
	 * Registers `GET /axle-block-restore/v1/autosaves/<post>`.
	 */
	public function register_routes(): void {
		register_rest_route(
			self::ROUTE_NAMESPACE,
			'/autosaves/(?P<post>\d+)',
			array(
				'methods'             => 'GET',
				'callback'            => array( $this, 'get_items' ),
				'permission_callback' => array( $this, 'can_list' ),
				'args'                => array(
					'post' => array(
						'type'     => 'integer',
						'required' => true,
					),
				),
			)
		);
	}

	/**
	 * Capability that lets a person see other people's autosaves of a post type.
	 *
	 * @param string $post_type Post type.
	 * @return string
	 */
	public static function capability( string $post_type ): string {
		$object     = get_post_type_object( $post_type );
		$capability = $object && isset( $object->cap->edit_others_posts ) ? (string) $object->cap->edit_others_posts : 'edit_others_posts';

		/**
		 * Filters the capability needed to see and restore from other people's autosaves.
		 *
		 * A person also needs `edit_post` for the post itself.
		 *
		 * @param string $capability Default the post type's `edit_others_posts` capability.
		 * @param string $post_type  Post type.
		 */
		$filtered = (string) apply_filters( 'axle_block_restore_autosaves_capability', $capability, $post_type );

		return '' !== $filtered ? $filtered : $capability;
	}

	/**
	 * Whether the current person may see other people's autosaves of a post.
	 *
	 * @param int $post_id Post.
	 * @return bool
	 */
	public static function can_see_for_post( int $post_id ): bool {
		if ( self::is_shell() ) {
			return true;
		}
		$post = get_post( $post_id );

		return $post && Plugin::is_enabled( $post->post_type ) && current_user_can( Plugin::capability( $post->post_type ) ) && current_user_can( 'edit_post', $post->ID ) && current_user_can( self::capability( $post->post_type ) );
	}

	/**
	 * Whether a revision is an autosave that somebody else made.
	 *
	 * @param \WP_Post $revision Revision.
	 * @return bool
	 */
	public static function is_others( \WP_Post $revision ): bool {
		return 'revision' === $revision->post_type && false !== wp_is_post_autosave( $revision ) && get_current_user_id() !== (int) $revision->post_author;
	}

	/**
	 * Whether the current person may see a revision at all: any saved revision, the person's own autosave, or somebody else's autosave when the gate is open.
	 *
	 * @param \WP_Post $revision Revision.
	 * @return bool
	 */
	public static function can_see( \WP_Post $revision ): bool {
		if ( self::is_shell() || ! self::is_others( $revision ) ) {
			return true;
		}

		return self::can_see_for_post( (int) $revision->post_parent );
	}

	/**
	 * Other people's autosaves of a post, newest first.
	 *
	 * Gives nothing unless the current person may see them.
	 *
	 * @param int $post_id Post.
	 * @return array[] Each: id, author_id, author, date_gmt, content.
	 */
	public static function for_post( int $post_id ): array {
		if ( ! self::can_see_for_post( $post_id ) ) {
			return array();
		}

		/**
		 * Filters how many autosaves of other people the list holds at most.
		 *
		 * There is one per person per post, so the default is generous.
		 *
		 * @param int $limit   Default 20.
		 * @param int $post_id Post.
		 */
		$limit = max( 1, (int) apply_filters( 'axle_block_restore_autosaves_limit', 20, $post_id ) );
		$items = array();

		foreach ( wp_get_post_revisions(
			$post_id,
			array(
				'check_enabled'  => false,
				'posts_per_page' => 100,
				'orderby'        => 'date ID',
				'order'          => 'DESC',
			) 
		) as $revision ) {
			if ( ! self::is_others( $revision ) ) {
				continue;
			}
			$user    = get_userdata( (int) $revision->post_author );
			$items[] = array(
				'id'        => (int) $revision->ID,
				'author_id' => (int) $revision->post_author,
				'author'    => $user ? $user->display_name : '',
				'date_gmt'  => (string) $revision->post_date_gmt,
				'content'   => (string) $revision->post_content,
			);
			if ( count( $items ) >= $limit ) {
				break;
			}
		}

		/**
		 * Filters the list of other people's autosaves the editor shows.
		 *
		 * Runs only after the capability check. Keep each item's keys.
		 *
		 * @param array[] $items   Newest first. Each: id, author_id, author, date_gmt, content.
		 * @param int     $post_id Post.
		 */
		$items = (array) apply_filters( 'axle_block_restore_autosaves', $items, $post_id );

		/**
		 * Fires after the autosaves of other people were listed for the current person.
		 *
		 * @param int     $post_id Post.
		 * @param array[] $items   What was listed.
		 */
		do_action( 'axle_block_restore_autosaves_listed', $post_id, $items );

		return array_values( $items );
	}

	/**
	 * Permission for the route: the same answer for a post that is not there and one that is off limits.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return bool|\WP_Error
	 */
	public function can_list( $request ) {
		if ( self::can_see_for_post( (int) $request['post'] ) ) {
			return true;
		}

		return new \WP_Error( 'rest_forbidden', __( 'Sorry, you are not allowed to do that.', 'axle-block-restore' ), array( 'status' => rest_authorization_required_code() ) );
	}

	/**
	 * Route callback.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response
	 */
	public function get_items( $request ): \WP_REST_Response {
		$items = array();
		foreach ( self::for_post( (int) $request['post'] ) as $item ) {
			$items[] = array(
				'id'                       => (int) $item['id'],
				'author_id'                => (int) $item['author_id'],
				'date_gmt'                 => (string) $item['date_gmt'],
				'slug'                     => (int) $request['post'] . '-autosave-v1',
				'content'                  => array( 'raw' => (string) $item['content'] ),
				Rest\RevisionAuthor::FIELD => (string) $item['author'],
			);
		}

		return rest_ensure_response( $items );
	}

	/**
	 * True for WP-CLI runs with no logged-in user: the shell is trusted, as the commands say.
	 *
	 * @return bool
	 */
	private static function is_shell(): bool {
		return defined( 'WP_CLI' ) && WP_CLI && 0 === get_current_user_id();
	}
}
