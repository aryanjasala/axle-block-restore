<?php
/**
 * Tests for who may see other people's autosaves.
 *
 * @package AryanX\Axle\BlockRestore
 */

namespace AryanX\Axle\BlockRestore\Tests\Unit;

use AryanX\Axle\BlockRestore\Abilities;
use AryanX\Axle\BlockRestore\Autosaves;
use AryanX\Axle\BlockRestore\Plugin;
use Brain\Monkey\Actions;
use Brain\Monkey\Filters;
use Brain\Monkey\Functions;

final class AutosavesTest extends TestCase {

	protected function setUp(): void {
		parent::setUp();
		Functions\when( 'get_post_types' )->justReturn( array( 'post' => 'post' ) );
		Functions\when( 'post_type_exists' )->justReturn( true );
		Functions\when( 'post_type_supports' )->justReturn( true );
		Functions\when( 'get_current_user_id' )->justReturn( 5 );
		Functions\when( 'get_post_type_object' )->justReturn(
			(object) array(
				'show_in_rest' => true,
				'cap'          => (object) array(
					'edit_posts'        => 'edit_posts',
					'edit_others_posts' => 'edit_others_posts',
				),
			)
		);
		Functions\when( 'get_post' )->justReturn( new \WP_Post( array( 'ID' => 7, 'post_type' => 'post' ) ) );
	}

	/**
	 * Lets the current user have only some capabilities. `edit_post` is checked for post 7.
	 *
	 * @param string[] $caps Capabilities.
	 */
	private function user_can( array $caps ): void {
		Functions\when( 'current_user_can' )->alias(
			static function ( $cap, $id = 0 ) use ( $caps ) {
				return in_array( $cap, $caps, true ) && ( 'edit_post' !== $cap || 7 === $id );
			}
		);
	}

	private function autosave( int $author = 9 ): \WP_Post {
		return new \WP_Post(
			array(
				'ID'            => 70,
				'post_type'     => 'revision',
				'post_parent'   => 7,
				'post_author'   => $author,
				'post_date_gmt' => '2026-11-20 09:00:00',
				'post_content'  => '<!-- wp:paragraph --><p>Maria unsaved</p><!-- /wp:paragraph -->',
			)
		);
	}

	public function test_an_editor_may_see_other_peoples_autosaves(): void {
		$this->user_can( array( 'edit_posts', 'edit_post', 'edit_others_posts' ) );

		$this->assertTrue( Autosaves::can_see_for_post( 7 ) );
	}

	public function test_a_person_without_edit_others_posts_may_not(): void {
		$this->user_can( array( 'edit_posts', 'edit_post' ) );

		$this->assertFalse( Autosaves::can_see_for_post( 7 ) );
	}

	public function test_edit_others_posts_alone_is_not_enough_without_edit_post_for_that_post(): void {
		$this->user_can( array( 'edit_posts', 'edit_others_posts' ) );

		$this->assertFalse( Autosaves::can_see_for_post( 7 ) );
	}

	public function test_a_site_can_change_the_capability(): void {
		Filters\expectApplied( 'axle_block_restore_autosaves_capability' )->andReturn( 'manage_options' );
		$this->user_can( array( 'edit_posts', 'edit_post', 'edit_others_posts' ) );

		$this->assertFalse( Autosaves::can_see_for_post( 7 ) );
	}

	public function test_a_persons_own_autosave_is_never_hidden_but_somebody_elses_follows_the_gate(): void {
		Functions\when( 'wp_is_post_autosave' )->justReturn( 7 );
		$this->user_can( array( 'edit_posts', 'edit_post' ) );

		$this->assertTrue( Autosaves::can_see( $this->autosave( 5 ) ) );
		$this->assertFalse( Autosaves::can_see( $this->autosave( 9 ) ) );
	}

	public function test_a_saved_revision_is_not_an_autosave(): void {
		Functions\when( 'wp_is_post_autosave' )->justReturn( false );
		$this->user_can( array( 'edit_posts', 'edit_post' ) );

		$this->assertTrue( Autosaves::can_see( $this->autosave( 9 ) ) );
	}

	public function test_the_list_is_empty_for_somebody_who_may_not_see_it(): void {
		$this->user_can( array( 'edit_posts', 'edit_post' ) );
		Functions\expect( 'wp_get_post_revisions' )->never();

		$this->assertSame( array(), Autosaves::for_post( 7 ) );
	}

	public function test_the_list_holds_only_other_peoples_autosaves_and_says_it_was_listed(): void {
		$this->user_can( array( 'edit_posts', 'edit_post', 'edit_others_posts' ) );
		Functions\when( 'wp_is_post_autosave' )->justReturn( 7 );
		Functions\when( 'get_userdata' )->justReturn( (object) array( 'display_name' => 'Maria' ) );
		Functions\when( 'wp_get_post_revisions' )->justReturn( array( $this->autosave( 5 ), $this->autosave( 9 ) ) );
		Actions\expectDone( 'axle_block_restore_autosaves_listed' )->once();

		$items = Autosaves::for_post( 7 );

		$this->assertCount( 1, $items );
		$this->assertSame( 'Maria', $items[0]['author'] );
		$this->assertSame( 9, $items[0]['author_id'] );
	}

	public function test_the_ability_to_restore_refuses_an_autosave_the_person_may_not_see(): void {
		Functions\when( 'wp_get_post_revision' )->justReturn( $this->autosave( 9 ) );
		Functions\when( 'wp_is_post_autosave' )->justReturn( 7 );
		$this->user_can( array( 'edit_posts', 'edit_post' ) );

		$result = ( new Abilities() )->restore_block(
			array(
				'post_id'     => 7,
				'revision_id' => 70,
				'path'        => array( 0 ),
			)
		);

		$this->assertInstanceOf( \WP_Error::class, $result );
		$this->assertSame( 'axle_block_restore_revision', $result->get_error_code() );
	}

	public function test_the_autosave_ability_needs_the_capability(): void {
		$this->user_can( array( 'edit_posts', 'edit_post' ) );
		$this->assertFalse( ( new Abilities() )->can_see_autosaves( array( 'post_id' => 7 ) ) );

		$this->user_can( array( 'edit_posts', 'edit_post', 'edit_others_posts' ) );
		$this->assertTrue( ( new Abilities() )->can_see_autosaves( array( 'post_id' => 7 ) ) );
	}

	public function test_taking_a_site_editor_type_out_of_its_filter_takes_it_out_of_the_abilities_too(): void {
		Functions\when( 'get_post_types' )->justReturn( array( 'post' => 'post', 'wp_block' => 'wp_block' ) );
		Filters\expectApplied( 'axle_block_restore_site_editor_post_types' )->andReturn( array( 'wp_template' ) );

		$this->assertTrue( Plugin::is_enabled( 'post' ) );
		$this->assertFalse( Plugin::is_enabled( 'wp_block' ) );
	}

	public function test_a_site_editor_type_stays_in_while_its_filter_keeps_it(): void {
		Functions\when( 'get_post_types' )->justReturn( array( 'wp_block' => 'wp_block' ) );

		$this->assertTrue( Plugin::is_enabled( 'wp_block' ) );
	}
}
