/**
 * Axle Block Restore: adds "Restore from a revision…" to each block's menu and
 * "Restore blocks from a revision" to the editor's main menu.
 */
( function ( wp, RestoreModal ) {
	'use strict';

	const el = wp.element.createElement;
	const { Fragment, useState } = wp.element;
	const { __ } = wp.i18n;
	const { registerPlugin } = wp.plugins;
	const { BlockSettingsMenuControls } = wp.blockEditor;
	const { MenuItem } = wp.components;
	const { select } = wp.data;
	const { applyFilters } = wp.hooks;
	const PluginMoreMenuItem = ( wp.editor && wp.editor.PluginMoreMenuItem ) || ( wp.editPost && wp.editPost.PluginMoreMenuItem );

	function BlockRestore() {
		const [ open, setOpen ] = useState( null );

		return el(
			Fragment,
			null,
			PluginMoreMenuItem &&
				el(
					PluginMoreMenuItem,
					{ icon: 'backup', onClick: () => setOpen( { clientId: null } ) },
					__( 'Restore blocks from a revision', 'axle-block-restore' )
				),
			el( BlockSettingsMenuControls, null, ( fillProps ) => {
				const ids = fillProps.selectedClientIds || [];
				if ( 1 !== ids.length ) {
					return null;
				}

				/**
				 * Filters whether a block offers "Restore from a revision…" in its menu.
				 *
				 * @param {boolean} canRestore Default true.
				 * @param {Object}  block      The selected block.
				 */
				if ( ! applyFilters( 'axleBlockRestore.canRestore', true, select( 'core/block-editor' ).getBlock( ids[ 0 ] ) ) ) {
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
			open && el( RestoreModal, { clientId: open.clientId, onClose: () => setOpen( null ) } )
		);
	}

	registerPlugin( 'axle-block-restore', { render: BlockRestore } );
} )( window.wp, window.axleBlockRestore.RestoreModal );
