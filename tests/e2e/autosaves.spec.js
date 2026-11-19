// A colleague's unsaved work: other people's autosaves in the restore window, for the people allowed to see them only.
const { test, expect, openEditor, logInAs, wp, wpEval } = require( './utils' );
const { p, createPost, blocksNow, openPostModal } = require( './helpers' );

const UNSAVED = 'Maria unsaved paragraph about proofing overnight.';

/**
 * Saves an autosave of a post as a user, the way the editor does for that person.
 */
function autosaveAs( userId, postId, text ) {
	const content = Buffer.from( p( 'Intro about baking bread.' ) + '\n\n' + p( text ) ).toString( 'base64' );
	// Core deletes an autosave that is not newer than the post when someone opens the editor, so make it newer.
	wpEval( `sleep( 2 ); wp_set_current_user( ${ userId } ); wp_create_post_autosave( array( 'post_ID' => ${ postId }, 'post_title' => get_the_title( ${ postId } ), 'post_content' => base64_decode( '${ content }' ), 'post_type' => 'post' ) );` );
}

const stamp = () => String( Date.now() ).slice( -7 );

test.describe( 'Axle Block Restore: unsaved work of other people', () => {
	test( 'an editor sees a colleague\'s autosave with its age, and takes one block from it', async ( { page, rest } ) => {
		const maria = wp( 'user', 'create', 'maria' + stamp(), `maria${ stamp() }@example.com`, '--role=editor', '--display_name=Maria Autosave', '--user_pass=abr-pass-123', '--porcelain' );
		try {
			const postId = await createPost( rest, 'ABR unsaved work' );
			autosaveAs( maria, postId, UNSAVED );
			await openEditor( page, postId );
			await page.evaluate( () => {
				window.robRestored = [];
				window.wp.hooks.addAction( 'axleBlockRestore.restored', 'abr-e2e', ( details ) => window.robRestored.push( { mode: details.mode, revisionId: details.revisionId } ) );
			} );

			const modal = await openPostModal( page );
			const group = modal.getByRole( 'group', { name: 'Unsaved work from other people' } );
			await expect( group.getByRole( 'option' ) ).toHaveCount( 1 );
			const row = group.getByRole( 'option' ).first();
			await expect( row ).toContainText( 'Maria Autosave' );
			await expect( row ).toContainText( 'Unsaved' );
			await expect( row.locator( 'time' ) ).toHaveAttribute( 'datetime', /Z$/ );
			await expect( modal.getByRole( 'group', { name: 'Saved revisions' } ).getByRole( 'option' ).first() ).toBeVisible();

			// Saved revisions come first in what is selected; the autosave is picked on purpose.
			await expect( group.getByRole( 'option', { selected: true } ) ).toHaveCount( 0 );
			await row.click();
			await expect( modal.locator( '.abr-autosave-note' ) ).toContainText( 'unsaved work by Maria Autosave' );
			const card = modal.locator( '.abr-card', { hasText: UNSAVED } );
			await expect( card ).toHaveCount( 1 );
			await card.getByRole( 'button', { name: /Insert below|Insert at the end/ } ).first().click();
			await expect( modal ).toHaveCount( 0 );

			expect( ( await blocksNow( page ) ).join( '|' ) ).toContain( UNSAVED );
			const hooks = await page.evaluate( () => window.robRestored );
			expect( hooks ).toHaveLength( 1 );
			expect( typeof hooks[ 0 ].revisionId ).toBe( 'number' );

			// One editor undo step takes it out again.
			await page.evaluate( () => window.wp.data.dispatch( 'core/editor' ).undo() );
			expect( ( await blocksNow( page ) ).join( '|' ) ).not.toContain( UNSAVED );

			// The autosave is not history: the history of a block and the removed blocks never list it.
			await page.evaluate( () => window.wp.data.dispatch( 'core/block-editor' ).selectBlock( window.wp.data.select( 'core/block-editor' ).getBlocks()[ 0 ].clientId ) );
			const second = await openPostModal( page );
			await second.getByRole( 'tab', { name: 'Removed blocks' } ).click();
			await expect( second.getByText( UNSAVED ) ).toHaveCount( 0 );
		} finally {
			wp( 'user', 'delete', maria, '--yes', '--reassign=1' );
		}
	} );

	test( 'somebody who may not edit other people\'s posts gets no name, no text and no count', async ( { browser, rest } ) => {
		const login = 'abrcontrib' + stamp();
		const contributor = wp( 'user', 'create', login, `${ login }@example.com`, '--role=contributor', '--user_pass=abr-pass-123', '--porcelain' );
		const maria = wp( 'user', 'create', 'mariaz' + stamp(), `mariaz${ stamp() }@example.com`, '--role=editor', '--display_name=Maria Hidden', '--user_pass=abr-pass-123', '--porcelain' );
		try {
			const mine = Number( wp( 'post', 'create', '--post_title=ABR contributor draft', '--post_status=draft', `--post_author=${ contributor }`, '--post_content=<!-- wp:paragraph --><p>Intro about baking bread.</p><!-- /wp:paragraph -->', '--porcelain' ) );
			wp( 'post', 'update', String( mine ), '--post_content=<!-- wp:paragraph --><p>Intro about baking bread now.</p><!-- /wp:paragraph -->' );
			autosaveAs( maria, mine, UNSAVED );
			expect( rest ).toBeTruthy();

			const { context, page } = await logInAs( browser, login, 'abr-pass-123' );
			try {
				await openEditor( page, mine );
				const call = ( route ) =>
					page.evaluate(
						( path ) => window.wp.apiFetch( { path, parse: false } ).then( async ( response ) => ( { status: response.status, text: await response.text() } ), async ( response ) => ( { status: response.status, text: await response.text() } ) ),
						route
					);

				const route = await call( `/axle-block-restore/v1/autosaves/${ mine }` );
				expect( route.status ).toBe( 403 );
				expect( route.text ).not.toContain( 'Maria' );
				const modal = await openPostModal( page );
				await expect( modal.getByRole( 'group', { name: 'Unsaved work from other people' } ) ).toHaveCount( 0 );
				await expect( modal.getByText( 'Maria' ) ).toHaveCount( 0 );
				await expect( modal.getByText( 'proofing overnight' ) ).toHaveCount( 0 );
			} finally {
				await context.close();
			}

			// The same through the PHP the abilities and WP-CLI use: nothing for this person, the list for an editor.
			expect( wpEval( `wp_set_current_user( ${ contributor } ); echo count( AryanX\\Axle\\BlockRestore\\Autosaves::for_post( ${ mine } ) );` ) ).toBe( '0' );
			expect( wpEval( `wp_set_current_user( 1 ); echo count( AryanX\\Axle\\BlockRestore\\Autosaves::for_post( ${ mine } ) );` ) ).toBe( '1' );
			expect( wpEval( `wp_set_current_user( ${ contributor } ); $a = new AryanX\\Axle\\BlockRestore\\Abilities(); echo (int) $a->can_see_autosaves( array( 'post_id' => ${ mine } ) );` ) ).toBe( '0' );
		} finally {
			wp( 'user', 'delete', contributor, '--yes', '--reassign=1' );
			wp( 'user', 'delete', maria, '--yes', '--reassign=1' );
		}
	} );

	test( 'an editor who cannot edit that post is refused with the same answer as for a post that is not there', async ( { browser, rest } ) => {
		const login = 'abredit' + stamp();
		const author = wp( 'user', 'create', login, `${ login }@example.com`, '--role=author', '--user_pass=abr-pass-123', '--porcelain' );
		try {
			const postId = await createPost( rest, 'ABR admin only autosave' );
			autosaveAs( 1, postId, UNSAVED );
			const { context, page } = await logInAs( browser, login, 'abr-pass-123' );
			try {
				await page.goto( '/wp-admin/index.php' );
				const call = ( route ) => page.evaluate( ( path ) => window.fetch( window.location.origin + '/index.php?rest_route=' + encodeURIComponent( path ), { credentials: 'same-origin', headers: { 'X-WP-Nonce': window.wpApiSettings ? window.wpApiSettings.nonce : '' } } ).then( async ( response ) => ( { status: response.status, text: await response.text() } ) ), route );
				const real = await call( `/axle-block-restore/v1/autosaves/${ postId }` );
				const missing = await call( '/axle-block-restore/v1/autosaves/99999999' );
				expect( real.status ).toBe( missing.status );
				expect( real.text ).not.toContain( 'Maria' );
				expect( real.text ).not.toContain( 'proofing' );
			} finally {
				await context.close();
			}
		} finally {
			wp( 'user', 'delete', author, '--yes', '--reassign=1' );
		}
	} );

	test( 'abilities and WP-CLI list the autosaves, and the restore ability takes a block from one', async ( { rest } ) => {
		test.skip( 'yes' !== wpEval( "echo function_exists( 'wp_register_ability' ) ? 'yes' : 'no';" ), 'The Abilities API needs WordPress 6.9.' );
		const maria = wp( 'user', 'create', 'marias' + stamp(), `marias${ stamp() }@example.com`, '--role=editor', '--display_name=Maria Shell', '--user_pass=abr-pass-123', '--porcelain' );
		try {
			const postId = await createPost( rest, 'ABR autosave ability' );
			autosaveAs( maria, postId, UNSAVED );

			const listed = await rest( 'GET', `/wp-abilities/v1/abilities/axle-block-restore/list-autosaves/run?input[post_id]=${ postId }` );
			expect( listed.status ).toBe( 200 );
			expect( listed.body ).toHaveLength( 1 );
			expect( listed.body[ 0 ].author ).toBe( 'Maria Shell' );
			expect( listed.body[ 0 ].blocks ).toBe( 2 );

			const cli = JSON.parse( wp( 'axle-block-restore', 'autosaves', String( postId ), '--format=json' ) );
			expect( cli ).toHaveLength( 1 );
			expect( cli[ 0 ].id ).toBe( listed.body[ 0 ].id );

			// Take the second block of the autosave, inserted at the end.
			const restored = await rest( 'POST', '/wp-abilities/v1/abilities/axle-block-restore/restore-block/run', { input: { post_id: postId, revision_id: listed.body[ 0 ].id, path: [ 1 ], mode: 'insert', position: 9, force: true } } );
			expect( restored.status ).toBe( 200 );
			expect( wp( 'post', 'get', String( postId ), '--field=post_content' ) ).toContain( UNSAVED );
		} finally {
			wp( 'user', 'delete', maria, '--yes', '--reassign=1' );
		}
	} );
} );
