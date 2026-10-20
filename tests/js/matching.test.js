// Unit tests for the pure matching helpers. Run: npm run test:unit (from ~/wp-plugins).
const test = require( 'node:test' );
const assert = require( 'node:assert/strict' );
const m = require( '../../assets/js/matching.js' );

test( 'textFromMarkup strips block comments, tags and entities', () => {
	assert.equal(
		m.textFromMarkup( '<!-- wp:paragraph --><p>Salt &amp; pepper,&nbsp;<strong>to taste</strong></p><!-- /wp:paragraph -->' ),
		'Salt & pepper, to taste'
	);
} );

test( 'similarity is 1 for the same words and 0 for none shared', () => {
	assert.equal( m.similarity( 'flour sugar eggs', 'Eggs sugar FLOUR' ), 1 );
	assert.equal( m.similarity( 'flour sugar', 'water salt' ), 0 );
	assert.equal( m.similarity( 'flour sugar eggs', 'flour water salt' ), 0.2 );
	assert.equal( m.similarity( '', '' ), 1 );
} );

test( 'flatten lists nested blocks with their paths', () => {
	const tree = [ { name: 'a' }, { name: 'group', innerBlocks: [ { name: 'b' }, { name: 'c' } ] } ];
	assert.deepEqual(
		m.flatten( tree ).map( ( item ) => [ item.block.name, item.path.join( '.' ) ] ),
		[ [ 'a', '0' ], [ 'group', '1' ], [ 'b', '1.0' ], [ 'c', '1.1' ] ]
	);
} );

test( 'rankCandidates prefers the same position, then shared words, and flags identical blocks', () => {
	const target = { name: 'p', path: [ 2 ], text: 'flour water salt', print: 'now' };
	const ranked = m.rankCandidates(
		[
			{ name: 'p', path: [ 0 ], text: 'intro about bread', print: 'a' },
			{ name: 'h', path: [ 1 ], text: 'flour water salt', print: 'b' },
			{ name: 'p', path: [ 2 ], text: 'flour sugar eggs', print: 'c' },
			{ name: 'p', path: [ 3 ], text: 'flour water salt', print: 'now' },
		],
		target
	);

	assert.deepEqual( ranked.map( ( item ) => item.print ), [ 'c', 'now', 'a' ] );
	assert.equal( ranked[ 0 ].samePosition, true );
	assert.equal( ranked[ 1 ].same, true );
} );

test( 'classify marks blocks as same, changed or missing', () => {
	const now = [ { name: 'p', print: 'intro' }, { name: 'h', print: 'heading' }, { name: 'p', print: 'water' } ];
	const old = [ { name: 'p', print: 'intro' }, { name: 'h', print: 'heading' }, { name: 'p', print: 'sugar' }, { name: 'p', print: 'closing' } ];
	assert.deepEqual( m.classify( old, now ), [ 'same', 'same', 'changed', 'missing' ] );
} );

test( 'wordDiff marks removed and added words and keeps the rest', () => {
	const parts = m.wordDiff( 'Flour, water, salt.', 'Flour, sugar, eggs.' );
	assert.deepEqual( parts, [
		{ type: 'same', text: 'Flour, ' },
		{ type: 'removed', text: 'water, salt.' },
		{ type: 'added', text: 'sugar, eggs.' },
	] );
	assert.equal(
		parts.filter( ( p ) => p.type !== 'removed' ).map( ( p ) => p.text ).join( '' ),
		'Flour, sugar, eggs.'
	);
} );

test( 'wordDiff falls back to whole texts for very long inputs', () => {
	const long = 'word '.repeat( 600 );
	assert.deepEqual( m.wordDiff( long, long + 'x' ).map( ( p ) => p.type ), [ 'removed', 'added' ] );
} );

test( 'search groups identical text across revisions and skips containers', () => {
	const revisions = [
		{ id: 3, items: [ { path: [ 0 ], name: 'p', text: 'Intro' } ] },
		{
			id: 2,
			items: [
				{ path: [ 0 ], name: 'group', text: 'Old closing line here' },
				{ path: [ 0, 0 ], name: 'p', text: 'Old closing line here' },
			],
		},
		{ id: 1, items: [ { path: [ 3 ], name: 'p', text: 'Old closing line here' } ] },
	];

	const results = m.search( revisions, 'closing LINE' );
	assert.equal( results.length, 1 );
	assert.equal( results[ 0 ].name, 'p' );
	assert.deepEqual( results[ 0 ].revisionIds, [ 2, 1 ] );
	assert.deepEqual( m.search( revisions, 'x' ), [] );
} );

test( 'excerpt centres on the match', () => {
	const text = 'a'.repeat( 100 ) + ' needle ' + 'b'.repeat( 100 );
	const short = m.excerpt( text, 'needle', 40 );
	assert.ok( short.includes( 'needle' ) );
	assert.ok( short.startsWith( '…' ) && short.endsWith( '…' ) );
	assert.equal( m.excerpt( 'short', 'x', 40 ), 'short' );
} );
