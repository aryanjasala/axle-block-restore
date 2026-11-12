<?php
/**
 * `wp axle-block-restore` commands.
 *
 * @package AryanX\Axle\BlockRestore
 */

namespace AryanX\Axle\BlockRestore\Cli;

use AryanX\Axle\BlockRestore\Abilities;

defined( 'ABSPATH' ) || exit;

/**
 * Find and restore single blocks of a post from the command line.
 *
 * The commands do what the abilities do and run as the shell user, so they do
 * not check a logged-in user's capabilities. Paths count real blocks only, from
 * 0, separated by commas: `2` is the third top-level block, `2,0` the first
 * block inside it.
 */
final class Command {

	/**
	 * Does the work, shared with the abilities.
	 *
	 * @var Abilities
	 */
	private Abilities $abilities;

	/**
	 * Sets up the command.
	 *
	 * @param Abilities $abilities The abilities, whose methods do the work.
	 */
	public function __construct( Abilities $abilities ) {
		$this->abilities = $abilities;
	}

	/**
	 * Lists the revisions of a post, newest first.
	 *
	 * ## OPTIONS
	 *
	 * <post>
	 * : Post ID.
	 *
	 * [--limit=<number>]
	 * : How many of the newest revisions to list.
	 * ---
	 * default: 20
	 * ---
	 *
	 * [--format=<format>]
	 * : Output format.
	 * ---
	 * default: table
	 * options:
	 *   - table
	 *   - json
	 *   - csv
	 *   - yaml
	 *   - count
	 * ---
	 *
	 * ## EXAMPLES
	 *
	 *     wp axle-block-restore revisions 42
	 *
	 * @param string[]             $args       Positional arguments.
	 * @param array<string,string> $assoc_args Flags.
	 */
	public function revisions( $args, $assoc_args ): void {
		$items = $this->abilities->list_revisions(
			array(
				'post_id' => $this->post_id( $args[0] ),
				'limit'   => (int) ( $assoc_args['limit'] ?? 20 ),
			)
		);
		$this->print_items( $items, array( 'id', 'date', 'author', 'autosave', 'blocks' ), $assoc_args );
	}

	/**
	 * Lists blocks that are in old revisions and no longer in the post.
	 *
	 * ## OPTIONS
	 *
	 * <post>
	 * : Post ID.
	 *
	 * [--revisions=<number>]
	 * : How many of the newest revisions to look through.
	 * ---
	 * default: 20
	 * ---
	 *
	 * [--format=<format>]
	 * : Output format.
	 * ---
	 * default: table
	 * options:
	 *   - table
	 *   - json
	 *   - csv
	 *   - yaml
	 *   - count
	 * ---
	 *
	 * ## EXAMPLES
	 *
	 *     wp axle-block-restore find-deleted 42
	 *
	 * @subcommand find-deleted
	 *
	 * @param string[]             $args       Positional arguments.
	 * @param array<string,string> $assoc_args Flags.
	 */
	public function find_deleted( $args, $assoc_args ): void {
		$items = $this->abilities->find_deleted(
			array(
				'post_id'   => $this->post_id( $args[0] ),
				'revisions' => (int) ( $assoc_args['revisions'] ?? 20 ),
			)
		);
		$this->print_items( $items, array( 'revision_id', 'date', 'path', 'name', 'text' ), $assoc_args );
	}

	/**
	 * Finds text in old revisions and says whether that block is still in the post.
	 *
	 * ## OPTIONS
	 *
	 * <post>
	 * : Post ID.
	 *
	 * <text>
	 * : Text to look for, at least 2 characters.
	 *
	 * [--revisions=<number>]
	 * : How many of the newest revisions to look through.
	 * ---
	 * default: 20
	 * ---
	 *
	 * [--format=<format>]
	 * : Output format.
	 * ---
	 * default: table
	 * options:
	 *   - table
	 *   - json
	 *   - csv
	 *   - yaml
	 *   - count
	 * ---
	 *
	 * ## EXAMPLES
	 *
	 *     wp axle-block-restore find-text 42 "ten dollars"
	 *
	 * @subcommand find-text
	 *
	 * @param string[]             $args       Positional arguments.
	 * @param array<string,string> $assoc_args Flags.
	 */
	public function find_text( $args, $assoc_args ): void {
		if ( mb_strlen( $args[1] ) < 2 ) {
			\WP_CLI::error( 'The text must be at least 2 characters.' );
		}
		$items = $this->abilities->find_text(
			array(
				'post_id'   => $this->post_id( $args[0] ),
				'text'      => $args[1],
				'revisions' => (int) ( $assoc_args['revisions'] ?? 20 ),
			)
		);
		$this->print_items( $items, array( 'revision_id', 'date', 'path', 'name', 'in_current', 'text' ), $assoc_args );
	}

	/**
	 * Shows every version one block had, newest first.
	 *
	 * ## OPTIONS
	 *
	 * <post>
	 * : Post ID.
	 *
	 * <path>
	 * : Position of the block in the post as it is now, counting real blocks from 0, one number per level, separated by commas.
	 *
	 * [--revisions=<number>]
	 * : How many of the newest revisions to look through.
	 * ---
	 * default: 100
	 * ---
	 *
	 * [--format=<format>]
	 * : Output format.
	 * ---
	 * default: table
	 * options:
	 *   - table
	 *   - json
	 *   - csv
	 *   - yaml
	 *   - count
	 * ---
	 *
	 * ## EXAMPLES
	 *
	 *     # The history of the third top-level block.
	 *     wp axle-block-restore history 42 2
	 *
	 *     # The first block inside the third block.
	 *     wp axle-block-restore history 42 2,0 --format=json
	 *
	 * @param string[]             $args       Positional arguments.
	 * @param array<string,string> $assoc_args Flags.
	 */
	public function history( $args, $assoc_args ): void {
		$history = $this->abilities->block_history(
			array(
				'post_id'   => $this->post_id( $args[0] ),
				'path'      => $this->path( $args[1] ),
				'revisions' => (int) ( $assoc_args['revisions'] ?? 100 ),
			)
		);
		if ( is_wp_error( $history ) ) {
			\WP_CLI::error( $history->get_error_message() );
		}

		$this->print_items( $history['entries'], array( 'type', 'revision_id', 'date', 'author', 'autosave', 'saves', 'text_changed', 'text' ), $assoc_args );
	}

	/**
	 * Puts one block from an old revision back into a post.
	 *
	 * Saves the post, which makes a new revision, so it can be undone.
	 *
	 * ## OPTIONS
	 *
	 * <post>
	 * : Post ID.
	 *
	 * <revision>
	 * : ID of the revision to take the block from.
	 *
	 * <path>
	 * : Position of the block in that revision, counting real blocks from 0, separated by commas.
	 *
	 * [--mode=<mode>]
	 * : Insert the block at a top-level position, or replace the block at a path.
	 * ---
	 * default: insert
	 * options:
	 *   - insert
	 *   - replace
	 * ---
	 *
	 * [--position=<number>]
	 * : Insert: top-level position from 0. Default: the position it had in the revision.
	 *
	 * [--target-path=<path>]
	 * : Replace: path of the current block to replace. Default: the same path as in the revision.
	 *
	 * [--force]
	 * : Save even when someone else has the post open in the editor.
	 *
	 * ## EXAMPLES
	 *
	 *     wp axle-block-restore restore 42 108 2
	 *     wp axle-block-restore restore 42 108 2 --mode=replace --target-path=1
	 *
	 * @param string[]             $args       Positional arguments.
	 * @param array<string,string> $assoc_args Flags.
	 */
	public function restore( $args, $assoc_args ): void {
		$input = array(
			'post_id'     => $this->post_id( $args[0] ),
			'revision_id' => (int) $args[1],
			'path'        => $this->path( $args[2] ),
			'mode'        => (string) ( $assoc_args['mode'] ?? 'insert' ),
			'force'       => ! empty( $assoc_args['force'] ),
		);
		if ( isset( $assoc_args['position'] ) ) {
			$input['position'] = (int) $assoc_args['position'];
		}
		if ( isset( $assoc_args['target-path'] ) ) {
			$input['target_path'] = $this->path( (string) $assoc_args['target-path'] );
		}

		$result = $this->abilities->restore_block( $input );
		if ( is_wp_error( $result ) ) {
			\WP_CLI::error( $result->get_error_message() );
		}

		\WP_CLI::success(
			sprintf(
				'Put %1$s back into post %2$d (%3$s, new revision %4$d).',
				$result['name'],
				$result['post_id'],
				$result['mode'],
				$result['revision_id']
			)
		);
	}

	/**
	 * A post ID that exists.
	 *
	 * @param string $value Argument.
	 * @return int
	 */
	private function post_id( string $value ): int {
		$post_id = (int) $value;
		if ( $post_id < 1 || ! get_post( $post_id ) ) {
			\WP_CLI::error( sprintf( 'Post %s does not exist.', $value ) );
		}

		return $post_id;
	}

	/**
	 * A block path from "2,0".
	 *
	 * @param string $value Argument.
	 * @return int[]
	 */
	private function path( string $value ): array {
		$parts = array_filter( array_map( 'trim', explode( ',', $value ) ), 'is_numeric' );
		if ( ! $parts ) {
			\WP_CLI::error( 'The path must be numbers separated by commas, such as 2 or 2,0.' );
		}

		return array_map( 'intval', $parts );
	}

	/**
	 * Prints rows, with lists and booleans as text.
	 *
	 * @param array[]              $items      Rows.
	 * @param string[]             $fields     Columns for the table.
	 * @param array<string,string> $assoc_args Flags.
	 */
	private function print_items( array $items, array $fields, array $assoc_args ): void {
		$format = (string) ( $assoc_args['format'] ?? 'table' );
		if ( 'json' !== $format && 'yaml' !== $format ) {
			$items = array_map(
				static function ( array $item ): array {
					return array_map(
						static function ( $value ) {
							if ( is_array( $value ) ) {
								return implode( ',', $value );
							}

							return is_bool( $value ) ? ( $value ? 'yes' : 'no' ) : $value;
						},
						$item
					);
				},
				$items
			);
		}

		\WP_CLI\Utils\format_items( $format, $items, $fields );
	}
}
