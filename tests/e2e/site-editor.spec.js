const { test, expect, wp, wpEval } = require( './utils' );

const THEME = process.env.WP_THEME || 'twentytwentyfive';
const p = ( text ) => `<!-- wp:paragraph --><p>${ text }</p><!-- /wp:paragraph -->`;
const VERSIONS = [ [ p( 'Header note: open from nine.' ), p( 'Header line two.' ) ], [ p( 'Header note: open from ten.' ), p( 'Header line two.' ) ], [ p( 'Header note: open from eleven.' ) ] ].map( ( blocks ) => blocks.join( '\n\n' ) );

/**
 * Saves one revision per version of a template, template part or pattern through the REST API.
 */
async function saveVersions( rest, route, extra, versions = VERSIONS ) {
	for ( const content of versions ) {
		const saved = await rest( 'POST', route, Object.assign( { content, status: 'publish' }, extra ) );
		expect( saved.status, JSON.stringify( saved.body ) ).toBeLessThan( 300 );
	}
}

async function openSiteEditor( page, postType, postId ) {
	await page.goto( `/wp-admin/site-editor.php?postType=${ postType }&postId=${ encodeURIComponent( postId ) }&canvas=edit` );
	await page.waitForFunction( ( type ) => window.wp && window.wp.data && window.wp.data.select( 'core/editor' ).getCurrentPostType() === type && window.wp.data.select( 'core/block-editor' ).getBlocks().length > 0, postType );
	await page.evaluate( () => {
		window.wp.data.dispatch( 'core/preferences' ).set( 'core/edit-site', 'welcomeGuide', false );
		window.wp.data.dispatch( 'core/preferences' ).set( 'core/edit-site', 'welcomeGuideStyles', false );
		window.wp.data.dispatch( 'core/preferences' ).set( 'core/edit-site', 'welcomeGuideTemplate', false );
		window.wp.data.dispatch( 'core/preferences' ).set( 'core', 'welcomeGuide', false );
	} );
	const guide = page.getByRole( 'dialog', { name: /welcome/i } );
	if ( await guide.isVisible().catch( () => false ) ) {
		await page.keyboard.press( 'Escape' );
	}
}

const textsOf = ( page ) =>
	page.evaluate( () =>
		window.wp.data
			.select( 'core/block-editor' )
			.getBlocks()
			.map( ( block ) => String( block.attributes.content ) )
	);

/**
 * Runs a command from the command palette (the same one Ctrl+K opens).
 */
async function runCommand( page, label ) {
	await page.evaluate( () => window.wp.data.dispatch( 'core/commands' ).open() );
	const box = page.getByRole( 'combobox', { name: /Search (commands|for commands)/i } );
	await box.fill( label );
	await page.getByRole( 'option', { name: label } ).first().click();
}

async function selectAndOpenMenu( page, clientId ) {
	await page.evaluate( ( id ) => window.wp.data.dispatch( 'core/block-editor' ).selectBlock( id ), clientId );
	await page.getByRole( 'toolbar', { name: 'Block tools' } ).getByRole( 'button', { name: 'Options' } ).click();
	await page.getByRole( 'menuitem', { name: 'Restore from a revision…' } ).click();
	const modal = page.getByRole( 'dialog', { name: /^Restore this .* from a revision$/ } );
	await expect( modal.locator( '.abr-revision' ).first() ).toBeVisible();
	return modal;
}

test.describe( 'Axle Block Restore in the Site Editor', () => {
	// Customised templates, parts and patterns live in the database. Start each test from the theme's files.
	test.beforeEach( () => {
		wpEval( "foreach ( get_posts( array( 'post_type' => array( 'wp_template', 'wp_template_part', 'wp_block' ), 'post_status' => 'any', 'numberposts' => -1 ) ) as $post ) { wp_delete_post( $post->ID, true ); }" );
	} );

	test( 'restores one block of a template part from an older save', async ( { page, rest } ) => {
		await saveVersions( rest, `/wp/v2/template-parts/${ THEME }//header`, { slug: 'header', theme: THEME } );
		await openSiteEditor( page, 'wp_template_part', `${ THEME }//header` );
		expect( await textsOf( page ) ).toEqual( [ 'Header note: open from eleven.' ] );

		const clientId = await page.evaluate( () => window.wp.data.select( 'core/block-editor' ).getBlocks()[ 0 ].clientId );
		const modal = await selectAndOpenMenu( page, clientId );
		// The first save only creates the template part in the database, so three saves leave two revisions.
		await expect( modal.getByRole( 'option' ) ).toHaveCount( 2 );

		const best = modal.locator( '.abr-card' ).first();
		await expect( best ).toContainText( 'Header note: open from ten.' );
		await best.getByRole( 'button', { name: 'Show changes' } ).click();
		await expect( best.locator( '.abr-diff del' ) ).toHaveText( 'eleven.' );
		await best.getByRole( 'button', { name: 'Replace current block' } ).click();
		expect( await textsOf( page ) ).toEqual( [ 'Header note: open from ten.' ] );

		// Saving writes the restored block to the template part, which makes a new revision.
		await page.evaluate( ( id ) => window.wp.data.dispatch( 'core' ).saveEditedEntityRecord( 'postType', 'wp_template_part', id ), `${ THEME }//header` );
		await expect.poll( async () => ( await rest( 'GET', `/wp/v2/template-parts/${ THEME }//header?context=edit` ) ).body.content.raw ).toContain( 'open from ten.' );
	} );

	test( 'brings a deleted block of a template part back from the main menu', async ( { page, rest } ) => {
		await saveVersions( rest, `/wp/v2/template-parts/${ THEME }//header`, { slug: 'header', theme: THEME } );
		await openSiteEditor( page, 'wp_template_part', `${ THEME }//header` );

		await page.getByRole( 'region', { name: 'Editor top bar' } ).getByRole( 'button', { name: 'Options' } ).click();
		await page.getByRole( 'menuitem', { name: 'Restore blocks from a revision' } ).click();
		const modal = page.getByRole( 'dialog', { name: 'Restore blocks from a revision' } );
		await expect( modal.locator( '.abr-revision' ).first() ).toBeVisible();

		const missing = modal.locator( '.abr-card', { has: page.locator( '.abr-badge--missing' ) } );
		await expect( missing ).toContainText( 'Header line two.' );
		await missing.getByRole( 'button', { name: 'Restore it here' } ).click();
		expect( await textsOf( page ) ).toEqual( [ 'Header note: open from eleven.', 'Header line two.' ] );
	} );

	test( 'a block inside a template part, opened from a template, restores from the part\'s own revisions', async ( { page, rest } ) => {
		await saveVersions( rest, `/wp/v2/template-parts/${ THEME }//header`, { slug: 'header', theme: THEME } );
		await openSiteEditor( page, 'wp_template', `${ THEME }//index` );

		// The part's blocks load after the template's.
		const find = () => {
			const select = window.wp.data.select( 'core/block-editor' );
			const part = select
				.getBlocksByName( 'core/template-part' )
				.map( ( id ) => select.getBlock( id ) )
				.find( ( block ) => 'header' === block.attributes.slug );
			return part && select.getBlockOrder( part.clientId ).length ? select.getBlockOrder( part.clientId )[ 0 ] : null;
		};
		await page.waitForFunction( find );
		const clientId = await page.evaluate( find );

		// Blocks inside a template part are locked to content editing in a template, so the block menu has no
		// restore item there (the part opens with "Edit original"). The command palette still reaches them.
		await page.evaluate( ( id ) => window.wp.data.dispatch( 'core/block-editor' ).selectBlock( id ), clientId );
		await runCommand( page, 'Restore selected block from a revision' );
		const modal = page.getByRole( 'dialog', { name: /^Restore this .* from a revision$/ } );
		await expect( modal.locator( '.abr-revision' ).first() ).toBeVisible();
		await expect( modal.getByRole( 'option' ) ).toHaveCount( 2 );
		await modal.locator( '.abr-card' ).first().getByRole( 'button', { name: 'Replace current block' } ).click();

		// The change is in the template part, not in the template.
		await expect
			.poll( () =>
				page.evaluate( ( id ) => {
					const edits = window.wp.data.select( 'core' ).getEntityRecordEdits( 'postType', 'wp_template_part', id ) || {};
					return ( edits.blocks || [] ).map( ( block ) => String( block.attributes.content ) );
				}, `${ THEME }//header` )
			)
			.toEqual( [ 'Header note: open from ten.' ] );
		// What saving the template would write has the part as a reference, never its blocks.
		const templateMarkup = await page.evaluate( () => {
			const edits = window.wp.data.select( 'core' ).getEntityRecordEdits( 'postType', 'wp_template', 'twentytwentyfive//index' ) || {};
			return window.wp.blocks.serialize( edits.blocks || window.wp.data.select( 'core/block-editor' ).getBlocks() );
		} );
		expect( templateMarkup ).toContain( 'wp:template-part' );
		expect( templateMarkup ).not.toContain( 'open from' );
	} );

	test( 'restores from a template\'s revisions, and says when a template has none', async ( { page, rest } ) => {
		const route = `/wp/v2/templates/${ THEME }//page`;
		const body = ( text ) => `<!-- wp:post-title /-->\n\n${ p( text ) }`;
		await saveVersions( rest, route, { slug: 'page', theme: THEME }, [ body( 'Template says one.' ), body( 'Template says two.' ), body( 'Template says three.' ) ] );
		await openSiteEditor( page, 'wp_template', `${ THEME }//page` );

		const clientId = await page.evaluate( () => window.wp.data.select( 'core/block-editor' ).getBlocks().find( ( block ) => 'core/paragraph' === block.name ).clientId );
		const modal = await selectAndOpenMenu( page, clientId );
		const best = modal.locator( '.abr-card' ).first();
		await expect( best ).toContainText( 'Template says two.' );
		await best.getByRole( 'button', { name: 'Replace current block' } ).click();
		expect( ( await textsOf( page ) ).filter( ( text ) => text && 'undefined' !== text ) ).toEqual( [ 'Template says two.' ] );

		// A template that still comes from the theme's files has no revisions.
		await openSiteEditor( page, 'wp_template', `${ THEME }//single` );
		await page.getByRole( 'region', { name: 'Editor top bar' } ).getByRole( 'button', { name: 'Options' } ).click();
		await page.getByRole( 'menuitem', { name: 'Restore blocks from a revision' } ).click();
		await expect( page.getByRole( 'dialog', { name: 'Restore blocks from a revision' } ) ).toContainText( 'still comes from the theme' );
	} );

	test( 'restores a block of a synced pattern', async ( { page, rest } ) => {
		const created = await rest( 'POST', '/wp/v2/blocks', { title: 'ABR pattern', status: 'publish', content: VERSIONS[ 0 ] } );
		for ( const content of VERSIONS.slice( 1 ) ) {
			await rest( 'POST', `/wp/v2/blocks/${ created.body.id }`, { content, status: 'publish' } );
		}
		await openSiteEditor( page, 'wp_block', String( created.body.id ) );

		const clientId = await page.evaluate( () => window.wp.data.select( 'core/block-editor' ).getBlocks()[ 0 ].clientId );
		const modal = await selectAndOpenMenu( page, clientId );
		await modal.locator( '.abr-card' ).first().getByRole( 'button', { name: 'Replace current block' } ).click();
		expect( ( await textsOf( page ) )[ 0 ] ).toBe( 'Header note: open from ten.' );
		wp( 'post', 'delete', String( created.body.id ), '--force' );
	} );

	test( 'the REST path checks permissions: an editor cannot read template revisions, an admin can', async ( { rest } ) => {
		await saveVersions( rest, `/wp/v2/template-parts/${ THEME }//header`, { slug: 'header', theme: THEME } );
		await saveVersions( rest, `/wp/v2/templates/${ THEME }//page`, { slug: 'page', theme: THEME } );
		const pattern = ( await rest( 'POST', '/wp/v2/blocks', { title: 'ABR perms', status: 'publish', content: VERSIONS[ 0 ] } ) ).body.id;
		await rest( 'POST', `/wp/v2/blocks/${ pattern }`, { content: VERSIONS[ 1 ], status: 'publish' } );
		const login = `editor${ Date.now() }`;
		const editor = wp( 'user', 'create', login, `${ login }@example.com`, '--role=editor', '--porcelain' );
		// Status of the revisions route for a user, as the editor would call it.
		const status = ( user, route ) =>
			wpEval( `wp_set_current_user( ${ user } ); $r = new WP_REST_Request( 'GET', '${ route }' ); $r->set_query_params( array( 'context' => 'edit' ) ); echo rest_do_request( $r )->get_status();` );
		try {
			expect( status( 1, `/wp/v2/template-parts/${ THEME }//header/revisions` ) ).toBe( '200' );
			expect( status( editor, `/wp/v2/template-parts/${ THEME }//header/revisions` ) ).toBe( '403' );
			expect( status( editor, `/wp/v2/templates/${ THEME }//page/revisions` ) ).toBe( '403' );
			// Editors may edit synced patterns, so they may read their revisions.
			expect( status( editor, `/wp/v2/blocks/${ pattern }/revisions` ) ).toBe( '200' );
			// Nobody but the owner of a private post type sees its screens: the script is not even loaded.
			const types = wpEval( `wp_set_current_user( ${ editor } ); echo implode( ',', \\AryanX\\Axle\\BlockRestore\\Plugin::editable_post_types() );` ).split( ',' );
			expect( types ).toContain( 'wp_block' );
			expect( types ).not.toContain( 'wp_template' );
			expect( types ).not.toContain( 'wp_template_part' );
		} finally {
			wp( 'user', 'delete', editor, '--yes' );
			wp( 'post', 'delete', String( pattern ), '--force' );
		}
	} );
} );
