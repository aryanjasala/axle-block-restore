// Block history and "insert below as a copy": the history of one block, the way to put a version next to the current one, and the notice after it.
const { test, expect, openEditor, wp, wpEval } = require( './utils' );
const { p, createPost, blocksNow } = require( './helpers' );

// The paragraph at index 2 of the posts createPost() makes: "Flour, sugar, eggs." in the first two saves, "Flour, water, salt." now.
const idOfBlock = ( page, index ) => page.evaluate( ( i ) => window.wp.data.select( 'core/block-editor' ).getBlocks()[ i ].clientId, index );

async function openHistory( page, clientId ) {
	await page.evaluate( ( id ) => window.wp.data.dispatch( 'core/block-editor' ).selectBlock( id ), clientId );
	await page.getByRole( 'toolbar', { name: 'Block tools' } ).getByRole( 'button', { name: 'Options' } ).click();
	await page.getByRole( 'menuitem', { name: 'Block history' } ).click();
	const modal = page.getByRole( 'dialog', { name: /^Restore this .* from a revision$/ } );
	await expect( modal.getByRole( 'tab', { name: 'Block history' } ) ).toHaveAttribute( 'aria-selected', 'true' );
	await expect( modal.locator( '.abr-timeline__item' ).first() ).toBeVisible();
	return modal;
}

test.describe( 'Axle Block Restore: block history', () => {
	test( 'shows each version of the selected block with who changed it and when, and restores one', async ( { page, rest } ) => {
		const postId = await createPost( rest, 'ABR history' );
		await openEditor( page, postId );
		const modal = await openHistory( page, await idOfBlock( page, 2 ) );

		// Newest first: the edit to water and salt, then the version it came from.
		const items = modal.locator( '.abr-timeline__item' );
		await expect( items ).toHaveCount( 2 );
		await expect( items.nth( 0 ) ).toContainText( 'Edited' );
		await expect( items.nth( 0 ).locator( '.abr-diff del' ) ).toHaveText( 'sugar, eggs.' );
		await expect( items.nth( 0 ).locator( '.abr-diff ins' ) ).toHaveText( 'water, salt.' );
		await expect( items.nth( 0 ) ).toContainText( 'Saved by admin' );
		await expect( items.nth( 0 ).locator( 'time' ) ).toHaveAttribute( 'datetime', /\d{4}-\d{2}-\d{2}T/ );
		await expect( items.nth( 0 ).locator( 'time' ) ).toHaveAttribute( 'title', /.+/ );
		await expect( items.nth( 1 ) ).toContainText( 'Flour, sugar, eggs.' );
		await expect( modal.locator( '.abr-summary' ) ).toContainText( '2 changes to this block found.' );

		// The older version can be previewed and restored, and undone from the notice.
		await items.nth( 1 ).getByRole( 'button', { name: 'Preview' } ).click();
		await expect( items.nth( 1 ).locator( '.abr-card__preview' ) ).toBeVisible();
		await items.nth( 1 ).getByRole( 'button', { name: 'Replace current block' } ).click();
		await expect( modal ).toHaveCount( 0 );
		expect( ( await blocksNow( page ) )[ 2 ] ).toBe( 'Flour, sugar, eggs.' );

		const notice = page.locator( '.components-snackbar' );
		await expect( notice ).toContainText( 'Block restored.' );
		await notice.getByRole( 'button', { name: 'Undo' } ).click();
		expect( ( await blocksNow( page ) )[ 2 ] ).toBe( 'Flour, water, salt.' );
	} );

	test( 'shows a block that was removed and added back, and unsaved changes', async ( { page, rest } ) => {
		const line = 'Our basic plan costs ten dollars a month and includes every feature.';
		const created = await rest( 'POST', '/wp/v2/posts', { title: 'ABR gap', status: 'draft', content: p( line ) } );
		const postId = created.body.id;
		const save = ( content ) => rest( 'POST', `/wp/v2/posts/${ postId }`, { content, status: 'publish' } );
		await save( p( line ) + '\n\n<!-- wp:heading --><h2 class="wp-block-heading">Shipping</h2><!-- /wp:heading -->' );
		await save( '<!-- wp:heading --><h2 class="wp-block-heading">Shipping</h2><!-- /wp:heading -->' );
		await save( p( line ) );
		await openEditor( page, postId );
		await page.evaluate( ( id ) => window.wp.data.dispatch( 'core/block-editor' ).updateBlockAttributes( id, { content: 'Our basic plan costs fifteen dollars a month and includes every feature.' } ), await idOfBlock( page, 0 ) );
		const modal = await openHistory( page, await idOfBlock( page, 0 ) );

		const items = modal.locator( '.abr-timeline__item' );
		await expect( items.first() ).toContainText( 'Not saved yet' );
		await expect( items.first() ).toContainText( 'Edited' );
		await expect( items.filter( { hasText: 'Added back' } ) ).toHaveCount( 1 );
		await expect( items.filter( { hasText: 'Removed' } ) ).toHaveCount( 1 );
		// Only saved versions can be restored: the unsaved one has just a preview.
		await expect( items.first().getByRole( 'button', { name: 'Replace current block' } ) ).toHaveCount( 0 );
	} );

	test( 'the command palette and the JavaScript hooks reach the history', async ( { page, rest } ) => {
		const postId = await createPost( rest, 'ABR history palette' );
		await openEditor( page, postId );
		const clientId = await idOfBlock( page, 2 );
		await page.evaluate( ( id ) => {
			window.wp.data.dispatch( 'core/block-editor' ).selectBlock( id );
			window.robEntries = [];
			window.wp.hooks.addFilter( 'axleBlockRestore.historyEntries', 'abr-e2e', ( entries ) => {
				window.robEntries = entries.map( ( entry ) => entry.type );
				return entries.slice( 0, 1 );
			} );
			window.wp.data.dispatch( 'core/commands' ).close();
			window.wp.data.dispatch( 'core/commands' ).open();
		}, clientId );
		await page.getByRole( 'combobox', { name: /Search commands/i } ).fill( 'Show history of selected block' );
		await page.getByRole( 'option', { name: 'Show history of selected block' } ).click();

		const modal = page.getByRole( 'dialog', { name: /^Restore this .* from a revision$/ } );
		await expect( modal.getByRole( 'tab', { name: 'Block history' } ) ).toHaveAttribute( 'aria-selected', 'true' );
		await expect( modal.locator( '.abr-timeline__item' ) ).toHaveCount( 1 );
		expect( await page.evaluate( () => window.robEntries ) ).toEqual( [ 'edited', 'first' ] );
	} );

	test( 'a block with no earlier version says so', async ( { page, rest } ) => {
		const created = await rest( 'POST', '/wp/v2/posts', { title: 'ABR new block', status: 'draft', content: p( 'Only this paragraph exists.' ) } );
		await rest( 'POST', `/wp/v2/posts/${ created.body.id }`, { content: p( 'Only this paragraph exists.' ) + p( 'And a second one, added later.' ), status: 'publish' } );
		await openEditor( page, created.body.id );
		const modal = await openHistory( page, await idOfBlock( page, 0 ) );

		await expect( modal.locator( '.components-notice' ) ).toContainText( 'no earlier versions' );
	} );

	test( 'stays quick on a post with 210 revisions: loads a page at a time, shows the count, then offers to look further', async ( { page, rest } ) => {
		const created = await rest( 'POST', '/wp/v2/posts', { title: 'ABR long history', status: 'draft', content: p( 'Version 0 of the pricing line.' ) } );
		const postId = created.body.id;
		wpEval( `for ( $i = 1; $i <= 210; $i++ ) { wp_update_post( array( 'ID' => ${ postId }, 'post_status' => 'publish', 'post_content' => '<!-- wp:paragraph --><p>Version ' . $i . ' of the pricing line.</p><!-- /wp:paragraph -->' ) ); }` );
		await openEditor( page, postId );
		const started = Date.now();
		const modal = await openHistory( page, await idOfBlock( page, 0 ) );

		await expect( modal.locator( '.abr-summary' ) ).toContainText( 'Looked through 200 revisions.', { timeout: 30000 } );
		await expect( modal.locator( '.abr-history' ) ).toHaveAttribute( 'aria-busy', 'false' );
		expect( Date.now() - started ).toBeLessThan( 30000 );
		await expect( modal.locator( '.abr-timeline__item' ) ).toHaveCount( 20 );
		await modal.getByRole( 'button', { name: 'Show older changes' } ).click();
		await expect( modal.locator( '.abr-timeline__item' ) ).toHaveCount( 40 );

		await modal.getByRole( 'button', { name: 'Look further back' } ).click();
		await expect( modal.locator( '.abr-summary' ) ).toContainText( 'Looked through 210 revisions.', { timeout: 30000 } );
		await expect( modal.getByRole( 'button', { name: 'Look further back' } ) ).toHaveCount( 0 );
	} );

	test( 'abilities and WP-CLI: an agent reads the history of one block', async ( { rest } ) => {
		test.skip( 'yes' !== wpEval( "echo function_exists( 'wp_register_ability' ) ? 'yes' : 'no';" ), 'The Abilities API needs WordPress 6.9.' );
		const postId = await createPost( rest, 'ABR history ability' );

		const run = ( id, path ) => rest( 'GET', `/wp-abilities/v1/abilities/axle-block-restore/block-history/run?input[post_id]=${ id }&input[path][]=${ path }` );
		const history = await run( postId, 2 );
		expect( history.status ).toBe( 200 );
		expect( history.body.name ).toBe( 'core/paragraph' );
		expect( history.body.entries.map( ( entry ) => entry.type ) ).toEqual( [ 'edited', 'first' ] );
		expect( history.body.entries[ 0 ] ).toMatchObject( { author: 'admin', previous_text: 'Flour, sugar, eggs.', text: 'Flour, water, salt.', text_changed: true, autosave: false, current: false } );

		const none = await run( postId, 40 );
		expect( none.body.code ).toBe( 'axle_block_restore_path' );

		const cli = JSON.parse( wp( 'axle-block-restore', 'history', String( postId ), '2', '--format=json' ) );
		expect( cli.map( ( entry ) => entry.type ) ).toEqual( [ 'edited', 'first' ] );
		const revisions = JSON.parse( wp( 'axle-block-restore', 'revisions', String( postId ), '--format=json' ) );
		expect( revisions.length ).toBeGreaterThanOrEqual( 3 );

		// An editor who cannot edit this post is refused, whatever the capability filter says.
		const author = wp( 'user', 'create', `author${ postId }`, `author${ postId }@example.com`, '--role=author', '--porcelain' );
		const refused = wpEval( `wp_set_current_user( ${ author } ); $ability = wp_get_ability( 'axle-block-restore/block-history' ); $result = $ability->execute( array( 'post_id' => ${ postId }, 'path' => array( 2 ) ) ); echo is_wp_error( $result ) ? $result->get_error_code() : 'allowed';` );
		wp( 'user', 'delete', author, '--yes' );
		expect( refused ).toMatch( /ability_invalid_permissions|forbidden|permission/i );
	} );
} );

test.describe( 'Axle Block Restore: insert below as a copy', () => {
	test( 'puts the old version next to the current block, with a new ID, and the notice undoes it or scrolls to it', async ( { page, rest } ) => {
		const postId = await createPost( rest, 'ABR copy below' );
		await openEditor( page, postId );
		const before = await blocksNow( page );
		const clientId = await idOfBlock( page, 2 );
		const modal = await openHistory( page, clientId );

		await modal.locator( '.abr-timeline__item' ).nth( 1 ).getByRole( 'button', { name: 'Insert below as a copy' } ).click();
		await expect( modal ).toHaveCount( 0 );

		const after = await blocksNow( page );
		expect( after ).toHaveLength( before.length + 1 );
		expect( after[ 2 ] ).toBe( 'Flour, water, salt.' );
		expect( after[ 3 ] ).toBe( 'Flour, sugar, eggs.' );
		const ids = await page.evaluate( () => window.wp.data.select( 'core/block-editor' ).getBlocks().map( ( block ) => block.clientId ) );
		expect( new Set( ids ).size ).toBe( ids.length );
		expect( ids[ 2 ] ).toBe( clientId );

		// A copy gets the editor's own notice, because a snackbar holds only one action.
		const notice = page.locator( '.components-notice', { hasText: 'Block inserted below as a copy.' } );
		await expect( notice ).toContainText( 'Block inserted below as a copy.' );
		await notice.getByRole( 'button', { name: 'Compare' } ).click();
		await expect.poll( () => page.evaluate( () => window.wp.data.select( 'core/block-editor' ).getSelectedBlockClientId() ) ).toBe( ids[ 3 ] );

		await notice.getByRole( 'button', { name: 'Undo' } ).click();
		expect( await blocksNow( page ) ).toEqual( before );
		await expect( notice ).toHaveCount( 0 );
	} );

	test( 'a copy never repeats an anchor the post already uses', async ( { page, rest } ) => {
		const anchored = ( text ) => `<!-- wp:paragraph {"anchor":"pricing"} --><p id="pricing">${ text }</p><!-- /wp:paragraph -->`;
		const created = await rest( 'POST', '/wp/v2/posts', { title: 'ABR anchors', status: 'draft', content: anchored( 'Our basic plan costs ten dollars a month.' ) } );
		const postId = created.body.id;
		await rest( 'POST', `/wp/v2/posts/${ postId }`, { content: anchored( 'Our basic plan costs twelve dollars a month.' ), status: 'publish' } );
		await rest( 'POST', `/wp/v2/posts/${ postId }`, { content: anchored( 'Our basic plan costs fifteen dollars a month.' ), status: 'publish' } );
		await openEditor( page, postId );
		const modal = await openHistory( page, await idOfBlock( page, 0 ) );

		await modal.locator( '.abr-timeline__item' ).nth( 1 ).getByRole( 'button', { name: 'Insert below as a copy' } ).click();

		const anchors = await page.evaluate( () => window.wp.data.select( 'core/block-editor' ).getBlocks().map( ( block ) => block.attributes.anchor ) );
		expect( anchors ).toEqual( [ 'pricing', 'pricing-copy' ] );
	} );

	test( 'every restore shows the notice with Undo and Compare, for a changed block in the revision view too', async ( { page, rest } ) => {
		const postId = await createPost( rest, 'ABR copy revision view' );
		await openEditor( page, postId );
		await page.getByRole( 'region', { name: 'Editor top bar' } ).getByRole( 'button', { name: 'Options' } ).click();
		await page.getByRole( 'menuitem', { name: 'Restore blocks from a revision' } ).click();
		const modal = page.getByRole( 'dialog', { name: 'Restore blocks from a revision' } );
		await expect( modal.locator( '.abr-revision' ).first() ).toBeVisible();
		const before = await blocksNow( page );

		const changed = modal.locator( '.abr-card', { hasText: 'Flour, sugar, eggs.' } );
		await changed.getByRole( 'button', { name: 'Insert below as a copy' } ).click();

		const after = await blocksNow( page );
		expect( after ).toHaveLength( before.length + 1 );
		expect( after[ 3 ] ).toBe( 'Flour, sugar, eggs.' );
		const notice = page.locator( '.components-notice', { hasText: 'Block inserted below as a copy.' } );
		await expect( notice.getByRole( 'button', { name: 'Undo' } ) ).toBeVisible();
		await expect( notice.getByRole( 'button', { name: 'Compare' } ) ).toBeVisible();
	} );
} );
