// Unit tests for the block history: following one block back through revisions. Run: npm run test:unit:js
const test = require( 'node:test' );
const assert = require( 'node:assert/strict' );
const m = require( '../../assets/js/matching.js' );

// A block as the editor describes it: type, path, text, fingerprint and the block itself.
const item = ( name, path, text, attributes = {}, innerBlocks = [] ) => ( {
	name,
	path,
	text,
	print: JSON.stringify( [ name, text, attributes, innerBlocks.map( ( inner ) => inner.print ) ] ),
	block: { name, attributes: Object.assign( { content: text }, attributes ), innerBlocks: innerBlocks.map( ( inner ) => inner.block ) },
} );
const para = ( path, text, attributes ) => item( 'core/paragraph', path, text, attributes );
const revision = ( id, items, author = 'Sam' ) => ( { id, when: '2026-11-0' + ( id % 9 ) + 'T10:00:00Z', author, autosave: false, items } );

const history = ( target, revisions, options ) => m.timelineEntries( m.advanceTimeline( m.startTimeline( target ), revisions, options ) );
const types = ( entries ) => entries.map( ( entry ) => entry.type );

const OLD = 'Our basic plan costs ten dollars a month and includes every feature.';
const MID = 'Our basic plan costs twelve dollars a month and includes every feature.';
const NOW = 'Our basic plan costs fifteen dollars a month and includes every feature.';

test( 'a block edited in two saves has an entry for each version, newest first, with who and when', () => {
	const target = para( [ 2 ], NOW );
	const entries = history( target, [
		revision( 30, [ para( [ 2 ], NOW ) ], 'Ana' ),
		revision( 20, [ para( [ 2 ], MID ) ], 'Ben' ),
		revision( 10, [ para( [ 2 ], OLD ) ], 'Cy' ),
	] );

	assert.deepEqual( types( entries ), [ 'edited', 'edited', 'first' ] );
	assert.deepEqual( entries.map( ( entry ) => entry.revisionId ), [ 30, 20, 10 ] );
	assert.deepEqual( entries.map( ( entry ) => entry.author ), [ 'Ana', 'Ben', 'Cy' ] );
	assert.equal( entries[ 0 ].previous.text, MID );
	assert.equal( entries[ 0 ].change.text, true );
} );

test( 'saves that did not change the block are counted, not listed', () => {
	const target = para( [ 0 ], NOW );
	const entries = history( target, [
		revision( 4, [ para( [ 0 ], NOW ), para( [ 1 ], 'Other text edited here.' ) ] ),
		revision( 3, [ para( [ 0 ], NOW ), para( [ 1 ], 'Other text.' ) ] ),
		revision( 2, [ para( [ 0 ], NOW ) ] ),
		revision( 1, [ para( [ 0 ], OLD ) ] ),
	] );

	assert.deepEqual( types( entries ), [ 'edited', 'first' ] );
	assert.deepEqual( entries[ 0 ].revisionIds, [ 2, 3, 4 ] );
	assert.equal( entries[ 0 ].revisionId, 2 );
} );

test( 'a block that only moved has no entry for the move', () => {
	const target = para( [ 0 ], NOW );
	const entries = history( target, [
		revision( 3, [ para( [ 0 ], NOW ), para( [ 1 ], 'A closing line nobody has touched.' ) ] ),
		revision( 2, [ para( [ 0 ], 'A closing line nobody has touched.' ), para( [ 1 ], NOW ) ] ),
		revision( 1, [ para( [ 0 ], 'A closing line nobody has touched.' ), para( [ 1 ], OLD ) ] ),
	] );

	assert.deepEqual( types( entries ), [ 'edited', 'first' ] );
	assert.equal( entries[ 0 ].revisionId, 2 );
	assert.deepEqual( entries[ 0 ].item.path, [ 1 ] );
} );

test( 'an edit and a move in the same save still follow the block', () => {
	const target = para( [ 0 ], NOW );
	const entries = history( target, [
		revision( 2, [ para( [ 0 ], NOW ), para( [ 1 ], 'Something else entirely, with other words.' ) ] ),
		revision( 1, [ para( [ 0 ], 'Something else entirely, with other words.' ), para( [ 1 ], OLD ) ] ),
	] );

	assert.deepEqual( types( entries ), [ 'edited', 'first' ] );
	assert.equal( entries[ 1 ].item.text, OLD );
} );

test( 'a paragraph that was split keeps the history of the original in each half', () => {
	const original = 'Mix the flour and the water first, then add the salt and rest the dough overnight.';
	const first = 'Mix the flour and the water first, then add the salt';
	const second = 'and rest the dough overnight.';
	const revisions = [ revision( 2, [ para( [ 0 ], first ), para( [ 1 ], second ) ] ), revision( 1, [ para( [ 0 ], original ) ] ) ];

	const top = history( para( [ 0 ], first ), revisions );
	assert.deepEqual( types( top ), [ 'edited', 'first' ] );
	assert.equal( top[ 1 ].item.text, original );

	// The second half has no words in common with enough of the original at its own place, so it starts at the split.
	const bottom = history( para( [ 1 ], second ), revisions );
	assert.equal( bottom[ bottom.length - 1 ].item.text.length > 0, true );
	assert.equal( bottom[ 0 ].revisionId, 2 );
} );

test( 'copies of a block follow the nearest copy and do not cut the history short', () => {
	const line = 'Call us today for a free quote.';
	const target = para( [ 3 ], line );
	const now = [ para( [ 0 ], line ), para( [ 1 ], 'Middle.' ), para( [ 2 ], 'More.' ), target ];
	const entries = m.timelineEntries( m.advanceTimeline( m.startTimeline( target, now ), [
		revision( 3, [ para( [ 0 ], line ), para( [ 1 ], 'Middle.' ), para( [ 2 ], 'More.' ), para( [ 3 ], line ) ] ),
		revision( 2, [ para( [ 0 ], line ), para( [ 1 ], 'Middle.' ), para( [ 2 ], 'More.' ), para( [ 3 ], 'Call us today for your free quote.' ) ] ),
		revision( 1, [ para( [ 0 ], line ), para( [ 1 ], 'Middle.' ), para( [ 2 ], 'More.' ) ] ),
	] ) );

	// The copy at path 3 was edited in save 2 and put back in save 3, not mistaken for the untouched copy at path 0.
	assert.deepEqual( types( entries ), [ 'edited', 'edited', 'first' ] );
	assert.deepEqual( entries.map( ( entry ) => entry.revisionId ), [ 3, 2, 1 ] );
} );

test( 'a block wrapped in a group later keeps its history from before the wrap', () => {
	const group = ( inner ) => item( 'core/group', [ 0 ], inner.text, {}, [ inner ] );
	const target = para( [ 0, 0 ], NOW );
	const wrapped = ( text ) => {
		const inner = para( [ 0, 0 ], text );
		return [ group( inner ), inner ];
	};
	const entries = history( target, [
		revision( 3, wrapped( NOW ) ),
		revision( 2, [ para( [ 0 ], NOW ) ] ),
		revision( 1, [ para( [ 0 ], OLD ) ] ),
	] );

	assert.deepEqual( types( entries ), [ 'edited', 'first' ] );
	assert.equal( entries[ 0 ].revisionId, 2 );
	assert.deepEqual( entries[ 0 ].item.path, [ 0 ] );
} );

test( 'a group is followed through edits to the blocks inside it, with the inner changes counted', () => {
	const group = ( texts ) => item( 'core/group', [ 0 ], texts.join( ' ' ), {}, texts.map( ( text, index ) => para( [ 0, index ], text ) ) );
	const entries = history( group( [ 'Preheat the oven.', 'Bake for 30 minutes.' ] ), [
		revision( 2, [ group( [ 'Preheat the oven.', 'Bake for 30 minutes.' ] ) ] ),
		revision( 1, [ group( [ 'Preheat the oven.', 'Bake for 40 minutes.' ] ) ] ),
	] );

	assert.deepEqual( types( entries ), [ 'edited', 'first' ] );
	assert.deepEqual( entries[ 0 ].change.inner, { added: 0, removed: 0, changed: 1 } );
} );

test( 'a block that was removed and added back shows both', () => {
	const target = para( [ 0 ], NOW );
	const entries = history( target, [
		revision( 4, [ para( [ 0 ], NOW ) ] ),
		revision( 3, [ para( [ 0 ], 'Completely different words about shipping policy.' ) ] ),
		revision( 2, [ para( [ 0 ], 'Completely different words about shipping policy.' ) ] ),
		revision( 1, [ para( [ 0 ], OLD ) ] ),
	] );

	assert.ok( types( entries ).includes( 'first' ) );
	const empty = history( target, [
		revision( 3, [ para( [ 0 ], NOW ) ] ),
		revision( 2, [ item( 'core/heading', [ 0 ], 'A heading only' ) ] ),
		revision( 1, [ para( [ 0 ], OLD ) ] ),
	] );
	assert.deepEqual( types( empty ), [ 'readded', 'removed', 'first' ] );
	assert.equal( empty[ 0 ].previous.text, OLD );
	assert.equal( empty[ 1 ].revisionId, 2 );
} );

test( 'a block that first appears in a later save is added there', () => {
	const target = para( [ 1 ], NOW );
	const entries = history( target, [ revision( 2, [ para( [ 0 ], 'Intro to the page, nothing else.' ), para( [ 1 ], NOW ) ] ), revision( 1, [ para( [ 0 ], 'Intro to the page, nothing else.' ) ] ) ] );

	assert.deepEqual( types( entries ), [ 'added' ] );
	assert.equal( entries[ 0 ].revisionId, 2 );
} );

test( 'unsaved changes in the editor come first, marked as the current version', () => {
	const target = para( [ 0 ], NOW );
	const entries = history( target, [ revision( 2, [ para( [ 0 ], MID ) ] ), revision( 1, [ para( [ 0 ], OLD ) ] ) ] );

	assert.deepEqual( types( entries ), [ 'edited', 'edited', 'first' ] );
	assert.equal( entries[ 0 ].revisionId, 'current' );
	assert.equal( entries[ 0 ].previous.text, MID );
} );

test( 'a block that is the same as in the newest save has no current entry', () => {
	const entries = history( para( [ 0 ], NOW ), [ revision( 1, [ para( [ 0 ], NOW ) ] ) ] );

	assert.deepEqual( types( entries ), [ 'first' ] );
} );

test( 'looking through revisions a page at a time gives the same timeline as all at once', () => {
	const target = para( [ 0 ], NOW );
	const revisions = [ revision( 4, [ para( [ 0 ], NOW ) ] ), revision( 3, [ para( [ 0 ], MID ) ] ), revision( 2, [ para( [ 0 ], MID ) ] ), revision( 1, [ para( [ 0 ], OLD ) ] ) ];
	const paged = m.advanceTimeline( m.advanceTimeline( m.startTimeline( target ), revisions.slice( 0, 2 ) ), revisions.slice( 2 ) );
	const whole = m.advanceTimeline( m.startTimeline( target ), revisions );
	const before = m.startTimeline( target );
	m.advanceTimeline( before, revisions );

	assert.deepEqual( types( m.timelineEntries( paged ) ), types( m.timelineEntries( whole ) ) );
	assert.equal( before.steps.length, 0 );
} );

test( 'a block with no text follows its place, and settings changes are named', () => {
	const image = ( src ) => item( 'core/image', [ 1 ], '', { url: src } );
	const entries = history( image( 'b.jpg' ), [ revision( 2, [ image( 'b.jpg' ) ] ), revision( 1, [ image( 'a.jpg' ) ] ) ] );

	assert.deepEqual( types( entries ), [ 'edited', 'first' ] );
	assert.deepEqual( entries[ 0 ].change, { text: false, attributes: [ 'url' ], inner: null } );
} );

test( 'describeChange leaves content attributes out when the text already shows them', () => {
	const before = para( [ 0 ], OLD, { align: 'left' } );
	const after = para( [ 0 ], NOW, { align: 'center' } );
	const role = ( name ) => ( 'content' === name ? 'content' : 'style' );

	assert.deepEqual( m.describeChange( before, after, role ), { text: true, attributes: [ 'align' ], inner: null } );
	assert.equal( m.describeChange( null, after ), null );
} );

test( 'the similarity thresholds can be changed', () => {
	const target = para( [ 5 ], 'one two three four five six' );
	const old = [ revision( 1, [ para( [ 0 ], 'one two three nine ten eleven' ) ] ) ];

	assert.deepEqual( types( history( target, old ) ), [ 'added' ] );
	assert.deepEqual( types( history( target, old, { similarity: 0.2 } ) ), [ 'edited', 'first' ] );
} );

test( 'uniqueAnchors renames an anchor already in the post, inside blocks too, and keeps the input', () => {
	const group = item( 'core/group', [ 0 ], '', { anchor: 'pricing' }, [ para( [ 0, 0 ], 'x', { anchor: 'intro' } ) ] );
	const taken = new Set( [ 'pricing', 'intro', 'pricing-copy' ] );
	const copy = m.uniqueAnchors( group.block, taken );

	assert.equal( copy.attributes.anchor, 'pricing-copy-2' );
	assert.equal( copy.innerBlocks[ 0 ].attributes.anchor, 'intro-copy' );
	assert.equal( group.block.attributes.anchor, 'pricing' );
	assert.ok( taken.has( 'pricing-copy-2' ) );

	const second = m.uniqueAnchors( group.block, taken );
	assert.equal( second.attributes.anchor, 'pricing-copy-3' );
} );

test( 'uniqueAnchors leaves unused anchors alone, and collectAnchors finds nested ones', () => {
	const tree = [ item( 'core/group', [ 0 ], '', { anchor: 'a' }, [ para( [ 0, 0 ], 'x', { anchor: 'b' } ) ] ).block, para( [ 1 ], 'y' ).block ];
	const taken = m.collectAnchors( tree );

	assert.deepEqual( [ ...taken ].sort(), [ 'a', 'b' ] );
	assert.equal( m.uniqueAnchors( para( [ 0 ], 'z', { anchor: 'fresh' } ).block, taken ).attributes.anchor, 'fresh' );
	assert.equal( m.uniqueAnchors( para( [ 0 ], 'z' ).block, taken ).attributes.anchor, undefined );
	assert.deepEqual( [ ...m.collectAnchors( tree, () => [ 'htmlId' ] ) ], [] );
} );
