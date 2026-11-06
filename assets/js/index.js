/**
 * Axle Block Restore: adds "Restore from a revision…" to each block's menu,
 * "Restore blocks from a revision" to the editor's main menu, and three
 * commands to the command palette. Works in the post editor and the Site Editor.
 */
( function ( wp, restore ) {
	'use strict';

	const el = wp.element.createElement;
	const { Fragment, useState, useCallback, useMemo } = wp.element;
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
					} );
				}

				/**
				 * Filters the command palette entries Axle Block Restore adds.
				 *
				 * Each entry is a command for `wp.commands`: name, label, icon and callback.
				 *
				 * @param {Object[]}    entries  Default: restore blocks, find text, and (with a block selected) restore the selected block.
				 * @param {string|null} blockId  Client ID of the selected block, or null.
				 */
				return applyFilters( 'axleBlockRestore.commands', list, state.blockId );
			}, [ state.here, state.blockId ] );

			return { commands: entries, isLoading: false };
		};
	}

	function BlockRestore() {
		const [ open, setOpen ] = useState( null );
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
			open && el( restore.RestoreModal, { clientId: open.clientId, focusSearch: !! open.focusSearch, onClose: () => setOpen( null ) } )
		);
	}

	registerPlugin( 'axle-block-restore', { render: BlockRestore } );
} )( window.wp, window.axleBlockRestore );
