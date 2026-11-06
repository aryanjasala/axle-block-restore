const { test, expect, openEditor } = require( './utils' );
const { p, heading, group, openPostModal } = require( './helpers' );

test.describe( 'Axle Block Restore: groups and inner blocks', () => {
	test( 'restores a group with its inner blocks in one step, and one inner block from inside it', async ( { page, rest } ) => {
		const group = ( ...inner ) => `<!-- wp:group --><div class="wp-block-group">${ inner.join( '' ) }</div><!-- /wp:group -->`;
		const old = group( p( 'Alpha line.' ), p( 'Bravo old.' ), p( 'Charlie line.' ) );
		const now = group( p( 'Alpha line.' ), p( 'Bravo new.' ), heading );
		const created = await rest( 'POST', '/wp/v2/posts', { title: 'ABR groups', status: 'draft', content: 'Start' } );
		for ( const content of [ `${ old }\n\n${ p( 'Removed later.' ) }`, now ] ) {
			await rest( 'POST', `/wp/v2/posts/${ created.body.id }`, { content, status: 'publish' } );
		}
		await openEditor( page, created.body.id );
		const inner = () =>
			page.evaluate( () =>
				window.wp.data
					.select( 'core/block-editor' )
					.getBlocks()
					.map( ( block ) => block.name + ':' + block.innerBlocks.map( ( child ) => String( child.attributes.content ) ).join( '|' ) )
			);
		expect( await inner() ).toEqual( [ 'core/group:Alpha line.|Bravo new.|Ingredients' ] );

		// The list shows what differs inside the group, as counts.
		const modal = await openPostModal( page );
		const changed = modal.locator( '.abr-card', { has: page.locator( '.abr-badge--changed' ) } );
		await expect( changed ).toContainText( 'Holds 3 inner blocks' );
		const summary = changed.getByRole( 'button', { name: 'Inside: 1 added, 1 removed, 1 changed' } );
		await expect( summary ).toBeVisible();
		await summary.click();

		// One inner block back, from inside the group: the other inner blocks stay as they are.
		await changed.getByRole( 'button', { name: 'Restore this Paragraph' } ).first().click();
		await expect( modal ).toHaveCount( 0 );
		expect( await inner() ).toEqual( [ 'core/group:Alpha line.|Bravo old.|Ingredients' ] );
		await page.evaluate( () => window.wp.data.dispatch( 'core/editor' ).undo() );
		expect( await inner() ).toEqual( [ 'core/group:Alpha line.|Bravo new.|Ingredients' ] );

		// The whole group, with everything in it, in one step and one undo.
		const again = await openPostModal( page );
		await again.locator( '.abr-card', { has: page.locator( '.abr-badge--changed' ) } ).getByRole( 'button', { name: 'Replace current version' } ).click();
		expect( await inner() ).toEqual( [ 'core/group:Alpha line.|Bravo old.|Charlie line.' ] );
		await page.evaluate( () => window.wp.data.dispatch( 'core/editor' ).undo() );
		expect( await inner() ).toEqual( [ 'core/group:Alpha line.|Bravo new.|Ingredients' ] );
	} );

	test( 'a deleted group comes back whole, and one undo takes it away again', async ( { page, rest } ) => {
		const created = await rest( 'POST', '/wp/v2/posts', { title: 'ABR deleted group', status: 'draft', content: 'Start' } );
		for ( const content of [ `${ p( 'Keep me.' ) }\n\n${ group( 'Deleted note.' ) }`, p( 'Keep me.' ) ] ) {
			await rest( 'POST', `/wp/v2/posts/${ created.body.id }`, { content, status: 'publish' } );
		}
		await openEditor( page, created.body.id );

		const modal = await openPostModal( page );
		const missing = modal.locator( '.abr-card', { has: page.locator( '.abr-badge--missing' ) } );
		await expect( missing ).toContainText( 'Holds 1 inner block' );
		await missing.getByRole( 'button', { name: 'Restore it here' } ).click();
		expect( await page.evaluate( () => window.wp.data.select( 'core/block-editor' ).getBlocks().map( ( block ) => block.name + ':' + block.innerBlocks.length ) ) ).toEqual( [ 'core/paragraph:0', 'core/group:1' ] );

		await page.evaluate( () => window.wp.data.dispatch( 'core/editor' ).undo() );
		expect( await page.evaluate( () => window.wp.data.select( 'core/block-editor' ).getBlocks().map( ( block ) => block.name ) ) ).toEqual( [ 'core/paragraph' ] );
	} );
} );
