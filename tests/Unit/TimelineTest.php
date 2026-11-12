<?php
/**
 * Tests for the history of one block.
 *
 * @package AryanX\Axle\BlockRestore
 */

namespace AryanX\Axle\BlockRestore\Tests\Unit;

use AryanX\Axle\BlockRestore\Timeline;
use Brain\Monkey\Functions;

final class TimelineTest extends TestCase {

	private const OLD = 'Our basic plan costs ten dollars a month and includes every feature.';
	private const MID = 'Our basic plan costs twelve dollars a month and includes every feature.';
	private const NOW = 'Our basic plan costs fifteen dollars a month and includes every feature.';

	protected function setUp(): void {
		parent::setUp();
		// Equal blocks give equal strings, which is all the timeline relies on.
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
				return trim( preg_replace( '/<[^>]*>/', '', (string) $text ) );
			}
		);
	}

	/**
	 * A parsed paragraph.
	 *
	 * @param string $text  Text.
	 * @param array  $attrs Attributes.
	 * @return array
	 */
	private function para( string $text, array $attrs = array() ): array {
		return array(
			'blockName'    => 'core/paragraph',
			'attrs'        => $attrs,
			'innerBlocks'  => array(),
			'innerHTML'    => '<p>' . $text . '</p>',
			'innerContent' => array( '<p>' . $text . '</p>' ),
		);
	}

	/**
	 * A parsed group around blocks.
	 *
	 * @param array[] $inner Blocks inside.
	 * @return array
	 */
	private function group( array $inner ): array {
		return array(
			'blockName'    => 'core/group',
			'attrs'        => array(),
			'innerBlocks'  => $inner,
			'innerHTML'    => '<div></div>',
			'innerContent' => array( '<div>', null, '</div>' ),
		);
	}

	/**
	 * The blank line parse_blocks() leaves between blocks.
	 *
	 * @return array
	 */
	private function gap(): array {
		return array(
			'blockName'    => null,
			'attrs'        => array(),
			'innerBlocks'  => array(),
			'innerHTML'    => "\n\n",
			'innerContent' => array( "\n\n" ),
		);
	}

	/**
	 * A revision.
	 *
	 * @param int     $id     ID.
	 * @param array[] $blocks Blocks.
	 * @param string  $author Author.
	 * @return array
	 */
	private function revision( int $id, array $blocks, string $author = 'Sam' ): array {
		return array(
			'id'       => $id,
			'date'     => '2026-11-0' . ( $id % 9 ) . 'T10:00:00+00:00',
			'author'   => $author,
			'autosave' => false,
			'blocks'   => $blocks,
		);
	}

	/**
	 * Types of the entries.
	 *
	 * @param array|null $history Result of build().
	 * @return string[]
	 */
	private function types( ?array $history ): array {
		return array_column( (array) $history['entries'], 'type' );
	}

	public function test_each_version_is_an_entry_newest_first_with_who_and_when(): void {
		$history = Timeline::build(
			array( $this->para( self::NOW ) ),
			array( 0 ),
			array(
				$this->revision( 30, array( $this->para( self::NOW ) ), 'Ana' ),
				$this->revision( 20, array( $this->para( self::MID ) ), 'Ben' ),
				$this->revision( 10, array( $this->para( self::OLD ) ), 'Cy' ),
			)
		);

		$this->assertSame( array( 'edited', 'edited', 'first' ), $this->types( $history ) );
		$this->assertSame( array( 30, 20, 10 ), array_column( $history['entries'], 'revision_id' ) );
		$this->assertSame( array( 'Ana', 'Ben', 'Cy' ), array_column( $history['entries'], 'author' ) );
		$this->assertSame( self::MID, $history['entries'][0]['previous_text'] );
		$this->assertTrue( $history['entries'][0]['text_changed'] );
		$this->assertSame( 3, $history['revisions_checked'] );
	}

	public function test_blank_lines_between_blocks_do_not_count_in_paths(): void {
		$current = array( $this->para( 'Intro to the page, nothing else.' ), $this->gap(), $this->para( self::NOW ) );
		$history = Timeline::build( $current, array( 1 ), array( $this->revision( 1, array( $this->para( 'Intro to the page, nothing else.' ), $this->gap(), $this->para( self::OLD ) ) ) ) );

		$this->assertSame( array( 'edited', 'first' ), $this->types( $history ) );
		$this->assertSame( array( 1 ), $history['entries'][1]['path'] );
	}

	public function test_saves_that_did_not_change_the_block_are_counted(): void {
		$history = Timeline::build(
			array( $this->para( self::NOW ) ),
			array( 0 ),
			array(
				$this->revision( 3, array( $this->para( self::NOW ) ) ),
				$this->revision( 2, array( $this->para( self::NOW ) ) ),
				$this->revision( 1, array( $this->para( self::OLD ) ) ),
			)
		);

		$this->assertSame( array( 'edited', 'first' ), $this->types( $history ) );
		$this->assertSame( 2, $history['entries'][0]['saves'] );
		$this->assertSame( 2, $history['entries'][0]['revision_id'] );
	}

	public function test_a_block_that_only_moved_has_no_entry_for_the_move(): void {
		$other   = 'A closing line nobody has touched.';
		$history = Timeline::build(
			array( $this->para( self::NOW ), $this->para( $other ) ),
			array( 0 ),
			array(
				$this->revision( 2, array( $this->para( $other ), $this->para( self::NOW ) ) ),
				$this->revision( 1, array( $this->para( $other ), $this->para( self::OLD ) ) ),
			)
		);

		$this->assertSame( array( 'edited', 'first' ), $this->types( $history ) );
		$this->assertSame( 2, $history['entries'][0]['revision_id'] );
		$this->assertSame( array( 1 ), $history['entries'][0]['path'] );
	}

	public function test_a_block_wrapped_in_a_group_keeps_its_history_from_before_the_wrap(): void {
		$history = Timeline::build(
			array( $this->group( array( $this->para( self::NOW ) ) ) ),
			array( 0, 0 ),
			array(
				$this->revision( 3, array( $this->group( array( $this->para( self::NOW ) ) ) ) ),
				$this->revision( 2, array( $this->para( self::NOW ) ) ),
				$this->revision( 1, array( $this->para( self::OLD ) ) ),
			)
		);

		$this->assertSame( array( 'edited', 'first' ), $this->types( $history ) );
		$this->assertSame( 2, $history['entries'][0]['revision_id'] );
	}

	public function test_a_block_that_was_removed_and_added_back_shows_both(): void {
		$heading = array(
			'blockName'    => 'core/heading',
			'attrs'        => array(),
			'innerBlocks'  => array(),
			'innerHTML'    => '<h2>A heading only</h2>',
			'innerContent' => array( '<h2>A heading only</h2>' ),
		);
		$history = Timeline::build(
			array( $this->para( self::NOW ) ),
			array( 0 ),
			array(
				$this->revision( 3, array( $this->para( self::NOW ) ) ),
				$this->revision( 2, array( $heading ) ),
				$this->revision( 1, array( $this->para( self::OLD ) ) ),
			)
		);

		$this->assertSame( array( 'readded', 'removed', 'first' ), $this->types( $history ) );
		$this->assertSame( 2, $history['entries'][1]['revision_id'] );
		$this->assertSame( self::OLD, $history['entries'][0]['previous_text'] );
	}

	public function test_unsaved_changes_come_first_as_the_current_version(): void {
		$history = Timeline::build( array( $this->para( self::NOW ) ), array( 0 ), array( $this->revision( 1, array( $this->para( self::OLD ) ) ) ) );

		$this->assertSame( array( 'edited', 'first' ), $this->types( $history ) );
		$this->assertTrue( $history['entries'][0]['current'] );
		$this->assertSame( 0, $history['entries'][0]['revision_id'] );
		$this->assertFalse( $history['entries'][1]['current'] );
	}

	public function test_settings_changes_are_named_and_copies_are_told_apart(): void {
		$history = Timeline::build(
			array( $this->para( self::NOW, array( 'align' => 'center' ) ) ),
			array( 0 ),
			array( $this->revision( 1, array( $this->para( self::NOW, array( 'align' => 'left' ) ) ) ) )
		);
		$this->assertSame( array( 'align' ), $history['entries'][0]['attributes_changed'] );
		$this->assertFalse( $history['entries'][0]['text_changed'] );

		$line    = 'Call us today for a free quote.';
		$edited  = 'Call us today for your free quote.';
		$current = array( $this->para( $line ), $this->para( $line ) );
		$history = Timeline::build(
			$current,
			array( 1 ),
			array(
				$this->revision( 2, array( $this->para( $line ), $this->para( $edited ) ) ),
				$this->revision( 1, array( $this->para( $line ) ) ),
			)
		);
		// Edited in save 2, put back to the line in the editor: not mistaken for the untouched copy at path 0.
		$this->assertSame( array( 'edited', 'edited', 'first' ), $this->types( $history ) );
		$this->assertTrue( $history['entries'][0]['current'] );
	}

	public function test_the_thresholds_can_be_changed(): void {
		$target = array( $this->para( 'one two three', array() ), $this->para( 'filler' ), $this->para( 'filler two' ), $this->para( 'filler three' ), $this->para( 'filler four' ), $this->para( 'one two three four five six' ) );
		$old    = array( $this->revision( 1, array( $this->para( 'one two three nine ten eleven' ) ) ) );

		$this->assertSame( array( 'added' ), $this->types( Timeline::build( $target, array( 5 ), $old ) ) );
		$this->assertSame( array( 'edited', 'first' ), $this->types( Timeline::build( $target, array( 5 ), $old, array( 'similarity' => 0.2 ) ) ) );
	}

	public function test_a_path_with_no_block_gives_null(): void {
		$this->assertNull( Timeline::build( array( $this->para( 'x' ) ), array( 3 ), array() ) );
	}
}
