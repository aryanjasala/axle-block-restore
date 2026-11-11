// Unit tests for the removed blocks helpers. Run: npm run test:unit:js
const test = require( 'node:test' );
const assert = require( 'node:assert/strict' );
const m = require( '../../assets/js/matching.js' );

// A block as the editor describes it: type, path, text and a fingerprint of its markup.
const block = ( name, path, text, print ) => ( { name, path, text, print: print || name + ':' + text } );

test( 'removedBlocks lists blocks that are in a revision and not in the post, newest removal first', () => {
	const current = [ block( 'core/paragraph', [ 0 ], 'Intro about baking bread.' ) ];
	const revisions = [
		{ id: 30, items: [ block( 'core/paragraph', [ 0 ], 'Intro about baking bread.' ), block( 'core/paragraph', [ 1 ], 'Recently deleted closing line about cleanup.' ) ] },
		{ id: 20, items: [ block( 'core/paragraph', [ 0 ], 'Intro about baking bread.' ), block( 'core/quote', [ 1 ], 'Old pull quote nobody wanted.' ) ] },
	];
	const removed = m.removedBlocks( revisions, current );

	assert.deepEqual( removed.map( ( item ) => [ item.name, item.revisionId, item.revisionIndex ] ), [
		[ 'core/paragraph', 30, 0 ],
		[ 'core/quote', 20, 1 ],
	] );
} );

test( 'removedBlocks lists a block that stayed gone across several revisions once, with every revision', () => {
	const gone = block( 'core/paragraph', [ 1 ], 'Gone for good, this sentence.' );
	const revisions = [
		{ id: 3, items: [ block( 'core/paragraph', [ 0 ], 'Kept.' ), gone ] },
		{ id: 2, items: [ block( 'core/paragraph', [ 0 ], 'Kept.' ), gone ] },
		{ id: 1, items: [ gone ] },
	];
	const removed = m.removedBlocks( revisions, [ block( 'core/paragraph', [ 0 ], 'Kept.' ) ] );

	assert.equal( removed.length, 1 );
	assert.equal( removed[ 0 ].revisionId, 3 );
	assert.deepEqual( removed[ 0 ].revisionIds, [ 3, 2, 1 ] );
} );

test( 'removedBlocks keeps only the newest version of a block that was edited before it was removed', () => {
	const revisions = [
		{ id: 3, items: [ block( 'core/paragraph', [ 0 ], 'Mix flour water salt and rest the dough for two hours.' ) ] },
		{ id: 2, items: [ block( 'core/paragraph', [ 0 ], 'Mix flour water salt and rest the dough overnight.' ) ] },
	];
	const removed = m.removedBlocks( revisions, [ block( 'core/heading', [ 0 ], 'Something else entirely' ) ] );

	assert.deepEqual( removed.map( ( item ) => item.revisionId ), [ 3 ] );
	assert.deepEqual( removed[ 0 ].revisionIds, [ 3, 2 ] );
} );

test( 'removedBlocks does not call an edited block removed', () => {
	const current = [ block( 'core/paragraph', [ 0 ], 'Flour, water, salt, and a little olive oil.' ) ];
	const revisions = [ { id: 1, items: [ block( 'core/paragraph', [ 0 ], 'Flour, water, salt, and a little oil.' ) ] } ];

	assert.deepEqual( m.removedBlocks( revisions, current ), [] );
	// A stricter threshold counts it as removed.
	assert.equal( m.removedBlocks( revisions, current, { similarity: 1 } ).length, 1 );
} );

test( 'removedBlocks lists nested blocks, and a removed container once, without its children', () => {
	const revisions = [
		{
			id: 1,
			items: [
				block( 'core/group', [ 0 ], 'Inner note one Inner note two' ),
				block( 'core/paragraph', [ 0, 0 ], 'Inner note one' ),
				block( 'core/paragraph', [ 0, 1 ], 'Inner note two' ),
				block( 'core/group', [ 1 ], 'Kept note about heat Removed child about time' ),
				block( 'core/paragraph', [ 1, 0 ], 'Kept note about heat' ),
				block( 'core/paragraph', [ 1, 1 ], 'Removed child about time' ),
			],
		},
	];
	const current = [ block( 'core/group', [ 0 ], 'Kept note about heat' ), block( 'core/paragraph', [ 0, 0 ], 'Kept note about heat' ) ];
	const removed = m.removedBlocks( revisions, current );

	assert.deepEqual( removed.map( ( item ) => [ item.name, item.path.join( '.' ) ] ), [
		[ 'core/group', '0' ],
		[ 'core/paragraph', '1.1' ],
	] );
} );

test( 'removedBlocks skips empty paragraphs but keeps blocks that have no text by design', () => {
	const revisions = [ { id: 1, items: [ block( 'core/paragraph', [ 0 ], '' ), block( 'core/spacer', [ 1 ], '', 'spacer:100' ), block( 'core/spacer', [ 2 ], '', 'spacer:200' ) ] } ];
	const removed = m.removedBlocks( revisions, [] );

	assert.deepEqual( removed.map( ( item ) => item.print ), [ 'spacer:100', 'spacer:200' ] );
} );

test( 'removedBlocks with nothing removed or no revisions returns an empty list', () => {
	const same = block( 'core/paragraph', [ 0 ], 'Same.' );
	assert.deepEqual( m.removedBlocks( [ { id: 1, items: [ same ] } ], [ same ] ), [] );
	assert.deepEqual( m.removedBlocks( [], [ same ] ), [] );
} );

const revision = [
	block( 'core/paragraph', [ 0 ], 'First paragraph here.' ),
	block( 'core/heading', [ 1 ], 'Middle heading here' ),
	block( 'core/paragraph', [ 2 ], 'The removed block text.' ),
	block( 'core/paragraph', [ 3 ], 'Closing words, thank you.' ),
];

test( 'placement puts a block after its nearest earlier neighbour that still exists', () => {
	const current = [ revision[ 0 ], block( 'core/image', [ 1 ], '', 'img' ), revision[ 1 ], revision[ 3 ].name && block( 'core/paragraph', [ 3 ], 'Closing words, thank you.' ) ];
	assert.deepEqual( m.placement( revision, revision[ 2 ], current ), { parentPath: [], index: 3, anchored: true, nested: false } );
} );

test( 'placement falls back to the nearest later neighbour, then to the old index limited to the list', () => {
	const afterOnly = [ block( 'core/image', [ 0 ], '', 'img' ), revision[ 3 ] ];
	assert.deepEqual( m.placement( revision, revision[ 2 ], afterOnly ), { parentPath: [], index: 1, anchored: true, nested: false } );

	const nothingShared = [ block( 'core/image', [ 0 ], '', 'img' ) ];
	assert.deepEqual( m.placement( revision, revision[ 2 ], nothingShared ), { parentPath: [], index: 1, anchored: false, nested: false } );
	assert.deepEqual( m.placement( revision, revision[ 2 ], [] ), { parentPath: [], index: 0, anchored: false, nested: false } );
} );

test( 'placement returns a nested block to the counterpart of its old parent', () => {
	const old = [
		block( 'core/paragraph', [ 0 ], 'Before the group.' ),
		block( 'core/group', [ 1 ], 'Note one Note two' ),
		block( 'core/paragraph', [ 1, 0 ], 'Note one' ),
		block( 'core/paragraph', [ 1, 1 ], 'Note two' ),
	];
	// The group moved up to the top of the post; its first note is still there.
	const current = [ block( 'core/group', [ 0 ], 'Note one' ), block( 'core/paragraph', [ 0, 0 ], 'Note one' ) ];

	assert.deepEqual( m.placement( old, old[ 3 ], current ), { parentPath: [ 0 ], index: 1, anchored: true, nested: true } );
} );

test( 'placement puts a nested block at the top level when its parent is gone', () => {
	const old = [ block( 'core/paragraph', [ 0 ], 'Intro text.' ), block( 'core/group', [ 1 ], 'Only child' ), block( 'core/paragraph', [ 1, 0 ], 'Only child' ) ];
	const current = [ block( 'core/paragraph', [ 0 ], 'Intro text.' ) ];

	assert.deepEqual( m.placement( old, old[ 2 ], current ), { parentPath: [], index: 1, anchored: true, nested: false } );
} );

test( 'removedBlocks marks a block as rewritten when the same type sits at its old place now', () => {
	const current = [ block( 'core/paragraph', [ 0 ], 'Flour, water, salt.' ) ];
	const revisions = [ { id: 1, items: [ block( 'core/paragraph', [ 0 ], 'Flour, sugar, eggs.' ), block( 'core/quote', [ 1 ], 'A quote that went away.' ) ] } ];
	const removed = m.removedBlocks( revisions, current );

	assert.deepEqual( removed.map( ( item ) => [ item.name, item.rewritten ] ), [ [ 'core/paragraph', true ], [ 'core/quote', false ] ] );
} );

test( 'placement treats an edited neighbour as the neighbour', () => {
	const old = [ block( 'core/paragraph', [ 0 ], 'Bake at 200C for twenty minutes.' ), block( 'core/paragraph', [ 1 ], 'Removed one.' ), block( 'core/heading', [ 2 ], 'End' ) ];
	const current = [ block( 'core/paragraph', [ 0 ], 'Bake at 220C for twenty minutes.' ), block( 'core/heading', [ 1 ], 'End' ) ];

	assert.deepEqual( m.placement( old, old[ 1 ], current ), { parentPath: [], index: 1, anchored: true, nested: false } );
} );
