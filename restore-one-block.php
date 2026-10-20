<?php
/**
 * Plugin Name:       Restore One Block
 * Plugin URI:        https://wordpress.org/plugins/restore-one-block/
 * Description:       Restore a single block from an old revision instead of rolling back the whole post. Bring back a deleted paragraph, or an earlier version of one section, without losing later edits.
 * Version:           1.2.0
 * Requires at least: 6.6
 * Requires PHP:      7.4
 * Author:            Aryan Jasala
 * Author URI:        https://profiles.wordpress.org/aryanjasala/
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       restore-one-block
 *
 * @package AryanX\RestoreOneBlock
 */

namespace AryanX\RestoreOneBlock;

defined( 'ABSPATH' ) || exit;

const VERSION     = '1.2.0';
const PLUGIN_FILE = __FILE__;

// PSR-4: AryanX\RestoreOneBlock\Foo\Bar lives in src/Foo/Bar.php.
spl_autoload_register(
	static function ( $class_name ) {
		$prefix = __NAMESPACE__ . '\\';
		if ( 0 !== strpos( $class_name, $prefix ) ) {
			return;
		}

		$file = __DIR__ . '/src/' . str_replace( '\\', '/', substr( $class_name, strlen( $prefix ) ) ) . '.php';
		if ( is_readable( $file ) ) {
			require $file;
		}
	}
);

add_action( 'plugins_loaded', array( Plugin::class, 'boot' ) );
