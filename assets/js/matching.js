/**
 * Restore One Block: pure helpers for matching blocks across revisions.
 *
 * No WordPress dependencies, so the same file runs in the editor (as
 * window.restoreOneBlock.matching) and in Node unit tests (as a module).
 */
( function ( root, factory ) {
	if ( typeof module === 'object' && module.exports ) {
		module.exports = factory();
	} else {
		root.restoreOneBlock = root.restoreOneBlock || {};
		root.restoreOneBlock.matching = factory();
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
	};
} );
