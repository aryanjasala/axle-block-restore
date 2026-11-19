/**
 * Axle Block Restore: adds "Restore from a revision…" to each block's menu,
 * "Block history" to the same menu, "Restore blocks from a revision" to the
 * editor's main menu, and five commands to the command palette. Works in the post editor and the Site Editor.
 */
( function ( wp, restore ) {
	'use strict';

	// Read now: the editor rewrites the address once it starts, and drops any parameter it does not know.
	const addressAtLoad = window.location.search;
	const el = wp.element.createElement;
	const { Fragment, useState, useCallback, useMemo, useEffect } = wp.element;
	const { __ } = wp.i18n;
	const { registerPlugin } = wp.plugins;
	const { BlockSettingsMenuControls } = wp.blockEditor;
	const { MenuItem, Dashicon } = wp.components;
	const { select, useSelect } = wp.data;
	const { applyFilters } = wp.hooks;
	const PluginMoreMenuItem = ( wp.editor && wp.editor.PluginMoreMenuItem ) || ( wp.editPost && wp.editPost.PluginMoreMenuItem );
	// The command palette arrived in WordPress 6.3. Without it only the menu entries exist.
	const commands = wp.commands && wp.commands.useCommandLoader ? wp.commands : null;

	/**
	 * A Dashicon as an element, which is what the command palette draws.
	 *
	 * @param {string} name Dashicon name.
	 * @return {Element|undefined} Icon, or nothing where Dashicon is gone.
	 */
	function icon( name ) {
		return Dashicon ? el( Dashicon, { icon: name } ) : undefined;
	}

	/**
	 * Whether a block's menu and the command palette offer a restore for a block.
	 *
	 * @param {Function} reader Data registry select.
	 * @param {string}   id     Block client ID.
	 * @return {boolean} True when the block's template, part, pattern or post has revisions to restore from.
	 */
	function canRestoreBlock( reader, id ) {
		if ( ! restore.isSupported( restore.resolveEntity( reader, id ) ) ) {
			return false;
		}

		/**
		 * Filters whether a block offers "Restore from a revision…" in its menu.
		 *
		 * @param {boolean} canRestore Default true.
		 * @param {Object}  block      The selected block.
		 */
		return !! applyFilters( 'axleBlockRestore.canRestore', true, reader( 'core/block-editor' ).getBlock( id ) );
	}

	/**
	 * The command palette entries, for the loader. Reads the selection each time the palette opens.
	 *
	 * @param {Function} open Opens the restore window with { clientId, focusSearch }.
	 * @return {Function} A hook returning { commands, isLoading }.
	 */
	function commandsHook( open ) {
		return function useRestoreCommands() {
			const state = useSelect( ( reader ) => {
				const ids = reader( 'core/block-editor' ).getSelectedBlockClientIds();
				return {
					here: restore.isSupported( restore.resolveEntity( reader, null ) ),
					blockId: 1 === ids.length && canRestoreBlock( reader, ids[ 0 ] ) ? ids[ 0 ] : null,
				};
			}, [] );

			// The palette reads the list on every render, so it only changes when the selection does.
			const entries = useMemo( () => {
				const list = [];
				if ( state.here ) {
					list.push(
						{
							name: 'axle-block-restore/open',
							label: __( 'Restore blocks from a revision', 'axle-block-restore' ),
							icon: icon( 'backup' ),
							callback: ( { close } ) => {
								close();
								open( { clientId: null } );
							},
						},
						{
							name: 'axle-block-restore/search',
							label: __( 'Find text in old revisions', 'axle-block-restore' ),
							icon: icon( 'search' ),
							callback: ( { close } ) => {
								close();
								open( { clientId: null, focusSearch: true } );
							},
						},
						{
							name: 'axle-block-restore/removed',
							label: __( 'Show removed blocks', 'axle-block-restore' ),
							icon: icon( 'trash' ),
							callback: ( { close } ) => {
								close();
								open( { clientId: null, view: 'removed' } );
							},
						}
					);
				}
				// Only while a block is selected.
				if ( state.blockId ) {
					list.push( {
						name: 'axle-block-restore/open-selected',
						label: __( 'Restore selected block from a revision', 'axle-block-restore' ),
						icon: icon( 'backup' ),
						callback: ( { close } ) => {
							close();
							open( { clientId: state.blockId } );
						},
					},
					{
						name: 'axle-block-restore/history-selected',
						label: __( 'Show history of selected block', 'axle-block-restore' ),
						icon: icon( 'clock' ),
						callback: ( { close } ) => {
							close();
							open( { clientId: state.blockId, view: 'history' } );
						},
					} );
				}

				/**
				 * Filters the command palette entries Axle Block Restore adds.
				 *
				 * Each entry is a command for `wp.commands`: name, label, icon and callback.
				 *
				 * @param {Object[]}    entries  Default: restore blocks, find text, show removed blocks, and (with a block selected) restore the selected block and show its history.
				 * @param {string|null} blockId  Client ID of the selected block, or null.
				 */
				return applyFilters( 'axleBlockRestore.commands', list, state.blockId );
			}, [ state.here, state.blockId ] );

			return { commands: entries, isLoading: false };
		};
	}

	/**
	 * Opens the window from a history link once the editor has its blocks.
	 *
	 * The link is `post.php?post=12&action=edit&axle-block-restore=history&revision=345&path=2`. See
	 * matching.parseDeepLink() for every parameter. The editor drops the parameters from the address
	 * bar itself when it starts, so reloading does not open the window again.
	 *
	 * @param {Function} setOpen Opens the window with { clientId, view, link }.
	 */
	function useDeepLink( setOpen ) {
		useEffect( () => {
			const link = restore.matching.parseDeepLink( addressAtLoad );
			if ( ! link ) {
				return undefined;
			}

			/**
			 * Filters whether a history link opens the restore window.
			 *
			 * @param {boolean} enabled Default true.
			 * @param {Object}  link    What the link names: revision, path, anchor and clientId.
			 */
			if ( ! applyFilters( 'axleBlockRestore.deepLinkEnabled', true, link ) ) {
				return undefined;
			}

			let finished = false;
			let unsubscribe = () => undefined;
			const timeout = window.setTimeout( () => {
				finished = true;
				unsubscribe();
			}, 30000 );

			const ready = () => {
				const editor = select( 'core/editor' );
				const entity = restore.resolveEntity( select, null );
				return !! editor.getCurrentPostId() && restore.isSupported( entity ) && ( select( 'core/block-editor' ).getBlockCount() > 0 || '' === editor.getEditedPostContent() );
			};

			const go = () => {
				if ( finished || ! ready() ) {
					return;
				}
				finished = true;
				unsubscribe();
				window.clearTimeout( timeout );

				restore.resolveDeepLink( link ).then( ( target ) => {
					if ( target.clientId ) {
						wp.data.dispatch( 'core/block-editor' ).selectBlock( target.clientId );
					}

					/**
					 * Fires when a history link opens the restore window.
					 *
					 * @param {Object}      details          What was opened.
					 * @param {string|null} details.clientId Block the link was matched to in the post now, or null.
					 * @param {number}      details.revision Revision the link names, or 0.
					 * @param {boolean}     details.missing  True when the link named a block that is not in the post any more.
					 */
					wp.hooks.doAction( 'axleBlockRestore.deepLinkOpened', { clientId: target.clientId, revision: target.revision, missing: target.missing } );
					// The plugin's component can be mounted again while the editor settles, so the request is kept outside it too.
					restore.pendingOpen = { clientId: target.clientId, view: target.clientId ? 'history' : 'revisions', link: target };
					setOpen( restore.pendingOpen );
				} );
			};

			unsubscribe = wp.data.subscribe( go );
			go();

			return () => {
				finished = true;
				unsubscribe();
				window.clearTimeout( timeout );
			};
		}, [] );
	}

	function BlockRestore() {
		const [ open, setOpen ] = useState( () => restore.pendingOpen || null );
		useDeepLink( setOpen );
		const here = useSelect( ( reader ) => restore.isSupported( restore.resolveEntity( reader, null ) ), [] );

		// One hook for the palette's lifetime: a new one on every render would register again each time.
		const hook = useCallback( commandsHook( setOpen ), [] ); // eslint-disable-line react-hooks/exhaustive-deps
		if ( commands ) {
			// Called on every render, in the same order, as hooks must be.
			commands.useCommandLoader( { name: 'axle-block-restore/commands', hook } );
		}

		return el(
			Fragment,
			null,
			here &&
				PluginMoreMenuItem &&
				el(
					PluginMoreMenuItem,
					{ icon: 'backup', onClick: () => setOpen( { clientId: null } ) },
					__( 'Restore blocks from a revision', 'axle-block-restore' )
				),
			el( BlockSettingsMenuControls, null, ( fillProps ) => {
				const ids = fillProps.selectedClientIds || [];
				if ( 1 !== ids.length || ! canRestoreBlock( select, ids[ 0 ] ) ) {
					return null;
				}
				return el(
					MenuItem,
					{
						icon: 'backup',
						onClick: () => {
							setOpen( { clientId: ids[ 0 ] } );
							fillProps.onClose();
						},
					},
					__( 'Restore from a revision…', 'axle-block-restore' )
				);
			} ),
			el( BlockSettingsMenuControls, null, ( fillProps ) => {
				const ids = fillProps.selectedClientIds || [];
				if ( 1 !== ids.length || ! canRestoreBlock( select, ids[ 0 ] ) ) {
					return null;
				}
				return el(
					MenuItem,
					{
						icon: 'clock',
						onClick: () => {
							setOpen( { clientId: ids[ 0 ], view: 'history' } );
							fillProps.onClose();
						},
					},
					__( 'Block history', 'axle-block-restore' )
				);
			} ),
			open && el( restore.RestoreModal, { clientId: open.clientId, focusSearch: !! open.focusSearch, view: open.view || 'revisions', link: open.link, onClose: () => {
				restore.pendingOpen = null;
				setOpen( null );
			} } )
		);
	}

	registerPlugin( 'axle-block-restore', { render: BlockRestore } );
} )( window.wp, window.axleBlockRestore );
