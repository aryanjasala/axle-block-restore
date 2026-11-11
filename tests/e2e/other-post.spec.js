const { test, expect, openEditor, logInAs, wp } = require( './utils' );
const { p, createPost, blocksNow, openPostModal } = require( './helpers' );

test.describe( 'Axle Block Restore: copy a block from another post', () => {
	test( 'searches posts, picks a version and inserts a block below the selected one or at the end', async ( { page, rest } ) => {
		const source = await rest( 'POST', '/wp/v2/posts', { title: 'ABR source recipe', status: 'draft', content: 'Start' } );
		await rest( 'POST', `/wp/v2/posts/${ source.body.id }`, { content: p( 'Source old beta line.' ) + '\n\n' + p( 'Source alpha line.' ), status: 'publish' } );
		await rest( 'POST', `/wp/v2/posts/${ source.body.id }`, { content: p( 'Source alpha line.' ) } );
		const targetId = await createPost( rest, 'ABR target page' );
		await openEditor( page, targetId );
		await page.evaluate( () => {
			window.robRestored = [];
			window.wp.hooks.addAction( 'axleBlockRestore.restored', 'abr-e2e', ( details ) => window.robRestored.push( { mode: details.mode, revisionId: details.revisionId, sourcePostId: details.sourcePostId } ) );
		} );
		const heading = await page.evaluate( () => window.wp.data.select( 'core/block-editor' ).getBlocks()[ 1 ].clientId );
		await page.evaluate( ( id ) => window.wp.data.dispatch( 'core/block-editor' ).selectBlock( id ), heading );

		const modal = await openPostModal( page );
		await modal.getByRole( 'tab', { name: 'Another post' } ).click();

		// The search lists posts by title, and the post being edited is not offered.
		await modal.getByRole( 'searchbox', { name: 'Search posts and pages' } ).fill( 'ABR' );
		const results = modal.locator( '.abr-result' );
		await expect( results.filter( { hasText: 'ABR source recipe' } ) ).toHaveCount( 1 );
		await expect( results.filter( { hasText: 'ABR target page' } ) ).toHaveCount( 0 );
		await results.filter( { hasText: 'ABR source recipe' } ).getByRole( 'button', { name: 'Choose this post' } ).click();

		// Current version first.
		const version = modal.getByLabel( 'Version to copy from' );
		await expect( version ).toContainText( 'Current version, saved' );
		await expect( modal.locator( '.abr-card' ) ).toHaveCount( 1 );
		await modal.getByRole( 'searchbox', { name: 'Filter blocks by text' } ).fill( 'nothing like this' );
		await expect( modal.getByText( 'No block in this version matches that text.' ) ).toBeVisible();
		await modal.getByRole( 'searchbox', { name: 'Filter blocks by text' } ).fill( '' );

		await modal.locator( '.abr-card', { hasText: 'Source alpha line.' } ).getByRole( 'button', { name: 'Insert below the selected block' } ).click();
		await expect( modal ).toHaveCount( 0 );
		await expect( page.locator( '.components-snackbar' ) ).toContainText( 'Block restored.' );
		let now = await blocksNow( page );
		expect( now ).toHaveLength( 5 );
		expect( now[ 2 ] ).toBe( 'Source alpha line.' );
		await page.evaluate( () => window.wp.data.dispatch( 'core/editor' ).undo() );
		expect( await blocksNow( page ) ).toHaveLength( 4 );

		// An older revision, inserted at the end.
		await page.evaluate( () => window.wp.data.dispatch( 'core/block-editor' ).clearSelectedBlock() );
		const second = await openPostModal( page );
		await second.getByRole( 'tab', { name: 'Another post' } ).click();
		await second.locator( '.abr-result', { hasText: 'ABR source recipe' } ).getByRole( 'button', { name: 'Choose this post' } ).click();
		await expect( second.getByRole( 'button', { name: 'Insert below the selected block' } ) ).toHaveCount( 0 );
		await second.getByLabel( 'Version to copy from' ).selectOption( { index: 2 } );
		await second.locator( '.abr-card', { hasText: 'Source old beta line.' } ).getByRole( 'button', { name: 'Insert at the end' } ).click();
		await expect( second ).toHaveCount( 0 );
		now = await blocksNow( page );
		expect( now.pop() ).toBe( 'Source old beta line.' );

		const hooks = await page.evaluate( () => window.robRestored );
		expect( hooks.map( ( item ) => [ item.mode, item.sourcePostId ] ) ).toEqual( [
			[ 'other-post-below', source.body.id ],
			[ 'other-post-end', source.body.id ],
		] );
		expect( hooks[ 0 ].revisionId ).toBe( 'current' );
		expect( typeof hooks[ 1 ].revisionId ).toBe( 'number' );
	} );

	test( 'offers only posts the user can edit, and the server refuses the rest', async ( { browser, rest } ) => {
		const login = 'abrauthor' + Date.now();
		const user = wp( 'user', 'create', login, `${ login }@example.com`, '--role=author', '--user_pass=abr-pass-123', '--porcelain' );
		const mine = wp( 'post', 'create', '--post_title=ABR mine one', '--post_status=draft', `--post_author=${ user }`, '--post_content=<!-- wp:paragraph --><p>Mine one.</p><!-- /wp:paragraph -->', '--porcelain' );
		wp( 'post', 'create', '--post_title=ABR mine two', '--post_status=draft', `--post_author=${ user }`, '--post_content=<!-- wp:paragraph --><p>Mine two.</p><!-- /wp:paragraph -->', '--porcelain' );
		const secret = await rest( 'POST', '/wp/v2/posts', { title: 'ABR admin published secret', status: 'publish', content: p( 'Admin only.' ) } );
		await rest( 'POST', '/wp/v2/posts', { title: 'ABR admin draft secret', status: 'draft', content: p( 'Admin draft only.' ) } );

		const { context, page } = await logInAs( browser, login, 'abr-pass-123' );
		try {
			await openEditor( page, Number( mine ) );
			const call = ( route ) =>
				page.evaluate( ( path ) => window.wp.apiFetch( { path, parse: false } ).then( async ( response ) => ( { status: response.status, body: await response.json() } ), async ( response ) => ( { status: response.status, body: await response.json() } ) ), route );

			const found = await call( '/axle-block-restore/v1/posts?search=ABR&per_page=20' );
			expect( found.status ).toBe( 200 );
			expect( found.body.map( ( item ) => item.title ).sort() ).toEqual( [ 'ABR mine one', 'ABR mine two' ] );
			expect( JSON.stringify( found.body ) ).not.toContain( 'secret' );
			// Asking for a post type by name, or for a lot, changes nothing about who can be seen.
			expect( ( await call( '/axle-block-restore/v1/posts?search=secret&post_type=post&per_page=50' ) ).body ).toEqual( [] );
			// Core's own endpoints refuse the published post the author can read but not edit.
			expect( ( await call( `/wp/v2/posts/${ secret.body.id }/revisions?context=edit` ) ).status ).toBe( 403 );
			expect( ( await call( `/wp/v2/posts/${ secret.body.id }?context=edit` ) ).status ).toBe( 403 );

			// The window lists the same two posts only.
			const modalReady = page.getByRole( 'region', { name: 'Editor top bar' } ).getByRole( 'button', { name: 'Options' } );
			await modalReady.click();
			await page.getByRole( 'menuitem', { name: 'Restore blocks from a revision' } ).click();
			const modal = page.getByRole( 'dialog', { name: 'Restore blocks from a revision' } );
			await modal.getByRole( 'tab', { name: 'Another post' } ).click();
			await expect( modal.locator( '.abr-result' ) ).toHaveCount( 1 );
			await expect( modal.locator( '.abr-result' ) ).toContainText( 'ABR mine two' );
			await modal.getByRole( 'searchbox', { name: 'Search posts and pages' } ).fill( 'secret' );
			await expect( modal.getByText( 'None of the posts you can edit match that search.' ) ).toBeVisible();
		} finally {
			await context.close();
			wp( 'user', 'delete', user, '--yes', '--reassign=1' );
		}
	} );

	test( 'a JavaScript filter hides the view', async ( { page, rest } ) => {
		const postId = await createPost( rest, 'ABR copy off' );
		await openEditor( page, postId );
		await page.evaluate( () => window.wp.hooks.addFilter( 'axleBlockRestore.copyPostTypes', 'abr-e2e', () => [] ) );
		const modal = await openPostModal( page );
		await expect( modal.getByRole( 'tab', { name: 'Removed blocks' } ) ).toBeVisible();
		await expect( modal.getByRole( 'tab', { name: 'Another post' } ) ).toHaveCount( 0 );
	} );
} );
