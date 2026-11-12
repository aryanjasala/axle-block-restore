<?php
/**
 * Site Health test: are revisions kept for the post types that have Axle Block Restore.
 *
 * @package AryanX\Axle\BlockRestore
 */

namespace AryanX\Axle\BlockRestore\Health;

use AryanX\Axle\BlockRestore\Plugin;
use AryanX\Axle\BlockRestore\Service;

defined( 'ABSPATH' ) || exit;

/**
 * Axle Block Restore brings blocks back from revisions. A post type that keeps
 * none (`WP_POST_REVISIONS` set to 0 or false, or a `wp_revisions_to_keep`
 * filter) has nothing to restore from, and nothing says so in the editor.
 */
final class Revisions implements Service {

	public const TEST = 'axle_block_restore_revisions';

	/**
	 * Adds the hooks.
	 */
	public function register(): void {
		add_filter( 'site_status_tests', array( $this, 'add_test' ) );
	}

	/**
	 * Adds the direct test.
	 *
	 * @param array $tests Site Health tests.
	 * @return array
	 */
	public function add_test( $tests ) {
		$tests['direct'][ self::TEST ] = array(
			'label' => __( 'Revisions for Axle Block Restore', 'axle-block-restore' ),
			'test'  => array( $this, 'test' ),
		);

		return $tests;
	}

	/**
	 * Post types that have the plugin but keep no revisions.
	 *
	 * @return string[]
	 */
	public function without_revisions(): array {
		$none = array();
		foreach ( Plugin::post_types() as $post_type ) {
			if ( 0 === (int) wp_revisions_to_keep( new \WP_Post( (object) array( 'post_type' => $post_type ) ) ) ) {
				$none[] = $post_type;
			}
		}

		return $none;
	}

	/**
	 * The Site Health test: recommended when a post type keeps no revisions.
	 *
	 * @return array Site Health result.
	 */
	public function test(): array {
		$none   = $this->without_revisions();
		$result = array(
			'label'       => __( 'WordPress keeps revisions to restore blocks from', 'axle-block-restore' ),
			'status'      => 'good',
			'badge'       => array(
				'label' => __( 'Block Restore', 'axle-block-restore' ),
				'color' => 'blue',
			),
			'description' => '<p>' . esc_html__( 'Every post type with Axle Block Restore keeps revisions, so there is something to restore from.', 'axle-block-restore' ) . '</p>',
			'actions'     => '',
			'test'        => self::TEST,
		);

		if ( ! $none ) {
			return $result;
		}

		$result['status']      = 'recommended';
		$result['label']       = __( 'Some content keeps no revisions, so Axle Block Restore has nothing to restore from', 'axle-block-restore' );
		$result['description'] = '<p>' . esc_html(
			sprintf(
				/* translators: %s: post type names, separated by commas. */
				__( 'These post types keep no revisions: %s. Axle Block Restore brings blocks back from revisions, so it finds nothing for them.', 'axle-block-restore' ),
				implode( ', ', $none )
			)
		) . '</p>';
		$result['actions'] = '<p>' . esc_html__( 'Remove the line that sets WP_POST_REVISIONS to 0 or false in wp-config.php, or the code that filters wp_revisions_to_keep.', 'axle-block-restore' ) . '</p>';

		return $result;
	}
}
