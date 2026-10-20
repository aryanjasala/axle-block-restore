/**
 * Restore Blocks from Revisions: the restore window and its parts.
 *
 * Exposes window.restoreBlocksFromRevisions.RestoreModal. Matching logic lives in
 * matching.js so it can be unit tested without WordPress.
 */
( function ( wp, matching ) {
	'use strict';

	const el = wp.element.createElement;
	const { Fragment, useState, useEffect, useMemo, useRef } = wp.element;
	const { __, sprintf, _n } = wp.i18n;
	const { BlockPreview } = wp.blockEditor;
	const { Modal, Button, Spinner, Notice, ToggleControl, SearchControl } = wp.components;
	const { useSelect, useDispatch } = wp.data;
	const { parse, serialize, cloneBlock, getBlockType } = wp.blocks;
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
		return Math.min( 100, Math.max( 1, parseInt( applyFilters( 'restoreBlocksFromRevisions.revisionsPerPage', 50 ), 10 ) || 50 ) );
	}
	const MAX_CANDIDATES = 6;

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
	 * @param {Object} revision Revision from the REST API.
	 * @return {Object} Revision with `top` and `all` block lists.
	 */
	function prepare( revision ) {
		const blocks = parse( ( revision.content && revision.content.raw ) || '' );

		return Object.assign( {}, revision, {
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
	 * @param {Object} post Post ID, REST base and namespace.
	 * @return {Object} Revisions, loading flag, error, and loadMore().
	 */
	function useRevisions( post ) {
		const PER_PAGE = useMemo( perPage, [] );
		const [ revisions, setRevisions ] = useState( [] );
		const [ page, setPage ] = useState( 1 );
		const [ hasMore, setHasMore ] = useState( false );
		const [ loading, setLoading ] = useState( true );
		const [ error, setError ] = useState( null );

		useEffect( () => {
			if ( ! post.restBase || ! post.id ) {
				return;
			}
			setLoading( true );
			wp.apiFetch( {
				path: addQueryArgs( `/${ post.restNamespace }/${ post.restBase }/${ post.id }/revisions`, {
					context: 'edit',
					per_page: PER_PAGE,
					page,
					_fields: 'id,date_gmt,slug,content.raw,restore_blocks_from_revisions_author',
				} ),
			} )
				.then( ( items ) => {
					// A revision saved while the window is open shifts the pages, so skip ones already listed.
					setRevisions( ( previous ) => {
						const seen = new Set( previous.map( ( revision ) => revision.id ) );
						return previous.concat( items.filter( ( item ) => ! seen.has( item.id ) ).map( prepare ) );
					} );
					setHasMore( items.length === PER_PAGE );
				} )
				.catch( ( fetchError ) => setError( fetchError.message || __( 'Could not load revisions.', 'restore-blocks-from-revisions' ) ) )
				.finally( () => setLoading( false ) );
		}, [ post.id, post.restBase, post.restNamespace, page ] );

		return { revisions, loading, error, hasMore, loadMore: () => setPage( page + 1 ) };
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
			{ className: 'rbr-diff', 'aria-label': __( 'Changes this restore would make', 'restore-blocks-from-revisions' ) },
			matching.wordDiff( before, after ).map( ( part, index ) => {
				if ( 'same' === part.type ) {
					return part.text;
				}
				return el( 'added' === part.type ? 'ins' : 'del', { key: index }, part.text );
			} )
		);
	}

	/**
	 * One block from a revision: label, text, optional preview and diff, and actions.
	 *
	 * @param {Object} props Item, status badge, actions, text to diff against, search query, focus flag.
	 * @return {Element} Card.
	 */
	function BlockCard( { item, status, actions, compareText, query, focused } ) {
		const [ view, setView ] = useState( focused && null !== compareText ? 'diff' : null );
		const ref = useRef();
		const previewBlocks = useMemo( () => [ item.block ], [ item.block ] );
		const canDiff = null !== compareText && undefined !== compareText && compareText !== item.text;

		useEffect( () => {
			if ( focused && ref.current ) {
				ref.current.scrollIntoView( { block: 'center' } );
			}
		}, [ focused ] );

		const toggle = ( name ) => setView( view === name ? null : name );

		return el(
			'div',
			{ className: 'rbr-card' + ( focused ? ' is-focused' : '' ), ref },
			el(
				'div',
				{ className: 'rbr-card__head' },
				el( 'strong', null, item.title ),
				status && el( 'span', { className: 'rbr-badge rbr-badge--' + status.type }, status.label )
			),
			item.text
				? el( 'p', { className: 'rbr-card__excerpt' }, el( Highlight, { text: matching.excerpt( item.text, query, 240 ), query } ) )
				: el( 'p', { className: 'rbr-card__excerpt is-empty' }, __( 'No text in this block.', 'restore-blocks-from-revisions' ) ),
			'diff' === view && el( DiffView, { before: compareText, after: item.text } ),
			'preview' === view && el( 'div', { className: 'rbr-card__preview' }, el( BlockPreview, { blocks: previewBlocks, viewportWidth: 800 } ) ),
			el(
				'div',
				{ className: 'rbr-card__actions' },
				actions,
				canDiff && el( Button, { variant: 'tertiary', isPressed: 'diff' === view, onClick: () => toggle( 'diff' ) }, __( 'Show changes', 'restore-blocks-from-revisions' ) ),
				el( Button, { variant: 'tertiary', isPressed: 'preview' === view, onClick: () => toggle( 'preview' ) }, __( 'Preview', 'restore-blocks-from-revisions' ) )
			)
		);
	}

	/**
	 * Versions of the selected block in one revision, best match first.
	 *
	 * @param {Object} props Revision, target block, query, focus text and callbacks.
	 * @return {Element} List.
	 */
	function BlockVersions( { revision, target, query, focusText, onReplace, onInsertAfter } ) {
		const [ showSame, setShowSame ] = useState( false );
		const ranked = matching.rankCandidates( revision.all, target );
		const different = ranked.filter( ( item ) => ! item.same );
		const shown = ( showSame ? ranked : different ).slice( 0, MAX_CANDIDATES );

		if ( ! ranked.length ) {
			/* translators: %s: block type, e.g. "Paragraph". */
			return el( 'p', null, sprintf( __( 'This revision has no %s blocks.', 'restore-blocks-from-revisions' ), target.title ) );
		}

		return el(
			Fragment,
			null,
			! different.length && el( Notice, { status: 'info', isDismissible: false }, __( 'This block is the same in this revision as it is now.', 'restore-blocks-from-revisions' ) ),
			ranked.length !== different.length &&
				el( ToggleControl, {
					label: __( 'Also show versions that match the current block', 'restore-blocks-from-revisions' ),
					checked: showSame,
					onChange: setShowSame,
					__nextHasNoMarginBottom: true,
				} ),
			shown.map( ( item, index ) =>
				el( BlockCard, {
					key: item.path.join( '.' ),
					item,
					query,
					focused: focusText === item.text,
					compareText: target.text,
					status: item.same
						? { type: 'same', label: __( 'Same as now', 'restore-blocks-from-revisions' ) }
						: 0 === index && item.samePosition
						? { type: 'match', label: __( 'Best match', 'restore-blocks-from-revisions' ) }
						: null,
					actions: item.same
						? null
						: el(
								Fragment,
								null,
								el( Button, { variant: 'primary', onClick: () => onReplace( item.block ) }, __( 'Replace current block', 'restore-blocks-from-revisions' ) ),
								el( Button, { variant: 'secondary', onClick: () => onInsertAfter( item.block ) }, __( 'Insert below it', 'restore-blocks-from-revisions' ) )
						  ),
				} )
			)
		);
	}

	/**
	 * A revision's top-level blocks compared with the post now.
	 *
	 * @param {Object} props Revision, current blocks, query, focus text and callbacks.
	 * @return {Element} List.
	 */
	function RevisionBlocks( { revision, current, query, focusText, onReplaceAt, onInsertAt } ) {
		const [ showAll, setShowAll ] = useState( !! focusText );
		const statuses = matching.classify( revision.top, current );
		const items = revision.top.map( ( item, index ) => ( { item, index, status: statuses[ index ] } ) );
		const differing = items.filter( ( row ) => 'same' !== row.status );
		const shown = showAll ? items : differing;
		const labels = {
			same: __( 'Same as now', 'restore-blocks-from-revisions' ),
			changed: __( 'Changed since', 'restore-blocks-from-revisions' ),
			missing: __( 'Not in the post now', 'restore-blocks-from-revisions' ),
		};

		return el(
			Fragment,
			null,
			el(
				'p',
				{ className: 'rbr-summary' },
				sprintf(
					/* translators: 1: blocks in the revision, 2: how many differ from now. */
					_n( '%1$d block in this revision, %2$d different from now.', '%1$d blocks in this revision, %2$d different from now.', items.length, 'restore-blocks-from-revisions' ),
					items.length,
					differing.length
				)
			),
			el( ToggleControl, {
				label: __( 'Show unchanged blocks too', 'restore-blocks-from-revisions' ),
				checked: showAll,
				onChange: setShowAll,
				__nextHasNoMarginBottom: true,
			} ),
			! shown.length && el( Notice, { status: 'info', isDismissible: false }, __( 'Every block in this revision is the same as in the post now.', 'restore-blocks-from-revisions' ) ),
			shown.map( ( row ) =>
				el( BlockCard, {
					key: row.index,
					item: row.item,
					query,
					focused: !! focusText && row.item.text.indexOf( focusText ) !== -1,
					compareText: 'changed' === row.status ? current[ row.index ].text : null,
					status: { type: row.status, label: labels[ row.status ] },
					actions:
						'same' === row.status
							? null
							: el(
									Fragment,
									null,
									'changed' === row.status &&
										el( Button, { variant: 'primary', onClick: () => onReplaceAt( row.item.block, row.index ) }, __( 'Replace current version', 'restore-blocks-from-revisions' ) ),
									el(
										Button,
										{ variant: 'missing' === row.status ? 'primary' : 'secondary', onClick: () => onInsertAt( row.item.block, row.index ) },
										'missing' === row.status ? __( 'Restore it here', 'restore-blocks-from-revisions' ) : __( 'Insert as a copy', 'restore-blocks-from-revisions' )
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
			return el( 'p', { className: 'rbr-search-empty' }, __( 'No block in the loaded revisions contains that text.', 'restore-blocks-from-revisions' ) );
		}

		return el(
			'ul',
			{ className: 'rbr-results', 'aria-label': __( 'Search results', 'restore-blocks-from-revisions' ) },
			results.map( ( result, index ) => {
				const newest = revisionsById[ result.revisionIds[ 0 ] ];
				const type = getBlockType( result.name );

				return el(
					'li',
					{ key: index, className: 'rbr-result' },
					el( 'p', { className: 'rbr-result__text' }, el( Highlight, { text: matching.excerpt( result.text, query, 200 ), query } ) ),
					el(
						'p',
						{ className: 'rbr-result__meta' },
						sprintf(
							/* translators: 1: block type, 2: number of revisions, 3: date of the newest one. */
							_n( '%1$s in %2$d revision, newest %3$s', '%1$s in %2$d revisions, newest %3$s', result.revisionIds.length, 'restore-blocks-from-revisions' ),
							type ? type.title : result.name,
							result.revisionIds.length,
							labelFor( newest, true )
						)
					),
					el( Button, { variant: 'secondary', onClick: () => onPick( result ) }, __( 'Show in revision', 'restore-blocks-from-revisions' ) )
				);
			} )
		);
	}

	/**
	 * The restore window: search, revision list, and the selected revision's blocks.
	 *
	 * @param {Object} props Selected block's client ID (or null for the whole post) and onClose.
	 * @return {Element} Modal.
	 */
	function RestoreModal( { clientId, onClose } ) {
		const data = useSelect(
			( select ) => {
				const editor = select( 'core/editor' );
				const blockEditor = select( 'core/block-editor' );
				const postType = select( 'core' ).getPostType( editor.getCurrentPostType() );
				let target = null;

				if ( clientId && blockEditor.getBlock( clientId ) ) {
					const parents = blockEditor.getBlockParents( clientId );
					target = Object.assign( describe( blockEditor.getBlock( clientId ) ), {
						path: parents.concat( clientId ).map( ( id ) => blockEditor.getBlockIndex( id ) ),
						rootClientId: blockEditor.getBlockRootClientId( clientId ),
						index: blockEditor.getBlockIndex( clientId ),
					} );
				}

				return {
					post: {
						id: editor.getCurrentPostId(),
						restBase: postType ? postType.rest_base : null,
						restNamespace: postType && postType.rest_namespace ? postType.rest_namespace : 'wp/v2',
					},
					target,
					blocks: blockEditor.getBlocks(),
				};
			},
			[ clientId ]
		);

		const { replaceBlock, insertBlocks } = useDispatch( 'core/block-editor' );
		const { createSuccessNotice } = useDispatch( 'core/notices' );
		const { revisions, loading, error, hasMore, loadMore } = useRevisions( data.post );
		const [ selectedId, setSelectedId ] = useState( null );
		const [ input, setInput ] = useState( '' );
		const [ query, setQuery ] = useState( '' );
		// Searching every revision on each keystroke lags on long posts, so wait for a pause in typing.
		useEffect( () => {
			const timer = setTimeout( () => setQuery( input ), 200 );
			return () => clearTimeout( timer );
		}, [ input ] );
		const [ focusText, setFocusText ] = useState( '' );

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
			// date_gmt has no zone marker; adding "Z" makes it UTC, and dateI18n shows it in the site's time zone.
			const parts = [ dateI18n( dateFormat, revision.date_gmt + 'Z' ) ];
			if ( ! short && revision.restore_blocks_from_revisions_author ) {
				parts.push( revision.restore_blocks_from_revisions_author );
			}
			return parts.join( ' · ' );
		};

		const selected = revisionsById[ selectedId ];
		const restored = __( 'Block restored. Save the post to keep it, or press Ctrl+Z (⌘Z) to undo.', 'restore-blocks-from-revisions' );
		const done = ( mode, block ) => {
			createSuccessNotice( restored, { type: 'snackbar' } );

			/**
			 * Fires after a block is restored from a revision.
			 *
			 * @param {Object} details            What happened.
			 * @param {string} details.mode       replace, insert-after, replace-at or insert-at.
			 * @param {Object} details.block      The restored block, as inserted.
			 * @param {number} details.revisionId Revision it came from.
			 * @param {number} details.postId     Post being edited.
			 */
			doAction( 'restoreBlocksFromRevisions.restored', { mode, block, revisionId: selectedId, postId: data.post.id } );
			onClose();
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
					const option = document.getElementById( 'rbr-revision-' + next.id );
					if ( option ) {
						option.focus();
					}
				} );
			}
		};

		let body;
		if ( error ) {
			body = el( Notice, { status: 'error', isDismissible: false }, error );
		} else if ( ! loading && ! revisions.length ) {
			body = el( 'p', null, __( 'This post has no revisions yet. WordPress saves one each time the post is updated.', 'restore-blocks-from-revisions' ) );
		} else if ( ! selected ) {
			body = el( Spinner );
		} else if ( target ) {
			body = el( BlockVersions, {
				key: selected.id,
				revision: selected,
				target,
				query: focusText,
				focusText,
				onReplace: ( block ) => {
					const copy = cloneBlock( block );
					replaceBlock( clientId, copy );
					done( 'replace', copy );
				},
				onInsertAfter: ( block ) => {
					const copy = cloneBlock( block );
					insertBlocks( [ copy ], target.index + 1, target.rootClientId );
					done( 'insert-after', copy );
				},
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
			} );
		}

		const searching = query.trim().length >= 2;

		return el(
			Modal,
			{
				title: target
					/* translators: %s: block type, e.g. "Paragraph". */
					? sprintf( __( 'Restore this %s from a revision', 'restore-blocks-from-revisions' ), target.title )
					: __( 'Restore blocks from a revision', 'restore-blocks-from-revisions' ),
				onRequestClose: onClose,
				size: 'large',
				className: 'rbr-modal',
			},
			el(
				'div',
				{ className: 'rbr-search' },
				el( SearchControl, {
					label: __( 'Find text in old revisions', 'restore-blocks-from-revisions' ),
					placeholder: target
						? __( 'Find an old version of this block by its text…', 'restore-blocks-from-revisions' )
						: __( 'Find deleted or changed text…', 'restore-blocks-from-revisions' ),
					value: input,
					onChange: setInput,
					__nextHasNoMarginBottom: true,
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
						{ className: 'rbr-layout' },
						el(
							'div',
							{
								className: 'rbr-revisions',
								role: 'listbox',
								'aria-label': __( 'Revisions', 'restore-blocks-from-revisions' ),
								onKeyDown: moveSelection,
							},
							revisions.map( ( revision ) => {
								const isAutosave = revision.slug && revision.slug.indexOf( '-autosave-' ) !== -1;
								const count = differences[ revision.id ];

								return el(
									Button,
									{
										key: revision.id,
										id: 'rbr-revision-' + revision.id,
										role: 'option',
										'aria-selected': revision.id === selectedId,
										// Only the selected option is in the tab order; the arrow keys reach the rest.
										tabIndex: revision.id === selectedId ? 0 : -1,
										className: 'rbr-revision' + ( revision.id === selectedId ? ' is-selected' : '' ),
										onClick: () => {
											setSelectedId( revision.id );
											setFocusText( '' );
										},
									},
									el( 'span', { className: 'rbr-revision__date' }, labelFor( revision ) ),
									el(
										'span',
										{ className: 'rbr-revision__meta' },
										isAutosave && el( 'span', { className: 'rbr-tag' }, __( 'Autosave', 'restore-blocks-from-revisions' ) ),
										count
											/* translators: %d: number of differences. */
											? sprintf( _n( '%d difference', '%d differences', count, 'restore-blocks-from-revisions' ), count )
											: __( 'Same as now', 'restore-blocks-from-revisions' )
									)
								);
							} ),
							loading && el( Spinner ),
							hasMore && ! loading && el( Button, { variant: 'link', onClick: loadMore }, __( 'Load older revisions', 'restore-blocks-from-revisions' ) )
						),
						el( 'div', { className: 'rbr-blocks' }, body )
				  )
		);
	}

	window.restoreBlocksFromRevisions = window.restoreBlocksFromRevisions || {};
	window.restoreBlocksFromRevisions.RestoreModal = RestoreModal;
} )( window.wp, window.restoreBlocksFromRevisions.matching );
