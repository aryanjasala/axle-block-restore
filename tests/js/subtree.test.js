// Unit tests for comparing the inner blocks of a block with a revision's version.
const test = require( 'node:test' );
const assert = require( 'node:assert/strict' );
const m = require( '../../assets/js/matching.js' );

const b = ( name, content, innerBlocks = [] ) => ( { name, attributes: { content }, innerBlocks } );

test( 'diffTree finds nothing when the trees match', () => {
	const tree = b( 'core/group', '', [ b( 'core/paragraph', 'a' ), b( 'core/paragraph', 'b' ) ] );
	assert.deepEqual( m.diffTree( tree, tree ), [] );
} );

test( 'diffTree reports changed, added and removed inner blocks with paths', () => {
	const old = b( 'core/group', '', [ b( 'core/heading', 'Title' ), b( 'core/paragraph', 'Old text' ), b( 'core/paragraph', 'Gone later' ) ] );
	const cur = b( 'core/group', '', [ b( 'core/heading', 'Title' ), b( 'core/paragraph', 'New text' ), b( 'core/image', 'x' ) ] );
	const entries = m.diffTree( old, cur );

	assert.deepEqual( entries.map( ( e ) => e.type ), [ 'changed', 'added', 'removed' ] );
	assert.deepEqual( entries[ 0 ].oldPath, [ 1 ] );
	assert.deepEqual( entries[ 0 ].curPath, [ 1 ] );
	assert.deepEqual( entries[ 1 ].oldPath, [ 2 ] );
	assert.deepEqual( entries[ 1 ].parentPath, [] );
	assert.deepEqual( entries[ 2 ].curPath, [ 2 ] );
	assert.deepEqual( m.summarizeDiff( entries ), { added: 1, removed: 1, changed: 1 } );
} );

test( 'diffTree goes into blocks that are paired and counts what differs deeper', () => {
	const old = b( 'core/group', '', [ b( 'core/columns', '', [ b( 'core/column', '', [ b( 'core/paragraph', 'Was here' ) ] ) ] ) ] );
	const cur = b( 'core/group', '', [ b( 'core/columns', '', [ b( 'core/column', '', [ b( 'core/paragraph', 'Is here' ) ] ) ] ) ] );
	const entries = m.diffTree( old, cur );

	assert.equal( entries.length, 1 );
	assert.deepEqual( entries[ 0 ].oldPath, [ 0, 0, 0 ] );
	assert.deepEqual( entries[ 0 ].curPath, [ 0, 0, 0 ] );
	assert.equal( m.blockAt( cur, entries[ 0 ].curPath ).attributes.content, 'Is here' );
} );

test( 'an added block counts with everything inside it, and says where it would go', () => {
	const old = b( 'core/group', '', [ b( 'core/paragraph', 'Keep' ), b( 'core/group', '', [ b( 'core/paragraph', 'x' ), b( 'core/paragraph', 'y' ) ] ) ] );
	const cur = b( 'core/group', '', [ b( 'core/paragraph', 'Keep' ) ] );
	const entries = m.diffTree( old, cur );

	assert.equal( entries.length, 1 );
	assert.equal( entries[ 0 ].index, 1 );
	assert.deepEqual( m.summarizeDiff( entries ), { added: 3, removed: 0, changed: 0 } );
} );

test( 'a block that is not in the post counts all its inner blocks as added', () => {
	const old = b( 'core/group', '', [ b( 'core/paragraph', 'a' ), b( 'core/paragraph', 'b' ) ] );
	assert.deepEqual( m.summarizeDiff( m.diffTree( old, null ) ), { added: 2, removed: 0, changed: 0 } );
} );

test( 'identical inner blocks that moved do not show as changed', () => {
	const x = b( 'core/paragraph', 'x' );
	const y = b( 'core/paragraph', 'y' );
	const entries = m.diffTree( b( 'core/group', '', [ x, y ] ), b( 'core/group', '', [ y, x ] ) );
	// One of the two is matched in place; the other shows up as removed and added, never as changed.
	assert.ok( entries.every( ( e ) => 'changed' !== e.type ) );
} );

test( 'countBlocks and blockAt walk the tree', () => {
	const tree = b( 'g', '', [ b( 'a', '' ), b( 'g', '', [ b( 'c', '' ) ] ) ] );
	assert.equal( m.countBlocks( tree ), 4 );
	assert.equal( m.blockAt( tree, [ 1, 0 ] ).name, 'c' );
	assert.equal( m.blockAt( tree, [] ), tree );
	assert.equal( m.blockAt( tree, [ 5 ] ), null );
} );
