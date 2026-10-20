<?php
/**
 * Tests for which post types get the editor tools, and the revision author field.
 *
 * @package AryanX\RestoreBlocksFromRevisions
 */

namespace AryanX\RestoreBlocksFromRevisions\Tests\Unit;

use AryanX\RestoreBlocksFromRevisions\Plugin;
use AryanX\RestoreBlocksFromRevisions\Rest\RevisionAuthor;
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
}
