// Every translatable string in the editor scripts has to name the text domain
// as a literal, or `wp i18n make-pot` skips it and the string never gets translated.
const { test } = require( 'node:test' );
const assert = require( 'node:assert' );
const fs = require( 'fs' );
const path = require( 'path' );

const DOMAIN = "'restore-one-block'";

for ( const file of [ 'components.js', 'index.js' ] ) {
	test( `${ file }: every translation call has the literal text domain`, () => {
		const source = fs.readFileSync( path.join( __dirname, '..', '..', 'assets', 'js', file ), 'utf8' );
		const calls = source.match( /\b(?:__|_x|_n|_nx)\(\s*'/g ) || [];
		const domains = source.match( new RegExp( DOMAIN + '\\s*\\)', 'g' ) ) || [];

		assert.ok( calls.length > 0, 'no translation calls found' );
		assert.strictEqual( domains.length, calls.length, `${ calls.length } translation calls, ${ domains.length } with ${ DOMAIN }` );
	} );
}
