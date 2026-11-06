// Helpers shared by this plugin's end-to-end specs: posts with revisions and the two ways to open the restore window.
const { expect } = require( './utils' );

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
	await expect( modal.locator( '.abr-revision' ).first() ).toBeVisible();
	return modal;
}

async function openBlockModal( page, clientId ) {
	await page.evaluate( ( id ) => window.wp.data.dispatch( 'core/block-editor' ).selectBlock( id ), clientId );
	await page.getByRole( 'toolbar', { name: 'Block tools' } ).getByRole( 'button', { name: 'Options' } ).click();
	await page.getByRole( 'menuitem', { name: 'Restore from a revision…' } ).click();
	const modal = page.getByRole( 'dialog', { name: /^Restore this .* from a revision$/ } );
	await expect( modal.locator( '.abr-revision' ).first() ).toBeVisible();
	return modal;
}

module.exports = { p, heading, group, VERSIONS, createPost, blocksNow, openPostModal, openBlockModal };
