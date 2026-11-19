// The address that opens a block's history, and the small things that came with it: the window's title follows the tab, Preview comes first, copies drop the Note link.
const { test, expect, openEditor, wpEval } = require( './utils' );
const { p, createPost, blocksNow, openPostModal } = require( './helpers' );

/**
 * The ID of the oldest revision that has some text.
 */
async function revisionWith( rest, postId, text ) {
	const list = await rest( 'GET', `/wp/v2/posts/${ postId }/revisions?context=edit&per_page=50` );
	const found = list.body.filter( ( revision ) => revision.content.raw.includes( text ) );
	return found[ found.length - 1 ].id;
}

const link = ( postId, query ) => `/wp-admin/post.php?post=${ postId }&action=edit&axle-block-restore=history&${ query }`;

async function waitForEditor( page ) {
	await page.waitForFunction( () => window.wp && window.wp.data && window.wp.data.select( 'core/editor' ).getCurrentPostId() );
}

test.describe( 'Axle Block Restore: history link', () => {
	test( 'a link with a revision and a path opens that block\'s history on that revision', async ( { page, rest } ) => {
		const postId = await createPost( rest, 'ABR link history' );
		// Position 0 in the oldest revision was "Intro paragraph about cooking."
		const revision = await revisionWith( rest, postId, 'Intro paragraph about cooking.' );

		await page.goto( link( postId, `revision=${ revision }&path=0` ) );
		await waitForEditor( page );
		const modal = page.getByRole( 'dialog', { name: 'History of this Paragraph' } );
		await expect( modal ).toBeVisible();
		await expect( modal.getByRole( 'tab', { name: 'Block history' } ) ).toHaveAttribute( 'aria-selected', 'true' );
		await expect( modal.locator( '.abr-history' ) ).toHaveAttribute( 'aria-busy', 'false' );

		const linked = modal.locator( '.abr-history__entry.is-linked' );
		await expect( linked ).toHaveCount( 1 );
		await expect( linked ).toContainText( 'From your link' );
		await expect( linked ).toContainText( 'Intro paragraph about cooking.' );
		// The link leaves the address bar, so a reload does not open the window again.
		expect( page.url() ).not.toContain( 'axle-block-restore' );
		expect( page.url() ).not.toContain( 'axle-revision' );
		expect( page.url() ).toContain( `post=${ postId }` );
	} );

	test( 'the path is the position in that revision, found again in the post as it is now', async ( { page, rest } ) => {
		const postId = await createPost( rest, 'ABR link moved' );
		// In the oldest revision, "Flour, sugar, eggs." was block 2. Now block 2 reads "Flour, water, salt."
		const revision = await revisionWith( rest, postId, 'Flour, sugar, eggs.' );

		await page.goto( link( postId, `revision=${ revision }&path=2` ) );
		await waitForEditor( page );
		const modal = page.getByRole( 'dialog', { name: 'History of this Paragraph' } );
		await expect( modal ).toBeVisible();
		await expect( modal.locator( '.abr-history__entry.is-linked' ) ).toContainText( 'Flour, sugar, eggs.' );
		// The block it matched is selected in the editor.
		const selected = await page.evaluate( () => window.wp.data.select( 'core/block-editor' ).getSelectedBlock().attributes.content );
		expect( String( selected ) ).toContain( 'Flour, water, salt.' );
	} );

	test( 'without a revision the path is the position in the post now, and an anchor works too', async ( { page, rest } ) => {
		const anchored = '<!-- wp:paragraph {"anchor":"pricing"} --><p id="pricing">Pricing starts at ten dollars.</p><!-- /wp:paragraph -->';
		const postId = await createPost( rest, 'ABR link anchor' );
		await rest( 'POST', `/wp/v2/posts/${ postId }`, { content: p( 'Opening line.' ) + '\n\n' + anchored } );
		await rest( 'POST', `/wp/v2/posts/${ postId }`, { content: p( 'Opening line.' ) + '\n\n' + anchored.replace( 'ten', 'twelve' ) } );

		await page.goto( link( postId, 'anchor=pricing' ) );
		await waitForEditor( page );
		let modal = page.getByRole( 'dialog', { name: 'History of this Paragraph' } );
		await expect( modal.locator( '.abr-history__entry' ).first() ).toContainText( 'twelve dollars' );
		await expect( modal.locator( '.abr-history__entry' ).nth( 1 ) ).toContainText( 'ten dollars' );

		await page.goto( link( postId, 'path=1' ) );
		await waitForEditor( page );
		modal = page.getByRole( 'dialog', { name: 'History of this Paragraph' } );
		await expect( modal.locator( '.abr-history__entry' ).first() ).toContainText( 'twelve dollars' );
	} );

	test( 'a block that is gone opens the revision instead, and says so', async ( { page, rest } ) => {
		const postId = await createPost( rest, 'ABR link gone' );
		const revision = await revisionWith( rest, postId, 'Old closing line that someone deleted.' );

		// Block 4 of that revision has no counterpart now.
		await page.goto( link( postId, `revision=${ revision }&path=4` ) );
		await waitForEditor( page );
		const modal = page.getByRole( 'dialog', { name: 'Restore blocks from a revision' } );
		await expect( modal ).toBeVisible();
		await expect( modal.getByText( 'is not in this post any more' ) ).toBeVisible();
		await expect( modal.getByRole( 'option', { selected: true } ) ).toHaveCount( 1 );
		await expect( modal.locator( '.abr-card', { hasText: 'Old closing line that someone deleted.' } ) ).toHaveCount( 1 );

		// A revision that does not exist, or damaged values, still open the window.
		await page.goto( link( postId, 'revision=99999999&path=abc' ) );
		await waitForEditor( page );
		await expect( page.getByRole( 'dialog', { name: 'Restore blocks from a revision' } ) ).toBeVisible();
		await expect( page.getByRole( 'dialog' ).locator( '.abr-revision' ).first() ).toBeVisible();
	} );

	test( 'a JavaScript filter can switch the link off', async ( { page, rest } ) => {
		const postId = await createPost( rest, 'ABR link off' );
		await page.addInitScript( () => {
			const timer = window.setInterval( () => {
				if ( window.wp && window.wp.hooks && window.axleBlockRestore ) {
					window.wp.hooks.addFilter( 'axleBlockRestore.deepLinkEnabled', 'abr-e2e', () => false );
					window.clearInterval( timer );
				}
			}, 1 );
		} );
		await page.goto( link( postId, 'path=0' ) );
		await waitForEditor( page );
		await page.waitForTimeout( 1500 );
		await expect( page.getByRole( 'dialog' ) ).toHaveCount( 0 );
	} );
} );

test.describe( 'Axle Block Restore: window title, button order and Notes', () => {
	test( 'the title follows the tab', async ( { page, rest } ) => {
		const postId = await createPost( rest, 'ABR titles' );
		await openEditor( page, postId );
		const id = await page.evaluate( () => window.wp.data.select( 'core/block-editor' ).getBlocks()[ 0 ].clientId );
		await page.evaluate( ( clientId ) => window.wp.data.dispatch( 'core/block-editor' ).selectBlock( clientId ), id );
		await page.getByRole( 'toolbar', { name: 'Block tools' } ).getByRole( 'button', { name: 'Options' } ).click();
		await page.getByRole( 'menuitem', { name: 'Restore from a revision…' } ).click();
		const modal = page.getByRole( 'dialog' );
		await expect( page.getByRole( 'dialog', { name: 'Restore this Paragraph from a revision' } ) ).toBeVisible();

		await modal.getByRole( 'tab', { name: 'Block history' } ).click();
		await expect( page.getByRole( 'dialog', { name: 'History of this Paragraph' } ) ).toBeVisible();
		await modal.getByRole( 'tab', { name: 'Removed blocks' } ).click();
		await expect( page.getByRole( 'dialog', { name: 'Removed blocks' } ) ).toBeVisible();
		await modal.getByRole( 'tab', { name: 'Another post' } ).click();
		await expect( page.getByRole( 'dialog', { name: 'Copy from another post' } ) ).toBeVisible();
		await modal.getByRole( 'tab', { name: 'By revision' } ).click();
		await expect( page.getByRole( 'dialog', { name: 'Restore this Paragraph from a revision' } ) ).toBeVisible();
	} );

	test( 'Preview is the first button of an entry, in the history and in the revision list', async ( { page, rest } ) => {
		const postId = await createPost( rest, 'ABR button order' );
		await openEditor( page, postId );
		const id = await page.evaluate( () => window.wp.data.select( 'core/block-editor' ).getBlocks()[ 0 ].clientId );
		await page.evaluate( ( clientId ) => window.wp.data.dispatch( 'core/block-editor' ).selectBlock( clientId ), id );
		await page.getByRole( 'toolbar', { name: 'Block tools' } ).getByRole( 'button', { name: 'Options' } ).click();
		await page.getByRole( 'menuitem', { name: 'Block history' } ).click();
		const modal = page.getByRole( 'dialog', { name: 'History of this Paragraph' } );
		const entry = modal.locator( '.abr-history__entry', { hasText: 'Intro paragraph about cooking.' } ).last();
		await expect( entry ).toBeVisible();
		await expect( entry.locator( '.abr-card__actions button' ).first() ).toHaveText( 'Preview' );
		await expect( entry.locator( '.abr-card__actions button' ).nth( 1 ) ).toHaveText( 'Replace current block' );

		await modal.getByRole( 'tab', { name: 'By revision' } ).click();
		const card = page.getByRole( 'dialog' ).locator( '.abr-card' ).first();
		await expect( card.locator( '.abr-card__actions button' ).first() ).toHaveText( 'Preview' );
	} );

	test( 'a copy has no Note link, and a replacement keeps the thread of the block it replaces', async ( { page, rest } ) => {
		const note = ( id, text ) => `<!-- wp:paragraph {"metadata":{"noteId":${ id },"name":"Tagline"}} --><p>${ text }</p><!-- /wp:paragraph -->`;
		const created = await rest( 'POST', '/wp/v2/posts', { title: 'ABR notes', status: 'draft', content: 'Start' } );
		const postId = created.body.id;
		await rest( 'POST', `/wp/v2/posts/${ postId }`, { content: note( 5, 'Our tagline for the spring launch this year.' ), status: 'publish' } );
		await rest( 'POST', `/wp/v2/posts/${ postId }`, { content: note( 7, 'Our tagline for the autumn launch this year.' ) } );

		await openEditor( page, postId );
		const meta = () => page.evaluate( () => window.wp.data.select( 'core/block-editor' ).getBlocks().map( ( block ) => block.attributes.metadata ) );
		expect( await meta() ).toEqual( [ { noteId: 7, name: 'Tagline' } ] );
		await page.evaluate( () => window.wp.data.dispatch( 'core/block-editor' ).selectBlock( window.wp.data.select( 'core/block-editor' ).getBlocks()[ 0 ].clientId ) );
		await page.getByRole( 'toolbar', { name: 'Block tools' } ).getByRole( 'button', { name: 'Options' } ).click();
		await page.getByRole( 'menuitem', { name: 'Block history' } ).click();
		const modal = page.getByRole( 'dialog', { name: 'History of this Paragraph' } );
		const old = modal.locator( '.abr-history__entry', { hasText: 'Our tagline for the spring launch this year.' } );
		await old.getByRole( 'button', { name: 'Insert below as a copy' } ).click();
		await expect( modal ).toHaveCount( 0 );
		expect( await meta() ).toEqual( [ { noteId: 7, name: 'Tagline' }, { name: 'Tagline' } ] );

		await page.evaluate( () => window.wp.data.dispatch( 'core/editor' ).undo() );
		await page.evaluate( () => window.wp.data.dispatch( 'core/block-editor' ).selectBlock( window.wp.data.select( 'core/block-editor' ).getBlocks()[ 0 ].clientId ) );
		await page.getByRole( 'toolbar', { name: 'Block tools' } ).getByRole( 'button', { name: 'Options' } ).click();
		await page.getByRole( 'menuitem', { name: 'Block history' } ).click();
		const again = page.getByRole( 'dialog', { name: 'History of this Paragraph' } );
		await again.locator( '.abr-history__entry', { hasText: 'Our tagline for the spring launch this year.' } ).getByRole( 'button', { name: 'Replace current block' } ).click();
		await expect( again ).toHaveCount( 0 );
		expect( await meta() ).toEqual( [ { noteId: 7, name: 'Tagline' } ] );
		expect( ( await blocksNow( page ) )[ 0 ] ).toBe( 'Our tagline for the spring launch this year.' );
	} );
} );

test.describe( 'Axle Block Restore: Site Editor post types and the abilities', () => {
	test( 'taking synced patterns out of the Site Editor list takes them out of the abilities', async () => {
		const pattern = wpEval( "echo wp_insert_post( array( 'post_type' => 'wp_block', 'post_status' => 'publish', 'post_title' => 'ABR pattern', 'post_content' => '<!-- wp:paragraph --><p>Pattern.</p><!-- /wp:paragraph -->' ) );" );
		const ask = ( filter ) => wpEval( `${ filter } wp_set_current_user( 1 ); $a = new AryanX\\Axle\\BlockRestore\\Abilities(); echo (int) $a->can_edit( array( 'post_id' => ${ pattern } ) );` );
		try {
			expect( ask( '' ) ).toBe( '1' );
			expect( ask( "add_filter( 'axle_block_restore_site_editor_post_types', static function () { return array( 'wp_template', 'wp_template_part' ); } );" ) ).toBe( '0' );
		} finally {
			wpEval( `wp_delete_post( ${ pattern }, true );` );
		}
	} );
} );
