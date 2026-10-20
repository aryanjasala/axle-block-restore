// Records .github/media/demo.gif for the README. Run on demand: npm run demo
const { test, expect, openEditor } = require( './utils' );
const { prepareSite, recordDemo } = require( './utils/media' );

const p = ( text ) => `<!-- wp:paragraph --><p>${ text }</p><!-- /wp:paragraph -->`;
const h = ( text ) => `<!-- wp:heading --><h2 class="wp-block-heading">${ text }</h2><!-- /wp:heading -->`;

// Oldest to newest: the tip was deleted later, and the method changed.
const VERSIONS = [
	[ p( 'A starter is flour and water that has been fed for a week or two.' ), h( 'Method' ), p( 'Mix flour, sugar and eggs, then rest the dough overnight in a cool place.' ), p( 'Tip: keep a spoon of starter back before you bake, so the next loaf is ready to go.' ) ],
	[ p( 'A starter is flour and water that has been fed for a week or two.' ), h( 'Method' ), p( 'Mix flour, water and salt, then rest the dough for two hours.' ) ],
].map( ( blocks ) => blocks.join( '\n\n' ) );

test( 'demo: restore one block, then a deleted one', async ( { browser, request } ) => {
	test.setTimeout( 180_000 );
	prepareSite( 'Kitchen Notes' );
	const nonce = ( await ( await request.get( '/wp-admin/admin-ajax.php?action=rest-nonce' ) ).text() ).trim();
	const save = ( id, data ) => request.post( `/index.php?rest_route=/wp/v2/posts${ id ? '/' + id : '' }`, { headers: { 'X-WP-Nonce': nonce }, data } );
	const postId = ( await ( await save( 0, { title: 'Sourdough basics', status: 'draft', content: 'x' } ) ).json() ).id;
	for ( const content of VERSIONS ) {
		await save( postId, { content, status: 'publish' } );
	}

	try {
		await recordDemo( browser, async ( page, demo ) => {
			await openEditor( page, postId );
			const canvas = page.frameLocator( 'iframe[name="editor-canvas"]' );
			await expect( canvas.getByText( 'Mix flour, water and salt' ) ).toBeVisible();
			await demo.start();
			await demo.pause( 1200 );

			// One paragraph back to an older version, after a look at what changes.
			await demo.click( canvas.getByText( 'Mix flour, water and salt' ), 500 );
			await demo.click( page.getByRole( 'toolbar', { name: 'Block tools' } ).getByRole( 'button', { name: 'Options' } ), 400 );
			await demo.click( page.getByRole( 'menuitem', { name: 'Restore from a revision…' } ), 600 );
			const best = page.locator( '.rbr-card' ).first();
			await expect( best ).toBeVisible();
			await demo.pause( 1200 );
			await demo.click( best.getByRole( 'button', { name: 'Show changes' } ), 300 );
			await expect( best.locator( '.rbr-diff' ) ).toBeVisible();
			await demo.pause( 2200 );
			await demo.click( best.getByRole( 'button', { name: 'Replace current block' } ), 300 );
			await expect( canvas.getByText( 'Mix flour, sugar and eggs' ) ).toBeVisible();
			await demo.moveTo( canvas.getByText( 'Mix flour, sugar and eggs' ) );
			await demo.pause( 1600 );

			// A paragraph someone deleted, found by its text and put back where it was.
			await demo.click( page.getByRole( 'region', { name: 'Editor top bar' } ).getByRole( 'button', { name: 'Options' } ), 400 );
			await demo.click( page.getByRole( 'menuitem', { name: 'Restore blocks from a revision' } ), 600 );
			await demo.type( page.getByRole( 'searchbox', { name: 'Find text in old revisions' } ), 'spoon of starter' );
			const result = page.locator( '.rbr-result' );
			await expect( result ).toHaveCount( 1 );
			await demo.pause( 1000 );
			await demo.click( result.getByRole( 'button', { name: 'Show in revision' } ), 600 );
			const missing = page.locator( '.rbr-card.is-focused' );
			await expect( missing.locator( '.rbr-badge--missing' ) ).toBeVisible();
			await demo.moveTo( missing.locator( '.rbr-badge--missing' ) );
			await demo.pause( 1800 );
			await demo.click( missing.getByRole( 'button', { name: 'Restore it here' } ), 300 );
			await expect( page.locator( '.components-snackbar' ) ).toContainText( 'Block restored.' );
			await demo.moveTo( canvas.getByText( 'Tip: keep a spoon of starter back' ) );
			await demo.pause( 2000 );
		} );
	} finally {
		await request.delete( `/index.php?rest_route=/wp/v2/posts/${ postId }&force=true`, { headers: { 'X-WP-Nonce': nonce } } );
	}
} );
