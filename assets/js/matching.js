/**
 * Axle Block Restore: pure helpers for matching blocks across revisions.
 *
 * No WordPress dependencies, so the same file runs in the editor (as
 * window.axleBlockRestore.matching) and in Node unit tests (as a module).
 */
( function ( root, factory ) {
	if ( typeof module === 'object' && module.exports ) {
		module.exports = factory();
	} else {
		root.axleBlockRestore = root.axleBlockRestore || {};
		root.axleBlockRestore.matching = factory();
	}
} )( typeof self !== 'undefined' ? self : this, function () {
	'use strict';

	// Above this many token pairs the word diff falls back to "all removed, all added".
	var MAX_DIFF_CELLS = 250000;

	var ENTITIES = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#039;': "'", '&#39;': "'" };

	/**
	 * Visible text of serialized block markup.
	 *
	 * @param {string} markup Serialized block(s).
	 * @return {string} Text with single spaces.
	 */
	function textFromMarkup( markup ) {
		return String( markup || '' )
			.replace( /<!--[\s\S]*?-->/g, ' ' )
			.replace( /<[^>]+>/g, ' ' )
			.replace( /&(nbsp|amp|lt|gt|quot|#0?39);/g, function ( entity ) {
				return ENTITIES[ entity ] || entity;
			} )
			.replace( /\s+/g, ' ' )
			.trim();
	}

	/**
	 * Word overlap between two texts, from 0 (nothing shared) to 1 (same words).
	 *
	 * @param {string} a First text.
	 * @param {string} b Second text.
	 * @return {number} Jaccard similarity of the word sets.
	 */
	function similarity( a, b ) {
		var setA = new Set( String( a ).toLowerCase().split( /\s+/ ).filter( Boolean ) );
		var setB = new Set( String( b ).toLowerCase().split( /\s+/ ).filter( Boolean ) );
		var shared = 0;

		if ( ! setA.size && ! setB.size ) {
			return 1;
		}

		setA.forEach( function ( word ) {
			if ( setB.has( word ) ) {
				shared++;
			}
		} );

		return shared / ( setA.size + setB.size - shared );
	}

	/**
	 * Every block in a tree with its position, as indexes from the top level.
	 *
	 * @param {Object[]} blocks Blocks with optional innerBlocks.
	 * @param {number[]} [path] Path of the parent.
	 * @return {Array<{block: Object, path: number[]}>} Flat list, parents before children.
	 */
	function flatten( blocks, path ) {
		var base = path || [];

		return ( blocks || [] ).reduce( function ( all, block, index ) {
			var here = base.concat( index );
			all.push( { block: block, path: here } );
			return all.concat( flatten( block.innerBlocks, here ) );
		}, [] );
	}

	/**
	 * Versions of a block found in a revision, best match first.
	 *
	 * Blocks have no stable IDs between saves, so a candidate is any block of
	 * the same type; it scores 1 for sitting at the same position, plus its word
	 * similarity to the current block.
	 *
	 * @param {Array<{name: string, path: number[], text: string, print: string}>} candidates Blocks in the revision.
	 * @param {{name: string, path: number[], text: string, print: string}}       target     The block in the editor.
	 * @return {Array<Object>} Candidates of the same type, each with `same` and `score`, best first.
	 */
	function rankCandidates( candidates, target ) {
		var targetPath = target.path.join( '.' );

		return candidates
			.filter( function ( item ) {
				return item.name === target.name;
			} )
			.map( function ( item ) {
				return Object.assign( {}, item, {
					same: item.print === target.print,
					samePosition: item.path.join( '.' ) === targetPath,
					score: ( item.path.join( '.' ) === targetPath ? 1 : 0 ) + similarity( item.text, target.text ),
				} );
			} )
			.sort( function ( a, b ) {
				return b.score - a.score;
			} );
	}

	/**
	 * Compares a revision's top-level blocks with the post as it is now.
	 *
	 * "same": an identical block exists now. "changed": the block now at that
	 * position has the same type but different content. "missing": neither,
	 * so the block was deleted or moved and changed.
	 *
	 * @param {Array<{name: string, print: string}>} revisionItems Top-level blocks of the revision.
	 * @param {Array<{name: string, print: string}>} currentItems  Top-level blocks in the editor.
	 * @return {string[]} One status per revision block.
	 */
	function classify( revisionItems, currentItems ) {
		var currentPrints = new Set(
			currentItems.map( function ( item ) {
				return item.print;
			} )
		);

		return revisionItems.map( function ( item, index ) {
			if ( currentPrints.has( item.print ) ) {
				return 'same';
			}
			return currentItems[ index ] && currentItems[ index ].name === item.name ? 'changed' : 'missing';
		} );
	}

	/**
	 * Word-level difference between two texts.
	 *
	 * @param {string} before Text now.
	 * @param {string} after  Text in the revision.
	 * @return {Array<{type: string, text: string}>} Parts of type "same", "removed" or "added", in order.
	 */
	function wordDiff( before, after ) {
		var a = String( before ).match( /\s+|[^\s]+/g ) || [];
		var b = String( after ).match( /\s+|[^\s]+/g ) || [];
		var parts = [];
		var i;
		var j;

		function push( type, text ) {
			var last = parts[ parts.length - 1 ];
			if ( last && last.type === type ) {
				last.text += text;
			} else {
				parts.push( { type: type, text: text } );
			}
		}

		if ( a.length * b.length > MAX_DIFF_CELLS ) {
			if ( before ) {
				push( 'removed', before );
			}
			if ( after ) {
				push( 'added', after );
			}
			return parts;
		}

		// Longest common subsequence table, filled from the end.
		var table = [];
		for ( i = 0; i <= a.length; i++ ) {
			table.push( new Array( b.length + 1 ).fill( 0 ) );
		}
		for ( i = a.length - 1; i >= 0; i-- ) {
			for ( j = b.length - 1; j >= 0; j-- ) {
				table[ i ][ j ] = a[ i ] === b[ j ] ? table[ i + 1 ][ j + 1 ] + 1 : Math.max( table[ i + 1 ][ j ], table[ i ][ j + 1 ] );
			}
		}

		i = 0;
		j = 0;
		while ( i < a.length && j < b.length ) {
			if ( a[ i ] === b[ j ] ) {
				push( 'same', a[ i ] );
				i++;
				j++;
			} else if ( table[ i + 1 ][ j ] >= table[ i ][ j + 1 ] ) {
				push( 'removed', a[ i ] );
				i++;
			} else {
				push( 'added', b[ j ] );
				j++;
			}
		}
		for ( ; i < a.length; i++ ) {
			push( 'removed', a[ i ] );
		}
		for ( ; j < b.length; j++ ) {
			push( 'added', b[ j ] );
		}

		return tidy( parts );
	}

	/**
	 * Merges changes separated only by spaces into one removed and one added part.
	 *
	 * "water, salt." to "sugar, eggs." reads better as one swap than as
	 * "water," to "sugar," then "salt." to "eggs.".
	 *
	 * @param {Array<{type: string, text: string}>} parts Raw diff parts.
	 * @return {Array<{type: string, text: string}>} Grouped parts.
	 */
	function tidy( parts ) {
		var out = [];
		var run = null;

		function flush() {
			if ( run ) {
				if ( run.removed ) {
					out.push( { type: 'removed', text: run.removed } );
				}
				if ( run.added ) {
					out.push( { type: 'added', text: run.added } );
				}
				run = null;
			}
		}

		parts.forEach( function ( part, index ) {
			var next = parts[ index + 1 ];
			var bridge = 'same' === part.type && run && /^\s+$/.test( part.text ) && next && 'same' !== next.type;

			if ( 'same' === part.type && ! bridge ) {
				flush();
				out.push( part );
				return;
			}

			run = run || { removed: '', added: '' };
			if ( bridge ) {
				run.removed += part.text;
				run.added += part.text;
			} else {
				run[ part.type ] += part.text;
			}
		} );
		flush();

		return out;
	}

	// Attributes that style a block rather than say something. Everything else with a markup source or `role: content` is content.
	var STYLE_ATTRIBUTES = [ 'style', 'className', 'align', 'layout', 'backgroundColor', 'textColor', 'fontSize', 'fontFamily', 'gradient', 'borderColor' ];

	// Attributes a partial restore never touches: the block keeps its own.
	var KEEP_ATTRIBUTES = [ 'lock', 'metadata' ];

	// Sources that read text or markup out of the saved HTML.
	var CONTENT_SOURCES = [ 'html', 'rich-text', 'text', 'children', 'node', 'query' ];

	/**
	 * Whether an attribute is content, style, or left alone by a partial restore.
	 *
	 * `role: content` (core's own block.json metadata) and text sources are
	 * content. The listed style attributes are style. Any other attribute
	 * counts as style, because it changes how the block looks or behaves, not
	 * what it says.
	 *
	 * @param {string}   name         Attribute name.
	 * @param {Object}   [schema]     The attribute's block.json definition.
	 * @param {string[]} [styleNames] Style attribute names. Default STYLE_ATTRIBUTES.
	 * @return {string} "content", "style" or "keep".
	 */
	function attributeRole( name, schema, styleNames ) {
		var styles = styleNames || STYLE_ATTRIBUTES;

		if ( KEEP_ATTRIBUTES.indexOf( name ) !== -1 || ( schema && 'local' === schema.role ) ) {
			return 'keep';
		}
		if ( styles.indexOf( name ) !== -1 ) {
			return 'style';
		}
		if ( schema && ( 'content' === schema.role || CONTENT_SOURCES.indexOf( schema.source ) !== -1 ) ) {
			return 'content';
		}
		return 'style';
	}

	/**
	 * A value in a form that compares and prints the same every time.
	 *
	 * @param {*} value Attribute value or block part.
	 * @return {*} Value with sorted keys, and rich text as its HTML.
	 */
	function stable( value ) {
		if ( value && 'function' === typeof value.toHTMLString ) {
			return value.toHTMLString();
		}
		if ( Array.isArray( value ) ) {
			return value.map( stable );
		}
		if ( value && 'object' === typeof value ) {
			return Object.keys( value )
				.sort()
				.reduce( function ( out, key ) {
					if ( undefined !== value[ key ] ) {
						out[ key ] = stable( value[ key ] );
					}
					return out;
				}, {} );
		}
		return value;
	}

	/**
	 * The block's own type and attributes as a string, without its inner blocks.
	 *
	 * @param {{name: string, attributes: Object}} block Block.
	 * @return {string} Fingerprint.
	 */
	function shallowSignature( block ) {
		return JSON.stringify( [ block.name, stable( block.attributes || {} ) ] );
	}

	/**
	 * The block, attributes and inner blocks as a string. Equal strings mean equal blocks.
	 *
	 * Client IDs and other editor bookkeeping are left out.
	 *
	 * @param {{name: string, attributes: Object, innerBlocks: Array}} block Block.
	 * @return {string} Fingerprint.
	 */
	function signature( block ) {
		return JSON.stringify( [ block.name, stable( block.attributes || {} ), ( block.innerBlocks || [] ).map( signature ) ] );
	}

	/**
	 * The block as it would be after restoring all of it, only its content, or only its styling.
	 *
	 * "content" takes the revision's content attributes and inner blocks and
	 * keeps the current style. "style" takes the revision's style attributes and
	 * keeps the current content and inner blocks. Attributes with the role
	 * "keep" stay as they are now in both.
	 *
	 * @param {{name: string, attributes: Object, innerBlocks: Array}} current Block in the editor.
	 * @param {{name: string, attributes: Object, innerBlocks: Array}} old     Block in the revision.
	 * @param {string}                                                   mode    "replace", "content" or "style".
	 * @param {function(string): string}                                 roleFor Role of an attribute name.
	 * @return {{name: string, attributes: Object, innerBlocks: Array}} Result, sharing inner blocks with the inputs.
	 */
	function mergeBlock( current, old, mode, roleFor ) {
		var from = 'content' === mode ? 'content' : 'style';
		var attributes = {};

		if ( 'replace' === mode ) {
			return { name: old.name, attributes: Object.assign( {}, old.attributes ), innerBlocks: old.innerBlocks || [] };
		}

		Object.keys( Object.assign( {}, old.attributes, current.attributes ) ).forEach( function ( key ) {
			var source = roleFor( key ) === from ? old : current;
			if ( source.attributes && undefined !== source.attributes[ key ] ) {
				attributes[ key ] = source.attributes[ key ];
			}
		} );

		return {
			name: current.name,
			attributes: attributes,
			innerBlocks: 'content' === mode ? old.innerBlocks || [] : current.innerBlocks || [],
		};
	}

	/**
	 * Attributes whose value differs between two blocks, with how each is classified.
	 *
	 * @param {{attributes: Object}}     before  Block now.
	 * @param {{attributes: Object}}     after   Block after a restore.
	 * @param {function(string): string} roleFor Role of an attribute name.
	 * @return {Array<{name: string, role: string, before: *, after: *}>} Changed attributes.
	 */
	function changedAttributes( before, after, roleFor ) {
		return Object.keys( Object.assign( {}, before.attributes, after.attributes ) )
			.filter( function ( key ) {
				return JSON.stringify( stable( ( before.attributes || {} )[ key ] ) ) !== JSON.stringify( stable( ( after.attributes || {} )[ key ] ) );
			} )
			.map( function ( key ) {
				return { name: key, role: roleFor( key ), before: stable( ( before.attributes || {} )[ key ] ), after: stable( ( after.attributes || {} )[ key ] ) };
			} );
	}

	/**
	 * How many blocks a block holds, itself included.
	 *
	 * @param {{innerBlocks: Array}} block Block.
	 * @return {number} Count.
	 */
	function countBlocks( block ) {
		return ( block.innerBlocks || [] ).reduce( function ( total, inner ) {
			return total + countBlocks( inner );
		}, 1 );
	}

	/**
	 * What differs inside a block between a revision and now.
	 *
	 * Inner blocks that are identical drop out first. In what is left, blocks of the
	 * same type pair up in order and count as changed (their own settings differ,
	 * and their children are compared in turn). Blocks left over in the revision
	 * are added, blocks left over now are removed.
	 *
	 * Each entry says where it sits as paths of child indexes from the compared
	 * block: `oldPath` in the revision, `curPath` now. An added block also has
	 * `parentPath` (the current block that would hold it) and `index` (where).
	 *
	 * @param {{innerBlocks: Array}}      old Block in the revision.
	 * @param {{innerBlocks: Array}|null} cur Block now, or null when it is not in the post.
	 * @return {Array<{type: string, oldBlock: Object, curBlock: Object, oldPath: number[], curPath: number[], parentPath: number[], index: number}>} Differences, in document order.
	 */
	function diffTree( old, cur ) {
		var out = [];

		function compare( oldList, curList, oldBase, curBase ) {
			var a = oldList.map( signature );
			var b = curList.map( signature );
			var table = [];
			var i;
			var j;
			var anchors = [];

			for ( i = 0; i <= a.length; i++ ) {
				table.push( new Array( b.length + 1 ).fill( 0 ) );
			}
			for ( i = a.length - 1; i >= 0; i-- ) {
				for ( j = b.length - 1; j >= 0; j-- ) {
					table[ i ][ j ] = a[ i ] === b[ j ] ? table[ i + 1 ][ j + 1 ] + 1 : Math.max( table[ i + 1 ][ j ], table[ i ][ j + 1 ] );
				}
			}
			i = 0;
			j = 0;
			while ( i < a.length && j < b.length ) {
				if ( a[ i ] === b[ j ] ) {
					anchors.push( [ i, j ] );
					i++;
					j++;
				} else if ( table[ i + 1 ][ j ] >= table[ i ][ j + 1 ] ) {
					i++;
				} else {
					j++;
				}
			}
			anchors.push( [ a.length, b.length ] );

			var oldAt = 0;
			var curAt = 0;
			anchors.forEach( function ( anchor ) {
				var pointer = curAt;
				var k;

				for ( i = oldAt; i < anchor[ 0 ]; i++ ) {
					for ( k = pointer; k < anchor[ 1 ] && curList[ k ].name !== oldList[ i ].name; k++ ) {} // eslint-disable-line no-empty
					if ( k < anchor[ 1 ] ) {
						for ( j = pointer; j < k; j++ ) {
							out.push( { type: 'removed', curBlock: curList[ j ], curPath: curBase.concat( j ) } );
						}
						if ( shallowSignature( oldList[ i ] ) !== shallowSignature( curList[ k ] ) ) {
							out.push( { type: 'changed', oldBlock: oldList[ i ], curBlock: curList[ k ], oldPath: oldBase.concat( i ), curPath: curBase.concat( k ) } );
						}
						compare( oldList[ i ].innerBlocks || [], curList[ k ].innerBlocks || [], oldBase.concat( i ), curBase.concat( k ) );
						pointer = k + 1;
					} else {
						out.push( { type: 'added', oldBlock: oldList[ i ], oldPath: oldBase.concat( i ), parentPath: curBase, index: pointer } );
					}
				}
				for ( j = pointer; j < anchor[ 1 ]; j++ ) {
					out.push( { type: 'removed', curBlock: curList[ j ], curPath: curBase.concat( j ) } );
				}
				oldAt = anchor[ 0 ] + 1;
				curAt = anchor[ 1 ] + 1;
			} );
		}

		compare( old.innerBlocks || [], cur ? cur.innerBlocks || [] : [], [], [] );

		return out;
	}

	/**
	 * Counts of added, removed and changed blocks in a tree diff.
	 *
	 * An added or removed block counts with everything inside it.
	 *
	 * @param {Array<{type: string, oldBlock: Object, curBlock: Object}>} entries Result of diffTree().
	 * @return {{added: number, removed: number, changed: number}} Counts.
	 */
	function summarizeDiff( entries ) {
		var counts = { added: 0, removed: 0, changed: 0 };

		entries.forEach( function ( entry ) {
			if ( 'added' === entry.type ) {
				counts.added += countBlocks( entry.oldBlock );
			} else if ( 'removed' === entry.type ) {
				counts.removed += countBlocks( entry.curBlock );
			} else {
				counts.changed++;
			}
		} );

		return counts;
	}

	/**
	 * The block at a path of child indexes below a block.
	 *
	 * @param {{innerBlocks: Array}} root Block.
	 * @param {number[]}             path Child indexes, empty for the block itself.
	 * @return {Object|null} Block, or null when the path leads nowhere.
	 */
	function blockAt( root, path ) {
		var block = root;
		var i;

		for ( i = 0; block && i < path.length; i++ ) {
			block = ( block.innerBlocks || [] )[ path[ i ] ];
		}

		return block || null;
	}

	/**
	 * Finds text in revisions. Identical blocks in several revisions are grouped.
	 *
	 * @param {Array<{id: number, items: Array<{path: number[], name: string, text: string}>}>} revisions Newest first.
	 * @param {string} query Text to find, at least 2 characters.
	 * @return {Array<{text: string, name: string, path: number[], revisionIds: number[]}>} Matches, newest revision first.
	 */
	function search( revisions, query ) {
		var needle = String( query || '' ).trim().toLowerCase();
		var byText = {};
		var results = [];

		if ( needle.length < 2 ) {
			return results;
		}

		revisions.forEach( function ( revision ) {
			revision.items.forEach( function ( item ) {
				// Container blocks repeat their children's text; match the innermost block only.
				var hasChildMatch = revision.items.some( function ( other ) {
					return other.path.length > item.path.length && other.path.slice( 0, item.path.length ).join( '.' ) === item.path.join( '.' ) && other.text.toLowerCase().indexOf( needle ) !== -1;
				} );

				if ( hasChildMatch || item.text.toLowerCase().indexOf( needle ) === -1 ) {
					return;
				}

				if ( ! byText[ item.text ] ) {
					byText[ item.text ] = { text: item.text, name: item.name, path: item.path, revisionIds: [] };
					results.push( byText[ item.text ] );
				}
				if ( byText[ item.text ].revisionIds.indexOf( revision.id ) === -1 ) {
					byText[ item.text ].revisionIds.push( revision.id );
				}
			} );
		} );

		return results;
	}

	/**
	 * Shortens text around the first match of a query.
	 *
	 * @param {string} text   Full text.
	 * @param {string} query  Text to centre on, or empty.
	 * @param {number} length Maximum length.
	 * @return {string} Excerpt with ellipses where cut.
	 */
	function excerpt( text, query, length ) {
		var at = query ? text.toLowerCase().indexOf( String( query ).toLowerCase() ) : -1;
		var start;

		if ( text.length <= length ) {
			return text;
		}

		start = at === -1 ? 0 : Math.max( 0, Math.min( at - Math.floor( length / 3 ), text.length - length ) );

		return ( start > 0 ? '…' : '' ) + text.slice( start, start + length ).trim() + ( start + length < text.length ? '…' : '' );
	}

	return {
		textFromMarkup: textFromMarkup,
		similarity: similarity,
		flatten: flatten,
		rankCandidates: rankCandidates,
		classify: classify,
		wordDiff: wordDiff,
		search: search,
		excerpt: excerpt,
		STYLE_ATTRIBUTES: STYLE_ATTRIBUTES,
		attributeRole: attributeRole,
		signature: signature,
		shallowSignature: shallowSignature,
		mergeBlock: mergeBlock,
		changedAttributes: changedAttributes,
		countBlocks: countBlocks,
		diffTree: diffTree,
		summarizeDiff: summarizeDiff,
		blockAt: blockAt,
	};
} );
