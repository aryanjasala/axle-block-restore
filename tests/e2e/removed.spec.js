const { test, expect, openEditor } = require( './utils' );
const { p, heading, createPost, blocksNow } = require( './helpers' );

// Opens the restore window on the removed blocks view the way the command palette does.
async function openRemoved( page ) {
	await page.evaluate( () => {
		window.wp.data.dispatch( 'core/commands' ).close();
		window.wp.data.dispatch( 'core/commands' ).open();
	} );
	await page.getByRole( 'combobox', { name: /Search commands/i } ).fill( 'Show removed blocks' );
	await page.getByRole( 'option', { name: 'Show removed blocks' } ).click();
	return page.getByRole( 'dialog', { name: 'Restore blocks from a revision' } );
}

test.describe( 'Axle Block Restore: removed blocks', () => {
	test( 'lists what was removed, newest first, and puts a block back where it was in one undo step', async ( { page, rest } ) => {
		const postId = await createPost( rest, 'ABR removed' );
		await openEditor( page, postId );
		await page.evaluate( () => {
			window.robRestored = [];
			window.robOpened = [];
			window.wp.hooks.addAction( 'axleBlockRestore.restored', 'abr-e2e', ( details ) => window.robRestored.push( { mode: details.mode, revisionId: details.revisionId } ) );
			window.wp.hooks.addAction( 'axleBlockRestore.opened', 'abr-e2e', ( details ) => window.robOpened.push( details.view ) );
		} );

		const modal = await openRemoved( page );
		await expect( modal.getByRole( 'tab', { name: 'Removed blocks', selected: true } ) ).toBeVisible();
		const cards = modal.locator( '.abr-card' );
		const closing = cards.filter( { hasText: 'Old closing line' } );
		await expect( closing ).toHaveCount( 1 );

		// The closing line was in two old revisions and is listed once. Rewritten paragraphs say so.
		await expect( cards.filter( { hasText: 'Flour, sugar, eggs.' } ).locator( '.abr-badge' ) ).toHaveText( 'Rewritten since' );
		await expect( closing.locator( '.abr-badge' ) ).toHaveText( 'Removed' );
		await expect( closing.locator( '.abr-card__meta' ).first() ).toContainText( 'Last in a revision saved by' );
		await expect( closing.locator( '.abr-card__meta time' ) ).toHaveAttribute( 'datetime', /\d{4}-\d{2}-\d{2}T/ );
		await expect( modal.locator( '.abr-summary' ) ).toContainText( 'removed block' );
		await expect( modal ).not.toContainText( 'Inner note' );
				// Nothing is selected, so there is nothing to insert below.
		await expect( modal.getByRole( 'button', { name: 'Insert below the selected block' } ) ).toHaveCount( 0 );

		await closing.getByRole( 'button', { name: 'Preview' } ).click();
		await expect( closing.locator( '.abr-card__preview' ) ).toBeVisible();

		await closing.getByRole( 'button', { name: 'Put it back where it was' } ).click();
		await expect( modal ).toHaveCount( 0 );
		await expect( page.locator( '.components-snackbar' ) ).toContainText( 'Block restored.' );

		// It was last in the post, after the group.
		const now = await blocksNow( page );
		expect( now ).toHaveLength( 5 );
		expect( now[ 4 ] ).toBe( 'Old closing line that someone deleted.' );
		const restored = await page.evaluate( () => ( { restored: window.robRestored, opened: window.robOpened } ) );
		expect( restored.opened ).toEqual( [ 'removed' ] );
		expect( restored.restored[ 0 ].mode ).toBe( 'removed-place' );

		await page.evaluate( () => window.wp.data.dispatch( 'core/editor' ).undo() );
		expect( await blocksNow( page ) ).toHaveLength( 4 );
	} );

	test( 'inserts a removed block at the end, or below the selected block', async ( { page, rest } ) => {
		const postId = await createPost( rest, 'ABR removed insert' );
		await openEditor( page, postId );

		let modal = await openRemoved( page );
		await modal.locator( '.abr-card', { hasText: 'Old closing line' } ).getByRole( 'button', { name: 'Insert at the end' } ).click();
		await expect( modal ).toHaveCount( 0 );
		expect( ( await blocksNow( page ) ).pop() ).toBe( 'Old closing line that someone deleted.' );
		await page.evaluate( () => window.wp.data.dispatch( 'core/editor' ).undo() );

		const first = await page.evaluate( () => window.wp.data.select( 'core/block-editor' ).getBlocks()[ 0 ].clientId );
		await page.evaluate( ( id ) => window.wp.data.dispatch( 'core/block-editor' ).selectBlock( id ), first );
		modal = await openRemoved( page );
		await modal.locator( '.abr-card', { hasText: 'Old closing line' } ).getByRole( 'button', { name: 'Insert below the selected block' } ).click();
		await expect( modal ).toHaveCount( 0 );
		expect( ( await blocksNow( page ) )[ 1 ] ).toBe( 'Old closing line that someone deleted.' );
	} );

	test( 'lists a block removed from inside a group and puts it back inside that group', async ( { page, rest } ) => {
		const wrap = ( ...inner ) => `<!-- wp:group --><div class="wp-block-group">${ inner.map( p ).join( '' ) }</div><!-- /wp:group -->`;
		const created = await rest( 'POST', '/wp/v2/posts', { title: 'ABR nested', status: 'draft', content: 'Start' } );
		const id = created.body.id;
		await rest( 'POST', `/wp/v2/posts/${ id }`, { status: 'publish', content: [ p( 'Opening remarks for everyone.' ), wrap( 'First kept note about heat.', 'Second note about timing that is deleted.', 'Third kept note about salt.' ) ].join( '\n\n' ) } );
		await rest( 'POST', `/wp/v2/posts/${ id }`, { content: [ p( 'Opening remarks for everyone.' ), wrap( 'First kept note about heat.', 'Third kept note about salt.' ) ].join( '\n\n' ) } );
		await openEditor( page, id );

		const modal = await openRemoved( page );
		const cards = modal.locator( '.abr-card' );
		await expect( cards ).toHaveCount( 1 );
		await expect( cards.first() ).toContainText( 'Second note about timing that is deleted.' );
		await expect( cards.first() ).toContainText( 'Was inside another block' );
		await cards.first().getByRole( 'button', { name: 'Put it back where it was' } ).click();
		await expect( modal ).toHaveCount( 0 );

		const inner = await page.evaluate( () => window.wp.data.select( 'core/block-editor' ).getBlocks()[ 1 ].innerBlocks.map( ( block ) => String( block.attributes.content ) ) );
		expect( inner ).toEqual( [ 'First kept note about heat.', 'Second note about timing that is deleted.', 'Third kept note about salt.' ] );
		expect( await page.evaluate( () => window.wp.data.select( 'core/block-editor' ).getBlocks().length ) ).toBe( 2 );
	} );

	test( 'says so when nothing was removed, and when the revisions cannot load', async ( { page, rest } ) => {
		const created = await rest( 'POST', '/wp/v2/posts', { title: 'ABR nothing removed', status: 'draft', content: p( 'Only paragraph.' ) } );
		await rest( 'POST', `/wp/v2/posts/${ created.body.id }`, { content: p( 'Only paragraph.' ) + '\n\n' + heading, status: 'publish' } );
		await openEditor( page, created.body.id );

		let modal = await openRemoved( page );
		await expect( modal.getByText( /No block from these revisions is missing from the post/ ) ).toBeVisible();
		await expect( modal.locator( '.abr-card' ) ).toHaveCount( 0 );
		await page.keyboard.press( 'Escape' );

		// A failing revisions request shows the error with a retry.
		await page.route( /rest_route=.*revisions|\/revisions/, ( route ) => route.fulfill( { status: 500, contentType: 'application/json', body: JSON.stringify( { code: 'boom', message: 'Revisions are not available right now.' } ) } ) );
		modal = await openRemoved( page );
		await expect( modal.getByText( 'Revisions are not available right now.' ) ).toBeVisible();
		await expect( modal.getByRole( 'button', { name: 'Try again' } ) ).toBeVisible();
	} );

	test( 'a JavaScript filter changes how many revisions are searched', async ( { page, rest } ) => {
		const postId = await createPost( rest, 'ABR removed limit' );
		await openEditor( page, postId );
		// The closing line is only in the older revisions, so looking at one revision finds nothing.
		await page.evaluate( () => window.wp.hooks.addFilter( 'axleBlockRestore.removedRevisions', 'abr-e2e', () => 1 ) );
		const modal = await openRemoved( page );
		await expect( modal.locator( '.abr-summary' ) ).toContainText( 'Looked through 1 recent revision.' );
		await expect( modal.locator( '.abr-card' ) ).toHaveCount( 0 );
	} );
} );
