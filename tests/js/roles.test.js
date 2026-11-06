// Unit tests for attribute roles and partial restores (content only, styling only).
const test = require( 'node:test' );
const assert = require( 'node:assert/strict' );
const m = require( '../../assets/js/matching.js' );

const schema = {
	content: { type: 'rich-text', source: 'rich-text', role: 'content' },
	url: { type: 'string', role: 'content' },
	level: { type: 'number' },
	fontSize: { type: 'string' },
	dropCap: { type: 'boolean' },
	lock: { type: 'object' },
};
const roleFor = ( name ) => m.attributeRole( name, schema[ name ] );

test( 'attributeRole: role content and text sources are content', () => {
	assert.equal( m.attributeRole( 'content', schema.content ), 'content' );
	assert.equal( m.attributeRole( 'url', schema.url ), 'content' );
	assert.equal( m.attributeRole( 'caption', { source: 'html' } ), 'content' );
	assert.equal( m.attributeRole( 'text', { source: 'text' } ), 'content' );
} );

test( 'attributeRole: the listed attributes are style, even with a content role', () => {
	for ( const name of m.STYLE_ATTRIBUTES ) {
		assert.equal( m.attributeRole( name, { role: 'content' } ), 'style', name );
	}
	assert.deepEqual( m.STYLE_ATTRIBUTES, [ 'style', 'className', 'align', 'layout', 'backgroundColor', 'textColor', 'fontSize', 'fontFamily', 'gradient', 'borderColor' ] );
} );

test( 'attributeRole: other attributes count as style, lock and metadata are kept', () => {
	assert.equal( m.attributeRole( 'dropCap', schema.dropCap ), 'style' );
	assert.equal( m.attributeRole( 'unknown' ), 'style' );
	assert.equal( m.attributeRole( 'lock' ), 'keep' );
	assert.equal( m.attributeRole( 'metadata', { role: 'content' } ), 'keep' );
	assert.equal( m.attributeRole( 'anchor', { role: 'local' } ), 'keep' );
} );

test( 'attributeRole: a custom style list replaces the default', () => {
	assert.equal( m.attributeRole( 'fontSize', undefined, [ 'width' ] ), 'style' );
	assert.equal( m.attributeRole( 'width', { source: 'html' }, [ 'width' ] ), 'style' );
	assert.equal( m.attributeRole( 'className', { source: 'html' }, [ 'width' ] ), 'content' );
} );

const now = { name: 'core/paragraph', attributes: { content: 'Now', fontSize: 'large', style: { color: { text: 'red' } }, lock: { move: true } }, innerBlocks: [ { name: 'x', attributes: {}, innerBlocks: [] } ] };
const old = { name: 'core/paragraph', attributes: { content: 'Then', fontSize: 'small', className: 'old' }, innerBlocks: [] };

test( 'mergeBlock replace takes the revision block', () => {
	const merged = m.mergeBlock( now, old, 'replace', roleFor );
	assert.deepEqual( merged.attributes, old.attributes );
	assert.equal( merged.innerBlocks, old.innerBlocks );
} );

test( 'mergeBlock content takes the old content and inner blocks, keeps current style', () => {
	const merged = m.mergeBlock( now, old, 'content', roleFor );
	assert.deepEqual( merged.attributes, { content: 'Then', fontSize: 'large', style: { color: { text: 'red' } }, lock: { move: true } } );
	assert.equal( merged.innerBlocks, old.innerBlocks );
} );

test( 'mergeBlock style takes the old style, keeps current content and inner blocks', () => {
	const merged = m.mergeBlock( now, old, 'style', roleFor );
	// The old block had no `style`, so the restored style has none either.
	assert.deepEqual( merged.attributes, { content: 'Now', fontSize: 'small', className: 'old', lock: { move: true } } );
	assert.equal( merged.innerBlocks, now.innerBlocks );
} );

test( 'a restore that changes nothing has the same signature as the block now', () => {
	const same = { name: now.name, attributes: Object.assign( {}, now.attributes, { content: 'Now' } ), innerBlocks: now.innerBlocks };
	// Only the content differs from `now`, so restoring only the styling changes nothing.
	const sameStyle = { name: now.name, attributes: Object.assign( {}, now.attributes, { content: 'Other' } ), innerBlocks: [] };
	assert.equal( m.signature( m.mergeBlock( now, same, 'content', roleFor ) ), m.signature( now ) );
	assert.equal( m.signature( m.mergeBlock( now, sameStyle, 'style', roleFor ) ), m.signature( now ) );
	assert.notEqual( m.signature( m.mergeBlock( now, sameStyle, 'content', roleFor ) ), m.signature( now ) );
} );

test( 'signature ignores key order and client IDs, and reads rich text as HTML', () => {
	const rich = { toHTMLString: () => '<b>x</b>' };
	assert.equal(
		m.signature( { name: 'a', clientId: '1', attributes: { b: 1, a: { d: 1, c: 2 } }, innerBlocks: [] } ),
		m.signature( { name: 'a', clientId: '2', attributes: { a: { c: 2, d: 1 }, b: 1 }, innerBlocks: [] } )
	);
	assert.equal( m.signature( { name: 'a', attributes: { content: rich }, innerBlocks: [] } ), m.signature( { name: 'a', attributes: { content: '<b>x</b>' }, innerBlocks: [] } ) );
} );

test( 'changedAttributes lists the attributes that differ with their role', () => {
	const changes = m.changedAttributes( now, old, roleFor );
	assert.deepEqual(
		changes.map( ( c ) => [ c.name, c.role ] ).sort(),
		[ [ 'className', 'style' ], [ 'content', 'content' ], [ 'fontSize', 'style' ], [ 'lock', 'keep' ], [ 'style', 'style' ] ]
	);
	assert.deepEqual( changes.find( ( c ) => 'fontSize' === c.name ), { name: 'fontSize', role: 'style', before: 'large', after: 'small' } );
} );
