<?php
/**
 * Tests for which post types get the editor tools, and the revision REST fields.
 *
 * @package AryanX\Axle\BlockRestore
 */

namespace AryanX\Axle\BlockRestore\Tests\Unit;

use AryanX\Axle\BlockRestore\Plugin;
use AryanX\Axle\BlockRestore\Rest\RevisionAuthor;
use AryanX\Axle\BlockRestore\Rest\RevisionContent;
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
		Filters\expectApplied( 'axle_block_restore_post_types' )->andReturn( array( 'post', 'attachment', 'product' ) );

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

	/**
	 * The Site Editor post types, with a capability type and revision support each.
	 */
	private function site_editor_types_exist(): void {
		$this->post_types_exist();
		$types = array(
			'wp_template'      => array( 'revisions' => true, 'rest' => true, 'cap' => 'edit_theme_options' ),
			'wp_template_part' => array( 'revisions' => true, 'rest' => true, 'cap' => 'edit_theme_options' ),
			'wp_block'         => array( 'revisions' => true, 'rest' => true, 'cap' => 'edit_posts' ),
			'wp_navigation'    => array( 'revisions' => false, 'rest' => true, 'cap' => 'edit_theme_options' ),
		);
		Functions\when( 'get_post_type_object' )->alias(
			static function ( $post_type ) use ( $types ) {
				if ( ! isset( $types[ $post_type ] ) ) {
					return null;
				}
				return (object) array(
					'show_in_rest' => $types[ $post_type ]['rest'],
					'cap'          => (object) array( 'edit_posts' => $types[ $post_type ]['cap'] ),
				);
			}
		);
		Functions\when( 'post_type_supports' )->alias(
			static function ( $post_type, $feature ) use ( $types ) {
				if ( isset( $types[ $post_type ] ) ) {
					return 'revisions' === $feature && $types[ $post_type ]['revisions'];
				}
				return in_array( $feature, array( 'editor', 'revisions' ), true ) && in_array( $post_type, array( 'post', 'page' ), true );
			}
		);
	}

	public function test_site_editor_post_types_are_templates_parts_and_patterns(): void {
		$this->site_editor_types_exist();

		$this->assertSame( array( 'wp_template', 'wp_template_part', 'wp_block' ), Plugin::site_editor_post_types() );
	}

	public function test_the_site_editor_filter_can_narrow_the_list_and_cannot_add_types_without_revisions(): void {
		$this->site_editor_types_exist();
		Filters\expectApplied( 'axle_block_restore_site_editor_post_types' )->once()->andReturn( array( 'wp_template_part', 'wp_navigation', 'nothing' ) );

		$this->assertSame( array( 'wp_template_part' ), Plugin::site_editor_post_types() );
	}

	public function test_all_post_types_lists_each_type_once(): void {
		$this->site_editor_types_exist();

		$this->assertSame( array( 'post', 'page', 'wp_template', 'wp_template_part', 'wp_block' ), Plugin::all_post_types() );
	}

	public function test_templates_need_edit_theme_options_and_patterns_need_edit_posts(): void {
		$this->site_editor_types_exist();

		$this->assertSame( 'edit_theme_options', Plugin::capability( 'wp_template' ) );
		$this->assertSame( 'edit_theme_options', Plugin::capability( 'wp_template_part' ) );
		$this->assertSame( 'edit_posts', Plugin::capability( 'wp_block' ) );
		$this->assertSame( 'edit_posts', Plugin::capability( 'unknown' ) );
	}

	public function test_the_capability_filter_changes_it_and_an_empty_value_falls_back(): void {
		$this->site_editor_types_exist();
		Filters\expectApplied( 'axle_block_restore_capability' )->with( 'edit_theme_options', 'wp_template' )->once()->andReturn( 'manage_options' );
		$this->assertSame( 'manage_options', Plugin::capability( 'wp_template' ) );

		Filters\expectApplied( 'axle_block_restore_capability' )->with( 'edit_posts', 'wp_block' )->once()->andReturn( '' );
		$this->assertSame( 'edit_posts', Plugin::capability( 'wp_block' ) );
	}

	public function test_a_user_only_gets_the_post_types_their_capability_allows(): void {
		$this->site_editor_types_exist();
		Functions\when( 'current_user_can' )->alias(
			static function ( $capability ) {
				return 'edit_posts' === $capability;
			}
		);

		$this->assertSame( array( 'post', 'page', 'wp_block' ), Plugin::editable_post_types() );
	}

	public function test_revision_authors_are_registered_for_every_type_and_for_templates_as_templates(): void {
		$this->site_editor_types_exist();
		$registered = array();
		Functions\when( 'register_rest_field' )->alias(
			static function ( $object_type, $field ) use ( &$registered ) {
				$registered[] = $object_type . ':' . $field;
			}
		);

		( new RevisionAuthor() )->register_field();

		$this->assertContains( 'post-revision:axle_block_restore_author', $registered );
		$this->assertContains( 'wp_block-revision:axle_block_restore_author', $registered );
		$this->assertContains( 'wp_template-revision:axle_block_restore_author', $registered );
		// Template revisions are prepared by the templates controller, so their object type is the template's.
		$this->assertContains( 'wp_template:axle_block_restore_author', $registered );
		$this->assertContains( 'wp_template_part:axle_block_restore_author', $registered );
		$this->assertNotContains( 'wp_block:axle_block_restore_author', $registered );
	}

	public function test_a_template_revision_author_comes_from_its_author_field(): void {
		Functions\when( 'get_userdata' )->alias(
			static function ( $user_id ) {
				return 3 === $user_id ? (object) array( 'display_name' => 'Aryan' ) : false;
			}
		);

		$this->assertSame( 'Aryan', ( new RevisionAuthor() )->author_name( array( 'id' => 'theme//header', 'wp_id' => 41, 'author' => '3' ) ) );
	}
}
