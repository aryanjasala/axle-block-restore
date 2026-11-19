<?php
/**
 * The address that opens a block's history.
 *
 * `post.php?post=12&action=edit&axle-block-restore=history&revision=345&path=2`
 * is the public address other Axle plugins link to. WordPress 7.0 reads
 * `revision` in an edit address itself and opens its own revisions view, which
 * is not what the link means. So the server renames it to `axle-revision` before
 * the editor loads, and the editor script reads that name.
 *
 * @package AryanX\Axle\BlockRestore
 */

namespace AryanX\Axle\BlockRestore;

defined( 'ABSPATH' ) || exit;

/**
 * Renames `revision` to `axle-revision` on history links.
 */
final class DeepLink implements Service {

	public const QUERY_ARG = 'axle-block-restore';

	/**
	 * Adds the hooks.
	 */
	public function register(): void {
		add_action( 'load-post.php', array( $this, 'maybe_redirect' ) );
	}

	/**
	 * Redirects a history link that carries `revision`, so core's own revisions view does not open.
	 */
	public function maybe_redirect(): void {
		// A link is read-only navigation: nothing is changed, so there is no nonce to check.
		$query = array();
		foreach ( array( self::QUERY_ARG, 'revision', 'post', 'action', 'path', 'anchor', 'clientId' ) as $key ) {
			if ( isset( $_GET[ $key ] ) && is_string( $_GET[ $key ] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
				$query[ $key ] = sanitize_text_field( wp_unslash( $_GET[ $key ] ) ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			}
		}

		$url = self::redirect_url( $query );
		if ( null !== $url ) {
			wp_safe_redirect( $url );
			exit;
		}
	}

	/**
	 * The address to send a history link to, or null when it needs no change.
	 *
	 * @param array<string,string> $query Query arguments of the request.
	 * @return string|null
	 */
	public static function redirect_url( array $query ): ?string {
		if ( 'history' !== ( $query[ self::QUERY_ARG ] ?? '' ) || ! isset( $query['revision'] ) || isset( $query['axle-revision'] ) ) {
			return null;
		}

		$revision = (string) $query['revision'];
		unset( $query['revision'] );
		if ( ctype_digit( $revision ) && (int) $revision > 0 ) {
			$query['axle-revision'] = $revision;
		}

		return add_query_arg( $query, admin_url( 'post.php' ) );
	}
}
