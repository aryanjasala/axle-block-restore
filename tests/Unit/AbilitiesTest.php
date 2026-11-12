<?php
/**
 * Tests for who may use the abilities, and the block history ability.
 *
 * @package AryanX\Axle\BlockRestore
 */

namespace AryanX\Axle\BlockRestore\Tests\Unit;

use AryanX\Axle\BlockRestore\Abilities;
use Brain\Monkey\Actions;
use Brain\Monkey\Filters;
use Brain\Monkey\Functions;

final class AbilitiesTest extends TestCase {

	protected function setUp(): void {
		parent::setUp();
		Functions\when( 'get_post_types' )->justReturn( array( 'post' => 'post' ) );
		Functions\when( 'post_type_exists' )->justReturn( true );
		Functions\when( 'post_type_supports' )->justReturn( true );
		Functions\when( 'get_post_type_object' )->justReturn( (object) array( 'cap' => (object) array( 'edit_posts' => 'edit_posts' ) ) );
	}

	/**
	 * Lets the current user have only some capabilities.
	 *
	 * @param string[] $caps Capabilities the user has. `edit_post` is checked for post 7.
	 */
	private function user_can( array $caps ): void {
		Functions\when( 'current_user_can' )->alias(
			static function ( $cap, $id = 0 ) use ( $caps ) {
				return in_array( $cap, $caps, true ) && ( 'edit_post' !== $cap || 7 === $id );
			}
		);
	}

	public function test_a_user_who_can_edit_the_post_may_use_the_abilities(): void {
		Functions\when( 'get_post' )->justReturn( new \WP_Post( array( 'ID' => 7, 'post_type' => 'post' ) ) );
		$this->user_can( array( 'edit_posts', 'edit_post' ) );

		$this->assertTrue( ( new Abilities() )->can_edit( array( 'post_id' => 7 ) ) );
	}

	public function test_edit_post_is_checked_for_the_post_asked_about(): void {
		Functions\when( 'get_post' )->justReturn( new \WP_Post( array( 'ID' => 8, 'post_type' => 'post' ) ) );
		$this->user_can( array( 'edit_posts', 'edit_post' ) );

		$this->assertFalse( ( new Abilities() )->can_edit( array( 'post_id' => 8 ) ) );
	}

	public function test_a_site_that_narrows_the_capability_narrows_the_abilities_too(): void {
		Functions\when( 'get_post' )->justReturn( new \WP_Post( array( 'ID' => 7, 'post_type' => 'post' ) ) );
		Filters\expectApplied( 'axle_block_restore_capability' )->andReturn( 'manage_options' );
		$this->user_can( array( 'edit_posts', 'edit_post' ) );

		$this->assertFalse( ( new Abilities() )->can_edit( array( 'post_id' => 7 ) ) );
	}

	public function test_a_post_type_without_the_plugin_is_refused(): void {
		Functions\when( 'get_post' )->justReturn( new \WP_Post( array( 'ID' => 7, 'post_type' => 'revision' ) ) );
		$this->user_can( array( 'edit_posts', 'edit_post' ) );

		$this->assertFalse( ( new Abilities() )->can_edit( array( 'post_id' => 7 ) ) );
	}

	public function test_a_missing_post_is_refused(): void {
		Functions\when( 'get_post' )->justReturn( null );
		$this->user_can( array( 'edit_posts', 'edit_post' ) );

		$this->assertFalse( ( new Abilities() )->can_edit( array( 'post_id' => 7 ) ) );
	}

	public function test_block_history_reads_the_revisions_of_that_post_only(): void {
		$paragraph = static function ( string $text ): string {
			return '<!-- wp:paragraph --><p>' . $text . '</p><!-- /wp:paragraph -->';
		};
		$parsed    = static function ( string $content ): array {
			$text = trim( strip_tags( $content ) );
			return array(
				array(
					'blockName'    => 'core/paragraph',
					'attrs'        => array(),
					'innerBlocks'  => array(),
					'innerHTML'    => '<p>' . $text . '</p>',
					'innerContent' => array( '<p>' . $text . '</p>' ),
				),
			);
		};
		Functions\when( 'get_post' )->justReturn( new \WP_Post( array( 'ID' => 7, 'post_content' => $paragraph( 'Now is the plan' ) ) ) );
		Functions\when( 'parse_blocks' )->alias( $parsed );
		Functions\when( 'serialize_block' )->alias(
			static function ( $block ) {
				return serialize( $block );
			}
		);
		Functions\when( 'wp_json_encode' )->alias(
			static function ( $value ) {
				return serialize( $value );
			}
		);
		Functions\when( 'wp_strip_all_tags' )->alias(
			static function ( $text ) {
				return trim( strip_tags( (string) $text ) );
			}
		);
		Functions\expect( 'wp_get_post_revisions' )->once()->with(
			7,
			array(
				'posts_per_page' => 100,
				'orderby'        => 'date ID',
				'order'          => 'DESC',
			)
		)->andReturn(
			array(
				new \WP_Post( array( 'ID' => 70, 'post_parent' => 7, 'post_author' => 2, 'post_date_gmt' => '2026-11-01 10:00:00', 'post_content' => $paragraph( 'Before is the plan' ) ) ),
			)
		);
		Functions\when( 'get_userdata' )->justReturn( (object) array( 'display_name' => 'Ana' ) );
		Functions\when( 'wp_is_post_autosave' )->justReturn( false );
		Actions\expectDone( 'axle_block_restore_history_read' )->once();

		$result = ( new Abilities() )->block_history(
			array(
				'post_id' => 7,
				'path'    => array( 0 ),
			)
		);

		$this->assertSame( 1, $result['revisions_checked'] );
		$this->assertSame( array( 'edited', 'first' ), array_column( $result['entries'], 'type' ) );
		$this->assertSame( 'Ana', $result['entries'][1]['author'] );
		$this->assertSame( 70, $result['entries'][1]['revision_id'] );
	}

	public function test_block_history_says_when_there_is_no_block_at_the_path(): void {
		Functions\when( 'get_post' )->justReturn( new \WP_Post( array( 'ID' => 7, 'post_content' => '' ) ) );
		Functions\when( 'parse_blocks' )->justReturn( array() );
		Functions\when( 'wp_get_post_revisions' )->justReturn( array() );

		$result = ( new Abilities() )->block_history(
			array(
				'post_id' => 7,
				'path'    => array( 4 ),
			)
		);

		$this->assertInstanceOf( \WP_Error::class, $result );
	}
}
