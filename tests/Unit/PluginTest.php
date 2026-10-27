<?php
/**
 * Tests for which post types get the editor tools, and the revision REST fields.
 *
 * @package AryanX\Axle\RestoreBlocksFromRevisions
 */

namespace AryanX\Axle\RestoreBlocksFromRevisions\Tests\Unit;

use AryanX\Axle\RestoreBlocksFromRevisions\Plugin;
use AryanX\Axle\RestoreBlocksFromRevisions\Rest\RevisionAuthor;
use AryanX\Axle\RestoreBlocksFromRevisions\Rest\RevisionContent;
use Brain\Monkey\Filters;
use Brain\Monkey\Functions;

final class PluginTest extends TestCase {

	/**
	 * Post types and what they support, as WordPress would report them.
	 */
	private function post_types_exist(): void {
		$supports = array(
			'post'       => array( 'editor', 'revisions' ),
			'page'       => array( 'editor', 'revisions' ),
			'attachment' => array(),
			'wp_block'   => array( 'editor' ),
		);
		Functions\when( 'get_post_types' )->justReturn( array_combine( array_keys( $supports ), array_keys( $supports ) ) );
		Functions\when( 'post_type_exists' )->alias(
			static function ( $post_type ) use ( $supports ) {
				return isset( $supports[ $post_type ] );
			}
		);
		Functions\when( 'post_type_supports' )->alias(
			static function ( $post_type, $feature ) use ( $supports ) {
				return in_array( $feature, $supports[ $post_type ] ?? array(), true );
			}
		);
	}

	public function test_only_editor_post_types_with_revisions_are_supported(): void {
		$this->post_types_exist();

		$this->assertSame( array( 'post', 'page' ), Plugin::post_types() );
	}

	public function test_the_filter_can_narrow_the_list_but_not_add_types_without_revisions(): void {
		$this->post_types_exist();
		Filters\expectApplied( 'restore_blocks_from_revisions_post_types' )->andReturn( array( 'post', 'attachment', 'product' ) );

		$this->assertSame( array( 'post' ), Plugin::post_types() );
	}

	public function test_revision_author_is_the_display_name(): void {
		Functions\when( 'get_userdata' )->alias(
			static function ( $user_id ) {
				return 3 === $user_id ? (object) array( 'display_name' => 'Aryan' ) : false;
			}
		);
		$field = new RevisionAuthor();

		$this->assertSame( 'Aryan', $field->author_name( array( 'author' => 3 ) ) );
		$this->assertSame( '', $field->author_name( array( 'author' => 99 ) ) );
	}

	/**
	 * Runs the content filter on a revision response.
	 *
	 * @param array $data   Response data from core.
	 * @param array $params Request parameters.
	 * @return mixed Response data after the filter.
	 */
	private function revision_response( array $data, array $params ) {
		Functions\when( 'wp_parse_list' )->alias(
			static function ( $list ) {
				return is_array( $list ) ? $list : array_values( array_filter( array_map( 'trim', explode( ',', (string) $list ) ) ) );
			}
		);
		$revision = new \WP_Post( array( 'post_content' => '<!-- wp:paragraph --><p>Old</p><!-- /wp:paragraph -->' ) );

		return ( new RevisionContent() )->add_raw_content( new \WP_REST_Response( $data ), $revision, new \WP_REST_Request( $params ) )->get_data();
	}

	public function test_raw_content_is_added_when_core_leaves_it_out(): void {
		$data = $this->revision_response(
			array( 'id' => 5 ),
			array(
				'context' => 'edit',
				'_fields' => 'id,date_gmt,content.raw',
			)
		);

		$this->assertSame( '<!-- wp:paragraph --><p>Old</p><!-- /wp:paragraph -->', $data['content']['raw'] );
	}

	public function test_content_from_core_is_left_alone(): void {
		$data = $this->revision_response(
			array(
				'id'      => 5,
				'content' => array( 'raw' => 'From core' ),
			),
			array(
				'context' => 'edit',
				'_fields' => array( 'id', 'content.raw' ),
			)
		);

		$this->assertSame( array( 'raw' => 'From core' ), $data['content'] );
	}

	public function test_raw_content_needs_the_edit_context_and_the_field(): void {
		$view = $this->revision_response(
			array( 'id' => 5 ),
			array(
				'context' => 'view',
				'_fields' => 'content.raw',
			)
		);
		$unasked = $this->revision_response(
			array( 'id' => 5 ),
			array(
				'context' => 'edit',
				'_fields' => 'id,date_gmt',
			)
		);

		$this->assertArrayNotHasKey( 'content', $view );
		$this->assertArrayNotHasKey( 'content', $unasked );
	}
}
