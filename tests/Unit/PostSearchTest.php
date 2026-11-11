<?php
/**
 * Tests for the search of posts to copy blocks from.
 *
 * @package AryanX\Axle\BlockRestore
 */

namespace AryanX\Axle\BlockRestore\Tests\Unit;

use AryanX\Axle\BlockRestore\Rest\PostSearch;
use Brain\Monkey\Filters;
use Brain\Monkey\Functions;

final class PostSearchTest extends TestCase {

	/**
	 * Post types, the capabilities the current user has, and the posts they can edit.
	 *
	 * @param string[] $caps     Capabilities of the user.
	 * @param int[]    $editable Posts the user may edit.
	 */
	private function site( array $caps, array $editable ): void {
		$types = array( 'post', 'page', 'wp_template' );
		Functions\when( 'get_post_types' )->justReturn( array( 'post' => 'post', 'page' => 'page' ) );
		Functions\when( 'post_type_exists' )->alias(
			static function ( $type ) use ( $types ) {
				return in_array( $type, $types, true );
			}
		);
		Functions\when( 'post_type_supports' )->justReturn( true );
		Functions\when( 'get_post_type_object' )->alias(
			static function ( $type ) {
				$edit = 'page' === $type ? 'edit_pages' : 'edit_posts';

				return (object) array(
					'cap'            => (object) array( 'edit_posts' => $edit ),
					'show_in_rest'   => true,
					'rest_base'      => 'page' === $type ? 'pages' : 'posts',
					'rest_namespace' => 'wp/v2',
					'labels'         => (object) array( 'singular_name' => ucfirst( $type ) ),
				);
			}
		);
		Functions\when( 'current_user_can' )->alias(
			static function ( $cap, $post_id = null ) use ( $caps, $editable ) {
				return 'edit_post' === $cap ? in_array( $post_id, $editable, true ) : in_array( $cap, $caps, true );
			}
		);
		Functions\when( 'get_post_type' )->alias(
			static function ( $id ) {
				return $id >= 20 ? 'page' : 'post';
			}
		);
		Functions\when( 'get_the_title' )->alias(
			static function ( $id ) {
				return 'Title &amp; ' . $id;
			}
		);
		Functions\when( 'wp_strip_all_tags' )->alias( 'strip_tags' );
		Functions\when( 'get_post_status' )->justReturn( 'draft' );
		Functions\when( 'get_post_modified_time' )->justReturn( '2026-11-12T10:00:00+00:00' );
	}

	public function test_post_types_are_the_ones_the_user_can_edit(): void {
		$this->site( array( 'edit_posts' ), array() );

		$this->assertSame( array( 'post' ), PostSearch::source_post_types() );

		$this->site( array( 'edit_posts', 'edit_pages' ), array() );

		$this->assertSame( array( 'post', 'page' ), PostSearch::source_post_types() );
	}

	public function test_the_filter_limits_post_types_and_cannot_add_ones_the_user_may_not_edit(): void {
		$this->site( array( 'edit_posts' ), array() );
		Filters\expectApplied( 'axle_block_restore_copy_post_types' )->andReturn( array( 'page', 'post', 'wp_template' ) );

		$this->assertSame( array( 'post' ), PostSearch::source_post_types() );
	}

	public function test_an_empty_filter_result_turns_the_search_off_with_a_403(): void {
		$this->site( array( 'edit_posts' ), array() );
		Filters\expectApplied( 'axle_block_restore_copy_post_types' )->andReturn( array() );

		$result = ( new PostSearch() )->can_search();

		$this->assertInstanceOf( \WP_Error::class, $result );
		$this->assertSame( array( 'status' => 403 ), $result->get_error_data() );
	}

	public function test_a_user_with_a_post_type_to_copy_from_may_search(): void {
		$this->site( array( 'edit_posts' ), array() );

		$this->assertTrue( ( new PostSearch() )->can_search() );
	}

	public function test_only_posts_the_user_can_edit_come_back_and_only_with_titles_and_dates(): void {
		$this->site( array( 'edit_posts' ), array( 3, 5 ) );
		\WP_Query::$queue = array( array( 'posts' => array( 3, 4, 5, 6 ) ) );

		$items = ( new PostSearch() )->search( new \WP_REST_Request( array( 'search' => 'title' ) ) );

		$this->assertSame( array( 3, 5 ), array_column( $items, 'id' ) );
		$this->assertSame( 'Title & 3', $items[0]['title'] );
		$this->assertSame( array( 'id', 'title', 'type', 'type_label', 'status', 'modified', 'rest_base', 'rest_namespace' ), array_keys( $items[0] ) );
		$this->assertSame( 'relevance', \WP_Query::$made[0]['orderby'] );
		$this->assertSame( array( 'post' ), \WP_Query::$made[0]['post_type'] );
	}

	public function test_a_post_type_outside_the_allowed_list_is_ignored_and_the_current_post_is_excluded(): void {
		$this->site( array( 'edit_posts' ), array( 3 ) );
		\WP_Query::$queue = array( array( 'posts' => array( 3, 9 ) ) );

		$items = ( new PostSearch() )->search( new \WP_REST_Request( array( 'post_type' => 'page', 'exclude_id' => 9 ) ) );

		$this->assertSame( array( 'post' ), \WP_Query::$made[0]['post_type'] );
		$this->assertSame( 'modified', \WP_Query::$made[0]['orderby'] );
		$this->assertSame( array( 3 ), array_column( $items, 'id' ) );
	}

	public function test_it_keeps_looking_when_a_full_batch_has_too_few_editable_posts(): void {
		$this->site( array( 'edit_posts' ), array( 1, 2 ) );
		$first            = range( 100, 149 );
		\WP_Query::$queue = array( array( 'posts' => $first ), array( 'posts' => array( 1, 2 ) ) );

		$items = ( new PostSearch() )->search( new \WP_REST_Request( array( 'per_page' => 2 ) ) );

		$this->assertSame( array( 1, 2 ), array_column( $items, 'id' ) );
		$this->assertCount( 2, \WP_Query::$made );
		$this->assertSame( 2, \WP_Query::$made[1]['paged'] );
	}

	public function test_the_result_count_is_limited_by_the_request_and_the_filter(): void {
		$this->site( array( 'edit_posts' ), array( 1, 2, 3, 4 ) );
		\WP_Query::$queue = array( array( 'posts' => array( 1, 2, 3, 4 ) ) );

		$this->assertCount( 3, ( new PostSearch() )->search( new \WP_REST_Request( array( 'per_page' => 3 ) ) ) );

		\WP_Query::$queue = array( array( 'posts' => array( 1, 2, 3, 4 ) ) );
		Filters\expectApplied( 'axle_block_restore_copy_max_results' )->andReturn( 1 );

		$this->assertCount( 1, ( new PostSearch() )->search( new \WP_REST_Request( array( 'per_page' => 3 ) ) ) );
	}

	public function test_it_registers_a_read_only_route(): void {
		Functions\expect( 'register_rest_route' )->once()->with(
			'axle-block-restore/v1',
			'/posts',
			\Mockery::on(
				static function ( $args ) {
					return 'GET' === $args['methods'] && is_callable( $args['permission_callback'] ) && is_callable( $args['callback'] );
				}
			)
		);

		( new PostSearch() )->register_route();
	}
}
