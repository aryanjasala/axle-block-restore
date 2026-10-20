const { test, expect, openEditor } = require( './utils' );

const p = ( text ) => `<!-- wp:paragraph --><p>${ text }</p><!-- /wp:paragraph -->`;
const heading = '<!-- wp:heading --><h2 class="wp-block-heading">Ingredients</h2><!-- /wp:heading -->';
const group = ( inner ) => `<!-- wp:group --><div class="wp-block-group">${ p( inner ) }</div><!-- /wp:group -->`;

// Oldest to newest. The last one is what the editor shows.
const VERSIONS = [
	[ p( 'Intro paragraph about cooking.' ), heading, p( 'Flour, sugar, eggs.' ), group( 'Inner note: bake at 200C.' ), p( 'Old closing line that someone deleted.' ) ],
	[ p( 'Intro about baking bread.' ), heading, p( 'Flour, sugar, eggs.' ), group( 'Inner note: bake at 200C.' ), p( 'Old closing line that someone deleted.' ) ],
	[ p( 'Intro about baking bread.' ), heading, p( 'Flour, water, salt.' ), group( 'Inner note: bake at 220C.' ) ],
].map( ( blocks ) => blocks.join( '\n\n' ) );

/**
 * A post with one revision per version, saved through the REST API as the admin.
 */
async function createPost( rest, title ) {
	const created = await rest( 'POST', '/wp/v2/posts', { title, status: 'draft', content: 'Start' } );
	for ( const content of VERSIONS ) {
		await rest( 'POST', `/wp/v2/posts/${ created.body.id }`, { content, status: 'publish' } );
	}
	return created.body.id;
}

const blocksNow = ( page ) =>
	page.evaluate( () =>
		window.wp.data
			.select( 'core/block-editor' )
			.getBlocks()
			.map( ( block ) => ( block.innerBlocks.length ? block.innerBlocks.map( ( inner ) => String( inner.attributes.content ) ).join( '|' ) : String( block.attributes.content ) ) )
	);

async function openPostModal( page ) {
	await page.getByRole( 'region', { name: 'Editor top bar' } ).getByRole( 'button', { name: 'Options' } ).click();
	await page.getByRole( 'menuitem', { name: 'Restore blocks from a revision' } ).click();
	const modal = page.getByRole( 'dialog', { name: 'Restore blocks from a revision' } );
	await expect( modal.locator( '.rob-revision' ).first() ).toBeVisible();
	return modal;
}

async function openBlockModal( page, clientId ) {
	await page.evaluate( ( id ) => window.wp.data.dispatch( 'core/block-editor' ).selectBlock( id ), clientId );
	await page.getByRole( 'toolbar', { name: 'Block tools' } ).getByRole( 'button', { name: 'Options' } ).click();
	await page.getByRole( 'menuitem', { name: 'Restore from a revision…' } ).click();
	const modal = page.getByRole( 'dialog', { name: /^Restore this .* from a revision$/ } );
	await expect( modal.locator( '.rob-revision' ).first() ).toBeVisible();
	return modal;
}

test.describe( 'Restore One Block', () => {
	test( 'brings a deleted paragraph back to where it was, and the save keeps it', async ( { page, rest } ) => {
		const postId = await createPost( rest, 'ROB deleted paragraph' );
		await openEditor( page, postId );

		const modal = await openPostModal( page );
		// The newest revision matches the editor, so the window opens on the next one.
		await expect( modal.locator( '.rob-revision.is-selected' ) ).not.toContainText( 'Same as now' );

		const missing = modal.locator( '.rob-card', { has: page.locator( '.rob-badge--missing' ) } );
		await expect( missing ).toContainText( 'Old closing line that someone deleted.' );
		await missing.getByRole( 'button', { name: 'Restore it here' } ).click();

		await expect( modal ).toHaveCount( 0 );
		await expect( page.locator( '.components-snackbar' ) ).toContainText( 'Block restored.' );
		expect( ( await blocksNow( page ) )[ 4 ] ).toBe( 'Old closing line that someone deleted.' );

		await page.evaluate( () => window.wp.data.dispatch( 'core/editor' ).savePost() );
		await expect.poll( async () => ( await rest( 'GET', `/wp/v2/posts/${ postId }?context=edit` ) ).body.content.raw ).toContain( 'Old closing line that someone deleted.' );
	} );

	test( 'replaces one block with an older version, after showing the word changes', async ( { page, rest } ) => {
		const postId = await createPost( rest, 'ROB one block' );
		await openEditor( page, postId );
		const clientId = await page.evaluate( () => window.wp.data.select( 'core/block-editor' ).getBlocks()[ 2 ].clientId );

		const modal = await openBlockModal( page, clientId );
		await expect( modal.getByRole( 'heading', { name: 'Restore this Paragraph from a revision' } ) ).toBeVisible();

		const best = modal.locator( '.rob-card' ).first();
		await expect( best.locator( '.rob-badge' ) ).toHaveText( 'Best match' );
		await expect( best ).toContainText( 'Flour, sugar, eggs.' );

		await best.getByRole( 'button', { name: 'Show changes' } ).click();
		await expect( best.locator( '.rob-diff del' ) ).toHaveText( 'water, salt.' );
		await expect( best.locator( '.rob-diff ins' ) ).toHaveText( 'sugar, eggs.' );

		await best.getByRole( 'button', { name: 'Replace current block' } ).click();
		expect( ( await blocksNow( page ) )[ 2 ] ).toBe( 'Flour, sugar, eggs.' );

		await page.evaluate( () => window.wp.data.dispatch( 'core/editor' ).undo() );
		expect( ( await blocksNow( page ) )[ 2 ] ).toBe( 'Flour, water, salt.' );
	} );

	test( 'restores a block nested inside a group', async ( { page, rest } ) => {
		const postId = await createPost( rest, 'ROB nested' );
		await openEditor( page, postId );
		const clientId = await page.evaluate( () => window.wp.data.select( 'core/block-editor' ).getBlocks()[ 3 ].innerBlocks[ 0 ].clientId );

		const modal = await openBlockModal( page, clientId );
		const best = modal.locator( '.rob-card' ).first();
		await expect( best.locator( '.rob-badge' ) ).toHaveText( 'Best match' );
		await expect( best ).toContainText( 'Inner note: bake at 200C.' );
		await best.getByRole( 'button', { name: 'Replace current block' } ).click();

		expect( ( await blocksNow( page ) )[ 3 ] ).toBe( 'Inner note: bake at 200C.' );
	} );

	test( 'finds deleted text across revisions and jumps to it', async ( { page, rest } ) => {
		const postId = await createPost( rest, 'ROB search' );
		await openEditor( page, postId );

		const modal = await openPostModal( page );
		await modal.getByRole( 'searchbox', { name: 'Find text in old revisions' } ).fill( 'closing line' );

		const result = modal.locator( '.rob-result' );
		await expect( result ).toHaveCount( 1 );
		await expect( result.locator( 'mark' ) ).toHaveText( 'closing line' );
		await expect( result.locator( '.rob-result__meta' ) ).toContainText( 'Paragraph in 2 revisions' );

		await result.getByRole( 'button', { name: 'Show in revision' } ).click();
		const focused = modal.locator( '.rob-card.is-focused' );
		await expect( focused ).toContainText( 'Old closing line that someone deleted.' );
		await expect( focused.locator( 'mark' ) ).toHaveText( 'Old closing line that someone deleted.' );
	} );

	test( 'lists revisions with author and differences, navigable with the arrow keys', async ( { page, rest } ) => {
		const postId = await createPost( rest, 'ROB list' );
		await openEditor( page, postId );

		const modal = await openPostModal( page );
		const options = modal.getByRole( 'option' );
		await expect( options ).toHaveCount( 3 );
		await expect( options.nth( 0 ) ).toContainText( 'admin' );
		await expect( options.nth( 0 ) ).toContainText( 'Same as now' );
		await expect( options.nth( 1 ) ).toContainText( '3 differences' );
		await expect( options.nth( 2 ) ).toContainText( '4 differences' );

		await expect( options.nth( 1 ) ).toHaveAttribute( 'aria-selected', 'true' );
		await options.nth( 1 ).focus();
		await page.keyboard.press( 'ArrowDown' );
		await expect( options.nth( 2 ) ).toHaveAttribute( 'aria-selected', 'true' );
		await expect( modal.locator( '.rob-summary' ) ).toContainText( '5 blocks in this revision' );
	} );
} );
