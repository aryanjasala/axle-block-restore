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
} );
