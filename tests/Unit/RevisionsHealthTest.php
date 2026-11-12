<?php
/**
 * Tests for the Site Health test about revisions.
 *
 * @package AryanX\Axle\BlockRestore
 */

namespace AryanX\Axle\BlockRestore\Tests\Unit;

use AryanX\Axle\BlockRestore\Health\Revisions;
use Brain\Monkey\Functions;

final class RevisionsHealthTest extends TestCase {

	protected function setUp(): void {
		parent::setUp();
		Functions\when( 'get_post_types' )->justReturn(
			array(
				'post' => 'post',
				'page' => 'page',
			)
		);
		Functions\when( 'post_type_exists' )->justReturn( true );
		Functions\when( 'post_type_supports' )->justReturn( true );
	}

	public function test_good_when_every_post_type_keeps_revisions(): void {
		Functions\when( 'wp_revisions_to_keep' )->justReturn( -1 );

		$result = ( new Revisions() )->test();

		$this->assertSame( 'good', $result['status'] );
		$this->assertSame( Revisions::TEST, $result['test'] );
	}

	public function test_recommended_and_names_the_post_types_that_keep_none(): void {
		Functions\when( 'wp_revisions_to_keep' )->alias(
			static function ( $post ) {
				return 'page' === $post->post_type ? 0 : 10;
			}
		);

		$result = ( new Revisions() )->test();

		$this->assertSame( 'recommended', $result['status'] );
		$this->assertStringContainsString( 'page', $result['description'] );
		$this->assertStringNotContainsString( 'post,', $result['description'] );
	}

	public function test_adds_one_direct_test(): void {
		$tests = ( new Revisions() )->add_test( array() );

		$this->assertArrayHasKey( Revisions::TEST, $tests['direct'] );
	}
}
