/**
 * Restore One Block: adds "Restore from a revision…" to each block's menu and
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
	const PluginMoreMenuItem = ( wp.editor && wp.editor.PluginMoreMenuItem ) || ( wp.editPost && wp.editPost.PluginMoreMenuItem );

	function RestoreOneBlock() {
		const [ open, setOpen ] = useState( null );

		return el(
			Fragment,
			null,
			PluginMoreMenuItem &&
				el(
					PluginMoreMenuItem,
					{ icon: 'backup', onClick: () => setOpen( { clientId: null } ) },
					__( 'Restore blocks from a revision', 'restore-one-block' )
				),
			el( BlockSettingsMenuControls, null, ( fillProps ) => {
				const ids = fillProps.selectedClientIds || [];
				if ( 1 !== ids.length ) {
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
					__( 'Restore from a revision…', 'restore-one-block' )
				);
			} ),
			open && el( RestoreModal, { clientId: open.clientId, onClose: () => setOpen( null ) } )
		);
	}

	registerPlugin( 'restore-one-block', { render: RestoreOneBlock } );
} )( window.wp, window.restoreOneBlock.RestoreModal );
