const { test, expect, openEditor } = require( './utils' );
const { createPost } = require( './helpers' );

test.describe( 'Axle Block Restore: command palette', () => {
	test( 'the command palette restores blocks, restores the selected block, and searches', async ( { page, rest } ) => {
		const postId = await createPost( rest, 'ABR palette' );
		await openEditor( page, postId );
		// Opens the palette the way Ctrl+K does, and types the name of a command.
		const palette = async ( label ) => {
			await page.evaluate( () => {
				window.wp.data.dispatch( 'core/commands' ).close();
				window.wp.data.dispatch( 'core/commands' ).open();
			} );
			await page.getByRole( 'combobox', { name: /Search commands/i } ).fill( label );
			return page.getByRole( 'option', { name: label } );
		};
		const run = async ( label ) => {
			await expect( await palette( label ) ).toHaveCount( 1 );
			await page.keyboard.press( 'Enter' );
		};
		const opened = await page.evaluate( () => {
			window.robOpened = [];
			window.wp.hooks.addAction( 'axleBlockRestore.opened', 'abr-e2e', ( details ) => window.robOpened.push( details ) );
			return true;
		} );
		expect( opened ).toBe( true );

		// "Restore selected block" only shows while a block is selected.
		await page.evaluate( () => window.wp.data.dispatch( 'core/block-editor' ).clearSelectedBlock() );
		await expect( await palette( 'Restore selected block from a revision' ) ).toHaveCount( 0 );

		await run( 'Restore blocks from a revision' );
		const modal = page.getByRole( 'dialog', { name: 'Restore blocks from a revision' } );
		await expect( modal.locator( '.abr-revision' ).first() ).toBeVisible();
		await page.keyboard.press( 'Escape' );
		await expect( modal ).toHaveCount( 0 );

		const clientId = await page.evaluate( () => window.wp.data.select( 'core/block-editor' ).getBlocks()[ 2 ].clientId );
		await page.evaluate( ( id ) => window.wp.data.dispatch( 'core/block-editor' ).selectBlock( id ), clientId );
		await run( 'Restore selected block from a revision' );
		const blockModal = page.getByRole( 'dialog', { name: 'Restore this Paragraph from a revision' } );
		await expect( blockModal.locator( '.abr-card' ).first() ).toContainText( 'Flour, sugar, eggs.' );
		await page.keyboard.press( 'Escape' );
		await expect( blockModal ).toHaveCount( 0 );

		await run( 'Find text in old revisions' );
		await expect( page.getByRole( 'searchbox', { name: 'Find text in old revisions' } ) ).toBeFocused();

		const details = await page.evaluate( () => window.robOpened );
		expect( details.map( ( item ) => [ item.clientId, item.focusSearch ] ) ).toEqual( [ [ null, false ], [ clientId, false ], [ null, true ] ] );
		expect( details[ 0 ] ).toMatchObject( { postType: 'post', postId } );

		// A filter can add or drop palette entries.
		await page.keyboard.press( 'Escape' );
		await expect( page.getByRole( 'dialog', { name: /^Restore/ } ) ).toHaveCount( 0 );
		await page.evaluate( () => window.wp.hooks.addFilter( 'axleBlockRestore.commands', 'abr-e2e', ( list ) => list.filter( ( command ) => 'axle-block-restore/search' !== command.name ) ) );
		await expect( await palette( 'Find text in old revisions' ) ).toHaveCount( 0 );
	} );
} );
