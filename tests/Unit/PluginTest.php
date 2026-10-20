<?php
/**
 * Tests for which post types get the editor tools, and the revision author field.
 *
 * @package AryanX\RestoreOneBlock
 */

namespace AryanX\RestoreOneBlock\Tests\Unit;

use AryanX\RestoreOneBlock\Plugin;
use AryanX\RestoreOneBlock\Rest\RevisionAuthor;
use Brain\Monkey\Functions;

final class PluginTest extends TestCase {

	public function test_only_editor_post_types_with_revisions_are_supported(): void {
		Functions\when( 'get_post_types' )->justReturn(
			array(
				'post'       => 'post',
				'page'       => 'page',
				'attachment' => 'attachment',
				'wp_block'   => 'wp_block',
			)
		);
		Functions\when( 'post_type_supports' )->alias(
			static function ( $post_type, $feature ) {
				$supports = array(
					'post'       => array( 'editor', 'revisions' ),
					'page'       => array( 'editor', 'revisions' ),
					'attachment' => array(),
					'wp_block'   => array( 'editor' ),
				);
				return in_array( $feature, $supports[ $post_type ], true );
			}
		);

		$this->assertSame( array( 'post', 'page' ), Plugin::post_types() );
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
