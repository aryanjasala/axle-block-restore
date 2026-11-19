// Unit tests for the address that opens a block's history, and for copies that must not share a Note. Run: npm run test:unit:js
const test = require( 'node:test' );
const assert = require( 'node:assert/strict' );
const m = require( '../../assets/js/matching.js' );

test( 'a history link gives the revision and the path of the block', () => {
	assert.deepEqual( m.parseDeepLink( '?post=12&action=edit&axle-block-restore=history&revision=345&path=2,0' ), { revision: 345, path: [ 2, 0 ], anchor: '', clientId: '' } );
} );

test( 'the revision is read from axle-revision first, and from revision too', () => {
	assert.equal( m.parseDeepLink( 'axle-block-restore=history&axle-revision=12&revision=99' ).revision, 12 );
	assert.equal( m.parseDeepLink( 'axle-block-restore=history&revision=99' ).revision, 99 );
} );

test( 'a link by anchor or client ID is read', () => {
	const id = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
	assert.equal( m.parseDeepLink( 'axle-block-restore=history&anchor=pricing' ).anchor, 'pricing' );
	assert.equal( m.parseDeepLink( 'axle-block-restore=history&clientId=' + id ).clientId, id );
} );

test( 'an address without the history value is not a link', () => {
	assert.equal( m.parseDeepLink( 'post=12&action=edit' ), null );
	assert.equal( m.parseDeepLink( 'axle-block-restore=other' ), null );
	assert.equal( m.parseDeepLink( '' ), null );
} );

test( 'damaged values are dropped and the link still opens', () => {
	const link = m.parseDeepLink( 'axle-block-restore=history&revision=abc&path=1;2&clientId=not-an-id&anchor=' + 'a'.repeat( 500 ) );
	assert.equal( link.revision, 0 );
	assert.deepEqual( link.path, [] );
	assert.equal( link.clientId, '' );
	assert.equal( link.anchor.length, 200 );
	assert.equal( m.parseDeepLink( 'axle-block-restore=history&revision=-5' ).revision, 0 );
	assert.equal( m.parseDeepLink( 'axle-block-restore=history&revision=7x' ).revision, 0 );
	assert.deepEqual( m.parseDeepLink( 'axle-block-restore=history&path=-1' ).path, [] );
} );

const note = ( metadata, innerBlocks = [] ) => ( { name: 'core/paragraph', attributes: { content: 'Hi', metadata }, innerBlocks } );

test( 'a copy loses the Note link, also inside nested blocks, and keeps other metadata', () => {
	const original = note( { noteId: 12, name: 'Intro' }, [ note( { noteId: [ 3, 4 ] } ), note( undefined ) ] );
	const copy = m.withoutNoteIds( original );

	assert.deepEqual( copy.attributes.metadata, { name: 'Intro' } );
	assert.equal( 'metadata' in copy.innerBlocks[ 0 ].attributes, false );
	assert.equal( copy.innerBlocks[ 1 ].attributes.metadata, undefined );
	// The block given is not changed.
	assert.equal( original.attributes.metadata.noteId, 12 );
	assert.deepEqual( original.innerBlocks[ 0 ].attributes.metadata.noteId, [ 3, 4 ] );
} );

test( 'a block with no Note is returned as an equal copy', () => {
	const original = { name: 'core/heading', attributes: { content: 'T' }, innerBlocks: [] };
	assert.deepEqual( m.withoutNoteIds( original ), original );
} );
