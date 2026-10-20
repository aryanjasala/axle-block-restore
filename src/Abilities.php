<?php
/**
 * Abilities: find and restore single blocks for AI agents and other Abilities API clients.
 *
 * @package AryanX\RestoreOneBlock
 */

namespace AryanX\RestoreOneBlock;

defined( 'ABSPATH' ) || exit;

/**
 * Registers Restore One Block's abilities on WordPress 6.9 and later.
 *
 * In the editor, the plugin guesses which old block matches which current one.
 * An agent does not need the guess: it finds text that was deleted or changed,
 * then names the exact block to bring back by its revision and path. A path
 * counts real blocks only, from 0: `[2]` is the third top-level block and
 * `[2, 0]` the first block inside it.
 *
 * A restore saves the post through wp_update_post(), so it is a new revision
 * itself and can be undone like any other change.
 */
final class Abilities implements Service {

	public const CATEGORY = 'restore-one-block';

	private const MATCHES = 50;

	/**
	 * Hooks into the Abilities API when WordPress has it.
	 */
	public function register(): void {
		if ( ! function_exists( 'wp_register_ability' ) ) {
			return;
		}

		add_action( 'wp_abilities_api_categories_init', array( $this, 'register_category' ) );
		add_action( 'wp_abilities_api_init', array( $this, 'register_abilities' ) );
	}

	/**
	 * Registers the Restore One Block category.
	 */
	public function register_category(): void {
		if ( ! function_exists( 'wp_register_ability_category' ) ) {
			return;
		}

		wp_register_ability_category(
			self::CATEGORY,
			array(
				'label'       => __( 'Restore One Block', 'restore-one-block' ),
				'description' => __( 'Find blocks that were deleted or changed in old revisions, and put one back without rolling back the whole post.', 'restore-one-block' ),
			)
		);
	}

	/**
	 * Registers the abilities.
	 */
	public function register_abilities(): void {
		$post_id   = array(
			'type'        => 'integer',
			'minimum'     => 1,
			'description' => __( 'ID of the post, page or other item.', 'restore-one-block' ),
		);
		$revisions = array(
			'type'        => 'integer',
			'minimum'     => 1,
			'maximum'     => $this->max_revisions(),
			'default'     => 20,
			'description' => __( 'How many of the newest revisions to look through.', 'restore-one-block' ),
		);
		$path      = array(
			'type'        => 'array',
			'items'       => array(
				'type'    => 'integer',
				'minimum' => 0,
			),
			'minItems'    => 1,
			'description' => __( 'Block position from 0, one number per level: [2] is the third top-level block, [2, 0] the first block inside it.', 'restore-one-block' ),
		);
		$found     = array(
			'type'  => 'array',
			'items' => array(
				'type'       => 'object',
				'properties' => array(
					'revision_id' => array( 'type' => 'integer' ),
					'date'        => array( 'type' => 'string' ),
					'path'        => $path,
					'name'        => array( 'type' => 'string' ),
					'text'        => array( 'type' => 'string' ),
					'in_current'  => array( 'type' => 'boolean' ),
				),
			),
		);
		$read_only = array(
			'readonly'   => true,
			'idempotent' => true,
		);

		$this->ability(
			'list-revisions',
			__( 'List revisions', 'restore-one-block' ),
			__( 'Revisions of a post, newest first, with who saved each one.', 'restore-one-block' ),
			array(
				'type'                 => 'object',
				'properties'           => array(
					'post_id' => $post_id,
					'limit'   => $revisions,
				),
				'required'             => array( 'post_id' ),
				'additionalProperties' => false,
			),
			array(
				'type'  => 'array',
				'items' => array(
					'type'       => 'object',
					'properties' => array(
						'id'       => array( 'type' => 'integer' ),
						'date'     => array( 'type' => 'string' ),
						'author'   => array( 'type' => 'string' ),
						'autosave' => array( 'type' => 'boolean' ),
						'blocks'   => array( 'type' => 'integer' ),
					),
				),
			),
			array( $this, 'list_revisions' ),
			$read_only
		);

		$this->ability(
			'find-deleted',
			__( 'Find deleted blocks', 'restore-one-block' ),
			__( 'Blocks whose text is in an old revision but no longer in the post, newest revision first. Each comes with the revision and path to pass to restore-block.', 'restore-one-block' ),
			array(
				'type'                 => 'object',
				'properties'           => array(
					'post_id'   => $post_id,
					'revisions' => $revisions,
				),
				'required'             => array( 'post_id' ),
				'additionalProperties' => false,
			),
			$found,
			array( $this, 'find_deleted' ),
			$read_only
		);

		$this->ability(
			'find-text',
			__( 'Find text in old revisions', 'restore-one-block' ),
			__( 'Blocks in old revisions that contain the given text, newest first, and whether that block is still in the post.', 'restore-one-block' ),
			array(
				'type'                 => 'object',
				'properties'           => array(
					'post_id'   => $post_id,
					'text'      => array(
						'type'      => 'string',
						'minLength' => 2,
					),
					'revisions' => $revisions,
				),
				'required'             => array( 'post_id', 'text' ),
				'additionalProperties' => false,
			),
			$found,
			array( $this, 'find_text' ),
			$read_only
		);

		$this->ability(
			'restore-block',
			__( 'Restore one block', 'restore-one-block' ),
			__( 'Puts one block from an old revision back into the post: inserted at a top-level position (default: where it was), or replacing the block at a path. Saves the post, which makes a new revision, so it can be undone. Refuses while someone else has the post open in the editor, unless force is true.', 'restore-one-block' ),
			array(
				'type'                 => 'object',
				'properties'           => array(
					'post_id'     => $post_id,
					'revision_id' => array(
						'type'    => 'integer',
						'minimum' => 1,
					),
					'path'        => $path,
					'mode'        => array(
						'type'    => 'string',
						'enum'    => array( 'insert', 'replace' ),
						'default' => 'insert',
					),
					'position'    => array(
						'type'        => 'integer',
						'minimum'     => 0,
						'description' => __( 'Insert: top-level position from 0. Default: the position it had in the revision.', 'restore-one-block' ),
					),
					'target_path' => array_merge( $path, array( 'description' => __( 'Replace: path of the current block to replace. Default: the same path as in the revision.', 'restore-one-block' ) ) ),
					'force'       => array(
						'type'    => 'boolean',
						'default' => false,
					),
				),
				'required'             => array( 'post_id', 'revision_id', 'path' ),
				'additionalProperties' => false,
			),
			array(
				'type'       => 'object',
				'properties' => array(
					'post_id'     => array( 'type' => 'integer' ),
					'mode'        => array( 'type' => 'string' ),
					'name'        => array( 'type' => 'string' ),
					'path'        => $path,
					'revision_id' => array(
						'type'        => 'integer',
						'description' => 'The new revision this restore saved.',
					),
				),
			),
			array( $this, 'restore_block' ),
			array(
				'readonly'    => false,
				'destructive' => false,
				'idempotent'  => false,
			)
		);
	}

	/**
	 * Ability: revisions of a post.
	 *
	 * @param array|null $input Ability input.
	 * @return array[]
	 */
	public function list_revisions( $input = null ): array {
		$input = (array) $input;
		$items = array();

		foreach ( $this->revisions( (int) $input['post_id'], (int) ( $input['limit'] ?? 20 ) ) as $revision ) {
			$author  = get_userdata( (int) $revision->post_author );
			$items[] = array(
				'id'       => (int) $revision->ID,
				'date'     => gmdate( 'c', (int) strtotime( $revision->post_date_gmt . ' UTC' ) ),
				'author'   => $author ? $author->display_name : '',
				'autosave' => false !== wp_is_post_autosave( $revision ),
				'blocks'   => count( $this->real_indexes( parse_blocks( $revision->post_content ) ) ),
			);
		}

		return $items;
	}

	/**
	 * Ability: blocks that were deleted.
	 *
	 * @param array|null $input Ability input.
	 * @return array[]
	 */
	public function find_deleted( $input = null ): array {
		$input = (array) $input;

		return $this->search(
			(int) $input['post_id'],
			(int) ( $input['revisions'] ?? 20 ),
			static function ( string $text, bool $in_current ): bool {
				return ! $in_current;
			}
		);
	}

	/**
	 * Ability: blocks containing some text.
	 *
	 * @param array|null $input Ability input.
	 * @return array[]
	 */
	public function find_text( $input = null ): array {
		$input  = (array) $input;
		$needle = $this->normalize( (string) ( $input['text'] ?? '' ) );

		return $this->search(
			(int) $input['post_id'],
			(int) ( $input['revisions'] ?? 20 ),
			static function ( string $text ) use ( $needle ): bool {
				return '' !== $needle && false !== stripos( $text, $needle );
			}
		);
	}

	/**
	 * Ability: puts one block back.
	 *
	 * @param array|null $input Ability input.
	 * @return array|\WP_Error
	 */
	public function restore_block( $input = null ) {
		$input       = (array) $input;
		$post_id     = (int) $input['post_id'];
		$revision_id = (int) $input['revision_id'];
		$path        = array_map( 'intval', (array) $input['path'] );
		$mode        = 'replace' === ( $input['mode'] ?? 'insert' ) ? 'replace' : 'insert';
		$post        = get_post( $post_id );
		$revision    = wp_get_post_revision( $revision_id );

		if ( ! $post || ! $revision || (int) $revision->post_parent !== $post_id ) {
			return new \WP_Error( 'restore_one_block_revision', __( 'That revision does not belong to this post.', 'restore-one-block' ) );
		}

		$block = $this->node_at( parse_blocks( $revision->post_content ), $path );
		if ( ! $block ) {
			return new \WP_Error( 'restore_one_block_path', __( 'That revision has no block at this path.', 'restore-one-block' ) );
		}

		if ( empty( $input['force'] ) ) {
			if ( ! function_exists( 'wp_check_post_lock' ) ) {
				require_once ABSPATH . 'wp-admin/includes/post.php';
			}
			$editing = wp_check_post_lock( $post_id );
			if ( $editing ) {
				$user = get_userdata( (int) $editing );
				return new \WP_Error(
					'restore_one_block_locked',
					/* translators: %s: user name. */
					sprintf( __( '%s has this post open in the editor, and saving now could overwrite their work. Try again later, or pass force.', 'restore-one-block' ), $user ? $user->display_name : __( 'Someone', 'restore-one-block' ) )
				);
			}
		}

		$blocks = parse_blocks( $post->post_content );
		if ( 'replace' === $mode ) {
			$target = isset( $input['target_path'] ) ? array_map( 'intval', (array) $input['target_path'] ) : $path;
			if ( ! $this->replace_at( $blocks, $target, $block ) ) {
				return new \WP_Error( 'restore_one_block_target', __( 'The post has no block at the target path.', 'restore-one-block' ) );
			}
			$where = $target;
		} else {
			$where = array( $this->insert_at( $blocks, (int) ( $input['position'] ?? $path[0] ), $block ) );
		}

		$saved = wp_update_post(
			array(
				'ID'           => $post_id,
				'post_content' => wp_slash( serialize_blocks( $blocks ) ),
			),
			true
		);
		if ( is_wp_error( $saved ) ) {
			return $saved;
		}

		/**
		 * Fires after a block from an old revision is saved back into a post.
		 *
		 * The JavaScript `restoreOneBlock.restored` action is the editor's
		 * counterpart; this one covers restores made through the abilities.
		 *
		 * @param int    $post_id     Post.
		 * @param array  $block       The restored block, as parse_blocks() returns it.
		 * @param int    $revision_id Revision it came from.
		 * @param string $mode        insert or replace.
		 */
		do_action( 'restore_one_block_restored', $post_id, $block, $revision_id, $mode );

		$latest = $this->revisions( $post_id, 1 );

		return array(
			'post_id'     => $post_id,
			'mode'        => $mode,
			'name'        => $this->name( $block ),
			'path'        => $where,
			'revision_id' => $latest ? (int) $latest[0]->ID : 0,
		);
	}

	/**
	 * Permission: editing the post, in a post type that has Restore One Block.
	 *
	 * @param array|null $input Ability input.
	 * @return bool
	 */
	public function can_edit( $input = null ): bool {
		$post = get_post( (int) ( ( (array) $input )['post_id'] ?? 0 ) );

		return $post && in_array( $post->post_type, Plugin::post_types(), true ) && current_user_can( 'edit_post', $post->ID );
	}

	/**
	 * Most revisions one ability looks through.
	 *
	 * @return int
	 */
	private function max_revisions(): int {
		/**
		 * Filters how many revisions the find abilities may look through at most.
		 *
		 * @param int $max Default 50.
		 */
		return max( 1, (int) apply_filters( 'restore_one_block_max_revisions', 50 ) );
	}

	/**
	 * Revisions of a post, newest first.
	 *
	 * @param int $post_id Post.
	 * @param int $limit   How many.
	 * @return \WP_Post[]
	 */
	private function revisions( int $post_id, int $limit ): array {
		return array_values(
			wp_get_post_revisions(
				$post_id,
				array(
					'posts_per_page' => max( 1, min( $this->max_revisions(), $limit ) ),
					'orderby'        => 'date ID',
					'order'          => 'DESC',
				)
			)
		);
	}

	/**
	 * Blocks in revisions that a test accepts, each text reported once, newest revision first.
	 *
	 * @param int      $post_id   Post.
	 * @param int      $revisions How many revisions to look through.
	 * @param callable $accept    ( string $text, bool $in_current ) => bool.
	 * @return array[]
	 */
	private function search( int $post_id, int $revisions, callable $accept ): array {
		$post = get_post( $post_id );
		if ( ! $post ) {
			return array();
		}

		$current = array();
		foreach ( $this->leaves( parse_blocks( $post->post_content ) ) as $leaf ) {
			$current[ $leaf['text'] ] = true;
		}

		$found = array();
		$seen  = array();
		foreach ( $this->revisions( $post_id, $revisions ) as $revision ) {
			foreach ( $this->leaves( parse_blocks( $revision->post_content ) ) as $leaf ) {
				$in_current = isset( $current[ $leaf['text'] ] );
				if ( isset( $seen[ $leaf['text'] ] ) || ! $accept( $leaf['text'], $in_current ) ) {
					continue;
				}
				$seen[ $leaf['text'] ] = true;
				$found[]               = array(
					'revision_id' => (int) $revision->ID,
					'date'        => gmdate( 'c', (int) strtotime( $revision->post_date_gmt . ' UTC' ) ),
					'path'        => $leaf['path'],
					'name'        => $leaf['name'],
					'text'        => mb_substr( $leaf['text'], 0, 300 ),
					'in_current'  => $in_current,
				);
				if ( count( $found ) >= self::MATCHES ) {
					return $found;
				}
			}
		}

		return $found;
	}

	/**
	 * Blocks without inner blocks that have text, with their paths.
	 *
	 * @param array $blocks Parsed blocks.
	 * @param int[] $prefix Path of the block they sit in.
	 * @return array[] Each with path, name and text.
	 */
	private function leaves( array $blocks, array $prefix = array() ): array {
		$leaves = array();
		foreach ( $this->real_indexes( $blocks ) as $position => $raw ) {
			$block = $blocks[ $raw ];
			$path  = array_merge( $prefix, array( $position ) );
			if ( ! empty( $block['innerBlocks'] ) ) {
				$leaves = array_merge( $leaves, $this->leaves( $block['innerBlocks'], $path ) );
				continue;
			}
			$text = $this->normalize( (string) $block['innerHTML'] );
			if ( '' !== $text ) {
				$leaves[] = array(
					'path' => $path,
					'name' => $this->name( $block ),
					'text' => $text,
				);
			}
		}

		return $leaves;
	}

	/**
	 * The block at a path.
	 *
	 * @param array $blocks Parsed blocks.
	 * @param int[] $path   Path.
	 * @return array|null
	 */
	private function node_at( array $blocks, array $path ): ?array {
		$indexes = $this->real_indexes( $blocks );
		$first   = array_shift( $path );
		if ( null === $first || ! isset( $indexes[ $first ] ) ) {
			return null;
		}

		$block = $blocks[ $indexes[ $first ] ];

		return $path ? $this->node_at( $block['innerBlocks'], $path ) : $block;
	}

	/**
	 * Replaces the block at a path with another block.
	 *
	 * Nested blocks keep their place in innerContent, because one block takes the place of one block.
	 *
	 * @param array $blocks Parsed blocks, changed in place.
	 * @param int[] $path   Path.
	 * @param array $block  New block.
	 * @return bool Whether there was a block at the path.
	 */
	private function replace_at( array &$blocks, array $path, array $block ): bool {
		$indexes = $this->real_indexes( $blocks );
		$first   = array_shift( $path );
		if ( null === $first || ! isset( $indexes[ $first ] ) ) {
			return false;
		}

		$raw = $indexes[ $first ];
		if ( ! $path ) {
			$blocks[ $raw ] = $block;
			return true;
		}

		return $this->replace_at( $blocks[ $raw ]['innerBlocks'], $path, $block );
	}

	/**
	 * Inserts a block at a top-level position, with the blank line WordPress puts between blocks.
	 *
	 * @param array $blocks   Parsed top-level blocks, changed in place.
	 * @param int   $position Position from 0 among real blocks, clamped to the end.
	 * @param array $block    Block.
	 * @return int The position it ended up at.
	 */
	private function insert_at( array &$blocks, int $position, array $block ): int {
		$indexes   = $this->real_indexes( $blocks );
		$position  = max( 0, min( $position, count( $indexes ) ) );
		$separator = array(
			'blockName'    => null,
			'attrs'        => array(),
			'innerBlocks'  => array(),
			'innerHTML'    => "\n\n",
			'innerContent' => array( "\n\n" ),
		);

		if ( isset( $indexes[ $position ] ) ) {
			array_splice( $blocks, $indexes[ $position ], 0, array( $block, $separator ) );
		} else {
			array_push( $blocks, $separator, $block );
		}

		return $position;
	}

	/**
	 * Raw indexes of real blocks: everything except the blank lines between blocks.
	 *
	 * @param array $blocks Parsed blocks.
	 * @return int[] Position among real blocks => raw index.
	 */
	private function real_indexes( array $blocks ): array {
		$indexes = array();
		foreach ( $blocks as $raw => $block ) {
			if ( null !== $block['blockName'] || '' !== trim( (string) $block['innerHTML'] ) ) {
				$indexes[] = (int) $raw;
			}
		}

		return $indexes;
	}

	/**
	 * Block name; classic content without block markup counts as core/freeform.
	 *
	 * @param array $block Parsed block.
	 * @return string
	 */
	private function name( array $block ): string {
		return null === $block['blockName'] ? 'core/freeform' : (string) $block['blockName'];
	}

	/**
	 * Text of some HTML, for comparing blocks across revisions.
	 *
	 * @param string $html HTML.
	 * @return string
	 */
	private function normalize( string $html ): string {
		return trim( (string) preg_replace( '/\s+/u', ' ', html_entity_decode( wp_strip_all_tags( $html ), ENT_QUOTES, 'UTF-8' ) ) );
	}

	/**
	 * Registers one ability in the Restore One Block category.
	 *
	 * @param string   $name        Name without the namespace.
	 * @param string   $label       Label.
	 * @param string   $description What it does, for people and agents.
	 * @param array    $input       Input schema.
	 * @param array    $output      Output schema.
	 * @param callable $execute     Execute callback.
	 * @param array    $annotations readonly, destructive, idempotent.
	 */
	private function ability( string $name, string $label, string $description, array $input, array $output, callable $execute, array $annotations ): void {
		wp_register_ability(
			self::CATEGORY . '/' . $name,
			array(
				'label'               => $label,
				'description'         => $description,
				'category'            => self::CATEGORY,
				'input_schema'        => $input,
				'output_schema'       => $output,
				'execute_callback'    => $execute,
				'permission_callback' => array( $this, 'can_edit' ),
				'meta'                => array(
					'annotations'  => $annotations,
					'show_in_rest' => true,
				),
			)
		);
	}
}
