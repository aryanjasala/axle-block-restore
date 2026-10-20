const { test, expect, openEditor, wp } = require( './utils' );

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

	test( 'JavaScript hooks: canRestore hides the menu item, restored reports what came back', async ( { page, rest } ) => {
		const postId = await createPost( rest, 'ROB hooks' );
		await openEditor( page, postId );
		await page.evaluate( () => {
			window.robRestored = [];
			window.wp.hooks.addFilter( 'restoreOneBlock.canRestore', 'rob-e2e', ( canRestore, block ) => canRestore && 'core/heading' !== block.name );
			window.wp.hooks.addAction( 'restoreOneBlock.restored', 'rob-e2e', ( details ) => window.robRestored.push( { mode: details.mode, name: details.block.name, revisionId: details.revisionId, postId: details.postId } ) );
		} );

		// The heading has no "Restore from a revision…" item now.
		const blockMenu = async ( index ) => {
			const id = await page.evaluate( ( i ) => window.wp.data.select( 'core/block-editor' ).getBlocks()[ i ].clientId, index );
			await page.evaluate( ( clientId ) => window.wp.data.dispatch( 'core/block-editor' ).selectBlock( clientId ), id );
			await page.getByRole( 'toolbar', { name: 'Block tools' } ).getByRole( 'button', { name: 'Options' } ).click();
		};
		await blockMenu( 1 );
		await expect( page.getByRole( 'menuitem', { name: 'Restore from a revision…' } ) ).toHaveCount( 0 );
		await page.keyboard.press( 'Escape' );

		// A paragraph still has it, and restoring fires the action.
		await blockMenu( 2 );
		await page.getByRole( 'menuitem', { name: 'Restore from a revision…' } ).click();
		const best = page.locator( '.rob-card' ).first();
		await best.getByRole( 'button', { name: 'Replace current block' } ).click();

		const restored = await page.evaluate( () => window.robRestored );
		expect( restored ).toHaveLength( 1 );
		expect( restored[ 0 ] ).toMatchObject( { mode: 'replace', name: 'core/paragraph', postId } );
		expect( restored[ 0 ].revisionId ).toBeGreaterThan( 0 );
	} );

	test( 'abilities: an agent finds deleted and changed blocks and puts single blocks back', async ( { rest } ) => {
		const postId = await createPost( rest, 'ROB agent' );
		const run = ( name, method, input ) =>
			'GET' === method
				? rest( 'GET', `/wp-abilities/v1/abilities/restore-one-block/${ name }/run?${ Object.entries( input ).map( ( [ k, v ] ) => `input[${ k }]=${ encodeURIComponent( v ) }` ).join( '&' ) }` )
				: rest( 'POST', `/wp-abilities/v1/abilities/restore-one-block/${ name }/run`, { input } );
		const content = async () => ( await rest( 'GET', `/wp/v2/posts/${ postId }?context=edit` ) ).body.content.raw;

		const listed = await rest( 'GET', '/wp-abilities/v1/abilities?category=restore-one-block' );
		expect( listed.body.map( ( ability ) => ability.name ).sort() ).toEqual( [ 'restore-one-block/find-deleted', 'restore-one-block/find-text', 'restore-one-block/list-revisions', 'restore-one-block/restore-block' ] );

		const revisions = ( await run( 'list-revisions', 'GET', { post_id: postId } ) ).body;
		expect( revisions.length ).toBeGreaterThanOrEqual( 3 );
		expect( revisions[ 0 ] ).toMatchObject( { author: 'admin', autosave: false, blocks: 4 } );

		const deleted = ( await run( 'find-deleted', 'GET', { post_id: postId } ) ).body;
		const closing = deleted.find( ( item ) => item.text === 'Old closing line that someone deleted.' );
		expect( closing ).toMatchObject( { path: [ 4 ], name: 'core/paragraph', in_current: false } );
		expect( deleted.find( ( item ) => item.text === 'Inner note: bake at 200C.' ) ).toMatchObject( { path: [ 3, 0 ] } );

		// Back where it was, after the group.
		const inserted = await run( 'restore-block', 'POST', { post_id: postId, revision_id: closing.revision_id, path: closing.path } );
		expect( inserted.status ).toBe( 200 );
		expect( inserted.body ).toMatchObject( { mode: 'insert', name: 'core/paragraph', path: [ 4 ] } );
		expect( await content() ).toMatch( /<\/div>\s*<!-- \/wp:group -->\n\n<!-- wp:paragraph -->\s*<p>Old closing line that someone deleted\.<\/p>/ );

		// One paragraph, and one block inside the group, back to older versions.
		const sugar = deleted.find( ( item ) => item.text === 'Flour, sugar, eggs.' );
		const note = deleted.find( ( item ) => item.text === 'Inner note: bake at 200C.' );
		await run( 'restore-block', 'POST', { post_id: postId, revision_id: sugar.revision_id, path: sugar.path, mode: 'replace' } );
		await run( 'restore-block', 'POST', { post_id: postId, revision_id: note.revision_id, path: note.path, mode: 'replace' } );
		const now = await content();
		expect( now ).toContain( 'Flour, sugar, eggs.' );
		expect( now ).not.toContain( 'Flour, water, salt.' );
		expect( now ).toMatch( /<div class="wp-block-group">\s*<!-- wp:paragraph -->\s*<p>Inner note: bake at 200C\.<\/p>/ );
		expect( ( await run( 'find-text', 'GET', { post_id: postId, text: 'closing line' } ) ).body[ 0 ].in_current ).toBe( true );

		// Someone else editing: refused unless forced.
		const editor = wp( 'user', 'create', `editor${ postId }`, `editor${ postId }@example.com`, '--role=editor', '--porcelain' );
		wp( 'post', 'meta', 'update', String( postId ), '_edit_lock', `${ Math.floor( Date.now() / 1000 ) }:${ editor }` );
		const locked = await run( 'restore-block', 'POST', { post_id: postId, revision_id: closing.revision_id, path: [ 0 ] } );
		expect( locked.body.code ).toBe( 'restore_one_block_locked' );
		const forced = await run( 'restore-block', 'POST', { post_id: postId, revision_id: closing.revision_id, path: [ 0 ], position: 0, force: true } );
		expect( forced.status ).toBe( 200 );
		wp( 'user', 'delete', editor, '--yes' );
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
		// Only the selected revision is in the tab order, and the arrow keys move the focus with it.
		await expect( options.nth( 1 ) ).toHaveAttribute( 'tabindex', '0' );
		await expect( options.nth( 0 ) ).toHaveAttribute( 'tabindex', '-1' );
		await options.nth( 1 ).focus();
		await page.keyboard.press( 'ArrowDown' );
		await expect( options.nth( 2 ) ).toHaveAttribute( 'aria-selected', 'true' );
		await expect( options.nth( 2 ) ).toBeFocused();
		await page.keyboard.press( 'Home' );
		await expect( options.nth( 0 ) ).toBeFocused();
		await page.keyboard.press( 'End' );
		await expect( options.nth( 2 ) ).toBeFocused();
		await page.keyboard.press( 'ArrowDown' );
		await expect( modal.locator( '.rob-summary' ) ).toContainText( '5 blocks in this revision' );
	} );
} );
