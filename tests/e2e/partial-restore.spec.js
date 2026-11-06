const { test, expect, openEditor } = require( './utils' );
const { openBlockModal } = require( './helpers' );

test.describe( 'Axle Block Restore: content only and styling only', () => {
	test( 'restores only the content or only the styling of a block, and undoes each in one step', async ( { page, rest } ) => {
		const styled = ( text, size ) => `<!-- wp:paragraph {"fontSize":"${ size }"} --><p class="has-${ size }-font-size">${ text }</p><!-- /wp:paragraph -->`;
		const created = await rest( 'POST', '/wp/v2/posts', { title: 'ABR modes', status: 'draft', content: 'Start' } );
		for ( const content of [ styled( 'Old words here.', 'large' ), styled( 'New words now.', 'large' ), styled( 'New words now.', 'small' ) ] ) {
			await rest( 'POST', `/wp/v2/posts/${ created.body.id }`, { content, status: 'publish' } );
		}
		await openEditor( page, created.body.id );
		const attributes = () =>
			page.evaluate( () => {
				const block = window.wp.data.select( 'core/block-editor' ).getBlocks()[ 0 ];
				return { content: String( block.attributes.content ), fontSize: block.attributes.fontSize };
			} );
		// An undo can bring the block back under a new ID, so look it up each time.
		const firstBlock = () => page.evaluate( () => window.wp.data.select( 'core/block-editor' ).getBlocks()[ 0 ].clientId );
		const modal = await openBlockModal( page, await firstBlock() );

		// The newest revision that differs has the same words and a larger font: nothing to restore for the content.
		const card = modal.locator( '.abr-card' ).first();
		await expect( card.getByRole( 'button', { name: 'Restore content only' } ) ).toBeDisabled();
		await expect( card ).toContainText( 'The content is the same as now.' );
		await expect( card.getByRole( 'button', { name: 'Restore styling only' } ) ).toBeEnabled();

		// The changes view follows the choice: here only the font size would change.
		await card.getByRole( 'button', { name: 'Show changes' } ).click();
		await expect( card.locator( '.abr-settings' ) ).toContainText( 'fontSize' );
		await expect( card.locator( '.abr-diff' ) ).toHaveCount( 0 );

		await card.getByRole( 'button', { name: 'Restore styling only' } ).click();
		expect( await attributes() ).toEqual( { content: 'New words now.', fontSize: 'large' } );
		await page.evaluate( () => window.wp.data.dispatch( 'core/editor' ).undo() );
		expect( await attributes() ).toEqual( { content: 'New words now.', fontSize: 'small' } );

		// The oldest revision has other words and the larger font: content only keeps the small font.
		const again = await openBlockModal( page, await firstBlock() );
		await again.getByRole( 'option' ).nth( 2 ).click();
		const old = again.locator( '.abr-card' ).first();
		await expect( old ).toContainText( 'Old words here.' );
		await old.getByRole( 'button', { name: 'Show changes' } ).click();
		await old.getByRole( 'combobox', { name: 'Show changes for' } ).selectOption( 'content' );
		await expect( old.locator( '.abr-diff ins' ).first() ).toHaveText( 'Old' );
		await expect( old.locator( '.abr-settings' ) ).toHaveCount( 0 );
		await old.getByRole( 'button', { name: 'Restore content only' } ).click();
		expect( await attributes() ).toEqual( { content: 'Old words here.', fontSize: 'small' } );
		await page.evaluate( () => window.wp.data.dispatch( 'core/editor' ).undo() );
		expect( await attributes() ).toEqual( { content: 'New words now.', fontSize: 'small' } );
	} );

	test( 'JavaScript hooks for partial restores: attributeRole, styleAttributes, restoreModes', async ( { page, rest } ) => {
		const styled = ( text, size ) => `<!-- wp:paragraph {"fontSize":"${ size }"} --><p class="has-${ size }-font-size">${ text }</p><!-- /wp:paragraph -->`;
		const created = await rest( 'POST', '/wp/v2/posts', { title: 'ABR roles', status: 'draft', content: 'Start' } );
		for ( const content of [ styled( 'Old words here.', 'large' ), styled( 'New words now.', 'small' ) ] ) {
			await rest( 'POST', `/wp/v2/posts/${ created.body.id }`, { content, status: 'publish' } );
		}
		await openEditor( page, created.body.id );
		const firstBlock = () => page.evaluate( () => window.wp.data.select( 'core/block-editor' ).getBlocks()[ 0 ].clientId );

		// Counting the font size as content makes "content only" bring it back along with the words.
		await page.evaluate( () => {
			window.wp.hooks.addFilter( 'axleBlockRestore.attributeRole', 'abr-e2e', ( role, name ) => ( 'fontSize' === name ? 'content' : role ) );
		} );
		let modal = await openBlockModal( page, await firstBlock() );
		await modal.getByRole( 'option' ).nth( 1 ).click();
		await modal.locator( '.abr-card' ).first().getByRole( 'button', { name: 'Restore content only' } ).click();
		expect( await page.evaluate( () => window.wp.data.select( 'core/block-editor' ).getBlocks()[ 0 ].attributes.fontSize ) ).toBe( 'large' );
		await page.evaluate( () => window.wp.data.dispatch( 'core/editor' ).undo() );

		// With only the whole-block mode offered, the two partial buttons are gone.
		await page.evaluate( () => window.wp.hooks.addFilter( 'axleBlockRestore.restoreModes', 'abr-e2e', () => [ 'replace' ] ) );
		modal = await openBlockModal( page, await firstBlock() );
		await modal.getByRole( 'option' ).nth( 1 ).click();
		await expect( modal.getByRole( 'button', { name: 'Replace current block' } ) ).toBeVisible();
		await expect( modal.getByRole( 'button', { name: 'Restore content only' } ) ).toHaveCount( 0 );
		await expect( modal.getByRole( 'button', { name: 'Restore styling only' } ) ).toHaveCount( 0 );
	} );
} );
