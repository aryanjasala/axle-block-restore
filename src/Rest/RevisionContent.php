<?php
/**
 * Raw revision content for WordPress before 7.0.
 *
 * @package AryanX\RestoreBlocksFromRevisions
 */

namespace AryanX\RestoreBlocksFromRevisions\Rest;

use AryanX\RestoreBlocksFromRevisions\Service;

defined( 'ABSPATH' ) || exit;

/**
 * Adds `content.raw` to revision responses when core leaves it out.
 *
 * The editor asks for `_fields=content.raw` so the server does not render
 * every revision. Before WordPress 7.0 the revisions controller only returned
 * content when `content` itself was in `_fields`, so the editor got revisions
 * with no blocks. On 7.0 and later core returns it and this does nothing.
 *
 * The revisions endpoint has already checked that the user can edit the
 * parent post, and this only runs in the edit context, as core does.
 */
final class RevisionContent implements Service {

	/**
	 * Adds the hooks.
	 */
	public function register(): void {
		add_filter( 'rest_prepare_revision', array( $this, 'add_raw_content' ), 10, 3 );
	}

	/**
	 * Fills in `content.raw` when it was asked for and core left it out.
	 *
	 * @param mixed            $response Revision response.
	 * @param \WP_Post         $post     Revision.
	 * @param \WP_REST_Request $request  Request.
	 * @return mixed
	 */
	public function add_raw_content( $response, $post, $request ) {
		if ( ! $response instanceof \WP_REST_Response || 'edit' !== $request->get_param( 'context' ) ) {
			return $response;
		}

		$data = $response->get_data();
		if ( ! is_array( $data ) || isset( $data['content'] ) ) {
			return $response;
		}

		if ( ! in_array( 'content.raw', wp_parse_list( $request->get_param( '_fields' ) ?? '' ), true ) ) {
			return $response;
		}

		$data['content'] = array( 'raw' => $post->post_content );
		$response->set_data( $data );

		return $response;
	}
}
