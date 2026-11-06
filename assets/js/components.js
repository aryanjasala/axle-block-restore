/**
 * Axle Block Restore: the restore window and its parts.
 *
 * Exposes window.axleBlockRestore.RestoreModal. Matching logic lives in
 * matching.js so it can be unit tested without WordPress.
 */
( function ( wp, matching ) {
	'use strict';

	const el = wp.element.createElement;
	const { Fragment, useState, useEffect, useMemo, useRef } = wp.element;
	const { __, sprintf, _n } = wp.i18n;
	const { BlockPreview } = wp.blockEditor;
	const { Modal, Button, Spinner, Notice, ToggleControl, SearchControl, SelectControl, Card, CardHeader, CardBody, PanelBody } = wp.components;
	const { useSelect, useDispatch } = wp.data;
	const { parse, serialize, cloneBlock, createBlock, getBlockType } = wp.blocks;
	const { addQueryArgs } = wp.url;
	const { dateI18n, getSettings: getDateSettings } = wp.date;
	const { applyFilters, doAction } = wp.hooks;

	/**
	 * Revisions loaded at a time. Read when the window opens, so filters added by
	 * scripts that load later still count.
	 *
	 * @return {number} Between 1 and 100, the most the REST API allows.
	 */
	function perPage() {
		/**
		 * Filters how many revisions load at a time.
		 *
		 * @param {number} perPage Default 50.
		 */
		return Math.min( 100, Math.max( 1, parseInt( applyFilters( 'axleBlockRestore.revisionsPerPage', 50 ), 10 ) || 50 ) );
	}
	const MAX_CANDIDATES = 6;

	// Blocks whose inner blocks are not part of their own entity (a template part is a document of its own), so they are never compared.
	const OWN_NOTHING_INSIDE = [ 'core/template-part', 'core/post-content', 'core/block' ];

	// The five tones, as the intents of core's Badge.
	const INTENTS = { good: 'success', warning: 'warning', error: 'error', info: 'info', neutral: 'default' };

	/**
	 * A short label with a tone, in the markup of core's Badge component.
	 *
	 * Core does not export Badge to the `wp.components` global, but its stylesheet is
	 * loaded with the rest of the components, so the same classes get the same look.
	 *
	 * @param {Object} props Tone (good, warning, error, info, neutral), state name for styling hooks, and the label.
	 * @return {Element} Badge.
	 */
	function Tone( { tone, state, children } ) {
		return el(
			'span',
			{ className: 'components-badge is-' + INTENTS[ tone ] + ' abr-badge abr-badge--' + state },
			el( 'span', { className: 'components-badge__flex-wrapper' }, el( 'span', { className: 'components-badge__content' }, children ) )
		);
	}

	/**
	 * Tone of a block's state in a revision.
	 *
	 * @type {Object<string, string>}
	 */
	const STATE_TONES = { same: 'good', changed: 'warning', missing: 'error', match: 'info', found: 'info', added: 'good', removed: 'error' };

	/**
	 * Settings of the plugin, printed by PHP.
	 *
	 * @return {{postTypes: string[]}} Post types the current user can restore blocks in.
	 */
	function config() {
		return ( window.axleBlockRestore && window.axleBlockRestore.config ) || { postTypes: [] };
	}

	/**
	 * Which post, template, template part or pattern a block belongs to.
	 *
	 * A block inside a template part (in the Site Editor, edited from inside a
	 * template) belongs to that template part, so its revisions are the part's.
	 * Everything else belongs to the entity being edited.
	 *
	 * @param {Function} select   The data registry's select.
	 * @param {string}   clientId Block, or null for the whole entity being edited.
	 * @return {{postType: string, id: (number|string)}} Entity.
	 */
	function resolveEntity( select, clientId ) {
		const editor = select( 'core/editor' );
		let postType = editor.getCurrentPostType();
		let id = editor.getCurrentPostId();

		if ( clientId ) {
			const blockEditor = select( 'core/block-editor' );
			const part = blockEditor
				.getBlockParents( clientId, true )
				.map( ( parentId ) => blockEditor.getBlock( parentId ) )
				.find( ( block ) => block && 'core/template-part' === block.name && block.attributes.slug );

			if ( part ) {
				const theme = part.attributes.theme || ( select( 'core' ).getCurrentTheme() || {} ).stylesheet;
				if ( theme ) {
					postType = 'wp_template_part';
					id = theme + '//' + part.attributes.slug;
				}
			}
		}

		return { postType, id };
	}

	/**
	 * Whether the entity has revisions this plugin can restore from.
	 *
	 * @param {{postType: string}} entity Result of resolveEntity().
	 * @return {boolean} True when the server listed the post type for this user.
	 */
	function isSupported( entity ) {
		return !! entity.postType && config().postTypes.indexOf( entity.postType ) !== -1;
	}

	/**
	 * Role of each attribute of a block type: content, style or keep.
	 *
	 * Read when a restore window opens, so filters added by scripts that load later still count.
	 *
	 * @param {string} blockName Block type name.
	 * @return {function(string): string} Role of an attribute name.
	 */
	function roleResolver( blockName ) {
		const type = getBlockType( blockName );
		const schema = ( type && type.attributes ) || {};

		/**
		 * Filters the attribute names that count as style when restoring only the styling or only the content.
		 *
		 * @param {string[]} names     Default style, className, align, layout, backgroundColor, textColor, fontSize, fontFamily, gradient, borderColor.
		 * @param {string}   blockName Block type name.
		 */
		const styleNames = applyFilters( 'axleBlockRestore.styleAttributes', matching.STYLE_ATTRIBUTES.slice(), blockName );

		return ( name ) => {
			const fallback = matching.attributeRole( name, schema[ name ], Array.isArray( styleNames ) ? styleNames : matching.STYLE_ATTRIBUTES );

			/**
			 * Filters whether an attribute is content, style, or kept as it is now by a partial restore.
			 *
			 * "Restore content only" takes the content attributes and inner blocks from the revision. "Restore styling
			 * only" takes the style attributes. Attributes with the role "keep" are never taken from the revision.
			 *
			 * @param {string} role      "content", "style" or "keep". Default from the block.json role, the attribute's source and the style list.
			 * @param {string} name      Attribute name.
			 * @param {string} blockName Block type name.
			 * @param {Object} schema    The attribute's definition from block.json, if any.
			 */
			const role = applyFilters( 'axleBlockRestore.attributeRole', fallback, name, blockName, schema[ name ] );
			return -1 !== [ 'content', 'style', 'keep' ].indexOf( role ) ? role : fallback;
		};
	}

	/**
	 * The ways a block can be restored.
	 *
	 * @return {string[]} Some of "replace", "content" and "style".
	 */
	function restoreModes() {
		/**
		 * Filters the ways one block can be restored from a revision.
		 *
		 * @param {string[]} modes Default replace, content, style. Unknown names are dropped, and replace is always kept.
		 */
		const modes = applyFilters( 'axleBlockRestore.restoreModes', [ 'replace', 'content', 'style' ] );
		return [ 'replace', 'content', 'style' ].filter( ( mode ) => 'replace' === mode || ( Array.isArray( modes ) && modes.indexOf( mode ) !== -1 ) );
	}

	/**
	 * Type, text and fingerprint of a block, used for every comparison.
	 *
	 * @param {Object} block Parsed block.
	 * @return {{block: Object, name: string, title: string, text: string, print: string}} Description.
	 */
	function describe( block ) {
		const type = getBlockType( block.name );
		const print = serialize( [ block ] ).trim();

		return {
			block,
			name: block.name,
			title: type ? type.title : block.name,
			text: matching.textFromMarkup( print ),
			print,
		};
	}

	/**
	 * Parses a revision once and describes its blocks, top level and nested.
	 *
	 * Template revisions come from the templates controller: their `id` is the
	 * template's ID, the revision's own ID is `wp_id`, and the date is `modified`
	 * in the site's time zone.
	 *
	 * @param {Object} revision Revision from the REST API.
	 * @return {Object} Revision with `top` and `all` block lists, `id` and `when`.
	 */
	function prepare( revision ) {
		const blocks = parse( ( revision.content && revision.content.raw ) || '' );

		return Object.assign( {}, revision, {
			id: revision.wp_id || revision.id,
			// date_gmt has no zone marker; adding "Z" makes it UTC. dateI18n shows either in the site's time zone.
			when: revision.date_gmt ? revision.date_gmt + 'Z' : revision.modified,
			top: blocks.map( describe ),
			all: matching.flatten( blocks ).map( ( item ) => Object.assign( describe( item.block ), { path: item.path } ) ),
		} );
	}

	/**
	 * Loads revisions page by page, newest first.
	 *
	 * Asks for raw content only: requesting "rendered" would make the server
	 * render every revision.
	 *
	 * @param {Object} post Entity: post type, ID, REST base and namespace.
	 * @return {Object} Revisions, loading flag, error, empty flag, loadMore() and retry().
	 */
	function useRevisions( post ) {
		const PER_PAGE = useMemo( perPage, [] );
		const [ revisions, setRevisions ] = useState( [] );
		const [ page, setPage ] = useState( 1 );
		const [ attempt, setAttempt ] = useState( 0 );
		const [ hasMore, setHasMore ] = useState( false );
		const [ loading, setLoading ] = useState( true );
		const [ error, setError ] = useState( null );
		const [ none, setNone ] = useState( false );

		useEffect( () => {
			if ( ! post.restBase || ! post.id ) {
				return;
			}
			setError( null );
			// A template or part that still comes from the theme's files has no post, so no revisions to ask for.
			setNone( !! post.fromTheme );
			if ( post.fromTheme ) {
				setLoading( false );
				return;
			}
			setLoading( true );
			wp.apiFetch( {
				path: addQueryArgs( `/${ post.restNamespace }/${ post.restBase }/${ post.id }/revisions`, {
					context: 'edit',
					per_page: PER_PAGE,
					page,
					_fields: 'id,wp_id,modified,date_gmt,slug,content.raw,axle_block_restore_author',
				} ),
			} )
				.then( ( items ) => {
					// A revision saved while the window is open shifts the pages, so skip ones already listed.
					setRevisions( ( previous ) => {
						const seen = new Set( previous.map( ( revision ) => revision.id ) );
						return previous.concat( items.map( prepare ).filter( ( item ) => ! seen.has( item.id ) ) );
					} );
					setHasMore( items.length === PER_PAGE );
				} )
				.catch( ( fetchError ) => {
					// A template that still comes from the theme's files has no revisions to list.
					if ( fetchError && 'rest_invalid_template' === fetchError.code ) {
						setNone( true );
					} else {
						setError( ( fetchError && fetchError.message ) || __( 'Could not load revisions.', 'axle-block-restore' ) );
					}
				} )
				.finally( () => setLoading( false ) );
		}, [ post.id, post.restBase, post.restNamespace, post.fromTheme, page, attempt ] );

		return { revisions, loading, error, none, hasMore, loadMore: () => setPage( page + 1 ), retry: () => setAttempt( attempt + 1 ) };
	}

	/**
	 * Text with every match of a query wrapped in <mark>.
	 *
	 * @param {Object} props Text and query.
	 * @return {Element} Highlighted text.
	 */
	function Highlight( { text, query } ) {
		const needle = ( query || '' ).trim();
		if ( needle.length < 2 ) {
			return text;
		}

		const parts = [];
		const lower = text.toLowerCase();
		const target = needle.toLowerCase();
		let from = 0;
		let at = lower.indexOf( target );

		while ( at !== -1 ) {
			parts.push( text.slice( from, at ), el( 'mark', { key: at }, text.slice( at, at + needle.length ) ) );
			from = at + needle.length;
			at = lower.indexOf( target, from );
		}
		parts.push( text.slice( from ) );

		return el( Fragment, null, ...parts );
	}

	/**
	 * Word-level changes from the current text to the revision's text.
	 *
	 * @param {Object} props Text now and text in the revision.
	 * @return {Element} Paragraph with <del> and <ins>.
	 */
	function DiffView( { before, after } ) {
		return el(
			'p',
			{ className: 'abr-diff', 'aria-label': __( 'Changes this restore would make', 'axle-block-restore' ) },
			matching.wordDiff( before, after ).map( ( part, index ) => {
				if ( 'same' === part.type ) {
					return part.text;
				}
				return el( 'added' === part.type ? 'ins' : 'del', { key: index }, part.text );
			} )
		);
	}

	/**
	 * A value from block attributes in a few characters.
	 *
	 * @param {*} value Attribute value.
	 * @return {string} Short text.
	 */
	function shortValue( value ) {
		if ( undefined === value ) {
			return __( 'not set', 'axle-block-restore' );
		}
		const text = 'string' === typeof value ? value : JSON.stringify( value );
		return text.length > 48 ? text.slice( 0, 47 ) + '…' : text;
	}

	/**
	 * Settings that a restore would change, one line each.
	 *
	 * @param {Object} props Changed attributes from matching.changedAttributes().
	 * @return {Element|null} List.
	 */
	function SettingChanges( { changes } ) {
		if ( ! changes.length ) {
			return null;
		}

		return el(
			'ul',
			{ className: 'abr-settings', 'aria-label': __( 'Settings that would change', 'axle-block-restore' ) },
			changes.map( ( change ) =>
				el(
					'li',
					{ key: change.name },
					el( 'code', null, change.name ),
					' ',
					/* translators: 1: value now, 2: value in the revision. */
					sprintf( __( '%1$s to %2$s', 'axle-block-restore' ), shortValue( change.before ), shortValue( change.after ) )
				)
			)
		);
	}

	/**
	 * What differs inside a block that holds other blocks, with a restore button for each.
	 *
	 * Shows nothing when the inner blocks match. The summary line counts blocks
	 * that restoring the whole block would add, remove and change.
	 *
	 * @param {Object} props Block in the revision, block now (or null), and the restore callback.
	 * @return {Element|null} Collapsed panel.
	 */
	function InnerChanges( { old, cur, onRestore } ) {
		const entries = useMemo( () => ( cur && -1 === OWN_NOTHING_INSIDE.indexOf( old.name ) ? matching.diffTree( old, cur ) : [] ), [ old, cur ] );
		if ( ! entries.length ) {
			return null;
		}
		const counts = matching.summarizeDiff( entries );
		const labels = {
			added: __( 'Added', 'axle-block-restore' ),
			removed: __( 'Removed', 'axle-block-restore' ),
			changed: __( 'Changed', 'axle-block-restore' ),
		};

		return el(
			PanelBody,
			{
				className: 'abr-inner',
				initialOpen: false,
				title: sprintf(
					/* translators: 1: blocks inside that would be added, 2: removed, 3: changed. */
					__( 'Inside: %1$d added, %2$d removed, %3$d changed', 'axle-block-restore' ),
					counts.added,
					counts.removed,
					counts.changed
				),
			},
			el(
				'ul',
				{ className: 'abr-inner__list', 'aria-label': __( 'Differences inside this block', 'axle-block-restore' ) },
				entries.map( ( entry, index ) => {
					const shown = describe( 'removed' === entry.type ? entry.curBlock : entry.oldBlock );
					const before = 'changed' === entry.type ? describe( entry.curBlock ).text : null;

					return el(
						'li',
						{ key: index, className: 'abr-inner__item' },
						el(
							'div',
							{ className: 'abr-card__head' },
							el( 'strong', null, shown.title ),
							el( Tone, { tone: STATE_TONES[ entry.type ], state: 'inner-' + entry.type }, labels[ entry.type ] )
						),
						shown.text && el( 'p', { className: 'abr-card__excerpt' }, matching.excerpt( shown.text, '', 160 ) ),
						null !== before && before !== shown.text && el( DiffView, { before, after: shown.text } ),
						'removed' !== entry.type &&
							el(
								Button,
								{ variant: 'secondary', size: 'small', onClick: () => onRestore( entry ) },
								/* translators: %s: block type, e.g. "Paragraph". */
								sprintf( __( 'Restore this %s', 'axle-block-restore' ), shown.title )
							)
					);
				} )
			)
		);
	}

	/**
	 * One block from a revision: label, text, optional preview and diff, and actions.
	 *
	 * With `variants` (whole block, content only, styling only) the changes and
	 * the preview follow the one picked in the changes view.
	 *
	 * @param {Object} props Item, status, actions, text to diff against, variants, inner changes, search query, focus flag.
	 * @return {Element} Card.
	 */
	function BlockCard( { item, status, actions, compareText, variants, inner, query, focused } ) {
		const usable = ( variants || [] ).filter( ( variant ) => ! variant.same );
		const [ view, setView ] = useState( focused && null !== compareText ? 'diff' : null );
		const [ variantId, setVariantId ] = useState( null );
		const ref = useRef();
		const variant = usable.find( ( candidate ) => candidate.id === variantId ) || usable[ 0 ] || null;
		const previewBlocks = useMemo( () => [ variant ? variant.block : item.block ], [ item.block, variant ] );
		const shownText = variant ? variant.text : item.text;
		const canDiff = variant ? true : null !== compareText && undefined !== compareText && compareText !== item.text;
		const inside = matching.countBlocks( item.block ) - 1;

		useEffect( () => {
			if ( focused && ref.current ) {
				ref.current.scrollIntoView( { block: 'center' } );
			}
		}, [ focused ] );

		const toggle = ( name ) => setView( view === name ? null : name );

		return el(
			Card,
			{ className: 'abr-card' + ( focused ? ' is-focused' : '' ), size: 'small', ref },
			el(
				CardHeader,
				null,
				el( 'strong', null, item.title ),
				el(
					'span',
					{ className: 'abr-card__badges' },
					focused && el( Tone, { tone: 'info', state: 'found' }, __( 'Found by your search', 'axle-block-restore' ) ),
					status && el( Tone, { tone: STATE_TONES[ status.type ], state: status.type }, status.label )
				)
			),
			el(
				CardBody,
				null,
				item.text
					? el( 'p', { className: 'abr-card__excerpt' }, el( Highlight, { text: matching.excerpt( item.text, query, 240 ), query } ) )
					: el( 'p', { className: 'abr-card__excerpt is-empty' }, __( 'No text in this block.', 'axle-block-restore' ) ),
				inside > 0 &&
					el(
						'p',
						{ className: 'abr-card__meta' },
						sprintf(
							/* translators: %d: number of blocks inside this block. */
							_n( 'Holds %d inner block. Restoring it brings them all back in one step.', 'Holds %d inner blocks. Restoring it brings them all back in one step.', inside, 'axle-block-restore' ),
							inside
						)
					),
				inner,
				'diff' === view &&
					el(
						Fragment,
						null,
						usable.length > 1 &&
							el( SelectControl, {
								label: __( 'Show changes for', 'axle-block-restore' ),
								value: variant ? variant.id : '',
								options: usable.map( ( candidate ) => ( { value: candidate.id, label: candidate.name } ) ),
								onChange: setVariantId,
								__nextHasNoMarginBottom: true,
								__next40pxDefaultSize: true,
							} ),
						compareText !== shownText && el( DiffView, { before: compareText, after: shownText } ),
						variant && el( SettingChanges, { changes: variant.changes } ),
						variant && compareText === shownText && ! variant.changes.length && el( 'p', null, __( 'Nothing in this block would change.', 'axle-block-restore' ) )
					),
				'preview' === view && el( 'div', { className: 'abr-card__preview' }, el( BlockPreview, { blocks: previewBlocks, viewportWidth: 800 } ) ),
				el(
					'div',
					{ className: 'abr-card__actions' },
					actions,
					canDiff && el( Button, { variant: 'tertiary', isPressed: 'diff' === view, onClick: () => toggle( 'diff' ) }, __( 'Show changes', 'axle-block-restore' ) ),
					el( Button, { variant: 'tertiary', isPressed: 'preview' === view, onClick: () => toggle( 'preview' ) }, __( 'Preview', 'axle-block-restore' ) )
				)
			)
		);
	}

	/**
	 * The block as it would be after a restore in one of the three ways.
	 *
	 * @param {Object} target Block in the editor, described.
	 * @param {Object} item   Candidate in the revision, described.
	 * @param {string} mode   "replace", "content" or "style".
	 * @return {Object} Block to insert, its text, changed settings, and whether it equals the block now.
	 */
	function restoreVariant( target, item, mode ) {
		const roleFor = roleResolver( target.name );
		const merged = matching.mergeBlock( target.block, item.block, mode, roleFor );
		const block = 'replace' === mode ? item.block : createBlock( merged.name, merged.attributes, merged.innerBlocks.map( ( inner ) => cloneBlock( inner ) ) );
		const text = 'replace' === mode ? item.text : matching.textFromMarkup( serialize( [ block ] ) );
		const changes = matching.changedAttributes( target.block, block, roleFor ).filter( ( change ) => 'keep' !== change.role && ( 'style' === change.role || text === target.text ) );

		return {
			id: mode,
			block,
			text,
			changes,
			same: matching.signature( block ) === matching.signature( target.block ),
		};
	}

	/**
	 * Versions of the selected block in one revision, best match first.
	 *
	 * @param {Object} props Revision, target block, query, focus text and callbacks.
	 * @return {Element} List.
	 */
	function BlockVersions( { revision, target, query, focusText, onRestore, onInsertAfter, onRestoreInner } ) {
		const [ showSame, setShowSame ] = useState( false );
		const ranked = matching.rankCandidates( revision.all, target );
		const different = ranked.filter( ( item ) => ! item.same );
		const shown = ( showSame ? ranked : different ).slice( 0, MAX_CANDIDATES );
		const modes = useMemo( restoreModes, [] );
		const names = {
			replace: __( 'Whole block', 'axle-block-restore' ),
			content: __( 'Content only', 'axle-block-restore' ),
			style: __( 'Styling only', 'axle-block-restore' ),
		};
		// Building each way of restoring a block is the costly part, so it only repeats when the revision or the block changes.
		const rows = useMemo(
			() =>
				shown.map( ( item ) => {
					const variants = item.same ? [] : modes.map( ( mode ) => Object.assign( restoreVariant( target, item, mode ), { name: names[ mode ] } ) );
					const byMode = {};
					variants.forEach( ( variant ) => {
						byMode[ variant.id ] = variant;
					} );
					return { item, variants, byMode };
				} ),
			// eslint-disable-next-line react-hooks/exhaustive-deps
			[ revision, target.print, showSame, modes ]
		);

		if ( ! ranked.length ) {
			/* translators: %s: block type, e.g. "Paragraph". */
			return el( 'p', null, sprintf( __( 'This revision has no %s blocks.', 'axle-block-restore' ), target.title ) );
		}

		return el(
			Fragment,
			null,
			! different.length && el( Notice, { status: 'info', isDismissible: false }, __( 'This block is the same in this revision as it is now.', 'axle-block-restore' ) ),
			ranked.length !== different.length &&
				el( ToggleControl, {
					label: __( 'Also show versions that match the current block', 'axle-block-restore' ),
					checked: showSame,
					onChange: setShowSame,
					__nextHasNoMarginBottom: true,
				} ),
			rows.map( ( { item, variants, byMode }, index ) => {
				const notes = [];
				if ( byMode.content && byMode.content.same ) {
					notes.push( __( 'The content is the same as now.', 'axle-block-restore' ) );
				}
				if ( byMode.style && byMode.style.same ) {
					notes.push( __( 'The styling is the same as now.', 'axle-block-restore' ) );
				}

				return el( BlockCard, {
					key: item.path.join( '.' ),
					item,
					query,
					variants,
					focused: focusText === item.text,
					compareText: target.text,
					status: item.same
						? { type: 'same', label: __( 'Same as now', 'axle-block-restore' ) }
						: 0 === index && item.samePosition
						? { type: 'match', label: __( 'Best match', 'axle-block-restore' ) }
						: null,
					inner: el( InnerChanges, { old: item.block, cur: target.block, onRestore: ( entry ) => onRestoreInner( entry, target.block ) } ),
					actions: item.same
						? null
						: el(
								Fragment,
								null,
								el( Button, { variant: 'primary', onClick: () => onRestore( 'replace', item.block ) }, __( 'Replace current block', 'axle-block-restore' ) ),
								byMode.content &&
									el(
										Button,
										{ variant: 'secondary', disabled: byMode.content.same, onClick: () => onRestore( 'content', byMode.content.block ) },
										__( 'Restore content only', 'axle-block-restore' )
									),
								byMode.style &&
									el(
										Button,
										{ variant: 'secondary', disabled: byMode.style.same, onClick: () => onRestore( 'style', byMode.style.block ) },
										__( 'Restore styling only', 'axle-block-restore' )
									),
								el( Button, { variant: 'secondary', onClick: () => onInsertAfter( item.block ) }, __( 'Insert below it', 'axle-block-restore' ) ),
								notes.length > 0 && el( 'span', { className: 'abr-card__note' }, notes.join( ' ' ) )
						  ),
				} );
			} )
		);
	}

	/**
	 * A revision's top-level blocks compared with the entity now.
	 *
	 * @param {Object} props Revision, current blocks, query, focus text and callbacks.
	 * @return {Element} List.
	 */
	function RevisionBlocks( { revision, current, query, focusText, onReplaceAt, onInsertAt, onRestoreInner } ) {
		const [ showAll, setShowAll ] = useState( !! focusText );
		const statuses = matching.classify( revision.top, current );
		const items = revision.top.map( ( item, index ) => ( { item, index, status: statuses[ index ] } ) );
		const differing = items.filter( ( row ) => 'same' !== row.status );
		const shown = showAll ? items : differing;
		const labels = {
			same: __( 'Same as now', 'axle-block-restore' ),
			changed: __( 'Changed since', 'axle-block-restore' ),
			missing: __( 'Not in the post now', 'axle-block-restore' ),
		};

		return el(
			Fragment,
			null,
			el(
				'p',
				{ className: 'abr-summary' },
				sprintf(
					/* translators: 1: blocks in the revision, 2: how many differ from now. */
					_n( '%1$d block in this revision, %2$d different from now.', '%1$d blocks in this revision, %2$d different from now.', items.length, 'axle-block-restore' ),
					items.length,
					differing.length
				)
			),
			el( ToggleControl, {
				label: __( 'Show unchanged blocks too', 'axle-block-restore' ),
				checked: showAll,
				onChange: setShowAll,
				__nextHasNoMarginBottom: true,
			} ),
			! shown.length && el( Notice, { status: 'info', isDismissible: false }, __( 'Every block in this revision is the same as in the post now.', 'axle-block-restore' ) ),
			shown.map( ( row ) =>
				el( BlockCard, {
					key: row.index,
					item: row.item,
					query,
					focused: !! focusText && row.item.text.indexOf( focusText ) !== -1,
					compareText: 'changed' === row.status ? current[ row.index ].text : null,
					status: { type: row.status, label: labels[ row.status ] },
					inner:
						'changed' === row.status
							? el( InnerChanges, { old: row.item.block, cur: current[ row.index ].block, onRestore: ( entry ) => onRestoreInner( entry, current[ row.index ].block ) } )
							: null,
					actions:
						'same' === row.status
							? null
							: el(
									Fragment,
									null,
									'changed' === row.status &&
										el( Button, { variant: 'primary', onClick: () => onReplaceAt( row.item.block, row.index ) }, __( 'Replace current version', 'axle-block-restore' ) ),
									el(
										Button,
										{ variant: 'missing' === row.status ? 'primary' : 'secondary', onClick: () => onInsertAt( row.item.block, row.index ) },
										'missing' === row.status ? __( 'Restore it here', 'axle-block-restore' ) : __( 'Insert as a copy', 'axle-block-restore' )
									)
							  ),
				} )
			)
		);
	}

	/**
	 * Where a search query appears in old revisions.
	 *
	 * @param {Object} props Results, revision lookup, label maker, query and pick callback.
	 * @return {Element} Results list.
	 */
	function SearchResults( { results, revisionsById, labelFor, query, onPick } ) {
		if ( ! results.length ) {
			return el( Notice, { status: 'info', isDismissible: false }, __( 'No block in the loaded revisions contains that text.', 'axle-block-restore' ) );
		}

		return el(
			'ul',
			{ className: 'abr-results', 'aria-label': __( 'Search results', 'axle-block-restore' ) },
			results.map( ( result, index ) => {
				const newest = revisionsById[ result.revisionIds[ 0 ] ];
				const type = getBlockType( result.name );

				return el(
					'li',
					{ key: index, className: 'abr-result' },
					el(
						Card,
						{ size: 'small' },
						el(
							CardBody,
							null,
							el( 'p', { className: 'abr-result__text' }, el( Highlight, { text: matching.excerpt( result.text, query, 200 ), query } ) ),
							el(
								'p',
								{ className: 'abr-result__meta' },
								sprintf(
									/* translators: 1: block type, 2: number of revisions, 3: date of the newest one. */
									_n( '%1$s in %2$d revision, newest %3$s', '%1$s in %2$d revisions, newest %3$s', result.revisionIds.length, 'axle-block-restore' ),
									type ? type.title : result.name,
									result.revisionIds.length,
									labelFor( newest, true )
								)
							),
							el( Button, { variant: 'secondary', onClick: () => onPick( result ) }, __( 'Show in revision', 'axle-block-restore' ) )
						)
					)
				);
			} )
		);
	}

	/**
	 * The restore window: search, revision list, and the selected revision's blocks.
	 *
	 * @param {Object} props Selected block's client ID (or null for the whole entity), focusSearch and onClose.
	 * @return {Element} Modal.
	 */
	function RestoreModal( { clientId, focusSearch, onClose } ) {
		const data = useSelect(
			( select ) => {
				const blockEditor = select( 'core/block-editor' );
				const entity = resolveEntity( select, clientId );
				const postType = select( 'core' ).getPostType( entity.postType );
				let target = null;

				if ( clientId && blockEditor.getBlock( clientId ) ) {
					const parents = blockEditor.getBlockParents( clientId );
					const names = parents.map( ( id ) => blockEditor.getBlockName( id ) );
					// Paths count from the root of the entity the block belongs to: below its template part, if it is in one.
					const partAt = names.lastIndexOf( 'core/template-part' );
					const base = 'wp_template_part' === entity.postType && partAt !== -1 ? parents.slice( partAt + 1 ) : parents;
					target = Object.assign( describe( blockEditor.getBlock( clientId ) ), {
						path: base.concat( clientId ).map( ( id ) => blockEditor.getBlockIndex( id ) ),
						rootClientId: blockEditor.getBlockRootClientId( clientId ),
						index: blockEditor.getBlockIndex( clientId ),
					} );
				}

				// Blocks of the entity: inside the template part for a block that lives in one, else the whole editor.
				let blocks = blockEditor.getBlocks();
				if ( clientId && 'wp_template_part' === entity.postType && entity.postType !== select( 'core/editor' ).getCurrentPostType() ) {
					const holderId = blockEditor
						.getBlockParents( clientId, true )
						.find( ( id ) => 'core/template-part' === blockEditor.getBlockName( id ) );
					blocks = holderId ? blockEditor.getBlocks( holderId ) : blocks;
				}

				// Templates and parts have no post until they are saved once. Their record then has no `wp_id`.
				const isTemplate = 'wp_template' === entity.postType || 'wp_template_part' === entity.postType;
				const record = isTemplate ? select( 'core' ).getEntityRecord( 'postType', entity.postType, entity.id ) : null;

				return {
					post: {
						fromTheme: !! record && ! record.wp_id,
						postType: entity.postType,
						id: entity.id,
						restBase: postType ? postType.rest_base : null,
						restNamespace: postType && postType.rest_namespace ? postType.rest_namespace : 'wp/v2',
						noun: postType && postType.labels ? String( postType.labels.singular_name ).toLowerCase() : __( 'post', 'axle-block-restore' ),
					},
					target,
					blocks,
				};
			},
			[ clientId ]
		);

		const { replaceBlock, insertBlocks } = useDispatch( 'core/block-editor' );
		const { createSuccessNotice } = useDispatch( 'core/notices' );
		const { revisions, loading, error, none, hasMore, loadMore, retry } = useRevisions( data.post );
		const [ selectedId, setSelectedId ] = useState( null );
		const [ input, setInput ] = useState( '' );
		const [ query, setQuery ] = useState( '' );
		const rootRef = useRef();
		// Searching every revision on each keystroke lags on long posts, so wait for a pause in typing.
		useEffect( () => {
			const timer = setTimeout( () => setQuery( input ), 200 );
			return () => clearTimeout( timer );
		}, [ input ] );
		const [ focusText, setFocusText ] = useState( '' );

		useEffect( () => {
			/**
			 * Fires when the restore window opens.
			 *
			 * @param {Object}      details              What opened it.
			 * @param {string|null} details.clientId     Selected block, or null for the whole post, template or pattern.
			 * @param {string}      details.postType     Post type of what is being restored in.
			 * @param {number|string} details.postId     Its ID. Templates and template parts have IDs like "theme//slug".
			 * @param {boolean}     details.focusSearch  True when it opened on the search box.
			 */
			doAction( 'axleBlockRestore.opened', { clientId: clientId || null, postType: data.post.postType, postId: data.post.id, focusSearch: !! focusSearch } );
		}, [] ); // eslint-disable-line react-hooks/exhaustive-deps

		useEffect( () => {
			// The window moves focus to itself when it opens, so ask for the search box a moment later.
			const timer = setTimeout( () => {
				const field = focusSearch && rootRef.current ? rootRef.current.querySelector( 'input[type="search"]' ) : null;
				if ( field ) {
					field.focus();
				}
			}, 100 );
			return () => clearTimeout( timer );
		}, [] ); // eslint-disable-line react-hooks/exhaustive-deps

		const current = useMemo( () => data.blocks.map( describe ), [ data.blocks ] );
		const target = data.target;

		// Differences per revision, against the editor as it is now.
		const differences = useMemo( () => {
			const result = {};
			revisions.forEach( ( revision ) => {
				result[ revision.id ] = matching.classify( revision.top, current ).filter( ( status ) => 'same' !== status ).length + Math.max( 0, current.length - revision.top.length );
			} );
			return result;
		}, [ revisions, current ] );

		useEffect( () => {
			if ( null === selectedId && revisions.length ) {
				const firstDifferent = revisions.find( ( revision ) => differences[ revision.id ] > 0 );
				setSelectedId( ( firstDifferent || revisions[ 0 ] ).id );
			}
		}, [ revisions, differences, selectedId ] );

		const revisionsById = useMemo( () => {
			const map = {};
			revisions.forEach( ( revision ) => {
				map[ revision.id ] = revision;
			} );
			return map;
		}, [ revisions ] );

		const results = useMemo( () => {
			const found = matching.search(
				revisions.map( ( revision ) => ( { id: revision.id, items: revision.all } ) ),
				query
			);
			return target ? found.filter( ( result ) => result.name === target.name ) : found;
		}, [ revisions, query, target ] );

		const dateFormat = getDateSettings().formats.datetime;
		const labelFor = ( revision, short ) => {
			if ( ! revision ) {
				return '';
			}
			const parts = [ dateI18n( dateFormat, revision.when ) ];
			if ( ! short && revision.axle_block_restore_author ) {
				parts.push( revision.axle_block_restore_author );
			}
			return parts.join( ' · ' );
		};

		const selected = revisionsById[ selectedId ];
		const restored = __( 'Block restored. Save to keep it, or press Ctrl+Z (⌘Z) to undo.', 'axle-block-restore' );
		const done = ( mode, block ) => {
			createSuccessNotice( restored, { type: 'snackbar' } );

			/**
			 * Fires after a block is restored from a revision.
			 *
			 * @param {Object} details            What happened.
			 * @param {string} details.mode       replace, content, style, insert-after, replace-at, insert-at, inner-replace or inner-insert.
			 * @param {Object} details.block      The restored block, as inserted.
			 * @param {number} details.revisionId Revision it came from.
			 * @param {number|string} details.postId Post, template, template part or pattern being edited.
			 * @param {string} details.postType   Its post type.
			 */
			doAction( 'axleBlockRestore.restored', { mode, block, revisionId: selectedId, postId: data.post.id, postType: data.post.postType } );
			onClose();
		};

		// Restores a block from inside another one: replaces its counterpart, or inserts it into the block that holds it.
		const restoreInner = ( entry, root ) => {
			const copy = cloneBlock( entry.oldBlock );
			if ( 'changed' === entry.type ) {
				const counterpart = matching.blockAt( root, entry.curPath );
				if ( counterpart ) {
					replaceBlock( counterpart.clientId, copy );
					done( 'inner-replace', copy );
				}
				return;
			}
			const parent = matching.blockAt( root, entry.parentPath );
			if ( parent ) {
				insertBlocks( [ copy ], Math.min( entry.index, parent.innerBlocks.length ), parent.clientId );
				done( 'inner-insert', copy );
			}
		};

		// Arrow keys, Home and End move both the selection and the focus (roving tabindex).
		const moveSelection = ( event ) => {
			const index = revisions.findIndex( ( revision ) => revision.id === selectedId );
			const targets = {
				ArrowDown: index + 1,
				ArrowUp: index - 1,
				Home: 0,
				End: revisions.length - 1,
			};
			if ( ! ( event.key in targets ) ) {
				return;
			}
			event.preventDefault();
			const next = revisions[ targets[ event.key ] ];
			if ( next ) {
				setSelectedId( next.id );
				setFocusText( '' );
				window.requestAnimationFrame( () => {
					const option = document.getElementById( 'abr-revision-' + next.id );
					if ( option ) {
						option.focus();
					}
				} );
			}
		};

		let body;
		if ( error ) {
			body = el( Notice, { status: 'error', isDismissible: false, actions: [ { label: __( 'Try again', 'axle-block-restore' ), onClick: retry } ] }, error );
		} else if ( none ) {
			body = el(
				Notice,
				{ status: 'info', isDismissible: false },
				/* translators: %s: what is being edited, e.g. "template". */
				sprintf( __( 'This %s still comes from the theme, so it has no revisions. Change it and save, and come back to restore from that save.', 'axle-block-restore' ), data.post.noun )
			);
		} else if ( ! loading && ! revisions.length ) {
			body = el(
				Notice,
				{ status: 'info', isDismissible: false },
				/* translators: %s: what is being edited, e.g. "post". */
				sprintf( __( 'This %s has no revisions yet. WordPress saves one each time it is updated.', 'axle-block-restore' ), data.post.noun )
			);
		} else if ( ! selected ) {
			body = el( 'p', { className: 'abr-loading' }, el( Spinner ), ' ', __( 'Loading revisions…', 'axle-block-restore' ) );
		} else if ( target ) {
			body = el( BlockVersions, {
				key: selected.id,
				revision: selected,
				target,
				query: focusText,
				focusText,
				onRestore: ( mode, block ) => {
					const copy = cloneBlock( block );
					replaceBlock( clientId, copy );
					done( mode, copy );
				},
				onInsertAfter: ( block ) => {
					const copy = cloneBlock( block );
					insertBlocks( [ copy ], target.index + 1, target.rootClientId );
					done( 'insert-after', copy );
				},
				onRestoreInner: restoreInner,
			} );
		} else {
			body = el( RevisionBlocks, {
				key: selected.id + ':' + focusText,
				revision: selected,
				current,
				query: focusText,
				focusText,
				onReplaceAt: ( block, index ) => {
					const copy = cloneBlock( block );
					replaceBlock( data.blocks[ index ].clientId, copy );
					done( 'replace-at', copy );
				},
				onInsertAt: ( block, index ) => {
					const copy = cloneBlock( block );
					insertBlocks( [ copy ], Math.min( index, data.blocks.length ) );
					done( 'insert-at', copy );
				},
				onRestoreInner: restoreInner,
			} );
		}

		const searching = query.trim().length >= 2;

		return el(
			Modal,
			{
				title: target
					/* translators: %s: block type, e.g. "Paragraph". */
					? sprintf( __( 'Restore this %s from a revision', 'axle-block-restore' ), target.title )
					: __( 'Restore blocks from a revision', 'axle-block-restore' ),
				onRequestClose: onClose,
				size: 'large',
				className: 'abr-modal',
			},
			el(
				'div',
				{ className: 'abr-search', ref: rootRef },
				el( SearchControl, {
					label: __( 'Find text in old revisions', 'axle-block-restore' ),
					placeholder: target
						? __( 'Find an old version of this block by its text…', 'axle-block-restore' )
						: __( 'Find deleted or changed text…', 'axle-block-restore' ),
					value: input,
					onChange: setInput,
					__nextHasNoMarginBottom: true,
					__next40pxDefaultSize: true,
				} )
			),
			searching
				? el( SearchResults, {
						results,
						revisionsById,
						labelFor,
						query,
						onPick: ( result ) => {
							setSelectedId( result.revisionIds[ 0 ] );
							setFocusText( result.text );
							setInput( '' );
							setQuery( '' );
						},
				  } )
				: el(
						'div',
						{ className: 'abr-layout' },
						el(
							'div',
							{
								className: 'abr-revisions',
								role: 'listbox',
								'aria-label': __( 'Revisions', 'axle-block-restore' ),
								onKeyDown: moveSelection,
							},
							revisions.map( ( revision ) => {
								const isAutosave = revision.slug && revision.slug.indexOf( '-autosave-' ) !== -1;
								const count = differences[ revision.id ];

								return el(
									Button,
									{
										key: revision.id,
										id: 'abr-revision-' + revision.id,
										role: 'option',
										'aria-selected': revision.id === selectedId,
										// Only the selected option is in the tab order; the arrow keys reach the rest.
										tabIndex: revision.id === selectedId ? 0 : -1,
										// Core's pressed look, as a class: aria-pressed is not allowed on an option.
										className: 'abr-revision' + ( revision.id === selectedId ? ' is-selected is-pressed' : '' ),
										onClick: () => {
											setSelectedId( revision.id );
											setFocusText( '' );
										},
									},
									el( 'span', { className: 'abr-revision__date' }, labelFor( revision ) ),
									el(
										'span',
										{ className: 'abr-revision__meta' },
										isAutosave && el( 'span', { className: 'abr-tag' }, __( 'Autosave', 'axle-block-restore' ) ),
										count
											/* translators: %d: number of differences. */
											? sprintf( _n( '%d difference', '%d differences', count, 'axle-block-restore' ), count )
											: __( 'Same as now', 'axle-block-restore' )
									)
								);
							} ),
							loading && el( 'p', { className: 'abr-loading' }, el( Spinner ), ' ', __( 'Loading revisions…', 'axle-block-restore' ) ),
							hasMore && ! loading && el( Button, { variant: 'link', onClick: loadMore }, __( 'Load older revisions', 'axle-block-restore' ) )
						),
						el( 'div', { className: 'abr-blocks' }, body )
				  )
		);
	}

	window.axleBlockRestore = window.axleBlockRestore || {};
	window.axleBlockRestore.RestoreModal = RestoreModal;
	window.axleBlockRestore.resolveEntity = resolveEntity;
	window.axleBlockRestore.isSupported = isSupported;
} )( window.wp, window.axleBlockRestore.matching );
