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

	// Blocks that are empty by default. One with no text is noise in a list of removed blocks.
	var EMPTY_NOISE = [ 'core/paragraph', 'core/heading', 'core/freeform', 'core/list-item', 'core/html' ];

	/**
	 * Whether a path is a strict ancestor of another.
	 *
	 * @param {number[]} prefix Path of the possible ancestor.
	 * @param {number[]} path   Path of the possible descendant.
	 * @return {boolean} True when `path` lies below `prefix`.
	 */
	function isAncestor( prefix, path ) {
		return prefix.length < path.length && prefix.every( function ( step, index ) {
			return path[ index ] === step;
		} );
	}

	/**
	 * Blocks that were in recent revisions and are not in the post any more.
	 *
	 * A block counts as removed when no block now has the same markup and no block
	 * of the same type now has similar text, and it holds no block that is still
	 * in the post (those are edits, not removals).
	 * Older versions of one block (the same block, or a version of it with
	 * similar text) are listed once, as the newest version. A block inside a
	 * removed block is not listed on its own, because restoring the outer block
	 * brings it back.
	 *
	 * @param {Array<{id: *, items: Array<{name: string, path: number[], text: string, print: string}>}>} revisions Revisions, newest first.
	 * @param {Array<{name: string, path: number[], text: string, print: string}>}                        current   Every block in the post now.
	 * @param {{similarity: number, emptyNoise: string[]}}                                                [options] Edit threshold (default 0.6) and block types ignored when they have no text.
	 * @return {Array<{name: string, path: number[], text: string, print: string, revisionId: *, revisionIndex: number, revisionIds: Array<*>}>} Removed blocks, the most recently removed first.
	 */
	function removedBlocks( revisions, current, options ) {
		var settings = options || {};
		var threshold = 'number' === typeof settings.similarity ? settings.similarity : 0.6;
		var noise = Array.isArray( settings.emptyNoise ) ? settings.emptyNoise : EMPTY_NOISE;
		var nowPrints = new Set(
			current.map( function ( item ) {
				return item.print;
			} )
		);
		var kept = [];

		function editedNow( item ) {
			return (
				'' !== item.text &&
				current.some( function ( other ) {
					return other.name === item.name && similarity( other.text, item.text ) >= threshold;
				} )
			);
		}

		// A block with something of its own left in the post was edited, not removed: only what is missing inside it counts.
		function holdsSurvivor( item, items ) {
			return items.some( function ( other ) {
				return isAncestor( item.path, other.path ) && ( nowPrints.has( other.print ) || ( '' !== other.text && editedNow( other ) ) );
			} );
		}

		function sameBlockAs( entry, item ) {
			return entry.name === item.name && ( entry.print === item.print || ( '' !== entry.text && '' !== item.text && similarity( entry.text, item.text ) >= threshold ) );
		}

		revisions.forEach( function ( revision, revisionIndex ) {
			var covered = [];

			revision.items.forEach( function ( item ) {
				var older;

				if ( nowPrints.has( item.print ) || ( '' === item.text && noise.indexOf( item.name ) !== -1 ) ) {
					return;
				}
				if ( covered.some( function ( path ) {
					return isAncestor( path, item.path );
				} ) ) {
					return;
				}
				if ( editedNow( item ) || holdsSurvivor( item, revision.items ) ) {
					return;
				}

				covered.push( item.path );
				older = kept.find( function ( entry ) {
					return sameBlockAs( entry, item );
				} );
				if ( older ) {
					if ( older.revisionIds.indexOf( revision.id ) === -1 ) {
						older.revisionIds.push( revision.id );
					}
					return;
				}

				kept.push(
					Object.assign( {}, item, {
						revisionId: revision.id,
						revisionIndex: revisionIndex,
						revisionIds: [ revision.id ],
						// Same type at the same place now: rewritten in place rather than deleted.
						rewritten: current.some( function ( other ) {
							return other.name === item.name && other.path.join( '.' ) === item.path.join( '.' );
						} ),
					} )
				);
			} );
		} );

		return kept;
	}

	/**
	 * Blocks that share a parent, in order.
	 *
	 * @param {Array<{path: number[]}>} items      Flat list of blocks.
	 * @param {number[]}                parentPath Path of the parent, empty for the top level.
	 * @return {Array<Object>} Children of that parent.
	 */
	function siblingsOf( items, parentPath ) {
		return items
			.filter( function ( item ) {
				return item.path.length === parentPath.length + 1 && parentPath.every( function ( step, index ) {
					return item.path[ index ] === step;
				} );
			} )
			.sort( function ( a, b ) {
				return a.path[ a.path.length - 1 ] - b.path[ b.path.length - 1 ];
			} );
	}

	/**
	 * Where a removed block goes in the post now, as the nearest valid position.
	 *
	 * The block goes back under the block that holds the counterpart of its old
	 * parent (same type at the same path, else the most similar block of that
	 * type). With no such parent it goes to the top level, next to the outermost
	 * block that held it. Inside that list it goes after the nearest earlier
	 * neighbour that still exists, else before the nearest later one, else at
	 * its old index limited to the list.
	 *
	 * @param {Array<{name: string, path: number[], text: string, print: string}>} revisionItems Every block in the revision it was last seen in.
	 * @param {{name: string, path: number[]}}                                     entry         The removed block, with its path in that revision.
	 * @param {Array<{name: string, path: number[], text: string, print: string}>} currentItems  Every block in the post now.
	 * @return {{parentPath: number[], index: number, anchored: boolean, nested: boolean}} Parent path now, index below it, whether a neighbour fixed the spot, and whether the old parent was found.
	 */
	function placement( revisionItems, entry, currentItems ) {
		var parentPath = entry.path.slice( 0, -1 );
		var revisionList;
		var currentList;
		var anchorPath = entry.path;
		var nested = false;
		var position;
		var k;
		var found;

		function samePlace( a, b ) {
			return a.join( '.' ) === b.join( '.' );
		}

		// A neighbour counts when it is the same block, or an edited version of it.
		function same( a, b ) {
			return a.name === b.name && ( a.print === b.print || ( '' !== a.text && '' !== b.text && similarity( a.text, b.text ) >= 0.5 ) );
		}

		if ( parentPath.length ) {
			var oldParent = revisionItems.find( function ( item ) {
				return samePlace( item.path, parentPath );
			} );
			var counterpart = null;

			if ( oldParent ) {
				counterpart = currentItems.find( function ( item ) {
					return item.name === oldParent.name && samePlace( item.path, parentPath );
				} );
				if ( ! counterpart ) {
					counterpart = rankCandidates( currentItems, { name: oldParent.name, path: parentPath, text: oldParent.text, print: oldParent.print } ).filter( function ( item ) {
						return similarity( item.text, oldParent.text ) >= 0.5;
					} )[ 0 ];
				}
			}

			if ( counterpart ) {
				nested = true;
				parentPath = counterpart.path;
			} else {
				parentPath = [];
				anchorPath = entry.path.slice( 0, 1 );
			}
		}

		revisionList = siblingsOf( revisionItems, nested ? entry.path.slice( 0, -1 ) : [] );
		currentList = siblingsOf( currentItems, parentPath );
		position = revisionList.findIndex( function ( item ) {
			return samePlace( item.path, anchorPath );
		} );

		for ( k = position - 1; k >= 0; k-- ) {
			found = currentList.findIndex( function ( item ) {
				return same( item, revisionList[ k ] );
			} );
			if ( found !== -1 ) {
				return { parentPath: parentPath, index: found + 1, anchored: true, nested: nested };
			}
		}
		for ( k = position + 1; k < revisionList.length; k++ ) {
			found = currentList.findIndex( function ( item ) {
				return same( item, revisionList[ k ] );
			} );
			if ( found !== -1 ) {
				return { parentPath: parentPath, index: found, anchored: true, nested: nested };
			}
		}

		return { parentPath: parentPath, index: Math.min( anchorPath[ anchorPath.length - 1 ], currentList.length ), anchored: false, nested: nested };
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

	// How alike two versions of a block must be to count as the same block in the block history.
	var HISTORY_SIMILARITY = 0.5;
	// A block of the same type at the same place needs less: a rewrite in place is still an edit of that block.
	var HISTORY_POSITION_SIMILARITY = 0.2;

	/**
	 * How close two block paths are: shared leading steps first, then how far apart the last steps are.
	 *
	 * @param {number[]} a Path.
	 * @param {number[]} b Path.
	 * @return {number} Higher is closer.
	 */
	function pathCloseness( a, b ) {
		var shared = 0;

		while ( shared < a.length && shared < b.length && a[ shared ] === b[ shared ] ) {
			shared++;
		}

		return shared * 1000 - Math.abs( a[ a.length - 1 ] - b[ b.length - 1 ] ) - Math.abs( a.length - b.length ) * 10;
	}

	/**
	 * The block in one revision that is the same block as `tracked`, or null.
	 *
	 * An identical block of the same type wins (the nearest one when there are
	 * copies). Otherwise the most alike block of that type, which must share
	 * enough words, or sit at the same place and share a few. Blocks with no
	 * text only match at the same place.
	 *
	 * @param {Array<{name: string, path: number[], text: string, print: string}>} items    Blocks of the revision, nested ones too.
	 * @param {{name: string, path: number[], text: string, print: string}}       tracked  Block to find.
	 * @param {{similarity: number, positionSimilarity: number}}                  settings Thresholds.
	 * @param {Array}                                                             [newer]  Blocks of the next newer version of the post. With copies of the block there, an identical block elsewhere may be a twin, so an edited block at the same place wins.
	 * @return {Object|null} Item of the revision.
	 */
	function findCounterpart( items, tracked, settings, newer ) {
		var candidates = rankCandidates( items, tracked );
		var exact = candidates.filter( function ( item ) {
			return item.print === tracked.print;
		} );
		var best = null;
		var bestScore = -1;
		var twins;

		if ( exact.length ) {
			twins = ( newer || [] ).filter( function ( other ) {
				return other.name === tracked.name && other.print === tracked.print;
			} ).length;
			if ( twins > 1 && ! exact.some( function ( item ) {
				return item.samePosition;
			} ) ) {
				best = candidates.find( function ( item ) {
					return item.samePosition && similarity( item.text, tracked.text ) >= settings.similarity;
				} );
				if ( best ) {
					return best;
				}
			}
			return exact.sort( function ( a, b ) {
				return pathCloseness( b.path, tracked.path ) - pathCloseness( a.path, tracked.path );
			} )[ 0 ];
		}

		candidates.forEach( function ( item ) {
			var alike = similarity( item.text, tracked.text );
			var accepted = '' === item.text && '' === tracked.text ? item.samePosition : alike >= settings.similarity || ( item.samePosition && alike >= settings.positionSimilarity );
			var score = alike + ( item.samePosition ? 0.3 : 0 );

			if ( accepted && score > bestScore ) {
				best = item;
				bestScore = score;
			}
		} );

		return best;
	}

	/**
	 * Settings of the block history from the options, with safe defaults.
	 *
	 * @param {{similarity: number, positionSimilarity: number}} [options] Thresholds from 0 to 1.
	 * @return {{similarity: number, positionSimilarity: number}} Settings.
	 */
	function historySettings( options ) {
		var given = options || {};
		var clamp = function ( value, fallback ) {
			return 'number' === typeof value && ! isNaN( value ) ? Math.min( 1, Math.max( 0, value ) ) : fallback;
		};

		return {
			similarity: clamp( given.similarity, HISTORY_SIMILARITY ),
			positionSimilarity: clamp( given.positionSimilarity, HISTORY_POSITION_SIMILARITY ),
		};
	}

	/**
	 * Starts following a block back through revisions.
	 *
	 * @param {{name: string, path: number[], text: string, print: string, block: Object}} target The block as it is in the editor now.
	 * @param {Array}                                                                   [items] Every block in the editor now, nested ones too. Helps tell copies of a block apart.
	 * @return {{target: Object, tracked: Object, newer: Array, steps: Array}} Timeline with no revisions looked through yet.
	 */
	function startTimeline( target, items ) {
		return { target: target, tracked: target, newer: items || [], steps: [] };
	}

	/**
	 * Looks through more revisions, going further back. Returns a new timeline; the old one is unchanged.
	 *
	 * Blocks have no stable IDs between saves, so each revision is searched for
	 * the counterpart of the last version found. When a revision has none, the
	 * block was not in the post then, and the search goes on from the last
	 * version found, in case it comes back in an older revision.
	 *
	 * @param {{target: Object, tracked: Object, steps: Array}} timeline  Result of startTimeline() or an earlier call.
	 * @param {Array<{id: *, when: string, author: string, autosave: boolean, items: Array}>} revisions Next older revisions, newest first. Each item is `{name, path, text, print, block}`.
	 * @param {{similarity: number, positionSimilarity: number}} [options] Thresholds.
	 * @return {{target: Object, tracked: Object, steps: Array}} Timeline including the new revisions.
	 */
	function advanceTimeline( timeline, revisions, options ) {
		var settings = historySettings( options );
		var tracked = timeline.tracked;
		var newer = timeline.newer;
		var steps = timeline.steps.slice();

		revisions.forEach( function ( revision ) {
			var match = findCounterpart( revision.items, tracked, settings, newer );

			if ( match ) {
				tracked = match;
			}
			newer = revision.items;
			steps.push( { revision: revision, match: match } );
		} );

		return { target: timeline.target, tracked: tracked, newer: newer, steps: steps };
	}

	/**
	 * What differs between two versions of a block.
	 *
	 * @param {{text: string, block: Object}|null} before   Older version.
	 * @param {{text: string, block: Object}|null} after    Newer version.
	 * @param {function(string): string}           [roleFor] Role of an attribute. Content attributes are left out when the text changed, because the text already shows them.
	 * @return {{text: boolean, attributes: string[], inner: {added: number, removed: number, changed: number}|null}|null} Null when either version is missing.
	 */
	function describeChange( before, after, roleFor ) {
		var textChanged;
		var names;
		var inner = null;
		var counts;

		if ( ! before || ! after ) {
			return null;
		}

		textChanged = before.text !== after.text;
		names = Object.keys( Object.assign( {}, before.block.attributes, after.block.attributes ) ).filter( function ( key ) {
			var a = JSON.stringify( stable( ( before.block.attributes || {} )[ key ] ) );
			var b = JSON.stringify( stable( ( after.block.attributes || {} )[ key ] ) );

			return a !== b && ! ( textChanged && roleFor && 'content' === roleFor( key ) );
		} );

		if ( ( before.block.innerBlocks || [] ).length || ( after.block.innerBlocks || [] ).length ) {
			counts = summarizeDiff( diffTree( after.block, before.block ) );
			inner = counts.added || counts.removed || counts.changed ? counts : null;
		}

		return { text: textChanged, attributes: names, inner: inner };
	}

	/**
	 * The versions a block went through, newest first.
	 *
	 * Each entry is one change: `first` (the oldest version found), `added`
	 * (the block appears), `edited` (text, settings or inner blocks changed),
	 * `removed` (the block is gone from that save on) or `readded` (it comes
	 * back after being gone). The block as it is in the editor now comes first
	 * when it differs from the newest save, with `revisionId` "current".
	 * Saves that did not change the block are counted in `revisionIds`, not listed.
	 *
	 * @param {{target: Object, steps: Array}} timeline Result of advanceTimeline().
	 * @param {function(string): string}       [roleFor] Role of an attribute, for describeChange().
	 * @return {Array<{type: string, revisionId: *, revisionIds: Array<*>, when: string, author: string, autosave: boolean, item: Object|null, previous: Object|null, change: Object|null}>} Entries.
	 */
	function timelineEntries( timeline, roleFor ) {
		var entries = [];
		var present = null;
		var lastSeen = null;

		timeline.steps
			.slice()
			.reverse()
			.forEach( function ( step, index ) {
				var revision = step.revision;
				var base = { revisionId: revision.id, revisionIds: [ revision.id ], when: revision.when || '', author: revision.author || '', autosave: !! revision.autosave };

				if ( step.match ) {
					if ( ! present ) {
						entries.push( Object.assign( base, { type: lastSeen ? 'readded' : 0 === index ? 'first' : 'added', item: step.match, previous: lastSeen, change: describeChange( lastSeen, step.match, roleFor ) } ) );
					} else if ( present.print !== step.match.print ) {
						entries.push( Object.assign( base, { type: 'edited', item: step.match, previous: present, change: describeChange( present, step.match, roleFor ) } ) );
					} else {
						entries[ entries.length - 1 ].revisionIds.push( revision.id );
					}
					present = step.match;
					lastSeen = step.match;
				} else if ( present ) {
					entries.push( Object.assign( base, { type: 'removed', item: null, previous: present, change: null } ) );
					present = null;
				}
			} );

		if ( ! present || present.print !== timeline.target.print ) {
			entries.push( {
				type: present ? 'edited' : lastSeen ? 'readded' : 'added',
				revisionId: 'current',
				revisionIds: [],
				when: '',
				author: '',
				autosave: false,
				item: timeline.target,
				previous: present || lastSeen,
				change: describeChange( present || lastSeen, timeline.target, roleFor ),
			} );
		}

		return entries.reverse();
	}

	/**
	 * Every value of the attributes that hold an HTML id (such as a block's anchor), in some blocks and what is inside them.
	 *
	 * @param {Object[]}                      blocks     Blocks.
	 * @param {function(string): string[]}    anchorKeys Attribute names that hold an HTML id, for a block type. Default `anchor`.
	 * @return {Set<string>} Ids in use.
	 */
	function collectAnchors( blocks, anchorKeys ) {
		var found = new Set();
		var keysFor = anchorKeys || defaultAnchorKeys;

		flatten( blocks ).forEach( function ( item ) {
			keysFor( item.block.name ).forEach( function ( key ) {
				var value = ( item.block.attributes || {} )[ key ];

				if ( 'string' === typeof value && value ) {
					found.add( value );
				}
			} );
		} );

		return found;
	}

	function defaultAnchorKeys() {
		return [ 'anchor' ];
	}

	/**
	 * A copy of a block with its HTML ids made unique, so inserting it next to the original does not repeat an anchor.
	 *
	 * An id already in `taken` gets "-copy", then "-copy-2" and so on. The ids
	 * of the copy are added to `taken`, so two copies in a row stay apart too.
	 * The block given is not changed.
	 *
	 * @param {{name: string, attributes: Object, innerBlocks: Array}} block      Block, with its inner blocks.
	 * @param {Set<string>}                                           taken      Ids already in the post. Changed.
	 * @param {function(string): string[]}                            [anchorKeys] Attribute names that hold an HTML id, for a block type. Default `anchor`.
	 * @return {{name: string, attributes: Object, innerBlocks: Array}} Copy.
	 */
	function uniqueAnchors( block, taken, anchorKeys ) {
		var keysFor = anchorKeys || defaultAnchorKeys;
		var attributes = Object.assign( {}, block.attributes );

		keysFor( block.name ).forEach( function ( key ) {
			var value = attributes[ key ];
			var candidate;
			var n = 1;

			if ( 'string' !== typeof value || ! value ) {
				return;
			}
			candidate = value;
			while ( taken.has( candidate ) ) {
				candidate = value + '-copy' + ( n > 1 ? '-' + n : '' );
				n++;
			}
			taken.add( candidate );
			attributes[ key ] = candidate;
		} );

		return Object.assign( {}, block, {
			attributes: attributes,
			innerBlocks: ( block.innerBlocks || [] ).map( function ( inner ) {
				return uniqueAnchors( inner, taken, keysFor );
			} ),
		} );
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
		removedBlocks: removedBlocks,
		placement: placement,
		isAncestor: isAncestor,
		findCounterpart: findCounterpart,
		startTimeline: startTimeline,
		advanceTimeline: advanceTimeline,
		timelineEntries: timelineEntries,
		describeChange: describeChange,
		collectAnchors: collectAnchors,
		uniqueAnchors: uniqueAnchors,
	};
} );
