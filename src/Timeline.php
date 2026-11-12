<?php
/**
 * The history of one block: every version it had in the revisions of a post.
 *
 * This is the PHP counterpart of the timeline in assets/js/matching.js, so an
 * agent gets the same answer the editor shows. Blocks have no stable IDs between
 * saves, so the block is followed from the newest revision to the oldest: in
 * each one, the counterpart is the identical block of the same type, else the
 * most alike block of that type.
 *
 * @package AryanX\Axle\BlockRestore
 */

namespace AryanX\Axle\BlockRestore;

defined( 'ABSPATH' ) || exit;

/**
 * Builds a block's timeline from parsed blocks. No database access.
 */
final class Timeline {

	/**
	 * Share of words two versions must have in common to count as one block.
	 */
	public const SIMILARITY = 0.5;

	/**
	 * The same share when the block is the same type and sits at the same place.
	 */
	public const POSITION_SIMILARITY = 0.2;

	/**
	 * Longest text one entry carries.
	 */
	private const TEXT_LIMIT = 500;

	/**
	 * Builds the history of the block at a path in the current content.
	 *
	 * @param array[] $current  Parsed blocks of the post now.
	 * @param int[]   $path     Position of the block, one number per level, counting real blocks only.
	 * @param array[] $revisions Newest first. Each: id (int), date (string), author (string), autosave (bool), blocks (parsed blocks).
	 * @param array   $settings Optional `similarity` and `position_similarity`, each from 0 to 1.
	 * @return array|null The block name, the number of revisions looked through and the entries (newest first), or null when there is no block at the path.
	 */
	public static function build( array $current, array $path, array $revisions, array $settings = array() ): ?array {
		$all    = self::items( $current );
		$target = null;
		foreach ( $all as $item ) {
			if ( array_values( array_map( 'intval', $path ) ) === $item['path'] ) {
				$target = $item;
				break;
			}
		}
		if ( null === $target ) {
			return null;
		}

		$settings = array(
			'similarity'          => self::clamp( $settings['similarity'] ?? null, self::SIMILARITY ),
			'position_similarity' => self::clamp( $settings['position_similarity'] ?? null, self::POSITION_SIMILARITY ),
		);

		$tracked = $target;
		$newer   = $all;
		$steps   = array();
		foreach ( $revisions as $revision ) {
			$items = self::items( (array) $revision['blocks'] );
			$match = self::counterpart( $items, $tracked, $settings, $newer );
			if ( null !== $match ) {
				$tracked = $match;
			}
			$newer   = $items;
			$steps[] = array(
				'revision' => $revision,
				'match'    => $match,
			);
		}

		return array(
			'name'              => $target['name'],
			'revisions_checked' => count( $revisions ),
			'entries'           => self::entries( $target, $steps ),
		);
	}

	/**
	 * Every block in a tree, parents before children.
	 *
	 * @param array[] $blocks Parsed blocks.
	 * @param int[]   $prefix Path of the parent.
	 * @return array[] Each: name, path, text, print, block.
	 */
	public static function items( array $blocks, array $prefix = array() ): array {
		$items    = array();
		$position = 0;
		foreach ( $blocks as $block ) {
			if ( null === $block['blockName'] && '' === trim( (string) $block['innerHTML'] ) ) {
				continue;
			}
			$path    = array_merge( $prefix, array( $position ) );
			$items[] = array(
				'name'  => null === $block['blockName'] ? 'core/freeform' : (string) $block['blockName'],
				'path'  => $path,
				'text'  => self::text( $block ),
				'print' => serialize_block( $block ),
				'block' => $block,
			);
			$items   = array_merge( $items, self::items( (array) $block['innerBlocks'], $path ) );
			++$position;
		}

		return $items;
	}

	/**
	 * Visible text of a block and everything inside it.
	 *
	 * @param array $block Parsed block.
	 * @return string
	 */
	private static function text( array $block ): string {
		$parts = array( (string) $block['innerHTML'] );
		foreach ( (array) $block['innerBlocks'] as $inner ) {
			$parts[] = self::text( $inner );
		}
		$html = implode( ' ', $parts );
		$html = (string) preg_replace( '/<!--.*?-->/s', ' ', $html );

		return trim( (string) preg_replace( '/\s+/u', ' ', html_entity_decode( wp_strip_all_tags( $html ), ENT_QUOTES, 'UTF-8' ) ) );
	}

	/**
	 * Share of words two texts have in common, from 0 to 1.
	 *
	 * @param string $a First text.
	 * @param string $b Second text.
	 * @return float
	 */
	public static function similarity( string $a, string $b ): float {
		$words_a = array_unique( (array) preg_split( '/\s+/u', mb_strtolower( $a ), -1, PREG_SPLIT_NO_EMPTY ) );
		$words_b = array_unique( (array) preg_split( '/\s+/u', mb_strtolower( $b ), -1, PREG_SPLIT_NO_EMPTY ) );
		if ( ! $words_a && ! $words_b ) {
			return 1.0;
		}
		$shared = count( array_intersect( $words_a, $words_b ) );

		return $shared / ( count( $words_a ) + count( $words_b ) - $shared );
	}

	/**
	 * The block in one revision that is the same block as the tracked one.
	 *
	 * @param array[] $items    Blocks of the revision.
	 * @param array   $tracked  Block to find.
	 * @param array   $settings similarity and position_similarity.
	 * @param array[] $newer    Blocks of the next newer version, to tell copies apart.
	 * @return array|null
	 */
	private static function counterpart( array $items, array $tracked, array $settings, array $newer ): ?array {
		$candidates = array();
		foreach ( $items as $item ) {
			if ( $item['name'] === $tracked['name'] ) {
				$item['same_position'] = $item['path'] === $tracked['path'];
				$candidates[]          = $item;
			}
		}

		$exact = array_values(
			array_filter(
				$candidates,
				static function ( array $item ) use ( $tracked ): bool {
					return $item['print'] === $tracked['print'];
				}
			)
		);
		if ( $exact ) {
			$twins = count(
				array_filter(
					$newer,
					static function ( array $other ) use ( $tracked ): bool {
						return $other['name'] === $tracked['name'] && $other['print'] === $tracked['print'];
					}
				)
			);
			$here  = array_filter(
				$exact,
				static function ( array $item ): bool {
					return $item['same_position'];
				}
			);
			if ( $twins > 1 && ! $here ) {
				foreach ( $candidates as $item ) {
					if ( $item['same_position'] && self::similarity( $item['text'], $tracked['text'] ) >= $settings['similarity'] ) {
						return $item;
					}
				}
			}
			usort(
				$exact,
				static function ( array $a, array $b ) use ( $tracked ): int {
					return self::closeness( $b['path'], $tracked['path'] ) <=> self::closeness( $a['path'], $tracked['path'] );
				}
			);

			return $exact[0];
		}

		$best       = null;
		$best_score = -1.0;
		foreach ( $candidates as $item ) {
			$alike    = self::similarity( $item['text'], $tracked['text'] );
			$accepted = '' === $item['text'] && '' === $tracked['text']
				? $item['same_position']
				: $alike >= $settings['similarity'] || ( $item['same_position'] && $alike >= $settings['position_similarity'] );
			$score    = $alike + ( $item['same_position'] ? 0.3 : 0.0 );
			if ( $accepted && $score > $best_score ) {
				$best       = $item;
				$best_score = $score;
			}
		}

		return $best;
	}

	/**
	 * How close two paths are: shared leading steps first, then how far apart the last steps are.
	 *
	 * @param int[] $a Path.
	 * @param int[] $b Path.
	 * @return int Higher is closer.
	 */
	private static function closeness( array $a, array $b ): int {
		$shared = 0;
		$limit  = min( count( $a ), count( $b ) );
		while ( $shared < $limit && $a[ $shared ] === $b[ $shared ] ) {
			++$shared;
		}

		return $shared * 1000 - abs( (int) end( $a ) - (int) end( $b ) ) - abs( count( $a ) - count( $b ) ) * 10;
	}

	/**
	 * The versions the block went through, newest first.
	 *
	 * @param array   $target Block now.
	 * @param array[] $steps  Revision and counterpart, newest first.
	 * @return array[]
	 */
	private static function entries( array $target, array $steps ): array {
		$entries   = array();
		$present   = null;
		$last_seen = null;

		foreach ( array_reverse( $steps ) as $index => $step ) {
			$revision = $step['revision'];
			$match    = $step['match'];
			if ( $match ) {
				if ( ! $present ) {
					$type      = $last_seen ? 'readded' : ( 0 === $index ? 'first' : 'added' );
					$entries[] = self::entry( $type, $revision, $match, $last_seen );
				} elseif ( $present['print'] !== $match['print'] ) {
					$entries[] = self::entry( 'edited', $revision, $match, $present );
				} else {
					++$entries[ count( $entries ) - 1 ]['saves'];
				}
				$present   = $match;
				$last_seen = $match;
			} elseif ( $present ) {
				$entries[] = self::entry( 'removed', $revision, null, $present );
				$present   = null;
			}
		}

		if ( ! $present || $present['print'] !== $target['print'] ) {
			$entries[] = self::entry( $present ? 'edited' : ( $last_seen ? 'readded' : 'added' ), null, $target, $present ? $present : $last_seen );
		}

		return array_reverse( $entries );
	}

	/**
	 * One entry.
	 *
	 * @param string     $type     first, added, edited, removed or readded.
	 * @param array|null $revision The revision it happened in, or null for what is not saved yet.
	 * @param array|null $item     The version, or null for removed.
	 * @param array|null $previous The version before it.
	 * @return array
	 */
	private static function entry( string $type, ?array $revision, ?array $item, ?array $previous ): array {
		$shown      = $item ? $item : $previous;
		$attributes = array();
		if ( $item && $previous ) {
			$before = (array) $previous['block']['attrs'];
			$after  = (array) $item['block']['attrs'];
			foreach ( array_keys( array_merge( $before, $after ) ) as $key ) {
				if ( wp_json_encode( self::stable( $before[ $key ] ?? null ) ) !== wp_json_encode( self::stable( $after[ $key ] ?? null ) ) ) {
					$attributes[] = (string) $key;
				}
			}
		}

		return array(
			'type'               => $type,
			'revision_id'        => $revision ? (int) $revision['id'] : 0,
			'current'            => null === $revision,
			'date'               => $revision ? (string) $revision['date'] : '',
			'author'             => $revision ? (string) $revision['author'] : '',
			'autosave'           => $revision ? ! empty( $revision['autosave'] ) : false,
			'path'               => $shown ? $shown['path'] : array(),
			'text'               => $item ? mb_substr( $item['text'], 0, self::TEXT_LIMIT ) : '',
			'previous_text'      => $previous ? mb_substr( $previous['text'], 0, self::TEXT_LIMIT ) : '',
			'text_changed'       => $item && $previous ? $item['text'] !== $previous['text'] : false,
			'attributes_changed' => $attributes,
			'inner_changed'      => $item && $previous ? self::inner_print( $item['block'] ) !== self::inner_print( $previous['block'] ) : false,
			'saves'              => $revision ? 1 : 0,
		);
	}

	/**
	 * The markup of the blocks inside a block.
	 *
	 * @param array $block Parsed block.
	 * @return string
	 */
	private static function inner_print( array $block ): string {
		return implode( '', array_map( 'serialize_block', (array) $block['innerBlocks'] ) );
	}

	/**
	 * A value with its array keys sorted, so equal values print the same.
	 *
	 * @param mixed $value Value.
	 * @return mixed
	 */
	private static function stable( $value ) {
		if ( ! is_array( $value ) ) {
			return $value;
		}
		$value = array_map( array( self::class, 'stable' ), $value );
		ksort( $value );

		return $value;
	}

	/**
	 * A number from 0 to 1, or a fallback.
	 *
	 * @param mixed $value    Given value.
	 * @param float $fallback Default.
	 * @return float
	 */
	private static function clamp( $value, float $fallback ): float {
		return is_numeric( $value ) ? max( 0.0, min( 1.0, (float) $value ) ) : $fallback;
	}
}
