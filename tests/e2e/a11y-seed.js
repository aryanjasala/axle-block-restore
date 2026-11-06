// Seeds for the accessibility screens that need a template part, which only the REST API can save.
const p = ( text ) => `<!-- wp:paragraph --><p>${ text }</p><!-- /wp:paragraph -->`;

/**
 * Saves a template part three times, so it has revisions to restore from.
 *
 * @param {Function} rest  The rest fixture.
 * @param {string}   theme Active theme.
 */
async function seedTemplatePart( rest, theme ) {
	for ( const content of [ [ p( 'Open from nine.' ), p( 'Call us on Monday.' ) ], [ p( 'Open from ten.' ), p( 'Call us on Monday.' ) ], [ p( 'Open from eleven.' ) ] ] ) {
		await rest( 'POST', `/wp/v2/template-parts/${ theme }//header`, { content: content.join( '\n\n' ), slug: 'header', theme, status: 'publish' } );
	}
}

module.exports = { seedTemplatePart };
