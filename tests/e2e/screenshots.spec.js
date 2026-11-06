// Regenerates .wordpress-org/screenshot-N.png (readme.txt "== Screenshots ==" and README.md).
// Run on demand: npm run screenshots
const { test, expect, openEditor } = require( './utils' );
const { prepareSite, shot } = require( './utils/media' );
const p = ( text ) => `<!-- wp:paragraph --><p>${ text }</p><!-- /wp:paragraph -->`;
const h = ( text ) => `<!-- wp:heading --><h2 class="wp-block-heading">${ text }</h2><!-- /wp:heading -->`;

// Oldest to newest: the tip was deleted later, and the method changed.
const VERSIONS = [
	[ p( 'A starter is flour and water that has been fed for a week or two.' ), h( 'Method' ), p( 'Mix flour, sugar and eggs, then rest the dough overnight in a cool place.' ), p( 'Tip: keep a spoon of starter back before you bake, so the next loaf is ready to go.' ) ],
	[ p( 'A starter is flour and water that has been fed for a week or two.' ), h( 'Method' ), p( 'Mix flour, water and salt, then rest the dough for two hours.' ) ],
].map( ( blocks ) => blocks.join( '\n\n' ) );

test.describe( 'Screenshots', () => {
	test.use( { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 } );
	let postId;

	test.beforeAll( async ( { request } ) => {
		prepareSite( 'Kitchen Notes' );
		const nonce = ( await ( await request.get( '/wp-admin/admin-ajax.php?action=rest-nonce' ) ).text() ).trim();
		const save = ( id, data ) => request.post( `/index.php?rest_route=/wp/v2/posts${ id ? '/' + id : '' }`, { headers: { 'X-WP-Nonce': nonce }, data } );
		postId = ( await ( await save( 0, { title: 'Sourdough basics', status: 'draft', content: 'x' } ) ).json() ).id;
		for ( const content of VERSIONS ) {
			await save( postId, { content, status: 'publish' } );
		}
	} );

	test( '1: restoring a deleted paragraph', async ( { page } ) => {
		await openEditor( page, postId );
		await page.getByRole( 'region', { name: 'Editor top bar' } ).getByRole( 'button', { name: 'Options' } ).click();
		await page.getByRole( 'menuitem', { name: 'Restore blocks from a revision' } ).click();
		await expect( page.locator( '.abr-badge--missing' ) ).toBeVisible();
		await shot( page, 1 );
	} );

	test( '2: an earlier version of one block, with its changes highlighted', async ( { page } ) => {
		await openEditor( page, postId );
		const clientId = await page.evaluate( () => window.wp.data.select( 'core/block-editor' ).getBlocks()[ 2 ].clientId );
		await page.evaluate( ( id ) => window.wp.data.dispatch( 'core/block-editor' ).selectBlock( id ), clientId );
		await page.getByRole( 'toolbar', { name: 'Block tools' } ).getByRole( 'button', { name: 'Options' } ).click();
		await page.getByRole( 'menuitem', { name: 'Restore from a revision…' } ).click();
		const best = page.locator( '.abr-card' ).first();
		await best.getByRole( 'button', { name: 'Show changes' } ).click();
		await expect( best.locator( '.abr-diff' ) ).toBeVisible();
		await shot( page, 2 );
	} );

	test( '3: finding deleted text across revisions', async ( { page } ) => {
		await openEditor( page, postId );
		await page.getByRole( 'region', { name: 'Editor top bar' } ).getByRole( 'button', { name: 'Options' } ).click();
		await page.getByRole( 'menuitem', { name: 'Restore blocks from a revision' } ).click();
		await page.getByRole( 'searchbox', { name: 'Find text in old revisions' } ).fill( 'starter back' );
		await expect( page.locator( '.abr-result' ) ).toHaveCount( 1 );
		await shot( page, 3 );
	} );

	test( '4: restoring a block of a template part in the Site Editor', async ( { page, request } ) => {
		const nonce = ( await ( await request.get( '/wp-admin/admin-ajax.php?action=rest-nonce' ) ).text() ).trim();
		const theme = process.env.WP_THEME || 'twentytwentyfive';
		const notes = [
			[ p( 'Open Monday to Friday, from nine until five.' ), p( 'Call us on 020 7946 0000.' ) ],
			[ p( 'Open Monday to Friday, from ten until six.' ), p( 'Call us on 020 7946 0000.' ) ],
			[ p( 'Open Monday to Saturday, from ten until six.' ) ],
		];
		for ( const blocks of notes ) {
			await request.post( `/index.php?rest_route=${ encodeURIComponent( `/wp/v2/template-parts/${ theme }//header` ) }`, { headers: { 'X-WP-Nonce': nonce }, data: { slug: 'header', theme, status: 'publish', content: blocks.join( '\n\n' ) } } );
		}
		await page.goto( `/wp-admin/site-editor.php?postType=wp_template_part&postId=${ encodeURIComponent( `${ theme }//header` ) }&canvas=edit` );
		await page.waitForFunction( () => window.wp && window.wp.data && 'wp_template_part' === window.wp.data.select( 'core/editor' ).getCurrentPostType() && window.wp.data.select( 'core/block-editor' ).getBlocks().length );
		await page.evaluate( () => {
			window.wp.data.dispatch( 'core/preferences' ).set( 'core/edit-site', 'welcomeGuide', false );
			window.wp.data.dispatch( 'core/preferences' ).set( 'core/edit-site', 'welcomeGuideTemplate', false );
			window.wp.data.dispatch( 'core/preferences' ).set( 'core', 'welcomeGuide', false );
			const id = window.wp.data.select( 'core/block-editor' ).getBlocks()[ 0 ].clientId;
			window.wp.data.dispatch( 'core/block-editor' ).selectBlock( id );
		} );
		await page.getByRole( 'toolbar', { name: 'Block tools' } ).getByRole( 'button', { name: 'Options' } ).click();
		await page.getByRole( 'menuitem', { name: 'Restore from a revision…' } ).click();
		const best = page.locator( '.abr-card' ).first();
		await best.getByRole( 'button', { name: 'Show changes' } ).click();
		await expect( best.locator( '.abr-diff' ) ).toBeVisible();
		await shot( page, 4 );
	} );

	test( '5: restoring a group, with what differs inside it', async ( { page, request } ) => {
		const nonce = ( await ( await request.get( '/wp-admin/admin-ajax.php?action=rest-nonce' ) ).text() ).trim();
		const group = ( ...inner ) => `<!-- wp:group --><div class="wp-block-group">${ inner.join( '' ) }</div><!-- /wp:group -->`;
		const save = ( id, data ) => request.post( `/index.php?rest_route=/wp/v2/posts${ id ? '/' + id : '' }`, { headers: { 'X-WP-Nonce': nonce }, data } );
		const id = ( await ( await save( 0, { title: 'Weekend loaf', status: 'draft', content: 'x' } ) ).json() ).id;
		const versions = [
			group( p( 'Mix the dough and leave it for an hour.' ), p( 'Bake at 230C for 40 minutes.' ), p( 'Let it cool before slicing.' ) ),
			group( p( 'Mix the dough and leave it for an hour.' ), p( 'Bake at 200C for 30 minutes.' ), h( 'Serving' ) ),
		];
		for ( const content of versions ) {
			await save( id, { content, status: 'publish' } );
		}
		await openEditor( page, id );
		await page.getByRole( 'region', { name: 'Editor top bar' } ).getByRole( 'button', { name: 'Options' } ).click();
		await page.getByRole( 'menuitem', { name: 'Restore blocks from a revision' } ).click();
		const card = page.locator( '.abr-card', { has: page.locator( '.abr-badge--changed' ) } );
		await card.getByRole( 'button', { name: /^Inside:/ } ).click();
		await expect( card.locator( '.abr-inner__item' ).first() ).toBeVisible();
		await shot( page, 5 );
	} );
} );
