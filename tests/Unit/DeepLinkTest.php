<?php
/**
 * Tests for the history link.
 *
 * @package AryanX\Axle\BlockRestore
 */

namespace AryanX\Axle\BlockRestore\Tests\Unit;

use AryanX\Axle\BlockRestore\DeepLink;
use Brain\Monkey\Functions;

final class DeepLinkTest extends TestCase {

	protected function setUp(): void {
		parent::setUp();
		Functions\when( 'admin_url' )->alias(
			static function ( $path ) {
				return 'https://example.test/wp-admin/' . $path;
			}
		);
		Functions\when( 'add_query_arg' )->alias(
			static function ( $args, $url ) {
				return $url . '?' . http_build_query( $args );
			}
		);
	}

	public function test_revision_is_renamed_so_core_does_not_open_its_own_revisions_view(): void {
		$url = DeepLink::redirect_url(
			array(
				'post'               => '12',
				'action'             => 'edit',
				'axle-block-restore' => 'history',
				'revision'           => '345',
				'path'               => '2',
			)
		);

		$this->assertSame( 'https://example.test/wp-admin/post.php?post=12&action=edit&axle-block-restore=history&path=2&axle-revision=345', $url );
	}

	public function test_a_bad_revision_is_dropped_and_the_link_still_works(): void {
		$url = DeepLink::redirect_url( array( 'post' => '12', 'axle-block-restore' => 'history', 'revision' => '12abc' ) );

		$this->assertSame( 'https://example.test/wp-admin/post.php?post=12&axle-block-restore=history', $url );
	}

	public function test_other_addresses_are_left_alone(): void {
		$this->assertNull( DeepLink::redirect_url( array( 'post' => '12', 'action' => 'edit', 'revision' => '345' ) ) );
		$this->assertNull( DeepLink::redirect_url( array( 'axle-block-restore' => 'history', 'axle-revision' => '345' ) ) );
		$this->assertNull( DeepLink::redirect_url( array( 'axle-block-restore' => 'history', 'path' => '2' ) ) );
	}
}
